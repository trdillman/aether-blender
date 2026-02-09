const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { loadManifest, runManifest } = require('./manifestE2ERunner');

const DEFAULT_HTTP_TIMEOUT_MS = 4000;

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const percentile = (values, pct) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * sorted.length) - 1));
  return sorted[index];
};

const buildLatencySummary = (durationsMs) => {
  if (!Array.isArray(durationsMs) || durationsMs.length === 0) {
    return {
      count: 0,
      minMs: 0,
      maxMs: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
    };
  }
  const sum = durationsMs.reduce((acc, n) => acc + n, 0);
  return {
    count: durationsMs.length,
    minMs: Math.min(...durationsMs),
    maxMs: Math.max(...durationsMs),
    avgMs: Math.round((sum / durationsMs.length) * 100) / 100,
    p50Ms: percentile(durationsMs, 50),
    p95Ms: percentile(durationsMs, 95),
  };
};

const requestJson = async ({ baseUrl, pathname, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS }) => {
  if (!baseUrl) {
    return { ok: false, statusCode: 0, error: 'baseUrl not provided', body: null };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(pathname, baseUrl);
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      error: `Invalid URL: ${error.message}`,
      body: null,
    };
  }

  const transport = parsedUrl.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = transport.request(
      parsedUrl,
      {
        method: 'GET',
        timeout: toPositiveInt(timeoutMs, DEFAULT_HTTP_TIMEOUT_MS),
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            body = null;
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            statusCode: res.statusCode || 0,
            error: null,
            body,
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });

    req.on('error', (error) => {
      resolve({
        ok: false,
        statusCode: 0,
        error: error.message || String(error),
        body: null,
      });
    });

    req.end();
  });
};

const snapshotServerEndpoints = async ({ baseUrl, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS, requestJsonImpl = requestJson }) => {
  if (!baseUrl) return null;

  const [health, metrics, runs] = await Promise.all([
    requestJsonImpl({ baseUrl, pathname: '/api/health', timeoutMs }),
    requestJsonImpl({ baseUrl, pathname: '/api/metrics', timeoutMs }),
    requestJsonImpl({ baseUrl, pathname: '/api/runs', timeoutMs }),
  ]);

  return {
    timestamp: new Date().toISOString(),
    baseUrl,
    health: {
      ok: health.ok,
      statusCode: health.statusCode,
      status: health.body && health.body.status ? health.body.status : null,
      error: health.error,
    },
    metrics: {
      ok: metrics.ok,
      statusCode: metrics.statusCode,
      generatedAt:
        metrics.body &&
        metrics.body.metrics &&
        typeof metrics.body.metrics.generatedAt === 'string'
          ? metrics.body.metrics.generatedAt
          : null,
      providersSeriesCount:
        metrics.body &&
        metrics.body.metrics &&
        Array.isArray(metrics.body.metrics.providers)
          ? metrics.body.metrics.providers.length
          : 0,
      executorsSeriesCount:
        metrics.body &&
        metrics.body.metrics &&
        Array.isArray(metrics.body.metrics.executors)
          ? metrics.body.metrics.executors.length
          : 0,
      error: metrics.error,
    },
    runs: {
      ok: runs.ok,
      statusCode: runs.statusCode,
      count: runs.body && Array.isArray(runs.body.runs) ? runs.body.runs.length : null,
      error: runs.error,
    },
  };
};

const executeSingleManifestRun = async ({
  manifest,
  runNumber,
  runDir,
  repoRoot,
  settings,
  runManifestImpl = runManifest,
  executeProtocolPlanImpl,
  blenderSessionManagerImpl,
}) => {
  const startedAt = Date.now();
  try {
    const result = await runManifestImpl({
      manifest,
      runNumber,
      repoRoot,
      runDir,
      settings,
      executeProtocolPlanImpl,
      blenderSessionManagerImpl,
    });
    const durationMs = Date.now() - startedAt;
    return {
      runNumber,
      ok: true,
      durationMs,
      runId: result.runId,
      eventCount: result.eventCount,
      artifactCount: result.artifactCount,
      error: null,
    };
  } catch (error) {
    return {
      runNumber,
      ok: false,
      durationMs: Date.now() - startedAt,
      runId: null,
      eventCount: 0,
      artifactCount: 0,
      error: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : null,
    };
  }
};

