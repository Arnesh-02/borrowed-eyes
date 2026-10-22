import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer, AudioStatus } from 'expo-audio';

import { AudioOperationError, audioErrorMessage, QUIET_MUSIC_VOLUME } from './audioErrors';
import type { AmbientTrack, MusicOutput, MusicSnapshot } from './types';

const MUSIC_READY_TIMEOUT_MS = 15_000;

export class ExpoMusicOutput implements MusicOutput {
  private player: AudioPlayer | null = null;
  private removeStatusListener: (() => void) | null = null;
  private generation = 0;
  private operations: Promise<void> = Promise.resolve();
  private desiredPlaying = false;
  private volume = QUIET_MUSIC_VOLUME;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: MusicSnapshot = { playing: false, error: null };
  private readonly listeners = new Set<(snapshot: MusicSnapshot) => void>();

  getSnapshot = (): MusicSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: MusicSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  load(track: AmbientTrack | null): Promise<void> {
    const generation = ++this.generation;
    this.desiredPlaying = false;
    this.clearTimer();
    return this.enqueue(generation, async () => {
      this.releasePlayer();
      if (generation !== this.generation) return;
      this.publish({ playing: false, error: null });
      if (!track) return;
      if (!Number.isInteger(track.source) || track.source <= 0 || !track.title.trim() || !track.license.trim()) {
        throw new AudioOperationError('music_invalid_track');
      }

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: false,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
      });
      if (generation !== this.generation) return;

      const player = createAudioPlayer(track.source, { updateInterval: 500 });
      this.player = player;
      try {
        player.loop = true;
        player.volume = this.volume;
        const subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (generation !== this.generation || player !== this.player) return;
          this.receiveStatus(player, status);
        });
        this.removeStatusListener = () => subscription.remove();
        this.readPlayback(player);
      } catch (error) {
        try { this.releasePlayer(); } catch { /* Preserve the setup failure. */ }
        throw error;
      }
    });
  }

  play(): Promise<void> {
    const generation = this.generation;
    this.desiredPlaying = true;
    return this.enqueue(generation, async () => {
      if (generation !== this.generation || !this.desiredPlaying || !this.player) return;
      const player = this.player;
      player.volume = this.volume;
      player.play();
      this.readPlayback(player);
      if (!this.snapshot.playing && !this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          if (generation !== this.generation || player !== this.player || !this.desiredPlaying) return;
          this.desiredPlaying = false;
          try { player.pause(); } catch { /* Report the readiness error below. */ }
          this.publish({ playing: false, error: audioErrorMessage(null, 'music_timeout') });
        }, MUSIC_READY_TIMEOUT_MS);
      }
    });
  }

  pause(): Promise<void> {
    const generation = this.generation;
    this.desiredPlaying = false;
    this.clearTimer();
    return this.enqueue(generation, async () => {
      if (generation !== this.generation || !this.player) return;
      this.player.pause();
      this.readPlayback(this.player);
    });
  }

  stop(): Promise<void> {
    const generation = ++this.generation;
    this.desiredPlaying = false;
    this.clearTimer();
    return this.enqueue(generation, async () => {
      this.releasePlayer();
      if (generation === this.generation) this.publish({ playing: false, error: null });
    });
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : QUIET_MUSIC_VOLUME;
    if (this.player) this.player.volume = this.volume;
  }

  private receiveStatus(player: AudioPlayer, status: AudioStatus): void {
    try {
      if (!this.desiredPlaying && status.playing) player.pause();
      if (status.error) {
        this.desiredPlaying = false;
        this.clearTimer();
        player.pause();
        this.publish({ playing: false, error: audioErrorMessage(null, 'music_failed') });
        return;
      }
      const playing = status.isLoaded && status.playing && !status.isBuffering;
      if (playing) this.clearTimer();
      // Status updates can arrive after pause. Read the player again in that case.
      if (!this.desiredPlaying) this.readPlayback(player);
      else this.publish({ playing, error: null });
    } catch {
      this.publish({ playing: false, error: audioErrorMessage(null, 'music_failed') });
    }
  }

  private readPlayback(player: AudioPlayer): void {
    const playing = player.isLoaded && player.playing && !player.isBuffering;
    if (playing) this.clearTimer();
    this.publish({ playing, error: null });
  }

  private releasePlayer(): void {
    this.clearTimer();
    const removeStatusListener = this.removeStatusListener;
    this.removeStatusListener = null;
    const player = this.player;
    this.player = null;
    let failed = false;
    try { removeStatusListener?.(); } catch { failed = true; }
    try {
      player?.pause();
    } catch {
      failed = true;
    } finally {
      try { player?.release(); } catch { failed = true; }
    }
    if (failed) throw new AudioOperationError('music_failed');
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private enqueue(generation: number, task: () => Promise<void>): Promise<void> {
    const operation = this.operations.then(task).catch((error: unknown) => {
      if (generation === this.generation) {
        this.publish({ playing: false, error: audioErrorMessage(error, 'music_failed') });
      }
      throw error instanceof AudioOperationError ? error : new AudioOperationError('music_failed');
    });
    this.operations = operation.catch(() => {});
    return operation;
  }

  private publish(snapshot: MusicSnapshot): void {
    if (snapshot.playing === this.snapshot.playing && snapshot.error === this.snapshot.error) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* Isolate external subscribers. */ }
    }
  }
}
