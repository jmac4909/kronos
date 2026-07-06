const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { downloadAndUnzipVSCode, runTests } = require('@vscode/test-electron');

const ROOT = path.resolve(__dirname, '..');
const KRONOS_DIR = path.join(ROOT, '.claude', 'kronos-feedback-state');
const WORKSPACE_DIR = path.join(KRONOS_DIR, 'sandbox-project');
const USER_DATA_DIR = path.join(ROOT, '.vscode-test', 'feedback-user-data');
const EXTENSIONS_DIR = path.join(ROOT, '.vscode-test', 'feedback-extensions');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout || ''}${result.stderr || ''}` : '';
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}${detail}`);
  }
  return result.stdout || '';
}

function ensureXvfbOnHeadlessLinux() {
  if (process.platform !== 'linux' || process.env.DISPLAY) { return; }
  if (process.env.KRONOS_SMOKE_UNDER_XVFB === '1') { return; }
  const xvfb = spawnSync('sh', ['-lc', 'command -v xvfb-run'], { encoding: 'utf8', stdio: 'pipe' });
  if (xvfb.status !== 0 || !xvfb.stdout.trim()) {
    throw new Error('No DISPLAY is set and xvfb-run is unavailable. Run this smoke in a graphical session or install xvfb.');
  }
  const rerun = spawnSync('xvfb-run', ['-a', process.execPath, __filename], {
    cwd: ROOT,
    env: { ...process.env, KRONOS_SMOKE_UNDER_XVFB: '1' },
    stdio: 'inherit',
  });
  process.exit(rerun.status === null ? 1 : rerun.status);
}

function readOsRelease() {
  try {
    return fs.readFileSync('/etc/os-release', 'utf8');
  } catch {
    return '';
  }
}

function linuxInstallHint(missingLibraries) {
  const osRelease = readOsRelease().toLowerCase();
  const needsGtk = missingLibraries.includes('libgtk-3.so.0');
  if (!needsGtk) {
    return 'Install the missing Linux shared libraries required by the VS Code Electron runtime.';
  }
  if (osRelease.includes('id=amzn') || osRelease.includes('id_like=fedora') || osRelease.includes('id_like="fedora')) {
    return 'Install GTK 3 before rerunning this smoke, for example: sudo dnf install gtk3';
  }
  if (osRelease.includes('id=ubuntu') || osRelease.includes('id=debian') || osRelease.includes('id_like=debian')) {
    return 'Install GTK 3 before rerunning this smoke, for example: sudo apt-get install libgtk-3-0';
  }
  return 'Install the GTK 3 runtime package for this Linux distribution before rerunning this smoke.';
}

function missingLinuxSharedLibraries(executablePath) {
  if (process.platform !== 'linux') { return []; }
  const result = spawnSync('ldd', [executablePath], { encoding: 'utf8', stdio: 'pipe' });
  if (result.error) {
    throw new Error(`Unable to check VS Code native dependencies with ldd: ${result.error.message}`);
  }
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const missing = [];
  for (const line of combined.split(/\r?\n/)) {
    const match = /^\s*(\S+)\s+=>\s+not found\s*$/.exec(line);
    if (match) { missing.push(match[1]); }
  }
  return Array.from(new Set(missing)).sort();
}

function assertNativeDependencies(executablePath) {
  const missingLibraries = missingLinuxSharedLibraries(executablePath);
  if (missingLibraries.length === 0) { return; }
  throw new Error([
    'VS Code extension-host smoke cannot start because native GUI libraries are missing.',
    `Executable: ${executablePath}`,
    `Missing: ${missingLibraries.join(', ')}`,
    linuxInstallHint(missingLibraries),
  ].join('\n'));
}

async function main() {
  ensureXvfbOnHeadlessLinux();
  console.log('Preparing Kronos feedback smoke state.');
  run(process.execPath, ['scripts/create-feedback-state.js', '--force']);
  console.log('Compiling Kronos extension.');
  run('npm', ['run', 'compile']);

  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  fs.rmSync(EXTENSIONS_DIR, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

  console.log('Resolving VS Code test binary.');
  const vscodeExecutablePath = await downloadAndUnzipVSCode({ extensionDevelopmentPath: ROOT });
  assertNativeDependencies(vscodeExecutablePath);

  console.log('Launching VS Code extension-host smoke.');
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: ROOT,
    extensionTestsPath: path.join(ROOT, 'test', 'feedback-smoke', 'index.js'),
    extensionTestsEnv: {
      KRONOS_DIR,
      KRONOS_FEEDBACK_SMOKE: '1',
    },
    launchArgs: [
      WORKSPACE_DIR,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--user-data-dir',
      USER_DATA_DIR,
      '--extensions-dir',
      EXTENSIONS_DIR,
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-gpu',
      '--no-sandbox',
    ],
  });
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
