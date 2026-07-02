const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const VSIX = path.join(ROOT, 'kronos-0.1.0.vsix');

function fail(message) {
  console.error(`\nFeedback readiness failed: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) {
    fail(`${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (options.capture) {
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
    }
    fail(`${label} exited with ${result.status}`);
  }
  return result.stdout || '';
}

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function requireFile(file, includes = []) {
  const absolute = path.join(ROOT, file);
  if (!fs.existsSync(absolute)) {
    fail(`${file} is missing`);
  }
  const text = fs.readFileSync(absolute, 'utf8');
  for (const marker of includes) {
    if (!text.includes(marker)) {
      fail(`${file} is missing marker: ${marker}`);
    }
  }
  return text;
}

function assertTreeIncludes(tree, marker) {
  if (!tree.includes(marker)) {
    fail(`VSIX file list is missing ${marker}`);
  }
}

function assertTreeExcludes(tree, marker) {
  if (tree.includes(marker)) {
    fail(`VSIX file list unexpectedly includes ${marker}`);
  }
}

console.log('Preparing Kronos human-feedback build.');

const manifest = JSON.parse(requireFile('package.json'));
const commandCount = manifest.contributes?.commands?.length || 0;
if (commandCount < 80) {
  fail(`expected the contributed command surface to be populated, found ${commandCount}`);
}

requireFile('README.md', [
  'Current Readiness',
  'Main Surfaces To Review',
  'HUMAN_FEEDBACK_CHECKLIST.md',
]);
requireFile('HUMAN_FEEDBACK_CHECKLIST.md', [
  'Smoke Flow',
  'Feedback Questions',
  'Stop Conditions',
  'Signoff Bar',
]);
requireFile('LICENSE', ['All rights reserved']);
requireFile('.vscode/launch.json', ['Run Kronos Extension']);

run('npm', ['test']);
run('npm', ['run', 'package']);

if (!fs.existsSync(VSIX)) {
  fail('kronos-0.1.0.vsix was not created');
}
const stat = fs.statSync(VSIX);
if (stat.size < 200 * 1024) {
  fail(`kronos-0.1.0.vsix is unexpectedly small (${stat.size} bytes)`);
}

const tree = run('npx', ['@vscode/vsce', 'ls', '--tree', '--no-dependencies'], { capture: true });
for (const marker of [
  'HUMAN_FEEDBACK_CHECKLIST.md',
  'LICENSE',
  'package.json',
  'README.md',
  'media/',
  'out/',
  'extension.js',
  'services/',
]) {
  assertTreeIncludes(tree, marker);
}
for (const marker of [
  'src/',
  'scripts/',
  'node_modules/',
  '.git/',
  '.claude/',
  'GOOD_TO_GREAT_REVIEW.md',
  'push-master.sh',
  'cache-github-token.sh',
]) {
  assertTreeExcludes(tree, marker);
}

const codePath = commandExists('code');
const codiumPath = commandExists('codium');

console.log('\nHuman feedback readiness: PASS');
console.log(`- Commands contributed: ${commandCount}`);
console.log(`- VSIX: ${VSIX} (${Math.round(stat.size / 1024)} KB)`);
console.log(`- README/checklist/license/dev-host config: present`);
if (codePath || codiumPath) {
  console.log(`- VS Code CLI available: ${codePath || codiumPath}`);
} else {
  console.log('- VS Code CLI not found on this host; install/test the VSIX on a machine with VS Code.');
}
console.log('- Remaining manual gate: run the VS Code smoke flow in HUMAN_FEEDBACK_CHECKLIST.md and capture human feedback.');
