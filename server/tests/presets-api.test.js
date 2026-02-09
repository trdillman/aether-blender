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

const requestJson = async ({ baseUrl, pathname, method = 'GET', body }) =>
  new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const req = http.request(
      url,
      {
        method,
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            }
          : {},
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
    if (body) req.write(body);
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
    getRun: async () => ({ id: 'run_1', protocol: { version: '1.0', steps: [] } }),
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
    snapshot: () => ({ generatedAt: '', providers: [], executors: [] }),
  },
});

test('presets endpoints list and create presets', async () => {
  const mockStore = {
    listPresets: async () => [{ id: 'preset_1', name: 'Base Preset' }],
    upsertPreset: async ({ name, sourceRunId }) => ({
      id: 'preset_2',
      name,
      sourceRunId,
      protocol: { version: '1.0', steps: [] },
    }),
    getPreset: async () => null,
    deletePreset: async () => true,
    exportPresetBundle: async () => ({ presets: [] }),
    importPresetBundle: async () => ({ importedCount: 0, importedIds: [], bundle: { presets: [] } }),
  };
  const mocks = {
    ...createBaseMocks(),
    './lib/presetStore': mockStore,
  };
  await withMockedIndex(mocks, async ({ handler }) => {
    const { server, baseUrl } = await startEphemeralServer(handler);
    try {
      const listResponse = await requestJson({ baseUrl, pathname: '/api/presets' });
      assert.equal(listResponse.statusCode, 200);
      assert.equal(Array.isArray(listResponse.body.presets), true);
      assert.equal(listResponse.body.presets[0].id, 'preset_1');

      const createResponse = await requestJson({
        baseUrl,
        pathname: '/api/presets',
        method: 'POST',
        body: JSON.stringify({
          name: 'Imported',
          sourceRunId: 'run_1',
          protocol: { version: '1.0', steps: [] },
        }),
      });
      assert.equal(createResponse.statusCode, 201);
      assert.equal(createResponse.body.preset.name, 'Imported');
      assert.equal(createResponse.body.preset.sourceRunId, 'run_1');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
