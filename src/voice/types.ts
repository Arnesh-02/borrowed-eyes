import type { AudioSnapshot, SpeechInputResult } from '../audio/types';

export type VoiceState = 'idle' | 'requesting_permission' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'paused' | 'cancelled' | 'error';
export type VoiceIntent = 'pause' | 'end' | 'quiet' | 'cancel' | 'none';

export type VoiceSnapshot = {
  state: VoiceState;
  transcript: string | null;
  error: string | null;
};

export type VoiceAudioBridge = {
  capture: () => Promise<SpeechInputResult>;
  stopCapture: () => Promise<void>;
  cancelCapture: () => Promise<void>;
  stopSpeech: () => Promise<void>;
  getSnapshot: () => AudioSnapshot;
  subscribe: (listener: (snapshot: AudioSnapshot) => void) => () => void;
};
