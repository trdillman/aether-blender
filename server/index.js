const http = require('http');
const { URL } = require('url');
const runStore = require('./lib/runStore');
const sseHub = require('./lib/sseHub');
const { redactSettings } = require('./lib/settingsService');
const blenderSessionManager = require('./lib/blenderSessionManager');
const { appendAuditRecord, AUDIT_EVENT_TYPES } = require('./lib/auditLog');
const {
  assertRpcCommandAllowed,
  assertExecPythonPayloadAllowed,
  isAuthorizedRequest,
} = require('./lib/securityPolicy');
const { buildRunSseEnvelope, validateSsePayload } = require('./lib/responseEventValidator');
const { mapErrorToTaxonomy, toErrorResponse } = require('./lib/errorTaxonomy');
const {
  assertHandshakeCompatible,
  SUPPORTED_PROTOCOL_VERSIONS,
} = require('./lib/protocolCompatibility');
const { snapshot: snapshotMetrics } = require('./lib/metricsExporter');
const presetStore = require('./lib/presetStore');

let runOrchestrator = null;
try {
  runOrchestrator = require('./lib/runOrchestrator');
} catch {
  runOrchestrator = null;
}

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const ALLOWED_ORIGINS = new Set([
  process.env.CORS_ORIGIN || 'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const setCorsHeaders = (req, res) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Aether-Api-Key');
};

const parseJsonBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    const maxBytes = 1024 * 1024;

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });

const getOrchestrator = () => {
  if (
    !runOrchestrator ||
    typeof runOrchestrator.startRun !== 'function' ||
    typeof runOrchestrator.cancelRun !== 'function' ||
    typeof runOrchestrator.getRun !== 'function' ||
    typeof runOrchestrator.listRuns !== 'function'
  ) {
    return null;
  }
  return runOrchestrator;
};

const orchestrator = getOrchestrator();
if (orchestrator && typeof orchestrator.subscribe === 'function') {
  orchestrator.subscribe((evt) => {
    const runId = evt && evt.runId;
    if (!runId) return;
    try {
      const envelope = buildRunSseEnvelope(evt);
      sseHub.publish(runId, envelope.eventName, envelope.data);
    } catch (error) {
      const mapped = mapErrorToTaxonomy(error, { fallbackCode: 'PROTOCOL_RUN_EVENT_INVALID' });
      sseHub.publish(runId, 'event', {
        type: 'run_event_validation_failed',
        runId,
        timestamp: new Date().toISOString(),
        code: mapped.code,
        message: mapped.message,
      });
    }

    const runPayload = { run: evt.run };
    try {
      validateSsePayload({ eventName: 'run', data: runPayload });
      sseHub.publish(runId, 'run', runPayload);
    } catch {
      // Keep stream available even if a malformed run snapshot appears.
    }
  });
}
if (typeof blenderSessionManager.subscribe === 'function') {
  blenderSessionManager.subscribe((evt) => {
    const sessionId = evt && evt.sessionId;
    if (!sessionId) return;
    const eventName = String(evt.type || '').toLowerCase().includes('log') ? 'log' : 'status';
    try {
      validateSsePayload({ eventName, data: evt });
    } catch {
      return;
    }
    sseHub.publish(`blender:${sessionId}`, eventName, evt);
  });
}

const normalizeRun = (run, fallbackId) => {
  if (!run || typeof run !== 'object') return null;
  const id = run.id != null ? String(run.id) : fallbackId ? String(fallbackId) : '';
  if (!id) return null;
  return {
    ...run,
    id,
  };
};

const readRunFromSources = async (id) => {
  const orchestrator = getOrchestrator();
  if (orchestrator) {
    const remote = await orchestrator.getRun(String(id));
    const normalizedRemote = normalizeRun(remote, id);
    if (normalizedRemote) {
      await runStore.createOrUpsertRun(normalizedRemote);
      return normalizedRemote;
    }
  }
  return runStore.getRun(String(id));
};

