const { test } = require('node:test');
const assert = require('node:assert/strict');
const { flush, deferred } = require('./fixtures.cjs');
const { createAudioRig } = require('./audio-fixtures.cjs');
const track = { source: 1, title: 'Test asset only', license: 'Synthetic test fixture; not bundled in app' };

test('no bundled track means no fake music playback or listening state', async (t) => {
  const { audio } = createAudioRig();
  t.after(() => audio.stop());
  await audio.start('one', null);
  assert.equal(audio.getSnapshot().state, 'idle');
  const result = await audio.capture();
  assert.equal(result.type, 'unavailable');
  assert.equal(audio.getSnapshot().state, 'idle');
});

test('music pauses before speech and resumes quietly; duplicate utterance ID speaks once', async (t) => {
  const rig = createAudioRig();
  t.after(() => rig.audio.stop());
  await rig.audio.start('one', track);
  assert.equal(rig.audio.getSnapshot().state, 'music_playing');
  const first = rig.audio.speak('reply-1', 'A clue for the notebook.');
  const duplicate = rig.audio.speak('reply-1', 'A clue for the notebook.');
  await flush();
  assert.equal(rig.events.filter(([event]) => event === 'speech').length, 1);
  const position = rig.events.findIndex(([event]) => event === 'speech');
  assert.ok(rig.events.slice(0, position).some(([event]) => event === 'musicPause'));
  assert.equal(rig.music.getSnapshot().playing, false);
  assert.equal(rig.audio.getSnapshot().state, 'ai_speaking');
  rig.finish();
  await Promise.all([first, duplicate]);
  await flush();
  assert.equal(rig.audio.getSnapshot().state, 'music_playing');
  assert.ok(rig.events.some(([event, volume]) => event === 'musicVolume' && volume === 0.12));
});

test('pause cancels utterance and holds music; resume does not replay cancelled speech', async (t) => {
  const rig = createAudioRig();
  t.after(() => rig.audio.stop());
  await rig.audio.start('one', track);
  const spoken = rig.audio.speak('reply-1', 'A clue for the notebook.');
  await flush();
  await rig.audio.pause();
  await spoken;
  assert.equal(rig.audio.getSnapshot().state, 'paused');
  assert.equal(rig.music.getSnapshot().playing, false);
  await rig.audio.resume();
  await rig.audio.speak('reply-1', 'A clue for the notebook.');
  assert.equal(rig.events.filter(([event]) => event === 'speech').length, 1);
});

test('ending while preparation is pending cannot start an obsolete utterance', async (t) => {
  const rig = createAudioRig();
  t.after(() => rig.audio.stop());
  await rig.audio.start('one', null);
  const barrier = deferred();
  rig.speech.stop = () => barrier.promise;
  const pending = rig.audio.speak('reply-1', 'This must not begin.');
  await flush();
  const stopped = rig.audio.stop();
  const next = rig.audio.start('two', null);
  barrier.resolve();
  await Promise.all([pending, stopped, next]);
  assert.equal(rig.events.filter(([event]) => event === 'speech').length, 0);
  assert.equal(rig.audio.getSnapshot().state, 'idle');
});

test('speech errors are visible and do not escape as rejected UI commands', async (t) => {
  const rig = createAudioRig();
  t.after(() => rig.audio.stop());
  rig.speech.speak = async () => { throw Error('native details must not be exposed'); };
  await rig.audio.start('one', null);
  await rig.audio.speak('bad', 'A clue for the notebook.');
  assert.equal(rig.audio.getSnapshot().state, 'error');
  assert.ok(rig.audio.getSnapshot().error);
  assert.doesNotMatch(rig.audio.getSnapshot().error, /native details/);
});

test('late speech completion cannot revive audio in an ended or new session', async (t) => {
  const rig = createAudioRig();
  t.after(() => rig.audio.stop());
  await rig.audio.start('one', track);
  const task = rig.audio.speak('old', 'An old reply.');
  await flush();
  const lateFinish = rig.finish;
  await rig.audio.stop();
  await rig.audio.start('two', null);
  lateFinish();
  await task;
  await flush();
  assert.equal(rig.audio.getSnapshot().state, 'idle');
  assert.equal(rig.music.getSnapshot().playing, false);
});

test('ending a session releases active audio without disposing reusable voice input', async (t) => {
  const calls = { cancel: 0, dispose: 0 };
  const input = {
    getAvailability: () => ({ available: true }),
    prepare: async () => ({ available: true }),
    start: async () => ({ type: 'cancelled' }),
    cancel: async () => { calls.cancel++; },
    dispose: async () => { calls.dispose++; },
  };
  const rig = createAudioRig();
  const { AudioController } = require('../src/audio/AudioController.ts');
  const audio = new AudioController(rig.speech, rig.music, input);
  t.after(() => audio.stop());

  await audio.start('one', null);
  await audio.stop();
  await audio.start('two', null);

  assert.equal(calls.dispose, 0);
  assert.ok(calls.cancel >= 2);
  assert.equal(audio.getSnapshot().state, 'idle');
});
