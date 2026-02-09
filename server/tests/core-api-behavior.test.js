const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { mergeSettings, redactSettings, resolveApiKey } = require('../lib/settingsService');
const { readJson, writeJson } = require('../lib/fsUtils');

test('mergeSettings preserves defaults and merges modelMap values', () => {
  const merged = mergeSettings({
    timeoutMs: 9999,
    modelMap: { 'GLM 4.7': 'custom-glm' },
  });

  assert.equal(merged.timeoutMs, 9999);
  assert.equal(merged.modelMap['GLM 4.7'], 'custom-glm');
  assert.ok(merged.modelMap['Claude Sonnet']);
});

test('redactSettings hides serverApiKey while exposing hasServerApiKey', () => {
  const redacted = redactSettings({
    apiKeySourceMode: 'server-managed',
    serverApiKey: 'super-secret',
  });

  assert.equal(redacted.serverApiKey, undefined);
  assert.equal(redacted.hasServerApiKey, true);
});

test('resolveApiKey prefers server-managed key and falls back to environment keys', () => {
  const oldEnv = { ...process.env };
  process.env.LLM_API_KEY = '';
  process.env.ANTHROPIC_AUTH_TOKEN = '';
  process.env.OPENAI_API_KEY = 'openai-key';
  process.env.ZHIPU_API_KEY = 'zhipu-key';
  process.env.ANTHROPIC_API_KEY = 'anthropic-key';

  try {
    const serverManaged = resolveApiKey({
      apiKeySourceMode: 'server-managed',
      serverApiKey: 'managed-key',
    });
    const fallback = resolveApiKey({
      apiKeySourceMode: 'env',
      serverApiKey: '',
    });

    assert.equal(serverManaged, 'managed-key');
    assert.equal(fallback, 'openai-key');
  } finally {
    process.env = oldEnv;
  }
});

test('resolveApiKey does not fall back to env when source mode is server-managed', () => {
  const oldEnv = { ...process.env };
  process.env.OPENAI_API_KEY = 'openai-key';
  try {
    const value = resolveApiKey({
      apiKeySourceMode: 'server-managed',
      serverApiKey: '',
    });
    assert.equal(value, '');
  } finally {
    process.env = oldEnv;
  }
});

test('writeJson + readJson persist values and readJson returns fallback for missing files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-fs-'));
  const jsonPath = path.join(tempDir, 'sample.json');
  const missingPath = path.join(tempDir, 'missing.json');

  const value = { a: 1, nested: { b: true } };
  await writeJson(jsonPath, value);
  const loaded = await readJson(jsonPath, null);
  const fallback = await readJson(missingPath, { missing: true });

  assert.deepEqual(loaded, value);
  assert.deepEqual(fallback, { missing: true });
});
