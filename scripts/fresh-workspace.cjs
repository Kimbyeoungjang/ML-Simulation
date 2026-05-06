#!/usr/bin/env node
/*
 * Rebuild a clean local TileForge workspace.
 * Uses only Node built-ins so it can run even when node_modules is absent.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const skipInstall = args.has('--no-install');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const targets = [
  'node_modules', '.next', '.tileforge', 'coverage', 'playwright-report',
  'test-results', 'dist', 'out', 'COMPUTE_REPORT.csv', 'BANDWIDTH_REPORT.csv',
  'DETAILED_ACCESS_REPORT.csv', 'model.vmfb', 'tsconfig.tsbuildinfo'
];

function removeTarget(name) {
  const full = path.join(root, name);
  if (!fs.existsSync(full)) return;
  console.log(`[fresh] remove ${name}`);
  fs.rmSync(full, { recursive: true, force: true });
}

function run(command, argv, opts = {}) {
  console.log(`[fresh] ${command} ${argv.join(' ')}`);
  const result = cp.spawnSync(command, argv, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' }
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    if (opts.allowFail) return false;
    console.error(`[fresh] command failed with exit code ${result.status ?? 1}: ${command} ${argv.join(' ')}`);
    process.exit(result.status ?? 1);
  }
  return true;
}

for (const target of targets) removeTarget(target);

if (!skipInstall) {
  const installOk = run(npmCmd, ['install', '--no-audit', '--no-fund'], { allowFail: true });
  if (!installOk) {
    console.warn('[fresh] npm install failed. Retrying without optional dependencies; better-sqlite3/onnx-proto can be installed later if needed.');
    run(npmCmd, ['install', '--no-audit', '--no-fund', '--omit=optional']);
  }
  run(npmCmd, ['run', 'setup:env']);
  console.log('[fresh] clean workspace is ready. Start with: npm run dev');
} else {
  console.log('[fresh] clean workspace files removed. Install later with: npm install && npm run setup:env');
}
