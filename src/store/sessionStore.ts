import { create } from 'zustand';
import { AIPlanner } from '../ai/AIPlanner';
import { createAIProvider } from '../ai/GemmaProvider';
import type { AIProvider, AIRequest } from '../ai/AIProvider';
import { isAbortError } from '../ai/errors';
import type { AudioController } from '../audio/AudioController';
import { detectiveAmbientTrack } from '../audio/tracks';
import { ExperienceEngine, secondsFromMinutes, sessionClock } from '../engine/ExperienceEngine';
import type { Character } from '../types/character';
import type { MissionOutcome } from '../types/mission';
import type { SessionState } from '../types/session';
import { VoiceInteractionController } from '../voice/VoiceInteractionController';
import type { VoiceIntent } from '../voice/types';

type SessionActions = {
  selectCharacter: (character: Character | null) => void;
  setDuration: (minutes: 10 | 20 | 30) => void;
  setAIEnabled: (enabled: boolean) => void;
  setSpeechEnabled: (enabled: boolean) => void;
  startSession: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  updateTimer: (now?: number) => void;
  completeMission: (expectedMissionId: string) => void;
  skipMission: (expectedMissionId: string) => void;
  submitResponse: (text: string) => Promise<void>;
  startVoiceInteraction: () => void;
  stopVoiceInteraction: () => void;
  cancelVoiceInteraction: () => void;
  chooseVoiceModel: () => Promise<void>;
  quietSession: () => void;
  requestClosing: () => void;
  cancelInteraction: () => void;
  replayInstruction: () => void;
  stopSpeech: () => void;
  endSession: () => void;
  resetSession: () => void;
  attachAudio: (controller: AudioController) => () => void;
};

const initialState = (): SessionState => ({
  selectedCharacter: null, durationMinutes: 20, status: 'idle', sessionId: null,
  sessionStartTime: null, runningSince: null, accumulatedMs: 0,
  elapsedSeconds: 0, remainingSeconds: secondsFromMinutes(20), currentMissionId: null,
  completedMissionIds: [], skippedMissionIds: [], missionHistory: [], lastCompletionMessage: null,
  aiEnabled: false, speechEnabled: true, recentTurns: [], recentActions: [], spokenText: '', responseText: '',
  responseSource: null, plannerPending: false, plannerNotice: null,
  quietUntilElapsed: null, closingDelivered: false, audio: { state: 'idle', error: null },
  voice: { state: 'idle', transcript: null, error: null }, voiceModelName: null,
});

