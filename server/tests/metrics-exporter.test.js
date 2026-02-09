const test = require('node:test');
const assert = require('node:assert/strict');

const {
  recordProviderCall,
  recordExecutorCall,
  snapshot,
  resetMetrics,
} = require('../lib/metricsExporter');

test('metrics exporter aggregates provider and executor latency/success/retries', () => {
  resetMetrics();

  recordProviderCall({
    provider: 'openai',
    operation: 'generate_protocol_plan',
    success: true,
    latencyMs: 120,
    retries: 1,
  });
  recordProviderCall({
    provider: 'openai',
    operation: 'generate_protocol_plan',
    success: false,
    latencyMs: 80,
    retries: 0,
  });
  recordExecutorCall({
    executorType: 'NODE_TREE',
    success: true,
    latencyMs: 45,
    retries: 0,
  });

  const metrics = snapshot();
  const provider = metrics.providers.find(
    (entry) =>
      entry.labels.provider === 'openai' &&
      entry.labels.operation === 'generate_protocol_plan',
  );
  const executor = metrics.executors.find(
    (entry) => entry.labels.executorType === 'NODE_TREE',
  );

  assert.ok(provider);
  assert.equal(provider.count, 2);
  assert.equal(provider.success, 1);
  assert.equal(provider.failure, 1);
  assert.equal(provider.retries, 1);
  assert.equal(provider.minLatencyMs, 80);
  assert.equal(provider.maxLatencyMs, 120);

  assert.ok(executor);
  assert.equal(executor.count, 1);
  assert.equal(executor.success, 1);
  assert.equal(executor.failure, 0);
  assert.equal(executor.totalLatencyMs, 45);
});
