import type { SpeechInput, SpeechInputAvailability, SpeechInputResult } from './types';

export const VOICE_INPUT_UNAVAILABLE = 'Voice recognition is not available in this build. Please type your response.';

/** No recorder, microphone permission request, or simulated listening state. */
export class TextFallbackSpeechInput implements SpeechInput {
  getAvailability(): SpeechInputAvailability {
    return { available: false, reason: VOICE_INPUT_UNAVAILABLE };
  }

  async prepare(): Promise<SpeechInputAvailability> {
    return this.getAvailability();
  }

  async start(): Promise<SpeechInputResult> {
    return { type: 'unavailable', reason: VOICE_INPUT_UNAVAILABLE };
  }

  async stop(): Promise<SpeechInputResult> {
    return { type: 'cancelled' };
  }

  async cancel(): Promise<void> {}

  async pickModel(): Promise<SpeechInputAvailability> {
    return this.getAvailability();
  }

  async dispose(): Promise<void> {}
}
