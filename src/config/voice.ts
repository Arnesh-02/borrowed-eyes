export const VOICE_SAMPLE_RATE = 16_000 as const;
export const VOICE_CHANNELS = 1 as const;
export const VOICE_ENCODING = 'float32' as const;
export const VOICE_TRANSCRIPTION_BYTES_PER_SAMPLE = 2 as const;

/** Keep capture memory bounded to one short utterance. */
export const VOICE_MAX_CAPTURE_MS = 60_000;
export const VOICE_MIN_CAPTURE_MS = 250;
export const VOICE_MAX_PCM_BYTES = Math.floor(
  VOICE_SAMPLE_RATE * (VOICE_MAX_CAPTURE_MS / 1_000) * VOICE_CHANNELS
    * VOICE_TRANSCRIPTION_BYTES_PER_SAMPLE,
);

/** Two CPU threads keeps local transcription modest on mobile devices. */
export const WHISPER_MAX_THREADS = 2;
export const WHISPER_TRANSCRIPTION_TIMEOUT_MS = 30_000;

export const VOICE_MODEL_REQUIRED_REASON =
  'Choose a local Whisper model file ending in .bin, .ggml, or .gguf before using voice input.';
export const VOICE_MODEL_INVALID_REASON =
  'That file is not a supported Whisper model. Choose a .bin, .ggml, or .gguf model file.';
export const VOICE_MODEL_PICKER_REASON =
  'The Whisper model could not be selected. Choose a local .bin, .ggml, or .gguf file and try again.';
export const VOICE_NATIVE_UNAVAILABLE_REASON =
  'Local Whisper is unavailable here. Use a development build with whisper.rn and select a local model file.';
export const VOICE_MICROPHONE_DENIED_REASON =
  'Microphone permission is required for local voice input.';
export const VOICE_CAPTURE_UNAVAILABLE_REASON =
  'Microphone capture could not start. Use a development build with microphone access.';
export const VOICE_CAPTURE_TOO_SHORT_REASON =
  'Voice input was too short. Please speak a little longer and try again.';
export const VOICE_NO_SPEECH_REASON =
  'No speech was captured. Please try again.';
export const VOICE_TRANSCRIPTION_FAILED_REASON =
  'Local voice transcription failed. Check the selected Whisper model and try again.';
export const VOICE_TRANSCRIPTION_TIMEOUT_REASON =
  'Local voice transcription timed out. Try a shorter utterance.';
export const VOICE_CANCELLED_REASON = 'Voice input was cancelled.';

const WHISPER_MODEL_NAME_PATTERN = /\.(?:bin|ggml|gguf)$/i;

export function isWhisperModelFileName(fileName: string): boolean {
  return WHISPER_MODEL_NAME_PATTERN.test(fileName.trim());
}

export function whisperModelFileNameFromPath(path: string): string {
  const withoutFragment = path.split(/[?#]/u, 1)[0] ?? path;
  const lastSlash = Math.max(withoutFragment.lastIndexOf('/'), withoutFragment.lastIndexOf('\\'));
  return withoutFragment.slice(lastSlash + 1);
}

export function isLocalWhisperModelPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || /^https?:\/\//iu.test(trimmed)) return false;
  return isWhisperModelFileName(whisperModelFileNameFromPath(trimmed));
}
