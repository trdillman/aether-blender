const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const RUNNER_PATH = path.resolve(__dirname, '../lib/manifestE2ERunner.js');

const withMockedRunner = async (mocks, run) => {
  const originalLoad = Module._load;
  delete require.cache[RUNNER_PATH];

  Module._load = function patchedLoader(request, parent, isMain) {
    if (parent && parent.filename === RUNNER_PATH && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const mod = require(RUNNER_PATH);
    return await run(mod);
  } finally {
    Module._load = originalLoad;
    delete require.cache[RUNNER_PATH];
  }
};

test('validateManifest rejects manifest without id', async () => {
  await withMockedRunner({}, async ({ validateManifest }) => {
    assert.throws(
      () => validateManifest({ protocol: { steps: [] } }),
      /id is required/i,
    );
  });
});

test('runManifest executes protocol and validates required events', async () => {
  const calls = {
    executeProtocol: 0,
  };

  await withMockedRunner(
    {
      './protocolExecutor': {
        executeProtocolPlan: async ({ startStep, completeStep, appendEvent, run }) => {
          calls.executeProtocol += 1;
          await startStep(run, 'mock_step', 'Mock Step');
          await appendEvent(run, 'protocol_python', { stepId: 'mock_step' });
          await completeStep(run, 'mock_step', 'Mock Step', {});
        },
      },
    },
    async ({ runManifest }) => {
      const result = await runManifest({
        manifest: {
          id: 'manifest_1',
          protocol: { version: '1.0', steps: [{ id: 'mock_step', type: 'PYTHON', payload: { code: 'print(1)' } }], done: true, final_message: 'ok' },
          assertions: {
            events: {
              requireEventTypes: ['protocol_python'],
            },
          },
          options: {
            requireActiveRpcSession: false,
          },
        },
        repoRoot: __dirname,
        runDir: __dirname,
        settings: {},
      });

      assert.equal(result.ok, true);
      assert.equal(calls.executeProtocol, 1);
      assert.equal(result.stepCount, 1);
      assert.equal(result.eventCount, 1);
    },
  );
});

test('runManifest fails when required event is missing', async () => {
  await withMockedRunner(
    {
      './protocolExecutor': {
        executeProtocolPlan: async () => {},
      },
    },
    async ({ runManifest }) => {
      await assert.rejects(
        () =>
          runManifest({
            manifest: {
              id: 'manifest_2',
              protocol: { version: '1.0', steps: [] },
              assertions: {
                events: {
                  requireEventTypes: ['protocol_node_tree'],
                },
              },
              options: {
                requireActiveRpcSession: false,
              },
            },
            repoRoot: __dirname,
            runDir: __dirname,
            settings: {},
          }),
        /missing required events/i,
      );
    },
  );
});

test('runManifest sends scene verification script through exec_python when session is active', async () => {
  const recorded = {
    command: null,
    payload: null,
    timeoutMs: null,
  };

  await withMockedRunner(
    {
      './protocolExecutor': {
        executeProtocolPlan: async ({ appendEvent, run }) => {
          await appendEvent(run, 'protocol_node_tree', { stepId: 'build_geo_nodes' });
        },
      },
      './blenderSessionManager': {
        getActiveSession: () => ({ id: 'session_1', status: 'running', rpcReady: true, supportsRpc: true }),
        executeOnActive: async (command, payload, timeoutMs) => {
          recorded.command = command;
          recorded.payload = payload;
          recorded.timeoutMs = timeoutMs;
          return { sessionId: 'session_1', result: { ok: true } };
        },
      },
    },
    async ({ runManifest }) => {
      const result = await runManifest({
        manifest: {
          id: 'manifest_3',
          protocol: {
            version: '1.0',
            steps: [{ id: 'build_geo_nodes', type: 'NODE_TREE', description: 'build', payload: {} }],
            done: true,
            final_message: 'ok',
          },
          assertions: {
            events: {
              requireEventTypes: ['protocol_node_tree'],
            },
            scene: {
              objects: [
                {
                  objectName: 'TST011_Cube',
                  modifierTypes: ['NODES'],
                  nodeTypes: ['NodeGroupInput', 'NodeGroupOutput'],
                },
              ],
            },
          },
          options: {
            requireActiveRpcSession: true,
            timeoutMs: 12345,
          },
        },
        repoRoot: __dirname,
        runDir: __dirname,
        settings: {},
      });

      assert.equal(result.ok, true);
      assert.equal(recorded.command, 'exec_python');
      assert.equal(recorded.timeoutMs, 12345);
      assert.equal(recorded.payload.mode, 'safe');
      assert.match(recorded.payload.code, /TST011_Cube/);
      assert.match(recorded.payload.code, /NodeGroupInput/);
    },
  );
});
