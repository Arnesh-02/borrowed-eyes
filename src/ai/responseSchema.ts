import { detectiveFacts, getDetectiveFact } from '../data/detectiveFacts';
import type { AIRequest } from './AIProvider';
import { AIProviderError } from './errors';
import { AI_LIMITS, QUIET_INTERVAL_SECONDS } from './limits';
import { eligibleMissions, isClosingRequest, MISSION_ACTION_TYPES, remainingSeconds } from './request';
import type { MissionAction } from './request';
import { isSafeSpokenText } from './safety';

type SpokenAction = 'conversation' | 'story' | 'session_closing';
type SpokenResponse = { [Action in SpokenAction]: { action: Action; spokenText: string } }[SpokenAction];
type MissionResponse = { [Action in MissionAction]: { action: Action; spokenText: string; missionId: string } }[MissionAction];

export type AIResponse = SpokenResponse | MissionResponse
  | { action: 'character_fact'; spokenText: string; factId: string }
  | { action: 'quiet_interval'; spokenText: string; durationSeconds: number };

export type AIAction = AIResponse['action'];

const spokenTextSchema = { type: 'string', minLength: 1, maxLength: AI_LIMITS.spokenText } as const;
const spokenActions = ['conversation', 'story', 'session_closing'] as const;

// Ollama accepts a JSON Schema object in `format`. additionalProperties is
// false on EVERY alternative, not merely at the root of an anyOf schema.
export const AI_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  oneOf: [
    ...spokenActions.map((action) => ({
      type: 'object',
      properties: { action: { const: action }, spokenText: spokenTextSchema },
      required: ['action', 'spokenText'],
      additionalProperties: false,
    })),
    ...Object.keys(MISSION_ACTION_TYPES).map((action) => ({
      type: 'object',
      properties: {
        action: { const: action }, spokenText: spokenTextSchema,
        missionId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' },
      },
      required: ['action', 'spokenText', 'missionId'],
      additionalProperties: false,
    })),
    {
      type: 'object',
      properties: {
        action: { const: 'character_fact' }, spokenText: spokenTextSchema,
        factId: { type: 'string', enum: detectiveFacts.map((fact) => fact.id) },
      },
      required: ['action', 'spokenText', 'factId'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { const: 'quiet_interval' }, spokenText: spokenTextSchema,
        durationSeconds: { type: 'integer', enum: QUIET_INTERVAL_SECONDS },
      },
      required: ['action', 'spokenText', 'durationSeconds'],
      additionalProperties: false,
    },
  ],
};

function invalid(): never {
  throw new AIProviderError('invalid_response');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) invalid();
  if (keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key)
    || !('value' in (Object.getOwnPropertyDescriptor(value, key) ?? {})))) invalid();
}

export function validateAIResponse(value: unknown, request: AIRequest): AIResponse {
  if (!isRecord(value)) return invalid();
  if (Reflect.ownKeys(value).some((key) => !('value' in (Object.getOwnPropertyDescriptor(value, key) ?? {})))) return invalid();
  const { action, spokenText } = value;
  if (typeof action !== 'string' || typeof spokenText !== 'string'
    || !spokenText.trim() || spokenText.length > AI_LIMITS.spokenText) return invalid();
  if (isClosingRequest(request) !== (action === 'session_closing')) return invalid();
  if ((request.sessionStatus === 'paused' || request.sessionStatus === 'idle')
    && !isClosingRequest(request) && action !== 'conversation') return invalid();

  // The model only chooses a verified fact ID. Its factual wording is NEVER
  // displayed, even if it happens to pass the general text checks.
  if (action === 'character_fact') {
    exactKeys(value, ['action', 'spokenText', 'factId']);
    if (typeof value.factId !== 'string') return invalid();
    const fact = getDetectiveFact(value.factId);
    if (!fact || !isSafeSpokenText(fact.spokenText)) return invalid();
    return { action, spokenText: fact.spokenText, factId: fact.id };
  }

  if (!isSafeSpokenText(spokenText)) return invalid();
  const text = spokenText.trim();
  if (action === 'conversation' || action === 'story' || action === 'session_closing') {
    exactKeys(value, ['action', 'spokenText']);
    if (action === 'story' && !/^(?:In this fictional (?:story|case)|A fictional (?:story|case)|Fictional (?:story|case))\s*[:,.]/i.test(text)) {
      return invalid();
    }
    return { action, spokenText: text };
  }
  if (action === 'quiet_interval') {
    exactKeys(value, ['action', 'spokenText', 'durationSeconds']);
    if (typeof value.durationSeconds !== 'number'
      || !QUIET_INTERVAL_SECONDS.some((duration) => duration === value.durationSeconds)
      || value.durationSeconds > remainingSeconds(request)) return invalid();
    return { action, spokenText: text, durationSeconds: value.durationSeconds };
  }
  if (Object.prototype.hasOwnProperty.call(MISSION_ACTION_TYPES, action)) {
    exactKeys(value, ['action', 'spokenText', 'missionId']);
    if (typeof value.missionId !== 'string') return invalid();
    const missionAction = action as MissionAction;
    const mission = eligibleMissions(request).find((choice) => choice.id === value.missionId);
    if (!mission || mission.type !== MISSION_ACTION_TYPES[missionAction]) return invalid();
    return { action: missionAction, spokenText: text, missionId: mission.id };
  }
  return invalid();
}

export function parseAIResponse(text: string, request: AIRequest): AIResponse {
  if (!text.trim() || text.length > AI_LIMITS.responseJson) return invalid();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid();
  }
  return validateAIResponse(value, request);
}
