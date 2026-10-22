const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { deferred, flush } = require('./fixtures.cjs');

// Exercise the real adapter with only its native Expo bridge replaced. This
// proves queue/callback logic, not that a phone produced audible sound.
let stopBarrier = null;
const utterances = [];
const bridge = {
  maxSpeechInputLength: 4000,
  stop: async () => { if (stopBarrier) await stopBarrier.promise; },
  speak: (text, callbacks) => { utterances.push({ text, callbacks }); callbacks.onStart?.(); },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  return request === 'expo-speech' ? bridge : originalLoad.call(this, request, parent, isMain);
};
const { ExpoSpeechOutput } = require('../src/audio/ExpoSpeechOutput.ts');
Module._load = originalLoad;

test('Expo TTS adapter cancels pending preparation before native speak', async () => {
  const output = new ExpoSpeechOutput();
  stopBarrier = deferred();
  const before = utterances.length;
  const pending = output.speak('Must not begin.');
  await flush();
  const stopped = output.stop();
  stopBarrier.resolve();
  stopBarrier = null;
  await Promise.all([pending, stopped]);
  assert.equal(utterances.length, before);
});

test('Expo TTS adapter handles empty text, native completion/error, and stale callbacks', async () => {
  const output = new ExpoSpeechOutput();
  const before = utterances.length;
  await output.speak('  ');
  assert.equal(utterances.length, before);
  const first = output.speak('One short clue.');
  await flush();
  const old = utterances.at(-1);
  const second = output.speak('Another short clue.');
  await flush();
  await first;
  old.callbacks.onDone();
  const current = utterances.at(-1);
  assert.equal(current.text, 'Another short clue.');
  current.callbacks.onDone();
  await second;
  const failure = output.speak('A speech error.');
  await flush();
  utterances.at(-1).callbacks.onError(Error('raw native detail'));
  await assert.rejects(failure, (error) => error.code === 'speech_failed');
  await output.stop();
});
