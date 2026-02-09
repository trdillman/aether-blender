#!/usr/bin/env node
const path = require('node:path');
const runStore = require('../lib/runStore');
const { runChaos } = require('../lib/manifestStressRunners');

const parseArgs = (argv) => {
  const args = {
    manifest: 'e2e/manifests/tst-014-chaos-provider-network.json',
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
    'Usage: node server/scripts/run-manifest-chaos.js [--manifest <path>] [--run-dir <path>] [--base-url <url>]\n',
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
    : path.join(repoRoot, 'generated_addons', 'runs', 'tst_014_chaos');

  await runStore.ensureInitialized();
  const settings = await runStore.getSettings();

  const summary = await runChaos({
    manifestPath: path.resolve(args.manifest),
    runDir,
    repoRoot,
    settings,
    baseUrl: args.baseUrl,
  });

  process.stdout.write('TST-014 Chaos Summary\n');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  process.stderr.write(`TST-014 chaos runner failed: ${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
