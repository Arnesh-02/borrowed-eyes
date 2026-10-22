const { GemmaProvider } = require('../src/ai/GemmaProvider.ts');
const { getAIConfig } = require('../src/config/ai.ts');
const { detectiveMissions } = require('../src/data/missions.ts');

// Deliberately call the real provider, NOT the fallback planner. A failure exits
// nonzero instead of treating a local canned response as a successful Gemma test.
async function main() {
  const config = getAIConfig();
  const response = await new GemmaProvider(config).generateResponse({
    characterId: 'detective', sessionStatus: 'running', sessionDurationSeconds: 1200,
    elapsedSeconds: 180, currentMission: detectiveMissions[0], completedMissionIds: [],
    skippedMissionIds: [], availableMissions: detectiveMissions, allowMissionChange: false,
    recentActions: [], recentTurns: [], userResponse: 'I found an old blue door.', interactionMode: 'response',
  });
  console.log(`Live Gemma response validated (${config.model}): ${response.action}`);
  // Fixed synthetic input only; never print a real person's observations.
  console.log(response.spokenText);
}
main().catch(() => {
  console.error('Live Gemma check failed. Verify endpoint, Ollama >=0.6, installed model, and docs/phase-2-development.md.');
  process.exitCode = 1;
});
