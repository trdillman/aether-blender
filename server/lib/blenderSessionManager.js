const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { killProcessTree, nowIso } = require('./utils');
const runStore = require('./runStore');
const { callBridge } = require('./blenderRpcClient');
const { appendAuditRecord, AUDIT_EVENT_TYPES } = require('./auditLog');

const sessions = new Map();
const subscribers = new Set();

const createId = () => `blender_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const createRpcToken = () => crypto.randomBytes(24).toString('hex');
const SAFE_EXEC_PYTHON_BLOCK_CODES = new Set(['SAF_004_BLOCKED_IMPORT', 'SAF_004_BLOCKED_BUILTIN']);

const allocateLocalPort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
          return;
        }
        if (!port || Number.isNaN(Number(port))) {
          reject(new Error('Failed to allocate RPC bridge port.'));
          return;
        }
        resolve(Number(port));
      });
    });
  });

const splitLines = (buffered, chunk) => {
  const text = `${buffered}${String(chunk || '')}`;
  const lines = text.split(/\r?\n/);
  return {
    lines: lines.slice(0, -1),
    rest: lines[lines.length - 1] || '',
  };
};

const launchSession = async ({ mode }) => {
  const settings = await runStore.getSettings();
  const blenderPath = settings.blenderPath || 'blender';
  const allowedAddonRoot = path.resolve(settings.addonOutputPath || path.resolve(__dirname, '..', '..', 'generated_addons'));
  const runMode = mode === 'headless' ? 'headless' : 'gui';
  const bridgeScript = path.resolve(__dirname, '..', 'blender_rpc_bridge.py');
  const rpcPort = await allocateLocalPort();
  const rpcToken = createRpcToken();
  const args = runMode === 'headless' ? ['-b', '--python', bridgeScript] : ['--python', bridgeScript];

  const session = {
    id: createId(),
    status: 'starting',
    mode: runMode,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: null,
    endedAt: null,
    pid: null,
    logs: [],
    events: [],
    child: null,
    rpcPort,
    rpcToken,
    rpcReady: false,
    bridgeError: null,
    supportsRpc: true,
  };

  const child = spawn(blenderPath, args, {
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      AETHER_RPC_PORT: String(rpcPort),
      AETHER_RPC_TOKEN: rpcToken,
      AETHER_ALLOWED_ADDON_ROOT: allowedAddonRoot,
    },
  });

  session.child = child;
  session.pid = child.pid;
  sessions.set(session.id, session);

  const pushEvent = (event) => {
    const evt = {
      id: `${session.id}_${session.events.length + 1}`,
      timestamp: nowIso(),
      sessionId: session.id,
      ...event,
    };
    session.events.push(evt);
    session.updatedAt = evt.timestamp;
    for (const listener of subscribers) {
      try {
        listener(evt);
      } catch {
        // ignore listener failures
      }
    }
    return evt;
  };

  session.startedAt = nowIso();
  session.status = 'running';
  pushEvent({ type: 'blender_started', mode: session.mode, pid: session.pid, args });

  let stdoutBuf = '';
  let stderrBuf = '';

  const addLog = (stream, line) => {
    const entry = {
      timestamp: nowIso(),
      stream,
      line,
    };
    session.logs.push(entry);
    pushEvent({ type: 'blender_log', stream, line });

    if (!session.rpcReady && /\[AETHER_RPC_READY\]/.test(line)) {
      session.rpcReady = true;
      session.bridgeError = null;
      pushEvent({
        type: 'blender_rpc_ready',
        rpcPort: session.rpcPort,
      });
      return;
    }

    if (
      !session.bridgeError &&
      (/\[AETHER_RPC_ERROR\]/.test(line) || /\[AETHER_RPC_DISABLED\]/.test(line))
    ) {
      session.bridgeError = line;
      pushEvent({
        type: 'blender_rpc_error',
        message: line,
      });
    }
  };

  child.stdout.on('data', (chunk) => {
    const result = splitLines(stdoutBuf, chunk);
    stdoutBuf = result.rest;
    result.lines.forEach((line) => addLog('stdout', line));
  });

  child.stderr.on('data', (chunk) => {
    const result = splitLines(stderrBuf, chunk);
    stderrBuf = result.rest;
    result.lines.forEach((line) => addLog('stderr', line));
  });

  child.on('error', (error) => {
    session.status = 'failed';
    session.endedAt = nowIso();
    session.bridgeError = String(error.message || error);
    pushEvent({ type: 'blender_failed', error: String(error.message || error) });
  });

  child.on('close', (code, signal) => {
    if (stdoutBuf) addLog('stdout', stdoutBuf);
    if (stderrBuf) addLog('stderr', stderrBuf);

    session.endedAt = nowIso();
    if (session.status !== 'stopping' && session.status !== 'stopped') {
      session.status = code === 0 ? 'completed' : 'exited';
    }

    pushEvent({
      type: 'blender_exited',
      code,
      signal,
      status: session.status,
    });
  });

  return {
    id: session.id,
    status: session.status,
    mode: session.mode,
    pid: session.pid,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    rpcReady: session.rpcReady,
    rpcPort: session.rpcPort,
    supportsRpc: session.supportsRpc,
    bridgeError: session.bridgeError,
  };
};

const buildSessionSummary = (session) => {
  if (!session) return null;
  return {
    id: session.id,
    status: session.status,
    mode: session.mode,
    pid: session.pid,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    rpcReady: Boolean(session.rpcReady),
    rpcPort: session.rpcPort || null,
    supportsRpc: Boolean(session.supportsRpc),
    bridgeError: session.bridgeError || null,
  };
};

const getSession = (id) => {
  const session = sessions.get(String(id));
  if (!session) return null;
  return {
    ...buildSessionSummary(session),
    logs: session.logs,
    events: session.events,
  };
};

const getActiveSession = () => {
  const running = [...sessions.values()].filter((session) => session.status === 'running');
  if (!running.length) return null;
  const sorted = running.sort((a, b) => {
    const aTime = Date.parse(a.startedAt || a.createdAt || 0) || 0;
    const bTime = Date.parse(b.startedAt || b.createdAt || 0) || 0;
    return bTime - aTime;
  });
  return buildSessionSummary(sorted[0]);
};

const executeRpc = async (sessionId, command, payload = {}, timeoutMs = 120000) => {
  const id = String(sessionId);
  const session = sessions.get(id);
  if (!session) {
    const error = new Error('Blender session not found.');
    error.statusCode = 404;
    throw error;
  }
  if (session.status !== 'running') {
    const error = new Error('Blender session is not running.');
    error.statusCode = 409;
    throw error;
  }
  if (!session.supportsRpc || !session.rpcPort) {
    const error = new Error('Blender session does not support RPC.');
    error.statusCode = 400;
    throw error;
  }
  if (!session.rpcReady) {
    const error = new Error('Blender RPC bridge is not ready yet.');
    error.statusCode = 409;
    throw error;
  }

  const pushEvent = (event) => {
    const evt = {
      id: `${session.id}_${session.events.length + 1}`,
      timestamp: nowIso(),
      sessionId: session.id,
      ...event,
    };
    session.events.push(evt);
    session.updatedAt = evt.timestamp;
    for (const listener of subscribers) {
      try {
        listener(evt);
      } catch {
        // ignore listener failures
      }
    }
    return evt;
  };

  const normalizedCommand = String(command || '').trim().toLowerCase();
  pushEvent({
    type: 'blender_rpc_call_started',
    command: normalizedCommand,
  });

  try {
    const result = await callBridge({
      port: session.rpcPort,
      token: session.rpcToken,
      command: normalizedCommand,
      payload,
      timeoutMs,
    });
    pushEvent({
      type: 'blender_rpc_call_completed',
      command: normalizedCommand,
    });
    return result;
  } catch (error) {
    const errorPayload = error && error.payload ? error.payload : null;
    const errorCode = errorPayload && errorPayload.code ? String(errorPayload.code) : '';
    const normalizedMode = String(payload && payload.mode != null ? payload.mode : 'safe')
      .trim()
      .toLowerCase();
    if (
      normalizedCommand === 'exec_python' &&
      normalizedMode === 'safe' &&
      SAFE_EXEC_PYTHON_BLOCK_CODES.has(errorCode)
    ) {
      try {
        await appendAuditRecord({
          eventType: AUDIT_EVENT_TYPES.EXEC_PYTHON_SAFE_BLOCKED,
          payload: {
            sessionId: session.id,
            command: normalizedCommand,
            mode: normalizedMode,
            errorCode,
            statusCode: Number.isInteger(error && error.statusCode) ? error.statusCode : null,
            error: String(error && error.message ? error.message : error),
          },
          actor: 'rpc',
          source: 'blenderSessionManager',
        });
      } catch {
        // Audit logging must not break RPC execution.
      }
    }
    session.bridgeError = String(error && error.message ? error.message : error);
    pushEvent({
      type: 'blender_rpc_call_failed',
      command: normalizedCommand,
      error: session.bridgeError,
    });
    throw error;
  }
};

const executeOnActive = async (command, payload = {}, timeoutMs = 120000) => {
  const active = getActiveSession();
  if (!active) {
    const error = new Error('No active Blender session.');
    error.statusCode = 404;
    throw error;
  }
  const result = await executeRpc(active.id, command, payload, timeoutMs);
  return {
    sessionId: active.id,
    result,
  };
};

const stopSession = async (id) => {
  const session = sessions.get(String(id));
  if (!session) return null;
  if (!session.child) return getSession(id);

  session.status = 'stopping';
  session.updatedAt = nowIso();
  session.events.push({
    id: `${session.id}_${session.events.length + 1}`,
    timestamp: nowIso(),
    sessionId: session.id,
    type: 'blender_stopping',
  });
  for (const listener of subscribers) {
    try {
      listener(session.events[session.events.length - 1]);
    } catch {
      // ignore listener failures
    }
  }

  await killProcessTree(session.child);

  session.status = 'stopped';
  session.endedAt = nowIso();
  session.events.push({
    id: `${session.id}_${session.events.length + 1}`,
    timestamp: nowIso(),
    sessionId: session.id,
    type: 'blender_stopped',
  });
  for (const listener of subscribers) {
    try {
      listener(session.events[session.events.length - 1]);
    } catch {
      // ignore listener failures
    }
  }

  return getSession(id);
};

module.exports = {
  launchSession,
  getSession,
  getActiveSession,
  stopSession,
  executeRpc,
  executeOnActive,
  subscribe: (listener) => {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  },
};
