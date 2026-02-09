const test = require('node:test');
const assert = require('node:assert/strict');

const { ADAPTERS, resolveAdapter } = require('../lib/providers/registry');
const { normalizeProviderStreamEvents, collectStreamText } = require('../lib/providers/streamNormalization');

const REQUIRED_ADAPTER_KEYS = ['openai', 'anthropic', 'gemini', 'openai-compatible'];

test('provider adapter registry exposes required adapters with common contract', () => {
  for (const key of REQUIRED_ADAPTER_KEYS) {
    const { adapter } = resolveAdapter(key);
    assert.ok(adapter, `missing adapter: ${key}`);
    assert.equal(typeof adapter.name, 'string');
    assert.equal(typeof adapter.buildRequest, 'function');
    assert.equal(typeof adapter.extractContent, 'function');
    assert.equal(typeof adapter.extractUsage, 'function');
    assert.equal(typeof adapter.normalizeStreamEvent, 'function');
  }

  assert.equal(resolveAdapter('custom').adapter.name, 'openai-compatible');
  assert.equal(resolveAdapter('unknown-provider').adapter.name, 'openai-compatible');
  assert.ok(ADAPTERS.openai);
  assert.ok(ADAPTERS.anthropic);
  assert.ok(ADAPTERS.gemini);
});

test('openai adapter request/response normalization contract', () => {
  const { adapter } = resolveAdapter('openai');
  const body = adapter.buildRequest({
    model: 'gpt-test',
    prompt: 'build',
    stream: true,
    systemPrompt: 'sys',
  });

  assert.equal(body.model, 'gpt-test');
  assert.equal(body.stream, true);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(
    adapter.extractContent({
      choices: [{ message: { content: [{ type: 'text', text: 'openai content' }] } }],
    }),
    'openai content',
  );
  assert.deepEqual(adapter.extractUsage({ usage: { total_tokens: 11 } }), { total_tokens: 11 });
});

test('anthropic adapter request/response normalization contract', () => {
  const { adapter } = resolveAdapter('anthropic');
  const body = adapter.buildRequest({
    model: 'claude-test',
    prompt: 'build',
    systemPrompt: 'sys',
  });

  assert.equal(body.model, 'claude-test');
  assert.equal(body.max_tokens, 1024);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(
    adapter.extractContent({
      content: [{ type: 'text', text: 'anth content' }],
    }),
    'anth content',
  );
  assert.deepEqual(adapter.extractUsage({ usage: { input_tokens: 4, output_tokens: 7 } }), {
    input_tokens: 4,
    output_tokens: 7,
  });
});

test('gemini adapter request/response normalization contract', () => {
  const { adapter } = resolveAdapter('gemini');

  const nativeBody = adapter.buildRequest({
    model: 'gemini-2.5-pro',
    prompt: 'build',
    stream: false,
    systemPrompt: 'sys',
    requestConfig: { url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent' },
  });
  assert.equal(Array.isArray(nativeBody.contents), true);
  assert.equal(nativeBody.generationConfig.maxOutputTokens, 1024);

  const compatibleBody = adapter.buildRequest({
    model: 'gemini-2.5-pro',
    prompt: 'build',
    stream: true,
    systemPrompt: 'sys',
    requestConfig: { url: 'https://proxy.example/v1/chat/completions' },
  });
  assert.equal(compatibleBody.stream, true);
  assert.equal(compatibleBody.messages[0].role, 'system');

  assert.equal(
    adapter.extractContent({
      candidates: [{ content: { parts: [{ text: 'gemini content' }] } }],
    }),
    'gemini content',
  );
  assert.deepEqual(
    adapter.extractUsage({
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8, totalTokenCount: 13 },
    }),
    { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
  );
});

test('openai-compatible adapter mirrors openai contract shape', () => {
  const { adapter } = resolveAdapter('openai-compatible');
  const body = adapter.buildRequest({
    model: 'qwen-turbo',
    prompt: 'build',
    stream: false,
    systemPrompt: 'sys',
  });

  assert.equal(body.model, 'qwen-turbo');
  assert.equal(body.stream, false);
  assert.equal(body.messages[1].role, 'user');
});

test('stream normalization parity emits canonical events across providers', () => {
  const openAiSse = [
    'data: {"choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}',
    '',
    'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}],"usage":{"total_tokens":9}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');

  const anthropicSse = [
    'event: message_start',
    'data: {"type":"message_start"}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"text":"Hello "}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"text":"world"}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"input_tokens":3,"output_tokens":6}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');

  const geminiSse = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]},"finishReason":null}]}',
    '',
    'data: {"candidates":[{"content":{"parts":[{"text":"world"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":5,"totalTokenCount":9}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');

  const openAiEvents = normalizeProviderStreamEvents({
    rawText: openAiSse,
    adapter: resolveAdapter('openai').adapter,
  });
  const anthropicEvents = normalizeProviderStreamEvents({
    rawText: anthropicSse,
    adapter: resolveAdapter('anthropic').adapter,
  });
  const geminiEvents = normalizeProviderStreamEvents({
    rawText: geminiSse,
    adapter: resolveAdapter('gemini').adapter,
  });

  assert.equal(collectStreamText(openAiEvents), 'Hello world');
  assert.equal(collectStreamText(anthropicEvents), 'Hello world');
  assert.equal(collectStreamText(geminiEvents), 'Hello world');

  assert.equal(openAiEvents.some((evt) => evt.type === 'response.completed'), true);
  assert.equal(anthropicEvents.some((evt) => evt.type === 'response.completed'), true);
  assert.equal(geminiEvents.some((evt) => evt.type === 'response.completed'), true);

  assert.equal(openAiEvents.some((evt) => evt.type === 'response.usage'), true);
  assert.equal(anthropicEvents.some((evt) => evt.type === 'response.usage'), true);
  assert.equal(geminiEvents.some((evt) => evt.type === 'response.usage'), true);
});
