export type AudioState =
  | 'idle'
  | 'music_playing'
  | 'ai_speaking'
  | 'user_listening'
  | 'processing'
  | 'paused'
  | 'error';

export interface AudioSnapshot {
  state: AudioState;
  error: string | null;
}

export interface AmbientTrack {
  /** A bundled asset's numeric require() result. URLs and file paths are not accepted. */
  source: number;
  title: string;
  license: string;
}

export interface SpeechOutput {
  /** Resolves on completion or cancellation; rejects on failure. Never queues utterances. */
  speak(text: string, options?: { onStart?: () => void }): Promise<void>;
  stop(): Promise<void>;
  /** Applies to the next utterance. */
  setVolume(volume: number): void | Promise<void>;
}

export interface MusicSnapshot {
  /** Confirmed, loaded, non-buffering playback, not a request to play. */
  playing: boolean;
  error: string | null;
}

export interface MusicOutput {
  /** Replaces the current player; null releases it without loading another source. */
  load(track: AmbientTrack | null): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Stops playback and releases the player. The adapter remains reusable. */
  stop(): Promise<void>;
  setVolume(volume: number): void | Promise<void>;
  getSnapshot(): MusicSnapshot;
  subscribe(listener: (snapshot: MusicSnapshot) => void): () => void;
}

export type SpeechInputAvailability =
  | { available: true }
  | { available: false; reason: string };

export type SpeechInputResult =
  | { type: 'transcript'; text: string }
  | { type: 'unavailable'; reason: string }
  | { type: 'cancelled' };

export interface SpeechInput {
  getAvailability(): SpeechInputAvailability;
  /** Prepares capture without claiming that the microphone is listening. */
  prepare(): Promise<SpeechInputAvailability>;
  /** onStart must fire only after capture actually begins. */
  start(options?: { onStart?: () => void }): Promise<SpeechInputResult>;
  /** Finalizes an active capture and returns its transcript. */
  stop?(): Promise<SpeechInputResult>;
  /** Cancels pending preparation as well as active capture. */
  cancel(): Promise<void>;
  /** Opens a local model picker without requesting microphone access. */
  pickModel?(): Promise<SpeechInputAvailability>;
  /** Releases native model/audio resources. */
  dispose?(): Promise<void>;
}
