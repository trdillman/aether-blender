const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const EXECUTOR_PATH = path.resolve(__dirname, '../lib/protocolExecutor.js');

const withMockedProtocolExecutor = async (mocks, run) => {
  const originalLoad = Module._load;
  delete require.cache[EXECUTOR_PATH];

  Module._load = function patchedLoader(request, parent, isMain) {
    if (parent && parent.filename === EXECUTOR_PATH && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const mod = require(EXECUTOR_PATH);
    return await run(mod);
  } finally {
    Module._load = originalLoad;
    delete require.cache[EXECUTOR_PATH];
  }
};

test('executeProtocolPlan records executor metrics and trace spans', async () => {
  const metricCalls = [];
  const traceSpans = [];
  const events = [];

  await withMockedProtocolExecutor(
    {
      './executors/registry': {
        getExecutorForStep: () => ({
          run: async () => {},
        }),
      },
      './metricsExporter': {
        recordExecutorCall: (entry) => metricCalls.push(entry),
      },
    },
    async ({ executeProtocolPlan }) => {
      await executeProtocolPlan({
        protocol: {
          steps: [{ id: 'step_1', type: 'NODE_TREE', description: 'Do it', payload: {} }],
        },
        run: { id: 'run_1' },
        runDir: __dirname,
        repoRoot: __dirname,
        settings: {},
        startStep: async () => {},
        completeStep: async () => {},
        failStep: () => {},
        appendEvent: async (_run, type, payload) => events.push({ type, payload }),
        addArtifact: async () => {},
        executeWithCancellation: async (_run, promise) => promise,
        registerCancelHandler: () => () => {},
        traceSpanRecorder: async (span) => traceSpans.push(span),
      });
    },
  );

  assert.equal(metricCalls.length, 1);
  assert.equal(metricCalls[0].executorType, 'NODE_TREE');
  assert.equal(metricCalls[0].success, true);
  assert.equal(traceSpans.length, 1);
  assert.equal(traceSpans[0].component, 'executor');
  assert.equal(traceSpans[0].stepId, 'step_1');
  assert.equal(events.length, 0);
});
