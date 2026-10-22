const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AIPlanner } = require('../src/ai/AIPlanner.ts');
const { GemmaProvider } = require('../src/ai/GemmaProvider.ts');
const { parseAIResponse, validateAIResponse } = require('../src/ai/responseSchema.ts');
const { boundAIRequest } = require('../src/ai/request.ts');
const { buildDetectiveMessages } = require('../src/ai/detectivePrompt.ts');
const { withDeadline } = require('../src/ai/deadline.ts');
const { normalizeOllamaEndpoint } = require('../src/config/ai.ts');
const { detectiveFacts } = require('../src/data/detectiveFacts.ts');
const { makeRequest, flush } = require('./fixtures.cjs');

const reply = { action: 'conversation', spokenText: 'You mentioned an old blue door. A convincing alibi, perhaps. What makes it suspicious?' };
const configuration = { endpoint: 'http://127.0.0.1:11434', model: 'gemma3:1b', timeoutMs: 1000 };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('prompt includes actual mission, structured schema, bounded history and pacing', () => {
  const request = makeRequest({ recentTurns: Array.from({ length: 30 }, () => ({ role: 'user', text: 'door'.repeat(200) })) });
  const bounded = boundAIRequest(request);
  assert.equal(bounded.recentTurns.length, 6);
  assert.ok(bounded.recentTurns.every((turn) => turn.text.length <= 400));
  const messages = buildDetectiveMessages(request);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /JSON schema/);
  const context = JSON.parse(messages[1].content).context;
  assert.equal(context.currentMission.instruction, request.currentMission.instruction);
  assert.match(context.pacing, /Beginning/);
});

test('valid contextual conversational JSON is accepted without changing a mission', () => {
  assert.deepEqual(parseAIResponse(JSON.stringify(reply), makeRequest()), reply);
});

for (const [name, value] of [
  ['malformed JSON', '{bad'],
  ['markdown', '```json\n{}\n```'],
  ['unknown action', JSON.stringify({ ...reply, action: 'navigate' })],
  ['status mutation', JSON.stringify({ ...reply, status: 'completed' })],
  ['duration mutation', JSON.stringify({ ...reply, sessionDurationSeconds: 10 })],
  ['missing text', '{"action":"conversation"}'],
  ['excessive text', JSON.stringify({ ...reply, spokenText: 'a'.repeat(501) })],
  ['code/URL', JSON.stringify({ ...reply, spokenText: 'Open https://example.com now.' })],
  ['unsafe movement', JSON.stringify({ ...reply, spokenText: 'Cross the road and close your eyes.' })],
  ['unsafe touch', JSON.stringify({ ...reply, spokenText: 'Touch the strange object.' })],
  ['intrusive challenge', JSON.stringify({ ...reply, spokenText: 'Approach a stranger and follow them.' })],
  ['false perception', JSON.stringify({ ...reply, spokenText: 'I can see a red door.' })],
  ['fabricated completion', JSON.stringify({ ...reply, spokenText: 'I completed the mission for you.' })],
  ['unlabelled story', JSON.stringify({ action: 'story', spokenText: 'A mysterious person left a letter.' })],
]) {
  test(`validator rejects ${name}`, () => assert.throws(() => parseAIResponse(value, makeRequest())));
}

test('only catalogue missions of the matching type may be selected at progression boundaries', () => {
  const request = makeRequest({ allowMissionChange: true, interactionMode: 'mission_complete' });
  const mission = { action: 'listening_mission', spokenText: 'Even the background deserves a chapter in this case.', missionId: 'sound-map' };
  assert.equal(validateAIResponse(mission, request).missionId, 'sound-map');
  assert.throws(() => validateAIResponse(mission, makeRequest()));
  assert.throws(() => validateAIResponse({ ...mission, action: 'movement_mission' }, request));
  assert.throws(() => validateAIResponse({ ...mission, missionId: 'invented' }, request));
  assert.throws(() => validateAIResponse({ ...mission, instruction: 'Go elsewhere.' }, request));
  assert.throws(() => validateAIResponse(mission, { ...request, completedMissionIds: ['sound-map'] }));
});

test('facts come from verified catalogue, not model assertions', () => {
  const response = validateAIResponse({ action: 'character_fact', factId: detectiveFacts[0].id, spokenText: 'This false quotation must not be delivered.' }, makeRequest());
  assert.equal(response.spokenText, detectiveFacts[0].spokenText);
  assert.throws(() => validateAIResponse({ ...response, factId: 'not-verified' }, makeRequest()));
});