const syncRunsFromOrchestrator = async () => {
  const orchestrator = getOrchestrator();
  if (!orchestrator) {
    return runStore.listRuns();
  }
  const remote = await orchestrator.listRuns();
  if (!Array.isArray(remote)) {
    return runStore.listRuns();
  }
  for (const run of remote) {
    const normalized = normalizeRun(run);
    if (normalized) {
      await runStore.createOrUpsertRun(normalized);
    }
  }
  return runStore.listRuns();
};

const handleStream = (res, req, runId, runSnapshot) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  sseHub.attach(runId, req, res);
  if (runSnapshot) {
    sseHub.publish(runId, 'run', { run: runSnapshot });
  }
};

const publishBlenderSessionEvents = (sessionId, session, fromIndex = 0) => {
  if (!session || !Array.isArray(session.events)) return;
  for (let i = fromIndex; i < session.events.length; i += 1) {
    const evt = session.events[i];
    const eventName = String(evt.type || '').toLowerCase().includes('log') ? 'log' : 'status';
    sseHub.publish(`blender:${sessionId}`, eventName, evt);
  }
};

const parseRpcBody = async (req, res, options = {}) => {
  const body = await parseJsonBody(req);
  const command = typeof body.command === 'string' ? body.command.trim() : '';

  let payload =
    body.payload == null
      ? {}
      : typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : null;
  if (payload === null) {
    sendJson(res, 400, { error: 'payload must be an object when provided.' });
    return null;
  }

  const timeoutMs =
    body.timeoutMs == null ? undefined : Number.parseInt(String(body.timeoutMs), 10);
  if (body.timeoutMs != null && (Number.isNaN(timeoutMs) || timeoutMs <= 0)) {
    sendJson(res, 400, { error: 'timeoutMs must be a positive integer when provided.' });
    return null;
  }

  try {
    const normalizedCommand = assertRpcCommandAllowed(command);
    if (normalizedCommand === 'exec_python') {
      payload = assertExecPythonPayloadAllowed(payload, {
        allowTrustedPythonExecution: options.allowTrustedPythonExecution === true,
      });
    }
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 400;
    try {
      await appendAuditRecord({
        eventType: AUDIT_EVENT_TYPES.RPC_COMMAND_BLOCKED,
        payload: {
          method: req.method || '',
          path: req.url || '',
          command,
          allowTrustedPythonExecution: options.allowTrustedPythonExecution === true,
          errorCode: error.code || '',
          statusCode,
        },
        actor: 'request',
        source: 'api',
      });
    } catch {
      // Audit logging must not break API behavior.
    }
    sendJson(res, statusCode, {
      error: error.message || 'RPC command blocked by policy.',
      code: error.code || 'SECURITY_POLICY_VIOLATION',
    });
    return null;
  }

  return {
    command,
    payload,
    timeoutMs,
  };
};

const enforceApiKeyAuth = async (req, res) => {
  const settings = await runStore.getSettings();
  const expectedKey = settings && settings.serverApiKey;
  if (isAuthorizedRequest(req.headers || {}, expectedKey)) {
    return { ok: true, settings };
  }

  try {
    await appendAuditRecord({
      eventType: AUDIT_EVENT_TYPES.AUTH_FAILURE,
      payload: {
        method: req.method || '',
        path: req.url || '',
        hasAuthorizationHeader: Boolean(req.headers && req.headers.authorization),
        hasAetherApiKeyHeader: Boolean(req.headers && req.headers['x-aether-api-key']),
      },
      actor: 'request',
      source: 'api',
    });
  } catch {
    // Audit logging must not break API behavior.
  }

  sendJson(res, 401, { error: 'Unauthorized' });
  return { ok: false, settings };
};

