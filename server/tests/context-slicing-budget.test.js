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

const parseJsonLines = (stdout) =>
  String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test('context slicing truncation is deterministic for the same payload and budget', (t) => {
  const result = requirePythonResult(
    runBridgeSnippet(`
source = {
    "runtime": {
        "pid": 1234,
        "cwd": "/tmp/project",
        "pythonVersion": "3.11.0",
        "blenderVersion": "4.0.0",
        "blendFilePath": "/tmp/example.blend",
        "isBackground": True,
    },
    "scene": {"objects": [{"name": "Cube", "type": "MESH"} for _ in range(200)]},
    "active_node_tree_ir": {"nodes": [{"id": f"node_{i}", "label": "Noise Texture"} for i in range(300)]},
}
first_payload, first_meta = module._slice_context_payload(source, 512)
second_payload, second_meta = module._slice_context_payload(source, 512)
print(json.dumps({"firstPayload": first_payload, "firstMeta": first_meta}, sort_keys=True))
print(json.dumps({"secondPayload": second_payload, "secondMeta": second_meta}, sort_keys=True))
`),
    t,
  );
  if (!result) return;

  const [first, second] = parseJsonLines(result.stdout);
  assert.deepEqual(second.secondPayload, first.firstPayload);
  assert.deepEqual(second.secondMeta, first.firstMeta);
  assert.equal(first.firstMeta.truncated, true);
});

test('context slicing keeps payload valid and within byte budget', (t) => {
  const budget = 420;
  const result = requirePythonResult(
    runBridgeSnippet(`
source = {
    "runtime": {
        "pid": 2222,
        "cwd": "/very/long/path/" + ("x" * 500),
        "pythonVersion": "3.11.0",
        "blenderVersion": "4.0.0",
        "blendFilePath": "/tmp/example.blend",
        "isBackground": True,
    },
    "modifier_stack": [{"name": f"mod_{i}", "type": "NODES"} for i in range(120)],
    "active_object": {"name": "BigObject", "modifiers": [f"m_{i}" for i in range(120)]},
}
payload, meta = module._slice_context_payload(source, ${budget})
encoded = module._stable_json(payload)
print(json.dumps({
    "payload": payload,
    "meta": meta,
    "byteCount": len(encoded.encode("utf-8")),
    "isValidJson": isinstance(json.loads(encoded), dict),
}, sort_keys=True))
`),
    t,
  );
  if (!result) return;

  const [parsed] = parseJsonLines(result.stdout);
  assert.equal(parsed.isValidJson, true);
  assert.equal(parsed.meta.payloadBytes, parsed.byteCount);
  assert.ok(parsed.byteCount <= budget);
  assert.equal(parsed.meta.truncated, true);
  assert.ok(Array.isArray(parsed.meta.droppedSlices));
});

test('get_context applies slice budget and reports deterministic slicing metadata', (t) => {
  const result = requirePythonResult(
    runBridgeSnippet(`
payload = {
    "slices": ["runtime", "scene", "active_node_tree_ir"],
    "max_bytes": 256,
    "scene": {"objects": [{"name": "Cube"} for _ in range(100)]},
    "active_node_tree_ir": {"nodes": [{"id": f"node_{i}"} for i in range(200)]},
}
first = module._dispatch("get_context", payload)
second = module._dispatch("get_context", payload)
print(json.dumps(first, sort_keys=True))
print(json.dumps(second, sort_keys=True))
`),
    t,
  );
  if (!result) return;

  const [first, second] = parseJsonLines(result.stdout);
  assert.ok(first.slicing);
  assert.ok(first.slices);
  assert.equal(first.slicing.payloadBytes <= first.slicing.budgetBytes, true);
  assert.deepEqual(second.slices, first.slices);
  assert.equal(second.slicing.slicedHash, first.slicing.slicedHash);
  assert.deepEqual(first.slicing.requestedSlices, ['runtime', 'scene', 'active_node_tree_ir']);
});
