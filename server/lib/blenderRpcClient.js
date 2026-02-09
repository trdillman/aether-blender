const http = require('http');

const requestJson = ({ method, hostname, port, path, headers, body, timeoutMs = 10000 }) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        hostname,
        port,
        path,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, payload: json, raw });
            return;
          }

          const message =
            (json && (json.error || json.message)) ||
            (raw && raw.trim()) ||
            `RPC request failed with status ${res.statusCode}`;
          const error = new Error(message);
          error.statusCode = res.statusCode;
          error.payload = json;
          reject(error);
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`RPC request timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });

const pingBridge = async ({ port, timeoutMs = 1000 }) => {
  const result = await requestJson({
    method: 'GET',
    hostname: '127.0.0.1',
    port,
    path: '/health',
    headers: {},
    timeoutMs,
  });

  return Boolean(result.payload && result.payload.ok);
};

const callBridge = async ({ port, token, command, payload = {}, timeoutMs = 120000 }) => {
  const body = JSON.stringify({ command, payload });
  const result = await requestJson({
    method: 'POST',
    hostname: '127.0.0.1',
    port,
    path: '/rpc',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Aether-Token': token || '',
    },
    body,
    timeoutMs,
  });

  if (!result.payload || result.payload.ok !== true) {
    throw new Error((result.payload && result.payload.error) || 'RPC command failed.');
  }

  return result.payload.result;
};

module.exports = {
  pingBridge,
  callBridge,
};
