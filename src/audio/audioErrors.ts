const messages = {
  speech_failed: 'Speech could not play. Check your device speech settings or continue with text.',
  speech_timeout: 'Speech took too long to start or finish. Continue with text or try again.',
  speech_too_long: 'This message is too long for the device speech service. Continue with text.',
  speech_stop_failed: 'Speech could not be stopped. Try pausing audio again.',
  music_failed: 'Ambient audio could not play. You can continue without music.',
  music_timeout: 'Ambient audio did not become ready. You can continue without music.',
  music_invalid_track: 'Ambient audio needs a bundled track with a title and license.',
  input_failed: 'Voice input could not start. Please use text input.',
  input_timeout: 'Voice input timed out. Please use text input or try again.',
  audio_failed: 'Audio could not be updated. Try resuming audio or continue with text.',
  audio_stop_failed: 'Audio could not be fully stopped. Try pausing audio again.',
} as const;

export type AudioErrorCode = keyof typeof messages;

/** Only these fixed messages cross into UI state; native errors may include paths or text. */
export class AudioOperationError extends Error {
  constructor(readonly code: AudioErrorCode) {
    super(messages[code]);
    this.name = 'AudioOperationError';
  }
}

export function audioErrorMessage(error: unknown, fallback: AudioErrorCode): string {
  return error instanceof AudioOperationError ? messages[error.code] : messages[fallback];
}

export const QUIET_MUSIC_VOLUME = 0.12;
export const SPEECH_TIMEOUT_MS = 120_000;
export const CAPTURE_TIMEOUT_MS = 60_000;
