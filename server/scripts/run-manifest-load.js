#!/usr/bin/env node
const path = require('node:path');
const runStore = require('../lib/runStore');
const { runLoad } = require('../lib/manifestStressRunners');

const parseArgs = (argv) => {
  const args = {
    manifest: 'e2e/manifests/tst-013-load-concurrent.json',
    totalRuns: 40,
    concurrency: 8,
    runDir: '',
    baseUrl: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (token === '--manifest' || token === '-m') {
      args.manifest = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--total-runs') {
      args.totalRuns = Number.parseInt(String(argv[i + 1] || ''), 10);
      i += 1;
      continue;
    }
    if (token === '--concurrency') {
      args.concurrency = Number.parseInt(String(argv[i + 1] || ''), 10);
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
  }

  return args;
};

const printUsage = () => {
  process.stdout.write(
    'Usage: node server/scripts/run-manifest-load.js [--manifest <path>] [--total-runs <n>] [--concurrency <n>] [--run-dir <path>] [--base-url <url>]\n',
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
    : path.join(repoRoot, 'generated_addons', 'runs', 'tst_013_load');

  await runStore.ensureInitialized();
  const settings = await runStore.getSettings();

  const summary = await runLoad({
    manifestPath: path.resolve(args.manifest),
    totalRuns: args.totalRuns,
    concurrency: args.concurrency,
    runDir,
    repoRoot,
    settings,
    baseUrl: args.baseUrl,
  });

  process.stdout.write('TST-013 Load Summary\n');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  process.stderr.write(`TST-013 load runner failed: ${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
