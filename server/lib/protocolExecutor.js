const fs = require('fs/promises');
const path = require('path');
const { getExecutorForStep } = require('./executors/registry');
const { recordExecutorCall } = require('./metricsExporter');

const STEP_ID_SAFE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const createPathPolicyError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
};

const isSubPath = (rootPath, candidatePath) => {
  const rel = path.relative(rootPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const assertStepIdSafe = (stepId) => {
  const normalized = String(stepId || '').trim();
  if (!STEP_ID_SAFE_PATTERN.test(normalized) || normalized.includes('..')) {
    throw createPathPolicyError(
      `Invalid protocol step id "${normalized}". Only [A-Za-z0-9._-] up to 80 chars are allowed.`,
      'SAF_003_INVALID_STEP_ID',
    );
  }
  return normalized;
};

const assertPathSafeForArtifacts = async (rootDir, targetDir) => {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetDir);
  if (!isSubPath(resolvedRoot, resolvedTarget)) {
    throw createPathPolicyError(
      `Artifact path escapes protocol root: ${resolvedTarget}`,
      'SAF_003_PATH_TRAVERSAL_BLOCKED',
    );
  }

  let current = resolvedRoot;
  try {
    const rootStat = await fs.lstat(current);
    if (rootStat.isSymbolicLink()) {
      throw createPathPolicyError(
        `Protocol artifact root cannot be a symlink: ${current}`,
        'SAF_003_SYMLINK_BLOCKED',
      );
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }

  const rel = path.relative(resolvedRoot, resolvedTarget);
  const segments = rel ? rel.split(path.sep).filter(Boolean) : [];
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw createPathPolicyError(
          `Protocol artifact path contains symlink segment: ${current}`,
          'SAF_003_SYMLINK_BLOCKED',
        );
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }

  return resolvedTarget;
};

const executeProtocolPlan = async ({
  protocol,
  run,
  runDir,
  repoRoot,
  settings,
  startStep,
  completeStep,
  failStep,
  appendEvent,
  addArtifact,
  executeWithCancellation,
  registerCancelHandler,
  traceSpanRecorder,
}) => {
  if (!protocol || !Array.isArray(protocol.steps) || !protocol.steps.length) {
    return;
  }

  const protocolDir = path.join(runDir, 'protocol_steps');
  await fs.mkdir(protocolDir, { recursive: true });
  await assertPathSafeForArtifacts(runDir, protocolDir);

  for (let index = 0; index < protocol.steps.length; index++) {
    const step = protocol.steps[index];
    const stepId = assertStepIdSafe(step.id || `protocol_step_${index + 1}`);
    const stepName = step.description || `${step.type} step`;
    await startStep(run, stepId, stepName);

    const stepDir = path.join(protocolDir, stepId);
    await assertPathSafeForArtifacts(protocolDir, stepDir);
    await fs.mkdir(stepDir, { recursive: true });

    const logEvent = async (type, payload) => {
      if (typeof appendEvent === 'function') {
        await appendEvent(run, type, { stepId, ...payload });
      }
    };

    const artifactRecorder = async (artifact) => {
      if (typeof addArtifact === 'function') {
        await addArtifact(run, {
          stepId,
          ...artifact,
        });
      }
    };

    const context = {
      run,
      step,
      runDir,
      settings,
      repoRoot,
      artifactDir: stepDir,
      logEvent,
      addArtifact: artifactRecorder,
      registerCancelHandler,
    };

    let executor = null;

    try {
      executor = getExecutorForStep(step.type, context);

      if (executor && typeof executor.prepare === 'function') {
        await executeWithCancellation(run, executor.prepare(context));
      }

      if (executor && typeof executor.run === 'function') {
        const executorRunStartedAt = new Date().toISOString();
        try {
          await executeWithCancellation(run, executor.run(context));
          const runDurationMs = Math.max(0, Date.parse(new Date().toISOString()) - Date.parse(executorRunStartedAt));
          recordExecutorCall({
            executorType: step.type,
            success: true,
            latencyMs: runDurationMs,
            retries: 0,
          });
          if (typeof traceSpanRecorder === 'function') {
            await traceSpanRecorder({
              name: `executor.${String(step.type || '').toLowerCase()}.run`,
              component: 'executor',
              stepId,
              startedAt: executorRunStartedAt,
              status: 'ok',
              attributes: {
                executorType: step.type,
              },
            });
          }
        } catch (error) {
          const runDurationMs = Math.max(0, Date.parse(new Date().toISOString()) - Date.parse(executorRunStartedAt));
          recordExecutorCall({
            executorType: step.type,
            success: false,
            latencyMs: runDurationMs,
            retries: 0,
          });
          if (typeof traceSpanRecorder === 'function') {
            await traceSpanRecorder({
              name: `executor.${String(step.type || '').toLowerCase()}.run`,
              component: 'executor',
              stepId,
              startedAt: executorRunStartedAt,
              status: 'error',
              attributes: {
                executorType: step.type,
              },
              error: error && error.message ? error.message : String(error),
            });
          }
          throw error;
        }
      }

      await completeStep(run, stepId, stepName, { type: step.type });
    } catch (error) {
      if (executor && typeof executor.cancel === 'function') {
        try {
          await executor.cancel(context);
        } catch {
          // best effort cancel
        }
      }
      failStep(run, stepId, error);
      throw error;
    } finally {
      if (executor && typeof executor.cleanup === 'function') {
        try {
          await executor.cleanup(context);
        } catch {
          // do not block on cleanup failures
        }
      }
    }
  }
};

module.exports = {
  executeProtocolPlan,
};
