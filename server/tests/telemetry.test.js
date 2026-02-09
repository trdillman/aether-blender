const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveEventTaxonomy, buildCorrelation } = require('../lib/telemetry');

test('resolveEventTaxonomy maps known run lifecycle events', () => {
  assert.equal(resolveEventTaxonomy('run_started'), 'run.lifecycle.started');
  assert.equal(resolveEventTaxonomy('trace_span'), 'trace.span');
  assert.equal(resolveEventTaxonomy('custom_event'), 'event.custom_event');
});

test('buildCorrelation returns run and step correlation ids', () => {
  const correlation = buildCorrelation({ runId: 'run_1', stepId: 'step_2' });
  assert.equal(correlation.runCorrelationId, 'run:run_1');
  assert.equal(correlation.stepCorrelationId, 'run:run_1:step:step_2');
});
