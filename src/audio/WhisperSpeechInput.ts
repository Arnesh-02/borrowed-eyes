import * as DocumentPicker from 'expo-document-picker';
import { AudioModule, type AudioStream, type AudioStreamBuffer } from 'expo-audio';
import type { EventSubscription } from 'expo-modules-core';

import {
  isLocalWhisperModelPath,
  isWhisperModelFileName,
  VOICE_CANCELLED_REASON,
  VOICE_CAPTURE_TOO_SHORT_REASON,
  VOICE_CAPTURE_UNAVAILABLE_REASON,
  VOICE_CHANNELS,
  VOICE_ENCODING,
  VOICE_MAX_CAPTURE_MS,
  VOICE_MAX_PCM_BYTES,
  VOICE_MICROPHONE_DENIED_REASON,
  VOICE_MODEL_INVALID_REASON,
  VOICE_MODEL_PICKER_REASON,
  VOICE_MODEL_REQUIRED_REASON,
  VOICE_NATIVE_UNAVAILABLE_REASON,
  VOICE_NO_SPEECH_REASON,
  VOICE_SAMPLE_RATE,
  VOICE_TRANSCRIPTION_BYTES_PER_SAMPLE,
  VOICE_TRANSCRIPTION_FAILED_REASON,
  VOICE_TRANSCRIPTION_TIMEOUT_REASON,
  VOICE_MIN_CAPTURE_MS,
  WHISPER_MAX_THREADS,
  WHISPER_TRANSCRIPTION_TIMEOUT_MS,
  whisperModelFileNameFromPath,
} from '../config/voice';
import type { SpeechInput, SpeechInputAvailability, SpeechInputResult } from './types';

export interface WhisperSpeechInputOptions {
  /** A local file URI/path for a model already present on the device. */
  modelPath?: string;
  /** Bounded timeout for one local transcription. */
  transcriptionTimeoutMs?: number;
  /** Number of native Whisper CPU threads. Kept modest by default. */
  maxThreads?: number;
}

export interface WhisperStartOptions {
  onStart?: () => void;
  /** Aborting the signal cancels capture and any active local transcription. */
  signal?: AbortSignal;
}

type WhisperTranscribeResult = {
  result: string;
  isAborted: boolean;
};

type WhisperTranscriptionRequest = {
  promise: Promise<WhisperTranscribeResult>;
  stop(): Promise<void>;
};

type WhisperContext = {
  transcribeData(
    data: ArrayBuffer,
    options: { language: string; maxThreads: number },
  ): WhisperTranscriptionRequest;
  release(): Promise<void>;
};

type WhisperModule = {
  initWhisper(options: {
    filePath: string;
    useGpu: boolean;
    useCoreMLIos: boolean;
  }): Promise<WhisperContext>;
};

type TranscriptionRequest = WhisperTranscriptionRequest;

type Capture = {
  stream: AudioStream;
  subscription: EventSubscription | null;
  chunks: Float32Array[];
  totalSamples: number;
  invalidFormat: boolean;
  stopping: boolean;
  cancelled: boolean;
  stopPromise: Promise<void> | null;
  completion: Promise<SpeechInputResult>;
  resolveCompletion: (result: SpeechInputResult) => void;
  cancelPromise: Promise<void>;
  resolveCancel: () => void;
  transcription: TranscriptionRequest | null;
  abortPromise: Promise<void> | null;
  captureTimeout: ReturnType<typeof setTimeout> | null;
  abortCleanup: (() => void) | null;
};

type TranscriptionOutcome =
  | { kind: 'result'; value: WhisperTranscribeResult }
  | { kind: 'timeout' }
  | { kind: 'cancelled' };

type SelectedModel = {
  uri: string;
  name: string;
};

/**
 * Local, one-utterance Whisper input.
 *
 * This adapter deliberately does not create a recorder file. It keeps only
 * bounded int16 PCM chunks until the current utterance is stopped, then passes
 * one ArrayBuffer directly to whisper.rn.
 */
export class WhisperSpeechInput implements SpeechInput {
  private model: SelectedModel | null = null;
  private modelError: string | null = null;
  private context: WhisperContext | null = null;
  private contextModelUri: string | null = null;
  private prepared = false;
  private disposed = false;
  private lifecycleGeneration = 0;
  private preparePromise: Promise<SpeechInputAvailability> | null = null;
  private capture: Capture | null = null;
  private readonly transcriptionTimeoutMs: number;
  private readonly maxThreads: number;