const runSoak = async (
  {
    manifestPath,
    iterations = 50,
    runDir,
    repoRoot,
    settings,
    stopOnFailure = false,
    baseUrl = '',
    endpointSnapshotInterval = 10,
    endpointTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  },
  deps = {},
) => {
  const loadManifestImpl = deps.loadManifestImpl || loadManifest;
  const runManifestImpl = deps.runManifestImpl || runManifest;
  const snapshotImpl = deps.snapshotServerEndpointsImpl || snapshotServerEndpoints;
  const { manifest } = await loadManifestImpl(manifestPath);

  const totalIterations = toPositiveInt(iterations, 50);
  const snapshots = [];
  if (baseUrl) {
    const preflight = await snapshotImpl({ baseUrl, timeoutMs: endpointTimeoutMs, requestJsonImpl: deps.requestJsonImpl });
    snapshots.push({ checkpoint: 'preflight', ...preflight });
  }

  const results = [];
  const everyN = Math.max(1, toPositiveInt(endpointSnapshotInterval, 10));
  for (let i = 0; i < totalIterations; i += 1) {
    const runNumber = i + 1;
    const perRunDir = path.join(runDir, `soak_${String(runNumber).padStart(3, '0')}`);
    const result = await executeSingleManifestRun({
      manifest,
      runNumber,
      runDir: perRunDir,
      repoRoot,
      settings,
      runManifestImpl,
    });
    results.push(result);

    if (baseUrl && (runNumber % everyN === 0 || runNumber === totalIterations)) {
      const snapshot = await snapshotImpl({ baseUrl, timeoutMs: endpointTimeoutMs, requestJsonImpl: deps.requestJsonImpl });
      snapshots.push({ checkpoint: `run_${runNumber}`, ...snapshot });
    }

    if (stopOnFailure && !result.ok) {
      break;
    }
  }

  const passed = results.filter((item) => item.ok).length;
  const failed = results.length - passed;
  const durations = results.map((item) => item.durationMs);

  return {
    type: 'soak',
    manifestPath: path.resolve(manifestPath),
    iterationsRequested: totalIterations,
    iterationsExecuted: results.length,
    passed,
    failed,
    successRate: results.length > 0 ? Math.round((passed / results.length) * 10000) / 100 : 0,
    latency: buildLatencySummary(durations),
    endpointSnapshots: snapshots,
    failures: results.filter((item) => !item.ok),
    ok: failed === 0 && results.length === totalIterations,
  };
};

const runLoad = async (
  {
    manifestPath,
    totalRuns = 40,
    concurrency = 8,
    runDir,
    repoRoot,
    settings,
    baseUrl = '',
    endpointTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  },
  deps = {},
) => {
  const loadManifestImpl = deps.loadManifestImpl || loadManifest;
  const runManifestImpl = deps.runManifestImpl || runManifest;
  const snapshotImpl = deps.snapshotServerEndpointsImpl || snapshotServerEndpoints;
  const { manifest } = await loadManifestImpl(manifestPath);

  const runCount = toPositiveInt(totalRuns, 40);
  const workerCount = Math.min(toPositiveInt(concurrency, 8), runCount);
  const queue = Array.from({ length: runCount }, (_, index) => index + 1);
  const results = [];
  let active = 0;
  let peakConcurrency = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const runNumber = queue.shift();
      if (!runNumber) return;
      active += 1;
      peakConcurrency = Math.max(peakConcurrency, active);
      const perRunDir = path.join(runDir, `load_${String(runNumber).padStart(3, '0')}`);
      const result = await executeSingleManifestRun({
        manifest,
        runNumber,
        runDir: perRunDir,
        repoRoot,
        settings,
        runManifestImpl,
      });
      results.push(result);
      active -= 1;
    }
  };

  const preflight = baseUrl
    ? await snapshotImpl({ baseUrl, timeoutMs: endpointTimeoutMs, requestJsonImpl: deps.requestJsonImpl })
    : null;

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  results.sort((a, b) => a.runNumber - b.runNumber);

  const post = baseUrl
    ? await snapshotImpl({ baseUrl, timeoutMs: endpointTimeoutMs, requestJsonImpl: deps.requestJsonImpl })
    : null;

  const passed = results.filter((item) => item.ok).length;
  const failed = results.length - passed;
  const durations = results.map((item) => item.durationMs);

  return {
    type: 'load',
    manifestPath: path.resolve(manifestPath),
    totalRuns: runCount,
    concurrencyRequested: workerCount,
    peakConcurrency,
    passed,
    failed,
    successRate: runCount > 0 ? Math.round((passed / runCount) * 10000) / 100 : 0,
    latency: buildLatencySummary(durations),
    endpointSnapshots: [preflight ? { checkpoint: 'preflight', ...preflight } : null, post ? { checkpoint: 'post', ...post } : null].filter(Boolean),
    failures: results.filter((item) => !item.ok),
    ok: failed === 0,
  };
};

