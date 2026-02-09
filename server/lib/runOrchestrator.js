const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const runStore = require('./runStore');
const {
  redactSettings,
  normalizeIncomingSettings,
  validateSettings,
  checkBlenderExecutable,
} = require('./settingsService');
const { nowIso } = require('./utils');
const { generateProtocolPlan, generateAddonSpec, pingProvider } = require('./llmService');
const { runBlender } = require('./blenderRunner');
const blenderSessionManager = require('./blenderSessionManager');
const { appendAuditRecord, AUDIT_EVENT_TYPES } = require('./auditLog');
const { executeProtocolPlan } = require('./protocolExecutor');
const { resolveEventTaxonomy, buildCorrelation } = require('./telemetry');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAFFOLD_DIR = path.join(REPO_ROOT, 'scaffold');
const HARNESS_PATH = path.join(REPO_ROOT, 'test_harness.py');
const RUNS_DIR = path.join(REPO_ROOT, 'generated_addons', 'runs');
const FINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

const activeExecutions = new Map();
const subscribers = new Set();

const clone = (value) => JSON.parse(JSON.stringify(value));

const createRunId = () => {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(3).toString('hex');
  return `run_${stamp}_${rand}`;
};

const eventId = () => `evt_${crypto.randomBytes(4).toString('hex')}`;
const traceId = () => `trace_${crypto.randomBytes(6).toString('hex')}`;
const spanId = () => `span_${crypto.randomBytes(4).toString('hex')}`;

const createRun = ({ prompt, model }) => {
  const createdAt = nowIso();
  return {
    id: createRunId(),
    prompt: String(prompt || ''),
    model: String(model || ''),
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    cancelRequested: false,
    cancelRequestedAt: null,
    error: null,
    events: [],
    logLines: [],
    artifacts: [],
    protocol: null,
    steps: {},
    trace: {
      traceId: traceId(),
    },
  };
};

const ensureInitialized = async () => {
  await runStore.ensureInitialized();
  await fs.mkdir(RUNS_DIR, { recursive: true });
};

const getStep = (run, stepId) => {
  if (!run.steps[stepId]) {
    run.steps[stepId] = {
      id: stepId,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      durationMs: null,
      error: null,
    };
  }
  return run.steps[stepId];
};

const syncRun = async (run) => {
  await runStore.createOrUpsertRun(run);
};

const emit = (run, evt) => {
  const snapshot = {
    id: run.id,
    status: run.status,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    cancelRequested: run.cancelRequested,
    steps: run.steps,
    artifacts: run.artifacts,
    protocol: run.protocol,
    error: run.error,
    prompt: run.prompt,
    model: run.model,
  };

  const payload = {
    ...evt,
    run: snapshot,
  };

  for (const listener of subscribers) {
    try {
      listener(payload);
    } catch {
      // Ignore subscriber failures and continue.
    }
  }
};

const appendEvent = async (run, type, payload) => {
  const stepId =
    payload && typeof payload.stepId === 'string' && payload.stepId.trim()
      ? payload.stepId.trim()
      : '';
  const evt = {
    id: eventId(),
    type,
    runId: run.id,
    timestamp: nowIso(),
    taxonomy: resolveEventTaxonomy(type),
    correlation: buildCorrelation({
      runId: run.id,
      stepId,
    }),
    ...(payload || {}),
  };

  run.events.push(evt);
  run.updatedAt = evt.timestamp;

  if (type === 'blender_log') {
    run.logLines.push({
      timestamp: evt.timestamp,
      stream: evt.stream || 'stdout',
      line: evt.line || '',
    });
  }

  await syncRun(run);
  emit(run, evt);
  return evt;
};

