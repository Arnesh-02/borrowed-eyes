import type { Mission } from '../types/mission';
import type { AIRequest } from './AIProvider';
import { AI_LIMITS } from './limits';

export const MISSION_ACTION_TYPES = Object.freeze({
  observation_mission: 'observe',
  listening_mission: 'listen',
  movement_mission: 'move',
  breathing_mission: 'breathe',
} as const);

export type MissionAction = keyof typeof MISSION_ACTION_TYPES;

export function missionActionFor(mission: Mission): MissionAction | null {
  switch (mission.type) {
    case 'observe': return 'observation_mission';
    case 'listen': return 'listening_mission';
    case 'move': return 'movement_mission';
    case 'breathe': return 'breathing_mission';
    default: return null;
  }
}

export function remainingSeconds(request: AIRequest): number {
  return Math.max(0, Math.floor(request.sessionDurationSeconds - request.elapsedSeconds));
}

export function isClosingRequest(request: AIRequest): boolean {
  return request.interactionMode === 'closing' || request.sessionStatus === 'completed'
    || (request.sessionStatus === 'running' && remainingSeconds(request) <= 0);
}

export function canSelectMission(request: AIRequest): boolean {
  return request.sessionStatus === 'running' && request.allowMissionChange
    && request.interactionMode !== 'response' && !isClosingRequest(request);
}

const validId = (id: string): boolean => /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id);

function boundedText(text: string, maximum: number): string {
  return text.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, maximum);
}

function snapshotMission(mission: Mission): Mission {
  return Object.freeze({
    id: mission.id,
    type: mission.type,
    instruction: mission.instruction,
    durationSeconds: mission.durationSeconds,
    requiresResponse: mission.requiresResponse,
    difficulty: mission.difficulty,
    completionMessage: mission.completionMessage,
  });
}

export function eligibleMissions(request: AIRequest): Mission[] {
  if (!canSelectMission(request)) return [];
  const used = new Set([...request.completedMissionIds, ...request.skippedMissionIds]);
  const seen = new Set<string>();
  const choices: Mission[] = [];
  for (const mission of request.availableMissions) {
    if (choices.length >= AI_LIMITS.availableMissions) break;
    if (!validId(mission.id) || seen.has(mission.id) || used.has(mission.id) || !missionActionFor(mission)
      || !Number.isFinite(mission.durationSeconds) || mission.durationSeconds <= 0
      || mission.durationSeconds > remainingSeconds(request)
      || (mission.type === 'breathe' && mission.difficulty !== 'gentle')) continue;
    seen.add(mission.id);
    choices.push(mission);
  }
  return choices;
}

// Take a detached snapshot before any await. An engine update or a provider
// cannot mutate the catalogue/permissions against which its reply is validated.
export function boundAIRequest(request: AIRequest): AIRequest {
  const duration = Number.isFinite(request.sessionDurationSeconds)
    ? Math.max(0, Math.min(86400, Math.floor(request.sessionDurationSeconds))) : 0;
  const elapsed = Number.isFinite(request.elapsedSeconds)
    ? Math.max(0, Math.min(duration, Math.floor(request.elapsedSeconds))) : duration;
  const currentMission = request.currentMission ? snapshotMission(request.currentMission) : null;
  const boundedHistory = (ids: string[]) => {
    const recent = ids.slice(-AI_LIMITS.historyIds).filter(validId);
    if (currentMission && ids.includes(currentMission.id) && !recent.includes(currentMission.id)) {
      recent.shift();
      recent.push(currentMission.id);
    }
    return recent;
  };
  const result: AIRequest = {
    characterId: boundedText(request.characterId, 80),
    sessionStatus: request.sessionStatus,
    sessionDurationSeconds: duration,
    elapsedSeconds: elapsed,
    currentMission,
    completedMissionIds: boundedHistory(request.completedMissionIds),
    skippedMissionIds: boundedHistory(request.skippedMissionIds),
    // Eligibility is checked against the FULL history before that history is
    // shortened for the prompt. Old completed/skipped IDs cannot reappear.
    availableMissions: eligibleMissions({ ...request, sessionDurationSeconds: duration, elapsedSeconds: elapsed })
      .map(snapshotMission),
    allowMissionChange: canSelectMission({ ...request, sessionDurationSeconds: duration, elapsedSeconds: elapsed }),
    recentActions: request.recentActions.slice(-AI_LIMITS.recentActions)
      .filter((action) => /^[a-z_]{1,32}$/.test(action)),
    recentTurns: request.recentTurns.slice(-AI_LIMITS.recentTurns)
      .filter((turn) => turn.role === 'user' || turn.role === 'detective')
      .map((turn) => Object.freeze({
        role: turn.role,
        text: boundedText(turn.text, turn.role === 'user' ? AI_LIMITS.userResponse : AI_LIMITS.spokenText),
      })),
    userResponse: boundedText(request.userResponse, AI_LIMITS.userResponse),
    interactionMode: request.interactionMode,
  };
  Object.freeze(result.completedMissionIds);
  Object.freeze(result.skippedMissionIds);
  Object.freeze(result.availableMissions);
  Object.freeze(result.recentActions);
  Object.freeze(result.recentTurns);
  return Object.freeze(result);
}
