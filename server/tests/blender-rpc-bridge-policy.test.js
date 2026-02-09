const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BRIDGE_PATH = path.resolve(__dirname, '../blender_rpc_bridge.py');
const PYTHON_BIN = process.env.PYTHON || 'python';

const runBridgeSnippet = (snippet) => {
  const pythonSource = `
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("aether_blender_rpc_bridge", r"${BRIDGE_PATH}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

${snippet}
`;

  return spawnSync(PYTHON_BIN, ['-c', pythonSource], {
    encoding: 'utf8',
  });
};

const requirePythonResult = (result, t) => {
  if (result.error && result.error.code === 'ENOENT') {
    t.skip(`Python interpreter not found: ${PYTHON_BIN}`);
    return null;
  }
  if (result.status !== 0) {
    assert.fail(`Python exited with status ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result;
};

const parseJsonLine = (stdout) => {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = lines[lines.length - 1] || '';
  return JSON.parse(jsonLine);
};

test('exec_python defaults to safe mode in bridge dispatch', (t) => {
  const result = requirePythonResult(
    runBridgeSnippet(`
response = module._dispatch('exec_python', {'code': 'x = 1'})
print(json.dumps(response))
`),
    t,
  );
  if (!result) return;
  const parsed = parseJsonLine(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, 'safe');
});

test('safe exec_python blocks dangerous module imports', (t) => {
  const result = requirePythonResult(
    runBridgeSnippet(`
try:
    module._dispatch('exec_python', {'code': 'import os'})
except Exception as exc:
    print(json.dumps({'code': getattr(exc, 'code', ''), 'error': str(exc)}))
`),
    t,
  );
  if (!result) return;
  const parsed = parseJsonLine(result.stdout);
  assert.equal(parsed.code, 'SAF_004_BLOCKED_IMPORT');
  assert.match(parsed.error, /blocked module import/i);
});

test('safe exec_python blocks from-import syntax for blocked modules', (t) => {
  const result = requirePythonResult(
    runBridgeSnippet(`
try:
    module._dispatch('exec_python', {'code': 'from os import path'})
except Exception as exc:
    print(json.dumps({'code': getattr(exc, 'code', ''), 'error': str(exc)}))
`),
    t,
  );
  if (!result) return;
  const parsed = parseJsonLine(result.stdout);
  assert.equal(parsed.code, 'SAF_004_BLOCKED_IMPORT');
  assert.match(parsed.error, /blocked module import/i);
});

test('safe exec_python blocks dangerous builtins', (t) => {
  const result = requirePythonResult(
    runBridgeSnippet(`
try:
    module._dispatch('exec_python', {'code': 'open(\"x\")'})
except Exception as exc:
    print(json.dumps({'code': getattr(exc, 'code', ''), 'error': str(exc)}))
`),
    t,
  );
  if (!result) return;
  const parsed = parseJsonLine(result.stdout);
  assert.equal(parsed.code, 'SAF_004_BLOCKED_BUILTIN');
  assert.match(parsed.error, /blocked builtin/i);
});

test('safe exec_python blocks network-oriented stdlib imports', (t) => {
  const result = requirePythonResult(
    runBridgeSnippet(`
try:
    module._dispatch('exec_python', {'code': 'import socket\\nimport urllib.request'})
except Exception as exc:
    print(json.dumps({'code': getattr(exc, 'code', ''), 'error': str(exc)}))
`),
    t,
  );
  if (!result) return;
  const parsed = parseJsonLine(result.stdout);
  assert.equal(parsed.code, 'SAF_004_BLOCKED_IMPORT');
  assert.match(parsed.error, /blocked module import/i);
});

test('safe exec_python blocks explicit __import__ usage', (t) => {
  const result = requirePythonResult(
    runBridgeSnippet(`
try:
    module._dispatch('exec_python', {'code': '__import__("socket")'})
except Exception as exc:
    print(json.dumps({'code': getattr(exc, 'code', ''), 'error': str(exc)}))
`),
    t,
  );
  if (!result) return;
  const parsed = parseJsonLine(result.stdout);
  assert.equal(parsed.code, 'SAF_004_BLOCKED_BUILTIN');
  assert.match(parsed.error, /blocked builtin/i);
});

test('trusted exec_python mode allows unrestricted execution in bridge', (t) => {
  const result = requirePythonResult(
    runBridgeSnippet(`
response = module._dispatch('exec_python', {'code': 'import os\\nname = os.name', 'mode': 'trusted'})
print(json.dumps(response))
`),
    t,
  );
  if (!result) return;
  const parsed = parseJsonLine(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, 'trusted');
});

test('exec_python rejects invalid mode values in bridge dispatch', (t) => {
  const result = requirePythonResult(
    runBridgeSnippet(`
try:
    module._dispatch('exec_python', {'code': 'x = 1', 'mode': 'danger'})
except Exception as exc:
    print(json.dumps({'code': getattr(exc, 'code', ''), 'error': str(exc)}))
`),
    t,
  );
  if (!result) return;
  const parsed = parseJsonLine(result.stdout);
  assert.equal(parsed.code, 'RPC_EXEC_PYTHON_INVALID_MODE');
  assert.match(parsed.error, /must be "safe" or "trusted"/i);
});
