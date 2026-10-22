const failureMessages = Object.freeze({
  not_configured: 'Local AI is not configured.',
  invalid_configuration: 'Local AI needs a private HTTP endpoint and a local Gemma model.',
  network: 'The local AI service could not be reached.',
  http: 'The local AI service refused the request.',
  redirect: 'The local AI service returned a redirect.',
  timeout: 'The local AI response took too long.',
  runtime_unavailable: 'A compatible local Ollama runtime is unavailable.',
  model_unavailable: 'The configured Gemma model is not available locally.',
  invalid_response: 'The local AI response did not pass validation.',
  unsafe_input: 'The request could not be used safely for local AI.',
});

export type AIFailureCode = keyof typeof failureMessages;

// Only fixed messages cross the provider boundary; never include server/user text.
export class AIProviderError extends Error {
  readonly code: AIFailureCode;

  constructor(code: AIFailureCode) {
    super(failureMessages[code]);
    this.name = 'AIProviderError';
    this.code = code;
  }
}

export function safeFailureMessage(error: unknown): string {
  return error instanceof AIProviderError
    ? failureMessages[error.code] ?? failureMessages.network
    : failureMessages.network;
}

export function createAbortError(): Error {
  const error = new Error('The AI request was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}
