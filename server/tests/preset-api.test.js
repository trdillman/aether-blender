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

const requestJson = async ({ baseUrl, method, pathname, body, headers }) =>
  new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body == null ? '' : JSON.stringify(body);
    const req = http.request(
      url,
      {
        method,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...(headers || {}),
        },
      },
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
    req.end(payload);
  });

const createBaseMocks = (presetStoreMock) => ({
  './lib/runStore': {
    ensureInitialized: async () => {},
    getSettings: async () => ({
      serverApiKey: 'secret-key',
      allowTrustedPythonExecution: false,
    }),
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
    isAuthorizedRequest: (headers = {}, expectedKey) =>
      String(headers['x-aether-api-key'] || '') === String(expectedKey || ''),
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
    snapshot: () => ({ generatedAt: '2026-02-09T00:00:00.000Z', providers: [], executors: [] }),
  },
  './lib/presetStore': presetStoreMock,
});

test('preset export endpoint passes id filter and returns bundle', async () => {
  let receivedIds = null;
  const mocks = createBaseMocks({
    listPresets: async () => [],
    getPreset: async () => null,
    upsertPreset: async (input) => input,
    exportPresetBundle: async ({ ids }) => {
      receivedIds = ids || [];
      return { bundleVersion: '1.0', presets: [] };
    },
    importPresetBundle: async () => ({ importedCount: 0, importedIds: [] }),
  });

  await withMockedIndex(mocks, async ({ handler }) => {
    const { server, baseUrl } = await startEphemeralServer(handler);
    try {
      const response = await requestJson({
        baseUrl,
        method: 'GET',
        pathname: '/api/presets/export?ids=alpha,beta',
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.bundle.bundleVersion, '1.0');
      assert.deepEqual(receivedIds, ['alpha', 'beta']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('preset import endpoint enforces auth and returns import summary', async () => {
  const mocks = createBaseMocks({
    listPresets: async () => [],
    getPreset: async () => null,
    upsertPreset: async (input) => input,
    exportPresetBundle: async () => ({ bundleVersion: '1.0', presets: [] }),
    importPresetBundle: async () => ({ importedCount: 2, importedIds: ['a', 'b'] }),
  });

  await withMockedIndex(mocks, async ({ handler }) => {
    const { server, baseUrl } = await startEphemeralServer(handler);
    try {
      const unauthorized = await requestJson({
        baseUrl,
        method: 'POST',
        pathname: '/api/presets/import',
        body: { bundle: { presets: [] } },
      });
      assert.equal(unauthorized.statusCode, 401);

      const authorized = await requestJson({
        baseUrl,
        method: 'POST',
        pathname: '/api/presets/import',
        headers: { 'x-aether-api-key': 'secret-key' },
        body: { bundle: { presets: [] } },
      });
      assert.equal(authorized.statusCode, 200);
      assert.equal(authorized.body.importedCount, 2);
      assert.deepEqual(authorized.body.importedIds, ['a', 'b']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('preset create endpoint returns taxonomy error envelope for invalid preset payload', async () => {
  const mocks = createBaseMocks({
    listPresets: async () => [],
    getPreset: async () => null,
    exportPresetBundle: async () => ({ bundleVersion: '1.0', presets: [] }),
    importPresetBundle: async () => ({ importedCount: 0, importedIds: [] }),
    upsertPreset: async () => {
      const error = new Error('Preset payload validation failed.');
      error.code = 'PRESET_VALIDATION_FAILED';
      error.statusCode = 400;
      error.details = {
        errors: [{ code: 'PRESET_NAME_REQUIRED', path: 'preset.name', message: 'Preset name is required.' }],
      };
      throw error;
    },
  });

  await withMockedIndex(mocks, async ({ handler }) => {
    const { server, baseUrl } = await startEphemeralServer(handler);
    try {
      const response = await requestJson({
        baseUrl,
        method: 'POST',
        pathname: '/api/presets',
        headers: { 'x-aether-api-key': 'secret-key' },
        body: { name: '' },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'PRESET_VALIDATION_FAILED');
      assert.equal(response.body.category, 'preset');
      assert.ok(Array.isArray(response.body.details.errors));
      assert.equal(response.body.details.errors[0].code, 'PRESET_NAME_REQUIRED');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
