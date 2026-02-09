const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const EXECUTOR_PATH = path.resolve(__dirname, '../lib/protocolExecutor.js');

const withMockedProtocolExecutor = async (mocks, run) => {
  const originalLoad = Module._load;
  delete require.cache[EXECUTOR_PATH];

  Module._load = function patchedLoader(request, parent, isMain) {
    if (parent && parent.filename === EXECUTOR_PATH && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const mod = require(EXECUTOR_PATH);
    return await run(mod);
  } finally {
    Module._load = originalLoad;
    delete require.cache[EXECUTOR_PATH];
  }
};

const createBaseArgs = (runDir) => ({
  run: { id: 'run_1' },
  runDir,
  repoRoot: runDir,
  settings: {},
  startStep: async () => {},
  completeStep: async () => {},
  failStep: () => {},
  appendEvent: async () => {},
  addArtifact: async () => {},
  executeWithCancellation: async (_run, promise) => promise,
  registerCancelHandler: () => () => {},
});

test('executeProtocolPlan blocks traversal-like step ids before artifact writes', async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-protocol-'));
  let executorRunCalled = false;

  await withMockedProtocolExecutor(
    {
      './executors/registry': {
        getExecutorForStep: () => ({
          run: async () => {
            executorRunCalled = true;
          },
        }),
      },
    },
    async ({ executeProtocolPlan }) => {
      await assert.rejects(
        executeProtocolPlan({
          ...createBaseArgs(runDir),
          protocol: {
            steps: [
              {
                id: '../escape',
                type: 'PYTHON',
                description: 'bad',
                payload: { code: "print('x')" },
              },
            ],
          },
        }),
        (error) => error && error.code === 'SAF_003_INVALID_STEP_ID',
      );
    },
  );

  assert.equal(executorRunCalled, false);
});

test('executeProtocolPlan blocks symlink artifact directory segments', async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-protocol-'));
  const protocolDir = path.join(runDir, 'protocol_steps');
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-outside-'));
  const symlinkPath = path.join(protocolDir, 'evil_step');
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

  await fs.mkdir(protocolDir, { recursive: true });
  await fs.symlink(outsideDir, symlinkPath, symlinkType);

  await withMockedProtocolExecutor(
    {
      './executors/registry': {
        getExecutorForStep: () => ({
          run: async () => {},
        }),
      },
    },
    async ({ executeProtocolPlan }) => {
      await assert.rejects(
        executeProtocolPlan({
          ...createBaseArgs(runDir),
          protocol: {
            steps: [
              {
                id: 'evil_step',
                type: 'PYTHON',
                description: 'bad symlink',
                payload: { code: "print('x')" },
              },
            ],
          },
        }),
        (error) => error && error.code === 'SAF_003_SYMLINK_BLOCKED',
      );
    },
  );
});
