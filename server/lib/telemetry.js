const EVENT_TAXONOMY = Object.freeze({
  run_started: 'run.lifecycle.started',
  run_completed: 'run.lifecycle.completed',
  run_failed: 'run.lifecycle.failed',
  step_started: 'run.step.started',
  step_completed: 'run.step.completed',
  tool_called: 'tool.invocation',
  blender_started: 'blender.lifecycle.started',
  blender_log: 'blender.log.line',
  blender_rpc_call: 'blender.rpc.call',
  blender_rpc_result: 'blender.rpc.result',
  assistant_message: 'assistant.message',
  verification_gate: 'verification.gate',
  protocol_rpc_skipped: 'protocol.rpc.skipped',
  protocol_rpc_result: 'protocol.rpc.result',
  protocol_rpc_error: 'protocol.rpc.error',
  protocol_rpc_cancel_escalated: 'protocol.rpc.cancel_escalated',
  protocol_rpc_cancel_error: 'protocol.rpc.cancel_error',
  trace_span: 'trace.span',
});

const resolveEventTaxonomy = (eventType) => {
  const normalized = String(eventType || '').trim();
  if (!normalized) return 'event.unknown';
  return EVENT_TAXONOMY[normalized] || `event.${normalized}`;
};

const buildCorrelation = ({ runId, stepId }) => {
  const normalizedRunId = String(runId || '').trim();
  const normalizedStepId = String(stepId || '').trim();
  return {
    runId: normalizedRunId,
    stepId: normalizedStepId || null,
    runCorrelationId: normalizedRunId ? `run:${normalizedRunId}` : null,
    stepCorrelationId:
      normalizedRunId && normalizedStepId
        ? `run:${normalizedRunId}:step:${normalizedStepId}`
        : null,
  };
};

module.exports = {
  EVENT_TAXONOMY,
  resolveEventTaxonomy,
  buildCorrelation,
};
