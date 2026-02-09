#!/usr/bin/env node
const path = require('path');
const { loadManifest, runManifest } = require('../lib/manifestE2ERunner');
const runStore = require('../lib/runStore');

const parseArgs = (argv) => {
  const args = {
    manifest: '',
    runDir: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (token === '--manifest' || token === '-m') {
      args.manifest = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--run-dir') {
      args.runDir = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
  }

  return args;
};

const printUsage = () => {
  process.stdout.write('Usage: node server/scripts/run-manifest-e2e.js --manifest <path> [--run-dir <path>]\n');
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const repoRoot = path.resolve(__dirname, '..', '..');
  const runDir = args.runDir
    ? path.resolve(args.runDir)
    : path.join(repoRoot, 'generated_addons', 'runs', 'manifest_e2e');

  await runStore.ensureInitialized();
  const settings = await runStore.getSettings();

  const { manifest, path: manifestPath } = await loadManifest(args.manifest);
  const result = await runManifest({
    manifest,
    repoRoot,
    runDir,
    settings,
  });

  process.stdout.write(`Manifest E2E PASS: ${result.manifestId}\n`);
  process.stdout.write(`Manifest path: ${manifestPath}\n`);
  process.stdout.write(`Run id: ${result.runId}\n`);
  process.stdout.write(`Steps: ${result.stepCount}, Events: ${result.eventCount}, Artifacts: ${result.artifactCount}\n`);
};

main().catch((error) => {
  process.stderr.write(`Manifest E2E FAIL: ${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
