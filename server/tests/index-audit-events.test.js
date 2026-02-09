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

const createBaseMocks = (auditEvents, settings = {}) => ({
  './lib/runStore': {
    ensureInitialized: async () => {},
    getSettings: async () => ({
      serverApiKey: 'secret-key',
      allowTrustedPythonExecution: false,
      ...settings,
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
    executeOnActive: async () => ({ ok: true }),
    getActiveSession: () => null,
    getSession: () => null,
    stopSession: async () => null,
    executeRpc: async () => ({}),
    launchSession: async () => ({}),
  },
  './lib/securityPolicy': {
    isAuthorizedRequest: (headers = {}, expectedKey) =>
      String(headers['x-aether-api-key'] || '') === String(expectedKey || ''),
    assertRpcCommandAllowed: (command) => {
      const normalized = String(command || '').trim().toLowerCase();
      if (!normalized) {
        const error = new Error('command is required');
        error.statusCode = 400;
        error.code = 'RPC_COMMAND_REQUIRED';
        throw error;
      }
      if (normalized === 'exec_python') {
        const error = new Error('exec_python is blocked');
        error.statusCode = 403;
        error.code = 'RPC_COMMAND_BLOCKED';
        throw error;
      }
      return normalized;
    },
    assertExecPythonPayloadAllowed: (payload) => payload,
  },
  './lib/runOrchestrator': {
    subscribe: () => {},
    startRun: async () => ({ id: 'run_1', status: 'queued' }),
    cancelRun: async () => ({ id: 'run_1', status: 'cancelled' }),
    getRun: async () => null,
    listRuns: async () => [],
  },
  './lib/auditLog': {
    AUDIT_EVENT_TYPES: {
      AUTH_FAILURE: 'auth_failure',
      RPC_COMMAND_BLOCKED: 'rpc_command_blocked',
    },
    appendAuditRecord: async (entry) => {
      auditEvents.push(entry);
    },
  },
  './lib/presetStore': {
    listPresets: async () => [],
    getPreset: async () => null,
    upsertPreset: async (input) => input,
    exportPresetBundle: async () => ({ bundleVersion: '1.0', presets: [] }),
    importPresetBundle: async () => ({ importedCount: 0, importedIds: [] }),
  },
});

test('index handler appends auth failure audit event on unauthorized POST /api/runs', async () => {
  const auditEvents = [];
  const mocks = createBaseMocks(auditEvents);

  await withMockedIndex(mocks, async ({ handler }) => {
    const { server, baseUrl } = await startEphemeralServer(handler);
    try {
      const response = await requestJson({
        baseUrl,
        method: 'POST',
        pathname: '/api/runs',
        body: { prompt: 'x', model: 'GLM 4.7' },
      });

      assert.equal(response.statusCode, 401);
      assert.ok(auditEvents.some((evt) => evt.eventType === 'auth_failure'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('index handler appends blocked RPC command audit event', async () => {
  const auditEvents = [];
  const mocks = createBaseMocks(auditEvents);

  await withMockedIndex(mocks, async ({ handler }) => {
    const { server, baseUrl } = await startEphemeralServer(handler);
    try {
      const response = await requestJson({
        baseUrl,
        method: 'POST',
        pathname: '/api/blender/active/rpc',
        headers: { 'x-aether-api-key': 'secret-key' },
        body: {
          command: 'exec_python',
          payload: { code: 'print(1)' },
        },
      });

      assert.equal(response.statusCode, 403);
      assert.ok(auditEvents.some((evt) => evt.eventType === 'rpc_command_blocked'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
