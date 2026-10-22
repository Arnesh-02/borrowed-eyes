import { detectiveFacts } from '../data/detectiveFacts';
import type { AIRequest } from './AIProvider';
import { eligibleMissions, isClosingRequest, missionActionFor, remainingSeconds } from './request';
import type { MissionAction } from './request';
import type { AIResponse } from './responseSchema';

const missionIntroductions: Record<MissionAction, string> = {
  observation_mission: 'The ordinary has a suspiciously good alibi. Another clue for the notebook.',
  listening_mission: 'Even the background deserves a chapter in this case.',
  movement_mission: 'A change of pace for the case. Your comfort has the final word.',
  breathing_mission: 'An optional pause belongs in every case. Your comfort has the final word.',
};

// No network, randomness, clock, catalogue import, state mutation, or completion
// inference. MissionEngine's supplied choice order is the only selection order.
export function createFallbackResponse(request: AIRequest): AIResponse {
  if (isClosingRequest(request)) {
    return { action: 'session_closing', spokenText: 'Case notes filed. Thank you for lending this suspicious little adventure your attention.' };
  }
  if (request.sessionStatus === 'paused') {
    return { action: 'conversation', spokenText: 'The case can wait. Curiosity is patient when it has to be.' };
  }
  if (request.sessionStatus === 'idle') {
    return { action: 'conversation', spokenText: 'Every good case begins with a little curiosity. Ready when you are.' };
  }
  if (request.interactionMode === 'response') {
    return {
      action: 'conversation',
      spokenText: request.userResponse.trim()
        ? 'An intriguing report. What feels most puzzling about it?'
        : 'No explanation required. The case still has room for a little mystery.',
    };
  }
  if (request.currentMission && !request.allowMissionChange) {
    return { action: 'conversation', spokenText: 'That clue can keep its secrets a little longer. What is your theory?' };
  }
  const mission = eligibleMissions(request)[0];
  const action = mission ? missionActionFor(mission) : null;
  if (mission && action) {
    return { action, spokenText: missionIntroductions[action], missionId: mission.id };
  }
  const previousAction = request.recentActions[request.recentActions.length - 1];
  if (!request.currentMission && previousAction !== 'quiet_interval' && remainingSeconds(request) >= 10) {
    return { action: 'quiet_interval', spokenText: 'Even mysteries can have a quiet chapter.', durationSeconds: 10 };
  }
  if (previousAction !== 'character_fact') {
    const index = (request.completedMissionIds.length + request.skippedMissionIds.length) % detectiveFacts.length;
    const fact = detectiveFacts[index];
    return { action: 'character_fact', spokenText: fact.spokenText, factId: fact.id };
  }
  return {
    action: 'story',
    spokenText: 'In this fictional case, a misplaced bookmark had the most convincing alibi. The notebook remains unconvinced.',
  };
}