  constructor(options: WhisperSpeechInputOptions | string = {}) {
    const settings = typeof options === 'string' ? { modelPath: options } : options;
    this.transcriptionTimeoutMs = boundTranscriptionTimeout(settings.transcriptionTimeoutMs);
    this.maxThreads = boundWhisperThreads(settings.maxThreads);

    if (settings.modelPath !== undefined) {
      this.setExplicitModel(settings.modelPath);
    }
  }

  getAvailability(): SpeechInputAvailability {
    if (this.disposed) return { available: false, reason: VOICE_CANCELLED_REASON };
    if (this.modelError !== null) return { available: false, reason: this.modelError };
    if (this.model === null) return { available: false, reason: VOICE_MODEL_REQUIRED_REASON };
    return { available: true };
  }

  getModelName(): string | null {
    return this.model?.name ?? null;
  }

  /**
   * Selects a local model through the system picker. The selected URI is kept
   * in memory only; the picker copies it to the app cache for native access.
   */
  async pickModel(): Promise<SpeechInputAvailability> {
    if (this.disposed) return { available: false, reason: VOICE_CANCELLED_REASON };
    if (this.capture !== null) return { available: false, reason: VOICE_CAPTURE_UNAVAILABLE_REASON };
    if (this.preparePromise !== null) return { available: false, reason: VOICE_CAPTURE_UNAVAILABLE_REASON };

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) return this.getAvailability();
      const asset = result.assets[0];
      if (!asset || !isWhisperModelFileName(asset.name) || !isLocalWhisperUri(asset.uri)) {
        return { available: false, reason: VOICE_MODEL_INVALID_REASON };
      }

