const test = require('node:test');
const assert = require('node:assert/strict');

const { generatePlan, resolveRequestConfig } = require('../lib/llmService');
const { snapshot, resetMetrics } = require('../lib/metricsExporter');

test('resolveRequestConfig builds normalized provider URL and auth headers', () => {
  const cfg = resolveRequestConfig({
    llmBaseUrl: 'https://example.com/api/',
    llmChatPath: 'v1/chat/completions',
    llmApiKeyHeader: 'X-API-Key',
    llmApiKeyPrefix: '',
  });

  assert.equal(cfg.url, 'https://example.com/api/v1/chat/completions');
  assert.equal(cfg.keyHeader, 'X-API-Key');
  assert.equal(cfg.keyPrefix, '');
});

test('generatePlan performs a live provider fetch call and returns content', async () => {
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = '';

  global.fetch = async (url, init) => {
    assert.equal(url, 'https://provider.test/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer live-key');

    const parsed = JSON.parse(init.body);
    assert.equal(parsed.model, 'model-live');
    assert.equal(parsed.stream, false);
    assert.equal(parsed.messages[1].role, 'user');

    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'live plan response' } }],
          usage: { total_tokens: 10 },
        }),
    };
  };

  try {
    const result = await generatePlan({
      prompt: 'make addon',
      model: 'GLM 4.7',
      settings: {
        apiKeySourceMode: 'server-managed',
        serverApiKey: 'live-key',
        llmBaseUrl: 'https://provider.test',
        llmChatPath: '/v1/chat/completions',
        llmApiKeyHeader: 'Authorization',
        llmApiKeyPrefix: 'Bearer ',
        modelMap: { 'GLM 4.7': 'model-live' },
        timeoutMs: 10000,
      },
    });

    assert.equal(result.usedFallback, false);
    assert.equal(result.content, 'live plan response');
  } finally {
    global.fetch = originalFetch;
  }
});

test('generatePlan supports anthropic-style provider requests', async () => {
  const originalFetch = global.fetch;
  process.env.ANTHROPIC_AUTH_TOKEN = '';

  global.fetch = async (url, init) => {
    assert.equal(url, 'https://api.z.ai/api/anthropic/v1/messages');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-api-key'], 'anth-key');
    assert.equal(init.headers['anthropic-version'], '2023-06-01');

    const parsed = JSON.parse(init.body);
    assert.equal(parsed.model, 'GLM-4.7');
    assert.equal(parsed.max_tokens, 1024);
    assert.equal(parsed.messages[0].role, 'user');

    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          content: [{ type: 'text', text: 'anthropic style response' }],
        }),
    };
  };

  try {
    const result = await generatePlan({
      prompt: 'build addon',
      model: 'GLM 4.7',
      settings: {
        apiKeySourceMode: 'server-managed',
        serverApiKey: 'anth-key',
        llmProvider: 'anthropic',
        llmBaseUrl: 'https://api.z.ai/api/anthropic',
        llmChatPath: '/v1/messages',
        llmApiKeyHeader: 'x-api-key',
        llmApiKeyPrefix: '',
        anthropicVersion: '2023-06-01',
        modelMap: { 'GLM 4.7': 'GLM-4.7' },
      },
    });

    assert.equal(result.usedFallback, false);
    assert.equal(result.content, 'anthropic style response');
  } finally {
    global.fetch = originalFetch;
  }
});

test('generatePlan retries transient provider failure and emits trace span + metrics', async () => {
  const originalFetch = global.fetch;
  resetMetrics();
  let callCount = 0;
  const spans = [];

  global.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: { message: 'temporary outage' } }),
      };
    }
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'retry success' } }],
          usage: { total_tokens: 8 },
        }),
    };
  };

  try {
    const result = await generatePlan({
      prompt: 'retry test',
      model: 'GLM 4.7',
      settings: {
        apiKeySourceMode: 'server-managed',
        serverApiKey: 'live-key',
        llmProvider: 'openai',
        llmBaseUrl: 'https://provider.test',
        llmChatPath: '/v1/chat/completions',
        llmApiKeyHeader: 'Authorization',
        llmApiKeyPrefix: 'Bearer ',
        modelMap: { 'GLM 4.7': 'model-live' },
        timeoutMs: 10000,
        llmMaxRetries: 1,
      },
      operation: 'generate_plan',
      onTraceSpan: (span) => spans.push(span),
    });

    assert.equal(callCount, 2);
    assert.equal(result.content, 'retry success');
    assert.equal(spans.length, 1);
    assert.equal(spans[0].component, 'provider');
    assert.equal(spans[0].status, 'ok');
    assert.equal(spans[0].attributes.retries, 1);

    const metrics = snapshot();
    const providerEntry = metrics.providers.find(
      (entry) =>
        entry.labels.provider === 'openai' &&
        entry.labels.operation === 'generate_plan',
    );
    assert.ok(providerEntry);
    assert.equal(providerEntry.count, 1);
    assert.equal(providerEntry.success, 1);
    assert.equal(providerEntry.failure, 0);
    assert.equal(providerEntry.retries, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
