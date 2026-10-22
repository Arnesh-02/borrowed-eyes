import { AIProviderError } from '../ai/errors';

export type AIConfig = { endpoint: string; model: string; timeoutMs: number };

export const DEFAULT_AI_TIMEOUT_MS = 20000;
export const MIN_AI_TIMEOUT_MS = 1000;
export const MAX_AI_TIMEOUT_MS = 30000;

export function boundAITimeout(timeoutMs: number): number {
  return Number.isFinite(timeoutMs)
    ? Math.max(MIN_AI_TIMEOUT_MS, Math.min(MAX_AI_TIMEOUT_MS, Math.floor(timeoutMs)))
    : DEFAULT_AI_TIMEOUT_MS;
}

export function getAIConfig(): AIConfig {
  // Static dot-notation references are required for Expo's build-time inlining.
  // Empty means offline; localhost must be an explicit choice on a phone too.
  return {
    endpoint: (process.env.EXPO_PUBLIC_OLLAMA_URL ?? '').trim(),
    model: (process.env.EXPO_PUBLIC_GEMMA_MODEL ?? 'gemma3:1b').trim(),
    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
  };
}

export function normalizeOllamaEndpoint(endpoint: string): string {
  if (!endpoint) throw new AIProviderError('not_configured');
  // A deliberately narrow grammar prevents URL-parser tricks, DNS rebinding
  // through arbitrary domains, octal/hex IPs, credentials, and non-base paths.
  // .local and IPv6 are deliberately not enabled; private IPv4 is unambiguous.
  const match = /^http:\/\/(localhost|(?:\d{1,3}\.){3}\d{1,3})(?::([1-9]\d{0,4}))?\/?$/i.exec(endpoint);
  if (!match) throw new AIProviderError('invalid_configuration');
  const host = match[1].toLowerCase();
  const port = match[2] === undefined ? undefined : Number(match[2]);
  if (port !== undefined && port > 65535) throw new AIProviderError('invalid_configuration');
  if (host !== 'localhost') {
    const parts = host.split('.');
    if (parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) {
      throw new AIProviderError('invalid_configuration');
    }
    const [first, second] = parts.map(Number);
    const privateHost = first === 127 || first === 10
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
    if (!privateHost) throw new AIProviderError('invalid_configuration');
  }
  return `http://${host}${port !== undefined && port !== 80 ? `:${port}` : ''}`;
}

export function validateAIConfig(config: AIConfig): AIConfig {
  const endpoint = normalizeOllamaEndpoint(config.endpoint);
  const model = config.model;
  if (model.length > 120 || !/^(?:[a-z0-9_.-]+\/)?gemma[a-z0-9_.-]*(?::[a-z0-9_.-]+)?$/i.test(model)
    || /cloud/i.test(model)) {
    throw new AIProviderError('invalid_configuration');
  }
  return { endpoint, model, timeoutMs: boundAITimeout(config.timeoutMs) };
}