const emitTraceSpan = async (run, {
  name,
  component,
  stepId,
  parentSpanId = null,
  status = 'ok',
  startedAt,
  attributes,
  error,
} = {}) => {
  const startIso = startedAt || nowIso();
  const endIso = nowIso();
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, endMs - startMs)
    : 0;

  await appendEvent(run, 'trace_span', {
    traceId: run.trace && run.trace.traceId ? run.trace.traceId : null,
    spanId: spanId(),
    parentSpanId: parentSpanId || null,
    name: String(name || 'span'),
    component: String(component || 'unknown'),
    status: status === 'error' ? 'error' : 'ok',
    startedAt: startIso,
    endedAt: endIso,
    durationMs,
    stepId: stepId || null,
    attributes: attributes && typeof attributes === 'object' ? attributes : {},
    error: error ? String(error) : null,
  });
};

const startStep = async (run, stepId, name) => {
  const step = getStep(run, stepId);
  step.status = 'running';
  step.startedAt = nowIso();
  step.completedAt = null;
  step.durationMs = null;
  step.error = null;

  await appendEvent(run, 'step_started', {
    stepId,
    stepName: name,
  });
};

const completeStep = async (run, stepId, name, extra) => {
  const step = getStep(run, stepId);
  const completedAt = nowIso();
  step.status = 'completed';
  step.completedAt = completedAt;
  const startMs = step.startedAt ? Date.parse(step.startedAt) : null;
  step.durationMs = Number.isFinite(startMs) ? Math.max(0, Date.parse(completedAt) - startMs) : null;

  await appendEvent(run, 'step_completed', {
    stepId,
    stepName: name,
    durationMs: step.durationMs,
    ...(extra || {}),
  });
};

const failStep = (run, stepId, error) => {
  const step = getStep(run, stepId);
  step.status = 'failed';
  step.completedAt = nowIso();
  const startMs = step.startedAt ? Date.parse(step.startedAt) : null;
  step.durationMs = Number.isFinite(startMs) ? Math.max(0, Date.parse(step.completedAt) - startMs) : null;
  step.error = String(error && error.message ? error.message : error || 'Unknown error');
};

const addArtifact = async (run, artifact) => {
  run.artifacts.push({
    createdAt: nowIso(),
    ...(artifact || {}),
  });
  await syncRun(run);
};

const copyDirectoryRecursive = async (source, target) => {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const dstPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, dstPath);
      continue;
    }

    if (entry.isFile()) {
      await fs.copyFile(srcPath, dstPath);
    }
  }
};

