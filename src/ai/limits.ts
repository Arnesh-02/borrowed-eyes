export const AI_LIMITS = Object.freeze({
  recentTurns: 6,
  recentActions: 6,
  userResponse: 400,
  spokenText: 500,
  availableMissions: 32,
  historyIds: 64,
  responseJson: 4096,
  plannerTimeoutMs: 30000,
});

export const QUIET_INTERVAL_SECONDS = Object.freeze([10, 20, 30] as const);
