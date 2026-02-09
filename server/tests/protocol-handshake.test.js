const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');

const INDEX_PATH = path.resolve(__dirname, '../index.js');

const withMockedIndex = async (mocks, run) => {
  const originalLoad = Module._load;
  delete require.cache[INDEX_PATH];

  Module._load = function patchedLoader(request, parent, isMain) {
    if (parent && parent.filename === INDEX_PATH && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const mod = require(INDEX_PATH);
    return await run(mod);
  } finally {
    Module._load = originalLoad;
    delete require.cache[INDEX_PATH];
  }
};

const startEphemeralServer = async (handler) => {
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message || 'Internal server error.' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
};

const requestJson = async ({ baseUrl, pathname }) =>
  new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const req = http.request(
      url,
      { method: 'GET' },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: res.statusCode,
            body: raw ? JSON.parse(raw) : {},
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });

const createBaseMocks = () => ({
  './lib/runStore': {
    ensureInitialized: async () => {},
    getSettings: async () => ({}),
    putSettings: async () => ({}),
    listRuns: async () => [],
    getRun: async () => null,
    createOrUpsertRun: async () => {},
  },
  './lib/sseHub': {
    publish: () => {},
    attach: () => {},
  },
  './lib/settingsService': {
    redactSettings: (value) => value,
  },
  './lib/blenderSessionManager': {
    subscribe: () => {},
    getSession: () => null,
    getActiveSession: () => null,
    launchSession: async () => ({}),
    executeOnActive: async () => ({}),
    stopSession: async () => null,
    executeRpc: async () => ({}),
  },
  './lib/securityPolicy': {
    isAuthorizedRequest: () => true,
    assertRpcCommandAllowed: (command) => command,
    assertExecPythonPayloadAllowed: (payload) => payload,
  },
  './lib/runOrchestrator': {
    subscribe: () => {},
    startRun: async () => ({ id: 'run_1' }),
    cancelRun: async () => ({ id: 'run_1' }),
    getRun: async () => null,
    listRuns: async () => [],
  },
  './lib/auditLog': {
    AUDIT_EVENT_TYPES: {
      AUTH_FAILURE: 'auth_failure',
      RPC_COMMAND_BLOCKED: 'rpc_command_blocked',
    },
    appendAuditRecord: async () => {},
  },
  './lib/metricsExporter': {
    snapshot: () => ({
      generatedAt: '2026-02-09T00:00:00.000Z',
      providers: [],
      executors: [],
    }),
  },
  './lib/presetStore': {
    listPresets: async () => [],
    getPreset: async () => null,
    upsertPreset: async (input) => input,
    exportPresetBundle: async () => ({ bundleVersion: '1.0', presets: [] }),
    importPresetBundle: async () => ({ importedCount: 0, importedIds: [] }),
  },
});

test('protocol handshake returns compatibility metadata for default version', async () => {
  const mocks = createBaseMocks();
  await withMockedIndex(mocks, async ({ handler }) => {
    const { server, baseUrl } = await startEphemeralServer(handler);
    try {
      const response = await requestJson({
        baseUrl,
        pathname: '/api/protocol/handshake',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.selectedVersion, '1.0');
      assert.ok(Array.isArray(response.body.providers));
      assert.ok(response.body.providers.includes('anthropic'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('protocol handshake returns mismatch payload for unsupported version', async () => {
  const mocks = createBaseMocks();
  await withMockedIndex(mocks, async ({ handler }) => {
    const { server, baseUrl } = await startEphemeralServer(handler);
    try {
      const response = await requestJson({
        baseUrl,
        pathname: '/api/protocol/handshake?version=9.9',
      });

      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.code, 'PROTOCOL_VERSION_MISMATCH');
      assert.ok(Array.isArray(response.body.supportedVersions));
      assert.ok(response.body.supportedVersions.includes('1.0'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('metrics endpoint returns live metrics snapshot payload', async () => {
  const mocks = createBaseMocks();
  await withMockedIndex(mocks, async ({ handler }) => {
    const { server, baseUrl } = await startEphemeralServer(handler);
    try {
      const response = await requestJson({
        baseUrl,
        pathname: '/api/metrics',
      });

      assert.equal(response.statusCode, 200);
      assert.ok(response.body.metrics);
      assert.equal(response.body.metrics.generatedAt, '2026-02-09T00:00:00.000Z');
      assert.deepEqual(response.body.metrics.providers, []);
      assert.deepEqual(response.body.metrics.executors, []);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
