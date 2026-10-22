export type MissionType = 'observe' | 'listen' | 'move' | 'breathe' | 'remember' | 'imagine' | 'conversation';
export type MissionDifficulty = 'gentle' | 'curious' | 'challenging';

export type Mission = {
  id: string;
  type: MissionType;
  instruction: string;
  durationSeconds: number;
  requiresResponse: boolean;
  difficulty: MissionDifficulty;
  completionMessage: string;
};

export type MissionOutcome = 'completed' | 'skipped';
export type MissionHistoryEntry = { missionId: string; outcome: MissionOutcome };