      this.model = { uri: asset.uri.trim(), name: asset.name.trim() };
      this.modelError = null;
      await this.releaseContext();
      return { available: true };
    } catch {
      return { available: false, reason: VOICE_MODEL_PICKER_REASON };
    }
  }

  /**
   * Loads the selected model and requests microphone access. No permission is
   * requested by construction, getAvailability, or start().
   */
  prepare(): Promise<SpeechInputAvailability> {
    if (this.disposed) return Promise.resolve({ available: false, reason: VOICE_CANCELLED_REASON });
    if (this.preparePromise !== null) return this.preparePromise;

    const generation = ++this.lifecycleGeneration;
    let promise: Promise<SpeechInputAvailability>;
    promise = this.prepareInternal(generation).finally(() => {
      if (this.preparePromise === promise) this.preparePromise = null;
    });
    this.preparePromise = promise;
    return promise;
  }

  /** Starts one bounded capture. The returned promise settles at stop/cancel. */
  start(options: WhisperStartOptions = {}): Promise<SpeechInputResult> {
    if (this.capture !== null) return this.capture.completion;
    if (this.disposed) return Promise.resolve({ type: 'cancelled' });
    if (options.signal?.aborted) return Promise.resolve({ type: 'cancelled' });
    if (!this.prepared || this.context === null) {
      return Promise.resolve({ type: 'unavailable', reason: VOICE_NATIVE_UNAVAILABLE_REASON });
    }

    let stream: AudioStream;
    try {
      const AudioStreamConstructor = (AudioModule as unknown as {
        AudioStream: new (options: { sampleRate: number; channels: number; encoding: string }) => AudioStream;
      }).AudioStream;
      stream = new AudioStreamConstructor({
        sampleRate: VOICE_SAMPLE_RATE,
        channels: VOICE_CHANNELS,
        encoding: VOICE_ENCODING,
      });
    } catch {
      return Promise.resolve({ type: 'unavailable', reason: VOICE_CAPTURE_UNAVAILABLE_REASON });
    }

    const capture = createCapture(stream);
    try {
      capture.subscription = stream.addListener('audioStreamBuffer', (buffer) => {
        this.appendPcm(capture, buffer);
      });
      this.capture = capture;
      capture.captureTimeout = setTimeout(() => {
        void this.stop();
      }, VOICE_MAX_CAPTURE_MS);

      if (options.signal !== undefined) {
        const onAbort = (): void => {
          void this.cancel();
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        capture.abortCleanup = () => options.signal?.removeEventListener('abort', onAbort);
      }

      void this.beginCapture(capture, options.onStart);
      return capture.completion;
    } catch {
      removeCaptureSubscription(capture);
      stopStream(capture);
      return Promise.resolve({ type: 'unavailable', reason: VOICE_CAPTURE_UNAVAILABLE_REASON });
    }
  }

  /** Stops capture, transcribes the current PCM buffer, and settles start(). */
  async stop(): Promise<SpeechInputResult> {
    const capture = this.capture;
    if (capture === null) {
      await this.releaseContext();
      return { type: 'cancelled' };
    }
    if (capture.stopPromise === null) {
      capture.stopPromise = this.finalizeCapture(capture);
    }
    await capture.stopPromise;
    return capture.completion;
  }

  /** Stops capture/transcription, resolves start() as cancelled, and releases Whisper. */
  async cancel(): Promise<void> {
    ++this.lifecycleGeneration;
    const capture = this.capture;
    if (capture !== null) {
      capture.cancelled = true;
      capture.resolveCancel();
      await this.abortTranscription(capture);
      if (capture.stopPromise === null) capture.stopPromise = this.finalizeCapture(capture);
      await capture.stopPromise;
    }

    const preparation = this.preparePromise;
    if (preparation !== null) await preparation.catch(() => undefined);
    await this.releaseContext();
    this.prepared = false;
  }

  /** Permanently disposes this adapter and releases all native resources. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.cancel();
    this.model = null;
    this.modelError = null;
  }

  private setExplicitModel(modelPath: string): void {
    const uri = modelPath.trim();
    if (!isLocalWhisperModelPath(uri)) {
      this.modelError = uri.length === 0 ? VOICE_MODEL_REQUIRED_REASON : VOICE_MODEL_INVALID_REASON;
      return;
    }
    this.model = { uri, name: whisperModelFileNameFromPath(uri) };
    this.modelError = null;
  }

  private async prepareInternal(generation: number): Promise<SpeechInputAvailability> {
    if (this.disposed) return { available: false, reason: VOICE_CANCELLED_REASON };
    const model = this.model;
    if (this.modelError !== null) return { available: false, reason: this.modelError };
    if (model === null) return { available: false, reason: VOICE_MODEL_REQUIRED_REASON };

    try {
      await this.ensureContext(generation, model.uri);
      if (!this.isCurrentGeneration(generation)) {
        await this.releaseContext();
        return { available: false, reason: VOICE_CANCELLED_REASON };
      }

      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        await this.releaseContext();
        return { available: false, reason: VOICE_MICROPHONE_DENIED_REASON };
      }
      if (!this.isCurrentGeneration(generation)) {
        await this.releaseContext();
        return { available: false, reason: VOICE_CANCELLED_REASON };
      }

      this.prepared = true;
      return { available: true };
    } catch {
      this.prepared = false;
      await this.releaseContext();
      return {
        available: false,
        reason: this.isCurrentGeneration(generation)
          ? VOICE_NATIVE_UNAVAILABLE_REASON
          : VOICE_CANCELLED_REASON,
      };
    }
  }

  private async ensureContext(generation: number, modelUri: string): Promise<void> {
    if (this.context !== null && this.contextModelUri === modelUri) return;
    await this.releaseContext();
    if (!this.isCurrentGeneration(generation)) return;

    const whisper = await import('whisper.rn') as unknown as WhisperModule;
    if (!this.isCurrentGeneration(generation)) return;

    const context = await whisper.initWhisper({
      filePath: modelUri,
      useGpu: false,
      useCoreMLIos: false,
    });
    if (!this.isCurrentGeneration(generation)) {
      await context.release();
      return;
    }

    this.context = context;
    this.contextModelUri = modelUri;
  }

  private async beginCapture(capture: Capture, onStart?: () => void): Promise<void> {
    try {
      await capture.stream.start();
    } catch {
      if (this.capture === capture) {
        if (capture.stopPromise === null) capture.stopPromise = this.finalizeCapture(capture);
        await capture.stopPromise;
      }
      return;
    }

    if (!this.isCurrentCapture(capture) || capture.cancelled) return;
    try {
      onStart?.();
    } catch {
      // A UI callback must not leave native capture running in an unhandled state.
    }
  }

  private appendPcm(capture: Capture, buffer: AudioStreamBuffer): void {
    if (!this.isCurrentCapture(capture) || capture.stopping || capture.cancelled) return;
    if (!Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0
      || !Number.isInteger(buffer.channels) || buffer.channels < 1
      || buffer.data.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      capture.invalidFormat = true;
      return;
    }

    const source = new Float32Array(buffer.data);
    const normalized = resampleToMono(source, buffer.sampleRate, buffer.channels);
    const maxSamples = Math.floor(VOICE_MAX_PCM_BYTES / VOICE_TRANSCRIPTION_BYTES_PER_SAMPLE);
    const remaining = maxSamples - capture.totalSamples;
    const sampleCount = Math.min(normalized.length, remaining);
    if (sampleCount > 0) {
      capture.chunks.push(normalized.slice(0, sampleCount));
      capture.totalSamples += sampleCount;
    }

    if (capture.totalSamples >= maxSamples) void this.stop();
  }

  private async finalizeCapture(capture: Capture): Promise<void> {
    let result: SpeechInputResult = { type: 'cancelled' };
    let pcm: ArrayBuffer | null = null;

    try {
       const streamStopped = stopStream(capture);
      if (capture.cancelled) {
        result = { type: 'cancelled' };
      } else if (!streamStopped) {
        result = { type: 'unavailable', reason: VOICE_CAPTURE_UNAVAILABLE_REASON };
      } else if (capture.invalidFormat) {
        result = { type: 'unavailable', reason: VOICE_CAPTURE_UNAVAILABLE_REASON };
      } else {
        pcm = takePcm(capture);
        const minimumSamples = Math.ceil(
          VOICE_SAMPLE_RATE * (VOICE_MIN_CAPTURE_MS / 1_000) * VOICE_CHANNELS,
        );
        if (pcm.byteLength === 0) {
          result = { type: 'unavailable', reason: VOICE_NO_SPEECH_REASON };
        } else if (pcm.byteLength / VOICE_TRANSCRIPTION_BYTES_PER_SAMPLE < minimumSamples) {
          result = { type: 'unavailable', reason: VOICE_CAPTURE_TOO_SHORT_REASON };
        } else {
          result = await this.transcribeCapture(capture, pcm);
        }
      }
    } catch {
      result = capture.cancelled
        ? { type: 'cancelled' }
        : { type: 'unavailable', reason: VOICE_TRANSCRIPTION_FAILED_REASON };
    } finally {
      if (pcm !== null) new Uint8Array(pcm).fill(0);
      clearCapture(capture);
      await this.releaseContext();
      this.prepared = false;
      if (this.capture === capture) this.capture = null;
      capture.resolveCompletion(result);
    }
  }

  private async transcribeCapture(capture: Capture, pcm: ArrayBuffer): Promise<SpeechInputResult> {
    if (capture.cancelled) return { type: 'cancelled' };
    const context = this.context;
    if (context === null) return { type: 'unavailable', reason: VOICE_NATIVE_UNAVAILABLE_REASON };

    let request: TranscriptionRequest;
    try {
      request = context.transcribeData(pcm, {
        language: 'en',
        maxThreads: this.maxThreads,
      });
      capture.transcription = request;
    } catch {
      return { type: 'unavailable', reason: VOICE_TRANSCRIPTION_FAILED_REASON };
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeout = new Promise<TranscriptionOutcome>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: 'timeout' }), this.transcriptionTimeoutMs);
      });
      const outcome = await Promise.race<TranscriptionOutcome>([
        request.promise.then((value) => ({ kind: 'result', value })),
        timeout,
        capture.cancelPromise.then(() => ({ kind: 'cancelled' as const })),
      ]);

      if (outcome.kind === 'cancelled' || capture.cancelled) {
        await this.abortTranscription(capture);
        return { type: 'cancelled' };
      }
      if (outcome.kind === 'timeout') {
        await this.abortTranscription(capture);
        return { type: 'unavailable', reason: VOICE_TRANSCRIPTION_TIMEOUT_REASON };
      }
      if (outcome.value.isAborted) return { type: 'cancelled' };

      const text = outcome.value.result.trim();
      return text.length === 0
        ? { type: 'unavailable', reason: VOICE_NO_SPEECH_REASON }
        : { type: 'transcript', text };
    } catch {
      return capture.cancelled
        ? { type: 'cancelled' }
        : { type: 'unavailable', reason: VOICE_TRANSCRIPTION_FAILED_REASON };
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      capture.transcription = null;
      capture.abortPromise = null;
    }
  }

  private async abortTranscription(capture: Capture): Promise<void> {
    if (capture.abortPromise !== null) {
      await capture.abortPromise;
      return;
    }
    const request = capture.transcription;
    if (request === null) return;

    capture.abortPromise = request.stop().catch(() => undefined);
    await capture.abortPromise;
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this.disposed && generation === this.lifecycleGeneration;
  }

  private isCurrentCapture(capture: Capture): boolean {
    return this.capture === capture;
  }

  private async releaseContext(): Promise<void> {
    const context = this.context;
    this.context = null;
    this.contextModelUri = null;
    this.prepared = false;
    if (context === null) return;
    try {
      await context.release();
    } catch {
      // Native release is best effort; the JS reference is already cleared.
    }
  }
}

function createCapture(stream: AudioStream): Capture {
  let resolveCompletion: (result: SpeechInputResult) => void = () => undefined;
  let resolveCancel: () => void = () => undefined;
  const completion = new Promise<SpeechInputResult>((resolve) => {
    resolveCompletion = resolve;
  });
  const cancelPromise = new Promise<void>((resolve) => {
    resolveCancel = resolve;
  });

  return {
    stream,
    subscription: null,
    chunks: [],
    totalSamples: 0,
    invalidFormat: false,
    stopping: false,
    cancelled: false,
    stopPromise: null,
    completion,
    resolveCompletion,
    cancelPromise,
    resolveCancel,
    transcription: null,
    abortPromise: null,
    captureTimeout: null,
    abortCleanup: null,
  };
}

function takePcm(capture: Capture): ArrayBuffer {
  const pcm = new Int16Array(capture.totalSamples);
  let offset = 0;
  for (const chunk of capture.chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[index] ?? 0));
      pcm[offset + index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    }
    offset += chunk.length;
  }
  clearPcm(capture);
  return pcm.buffer;
}

function clearPcm(capture: Capture): void {
  capture.chunks.length = 0;
  capture.totalSamples = 0;
}

function clearCapture(capture: Capture): void {
  if (capture.captureTimeout !== null) clearTimeout(capture.captureTimeout);
  capture.captureTimeout = null;
  capture.abortCleanup?.();
  capture.abortCleanup = null;
  removeCaptureSubscription(capture);
  clearPcm(capture);
}

function removeCaptureSubscription(capture: Capture): void {
  capture.subscription?.remove();
  capture.subscription = null;
}

function stopStream(capture: Capture): boolean {
  capture.stopping = true;
  removeCaptureSubscription(capture);
  try {
    capture.stream.stop();
  } catch {
    return false;
  }
  return true;
}

function isLocalWhisperUri(uri: string): boolean {
  const trimmed = uri.trim();
  return trimmed.length > 0 && !/^https?:\/\//iu.test(trimmed);
}

/** Converts each native buffer to mono 16 kHz float PCM for whisper.rn. */
function resampleToMono(source: Float32Array, sourceRate: number, channels: number): Float32Array {
  const sourceFrames = Math.floor(source.length / channels);
  if (sourceFrames === 0) return new Float32Array(0);

  const targetFrames = Math.max(1, Math.round(sourceFrames * VOICE_SAMPLE_RATE / sourceRate));
  const mono = new Float32Array(targetFrames);
  for (let targetIndex = 0; targetIndex < targetFrames; targetIndex += 1) {
    const sourcePosition = targetIndex * sourceRate / VOICE_SAMPLE_RATE;
    const leftFrame = Math.min(sourceFrames - 1, Math.floor(sourcePosition));
    const rightFrame = Math.min(sourceFrames - 1, leftFrame + 1);
    const fraction = sourcePosition - leftFrame;
    let left = 0;
    let right = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      left += source[leftFrame * channels + channel] ?? 0;
      right += source[rightFrame * channels + channel] ?? 0;
    }
    mono[targetIndex] = (left / channels) + ((right / channels) - (left / channels)) * fraction;
  }
  return mono;
}

function boundTranscriptionTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return WHISPER_TRANSCRIPTION_TIMEOUT_MS;
  return Math.max(1_000, Math.min(120_000, Math.floor(timeoutMs)));
}

function boundWhisperThreads(maxThreads: number | undefined): number {
  if (maxThreads === undefined || !Number.isFinite(maxThreads)) return WHISPER_MAX_THREADS;
  return Math.max(1, Math.min(4, Math.floor(maxThreads)));
}
