const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

const EXECUTOR_PATH = path.resolve(__dirname, '../lib/executors/gnOpsExecutor.js');
const BRIDGE_PATH = path.resolve(__dirname, '../lib/executorBridge.js');

const withMockedExecutor = async (mocks, run) => {
  const originalLoad = Module._load;
  delete require.cache[EXECUTOR_PATH];
  delete require.cache[BRIDGE_PATH];

  Module._load = function patchedLoader(request, parent, isMain) {
    if (parent && parent.filename === BRIDGE_PATH && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const createGnOpsExecutor = require(EXECUTOR_PATH);
    return await run(createGnOpsExecutor);
  } finally {
    Module._load = originalLoad;
    delete require.cache[EXECUTOR_PATH];
    delete require.cache[BRIDGE_PATH];
  }
};

test('gn ops executor captures links and targets', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ops-'));
  const events = [];
  const artifacts = [];

  const payload = {
    target: {
      object_name: 'Cube',
      modifier_name: 'GeometryNodes',
    },
    ops: [
      {
        op: 'ensure_target',
        allow_create_modifier: true,
      },
      {
        op: 'add_node',
        id: 'gn_node_a',
        bl_idname: 'GeometryNode',
        x: 10,
        y: 20,
      },
      {
        op: 'set_input',
        node_id: 'gn_node_a',
        socket_name: 'Value',
        value: 3.14,
      },
      {
        op: 'cleanup_unused',
      },
    ],
  };

  await withMockedExecutor({}, async (createGnOpsExecutor) => {
    await createGnOpsExecutor().run({
      step: {
        id: 'gn_step',
        type: 'GN_OPS',
        payload,
      },
      artifactDir: tmpDir,
      repoRoot: tmpDir,
      logEvent: async (type, payload) => {
        events.push({ type, payload });
      },
      addArtifact: async (artifact) => {
        artifacts.push(artifact);
      },
    });
  });

  const artifactPath = path.join(tmpDir, 'gn_ops_state.json');
  const contents = JSON.parse(await fs.readFile(artifactPath, 'utf8'));

  assert.ok(events.some((event) => event.type === 'protocol_gn_ops'));
  const rpcSkipped = events.find((event) => event.type === 'protocol_rpc_skipped');
  assert.ok(rpcSkipped);
  assert.equal(rpcSkipped.payload.stepId, 'gn_step');
  assert.equal(rpcSkipped.payload.reason, 'no active Blender session');
  assert.equal(contents.targets['Cube:GeometryNodes'].allow_create_modifier, true);
  assert.ok(contents.nodes.gn_node_a);
  assert.equal(artifacts[0].kind, 'gn_ops');
});

test('gn ops executor logs rpc result when active session executes', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ops-'));
  const events = [];
  const artifacts = [];
  const executeCalls = [];

  const payload = {
    target: {
      object_name: 'Cube',
      modifier_name: 'GeometryNodes',
    },
    ops: [{ op: 'ensure_target', allow_create_modifier: true }],
  };

  await withMockedExecutor(
    {
      './blenderSessionManager': {
        getActiveSession: () => ({ id: 'session_rpc' }),
        executeOnActive: async (command, payload, timeoutMs) => {
          executeCalls.push({ command, payload, timeoutMs });
          return { sessionId: 'session_rpc', result: { ok: true } };
        },
      },
    },
    async (createGnOpsExecutor) => {
      await createGnOpsExecutor().run({
        step: {
          id: 'gn_step',
          type: 'GN_OPS',
          payload,
        },
        artifactDir: tmpDir,
        repoRoot: tmpDir,
        logEvent: async (type, payload) => {
          events.push({ type, payload });
        },
        addArtifact: async (artifact) => {
          artifacts.push(artifact);
        },
      });
    },
  );

  const rpcResult = events.find((event) => event.type === 'protocol_rpc_result');
  assert.ok(rpcResult);
  assert.equal(rpcResult.payload.stepId, 'gn_step');
  assert.equal(rpcResult.payload.result.sessionId, 'session_rpc');
  assert.equal(executeCalls[0].command, 'exec_python');
  assert.equal(executeCalls[0].payload.mode, 'safe');
  assert.match(executeCalls[0].payload.code, /node_tree\.nodes\.new/);
  assert.equal(/GN_OPS_STEP/.test(executeCalls[0].payload.code), false);
  assert.equal(events.some((event) => event.type === 'protocol_rpc_skipped'), false);
  assert.equal(artifacts[0].kind, 'gn_ops');
});

test('gn ops executor logs cancel escalation when cancel handler triggers', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ops-'));
  const events = [];
  const stopCalls = [];
  let cancelPromise;

  const payload = {
    target: {
      object_name: 'Cube',
      modifier_name: 'GeometryNodes',
    },
    ops: [{ op: 'ensure_target', allow_create_modifier: true }],
  };

  await withMockedExecutor(
    {
      './blenderSessionManager': {
        getActiveSession: () => ({ id: 'session_rpc' }),
        executeOnActive: async () => ({ sessionId: 'session_rpc', result: { ok: true } }),
        stopSession: async (sessionId) => {
          stopCalls.push(sessionId);
        },
      },
    },
    async (createGnOpsExecutor) => {
      await createGnOpsExecutor().run({
        step: {
          id: 'gn_step',
          type: 'GN_OPS',
          payload,
        },
        artifactDir: tmpDir,
        repoRoot: tmpDir,
        logEvent: async (type, payload) => {
          events.push({ type, payload });
        },
        registerCancelHandler: (handler) => {
          cancelPromise = handler();
          return () => {};
        },
      });
    },
  );

  await cancelPromise;
  const cancelEscalated = events.find(
    (event) => event.type === 'protocol_rpc_cancel_escalated',
  );
  assert.ok(cancelEscalated);
  assert.equal(cancelEscalated.payload.stepId, 'gn_step');
  assert.equal(cancelEscalated.payload.sessionId, 'session_rpc');
  assert.deepStrictEqual(stopCalls, ['session_rpc']);
});
