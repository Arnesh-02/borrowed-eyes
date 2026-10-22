const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VoiceInteractionController, classifyVoiceIntent, normalizeVoiceTranscript } = require('../src/voice/VoiceInteractionController.ts');
const { deferred, flush } = require('./fixtures.cjs');

function createVoiceRig() {
  const captures = [];
  const listeners = new Set();
  const calls = { capture: 0, stopCapture: 0, cancelCapture: 0, stopSpeech: 0 };
  let snapshot = { state: 'idle', error: null };

  const audio = {
    capture: () => {
      calls.capture++;
      const task = deferred();
      captures.push(task);
      return task.promise;
    },
    stopCapture: async () => { calls.stopCapture++; },
    cancelCapture: async () => { calls.cancelCapture++; },
    stopSpeech: async () => { calls.stopSpeech++; },
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    audio,
    calls,
    resolveCapture: (result) => captures.shift().resolve(result),
    emit: (state, error = null) => {
      snapshot = { state, error };
      for (const listener of listeners) listener(snapshot);
    },
  };
}

function createController(rig, overrides = {}) {
  const submitted = [];
  const lifecycle = [];
  const controller = new VoiceInteractionController(rig.audio, {
    submitTranscript: async (text) => { submitted.push(text); },
    lifecycleIntent: async (intent) => { lifecycle.push(intent); },
    isSessionActive: () => true,
    ...overrides,
  });
  return { controller, submitted, lifecycle };
}

test('voice transcript normalization is bounded, Unicode-aware, and removes invisible spacing', () => {
  assert.equal(normalizeVoiceTranscript('  Ｃｌｕｅ\u200B\n  by\t the\u00A0door  '), 'Clue by the door');
  assert.equal(normalizeVoiceTranscript('\u200B \n\t'), '');
  assert.equal(normalizeVoiceTranscript('a'.repeat(450)).length, 400);
});

for (const [spoken, expected] of [
  ['Pause the adventure!', 'pause'],
  ["I'M TIRED?", 'pause'],
  ['end the investigation.', 'end'],
  ['BE QUIET!!!', 'quiet'],
  ["Don't listen,", 'cancel'],
  ['continue with the clue', 'none'],
]) {
  test(`classifies voice intent: ${spoken}`, () => {
    assert.equal(classifyVoiceIntent(spoken), expected);
  });
}

test('duplicate starts share the first capture and do not submit twice', async (t) => {
  const rig = createVoiceRig();
  const { controller, submitted } = createController(rig);
  t.after(() => controller.dispose());

  const first = controller.start();
  const duplicate = controller.start();
  assert.equal(rig.calls.capture, 1);
  assert.equal(controller.getSnapshot().state, 'requesting_permission');

  rig.resolveCapture({ type: 'transcript', text: 'A clue' });
  await Promise.all([first, duplicate]);
  assert.deepEqual(submitted, ['A clue']);
  assert.equal(controller.getSnapshot().state, 'idle');
});

test('stopListening finalizes capture and preserves the normalized transcript', async (t) => {
  const rig = createVoiceRig();
  const { controller, submitted } = createController(rig);
  t.after(() => controller.dispose());

  const interaction = controller.start();
  rig.emit('user_listening');
  assert.equal(controller.getSnapshot().state, 'listening');

  const stopping = controller.stopListening();
  assert.equal(rig.calls.stopCapture, 1);
  assert.equal(controller.getSnapshot().state, 'transcribing');
  rig.resolveCapture({ type: 'transcript', text: '  Find\u200B the key. ' });
  await Promise.all([interaction, stopping]);

  assert.deepEqual(submitted, ['Find the key.']);
  assert.deepEqual(controller.getSnapshot(), { state: 'idle', transcript: 'Find the key.', error: null });
});

test('cancellation stops capture and speech, then ignores a late transcript', async (t) => {
  const rig = createVoiceRig();
  const { controller, submitted } = createController(rig);
  t.after(() => controller.dispose());

  const interaction = controller.start();
  await controller.cancel();
  assert.equal(rig.calls.cancelCapture, 1);
  assert.equal(rig.calls.stopSpeech, 1);
  assert.equal(controller.getSnapshot().state, 'idle');

  rig.resolveCapture({ type: 'transcript', text: 'This arrived too late.' });
  await interaction;
  assert.deepEqual(submitted, []);
  assert.deepEqual(controller.getSnapshot(), { state: 'idle', transcript: null, error: null });
});

for (const [name, result, expectedError] of [
  ['unavailable input', { type: 'unavailable', reason: 'Choose a local Whisper model first.' }, 'Choose a local Whisper model first.'],
  ['empty transcript', { type: 'transcript', text: ' \u200B\n\t ' }, 'No clear speech was detected. Try again somewhere quiet.'],
]) {
  test(`${name} becomes a visible voice error without submitting`, async (t) => {
    const rig = createVoiceRig();
    const { controller, submitted } = createController(rig);
    t.after(() => controller.dispose());

    const interaction = controller.start();
    rig.resolveCapture(result);
    await interaction;

    assert.deepEqual(submitted, []);
    assert.deepEqual(controller.getSnapshot(), { state: 'error', transcript: null, error: expectedError });
  });
}

for (const [spoken, intent] of [['pause', 'pause'], ['end the investigation', 'end'], ['be quiet', 'quiet'], ['cancel', 'cancel']]) {
  test(`lifecycle intent ${intent} is routed without planner submission`, async (t) => {
    const rig = createVoiceRig();
    const { controller, submitted, lifecycle } = createController(rig);
    t.after(() => controller.dispose());

    const interaction = controller.start();
    rig.resolveCapture({ type: 'transcript', text: spoken });
    await interaction;

    assert.deepEqual(lifecycle, [intent]);
    assert.deepEqual(submitted, []);
    assert.deepEqual(controller.getSnapshot(), { state: 'idle', transcript: spoken, error: null });
  });
}

test('cancelled capture ignores late audio error and speaking notifications', async (t) => {
  const rig = createVoiceRig();
  const { controller } = createController(rig);
  t.after(() => controller.dispose());

  const interaction = controller.start();
  await controller.cancel();
  rig.emit('error', 'A late native response.');
  rig.emit('ai_speaking');
  rig.resolveCapture({ type: 'cancelled' });
  await interaction;

  assert.deepEqual(controller.getSnapshot(), { state: 'idle', transcript: null, error: null });
});

test('normal transcript waits for active audio to settle before returning idle', async (t) => {
  const rig = createVoiceRig();
  const submit = deferred();
  const { controller } = createController(rig, {
    submitTranscript: async () => {
      rig.emit('ai_speaking');
      await submit.promise;
    },
  });
  t.after(() => controller.dispose());

  const interaction = controller.start();
  rig.resolveCapture({ type: 'transcript', text: 'What is the next clue?' });
  await flush();
  assert.equal(controller.getSnapshot().state, 'speaking');

  submit.resolve();
  await flush();
  assert.equal(controller.getSnapshot().state, 'speaking');
  rig.emit('ai_speaking');
  rig.emit('idle');
  await interaction;
  assert.equal(controller.getSnapshot().state, 'idle');
});
