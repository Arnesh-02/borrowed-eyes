import {
  AudioOperationError,
  audioErrorMessage,
  CAPTURE_TIMEOUT_MS,
  QUIET_MUSIC_VOLUME,
  SPEECH_TIMEOUT_MS,
} from './audioErrors';
import type { AudioErrorCode } from './audioErrors';
import { TextFallbackSpeechInput } from './TextFallbackSpeechInput';
import type {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

interface SpeechRequest {
  session: number;
  generation: number;
  started: boolean;
  completion: ReturnType<typeof deferred<void>>;
  timer: ReturnType<typeof setTimeout> | null;
}

interface CaptureRequest {
  session: number;
  started: boolean;
  transcribing: boolean;
  startRequested: boolean;
  preparation: ReturnType<typeof deferred<SpeechInputAvailability>>;
  completion: ReturnType<typeof deferred<SpeechInputResult>>;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Own one controller per app root. No Expo, React, or store imports are needed to test it.
 * Public commands resolve after cancellation/failure; failures are exposed in the snapshot.
 */
export class AudioController {
  private session = 0;
  private sessionId: string | null = null;
  private track: AmbientTrack | null = null;
  private paused = false;
  private processing = false;
  private starting = false;
  private error: string | null = null;
  private snapshot: AudioSnapshot = { state: 'idle', error: null };
  private musicSnapshot: MusicSnapshot = { playing: false, error: null };
  private readonly listeners = new Set<(snapshot: AudioSnapshot) => void>();
  private unsubscribeMusic: (() => void) | null = null;
  private operations: Promise<void> = Promise.resolve();
  private startPromise: Promise<void> = Promise.resolve();
  private speechGeneration = 0;
  private speechRequest: SpeechRequest | null = null;
  private captureRequest: CaptureRequest | null = null;
  private utteranceSessionId: string | null = null;
  private readonly utterances = new Map<string, Promise<void>>();

  constructor(
    private readonly speech: SpeechOutput,
    private readonly music: MusicOutput,
    private readonly input: SpeechInput = new TextFallbackSpeechInput(),
  ) {}

  getSnapshot = (): AudioSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: AudioSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  start(sessionId: string, track: AmbientTrack | null): Promise<void> {
    if (this.sessionId === sessionId && this.sameTrack(track) && !this.error) return this.startPromise;

    const session = ++this.session;
    this.cancelSpeechRequest();
    this.cancelCaptureRequest();
    this.detachMusic();
    this.sessionId = sessionId;
    this.track = track;
    this.paused = false;
    this.processing = false;
    this.starting = true;
    this.error = null;
    this.musicSnapshot = { playing: false, error: null };
    if (this.utteranceSessionId !== sessionId) {
      this.utterances.clear();
      this.utteranceSessionId = sessionId;
    }
    this.publish();

    this.startPromise = this.enqueue(session, async () => {
      // All old stops/releases complete before a new player or utterance can be started.
      await this.stopAdapters(true);
      if (!this.isSession(session)) return;
      await this.music.setVolume(QUIET_MUSIC_VOLUME);
      if (!this.isSession(session)) return;
      this.unsubscribeMusic = this.music.subscribe((snapshot) => {
        if (!this.isSession(session)) return;
        this.acceptMusicSnapshot(snapshot);
      });
      await this.music.load(track);
      if (!this.isSession(session)) return;
      this.starting = false;
      this.acceptMusicSnapshot(this.music.getSnapshot());
      await this.reconcileMusic(session);
    }, (error) => {
      this.starting = false;
      this.cancelSpeechRequest();
      this.cancelCaptureRequest();
      this.recordError(error, 'audio_failed');
      void this.enqueue(session, () => this.stopAdapters(true), (cleanupError) => {
        this.recordError(cleanupError, 'audio_stop_failed');
      });
    });
    return this.startPromise;
  }

  speak(utteranceId: string, text: string): Promise<void> {
    if (this.sessionId === null || this.paused || !text.trim()) return Promise.resolve();
    const duplicate = this.utterances.get(utteranceId);
    if (duplicate) return duplicate;

    this.cancelSpeechRequest();
    this.cancelCaptureRequest();
    this.error = null;
    const request: SpeechRequest = {
      session: this.session,
      generation: this.speechGeneration,
      started: false,
      completion: deferred<void>(),
      timer: null,
    };
    this.speechRequest = request;
    this.utterances.set(utteranceId, request.completion.promise);
    request.timer = setTimeout(() => {
      this.finishSpeech(request, new AudioOperationError('speech_timeout'));
    }, SPEECH_TIMEOUT_MS);
    this.publish();

    void this.enqueue(request.session, async () => {
      if (!this.isSpeech(request)) return;
      await this.music.pause();
      if (!this.isSpeech(request)) return;
      this.acceptMusicSnapshot(this.music.getSnapshot());
      await this.speech.stop();
      if (!this.isSpeech(request)) return;
      await this.input.cancel();
      if (!this.isSpeech(request)) return;
      await this.speech.setVolume(1);
      if (!this.isSpeech(request)) return;

      const playback = this.speech.speak(text, {
        onStart: () => {
          if (!this.isSpeech(request)) return;
          request.started = true;
          this.publish();
        },
      });
      // The command queue must stay free to stop speech while this promise is pending.
      void playback.then(
        () => this.finishSpeech(request),
        (error: unknown) => this.finishSpeech(request, error ?? new AudioOperationError('speech_failed')),
      );
    }, (error) => this.finishSpeech(request, error ?? new AudioOperationError('speech_failed')));
    return request.completion.promise;
  }

  stopSpeech(): Promise<void> {
    const session = this.session;
    this.cancelSpeechRequest();
    const generation = this.speechGeneration;
    this.publish();
    return this.enqueue(session, async () => {
      await this.speech.stop();
      await this.reconcileMusic(session);
    }, (error) => {
      if (generation === this.speechGeneration) this.recordError(error, 'speech_stop_failed');
    });
  }

  setProcessing(processing: boolean): Promise<void> {
    if (this.sessionId === null) return Promise.resolve();
    const session = this.session;
    this.processing = processing;
    if (processing) {
      this.cancelSpeechRequest();
      this.cancelCaptureRequest();
    }
    this.publish();
    return this.enqueue(session, async () => {
      if (processing) {
        await this.music.pause();
        if (!this.isSession(session)) return;
        this.acceptMusicSnapshot(this.music.getSnapshot());
        await this.speech.stop();
        if (!this.isSession(session)) return;
        await this.input.cancel();
      }
      await this.reconcileMusic(session);
    });
  }

  pause(): Promise<void> {
    if (this.sessionId === null) return Promise.resolve();
    const session = this.session;
    this.paused = true;
    this.cancelSpeechRequest();
    this.cancelCaptureRequest();
    this.publish();
    // Expo Speech.pause is unavailable on Android. Cancel rather than pretending to pause.
    return this.enqueue(session, async () => {
      await this.stopAdapters(false);
      if (this.isSession(session)) this.acceptMusicSnapshot(this.music.getSnapshot());
    });
  }

  resume(): Promise<void> {
    if (this.sessionId === null) return Promise.resolve();
    const session = this.session;
    this.paused = false;
    this.error = null;
    this.publish();
    return this.enqueue(session, () => this.reconcileMusic(session));
  }

  stop(): Promise<void> {
    const session = ++this.session;
    this.sessionId = null;
    this.starting = false;
    this.paused = false;
    this.processing = false;
    this.error = null;
    this.track = null;
    this.cancelSpeechRequest();
    this.cancelCaptureRequest();
    this.detachMusic();
    this.musicSnapshot = { playing: false, error: null };
    this.publish();
    return this.enqueue(session, () => this.stopAdapters(true), (error) => {
      this.recordError(error, 'audio_stop_failed');
    });
  }

  getInputAvailability(): SpeechInputAvailability {
    try {
      return this.input.getAvailability();
    } catch {
      return { available: false, reason: audioErrorMessage(null, 'input_failed') };
    }
  }

  /** Holds ambient audio while an available input prepares; never implies listening. */
  prepareCapture(): Promise<SpeechInputAvailability> {
    if (this.sessionId === null || this.paused) {
      return Promise.resolve({ available: false, reason: 'Resume the session before starting voice input.' });
    }
    const availability = this.getInputAvailability();
    if (!availability.available) return Promise.resolve(availability);
    if (this.captureRequest) return this.captureRequest.preparation.promise;

    this.cancelSpeechRequest();
    this.processing = false;
    this.error = null;
    const request: CaptureRequest = {
      session: this.session,
      started: false,
      transcribing: false,
      startRequested: false,
      preparation: deferred<SpeechInputAvailability>(),
      completion: deferred<SpeechInputResult>(),
      timer: null,
    };
    this.captureRequest = request;
    request.timer = setTimeout(() => {
      this.finishCapture(request, { type: 'cancelled' }, new AudioOperationError('input_timeout'));
    }, CAPTURE_TIMEOUT_MS);
    this.publish();

    void this.enqueue(request.session, async () => {
      if (!this.isCapture(request)) return;
      await this.music.pause();
      if (!this.isCapture(request)) return;
      this.acceptMusicSnapshot(this.music.getSnapshot());
      await this.speech.stop();
      if (!this.isCapture(request)) return;
      await this.input.cancel();
      if (!this.isCapture(request)) return;
      // A permission/preparation prompt must not block a later input.cancel().
      void this.input.prepare().then((result) => {
        if (!this.isCapture(request)) return;
        if (result.available) request.preparation.resolve(result);
        else this.finishCapture(request, { type: 'unavailable', reason: result.reason });
      }, (error: unknown) => this.finishCapture(request, { type: 'cancelled' }, error ?? new AudioOperationError('input_failed')));
    }, (error) => this.finishCapture(request, { type: 'cancelled' }, error ?? new AudioOperationError('input_failed')));
    return request.preparation.promise;
  }

  async capture(): Promise<SpeechInputResult> {
    const preparation = this.prepareCapture();
    const request = this.captureRequest;
    const availability = await preparation;
    if (!request) {
      return availability.available
        ? { type: 'cancelled' }
        : { type: 'unavailable', reason: availability.reason };
    }
    if (!this.isCapture(request)) return request.completion.promise;
    if (!availability.available) return { type: 'unavailable', reason: availability.reason };

    if (!request.startRequested) {
      request.startRequested = true;
      void this.enqueue(request.session, async () => {
        if (!this.isCapture(request)) return;
        void this.input.start({
          onStart: () => {
            if (!this.isCapture(request)) return;
            request.started = true;
            this.publish();
          },
        }).then(
          (result) => this.finishCapture(request, result),
          (error: unknown) => this.finishCapture(request, { type: 'cancelled' }, error ?? new AudioOperationError('input_failed')),
        );
      }, (error) => this.finishCapture(request, { type: 'cancelled' }, error ?? new AudioOperationError('input_failed')));
    }
    return request.completion.promise;
  }

  cancelCapture(): Promise<void> {
    const session = this.session;
    this.cancelCaptureRequest();
    this.publish();
    return this.enqueue(session, async () => {
      await this.input.cancel();
      await this.reconcileMusic(session);
    });
  }

  /** Finalize an actual microphone capture. Text fallback adapters do not expose this. */
  stopCapture(): Promise<void> {
    const session = this.session;
    const request = this.captureRequest;
    const input = this.input;
    if (!request || !input.stop) return Promise.resolve();
    request.transcribing = true;
    this.publish();
    return this.enqueue(session, async () => {
      await input.stop?.();
    }, (error) => {
      if (this.isCapture(request)) this.finishCapture(request, { type: 'unavailable', reason: audioErrorMessage(error, 'input_failed') }, error);
    });
  }

  selectInputModel(): Promise<SpeechInputAvailability> {
    if (!this.input.pickModel) return Promise.resolve({ available: false, reason: 'Local Whisper is not included in this build.' });
    return this.input.pickModel();
  }

  getInputModelName(): string | null {
    const modelInput = this.input as SpeechInput & { getModelName?: () => string | null };
    return modelInput.getModelName?.() ?? null;
  }

  private finishSpeech(request: SpeechRequest, error?: unknown): void {
    if (!this.isSpeech(request)) return;
    this.cancelSpeechRequest();
    if (error !== undefined) this.recordError(error, 'speech_failed');
    else this.publish();
    void this.enqueue(request.session, async () => {
      if (error !== undefined) await this.speech.stop();
      await this.reconcileMusic(request.session);
    });
  }

  private finishCapture(request: CaptureRequest, result: SpeechInputResult, error?: unknown): void {
    if (!this.isCapture(request)) return;
    this.captureRequest = null;
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    request.preparation.resolve({
      available: false,
      reason: result.type === 'unavailable' ? result.reason : 'Voice input has ended.',
    });
    request.completion.resolve(result);
    if (error !== undefined) this.recordError(error, 'input_failed');
    else this.publish();
    void this.enqueue(request.session, async () => {
      await this.input.cancel();
      await this.reconcileMusic(request.session);
    });
  }

  private cancelSpeechRequest(): void {
    ++this.speechGeneration;
    const request = this.speechRequest;
    this.speechRequest = null;
    if (!request) return;
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    request.completion.resolve();
  }

  private cancelCaptureRequest(): void {
    const request = this.captureRequest;
    this.captureRequest = null;
    if (!request) return;
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    request.preparation.resolve({ available: false, reason: 'Voice input was cancelled.' });
    request.completion.resolve({ type: 'cancelled' });
  }

  private async stopAdapters(release: boolean): Promise<void> {
    // Dispatch all cleanup even if one service stalls. The outer queue serializes reuse.
    const results = await Promise.allSettled([
      () => this.speech.stop(),
      () => this.input.cancel(),
      () => release ? this.music.stop() : this.music.pause(),
    ].map(async (stop) => stop()));
    if (results.some((result) => result.status === 'rejected')) {
      throw new AudioOperationError('audio_stop_failed');
    }
  }

  private async reconcileMusic(session: number): Promise<void> {
    if (!this.isSession(session) || this.sessionId === null) return;
    if (this.canPlayMusic()) {
      await this.music.setVolume(QUIET_MUSIC_VOLUME);
      if (!this.isSession(session)) return;
      // A pause/speech request may have arrived while setVolume was pending.
      if (this.canPlayMusic()) await this.music.play();
      else await this.music.pause();
    } else {
      await this.music.pause();
    }
    if (this.isSession(session)) this.acceptMusicSnapshot(this.music.getSnapshot());
  }

  private canPlayMusic(): boolean {
    return this.track !== null && !this.paused && !this.processing && !this.starting
      && !this.speechRequest && !this.captureRequest && !this.error;
  }

  private acceptMusicSnapshot(snapshot: MusicSnapshot): void {
    this.musicSnapshot = snapshot;
    if (snapshot.error) this.error = audioErrorMessage(null, 'music_failed');
    this.publish();
  }

  private recordError(error: unknown, fallback: AudioErrorCode): void {
    this.error = audioErrorMessage(error, fallback);
    this.publish();
  }

  private enqueue(
    session: number,
    task: () => Promise<void>,
    onError: (error: unknown) => void = (error) => this.recordError(error, 'audio_failed'),
  ): Promise<void> {
    const operation = this.operations.then(async () => {
      if (!this.isSession(session)) return;
      try {
        await task();
      } catch (error) {
        if (this.isSession(session)) onError(error);
      }
    });
    // Keep every fire-and-forget command handled, including an exceptional adapter callback.
    this.operations = operation.catch(() => {
      if (this.isSession(session)) this.recordError(null, 'audio_failed');
    });
    return this.operations;
  }

  private isSession(session: number): boolean {
    return session === this.session;
  }

  private isSpeech(request: SpeechRequest): boolean {
    return this.isSession(request.session) && this.speechRequest === request
      && request.generation === this.speechGeneration;
  }

  private isCapture(request: CaptureRequest): boolean {
    return this.isSession(request.session) && this.captureRequest === request;
  }

  private sameTrack(track: AmbientTrack | null): boolean {
    return this.track === track || (this.track !== null && track !== null
      && this.track.source === track.source && this.track.title === track.title && this.track.license === track.license);
  }

  private detachMusic(): void {
    const unsubscribe = this.unsubscribeMusic;
    this.unsubscribeMusic = null;
    try { unsubscribe?.(); } catch { /* Session guards still invalidate old listeners. */ }
  }

  private publish(): void {
    let state: AudioState;
    if (this.error) state = 'error';
    else if (this.sessionId === null) state = 'idle';
    else if (this.paused) state = 'paused';
    else if (this.speechRequest?.started) state = 'ai_speaking';
    else if (this.captureRequest?.transcribing) state = 'processing';
    else if (this.captureRequest?.started) state = 'user_listening';
    else if (this.starting || this.processing || this.speechRequest || this.captureRequest) state = 'processing';
    else if (this.track && this.musicSnapshot.playing) state = 'music_playing';
    else state = 'idle';

    if (this.snapshot.state === state && this.snapshot.error === this.error) return;
    this.snapshot = { state, error: this.error };
    for (const listener of this.listeners) {
      try { listener(this.snapshot); } catch { /* Isolate external subscribers. */ }
    }
  }
}
