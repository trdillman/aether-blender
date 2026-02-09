const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const FALLBACK_API_ORIGIN =
  typeof window !== 'undefined' ? `http://${window.location.hostname || 'localhost'}:8787` : 'http://localhost:8787';

const toApiUrl = (path) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!API_BASE) return normalizedPath;

  if (/^https?:\/\//i.test(API_BASE)) {
    return `${API_BASE}${normalizedPath}`;
  }

  return `${API_BASE.startsWith('/') ? API_BASE : `/${API_BASE}`}${normalizedPath}`;
};

const resolveStreamUrl = (path) => {
  if (!API_BASE) {
    return `${FALLBACK_API_ORIGIN}${path}`;
  }
  return toApiUrl(path);
};

let cachedServerApiKey = '';
export const updateServerApiKey = (value) => {
  cachedServerApiKey = String(value || '').trim();
};

const parseJsonSafely = (text) => {
  if (typeof text !== 'string' || !text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const requestJson = async (path, options = {}) => {
  const doFetch = async (url) =>
    fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(cachedServerApiKey ? { 'x-aether-api-key': cachedServerApiKey } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });

  let response;
  try {
    response = await doFetch(toApiUrl(path));
  } catch (error) {
    const shouldFallback = !API_BASE && path.startsWith('/api/');
    if (!shouldFallback) {
      const wrapped = new Error(`Failed to connect to backend API: ${error?.message || 'network error'}`);
      wrapped.cause = error;
      throw wrapped;
    }
    response = await doFetch(`${FALLBACK_API_ORIGIN}${path}`);
  }

  const raw = await response.text();
  const json = parseJsonSafely(raw);

  if (!response.ok) {
    const message =
      json?.error?.message ||
      json?.message ||
      (raw ? `${response.status} ${response.statusText}: ${raw}` : `${response.status} ${response.statusText}`);

    const error = new Error(message);
    error.status = response.status;
    error.payload = json;
    throw error;
  }

  return json;
};

const normalizeRunsResponse = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.runs)) return payload.runs;
  if (Array.isArray(payload?.data?.runs)) return payload.data.runs;
  return [];
};

export const fetchRuns = async ({ signal } = {}) => {
  const payload = await requestJson('/api/runs', { method: 'GET', signal });
  return normalizeRunsResponse(payload);
};

export const fetchRunById = async (runId, { signal } = {}) => {
  if (!runId) throw new Error('Cannot fetch run without run id.');
  const payload = await requestJson(`/api/runs/${encodeURIComponent(runId)}`, { method: 'GET', signal });
  return payload?.run || payload?.data?.run || payload;
};

export const startRun = async ({ prompt, model, messages, signal }) => {
  const payload = await requestJson('/api/runs', {
    method: 'POST',
    signal,
    body: JSON.stringify({ prompt, model, messages }),
  });

  return payload?.run || payload?.data?.run || payload;
};

export const cancelRun = async (runId, { signal } = {}) => {
  if (!runId) throw new Error('Cannot cancel run without run id.');

  const payload = await requestJson(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    signal,
  });

  return payload?.run || payload?.data?.run || payload;
};

export const launchBlenderSession = async ({ mode = 'gui', signal } = {}) => {
  const payload = await requestJson('/api/blender/launch', {
    method: 'POST',
    signal,
    body: JSON.stringify({ mode }),
  });
  return payload?.session || payload;
};

export const fetchActiveBlenderSession = async ({ signal } = {}) => {
  try {
    const payload = await requestJson('/api/blender/active', { method: 'GET', signal });
    return payload?.session || payload || null;
  } catch (error) {
    if (error && error.status === 404) return null;
    throw error;
  }
};

export const stopBlenderSession = async (sessionId, { signal } = {}) => {
  if (!sessionId) throw new Error('Cannot stop Blender session without session id.');
  const payload = await requestJson(`/api/blender/${encodeURIComponent(sessionId)}/stop`, {
    method: 'POST',
    signal,
  });
  return payload?.session || payload;
};

export const executeBlenderRpc = async (sessionId, { command, payload = {}, timeoutMs, signal } = {}) => {
  if (!sessionId) throw new Error('Cannot execute Blender RPC without session id.');
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Cannot execute Blender RPC without a command.');
  }

  const body = { command: command.trim(), payload };
  if (timeoutMs != null) body.timeoutMs = timeoutMs;

  const response = await requestJson(`/api/blender/${encodeURIComponent(sessionId)}/rpc`, {
    method: 'POST',
    signal,
    body: JSON.stringify(body),
  });

  return response;
};

