const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  runSoak,
  runLoad,
  runChaos,
} = require('../lib/manifestStressRunners');

const manifestPath = path.join(__dirname, '..', 'e2e', 'manifests', 'tst-012-soak-50-prompts.json');

const createManifestLoader = () => async () => ({
  manifest: {
    id: 'mock_manifest',
    protocol: {
      version: '1.0',
      done: true,
      final_message: 'ok',
      steps: [
        {
          id: 'step_1',
          type: 'PYTHON',
          description: 'mock step',
          payload: { code: "print('ok')" },
        },
      ],
    },
    assertions: {
      events: {
        requireEventTypes: ['protocol_python'],
      },
    },
    options: {
      requireActiveRpcSession: false,
      timeoutMs: 120000,
    },
  },
});

test('runSoak returns pass/fail counts and endpoint snapshots', async () => {
  let callCount = 0;
  const summary = await runSoak(
    {
      manifestPath,
      iterations: 5,
      runDir: __dirname,
      repoRoot: __dirname,
      settings: {},
      baseUrl: 'http://127.0.0.1:8787',
      endpointSnapshotInterval: 2,
    },
    {
      loadManifestImpl: createManifestLoader(),
      runManifestImpl: async ({ manifest }) => {
        callCount += 1;
        if (callCount === 3) {
          throw new Error('injected soak failure');
        }
        return {
          ok: true,
          runId: `${manifest.id}_${callCount}`,
          eventCount: 1,
          artifactCount: 1,
        };
      },
      snapshotServerEndpointsImpl: async ({ baseUrl }) => ({
        baseUrl,
        health: { ok: true, statusCode: 200, status: 'ready', error: null },
        metrics: { ok: true, statusCode: 200, generatedAt: '2026-02-09T00:00:00.000Z', providersSeriesCount: 1, executorsSeriesCount: 1, error: null },
        runs: { ok: true, statusCode: 200, count: 0, error: null },
      }),
    },
  );

  assert.equal(summary.iterationsRequested, 5);
  assert.equal(summary.iterationsExecuted, 5);
  assert.equal(summary.passed, 4);
  assert.equal(summary.failed, 1);
  assert.equal(summary.endpointSnapshots.length, 4);
  assert.equal(summary.ok, false);
});

test('runLoad honors concurrency and collects failures', async () => {
  let inFlight = 0;
  let peak = 0;
  const summary = await runLoad(
    {
      manifestPath,
      totalRuns: 8,
      concurrency: 3,
      runDir: __dirname,
      repoRoot: __dirname,
      settings: {},
    },
    {
      loadManifestImpl: createManifestLoader(),
      runManifestImpl: async ({ runNumber }) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        if (runNumber === 5) {
          throw Object.assign(new Error('load fault'), { code: 'LOAD_FAULT' });
        }
        return { ok: true, runId: `run_${runNumber}`, eventCount: 1, artifactCount: 1 };
      },
    },
  );

  assert.equal(summary.totalRuns, 8);
  assert.equal(summary.concurrencyRequested, 3);
  assert.equal(summary.passed, 7);
  assert.equal(summary.failed, 1);
  assert.equal(summary.ok, false);
  assert.ok(summary.peakConcurrency <= 3);
  assert.ok(peak <= 3);
});

test('runChaos validates degradation and recovery expectations', async () => {
  const summary = await runChaos(
    {
      manifestPath,
      runDir: __dirname,
      repoRoot: __dirname,
      settings: {},
      phases: [
        { name: 'warmup', iterations: 2, injectFault: null, expectFailures: false },
        {
          name: 'provider_timeout',
          iterations: 2,
          injectFault: { code: 'PROVIDER_TIMEOUT', message: 'timeout fault' },
          expectFailures: true,
        },
        {
          name: 'network_reset',
          iterations: 2,
          injectFault: { code: 'ECONNRESET', message: 'network fault' },
          expectFailures: true,
        },
        { name: 'recovery', iterations: 2, injectFault: null, expectFailures: false },
      ],
    },
    {
      loadManifestImpl: createManifestLoader(),
      runManifestImpl: async ({ executeProtocolPlanImpl, runNumber }) => {
        if (typeof executeProtocolPlanImpl === 'function') {
          await executeProtocolPlanImpl({});
        }
        return {
          ok: true,
          runId: `run_${runNumber}`,
          eventCount: 1,
          artifactCount: 1,
        };
      },
    },
  );

  assert.equal(summary.totals.iterations, 8);
  assert.equal(summary.totals.failed, 4);
  assert.equal(summary.recoveryVerified, true);
  assert.equal(summary.ok, true);
  const timeoutPhase = summary.phases.find((phase) => phase.name === 'provider_timeout');
  assert.equal(timeoutPhase.failed, 2);
});