const defaultChaosPhases = () => ([
  {
    name: 'warmup',
    iterations: 5,
    injectFault: null,
    expectFailures: false,
  },
  {
    name: 'provider_timeout',
    iterations: 5,
    injectFault: {
      code: 'PROVIDER_TIMEOUT',
      message: 'Injected provider timeout fault.',
    },
    expectFailures: true,
  },
  {
    name: 'network_reset',
    iterations: 5,
    injectFault: {
      code: 'ECONNRESET',
      message: 'Injected network reset fault.',
    },
    expectFailures: true,
  },
  {
    name: 'recovery',
    iterations: 5,
    injectFault: null,
    expectFailures: false,
  },
]);

const buildFaultingExecutor = (fault) => {
  return async () => {
    const error = new Error(String(fault.message || 'Injected fault.'));
    if (fault.code) {
      error.code = String(fault.code);
    }
    throw error;
  };
};

const runChaos = async (
  {
    manifestPath,
    runDir,
    repoRoot,
    settings,
    phases = defaultChaosPhases(),
    baseUrl = '',
    endpointTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  },
  deps = {},
) => {
  const loadManifestImpl = deps.loadManifestImpl || loadManifest;
  const runManifestImpl = deps.runManifestImpl || runManifest;
  const snapshotImpl = deps.snapshotServerEndpointsImpl || snapshotServerEndpoints;
  const { manifest } = await loadManifestImpl(manifestPath);

  const snapshots = [];
  if (baseUrl) {
    const preflight = await snapshotImpl({ baseUrl, timeoutMs: endpointTimeoutMs, requestJsonImpl: deps.requestJsonImpl });
    snapshots.push({ checkpoint: 'preflight', ...preflight });
  }

  const phaseResults = [];
  let runCounter = 0;
  for (const phase of phases) {
    const normalizedIterations = toPositiveInt(phase.iterations, 1);
    const phaseName = String(phase.name || `phase_${phaseResults.length + 1}`);
    const phaseItems = [];

    for (let i = 0; i < normalizedIterations; i += 1) {
      runCounter += 1;
      const perRunDir = path.join(
        runDir,
        `${String(phaseResults.length + 1).padStart(2, '0')}_${phaseName}`,
        `run_${String(i + 1).padStart(3, '0')}`,
      );

      const result = await executeSingleManifestRun({
        manifest,
        runNumber: runCounter,
        runDir: perRunDir,
        repoRoot,
        settings,
        runManifestImpl,
        executeProtocolPlanImpl: phase.injectFault ? buildFaultingExecutor(phase.injectFault) : undefined,
      });
      phaseItems.push(result);
    }

    if (baseUrl) {
      const snapshot = await snapshotImpl({ baseUrl, timeoutMs: endpointTimeoutMs, requestJsonImpl: deps.requestJsonImpl });
      snapshots.push({ checkpoint: phaseName, ...snapshot });
    }

    const passed = phaseItems.filter((item) => item.ok).length;
    const failed = phaseItems.length - passed;
    const expectFailures = Boolean(phase.expectFailures);
    const phaseOk = expectFailures ? failed === phaseItems.length : passed === phaseItems.length;

    phaseResults.push({
      name: phaseName,
      iterations: phaseItems.length,
      passed,
      failed,
      expectFailures,
      expectedFaultCode: phase.injectFault && phase.injectFault.code ? phase.injectFault.code : null,
      ok: phaseOk,
      failures: phaseItems.filter((item) => !item.ok),
    });
  }

  const totals = phaseResults.reduce(
    (acc, phase) => {
      acc.iterations += phase.iterations;
      acc.passed += phase.passed;
      acc.failed += phase.failed;
      return acc;
    },
    { iterations: 0, passed: 0, failed: 0 },
  );
  const recoveryPhase = phaseResults.find((item) => item.name === 'recovery');
  const recoveryOk = recoveryPhase ? recoveryPhase.ok : true;
  const phasesOk = phaseResults.every((item) => item.ok);

  return {
    type: 'chaos',
    manifestPath: path.resolve(manifestPath),
    totals,
    phases: phaseResults,
    endpointSnapshots: snapshots,
    recoveryVerified: recoveryOk,
    ok: phasesOk && recoveryOk,
  };
};

module.exports = {
  requestJson,
  snapshotServerEndpoints,
  runSoak,
  runLoad,
  runChaos,
  defaultChaosPhases,
};