test('quiet durations and session_closing permissions are enforced', () => {
  const quiet = { action: 'quiet_interval', spokenText: 'Even mysteries can have a quiet chapter.', durationSeconds: 20 };
  assert.equal(validateAIResponse(quiet, makeRequest()).durationSeconds, 20);
  assert.throws(() => validateAIResponse({ ...quiet, durationSeconds: 999 }, makeRequest()));
  assert.throws(() => validateAIResponse(quiet, makeRequest({ elapsedSeconds: 1199 })));
  assert.throws(() => validateAIResponse({ action: 'session_closing', spokenText: 'Case notes filed.' }, makeRequest()));
  assert.equal(validateAIResponse({ action: 'session_closing', spokenText: 'Case notes filed.' }, makeRequest({ interactionMode: 'closing' })).action, 'session_closing');
});

test('invalid and failed providers use safe local content; cancellation does not produce fallback', async () => {
  for (const provider of [null, { generateResponse: async () => { throw Error('network'); } }, { generateResponse: async () => ({ ...reply, status: 'completed' }) }]) {
    const result = await new AIPlanner(provider).plan(makeRequest());
    assert.equal(result.source, 'fallback');
    assert.equal(result.response.action, 'conversation');
  }
  const cancel = new AbortController();
  const task = new AIPlanner({ generateResponse: () => new Promise(() => {}) }).plan(makeRequest(), cancel.signal);
  cancel.abort();
  await assert.rejects(task, { name: 'AbortError' });
});

test('Ollama transport verifies runtime/model then uses official non-streaming schema format', async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/version')) return json({ version: '0.6.2' });
    if (url.endsWith('/tags')) return json({ models: [{ name: 'gemma3:1b', details: { family: 'gemma3' } }] });
    return json({ model: 'gemma3:1b', done: true, message: { role: 'assistant', content: JSON.stringify(reply) } });
  };
  const provider = new GemmaProvider(configuration, transport);
  const result = await new AIPlanner(provider).plan(makeRequest());
  assert.equal(result.source, 'gemma');
  assert.deepEqual(result.response, reply);
  assert.equal(calls.length, 3);
  const payload = JSON.parse(calls[2].options.body);
  assert.equal(payload.stream, false);
  assert.equal(payload.model, configuration.model);
  assert.equal(payload.format.type, 'object');
  assert.equal(calls[2].options.redirect, 'error');
  await provider.generateResponse(makeRequest());
  assert.equal(calls.length, 4); // successful preflight is cached, no redundant requests
});

test('missing model never invokes chat or downloads', async () => {
  const calls = [];
  const provider = new GemmaProvider(configuration, async (url) => {
    calls.push(url);
    return json(url.endsWith('/version') ? { version: '0.6.2' } : { models: [] });
  });
  const result = await new AIPlanner(provider).plan(makeRequest());
  assert.equal(result.source, 'fallback');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => !url.includes('/chat') && !url.includes('/pull')));
});

test('preflight rejects redirected responses and incompatible runtimes', async () => {
  for (const response of [json({}, 302), json({ version: '0.5.1' })]) {
    const provider = new GemmaProvider(configuration, async () => response);
    const result = await new AIPlanner(provider).plan(makeRequest());
    assert.equal(result.source, 'fallback');
  }
});

test('deadline includes a stalled body; cancellation stops a pending preflight', async () => {
  await assert.rejects(withDeadline(() => new Promise(() => {}), 15), (error) => error.code === 'timeout');
  let childSignal;
  const provider = new GemmaProvider(configuration, async (_url, options) => {
    childSignal = options.signal;
    return new Response(new ReadableStream({ start() {} }));
  });
  const cancel = new AbortController();
  const work = provider.generateResponse(makeRequest(), cancel.signal);
  await flush();
  cancel.abort();
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(childSignal.aborted, true);
});

test('configuration allows only explicitly selected private endpoints', () => {
  for (const address of ['http://127.0.0.1:11434', 'http://10.0.2.2:11434', 'http://192.168.1.20:11434']) assert.ok(normalizeOllamaEndpoint(address));
  for (const address of ['', 'http://8.8.8.8:11434', 'https://example.com', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/secret', 'http://127.0.0.1?token=secret']) assert.throws(() => normalizeOllamaEndpoint(address));
});
