import * as Speech from 'expo-speech';

import { AudioOperationError, SPEECH_TIMEOUT_MS } from './audioErrors';
import type { SpeechOutput } from './types';

interface Utterance {
  generation: number;
  text: string;
  onStart?: () => void;
  resolve: () => void;
  reject: (error: AudioOperationError) => void;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

/** System text-to-speech. Expo's global speech queue is intentionally never exposed. */
export class ExpoSpeechOutput implements SpeechOutput {
  private generation = 0;
  private current: Utterance | null = null;
  private stops: Promise<void> = Promise.resolve();
  private volume = 1;

  speak(text: string, options?: { onStart?: () => void }): Promise<void> {
    const generation = ++this.generation;
    this.cancelCurrent();

    return new Promise<void>((resolve, reject) => {
      const utterance: Utterance = {
        generation,
        text: text.trim(),
        onStart: options?.onStart,
        resolve,
        reject,
        timer: null,
        settled: false,
      };
      this.current = utterance;
      // This includes time waiting for a previous native stop, not just speaking time.
      utterance.timer = setTimeout(() => {
        if (!this.isCurrent(utterance)) return;
        this.finish(utterance, new AudioOperationError('speech_timeout'));
        void this.stopNative(generation).catch(() => {});
      }, SPEECH_TIMEOUT_MS);

      void this.begin(utterance).catch((error: unknown) => {
        if (!this.isCurrent(utterance)) return;
        this.finish(
          utterance,
          error instanceof AudioOperationError ? error : new AudioOperationError('speech_failed'),
        );
        void this.stopNative(generation).catch(() => {});
      });
    });
  }

  stop(): Promise<void> {
    const generation = ++this.generation;
    // Cancellation is synchronous even if a previous Speech.stop() is still unresolved.
    this.cancelCurrent();
    return this.stopNative(generation);
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  }

  private async begin(utterance: Utterance): Promise<void> {
    await this.stopNative(utterance.generation);
    if (!this.isCurrent(utterance)) return;
    if (!utterance.text) {
      this.finish(utterance);
      return;
    }
    if (utterance.text.length > Speech.maxSpeechInputLength) {
      throw new AudioOperationError('speech_too_long');
    }

    Speech.speak(utterance.text, {
      volume: this.volume,
      useApplicationAudioSession: false,
      onStart: () => {
        if (!this.isCurrent(utterance)) return;
        try {
          utterance.onStart?.();
        } catch {
          // A subscriber must not escape through a native event callback.
        }
      },
      onDone: () => this.finish(utterance),
      onStopped: () => this.finish(utterance),
      onError: () => {
        if (!this.isCurrent(utterance)) return;
        this.finish(utterance, new AudioOperationError('speech_failed'));
        void this.stopNative(utterance.generation).catch(() => {});
      },
    });
  }

  private stopNative(generation: number): Promise<void> {
    const operation = this.stops.then(async () => {
      // A newer request enqueues its own stop; an obsolete stop cannot cancel its speech.
      if (generation !== this.generation) return;
      try {
        await Speech.stop();
      } catch {
        throw new AudioOperationError('speech_stop_failed');
      }
    });
    this.stops = operation.catch(() => {});
    return operation;
  }

  private isCurrent(utterance: Utterance): boolean {
    return this.current === utterance && utterance.generation === this.generation && !utterance.settled;
  }

  private cancelCurrent(): void {
    if (this.current) this.finish(this.current);
  }

  private finish(utterance: Utterance, error?: AudioOperationError): void {
    if (utterance.settled) return;
    utterance.settled = true;
    if (utterance.timer) clearTimeout(utterance.timer);
    utterance.timer = null;
    if (this.current === utterance) this.current = null;
    if (error) utterance.reject(error);
    else utterance.resolve();
  }
}
