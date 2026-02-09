const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PRESET_STORE_PATH = path.resolve(__dirname, '../lib/presetStore.js');

const buildValidProtocol = () => ({
  version: '1.0',
  steps: [
    {
      id: 'step_1',
      type: 'PYTHON',
      description: 'Run helper script',
      payload: {
        code: "print('ok')",
        mode: 'safe',
      },
    },
  ],
  done: true,
  final_message: 'Completed.',
  meta: {
    requires_gate_verification: true,
  },
});

const withPresetStore = async (presetsFile, run) => {
  const originalEnv = process.env.AETHER_PRESETS_FILE;
  process.env.AETHER_PRESETS_FILE = presetsFile;
  delete require.cache[PRESET_STORE_PATH];
  try {
    const store = require(PRESET_STORE_PATH);
    return await run(store);
  } finally {
    if (originalEnv == null) {
      delete process.env.AETHER_PRESETS_FILE;
    } else {
      process.env.AETHER_PRESETS_FILE = originalEnv;
    }
    delete require.cache[PRESET_STORE_PATH];
  }
};

test('PST-001 validatePreset rejects invalid payloads with detailed reasons', async () => {
  await withPresetStore(path.join(os.tmpdir(), `aether-presets-${Date.now()}.json`), async (store) => {
    const result = store.validatePreset({
      schemaVersion: '9.9',
      id: 'bad id',
      name: '',
      createdAt: 'bad-date',
      updatedAt: 'bad-date',
      protocol: {},
    });

    assert.equal(result.ok, false);
    const codes = result.errors.map((error) => error.code);
    assert.ok(codes.includes('PRESET_ID_INVALID'));
    assert.ok(codes.includes('PRESET_NAME_REQUIRED'));
    assert.ok(codes.includes('PRESET_SCHEMA_VERSION_INVALID'));
    assert.ok(codes.includes('PRESET_CREATED_AT_INVALID'));
    assert.ok(codes.includes('PRESET_UPDATED_AT_INVALID'));
    assert.ok(codes.some((code) => String(code).startsWith('PROTOCOL_')));
  });
});

test('PST-002 parse/import/export preset bundle works for schema v1.0', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-preset-store-'));
  const storeFileA = path.join(tempDir, 'presets-a.json');
  const storeFileB = path.join(tempDir, 'presets-b.json');

  const preset = {
    schemaVersion: '1.0',
    id: 'preset_001',
    name: 'Starter Preset',
    description: 'Baseline workflow.',
    tags: ['starter', 'workflow'],
    createdAt: '2026-02-09T00:00:00.000Z',
    updatedAt: '2026-02-09T00:00:00.000Z',
    protocol: buildValidProtocol(),
  };

  let exportedBundle = null;
  await withPresetStore(storeFileA, async (store) => {
    const imported = await store.importPresetBundle({
      bundleVersion: '1.0',
      presets: [preset],
    });

    assert.equal(imported.importedCount, 1);
    const listed = await store.listPresets();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'preset_001');
    exportedBundle = await store.exportPresetBundle();
    assert.equal(exportedBundle.bundleVersion, '1.0');
    assert.equal(exportedBundle.presets.length, 1);
  });

  await withPresetStore(storeFileB, async (store) => {
    const imported = await store.importPresetBundle(exportedBundle);
    assert.equal(imported.importedCount, 1);
    const loaded = await store.getPreset('preset_001');
    assert.ok(loaded);
    assert.equal(loaded.name, 'Starter Preset');
  });
});

test('PST-003 migration imports legacy bundle/items without data loss', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-preset-migration-'));
  const storeFile = path.join(tempDir, 'presets.json');

  await withPresetStore(storeFile, async (store) => {
    const legacyBundle = {
      version: '0.9',
      items: [
        {
          presetId: 'legacy_one',
          title: 'Legacy Preset',
          notes: 'Migrated from old format',
          labels: ['legacy'],
          created_at: '2026-02-08T12:00:00.000Z',
          updated_at: '2026-02-08T12:00:00.000Z',
          protocolPayload: buildValidProtocol(),
        },
      ],
    };

    const imported = await store.importPresetBundle(legacyBundle);
    assert.equal(imported.importedCount, 1);
    assert.equal(imported.bundle.metadata.importedBundleVersion, '0.9');

    const migrated = await store.getPreset('legacy_one');
    assert.ok(migrated);
    assert.equal(migrated.schemaVersion, '1.0');
    assert.equal(migrated.name, 'Legacy Preset');
    assert.equal(migrated.description, 'Migrated from old format');
    assert.deepEqual(migrated.tags, ['legacy']);
    assert.deepEqual(migrated.protocol, buildValidProtocol());
  });
});
