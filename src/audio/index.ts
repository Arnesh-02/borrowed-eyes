// This entry point stays native-free. Import the factory from './createSessionAudio'.
export { AudioController } from './AudioController';
export { TextFallbackSpeechInput, VOICE_INPUT_UNAVAILABLE } from './TextFallbackSpeechInput';
export { detectiveAmbientTrack } from './tracks';
export { QUIET_MUSIC_VOLUME } from './audioErrors';
export type {
  AmbientTrack,
  AudioSnapshot,
  AudioState,
  MusicOutput,
  MusicSnapshot,
  SpeechInput,
  SpeechInputAvailability,
  SpeechInputResult,
  SpeechOutput,
} from './types';