const deterministicScaffoldUpdate = async ({ run, runAddonPath, llmPlan, addonSpec }) => {
  const operatorsPath = path.join(runAddonPath, 'operators.py');
  const panelsPath = path.join(runAddonPath, 'panels.py');
  const initPath = path.join(runAddonPath, '__init__.py');
  const summaryFile = path.join(runAddonPath, 'RUN_METADATA.txt');
  const digest = crypto
    .createHash('sha1')
    .update(`${run.prompt}|${run.model}|${llmPlan.content}`)
    .digest('hex')
    .slice(0, 12);

  const operatorBody = [
    'import bpy',
    '',
    'class AETHER_OT_example(bpy.types.Operator):',
    `    bl_idname = "${addonSpec.operatorIdName}"`,
    `    bl_label = "${addonSpec.operatorLabel.replace(/"/g, "'")}"`,
    '    ',
    '    def execute(self, context):',
    `        self.report({'INFO'}, "${addonSpec.operatorMessage.replace(/"/g, "'")}")`,
    "        return {'FINISHED'}",
    '',
  ].join('\n');
  await fs.writeFile(operatorsPath, operatorBody, 'utf8');

  const panelBody = [
    'import bpy',
    '',
    'class AETHER_PT_main_panel(bpy.types.Panel):',
    `    bl_label = "${addonSpec.panelLabel.replace(/"/g, "'")}"`,
    '    bl_idname = "AETHER_PT_main_panel"',
    "    bl_space_type = 'VIEW_3D'",
    "    bl_region_type = 'UI'",
    "    bl_category = 'Aether'",
    '',
    '    def draw(self, context):',
    '        layout = self.layout',
    `        layout.operator("${addonSpec.operatorIdName}", icon='PLAY')`,
    '',
  ].join('\n');
  await fs.writeFile(panelsPath, panelBody, 'utf8');

  const initOriginal = await fs.readFile(initPath, 'utf8');
  const initUpdated = initOriginal.replace(/"name":\s*"[^"]*"/, `"name": "${addonSpec.addonName.replace(/"/g, "'")}"`);
  await fs.writeFile(initPath, initUpdated, 'utf8');

  const metadataBody = [
    `run_id=${run.id}`,
    `model=${run.model}`,
    `status_seed=${digest}`,
    `provider=${llmPlan.provider}`,
    `resolved_model=${llmPlan.model}`,
    `fallback=${llmPlan.usedFallback ? 'true' : 'false'}`,
    '',
    'plan:',
    llmPlan.content,
    '',
    'addon_spec:',
    JSON.stringify(addonSpec, null, 2),
    '',
  ].join('\n');

  await fs.writeFile(summaryFile, metadataBody, 'utf8');

  await addArtifact(run, {
    kind: 'file',
    path: path.relative(REPO_ROOT, panelsPath),
    description: 'Generated panel behavior from prompt-derived addon spec.',
  });

  await addArtifact(run, {
    kind: 'file',
    path: path.relative(REPO_ROOT, initPath),
    description: 'Updated addon metadata name from prompt-derived addon spec.',
  });

  await addArtifact(run, {
    kind: 'file',
    path: path.relative(REPO_ROOT, operatorsPath),
    description: 'Generated operator behavior from prompt-derived addon spec.',
  });

  await addArtifact(run, {
    kind: 'file',
    path: path.relative(REPO_ROOT, summaryFile),
    description: 'Run metadata + deterministic plan output.',
  });
};

const finalizeRun = async (run, status, errorMessage) => {
  const completedAt = nowIso();
  run.status = status;
  run.completedAt = completedAt;
  run.updatedAt = completedAt;
  run.error = errorMessage || null;

  const startMs = run.startedAt ? Date.parse(run.startedAt) : null;
  run.durationMs = Number.isFinite(startMs) ? Math.max(0, Date.parse(completedAt) - startMs) : null;

  if (status === 'completed') {
    await appendEvent(run, 'run_completed', {
      durationMs: run.durationMs,
      artifactCount: run.artifacts.length,
      logLineCount: run.logLines.length,
    });
  } else {
    await appendEvent(run, 'run_failed', {
      durationMs: run.durationMs,
      error: errorMessage || 'Run failed.',
      cancelled: status === 'cancelled',
    });
  }

  try {
    await appendAuditRecord({
      eventType: AUDIT_EVENT_TYPES.RUN_TERMINAL_STATE,
      payload: {
        runId: run.id,
        status,
        durationMs: run.durationMs,
        cancelled: status === 'cancelled',
        error: errorMessage || null,
      },
      actor: 'orchestrator',
      source: 'runOrchestrator',
    });
  } catch {
    // Audit logging must not break run execution.
  }
};

const assertNotCancelled = (run) => {
  const active = activeExecutions.get(run.id);
  if (run.cancelRequested || (active && active.cancelRequested)) {
    const error = new Error('Run cancelled by user request.');
    error.code = 'RUN_CANCELLED';
    throw error;
  }
};

const createCancelledError = () => {
  const error = new Error('Run cancelled by user request.');
  error.code = 'RUN_CANCELLED';
  return error;
};

const createGateEnvelope = ({ failedGates, messages }) => ({
  success: false,
  failed_gates: Array.isArray(failedGates) ? failedGates : [],
  messages: Array.isArray(messages) ? messages : [],
});

const registerCancelHandler = (run, handler) => {
  if (!run || typeof handler !== 'function') {
    return () => {};
  }
  const active = activeExecutions.get(run.id);
  if (!active) {
    return () => {};
  }
  if (!active.cancelHandlers) {
    active.cancelHandlers = new Set();
  }
  active.cancelHandlers.add(handler);
  return () => {
    if (active.cancelHandlers) {
      active.cancelHandlers.delete(handler);
    }
  };
};

const executeWithCancellation = async (run, promise) => {
  assertNotCancelled(run);
  const active = activeExecutions.get(run.id);
  if (!active) {
    return promise;
  }

  let listener = null;
  const cancelPromise = new Promise((_, reject) => {
    listener = () => reject(createCancelledError());
    if (!active.cancelListeners) {
      active.cancelListeners = new Set();
    }
    active.cancelListeners.add(listener);
  });

  try {
    return await Promise.race([promise, cancelPromise]);
  } finally {
    if (listener && active.cancelListeners) {
      active.cancelListeners.delete(listener);
    }
  }
};

const executeRun = async (runId) => {
  const run = await runStore.getRun(runId);
  if (!run) {
    return;
  }

  const settings = await runStore.getSettings();

  run.status = 'running';
  run.startedAt = nowIso();
  run.updatedAt = run.startedAt;
  await syncRun(run);

  await appendEvent(run, 'run_started', {
    model: run.model,
    promptLength: run.prompt.length,
  });

  const runDir = path.join(RUNS_DIR, run.id);
  const runAddonPath = path.join(runDir, 'scaffold');

  await addArtifact(run, {
    kind: 'directory',
    path: path.relative(REPO_ROOT, runDir),
    description: 'Per-run snapshot root.',
  });

  let protocolPlan = null;
  let gateEventEmitted = false;
  const emitGateFailure = async (envelope) => {
    if (gateEventEmitted) {
      return;
    }
    gateEventEmitted = true;
    await appendEvent(run, 'verification_gate', envelope);
    try {
      await appendAuditRecord({
        eventType: AUDIT_EVENT_TYPES.GATE_FAILURE,
        payload: {
          runId: run.id,
          failed_gates: Array.isArray(envelope && envelope.failed_gates) ? envelope.failed_gates : [],
          messages: Array.isArray(envelope && envelope.messages) ? envelope.messages : [],
        },
        actor: 'orchestrator',
        source: 'runOrchestrator',
      });
    } catch {
      // Audit logging must not break run execution.
    }
  };

  try {
    assertNotCancelled(run);

    await startStep(run, 'generation', 'Generate and patch scaffold');

    await fs.mkdir(runDir, { recursive: true });
    await copyDirectoryRecursive(SCAFFOLD_DIR, runAddonPath);

    await addArtifact(run, {
      kind: 'directory',
      path: path.relative(REPO_ROOT, runAddonPath),
      description: 'Copied scaffold snapshot used for validation.',
    });

    protocolPlan = await generateProtocolPlan({
      prompt: run.prompt,
      model: run.model,
      settings,
      operation: 'generate_protocol_plan',
      onToolEvent: (evt) => {
        appendEvent(run, 'tool_called', {
          tool: evt.tool,
          provider: evt.provider,
          model: evt.model,
          fallback: Boolean(evt.fallback),
          reason: evt.reason || '',
          message: evt.message || '',
        }).catch(() => {});
      },
      onTraceSpan: (span) => {
        emitTraceSpan(run, {
          ...span,
          stepId: span && span.stepId ? span.stepId : 'generation',
        }).catch(() => {});
      },
    });
    run.protocol = protocolPlan && protocolPlan.protocol ? protocolPlan.protocol : null;
    await syncRun(run);
    await appendEvent(run, 'assistant_message', {
      content: `Protocol plan generated with ${protocolPlan.protocol.steps.length} step(s).`,
    });

    const addonSpecResult = await generateAddonSpec({
      prompt: run.prompt,
      model: run.model,
      settings,
      operation: 'generate_addon_spec',
      onToolEvent: (evt) => {
        appendEvent(run, 'tool_called', {
          tool: evt.tool,
          provider: evt.provider,
          model: evt.model,
          fallback: Boolean(evt.fallback),
          reason: evt.reason || '',
          message: evt.message || '',
        }).catch(() => {});
      },
      onTraceSpan: (span) => {
        emitTraceSpan(run, {
          ...span,
          stepId: span && span.stepId ? span.stepId : 'generation',
        }).catch(() => {});
      },
    });
    const addonSpec = addonSpecResult.spec;

    await deterministicScaffoldUpdate({ run, runAddonPath, llmPlan: protocolPlan, addonSpec });
    await appendEvent(run, 'assistant_message', {
      content: `Generated addon update:\n- Add-on name: ${addonSpec.addonName}\n- Panel: ${addonSpec.panelLabel}\n- Operator: ${addonSpec.operatorLabel} (${addonSpec.operatorIdName})\n- Behavior: ${addonSpec.operatorMessage}`,
    });
    await completeStep(run, 'generation', 'Generate and patch scaffold');

    if (protocolPlan && protocolPlan.protocol) {
      await executeProtocolPlan({
        protocol: protocolPlan.protocol,
        run,
        runDir,
        repoRoot: REPO_ROOT,
        settings,
        startStep,
        completeStep,
        failStep,
        appendEvent,
        addArtifact,
        executeWithCancellation,
        registerCancelHandler: (handler) => registerCancelHandler(run, handler),
        traceSpanRecorder: (span) => emitTraceSpan(run, span),
      });
    }

    assertNotCancelled(run);

    await startStep(run, 'validation', 'Run Blender validation');

    const activeSession =
      typeof blenderSessionManager.getActiveSession === 'function'
        ? blenderSessionManager.getActiveSession()
        : null;
    const useRpcSession = Boolean(
      activeSession &&
        activeSession.status === 'running' &&
        activeSession.supportsRpc &&
        activeSession.rpcReady,
    );

    if (useRpcSession) {
      const rpcTimeoutMs = Number(settings.timeoutMs) || 120000;
      const targetSessionId = String(activeSession.id);
      const unregisterCancel = registerCancelHandler(run, async () => {
        await appendEvent(run, 'blender_rpc_cancel_escalated', {
          sessionId: targetSessionId,
          command: 'validate_addon',
        });
        await blenderSessionManager.stopSession(targetSessionId);
      });

      await appendEvent(run, 'blender_started', {
        mode: 'rpc_session',
        sessionId: targetSessionId,
      });
      await appendEvent(run, 'blender_rpc_call', {
        sessionId: targetSessionId,
        command: 'validate_addon',
        timeoutMs: rpcTimeoutMs,
      });
      await appendEvent(run, 'tool_called', {
        tool: 'blenderSessionManager.executeOnActive',
        provider: 'blender_rpc',
        model: 'active_session',
        message: `RPC validate_addon on active session ${targetSessionId}`,
      });

      try {
        const rpcResponse = await executeWithCancellation(
          run,
          blenderSessionManager.executeOnActive(
            'validate_addon',
            { addonPath: runAddonPath },
            rpcTimeoutMs,
          ),
        );
        const resolvedSessionId = String((rpcResponse && rpcResponse.sessionId) || targetSessionId);

        assertNotCancelled(run);
        await appendEvent(run, 'blender_rpc_result', {
          sessionId: resolvedSessionId,
          command: 'validate_addon',
          ok: true,
        });
        await completeStep(run, 'validation', 'Run Blender validation', {
          mode: 'rpc_session',
          sessionId: resolvedSessionId,
        });
      } catch (error) {
        await appendEvent(run, 'blender_rpc_result', {
          sessionId: targetSessionId,
          command: 'validate_addon',
          ok: false,
          error: String(error && error.message ? error.message : error),
        });
        throw error;
      } finally {
        if (typeof unregisterCancel === 'function') {
          unregisterCancel();
        }
      }
    } else {
      const blenderMode = settings.runMode === 'gui' ? 'gui' : 'headless';
      const runner = runBlender({
        blenderPath: settings.blenderPath,
        mode: blenderMode,
        harnessPath: HARNESS_PATH,
        addonPath: runAddonPath,
        cwd: REPO_ROOT,
        onStarted: (evt) => {
          appendEvent(run, 'blender_started', {
            pid: evt.pid,
            mode: evt.mode,
            command: evt.command,
            args: evt.args,
          }).catch(() => {});
        },
        onLog: (evt) => {
          appendEvent(run, 'blender_log', {
            stream: evt.stream,
            line: evt.line,
          }).catch(() => {});
        },
        onExit: () => {},
      });

      const currentActive = activeExecutions.get(run.id) || {};
      activeExecutions.set(run.id, {
        ...currentActive,
        cancel: runner.cancel,
        childPid: runner.child && runner.child.pid,
      });

      const result = await executeWithCancellation(run, runner.done);

      assertNotCancelled(run);

      if (!result.ok) {
        throw result.error || new Error(`Blender exited with code ${result.code}`);
      }

      await completeStep(run, 'validation', 'Run Blender validation', {
        exitCode: result.code,
      });
    }

    if (
      protocolPlan &&
      protocolPlan.protocol &&
      protocolPlan.protocol.meta &&
      protocolPlan.protocol.meta.requires_gate_verification === true &&
      protocolPlan.protocol.done !== true
    ) {
      const envelope = createGateEnvelope({
        failedGates: ['DONE_REQUIRED'],
        messages: ['Protocol marked requires_gate_verification=true but done is not true.'],
      });
      await emitGateFailure(envelope);
      const error = new Error('Verification gate failed: protocol.done must be true when gate verification is required.');
      error.code = 'GATE_DONE_REQUIRED';
      throw error;
    }

    await appendEvent(run, 'assistant_message', {
      content: protocolPlan && protocolPlan.protocol
        ? protocolPlan.protocol.final_message
        : `Run completed successfully. Artifacts were written to ${path.relative(REPO_ROOT, runDir)}.`,
    });
    await appendEvent(run, 'assistant_message', {
      content: `Run completed successfully. Artifacts were written to ${path.relative(REPO_ROOT, runDir)}.`,
    });
    await finalizeRun(run, 'completed', null);
  } catch (error) {
    const shouldEnforceGate =
      protocolPlan &&
      protocolPlan.protocol &&
      protocolPlan.protocol.meta &&
      protocolPlan.protocol.meta.requires_gate_verification === true;
    if (shouldEnforceGate && !gateEventEmitted && error && error.code !== 'RUN_CANCELLED') {
      const envelope = createGateEnvelope({
        failedGates: [run.steps.validation && run.steps.validation.status !== 'completed' ? 'BLENDER_VALIDATION' : 'UNKNOWN'],
        messages: [String(error && error.message ? error.message : error)],
      });
      await emitGateFailure(envelope);
    }

    if (run.steps.validation && run.steps.validation.status === 'running') {
      failStep(run, 'validation', error);
    } else if (run.steps.generation && run.steps.generation.status === 'running') {
      failStep(run, 'generation', error);
    }

    const cancelled = error && error.code === 'RUN_CANCELLED';
    if (cancelled && !run.cancelRequested) {
      const latest = await runStore.getRun(run.id);
      if (latest && latest.cancelRequestedAt) {
        run.cancelRequested = true;
        run.cancelRequestedAt = latest.cancelRequestedAt;
      } else {
        run.cancelRequested = true;
        run.cancelRequestedAt = nowIso();
      }
    }
    await finalizeRun(
      run,
      cancelled ? 'cancelled' : 'failed',
      String(error && error.message ? error.message : error),
    );
  } finally {
    activeExecutions.delete(run.id);
    await syncRun(run);
  }
};

const startRun = async ({ prompt, model }) => {
  await ensureInitialized();

  const run = createRun({ prompt, model });
  await syncRun(run);

  activeExecutions.set(run.id, {
    cancel: async () => {},
    cancelRequested: false,
    cancelListeners: new Set(),
    cancelHandlers: new Set(),
  });

  executeRun(run.id).catch(async (error) => {
    const latest = await runStore.getRun(run.id);
    if (latest && !FINAL_STATUSES.has(latest.status)) {
      latest.status = 'failed';
      latest.error = String(error && error.message ? error.message : error);
      latest.completedAt = nowIso();
      latest.updatedAt = latest.completedAt;
      await syncRun(latest);
    }
  });

  return clone(run);
};

const cancelRun = async (runId) => {
  await ensureInitialized();

  const run = await runStore.getRun(runId);
  if (!run) {
    return null;
  }

  if (FINAL_STATUSES.has(run.status)) {
    return clone(run);
  }

  run.cancelRequested = true;
  run.cancelRequestedAt = nowIso();
  run.updatedAt = run.cancelRequestedAt;
  await syncRun(run);

  const active = activeExecutions.get(runId);
  if (active) {
    active.cancelRequested = true;
    if (active.cancelHandlers) {
      for (const handler of active.cancelHandlers) {
        try {
          await handler();
        } catch {
          // ignore cancellation handler failures
        }
      }
    }
    if (active.cancelListeners) {
      for (const listener of active.cancelListeners) {
        try {
          listener();
        } catch {
          // ignore cancellation listener failures
        }
      }
    }
    if (typeof active.cancel === 'function') {
      await active.cancel();
    }
  }

  const latest = await runStore.getRun(runId);
  return latest ? clone(latest) : clone(run);
};

const getRun = async (runId) => {
  await ensureInitialized();
  const run = await runStore.getRun(runId);
  return run ? clone(run) : null;
};

const listRuns = async () => {
  await ensureInitialized();
  const runs = await runStore.listRuns();
  return runs.map((run) => clone(run));
};

const getSettings = async () => {
  await ensureInitialized();
  const settings = await runStore.getSettings();
  return redactSettings(settings);
};

const updateSettings = async (incoming) => {
  await ensureInitialized();

  const current = await runStore.getSettings();
  const normalized = normalizeIncomingSettings(incoming, current);
  const validation = await validateSettings(normalized);

  if (!validation.valid) {
    const error = new Error('Invalid settings.');
    error.statusCode = 400;
    error.details = validation.errors;
    throw error;
  }

  const saved = await runStore.putSettings(normalized);
  return {
    settings: redactSettings(saved),
    validation,
  };
};

const getHealth = async () => {
  await ensureInitialized();
  const runs = await runStore.listRuns();
  const settings = await runStore.getSettings();
  const activeRuns = runs.filter((run) => !FINAL_STATUSES.has(run.status)).length;
  const blenderCheck = await checkBlenderExecutable(settings.blenderPath, 8000);
  const llmCheck = await pingProvider({ settings, model: 'GLM 4.7' });

  return {
    ok: Boolean(blenderCheck.ok && llmCheck.ok),
    status: blenderCheck.ok && llmCheck.ok ? 'ready' : 'degraded',
    timestamp: nowIso(),
    runCount: runs.length,
    activeRuns,
    blenderPath: settings.blenderPath,
    workspacePath: settings.workspacePath,
    blender: blenderCheck,
    llm: llmCheck,
  };
};

const subscribe = (listener) => {
  if (typeof listener !== 'function') {
    return () => {};
  }
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
};

module.exports = {
  startRun,
  cancelRun,
  getRun,
  listRuns,
  getSettings,
  updateSettings,
  getHealth,
  subscribe,
};
