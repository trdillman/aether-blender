const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

const EXECUTOR_PATH = path.resolve(__dirname, '../lib/executors/nodeTreeExecutor.js');
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
    const createNodeTreeExecutor = require(EXECUTOR_PATH);
    return await run(createNodeTreeExecutor);
  } finally {
    Module._load = originalLoad;
    delete require.cache[EXECUTOR_PATH];
    delete require.cache[BRIDGE_PATH];
  }
};

test('node tree executor serializes operations and records artifact', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-tree-'));
  const events = [];
  const artifacts = [];

  const payload = {
    target: {
      object_name: 'Cube',
      modifier_name: 'GeometryNodes',
      node_group_name: 'GN_Group',
    },
    operations: [
      {
        op: 'create_node',
        node_id: 'node_a',
        bl_idname: 'GeometryNode',
        location: [0, 0],
      },
      {
        op: 'create_node',
        node_id: 'node_b',
        bl_idname: 'GeometryNode',
        location: [1, 1],
      },
      {
        op: 'link',
        from: { node_id: 'node_a', socket: 'Geometry' },
        to: { node_id: 'node_b', socket: 'Geometry' },
      },
      {
        op: 'set_property',
        node_id: 'node_a',
        property: 'color',
        value: 'blue',
      },
      {
        op: 'set_input_default',
        node_id: 'node_b',
        socket: 'Value',
        value: 42,
      },
    ],
  };

  await withMockedExecutor({}, async (createNodeTreeExecutor) => {
    await createNodeTreeExecutor().run({
      step: {
        id: 'node_step',
        type: 'NODE_TREE',
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

  const artifactPath = path.join(tmpDir, 'node_tree_state.json');
  const contents = JSON.parse(await fs.readFile(artifactPath, 'utf8'));

  assert.ok(events.some((event) => event.type === 'protocol_node_tree'));
  const rpcSkipped = events.find((event) => event.type === 'protocol_rpc_skipped');
  assert.ok(rpcSkipped);
  assert.equal(rpcSkipped.payload.stepId, 'node_step');
  assert.equal(rpcSkipped.payload.reason, 'no active Blender session');
  assert.ok(contents.nodes.node_a);
  assert.deepStrictEqual(contents.links[0].from.node_id, 'node_a');
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'node_tree');
});

test('node tree executor logs rpc error when active session fails', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-tree-'));
  const events = [];

  const payload = {
    target: {
      object_name: 'Cube',
      modifier_name: 'GeometryNodes',
      node_group_name: 'GN_Group',
    },
    operations: [
      {
        op: 'create_node',
        node_id: 'node_a',
        bl_idname: 'GeometryNode',
        location: [0, 0],
      },
    ],
  };

  await assert.rejects(
    withMockedExecutor(
      {
        './blenderSessionManager': {
          getActiveSession: () => ({ id: 'session_rpc' }),
          executeOnActive: async () => {
            throw new Error('RPC failed');
          },
        },
      },
      async (createNodeTreeExecutor) => {
        await createNodeTreeExecutor().run({
          step: {
            id: 'node_step',
            type: 'NODE_TREE',
            payload,
          },
          artifactDir: tmpDir,
          repoRoot: tmpDir,
          logEvent: async (type, payload) => {
            events.push({ type, payload });
          },
        });
      },
    ),
    /RPC failed/i,
  );

  const rpcError = events.find((event) => event.type === 'protocol_rpc_error');
  assert.ok(rpcError);
  assert.equal(rpcError.payload.stepId, 'node_step');
  assert.match(String(rpcError.payload.error || ''), /RPC failed/i);
  assert.equal(events.some((event) => event.type === 'protocol_rpc_result'), false);
  assert.equal(events.some((event) => event.type === 'protocol_node_tree'), false);
});

test('node tree executor logs cancel escalation when cancel handler triggers', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-tree-'));
  const events = [];
  const stopCalls = [];
  const executeCalls = [];
  let cancelPromise;

  const payload = {
    target: {
      object_name: 'Cube',
      modifier_name: 'GeometryNodes',
      node_group_name: 'GN_Group',
    },
    operations: [
      {
        op: 'create_node',
        node_id: 'node_a',
        bl_idname: 'GeometryNode',
        location: [0, 0],
      },
    ],
  };

  await withMockedExecutor(
    {
      './blenderSessionManager': {
        getActiveSession: () => ({ id: 'session_rpc' }),
        executeOnActive: async (command, payload, timeoutMs) => {
          executeCalls.push({ command, payload, timeoutMs });
          return { sessionId: 'session_rpc', result: { ok: true } };
        },
        stopSession: async (sessionId) => {
          stopCalls.push(sessionId);
        },
      },
    },
    async (createNodeTreeExecutor) => {
      await createNodeTreeExecutor().run({
        step: {
          id: 'node_step',
          type: 'NODE_TREE',
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
  assert.equal(cancelEscalated.payload.stepId, 'node_step');
  assert.equal(cancelEscalated.payload.sessionId, 'session_rpc');
  assert.deepStrictEqual(stopCalls, ['session_rpc']);
  assert.equal(executeCalls[0].command, 'exec_python');
  assert.equal(executeCalls[0].payload.mode, 'safe');
  assert.match(executeCalls[0].payload.code, /node_tree\.nodes\.new/);
  assert.equal(/NODE_TREE_STEP/.test(executeCalls[0].payload.code), false);
});
