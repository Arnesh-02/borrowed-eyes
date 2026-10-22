const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionStore } = require('../src/store/sessionStore.ts');
const { detective } = require('../src/characters/detective.ts');
const { detectiveMissions } = require('../src/data/missions.ts');
const { completionRate } = require('../src/engine/ExperienceEngine.ts');
const { flush, deferred } = require('./fixtures.cjs');
const { createAudioRig } = require('./audio-fixtures.cjs');

function setup(provider = null) {
  let clock = 1000;
  const store = createSessionStore({ provider, now: () => clock });
  store.getState().selectCharacter(detective);
  store.getState().setDuration(10);
  return { store, advance: (ms) => { clock += ms; store.getState().updateTimer(); } };
}

test('setup does not start timer; fractional ticks accumulate accurately and pause excludes time', async () => {
  const { store, advance } = setup();
  advance(2000);
  assert.equal(store.getState().elapsedSeconds, 0);
  store.getState().startSession();
  await flush();
  const originalStart = store.getState().sessionStartTime;
  for (let i = 0; i < 10; i++) advance(150);
  assert.equal(store.getState().elapsedSeconds, 1);
  assert.equal(store.getState().remainingSeconds, 599);
  store.getState().pauseSession();
  advance(60000);
  assert.equal(store.getState().elapsedSeconds, 1);
  store.getState().resumeSession();
  advance(500);
  assert.equal(store.getState().elapsedSeconds, 2);
  assert.equal(store.getState().remainingSeconds, 598);
  assert.equal(store.getState().sessionStartTime, originalStart);
  store.getState().endSession();
});

test('completion/skip IDs and cooldown block duplicate rapid actions; paused missions cannot advance', async () => {
  const { store, advance } = setup();
  store.getState().startSession();
  await flush();
  const first = store.getState().currentMissionId;
  store.getState().completeMission(first);
  store.getState().completeMission(first);
  store.getState().completeMission(store.getState().currentMissionId);
  assert.equal(store.getState().completedMissionIds.length, 1);
  advance(700);
  await flush();
  store.getState().skipMission(store.getState().currentMissionId);
  assert.equal(store.getState().skippedMissionIds.length, 1);
  store.getState().pauseSession();
  advance(2000);
  const current = store.getState().currentMissionId;
  store.getState().completeMission(current);
  assert.equal(store.getState().currentMissionId, current);
  store.getState().endSession();
  assert.equal(completionRate(store.getState().missionHistory), 50);
});

test('all missions exhaust without repetition; summary remains a genuine snapshot after reset', async () => {
  const { store, advance } = setup();
  store.getState().startSession();
  const seen = new Set();
  for (let i = 0; i < detectiveMissions.length; i++) {
    await flush();
    const id = store.getState().currentMissionId;
    assert.ok(id && !seen.has(id));
    seen.add(id);
    advance(1000);
    store.getState().completeMission(id);
  }
  const summary = store.getState();
  assert.equal(summary.status, 'completed');
  assert.equal(summary.completedMissionIds.length, detectiveMissions.length);
  assert.equal(summary.elapsedSeconds, detectiveMissions.length);
  store.getState().resetSession();
  assert.equal(store.getState().missionHistory.length, 0);
  assert.equal(summary.completedMissionIds.length, detectiveMissions.length);
});

test('Gemma can choose a mission but cannot complete it; a reply keeps the current mission', async () => {
  const requests = [];
  const provider = { generateResponse: async (request) => {
    requests.push(request);
    return request.interactionMode === 'start'
      ? { action: 'listening_mission', missionId: 'sound-map', spokenText: 'Even the background deserves a chapter in this case.' }
      : { action: 'conversation', spokenText: 'You mentioned a blue door. What makes it suspicious?' };
  } };
  const { store } = setup(provider);
  store.getState().setAIEnabled(true);
  store.getState().startSession();
  await flush();
  assert.equal(store.getState().currentMissionId, 'sound-map');
  assert.equal(store.getState().responseSource, 'gemma');
  await store.getState().submitResponse('I found a blue door.');
  assert.equal(store.getState().currentMissionId, 'sound-map');
  assert.equal(store.getState().completedMissionIds.length, 0);
  assert.equal(requests[1].allowMissionChange, false);
  assert.equal(requests[1].userResponse, 'I found a blue door.');
  store.getState().endSession();
});

test('AI failure leaves deterministic progression available', async () => {
  const { store, advance } = setup({ generateResponse: async () => { throw Error('offline'); } });
  store.getState().setAIEnabled(true);
  store.getState().startSession();
  await flush();
  assert.equal(store.getState().responseSource, 'fallback');
  const id = store.getState().currentMissionId;
  advance(1500);
  store.getState().completeMission(id);
  await flush();
  assert.notEqual(store.getState().currentMissionId, id);
  assert.equal(store.getState().completedMissionIds.length, 1);
  store.getState().endSession();
});