/** One application store. The factory injects clocks/providers for regression tests. */
export function createSessionStore(options: { provider?: AIProvider | null; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const experience = new ExperienceEngine(new AIPlanner(
    options.provider === undefined ? createAIProvider() : options.provider,
  ));
  let audio: AudioController | null = null;
  let request: AbortController | null = null;
  let requestVersion = 0;
  let sessionVersion = 0;
  let lastMissionActionMs = -Infinity;
  let voice: VoiceInteractionController | null = null;

  return create<SessionState & SessionActions>((set, get) => {
    const invalidate = () => {
      ++requestVersion;
      request?.abort();
      request = null;
    };

    const finish = () => {
      invalidate();
      void audio?.stop();
      void voice?.cancel();
      set({
        status: 'completed', runningSince: null, plannerPending: false,
        recentTurns: [], recentActions: [], spokenText: '', responseText: '', quietUntilElapsed: null,
        plannerNotice: null, audio: { state: 'idle', error: null },
      });
    };

    const interact = async (mode: AIRequest['interactionMode'], text = ''): Promise<void> => {
      get().updateTimer();
      const state = get();
      if (state.status !== 'running' || state.plannerPending) return;
      invalidate();
      const version = requestVersion;
      const sessionId = state.sessionId;
      const expectedMissionId = state.currentMissionId;
      const controller = new AbortController();
      request = controller;
      // Build the request before remembering the input, so it is not sent twice.
      const context = experience.context(state, mode, text);
      set({
        plannerPending: true, plannerNotice: null, quietUntilElapsed: null,
        recentTurns: text ? [...state.recentTurns, { role: 'user' as const, text }].slice(-6) : state.recentTurns,
      });
      void audio?.setProcessing(true);
      const current = () => version === requestVersion && get().sessionId === sessionId
        && get().status === 'running' && get().currentMissionId === expectedMissionId;
      try {
        const result = await experience.plan(state, context, controller.signal);
        if (!current()) return;
        get().updateTimer();
        if (!current()) return;
        const update = experience.apply(get(), context, result);
        const quietSeconds = update.quietUntilElapsed !== null && update.quietUntilElapsed !== undefined
          ? update.quietUntilElapsed - get().elapsedSeconds : null;
        const willSpeak = get().speechEnabled && audio !== null && Boolean(update.spokenText);
        set({ ...update, quietUntilElapsed: willSpeak ? null : update.quietUntilElapsed ?? null, plannerPending: false });
        request = null;
        // Queue speech before releasing processing, so ambient music cannot
        // briefly resume between inference and the first spoken word.
        if (willSpeak && audio && update.spokenText) {
          const playback = audio.speak(`${sessionId}:${version}`, update.spokenText);
          void playback.then(() => {
            // Silence starts AFTER speech, not while a long prompt is still playing.
            if (quietSeconds === null || version !== requestVersion || get().sessionId !== sessionId || get().status !== 'running') return;
            get().updateTimer();
            if (get().status === 'running') set({ quietUntilElapsed: Math.min(
              secondsFromMinutes(get().durationMinutes), get().elapsedSeconds + quietSeconds,
            ) });
          });
        }
        void audio?.setProcessing(false);
      } catch (error) {
        if (!current()) return;
        set({ plannerPending: false, plannerNotice: isAbortError(error) ? null : 'The case is still here. Continue with the local mission.' });
        request = null;
        void audio?.setProcessing(false);
      }
    };

    const advance = (expectedMissionId: string, outcome: MissionOutcome) => {
      get().updateTimer();
      const state = get();
      const time = now();
      if (state.status !== 'running' || state.currentMissionId !== expectedMissionId
        || !expectedMissionId || time - lastMissionActionMs < 600) return;
      lastMissionActionMs = time;
      invalidate();
      void audio?.stopSpeech();
      const history = [...state.missionHistory, { missionId: expectedMissionId, outcome }];
      const next = experience.missions.next(history);
      set({
        currentMissionId: next?.id ?? null, missionHistory: history,
        completedMissionIds: outcome === 'completed' ? [...state.completedMissionIds, expectedMissionId] : state.completedMissionIds,
        skippedMissionIds: outcome === 'skipped' ? [...state.skippedMissionIds, expectedMissionId] : state.skippedMissionIds,
        lastCompletionMessage: outcome === 'completed' ? experience.missions.getById(expectedMissionId)?.completionMessage ?? null : null,
        plannerPending: false, quietUntilElapsed: null, spokenText: '', responseText: '',
      });
      if (!next) finish();
      else void interact(outcome === 'completed' ? 'mission_complete' : 'mission_skip');
    };

    const handleVoiceIntent = async (intent: Exclude<VoiceIntent, 'none'>): Promise<void> => {
      if (intent === 'pause') { get().pauseSession(); return; }
      if (intent === 'end') { get().endSession(); return; }
      if (intent === 'cancel') { get().cancelInteraction(); return; }
      if (intent === 'quiet') { get().quietSession(); }
    };

    return {
      ...initialState(),
      selectCharacter: (character) => { if (get().status === 'idle') set({ selectedCharacter: character }); },
      setDuration: (minutes) => {
        if (get().status === 'idle' && [10, 20, 30].includes(minutes)) {
          set({ durationMinutes: minutes, remainingSeconds: secondsFromMinutes(minutes) });
        }
      },
      setAIEnabled: (enabled) => { if (get().status === 'idle') set({ aiEnabled: enabled }); },
      setSpeechEnabled: (enabled) => {
        set({ speechEnabled: enabled });
        if (!enabled) void audio?.stopSpeech();
      },
      startSession: () => {
        const state = get();
        if (state.status !== 'idle' || !state.selectedCharacter) return;
        invalidate();
        lastMissionActionMs = -Infinity;
        const start = now();
        const sessionId = `${start}-${++sessionVersion}`;
        set({
          status: 'running', sessionId, sessionStartTime: start, runningSince: start,
          currentMissionId: experience.missions.next([])?.id ?? null,
          remainingSeconds: secondsFromMinutes(state.durationMinutes),
        });
        void audio?.start(sessionId, detectiveAmbientTrack);
        void interact('start');
      },
      completeMission: (id) => advance(id, 'completed'),
      skipMission: (id) => advance(id, 'skipped'),
      submitResponse: async (text) => {
        const input = text.trim();
        if (!input || input.length > 400) return;
        await interact('response', input);
      },
      startVoiceInteraction: () => {
        if (!voice) {
          set({ voice: { state: 'error', transcript: null, error: 'Voice input is not attached in this build. Use text input.' } });
          return;
        }
        void voice.start();
      },
      stopVoiceInteraction: () => { void voice?.stopListening(); },
      cancelVoiceInteraction: () => { void voice?.cancel(); },
      chooseVoiceModel: async () => {
        if (!audio) {
          set({ voice: { state: 'error', transcript: null, error: 'Voice input is not attached in this build.' } });
          return;
        }
        const result = await audio.selectInputModel();
        set({ voiceModelName: audio.getInputModelName(), voice: result.available
          ? { state: 'idle', transcript: null, error: null }
          : { state: 'error', transcript: null, error: result.reason } });
      },
      quietSession: () => {
        const state = get();
        if (state.status !== 'running') return;
        get().cancelInteraction();
        set({ quietUntilElapsed: Math.min(secondsFromMinutes(state.durationMinutes), state.elapsedSeconds + 30), responseText: '', spokenText: '', plannerNotice: null });
      },
      cancelInteraction: () => {
        invalidate();
        set({ plannerPending: false, quietUntilElapsed: null });
        void audio?.setProcessing(false);
        void audio?.stopSpeech();
      },
      requestClosing: () => {
        const state = get();
        if (state.status !== 'running' || state.remainingSeconds > 45 || state.remainingSeconds < 10
          || state.closingDelivered || state.plannerPending || state.quietUntilElapsed !== null
          || state.audio.state === 'ai_speaking' || state.audio.state === 'processing') return;
        set({ closingDelivered: true });
        void interact('closing');
      },
      replayInstruction: () => {
        const state = get();
        if (state.status !== 'running' || state.plannerPending || !state.speechEnabled) return;
        const text = state.spokenText || experience.missions.getById(state.currentMissionId)?.instruction;
        if (text) void audio?.speak(`${state.sessionId}:replay:${++requestVersion}`, text);
      },
      stopSpeech: () => { void audio?.stopSpeech(); },
      pauseSession: () => {
        get().updateTimer();
        const state = get();
        if (state.status !== 'running') return;
        const clock = sessionClock(state, now());
        invalidate();
        void voice?.cancel();
        set({ status: 'paused', accumulatedMs: clock.elapsedMs, elapsedSeconds: clock.elapsedSeconds,
          remainingSeconds: clock.remainingSeconds, runningSince: null, plannerPending: false });
        void audio?.setProcessing(false);
        void audio?.pause();
      },
      resumeSession: () => {
        if (get().status !== 'paused') return;
        set({ status: 'running', runningSince: now() });
        void audio?.resume();
      },
      updateTimer: (time = now()) => {
        const state = get();
        if (state.status !== 'running') return;
        const clock = sessionClock(state, time);
        const quietUntilElapsed = state.quietUntilElapsed !== null && clock.elapsedSeconds >= state.quietUntilElapsed
          ? null : state.quietUntilElapsed;
        if (state.elapsedSeconds !== clock.elapsedSeconds || state.remainingSeconds !== clock.remainingSeconds
          || state.quietUntilElapsed !== quietUntilElapsed) {
          set({ elapsedSeconds: clock.elapsedSeconds, remainingSeconds: clock.remainingSeconds, quietUntilElapsed });
        }
        if (clock.remainingSeconds === 0) {
          set({ accumulatedMs: clock.elapsedMs });
          finish();
        }
      },
      endSession: () => {
        get().updateTimer();
        const state = get();
        if (state.status !== 'running' && state.status !== 'paused') return;
        const clock = sessionClock(state, now());
        void voice?.cancel();
        set({ accumulatedMs: clock.elapsedMs, elapsedSeconds: clock.elapsedSeconds, remainingSeconds: clock.remainingSeconds });
        finish();
      },
      resetSession: () => {
        if (get().status === 'running' || get().status === 'paused') return;
        invalidate();
        void audio?.stop();
        set(initialState());
      },
      attachAudio: (controller) => {
        audio = controller;
        voice = new VoiceInteractionController(controller, {
          isSessionActive: () => {
            const current = get();
            return current.status === 'running' && !current.plannerPending;
          },
          submitTranscript: (text) => get().submitResponse(text),
          lifecycleIntent: handleVoiceIntent,
        });
        const unsubscribeVoice = voice.subscribe((snapshot) => {
          if (audio === controller) set({ voice: snapshot });
        });
        const unsubscribe = controller.subscribe((snapshot) => {
          if (audio === controller && (get().status === 'running' || get().status === 'paused')) set({ audio: snapshot });
        });
        const state = get();
        if (state.sessionId && (state.status === 'running' || state.status === 'paused')) {
          void controller.start(state.sessionId, detectiveAmbientTrack);
          if (state.status === 'paused') void controller.pause();
        }
        return () => {
          unsubscribeVoice();
          voice?.dispose();
          voice = null;
          unsubscribe();
          if (audio === controller) { get().pauseSession(); audio = null; }
          void controller.stop();
        };
      },
    };
  });
}

export const useSessionStore = createSessionStore();
