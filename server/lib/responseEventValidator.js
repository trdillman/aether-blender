const { createTaxonomyError } = require('./errorTaxonomy');

const RUN_EVENT_TYPES = new Set([
  'run_started',
  'run_completed',
  'run_failed',
  'step_started',
  'step_completed',
  'tool_called',
  'blender_started',
  'blender_log',
  'blender_rpc_call',
  'blender_rpc_result',
  'assistant_message',
  'verification_gate',
  'protocol_rpc_skipped',
  'protocol_rpc_result',
  'protocol_rpc_error',
  'protocol_rpc_cancel_escalated',
  'protocol_rpc_cancel_error',
  'trace_span',
]);

const TERMINAL_RUN_EVENTS = new Set(['run_completed', 'run_failed']);
const SSE_EVENT_NAMES = new Set([
  'status',
  'done',
  'log',
  'trace',
  'assistant.message',
  'event',
  'run',
  'run.updated',
  'session',
]);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertCondition = (condition, message, path, errorCode = 'PROTOCOL_RUN_EVENT_INVALID') => {
  if (!condition) {
    throw createTaxonomyError(errorCode, { message, path });
  }
};

const isIsoTimestamp = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
};

const mapRunEventToSseName = (eventType) => {
  if (eventType === 'run_started') return 'status';
  if (eventType === 'run_completed' || eventType === 'run_failed') return 'done';
  if (eventType === 'blender_log') return 'log';
  if (eventType === 'step_started' || eventType === 'step_completed' || eventType === 'tool_called') return 'trace';
  if (eventType === 'blender_rpc_call' || eventType === 'blender_rpc_result') return 'trace';
  if (eventType === 'blender_started') return 'trace';
  if (eventType === 'trace_span') return 'trace';
  if (eventType === 'assistant_message') return 'assistant.message';
  return 'event';
};

const validateRunSnapshot = (run, path = 'run') => {
  assertCondition(isObject(run), `${path} must be an object.`, path);
  assertCondition(typeof run.id === 'string' && run.id.trim(), `${path}.id is required.`, `${path}.id`);
  assertCondition(typeof run.status === 'string' && run.status.trim(), `${path}.status is required.`, `${path}.status`);
};

const validateRunEvent = (event) => {
  assertCondition(isObject(event), 'Run event must be an object.', 'event');
  assertCondition(typeof event.id === 'string' && event.id.trim(), 'event.id is required.', 'event.id');
  assertCondition(typeof event.type === 'string' && event.type.trim(), 'event.type is required.', 'event.type');
  assertCondition(typeof event.runId === 'string' && event.runId.trim(), 'event.runId is required.', 'event.runId');
  assertCondition(isIsoTimestamp(event.timestamp), 'event.timestamp must be an ISO timestamp.', 'event.timestamp');
  assertCondition(RUN_EVENT_TYPES.has(event.type), `Unsupported run event type "${event.type}".`, 'event.type');

  if (event.type === 'run_started') {
    assertCondition(typeof event.model === 'string', 'run_started.model must be a string.', 'event.model');
    assertCondition(Number.isInteger(event.promptLength), 'run_started.promptLength must be an integer.', 'event.promptLength');
  }

  if (event.type === 'run_completed') {
    assertCondition(Number.isInteger(event.durationMs), 'run_completed.durationMs must be an integer.', 'event.durationMs');
    assertCondition(Number.isInteger(event.artifactCount), 'run_completed.artifactCount must be an integer.', 'event.artifactCount');
  }

  if (event.type === 'run_failed') {
    assertCondition(typeof event.error === 'string' && event.error.trim(), 'run_failed.error is required.', 'event.error');
    assertCondition(typeof event.cancelled === 'boolean', 'run_failed.cancelled must be a boolean.', 'event.cancelled');
  }

  if (event.type === 'assistant_message') {
    assertCondition(typeof event.content === 'string' && event.content.trim(), 'assistant_message.content is required.', 'event.content');
  }

  if (event.type === 'verification_gate') {
    assertCondition(Array.isArray(event.failed_gates), 'verification_gate.failed_gates must be an array.', 'event.failed_gates');
    assertCondition(Array.isArray(event.messages), 'verification_gate.messages must be an array.', 'event.messages');
    assertCondition(typeof event.success === 'boolean', 'verification_gate.success must be a boolean.', 'event.success');
  }

  if (event.type === 'trace_span') {
    assertCondition(typeof event.traceId === 'string' && event.traceId.trim(), 'trace_span.traceId is required.', 'event.traceId');
    assertCondition(typeof event.spanId === 'string' && event.spanId.trim(), 'trace_span.spanId is required.', 'event.spanId');
    assertCondition(typeof event.name === 'string' && event.name.trim(), 'trace_span.name is required.', 'event.name');
    assertCondition(typeof event.component === 'string' && event.component.trim(), 'trace_span.component is required.', 'event.component');
    assertCondition(typeof event.status === 'string' && event.status.trim(), 'trace_span.status is required.', 'event.status');
    assertCondition(isIsoTimestamp(event.startedAt), 'trace_span.startedAt must be an ISO timestamp.', 'event.startedAt');
    assertCondition(isIsoTimestamp(event.endedAt), 'trace_span.endedAt must be an ISO timestamp.', 'event.endedAt');
    assertCondition(Number.isInteger(event.durationMs), 'trace_span.durationMs must be an integer.', 'event.durationMs');
  }

  if (TERMINAL_RUN_EVENTS.has(event.type)) {
    assertCondition(Number.isInteger(event.durationMs), `${event.type}.durationMs must be an integer.`, 'event.durationMs');
  }

  if (event.run !== undefined) {
    validateRunSnapshot(event.run, 'event.run');
  }

  return event;
};

const validateSsePayload = ({ eventName, data }) => {
  assertCondition(typeof eventName === 'string' && eventName.trim(), 'SSE eventName is required.', 'eventName', 'PROTOCOL_SSE_EVENT_INVALID');
  assertCondition(SSE_EVENT_NAMES.has(eventName), `Unsupported SSE event "${eventName}".`, 'eventName', 'PROTOCOL_SSE_EVENT_INVALID');
  assertCondition(isObject(data), 'SSE payload must be an object.', 'data', 'PROTOCOL_SSE_EVENT_INVALID');

  if (eventName === 'run' || eventName === 'run.updated') {
    validateRunSnapshot(data.run, 'data.run');
    return data;
  }

  if (eventName === 'session') {
    assertCondition(isObject(data.session), 'data.session must be an object.', 'data.session', 'PROTOCOL_SSE_EVENT_INVALID');
    assertCondition(typeof data.session.id === 'string' && data.session.id.trim(), 'data.session.id is required.', 'data.session.id', 'PROTOCOL_SSE_EVENT_INVALID');
    return data;
  }

  const looksLikeRunEvent =
    typeof data.type === 'string' &&
    typeof data.id === 'string' &&
    typeof data.runId === 'string' &&
    typeof data.timestamp === 'string';
  if (looksLikeRunEvent) {
    validateRunEvent(data);
  }
  return data;
};

const buildRunSseEnvelope = (event) => {
  const validated = validateRunEvent(event);
  const eventName = mapRunEventToSseName(validated.type);
  validateSsePayload({ eventName, data: validated });
  return {
    eventName,
    data: validated,
  };
};

module.exports = {
  mapRunEventToSseName,
  validateRunEvent,
  validateSsePayload,
  buildRunSseEnvelope,
};
