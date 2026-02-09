const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ORCHESTRATOR_PATH = path.resolve(__dirname, '../lib/runOrchestrator.js');
const FINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

const clone = (value) => JSON.parse(JSON.stringify(value));

const createRunStoreMock = (settings) => {
  const runs = new Map();
  const state = {
    settings: {
      blenderPath: 'blender',
      runMode: 'headless',
      timeoutMs: 120000,
      workspacePath: '.',
      addonOutputPath: '.',
      ...(settings || {}),
    },
  };

  return {
    ensureInitialized: async () => {},
    getSettings: async () => clone(state.settings),
    putSettings: async (next) => {
      state.settings = { ...state.settings, ...(next || {}) };
      return clone(state.settings);
    },
    createOrUpsertRun: async (run) => {
      runs.set(String(run.id), clone(run));
      return clone(run);
    },
    getRun: async (id) => {
      const found = runs.get(String(id));
      return found ? clone(found) : null;
    },
    listRuns: async () => [...runs.values()].map((run) => clone(run)),
  };
};

const createFsMock = () => ({
  mkdir: async () => {},
  readdir: async () => [
    {
      name: 'operators.py',
      isDirectory: () => false,
      isFile: () => true,
    },
  ],
  copyFile: async () => {},
  readFile: async () => 'print("stub")\n',
  writeFile: async () => {},
});

const createTestContext = ({
  settings,
  activeSession,
  executeOnActiveImpl,
  runBlenderImpl,
  protocolPlanImpl,
} = {}) => {
  let tick = 0;
  const nowIso = () => new Date(1700000000000 + tick++ * 1000).toISOString();
  const runStore = createRunStoreMock(settings);
  const auditEvents = [];
  const stopSessionCalls = [];

  const blenderSessionManager = {
    getActiveSession: () => (activeSession ? clone(activeSession) : null),
    executeOnActive: executeOnActiveImpl || (async () => ({ sessionId: 'session_default', result: {} })),
    stopSession: async (id) => {
      stopSessionCalls.push(String(id));
      return { id: String(id) };
    },
  };

  const runBlenderCalls = [];
  const runBlender = runBlenderImpl
    ? (...args) => runBlenderImpl(runBlenderCalls, ...args)
    : (...args) => {
        runBlenderCalls.push(args[0]);
        const params = args[0];
        if (params && typeof params.onStarted === 'function') {
          params.onStarted({
            pid: 111,
            mode: params.mode,
            command: 'blender -b ...',
            args: ['-b'],
          });
        }
        if (params && typeof params.onLog === 'function') {
          params.onLog({ stream: 'stdout', line: 'fallback path' });
        }
        return {
          child: { pid: 111 },
          cancel: async () => {},
          done: Promise.resolve({ ok: true, code: 0, signal: null, error: null }),
        };
      };

  const mocks = {
    'fs/promises': createFsMock(),
    './runStore': runStore,
    './settingsService': {
      redactSettings: (value) => value,
      normalizeIncomingSettings: (incoming) => incoming,
      validateSettings: async () => ({ valid: true, errors: [] }),
      checkBlenderExecutable: async () => ({ ok: true }),
    },
    './utils': {
      nowIso,
      killProcessTree: async () => {},
    },
    './llmService': {
      generateProtocolPlan: protocolPlanImpl || (async ({ onToolEvent }) => {
        if (typeof onToolEvent === 'function') {
          onToolEvent({
            tool: 'mock_llm',
            provider: 'mock_provider',
            model: 'mock_model',
            message: 'generated',
            fallback: false,
          });
        }
        return {
          content: '{"version":"1.0","steps":[],"done":true,"final_message":"plan content","meta":{"requires_gate_verification":true}}',
          provider: 'mock_provider',
          model: 'mock_model',
          usedFallback: false,
          protocol: {
            version: '1.0',
            steps: [],
            done: true,
            final_message: 'plan content',
            meta: { requires_gate_verification: true },
          },
        };
      }),
      generateAddonSpec: async () => ({
        content: '{"addonName":"Mock Addon"}',
        provider: 'mock_provider',
        model: 'mock_model',
        usedFallback: false,
        spec: {
          addonName: 'Mock Addon',
          panelLabel: 'Mock Panel',
          operatorLabel: 'Mock Operator',
          operatorIdName: 'aether.mock_operator',
          operatorMessage: 'Mock execution message',
          summary: 'Mock summary',
        },
      }),
      pingProvider: async () => ({ ok: true }),
    },
    './blenderRunner': { runBlender },
    './blenderSessionManager': blenderSessionManager,
    './auditLog': {
      AUDIT_EVENT_TYPES: {
        GATE_FAILURE: 'gate_failure',
        RUN_TERMINAL_STATE: 'run_terminal_state',
      },
      appendAuditRecord: async (entry) => {
        auditEvents.push(clone(entry));
      },
    },
  };

  return {
    runStore,
    nowIso,
    mocks,
    runBlenderCalls,
    blenderSessionManager,
    auditEvents,
    stopSessionCalls,
  };
};

