const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mapRunEventToSseName,
  validateRunEvent,
  validateSsePayload,
  buildRunSseEnvelope,
} = require('../lib/responseEventValidator');

const validRunEvent = () => ({
  id: 'evt_123',
  type: 'run_started',
  runId: 'run_123',
  timestamp: new Date().toISOString(),
  model: 'GLM-4.7',
  promptLength: 42,
});

test('mapRunEventToSseName maps run_completed to done', () => {
  assert.equal(mapRunEventToSseName('run_completed'), 'done');
});

test('validateRunEvent accepts run_started shape', () => {
  const evt = validateRunEvent(validRunEvent());
  assert.equal(evt.type, 'run_started');
});

test('validateRunEvent rejects unknown run event type', () => {
  const evt = {
    ...validRunEvent(),
    type: 'unknown_event',
  };

  assert.throws(
    () => validateRunEvent(evt),
    (error) => error && error.code === 'PROTOCOL_RUN_EVENT_INVALID' && error.path === 'event.type',
  );
});

test('buildRunSseEnvelope returns mapped event name and data', () => {
  const envelope = buildRunSseEnvelope(validRunEvent());
  assert.equal(envelope.eventName, 'status');
  assert.equal(envelope.data.runId, 'run_123');
});

test('validateSsePayload validates run snapshot payload', () => {
  const payload = {
    run: {
      id: 'run_1',
      status: 'running',
    },
  };
  const validated = validateSsePayload({ eventName: 'run', data: payload });
  assert.equal(validated.run.id, 'run_1');
});

test('validateSsePayload rejects unsupported SSE event name', () => {
  assert.throws(
    () => validateSsePayload({ eventName: 'heartbeat', data: {} }),
    (error) => error && error.code === 'PROTOCOL_SSE_EVENT_INVALID' && error.path === 'eventName',
  );
});

test('buildRunSseEnvelope accepts trace_span events and maps to trace', () => {
  const now = new Date().toISOString();
  const envelope = buildRunSseEnvelope({
    id: 'evt_trace',
    type: 'trace_span',
    runId: 'run_123',
    timestamp: now,
    traceId: 'trace_abc',
    spanId: 'span_abc',
    name: 'provider.openai.request',
    component: 'provider',
    status: 'ok',
    startedAt: now,
    endedAt: now,
    durationMs: 0,
  });
  assert.equal(envelope.eventName, 'trace');
  assert.equal(envelope.data.type, 'trace_span');
});