export const executeActiveBlenderRpc = async ({ command, payload = {}, timeoutMs, signal } = {}) => {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Cannot execute Blender RPC without a command.');
  }

  const body = { command: command.trim(), payload };
  if (timeoutMs != null) body.timeoutMs = timeoutMs;

  const response = await requestJson('/api/blender/active/rpc', {
    method: 'POST',
    signal,
    body: JSON.stringify(body),
  });

  return response;
};

export const fetchSettings = async ({ signal } = {}) => {
  const payload = await requestJson('/api/settings', { method: 'GET', signal });
  return payload?.settings || payload || {};
};

export const saveSettings = async (nextSettings, { signal } = {}) => {
  const payload = await requestJson('/api/settings', {
    method: 'PUT',
    signal,
    body: JSON.stringify(nextSettings),
  });
  return payload || {};
};

export const fetchPresets = async ({ signal } = {}) => {
  const payload = await requestJson('/api/presets', { method: 'GET', signal });
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.presets) ? payload.presets : [];
};

export const createPreset = async (
  { name, description, sourceRunId, protocol, metadata },
  { signal } = {},
) => {
  const body = {
    name,
    description,
    protocol,
    schemaVersion: '1.0',
  };
  if (sourceRunId) body.sourceRunId = sourceRunId;
  if (metadata) body.metadata = metadata;
  const payload = await requestJson('/api/presets', {
    method: 'POST',
    signal,
    body: JSON.stringify(body),
  });
  return payload?.preset || payload;
};

export const fetchPresetById = async (presetId, { signal } = {}) => {
  if (!presetId) throw new Error('Cannot fetch preset without preset id.');
  const payload = await requestJson(`/api/presets/${encodeURIComponent(presetId)}`, {
    method: 'GET',
    signal,
  });
  return payload?.preset || payload;
};

export const deletePreset = async (presetId, { signal } = {}) => {
  if (!presetId) throw new Error('Cannot delete preset without preset id.');
  const payload = await requestJson(`/api/presets/${encodeURIComponent(presetId)}`, {
    method: 'DELETE',
    signal,
  });
  return payload || { ok: true };
};

const parseSsePayload = (raw) => {
  if (typeof raw !== 'string') return null;
  const parsed = parseJsonSafely(raw);
  return parsed ?? { text: raw };
};

const pushEvent = (handler, kind, payload) => {
  if (typeof handler !== 'function') return;

  handler({
    kind,
    payload,
    type: payload?.type || payload?.event || payload?.kind || kind,
  });
};

export const subscribeRunStream = (runId, { onEvent, onError, onOpen } = {}) => {
  if (!runId) throw new Error('Cannot subscribe run stream without run id.');

  const source = new EventSource(resolveStreamUrl(`/api/runs/${encodeURIComponent(runId)}/stream`));

  source.onopen = () => {
    if (typeof onOpen === 'function') onOpen();
  };

  source.onmessage = (event) => {
    pushEvent(onEvent, 'message', parseSsePayload(event.data));
  };

  const typedHandlers = {
    run: 'run',
    status: 'status',
    trace: 'trace',
    'trace.step': 'trace.step',
    log: 'log',
    assistant: 'assistant',
    'assistant.delta': 'assistant.delta',
    'assistant.message': 'assistant.message',
    done: 'done',
    complete: 'complete',
    error: 'error',
    run_started: 'run_started',
    step_started: 'step_started',
    tool_called: 'tool_called',
    blender_started: 'blender_started',
    blender_log: 'blender_log',
    step_completed: 'step_completed',
    run_failed: 'run_failed',
    run_completed: 'run_completed',
  };

  Object.entries(typedHandlers).forEach(([sseName, kind]) => {
    source.addEventListener(sseName, (event) => {
      pushEvent(onEvent, kind, parseSsePayload(event.data));
    });
  });

  source.onerror = (event) => {
    if (typeof onError === 'function') onError(event);
  };

  return source;
};

export const subscribeBlenderSessionStream = (sessionId, { onEvent, onError, onOpen } = {}) => {
  if (!sessionId) throw new Error('Cannot subscribe blender stream without session id.');

  const source = new EventSource(resolveStreamUrl(`/api/blender/${encodeURIComponent(sessionId)}/stream`));

  source.onopen = () => {
    if (typeof onOpen === 'function') onOpen();
  };

  source.onmessage = (event) => {
    pushEvent(onEvent, 'message', parseSsePayload(event.data));
  };

  source.addEventListener('status', (event) => {
    pushEvent(onEvent, 'status', parseSsePayload(event.data));
  });

  source.addEventListener('log', (event) => {
    pushEvent(onEvent, 'log', parseSsePayload(event.data));
  });

  source.addEventListener('session', (event) => {
    pushEvent(onEvent, 'session', parseSsePayload(event.data));
  });

  source.onerror = (event) => {
    if (typeof onError === 'function') onError(event);
  };

  return source;
};

export { toApiUrl };