const handler = async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/protocol/handshake') {
      const requestedVersion =
        parsedUrl.searchParams.get('version') ||
        req.headers['x-aether-protocol-version'] ||
        '';
      try {
        const result = assertHandshakeCompatible({ requestedVersion });
        sendJson(res, 200, result);
      } catch (error) {
        const mapped = mapErrorToTaxonomy(error, { fallbackCode: 'PROTOCOL_VERSION_MISMATCH' });
        sendJson(res, mapped.statusCode, {
          ok: false,
          ...toErrorResponse(error, { fallbackCode: 'PROTOCOL_VERSION_MISMATCH' }),
          supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
        });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      const readyOrchestrator = getOrchestrator();
      if (readyOrchestrator && typeof readyOrchestrator.getHealth === 'function') {
        const health = await readyOrchestrator.getHealth();
        sendJson(res, 200, health);
        return;
      }
      sendJson(res, 200, { ok: true, status: 'degraded', reason: 'runOrchestrator unavailable' });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/metrics') {
      sendJson(res, 200, { metrics: snapshotMetrics() });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/presets') {
      const presets = await presetStore.listPresets();
      sendJson(res, 200, { presets });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/presets/export') {
      const idsParam = String(parsedUrl.searchParams.get('ids') || '').trim();
      const ids = idsParam
        ? idsParam
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : undefined;
      const bundle = await presetStore.exportPresetBundle({ ids });
      sendJson(res, 200, { bundle });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/presets/import') {
      const auth = await enforceApiKeyAuth(req, res);
      if (!auth.ok) return;
      const body = await parseJsonBody(req);
      const bundle = body && Object.prototype.hasOwnProperty.call(body, 'bundle') ? body.bundle : body;
      const result = await presetStore.importPresetBundle(bundle);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/presets') {
      const auth = await enforceApiKeyAuth(req, res);
      if (!auth.ok) return;
      const body = await parseJsonBody(req);
      const preset = await presetStore.upsertPreset(body, { allowMigration: true });
      sendJson(res, 201, { preset });
      return;
    }

    const presetMatch = pathname.match(/^\/api\/presets\/([^/]+)$/);
    if (req.method === 'GET' && presetMatch) {
      const presetId = decodeURIComponent(presetMatch[1]);
      const preset = await presetStore.getPreset(presetId);
      if (!preset) {
        sendJson(res, 404, { error: 'Preset not found.' });
        return;
      }
      sendJson(res, 200, { preset });
      return;
    }

    if (req.method === 'PUT' && presetMatch) {
      const auth = await enforceApiKeyAuth(req, res);
      if (!auth.ok) return;
      const presetId = decodeURIComponent(presetMatch[1]);
      const body = await parseJsonBody(req);
      const preset = await presetStore.upsertPreset(
        {
          ...(body || {}),
          id: presetId,
        },
        { allowMigration: true },
      );
      sendJson(res, 200, { preset });
      return;
    }

    if (req.method === 'DELETE' && presetMatch) {
      const auth = await enforceApiKeyAuth(req, res);
      if (!auth.ok) return;
      const presetId = decodeURIComponent(presetMatch[1]);
      if (typeof presetStore.deletePreset !== 'function') {
        sendJson(res, 501, { error: 'Preset deletion is not supported by this server build.' });
        return;
      }
      const deleted = await presetStore.deletePreset(presetId);
      if (!deleted) {
        sendJson(res, 404, { error: 'Preset not found.' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/settings') {
      const readyOrchestrator = getOrchestrator();
      if (readyOrchestrator && typeof readyOrchestrator.getSettings === 'function') {
        const settings = await readyOrchestrator.getSettings();
        sendJson(res, 200, { settings });
        return;
      }
      const settings = await runStore.getSettings();
      sendJson(res, 200, { settings: redactSettings(settings) });
      return;
    }

    if (req.method === 'PUT' && pathname === '/api/settings') {
      const body = await parseJsonBody(req);
      const readyOrchestrator = getOrchestrator();
      if (readyOrchestrator && typeof readyOrchestrator.updateSettings === 'function') {
        try {
          const result = await readyOrchestrator.updateSettings(body);
          sendJson(res, 200, {
            valid: true,
            settings: result.settings,
            blenderInfo: result.validation && result.validation.blenderInfo,
          });
        } catch (error) {
          const statusCode = error && error.statusCode ? error.statusCode : 400;
          sendJson(res, statusCode, {
            valid: false,
            errors: error && Array.isArray(error.details) ? error.details : [error.message || 'Invalid settings.'],
          });
        }
        return;
      }
      const nextSettings = await runStore.putSettings(body);
      sendJson(res, 200, { valid: true, settings: redactSettings(nextSettings) });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/runs') {
      const runs = await syncRunsFromOrchestrator();
      sendJson(res, 200, { runs });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/runs') {
      const orchestrator = getOrchestrator();
      if (!orchestrator) {
        sendJson(res, 503, { error: 'runOrchestrator is not available.' });
        return;
      }
      const auth = await enforceApiKeyAuth(req, res);
      if (!auth.ok) return;

      const payload = await parseJsonBody(req);
      const started = await orchestrator.startRun(payload);
      const normalized = normalizeRun(started);
      if (!normalized) {
        sendJson(res, 502, { error: 'runOrchestrator.startRun returned invalid run data.' });
        return;
      }
      await runStore.createOrUpsertRun(normalized);
      sseHub.publish(normalized.id, 'run.updated', { run: normalized });
      sendJson(res, 201, { run: normalized });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/blender/launch') {
      const auth = await enforceApiKeyAuth(req, res);
      if (!auth.ok) return;
      const payload = await parseJsonBody(req);
      const session = await blenderSessionManager.launchSession({
        mode: payload?.mode === 'headless' ? 'headless' : 'gui',
      });
      sendJson(res, 201, { session });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/blender/active') {
      const session = blenderSessionManager.getActiveSession();
      if (!session) {
        sendJson(res, 404, { error: 'No active Blender session.' });
        return;
      }
      sendJson(res, 200, { session });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/blender/active/rpc') {
      const auth = await enforceApiKeyAuth(req, res);
      if (!auth.ok) return;
      const rpcBody = await parseRpcBody(req, res, {
        allowTrustedPythonExecution: Boolean(auth.settings && auth.settings.allowTrustedPythonExecution),
      });
      if (!rpcBody) return;

      try {
        const response = await blenderSessionManager.executeOnActive(
          rpcBody.command,
          rpcBody.payload,
          rpcBody.timeoutMs,
        );
        sendJson(res, 200, response);
      } catch (error) {
        const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 502;
        sendJson(res, statusCode, { error: error.message || 'RPC call failed.' });
      }
      return;
    }

    const blenderStreamMatch = pathname.match(/^\/api\/blender\/([^/]+)\/stream$/);
    if (req.method === 'GET' && blenderStreamMatch) {
      const sessionId = decodeURIComponent(blenderStreamMatch[1]);
      const session = blenderSessionManager.getSession(sessionId);
      handleStream(res, req, `blender:${sessionId}`, null);
      if (session) {
        publishBlenderSessionEvents(sessionId, session, 0);
      }
      return;
    }

    const blenderStopMatch = pathname.match(/^\/api\/blender\/([^/]+)\/stop$/);
    if (req.method === 'POST' && blenderStopMatch) {
      const auth = await enforceApiKeyAuth(req, res);
      if (!auth.ok) return;
      const sessionId = decodeURIComponent(blenderStopMatch[1]);
      const before = blenderSessionManager.getSession(sessionId);
      const beforeEventCount = before && Array.isArray(before.events) ? before.events.length : 0;
      const session = await blenderSessionManager.stopSession(sessionId);
      if (!session) {
        sendJson(res, 404, { error: 'Blender session not found.' });
        return;
      }
      publishBlenderSessionEvents(sessionId, session, beforeEventCount);
      sendJson(res, 200, { session });
      return;
    }

    const blenderRpcMatch = pathname.match(/^\/api\/blender\/([^/]+)\/rpc$/);
    if (req.method === 'POST' && blenderRpcMatch) {
      const auth = await enforceApiKeyAuth(req, res);
      if (!auth.ok) return;
      const sessionId = decodeURIComponent(blenderRpcMatch[1]);
      const rpcBody = await parseRpcBody(req, res, {
        allowTrustedPythonExecution: Boolean(auth.settings && auth.settings.allowTrustedPythonExecution),
      });
      if (!rpcBody) return;

      try {
        const result = await blenderSessionManager.executeRpc(
          sessionId,
          rpcBody.command,
          rpcBody.payload,
          rpcBody.timeoutMs,
        );
        sendJson(res, 200, { sessionId, result });
      } catch (error) {
        const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 502;
        sendJson(res, statusCode, { error: error.message || 'RPC call failed.' });
      }
      return;
    }

    const blenderMatch = pathname.match(/^\/api\/blender\/([^/]+)$/);
    if (req.method === 'GET' && blenderMatch) {
      const sessionId = decodeURIComponent(blenderMatch[1]);
      const session = blenderSessionManager.getSession(sessionId);
      if (!session) {
        sendJson(res, 404, { error: 'Blender session not found.' });
        return;
      }

      const streamKey = `blender:${sessionId}`;
      const lastPublished = Number.parseInt(String(parsedUrl.searchParams.get('from') || '0'), 10);
      publishBlenderSessionEvents(sessionId, session, Number.isNaN(lastPublished) ? 0 : lastPublished);
      sseHub.publish(streamKey, 'session', { session });
      sendJson(res, 200, { session });
      return;
    }

    const streamMatch = pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
    if (req.method === 'GET' && streamMatch) {
      const runId = decodeURIComponent(streamMatch[1]);
      const run = await readRunFromSources(runId);
      handleStream(res, req, runId, run || null);
      return;
    }

    const cancelMatch = pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const runId = decodeURIComponent(cancelMatch[1]);
      const orchestrator = getOrchestrator();
      if (!orchestrator) {
        sendJson(res, 503, { error: 'runOrchestrator is not available.' });
        return;
      }
      const auth = await enforceApiKeyAuth(req, res);
      if (!auth.ok) return;

      const canceled = await orchestrator.cancelRun(runId);
      const normalized = normalizeRun(canceled, runId);
      if (!normalized) {
        sendJson(res, 502, { error: 'runOrchestrator.cancelRun returned invalid run data.' });
        return;
      }
      await runStore.createOrUpsertRun(normalized);
      sseHub.publish(runId, 'run.updated', { run: normalized });
      sendJson(res, 200, { run: normalized });
      return;
    }

    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (req.method === 'GET' && runMatch) {
      const runId = decodeURIComponent(runMatch[1]);
      const run = await readRunFromSources(runId);
      if (!run) {
        sendJson(res, 404, { error: 'Run not found.' });
        return;
      }
      sendJson(res, 200, { run });
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    const mapped = mapErrorToTaxonomy(
      error && error.message === 'Invalid JSON body'
        ? Object.assign(error, { code: 'INVALID_JSON_BODY', statusCode: 400 })
        : error,
      { fallbackCode: 'INTERNAL_ERROR' },
    );
    sendJson(res, mapped.statusCode, toErrorResponse(error, { fallbackCode: mapped.code }));
  }
};

const start = async () => {
  await runStore.ensureInitialized();
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      const mapped = mapErrorToTaxonomy(error, { fallbackCode: 'INTERNAL_ERROR' });
      sendJson(res, mapped.statusCode, toErrorResponse(error, { fallbackCode: mapped.code }));
    });
  });

  server.listen(PORT, HOST, () => {
    process.stdout.write(`Server listening on http://${HOST}:${PORT}\n`);
  });

  return server;
};

if (require.main === module) {
  start().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  start,
  handler,
};
