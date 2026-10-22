import type { AIProvider, AIRequest } from './AIProvider';
import { withDeadline } from './deadline';
import { AIProviderError, createAbortError, isAbortError, safeFailureMessage, throwIfAborted } from './errors';
import { createFallbackResponse } from './fallback';
import { AI_LIMITS } from './limits';
import { boundAIRequest, isClosingRequest } from './request';
import { validateAIResponse } from './responseSchema';
import type { AIResponse } from './responseSchema';
import { hasPromptInjection } from './safety';

export type AIPlanResult = { response: AIResponse; source: 'gemma' | 'fallback'; failure?: string };

export class AIPlanner {
  private readonly provider: AIProvider | null;

  constructor(provider: AIProvider | null) {
    this.provider = provider;
  }

  async plan(request: AIRequest, signal?: AbortSignal): Promise<AIPlanResult> {
    throwIfAborted(signal);
    const snapshot = boundAIRequest(request);
    const fallback = (failure?: string): AIPlanResult => {
      throwIfAborted(signal);
      const response = validateAIResponse(createFallbackResponse(snapshot), snapshot);
      throwIfAborted(signal);
      return failure ? { response, source: 'fallback', failure } : { response, source: 'fallback' };
    };

    if (!this.provider) return fallback();
    if (snapshot.sessionStatus !== 'running' && !isClosingRequest(snapshot)) return fallback();
    if (hasPromptInjection(snapshot.userResponse) || snapshot.recentTurns.some((turn) => hasPromptInjection(turn.text))) {
      return fallback(safeFailureMessage(new AIProviderError('unsafe_input')));
    }
    try {
      // One attempt, no repair loop or retry; bounds even a replacement provider.
      const value = await withDeadline(
        (childSignal) => this.provider!.generateResponse(snapshot, childSignal),
        AI_LIMITS.plannerTimeoutMs,
        signal,
      );
      throwIfAborted(signal);
      const response = validateAIResponse(value, snapshot);
      throwIfAborted(signal);
      return { response, source: 'gemma' };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw createAbortError();
      return fallback(safeFailureMessage(error));
    }
  }
}
