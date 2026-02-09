const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

const SESSION_PATH = path.resolve(__dirname, '../lib/blenderSessionManager.js');

const withMockedSessionManager = async (mocks, run) => {
  const originalLoad = Module._load;
  delete require.cache[SESSION_PATH];

  Module._load = function patchedLoader(request, parent, isMain) {
    if (parent && parent.filename === SESSION_PATH && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const mod = require(SESSION_PATH);
    return await run(mod);
  } finally {
    Module._load = originalLoad;
    delete require.cache[SESSION_PATH];
  }
};

test('blenderSessionManager audits safe-mode exec_python blocks', async () => {
  const auditEvents = [];
  let lastChild = null;

  const spawnStub = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 12345;
    child.kill = () => true;
    lastChild = child;
    return child;
  };

  const mocks = {
    'child_process': { spawn: spawnStub },
    './runStore': {
      getSettings: async () => ({
        blenderPath: 'blender',
        addonOutputPath: path.resolve(__dirname, '..', '..', 'generated_addons'),
      }),
    },
    './blenderRpcClient': {
      callBridge: async () => {
        const error = new Error('SAF-004 blocked module import in safe mode: os');
        error.statusCode = 403;
        error.payload = {
          code: 'SAF_004_BLOCKED_IMPORT',
          error: 'SAF-004 blocked module import in safe mode: os',
        };
        throw error;
      },
    },
    './utils': {
      killProcessTree: async () => {},
      nowIso: () => new Date(1700000000000).toISOString(),
    },
    './auditLog': {
      AUDIT_EVENT_TYPES: {
        EXEC_PYTHON_SAFE_BLOCKED: 'exec_python_safe_blocked',
      },
      appendAuditRecord: async (entry) => {
        auditEvents.push(entry);
      },
    },
  };

  await withMockedSessionManager(mocks, async (manager) => {
    const session = await manager.launchSession({ mode: 'headless' });
    assert.ok(session && session.id);
    assert.ok(lastChild);

    lastChild.stdout.emit('data', '[AETHER_RPC_READY] port=9999\n');

    try {
      await manager.executeRpc(
        session.id,
        'exec_python',
        { code: 'import os', mode: 'safe' },
        1000,
      );
      assert.fail('Expected executeRpc to throw');
    } catch (error) {
      assert.equal(error.statusCode, 403);
    }

    const sessionState = manager.getSession(session.id);
    const rpcFailed = sessionState.events.find(
      (event) => event.type === 'blender_rpc_call_failed' && event.command === 'exec_python',
    );
    assert.ok(rpcFailed);
  });

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].eventType, 'exec_python_safe_blocked');
  assert.equal(auditEvents[0].payload.command, 'exec_python');
  assert.equal(auditEvents[0].payload.mode, 'safe');
  assert.equal(auditEvents[0].payload.errorCode, 'SAF_004_BLOCKED_IMPORT');
});

test('blenderSessionManager audits safe-mode blocked builtins', async () => {
  const auditEvents = [];
  let lastChild = null;

  const spawnStub = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 45678;
    child.kill = () => true;
    lastChild = child;
    return child;
  };

  const mocks = {
    'child_process': { spawn: spawnStub },
    './runStore': {
      getSettings: async () => ({
        blenderPath: 'blender',
        addonOutputPath: path.resolve(__dirname, '..', '..', 'generated_addons'),
      }),
    },
    './blenderRpcClient': {
      callBridge: async () => {
        const error = new Error('SAF-004 blocked builtin in safe mode: open');
        error.statusCode = 403;
        error.payload = {
          code: 'SAF_004_BLOCKED_BUILTIN',
          error: 'SAF-004 blocked builtin in safe mode: open',
        };
        throw error;
      },
    },
    './utils': {
      killProcessTree: async () => {},
      nowIso: () => new Date(1700000000000).toISOString(),
    },
    './auditLog': {
      AUDIT_EVENT_TYPES: {
        EXEC_PYTHON_SAFE_BLOCKED: 'exec_python_safe_blocked',
      },
      appendAuditRecord: async (entry) => {
        auditEvents.push(entry);
      },
    },
  };

  await withMockedSessionManager(mocks, async (manager) => {
    const session = await manager.launchSession({ mode: 'headless' });
    assert.ok(session && session.id);
    assert.ok(lastChild);

    lastChild.stdout.emit('data', '[AETHER_RPC_READY] port=9999\n');

    await assert.rejects(
      manager.executeRpc(session.id, 'exec_python', { code: 'open("x")', mode: 'safe' }, 1000),
      (error) => error && error.statusCode === 403,
    );
  });

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].eventType, 'exec_python_safe_blocked');
  assert.equal(auditEvents[0].payload.errorCode, 'SAF_004_BLOCKED_BUILTIN');
  assert.equal(auditEvents[0].payload.mode, 'safe');
});
