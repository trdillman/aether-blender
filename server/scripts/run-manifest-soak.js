#!/usr/bin/env node
const path = require('node:path');
const runStore = require('../lib/runStore');
const { runSoak } = require('../lib/manifestStressRunners');

const parseArgs = (argv) => {
  const args = {
    manifest: 'e2e/manifests/tst-012-soak-50-prompts.json',
    iterations: 50,
    runDir: '',
    baseUrl: '',
    stopOnFailure: false,
    endpointSnapshotInterval: 10,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (token === '--manifest' || token === '-m') {
      args.manifest = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--iterations') {
      args.iterations = Number.parseInt(String(argv[i + 1] || ''), 10);
      i += 1;
      continue;
    }
    if (token === '--run-dir') {
      args.runDir = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--base-url') {
      args.baseUrl = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--endpoint-snapshot-interval') {
      args.endpointSnapshotInterval = Number.parseInt(String(argv[i + 1] || ''), 10);
      i += 1;
      continue;
    }
    if (token === '--stop-on-failure') {
      args.stopOnFailure = true;
    }
  }

  return args;
};

const printUsage = () => {
  process.stdout.write(
    'Usage: node server/scripts/run-manifest-soak.js [--manifest <path>] [--iterations <n>] [--run-dir <path>] [--base-url <url>] [--endpoint-snapshot-interval <n>] [--stop-on-failure]\n',
  );
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
    : path.join(repoRoot, 'generated_addons', 'runs', 'tst_012_soak');

  await runStore.ensureInitialized();
  const settings = await runStore.getSettings();

  const summary = await runSoak({
    manifestPath: path.resolve(args.manifest),
    iterations: args.iterations,
    runDir,
    repoRoot,
    settings,
    stopOnFailure: args.stopOnFailure,
    baseUrl: args.baseUrl,
    endpointSnapshotInterval: args.endpointSnapshotInterval,
  });

  process.stdout.write('TST-012 Soak Summary\n');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  process.stderr.write(`TST-012 soak runner failed: ${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
