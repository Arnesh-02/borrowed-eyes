import type { Mission } from '../types/mission';
import type { AIResponse } from './responseSchema';

export type AIRequest = {
  characterId: string;
  sessionStatus: 'idle' | 'running' | 'paused' | 'completed';
  sessionDurationSeconds: number;
  elapsedSeconds: number;
  currentMission: Mission | null;
  completedMissionIds: string[];
  skippedMissionIds: string[];
  availableMissions: Mission[];
  allowMissionChange: boolean;
  recentActions: string[];
  recentTurns: { role: 'user' | 'detective'; text: string }[];
  userResponse: string;
  interactionMode: 'start' | 'response' | 'mission_complete' | 'mission_skip' | 'closing';
};

export interface AIProvider {
  generateResponse(request: AIRequest, signal?: AbortSignal): Promise<AIResponse>;
}

export type { AIResponse } from './responseSchema';
