const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { pingBridge, callBridge } = require('../lib/blenderRpcClient');

const createMockRequest = ({ response = '', statusCode = 200, error = null } = {}) => {
  const res = new EventEmitter();
  res.statusCode = statusCode;

  const req = new EventEmitter();
  let body = '';
  req.write = (chunk) => {
    body += chunk;
  };
  req.setTimeout = (_, cb) => {
    req._timeoutCallback = cb;
  };
  req.destroy = (err) => {
    queueMicrotask(() => req.emit('error', err));
  };
  req.end = () => {
    queueMicrotask(() => {
      if (error) {
        req.emit('error', error);
        return;
      }
      if (response) {
        const chunk = Buffer.isBuffer(response) ? response : Buffer.from(response);
        res.emit('data', chunk);
      }
      res.emit('end');
    });
  };
  req.getBody = () => body;
  return { req, res };
};

const stubHttpRequest = (handler) => {
  const original = http.request;
  http.request = (options, callback) => {
    const { req, res } = handler(options);
    callback(res);
    return req;
  };
  return () => {
    http.request = original;
  };
};

test('pingBridge resolves true when health endpoint reports ok', async () => {
  let capturedOptions;
  const restore = stubHttpRequest((options) => {
    capturedOptions = options;
    return createMockRequest({
      response: JSON.stringify({ ok: true }),
    });
  });

  try {
    const healthy = await pingBridge({ port: 12345 });
    assert.ok(healthy);
    assert.equal(capturedOptions.method, 'GET');
    assert.equal(capturedOptions.path, '/health');
    assert.equal(capturedOptions.port, 12345);
  } finally {
    restore();
  }
});

test('pingBridge returns false for malformed responses', async () => {
  const restore = stubHttpRequest(() => createMockRequest({ response: 'pong' }));
  try {
    assert.equal(await pingBridge({ port: 54321 }), false);
  } finally {
    restore();
  }
});

test('callBridge posts RPC payload and returns the bridge result', async () => {
  let capturedOptions;
  let capturedRequest;
  const restore = stubHttpRequest((options) => {
    capturedOptions = options;
    const { req, res } = createMockRequest({
      response: JSON.stringify({ ok: true, result: 'ready' }),
    });
    capturedRequest = req;
    return { req, res };
  });

  try {
    const result = await callBridge({
      port: 2222,
      token: 'token-xyz',
      command: 'noop',
      payload: { foo: 'bar' },
    });
    assert.equal(result, 'ready');
    assert.equal(capturedOptions.method, 'POST');
    assert.equal(capturedOptions.path, '/rpc');
    assert.equal(capturedOptions.headers['X-Aether-Token'], 'token-xyz');
    assert.ok(capturedRequest.getBody().includes('"command":"noop"'));
    assert.ok(capturedRequest.getBody().includes('"foo":"bar"'));
  } finally {
    restore();
  }
});

test('callBridge surfaces RPC failures returned by the bridge', async () => {
  const restore = stubHttpRequest(() =>
    createMockRequest({
      response: JSON.stringify({ ok: false, error: 'rpc-error' }),
    }),
  );

  try {
    await assert.rejects(
      callBridge({ port: 1111, command: 'bad' }),
      { message: 'rpc-error' },
    );
  } finally {
    restore();
  }
});

test('callBridge rejects when HTTP response status indicates failure', async () => {
  const restore = stubHttpRequest(() =>
    createMockRequest({ statusCode: 503, response: 'Service not ready' }),
  );

  try {
    await assert.rejects(
      callBridge({ port: 9876, command: 'retry' }),
      (error) => {
        assert.equal(error.message, 'Service not ready');
        assert.equal(error.statusCode, 503);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('callBridge rejects when the HTTP request errors out', async () => {
  const restore = stubHttpRequest(() =>
    createMockRequest({ error: new Error('connection lost') }),
  );

  try {
    await assert.rejects(
      callBridge({ port: 5555, command: 'boom' }),
      { message: 'connection lost' },
    );
  } finally {
    restore();
  }
});
