import { AudioController } from './AudioController';
import { ExpoMusicOutput } from './ExpoMusicOutput';
import { ExpoSpeechOutput } from './ExpoSpeechOutput';
import { WhisperSpeechInput } from './WhisperSpeechInput';

/** Call once for the root-owned session controller; creation does not start native audio. */
export function createSessionAudio(): AudioController {
  return new AudioController(new ExpoSpeechOutput(), new ExpoMusicOutput(), new WhisperSpeechInput());
}
