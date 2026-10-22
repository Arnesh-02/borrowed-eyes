import type { MissionHistoryEntry } from '../types/mission';
import type { SessionState } from '../types/session';
import type { AIRequest } from '../ai/AIProvider';
import { AIPlanner } from '../ai/AIPlanner';
import { validateAIResponse } from '../ai/responseSchema';
import type { AIPlanResult } from '../ai/AIPlanner';
import { MissionEngine } from './MissionEngine';
import { detectiveMissions } from '../data/missions';

export function sessionClock(state: SessionState, now: number) {
  const budget = secondsFromMinutes(state.durationMinutes) * 1000;
  const elapsedMs = Math.min(budget, state.accumulatedMs + (
    state.status === 'running' && state.runningSince !== null
      ? Math.max(0, now - state.runningSince) : 0
  ));
  return { elapsedMs, elapsedSeconds: Math.floor(elapsedMs / 1000), remainingSeconds: Math.ceil((budget - elapsedMs) / 1000) };
}

/** The existing experience boundary owns catalogue selection and AI permissions. */
export class ExperienceEngine {
  readonly missions = new MissionEngine(detectiveMissions);
  private readonly offlinePlanner = new AIPlanner(null);

  constructor(private readonly planner: AIPlanner) {}

  context(state: SessionState, mode: AIRequest['interactionMode'], userResponse = ''): AIRequest {
    return {
      characterId: state.selectedCharacter?.id ?? 'detective',
      sessionStatus: state.status,
      sessionDurationSeconds: secondsFromMinutes(state.durationMinutes),
      elapsedSeconds: state.elapsedSeconds,
      currentMission: this.missions.getById(state.currentMissionId),
      completedMissionIds: [...state.completedMissionIds],
      skippedMissionIds: [...state.skippedMissionIds],
      availableMissions: this.missions.available(state.missionHistory),
      allowMissionChange: mode === 'start' || mode === 'mission_complete' || mode === 'mission_skip',
      recentTurns: state.recentTurns.map((turn) => ({ ...turn })),
      recentActions: [...state.recentActions],
      userResponse,
      interactionMode: mode,
    };
  }

  plan(state: SessionState, context: AIRequest, signal: AbortSignal): Promise<AIPlanResult> {
    return (state.aiEnabled ? this.planner : this.offlinePlanner).plan(context, signal);
  }

  apply(state: SessionState, context: AIRequest, plan: AIPlanResult): Partial<SessionState> {
    // Re-check against NOW, not just the snapshot sent across the network.
    const response = validateAIResponse(plan.response, {
      ...this.context(state, context.interactionMode), allowMissionChange: context.allowMissionChange,
    });
    const mission = 'missionId' in response
      ? this.missions.next(state.missionHistory, response.missionId)
      : this.missions.getById(state.currentMissionId);
    const introducesMission = context.allowMissionChange;
    const spokenText = [
      context.interactionMode === 'start' ? state.selectedCharacter?.introduction : null,
      plan.failure ? 'My informant is unavailable. We will work with what we have.' : response.spokenText,
      introducesMission ? mission?.instruction : null,
    ].filter(Boolean).join(' ');
    return {
      currentMissionId: mission?.id ?? null,
      spokenText,
      responseText: plan.failure ? 'My informant is unavailable. We will work with what we have.' : response.spokenText,
      responseSource: plan.source,
      plannerNotice: plan.failure ?? null,
      quietUntilElapsed: response.action === 'quiet_interval' ? state.elapsedSeconds + response.durationSeconds : null,
      recentTurns: [...state.recentTurns, { role: 'detective' as const, text: response.spokenText }].slice(-6),
      recentActions: [...state.recentActions, response.action].slice(-6),
    };
  }
}

export const secondsFromMinutes = (minutes: number): number => minutes * 60;
export const formatDuration = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60).toString().padStart(2, '0')}:${(safeSeconds % 60).toString().padStart(2, '0')}`;
};
export const completionRate = (history: MissionHistoryEntry[]): number => {
  if (history.length === 0) return 0;
  return Math.round((history.filter((entry) => entry.outcome === 'completed').length / history.length) * 100);
};
