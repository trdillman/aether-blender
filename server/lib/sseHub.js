const clientsByRunId = new Map();

const KEEPALIVE_INTERVAL_MS = 15000;
let keepAliveTimer = null;

const formatEvent = (eventName, data) => {
  const chunks = [];
  if (eventName) {
    chunks.push(`event: ${eventName}`);
  }
  chunks.push(`data: ${JSON.stringify(data)}`);
  return `${chunks.join('\n')}\n\n`;
};

const writeEvent = (client, eventName, data) => {
  if (!client || client.closed) return;
  try {
    client.res.write(formatEvent(eventName, data));
  } catch {
    client.closed = true;
  }
};

const maybeStartKeepAlive = () => {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    for (const clients of clientsByRunId.values()) {
      for (const client of clients) {
        writeEvent(client, 'heartbeat', { ts: Date.now() });
      }
    }
  }, KEEPALIVE_INTERVAL_MS);
};

const maybeStopKeepAlive = () => {
  if (clientsByRunId.size > 0 || !keepAliveTimer) return;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
};

const attach = (runId, req, res) => {
  const normalizedId = String(runId);
  const client = { res, closed: false };

  if (!clientsByRunId.has(normalizedId)) {
    clientsByRunId.set(normalizedId, new Set());
  }
  clientsByRunId.get(normalizedId).add(client);
  maybeStartKeepAlive();

  const detach = () => {
    if (client.closed) return;
    client.closed = true;
    const set = clientsByRunId.get(normalizedId);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        clientsByRunId.delete(normalizedId);
      }
    }
    maybeStopKeepAlive();
  };

  req.on('close', detach);
  req.on('error', detach);
  res.on('close', detach);
  res.on('error', detach);

  writeEvent(client, 'connected', { runId: normalizedId });
};

const publish = (runId, eventName, data) => {
  const normalizedId = String(runId);
  const clients = clientsByRunId.get(normalizedId);
  if (!clients || clients.size === 0) return;

  for (const client of clients) {
    writeEvent(client, eventName, data);
  }
};

module.exports = {
  attach,
  publish,
};
