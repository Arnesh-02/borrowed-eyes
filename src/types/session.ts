import type { MissionHistoryEntry } from './mission';
import type { Character } from './character';
import type { AIRequest } from '../ai/AIProvider';
import type { AudioSnapshot } from '../audio/types';
import type { VoiceSnapshot } from '../voice/types';

export type SessionStatus = 'idle' | 'running' | 'paused' | 'completed';

export type SessionState = {
  selectedCharacter: Character | null;
  durationMinutes: 10 | 20 | 30;
  status: SessionStatus;
  sessionId: string | null;
  sessionStartTime: number | null;
  runningSince: number | null;
  accumulatedMs: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  currentMissionId: string | null;
  completedMissionIds: string[];
  skippedMissionIds: string[];
  missionHistory: MissionHistoryEntry[];
  lastCompletionMessage: string | null;
  aiEnabled: boolean;
  speechEnabled: boolean;
  recentTurns: AIRequest['recentTurns'];
  recentActions: string[];
  spokenText: string;
  responseText: string;
  responseSource: 'gemma' | 'fallback' | null;
  plannerPending: boolean;
  plannerNotice: string | null;
  quietUntilElapsed: number | null;
  closingDelivered: boolean;
  audio: AudioSnapshot;
  voice: VoiceSnapshot;
  voiceModelName: string | null;
};
