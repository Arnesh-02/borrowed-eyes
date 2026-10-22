import { getAIConfig, validateAIConfig } from '../config/ai';
import type { AIConfig } from '../config/ai';
import type { AIProvider, AIRequest } from './AIProvider';
import { withDeadline } from './deadline';
import { buildDetectiveMessages } from './detectivePrompt';
import { AIProviderError, createAbortError, isAbortError, throwIfAborted } from './errors';
import { boundAIRequest } from './request';
import { AI_RESPONSE_JSON_SCHEMA, parseAIResponse } from './responseSchema';
import type { AIResponse } from './responseSchema';
import { hasPromptInjection } from './safety';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const modelName = (name: string): string => name.includes(':') ? name : `${name}:latest`;

export class GemmaProvider implements AIProvider {
  private readonly config: AIConfig;
  private readonly fetchImplementation: typeof fetch;
  private availabilityVerified = false;

  constructor(config: AIConfig = getAIConfig(), fetchImplementation: typeof fetch = fetch) {
    // Validation happens on generateResponse so invalid environment settings
    // become a normal planner fallback rather than a module-load/app crash.
    this.config = { ...config };
    this.fetchImplementation = fetchImplementation;
  }

  async generateResponse(request: AIRequest, signal?: AbortSignal): Promise<AIResponse> {
    throwIfAborted(signal);
    try {
      const config = validateAIConfig(this.config);
      const snapshot = boundAIRequest(request);
      if (hasPromptInjection(snapshot.userResponse) || snapshot.recentTurns.some((turn) => hasPromptInjection(turn.text))) {
        throw new AIProviderError('unsafe_input');
      }
      return await withDeadline(async (childSignal) => {
        throwIfAborted(childSignal);
        if (!this.availabilityVerified) await this.verifyAvailability(config, childSignal);
        throwIfAborted(childSignal);
        const payload = await this.requestJSON(`${config.endpoint}/api/chat`, {
          method: 'POST',
          body: JSON.stringify({
            model: config.model,
            messages: buildDetectiveMessages(snapshot),
            stream: false,
            format: AI_RESPONSE_JSON_SCHEMA,
            options: { temperature: 0.3, top_p: 0.8, top_k: 30, num_predict: 384, num_ctx: 8192 },
            keep_alive: '5m',
          }),
        }, childSignal, 16384);
        throwIfAborted(childSignal);
        if (!record(payload) || payload.done !== true || payload.done_reason === 'length'
          || typeof payload.model !== 'string' || modelName(payload.model) !== modelName(config.model)
          || !record(payload.message) || payload.message.role !== 'assistant'
          || typeof payload.message.content !== 'string'
          || (payload.message.tool_calls !== undefined
            && (!Array.isArray(payload.message.tool_calls) || payload.message.tool_calls.length > 0))) {
          throw new AIProviderError('invalid_response');
        }
        const response = parseAIResponse(payload.message.content, snapshot);
        throwIfAborted(childSignal);
        return response;
      }, config.timeoutMs, signal);
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw createAbortError();
      if (error instanceof AIProviderError) {
        if (['network', 'http', 'redirect', 'timeout', 'runtime_unavailable', 'model_unavailable'].includes(error.code)) {
          this.availabilityVerified = false;
        }
        throw error;
      }
      this.availabilityVerified = false;
      throw new AIProviderError('network');
    }
  }

  private async verifyAvailability(config: AIConfig, signal: AbortSignal): Promise<void> {
    const runtime = await this.requestJSON(`${config.endpoint}/api/version`, { method: 'GET' }, signal, 4096);
    throwIfAborted(signal);
    const version = record(runtime) && typeof runtime.version === 'string'
      ? /^(\d+)\.(\d+)\.(\d+)(?:[-+][a-z\d.-]+)?$/i.exec(runtime.version) : null;
    // Gemma 3 requires Ollama 0.6+. A successful HTTP response alone is not
    // sufficient evidence that this is an Ollama runtime we can use.
    if (!version || (Number(version[1]) === 0 && Number(version[2]) < 6)) {
      throw new AIProviderError('runtime_unavailable');
    }
    const tags = await this.requestJSON(`${config.endpoint}/api/tags`, { method: 'GET' }, signal, 262144);
    throwIfAborted(signal);
    if (!record(tags) || !Array.isArray(tags.models)) throw new AIProviderError('model_unavailable');
    const installed = tags.models.find((entry: unknown) => record(entry)
      && ((typeof entry.name === 'string' && modelName(entry.name) === modelName(config.model))
        || (typeof entry.model === 'string' && modelName(entry.model) === modelName(config.model))));
    if (!record(installed) || installed.remote_host || installed.remote_model) throw new AIProviderError('model_unavailable');
    if (record(installed.details) && typeof installed.details.family === 'string'
      && !/^gemma/i.test(installed.details.family)) throw new AIProviderError('model_unavailable');
    throwIfAborted(signal);
    this.availabilityVerified = true;
  }

  private async requestJSON(url: string, init: RequestInit, signal: AbortSignal, maximumLength: number): Promise<unknown> {
    throwIfAborted(signal);
    const response = await this.fetchImplementation(url, {
      ...init,
      signal,
      headers: { Accept: 'application/json', ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    throwIfAborted(signal);
    // Fetch implementations must honor redirect:'error' to prevent forwarding
    // at transport level. The URL/status checks additionally reject results
    // from shims which followed a redirect anyway; they cannot undo that I/O.
    if (response.redirected || response.type === 'opaqueredirect'
      || (response.status >= 300 && response.status < 400)
      || (response.url && response.url !== url)) throw new AIProviderError('redirect');
    if (!response.ok) throw new AIProviderError('http');
    const declaredLength = response.headers.get('content-length');
    if (declaredLength && Number(declaredLength) > maximumLength) throw new AIProviderError('invalid_response');
    const text = await this.readBody(response, signal, maximumLength);
    throwIfAborted(signal);
    if (text.length > maximumLength) throw new AIProviderError('invalid_response');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AIProviderError('invalid_response');
    }
  }

  private async readBody(response: Response, signal: AbortSignal, maximumBytes: number): Promise<string> {
    // Expo 57 installs its WinterCG fetch globally on native by default. Its
    // stream permits a byte cap before buffering/parsing a whole response.
    // A legacy fetch shim without streams can only be capped after text().
    if (!response.body || typeof response.body.getReader !== 'function') return response.text();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        throwIfAborted(signal);
        const { done, value } = await reader.read();
        throwIfAborted(signal);
        if (done) break;
        size += value.byteLength;
        if (size > maximumBytes) {
          cancel();
          throw new AIProviderError('invalid_response');
        }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  }
}

export function createAIProvider(config: AIConfig = getAIConfig()): AIProvider | null {
  return config.endpoint ? new GemmaProvider(config) : null;
}

export { GemmaProvider as OllamaGemmaProvider };
