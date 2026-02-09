const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SETTINGS_SERVICE_PATH = path.resolve(__dirname, '../lib/settingsService.js');

const withMockedSpawn = async (spawnImpl, run) => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = spawnImpl;
  delete require.cache[SETTINGS_SERVICE_PATH];

  try {
    const settingsService = require(SETTINGS_SERVICE_PATH);
    return await run(settingsService);
  } finally {
    childProcess.spawn = originalSpawn;
    delete require.cache[SETTINGS_SERVICE_PATH];
  }
};

const createSpawnResult = ({ code = 0, stdout = '', stderr = '' }) => {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      child.emit('close', code);
    };

    process.nextTick(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
    });

    return child;
  };
};

test('normalizeIncomingSettings resolves paths and canonicalizes enums', async () => {
  const { normalizeIncomingSettings } = require('../lib/settingsService');
  const normalized = normalizeIncomingSettings(
    {
      apiKeySourceMode: 'unknown',
      runMode: 'not-gui',
      timeoutMs: '4500',
      logVerbosity: 'not-valid',
      allowTrustedPythonExecution: 'yes',
      workspacePath: '.',
      addonOutputPath: '.',
    },
    {},
  );

  assert.equal(normalized.apiKeySourceMode, 'env');
  assert.equal(normalized.runMode, 'headless');
  assert.equal(normalized.timeoutMs, 4500);
  assert.equal(normalized.logVerbosity, 'normal');
  assert.equal(normalized.allowTrustedPythonExecution, false);
  assert.equal(normalized.workspacePath, path.resolve('.'));
  assert.equal(normalized.addonOutputPath, path.resolve('.'));
});

test('validateSettings returns path and timeout validation errors', async () => {
  const { validateSettings } = require('../lib/settingsService');
  const result = await validateSettings({
    workspacePath: path.join(os.tmpdir(), `missing-workspace-${Date.now()}`),
    addonOutputPath: path.join(os.tmpdir(), `missing-addon-${Date.now()}`),
    timeoutMs: 500,
    blenderPath: '',
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /Workspace path does not exist/);
  assert.match(result.errors.join('\n'), /Add-on output path does not exist/);
  assert.match(result.errors.join('\n'), /Timeout must be at least 1000ms/);
  assert.match(result.errors.join('\n'), /Blender executable path is required/);
});

test('validateSettings requires server-managed API key when that mode is selected', async () => {
  const { validateSettings } = require('../lib/settingsService');
  const result = await validateSettings({
    workspacePath: path.resolve('.'),
    addonOutputPath: path.resolve('.'),
    timeoutMs: 3000,
    blenderPath: '',
    apiKeySourceMode: 'server-managed',
    serverApiKey: '',
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /Server-managed API key is required/);
});

test('validateSettings succeeds when paths exist and blender version check passes', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-settings-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const addonOutputPath = path.join(tempRoot, 'addons');
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(addonOutputPath, { recursive: true });

  await withMockedSpawn(
    createSpawnResult({ code: 0, stdout: 'Blender 4.0.2\n' }),
    async ({ validateSettings }) => {
      const result = await validateSettings({
        workspacePath,
        addonOutputPath,
        timeoutMs: 4000,
        blenderPath: 'blender',
        llmProvider: 'anthropic',
        llmModel: 'GLM-4.7',
      });

      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
      assert.match(result.blenderInfo, /Blender 4.0.2/);
    },
  );
});

test('validateSettings surfaces blender check failure from backend process check', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-settings-fail-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const addonOutputPath = path.join(tempRoot, 'addons');
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(addonOutputPath, { recursive: true });

  await withMockedSpawn(
    createSpawnResult({ code: 2, stderr: 'not executable' }),
    async ({ validateSettings }) => {
      const result = await validateSettings({
        workspacePath,
        addonOutputPath,
        timeoutMs: 6000,
        blenderPath: 'bad-blender',
        llmProvider: 'anthropic',
        llmModel: 'GLM-4.7',
      });

      assert.equal(result.valid, false);
      assert.match(result.errors.join('\n'), /Blender executable check failed/);
      assert.match(result.errors.join('\n'), /not executable/);
    },
  );
});
