const { detectiveMissions } = require('../src/data/missions.ts');

exports.makeRequest = (changes = {}) => ({
  characterId: 'detective', sessionStatus: 'running', sessionDurationSeconds: 1200, elapsedSeconds: 10,
  currentMission: detectiveMissions[0], completedMissionIds: [], skippedMissionIds: [],
  availableMissions: detectiveMissions, allowMissionChange: false,
  recentActions: [], recentTurns: [], userResponse: 'I found an old blue door.', interactionMode: 'response',
  ...changes,
});
exports.flush = () => new Promise((resolve) => setImmediate(resolve));
exports.deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