test('pause/end cancel pending requests, stop audio, and reject late responses after restart', async (t) => {
  const pending = [];
  const provider = { generateResponse: (context, signal) => {
    const task = deferred(); pending.push({ ...task, signal, context }); return task.promise;
  } };
  const { store } = setup(provider);
  const rig = createAudioRig();
  const detach = store.getState().attachAudio(rig.audio);
  t.after(() => { store.getState().endSession(); detach(); });
  store.getState().setAIEnabled(true);
  store.getState().startSession();
  await flush();
  store.getState().pauseSession();
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ action: 'conversation', spokenText: 'An obsolete reply.' });
  await flush();
  assert.equal(store.getState().spokenText, '');
  assert.equal(rig.audio.getSnapshot().state, 'paused');
  store.getState().resumeSession();
  const reply = store.getState().submitResponse('A door.');
  await flush();
  store.getState().endSession();
  assert.equal(pending[1].signal.aborted, true);
  const oldId = store.getState().sessionId;
  store.getState().resetSession();
  store.getState().selectCharacter(detective);
  store.getState().startSession(); // AI is opt-in again, so immediate local response
  await flush();
  assert.notEqual(store.getState().sessionId, oldId);
  const text = store.getState().spokenText;
  pending[1].resolve({ action: 'conversation', spokenText: 'A stale old response.' });
  await reply;
  await flush();
  assert.equal(store.getState().spokenText, text);
  assert.ok(rig.events.every(([event, value]) => event !== 'speech' || !value.includes('obsolete') && !value.includes('stale')));
});

test('timeout completes exactly; no post-session ticks/actions alter summary; private memory clears', async () => {
  const { store, advance } = setup();
  store.getState().startSession();
  await flush();
  for (let i = 0; i < 10; i++) await store.getState().submitResponse(`Clue ${i}`);
  assert.equal(store.getState().recentTurns.length, 6);
  advance(900000);
  assert.equal(store.getState().elapsedSeconds, 600);
  assert.equal(store.getState().remainingSeconds, 0);
  assert.equal(store.getState().status, 'completed');
  assert.equal(store.getState().recentTurns.length, 0);
  const summary = store.getState();
  store.getState().completeMission(summary.currentMissionId);
  store.getState().resumeSession();
  store.getState().updateTimer();
  assert.equal(store.getState(), summary);
});

test('quiet intervals use the same paused clock; no unsolicited follow-up request at expiry', async () => {
  let calls = 0;
  const { store, advance } = setup({ generateResponse: async () => {
    calls++;
    return { action: 'quiet_interval', spokenText: 'Even mysteries can have a quiet chapter.', durationSeconds: 20 };
  } });
  store.getState().setAIEnabled(true);
  store.getState().startSession();
  await flush();
  assert.equal(store.getState().quietUntilElapsed, 20);
  advance(5000);
  store.getState().pauseSession();
  advance(60000);
  assert.equal(store.getState().quietUntilElapsed, 20);
  store.getState().resumeSession();
  advance(15000);
  assert.equal(store.getState().quietUntilElapsed, null);
  assert.equal(calls, 1);
  store.getState().endSession();
});

test('closing proposal may speak once but cannot end the session', async () => {
  const { store, advance } = setup();
  store.getState().startSession();
  await flush();
  advance(560000);
  store.getState().requestClosing();
  await flush();
  assert.equal(store.getState().recentActions.at(-1), 'session_closing');
  assert.equal(store.getState().status, 'running');
  const text = store.getState().spokenText;
  store.getState().requestClosing();
  await flush();
  assert.equal(store.getState().spokenText, text);
  store.getState().endSession();
});

test('quiet time begins after speech, and the first mission is still announced', async (t) => {
  const { store, advance } = setup({ generateResponse: async () => ({
    action: 'quiet_interval', spokenText: 'Even mysteries can have a quiet chapter.', durationSeconds: 20,
  }) });
  const rig = createAudioRig();
  const detach = store.getState().attachAudio(rig.audio);
  t.after(() => { store.getState().endSession(); detach(); });
  store.getState().setAIEnabled(true);
  store.getState().startSession();
  await flush();
  assert.equal(store.getState().quietUntilElapsed, null);
  assert.ok(rig.events.some(([event, text]) => event === 'speech' && text.includes(detectiveMissions[0].instruction)));
  advance(8000);
  rig.finish();
  await flush();
  assert.equal(store.getState().quietUntilElapsed, 28);
});
