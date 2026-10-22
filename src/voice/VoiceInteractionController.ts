import type { SpeechInputResult } from '../audio/types';
import type { VoiceAudioBridge, VoiceIntent, VoiceSnapshot } from './types';

const MAX_TRANSCRIPT_LENGTH = 400;

export function classifyVoiceIntent(text: string): VoiceIntent {
  const value = text.toLocaleLowerCase().replace(/[.!?,]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (/^(?:pause|pause the adventure|pause the investigation|i need a break|i'm tired|im tired)$/.test(value)) return 'pause';
  if (/^(?:end|end the adventure|end the investigation|stop the adventure|finish for now|i want to go home)$/.test(value)) return 'end';
  if (/^(?:be quiet|stay quiet|stop talking|stop speaking|give me silence|quiet for a while|silence)$/.test(value)) return 'quiet';
  if (/^(?:cancel|never mind|stop listening|don't listen|do not listen)$/.test(value)) return 'cancel';
  return 'none';
}

export function normalizeVoiceTranscript(text: string): string {
  return text.normalize('NFKC').replace(/[\s\u200B]+/gu, ' ').trim().slice(0, MAX_TRANSCRIPT_LENGTH);
}

type VoiceCallbacks = {
  submitTranscript: (text: string) => Promise<void>;
  lifecycleIntent: (intent: Exclude<VoiceIntent, 'none'>) => Promise<void>;
  isSessionActive: () => boolean;
};

/** Coordinates one capture → transcript → existing planner → existing TTS exchange. */
export class VoiceInteractionController {
  private snapshot: VoiceSnapshot = { state: 'idle', transcript: null, error: null };
  private readonly listeners = new Set<(snapshot: VoiceSnapshot) => void>();
  private readonly unsubscribeAudio: () => void;
  private active = false;
  private generation = 0;

  constructor(private readonly audio: VoiceAudioBridge, private readonly callbacks: VoiceCallbacks) {
    this.unsubscribeAudio = audio.subscribe((audioSnapshot) => {
      if (!this.active) return;
      if (audioSnapshot.state === 'user_listening') this.publish({ state: 'listening', error: null });
      else if (audioSnapshot.state === 'ai_speaking') this.publish({ state: 'speaking', error: null });
      else if (audioSnapshot.state === 'error') this.publish({ state: 'error', error: audioSnapshot.error ?? 'Audio interaction failed.' });
    });
  }

  getSnapshot = (): VoiceSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: VoiceSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(): Promise<void> {
    if (this.active || !this.callbacks.isSessionActive()) return;
    this.active = true;
    const generation = ++this.generation;
    this.publish({ state: 'requesting_permission', transcript: null, error: null });
    try {
      const result = await this.audio.capture();
      if (!this.active || generation !== this.generation) return;
      await this.handleResult(result, generation);
    } catch {
      if (this.active && generation === this.generation) this.fail('Voice interaction could not start. Try again or use text input.');
    }
  }

  async stopListening(): Promise<void> {
    if (!this.active) return;
    this.publish({ state: 'transcribing', error: null });
    await this.audio.stopCapture();
  }

  async cancel(): Promise<void> {
    if (!this.active) return;
    ++this.generation;
    this.active = false;
    await this.callbacks.lifecycleIntent('cancel');
    await this.audio.cancelCapture();
    await this.audio.stopSpeech();
    this.publish({ state: 'cancelled', error: null });
    this.publish({ state: 'idle', error: null });
  }

  dispose(): void {
    this.active = false;
    ++this.generation;
    this.unsubscribeAudio();
    this.listeners.clear();
  }

  private async handleResult(result: SpeechInputResult, generation: number): Promise<void> {
    if (result.type === 'cancelled') {
      this.active = false;
      this.publish({ state: 'cancelled', error: null });
      this.publish({ state: 'idle', error: null });
      return;
    }
    if (result.type === 'unavailable') {
      this.active = false;
      this.fail(result.reason);
      return;
    }
    const transcript = normalizeVoiceTranscript(result.text);
    if (!transcript) {
      this.active = false;
      this.fail('No clear speech was detected. Try again somewhere quiet.');
      return;
    }
    this.publish({ state: 'thinking', transcript, error: null });
    const intent = classifyVoiceIntent(transcript);
    if (intent !== 'none') {
      await this.callbacks.lifecycleIntent(intent);
      if (generation === this.generation) {
        this.active = false;
        this.publish({ state: 'idle', transcript, error: null });
      }
      return;
    }
    try {
      await this.callbacks.submitTranscript(transcript);
      if (!this.active || generation !== this.generation) return;
      await this.waitForAudioSettled(generation);
      if (this.active && generation === this.generation) {
        this.active = false;
        this.publish({ state: 'idle', transcript, error: null });
      }
    } catch {
      if (this.active && generation === this.generation) {
        this.active = false;
        this.fail('The Detective could not answer. You can retry or continue with the mission.');
      }
    }
  }

  private async waitForAudioSettled(generation: number): Promise<void> {
    if (!this.active || generation !== this.generation) return;
    const current = this.audio.getSnapshot().state;
    if (current !== 'ai_speaking' && current !== 'processing') return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { unsubscribe(); resolve(); }, 120_000);
      const unsubscribe = this.audio.subscribe((snapshot) => {
        if (snapshot.state !== 'ai_speaking' && snapshot.state !== 'processing') {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      });
    });
  }

  private fail(error: string): void {
    this.active = false;
    this.publish({ state: 'error', error });
  }

  private publish(update: Partial<VoiceSnapshot>): void {
    const next: VoiceSnapshot = { ...this.snapshot, ...update };
    this.snapshot = next;
    for (const listener of this.listeners) {
      try { listener(next); } catch { /* UI subscribers cannot break the voice loop. */ }
    }
  }
}