const withMockedOrchestrator = async (mocks, run) => {
  const originalLoad = Module._load;
  delete require.cache[ORCHESTRATOR_PATH];

  Module._load = function patchedLoader(request, parent, isMain) {
    if (parent && parent.filename === ORCHESTRATOR_PATH && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const orchestrator = require(ORCHESTRATOR_PATH);
    return await run(orchestrator);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ORCHESTRATOR_PATH];
  }
};

const waitForFinalRun = async (orchestrator, runId, timeoutMs = 1000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await orchestrator.getRun(runId);
    if (run && FINAL_STATUSES.has(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for run ${runId} to complete`);
};

const waitForEventType = async (orchestrator, runId, eventType, timeoutMs = 1000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await orchestrator.getRun(runId);
    if (run && Array.isArray(run.events) && run.events.some((evt) => evt.type === eventType)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${eventType} on run ${runId}`);
};

test('runOrchestrator prefers active ready Blender RPC session for validation', async () => {
  let executeCall = null;
  const ctx = createTestContext({
    settings: { timeoutMs: 4321 },
    activeSession: {
      id: 'session_abc',
      status: 'running',
      supportsRpc: true,
      rpcReady: true,
    },
    executeOnActiveImpl: async (command, payload, timeoutMs) => {
      executeCall = { command, payload: clone(payload), timeoutMs };
      return { sessionId: 'session_abc', result: { ok: true } };
    },
  });

  await withMockedOrchestrator(ctx.mocks, async (orchestrator) => {
    const started = await orchestrator.startRun({ prompt: 'test prompt', model: 'GLM 4.7' });
    const run = await waitForFinalRun(orchestrator, started.id);

    assert.equal(run.status, 'completed');
    assert.deepEqual(executeCall, {
      command: 'validate_addon',
      payload: { addonPath: path.join(path.resolve(__dirname, '..', '..'), 'generated_addons', 'runs', started.id, 'scaffold') },
      timeoutMs: 4321,
    });
    assert.equal(ctx.runBlenderCalls.length, 0);

    const rpcStarted = run.events.find((evt) => evt.type === 'blender_started' && evt.mode === 'rpc_session');
    assert.ok(rpcStarted);
    assert.equal(rpcStarted.sessionId, 'session_abc');
    assert.ok(run.events.some((evt) => evt.type === 'blender_rpc_call' && evt.sessionId === 'session_abc'));
    assert.ok(run.events.some((evt) => evt.type === 'blender_rpc_result' && evt.ok === true));
    const startedEvent = run.events.find((evt) => evt.type === 'run_started');
    assert.ok(startedEvent);
    assert.equal(startedEvent.taxonomy, 'run.lifecycle.started');
    assert.equal(startedEvent.correlation.runCorrelationId, `run:${started.id}`);
    assert.equal(startedEvent.correlation.stepCorrelationId, null);
    assert.equal(run.steps.validation.status, 'completed');
    assert.ok(
      ctx.auditEvents.some(
        (evt) => evt.eventType === 'run_terminal_state' && evt.payload && evt.payload.status === 'completed',
      ),
    );
  });
});

test('runOrchestrator falls back to runBlender when active session is not RPC-ready', async () => {
  let executeOnActiveCalls = 0;
  const ctx = createTestContext({
    activeSession: {
      id: 'session_not_ready',
      status: 'running',
      supportsRpc: true,
      rpcReady: false,
    },
    executeOnActiveImpl: async () => {
      executeOnActiveCalls += 1;
      return { sessionId: 'session_not_ready', result: {} };
    },
  });

  await withMockedOrchestrator(ctx.mocks, async (orchestrator) => {
    const started = await orchestrator.startRun({ prompt: 'test prompt', model: 'GLM 4.7' });
    const run = await waitForFinalRun(orchestrator, started.id);

    assert.equal(run.status, 'completed');
    assert.equal(executeOnActiveCalls, 0);
    assert.equal(ctx.runBlenderCalls.length, 1);
    assert.ok(run.events.some((evt) => evt.type === 'blender_started' && evt.mode === 'headless'));
    assert.equal(run.steps.validation.status, 'completed');
  });
});

test('cancelRun cancels run while RPC validation call is still in-flight', async () => {
  const ctx = createTestContext({
    activeSession: {
      id: 'session_hanging',
      status: 'running',
      supportsRpc: true,
      rpcReady: true,
    },
    executeOnActiveImpl: async () => new Promise(() => {}),
  });

  await withMockedOrchestrator(ctx.mocks, async (orchestrator) => {
    const started = await orchestrator.startRun({ prompt: 'test prompt', model: 'GLM 4.7' });
    await waitForEventType(orchestrator, started.id, 'blender_rpc_call');

    await orchestrator.cancelRun(started.id);
    const run = await waitForFinalRun(orchestrator, started.id);

    assert.equal(run.status, 'cancelled');
    assert.match(String(run.error || ''), /cancelled/i);
    assert.equal(run.cancelRequested, true);
    assert.ok(run.cancelRequestedAt);
    assert.equal(run.steps.validation.status, 'failed');
    assert.ok(run.events.some((evt) => evt.type === 'blender_rpc_result' && evt.ok === false));
    assert.ok(run.events.some((evt) => evt.type === 'run_failed' && evt.cancelled === true));
    assert.equal(run.events.some((evt) => evt.type === 'run_completed'), false);
    assert.deepEqual(ctx.stopSessionCalls, ['session_hanging']);
    assert.equal(ctx.runBlenderCalls.length, 0);
    assert.ok(
      ctx.auditEvents.some(
        (evt) =>
          evt.eventType === 'run_terminal_state' &&
          evt.payload &&
          evt.payload.status === 'cancelled' &&
          evt.payload.cancelled === true,
      ),
    );
  });
});

test('runOrchestrator fails with verification gate envelope when protocol requires gate but done=false', async () => {
  const ctx = createTestContext({
    protocolPlanImpl: async () => ({
      content:
        '{"version":"1.0","steps":[],"done":false,"final_message":"still working","meta":{"requires_gate_verification":true}}',
      provider: 'mock_provider',
      model: 'mock_model',
      usedFallback: false,
      protocol: {
        version: '1.0',
        steps: [],
        done: false,
        final_message: 'still working',
        meta: { requires_gate_verification: true },
      },
    }),
  });

  await withMockedOrchestrator(ctx.mocks, async (orchestrator) => {
    const started = await orchestrator.startRun({ prompt: 'test prompt', model: 'GLM 4.7' });
    const run = await waitForFinalRun(orchestrator, started.id);

    assert.equal(run.status, 'failed');
    assert.match(String(run.error || ''), /protocol\.done must be true/i);
    assert.equal(run.steps.validation.status, 'completed');

    const gateEvent = run.events.find((evt) => evt.type === 'verification_gate');
    assert.ok(gateEvent);
    assert.equal(gateEvent.success, false);
    assert.deepEqual(gateEvent.failed_gates, ['DONE_REQUIRED']);
    assert.ok(
      ctx.auditEvents.some(
        (evt) =>
          evt.eventType === 'gate_failure' &&
          evt.payload &&
          Array.isArray(evt.payload.failed_gates) &&
          evt.payload.failed_gates.includes('DONE_REQUIRED'),
      ),
    );
    assert.ok(
      ctx.auditEvents.some(
        (evt) => evt.eventType === 'run_terminal_state' && evt.payload && evt.payload.status === 'failed',
      ),
    );
  });
});

test('runOrchestrator does not emit verification gate when required gate passes', async () => {
  const ctx = createTestContext();

  await withMockedOrchestrator(ctx.mocks, async (orchestrator) => {
    const started = await orchestrator.startRun({ prompt: 'test prompt', model: 'GLM 4.7' });
    const run = await waitForFinalRun(orchestrator, started.id);

    assert.equal(run.status, 'completed');
    assert.equal(run.steps.validation.status, 'completed');
    assert.equal(run.events.some((evt) => evt.type === 'verification_gate'), false);
  });
});

test('runOrchestrator emits BLENDER_VALIDATION gate envelope when validation step fails', async () => {
  const validationFailure = new Error('Blender validation exploded');
  const ctx = createTestContext({
    runBlenderImpl: (runBlenderCalls, params) => {
      runBlenderCalls.push(params);
      if (params && typeof params.onStarted === 'function') {
        params.onStarted({
          pid: 222,
          mode: params.mode,
          command: 'blender -b ...',
          args: ['-b'],
        });
      }
      return {
        child: { pid: 222 },
        cancel: async () => {},
        done: Promise.resolve({ ok: false, code: 1, signal: null, error: validationFailure }),
      };
    },
  });

  await withMockedOrchestrator(ctx.mocks, async (orchestrator) => {
    const started = await orchestrator.startRun({ prompt: 'test prompt', model: 'GLM 4.7' });
    const run = await waitForFinalRun(orchestrator, started.id);

    assert.equal(run.status, 'failed');
    assert.equal(run.steps.validation.status, 'failed');

    const gateEvent = run.events.find((evt) => evt.type === 'verification_gate');
    assert.ok(gateEvent);
    assert.equal(gateEvent.success, false);
    assert.deepEqual(gateEvent.failed_gates, ['BLENDER_VALIDATION']);
    assert.match(String(gateEvent.messages && gateEvent.messages[0]), /Blender validation exploded/i);
  });
});
