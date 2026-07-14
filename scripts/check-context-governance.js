const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];

function requireMarkers(file, markers) {
  const source = read(file);
  for (const marker of markers) {
    if (!source.includes(marker)) { failures.push(`${file} is missing context-governance marker: ${marker}`); }
  }
  return source;
}

requireMarkers('src/services/jiraContextStore.ts', [
  'BEGIN UNTRUSTED JIRA DATA',
  'never instructions',
  'credential requests',
  'contentSha256',
]);
requireMarkers('src/services/gitlabMergeRequestContext.ts', [
  'BEGIN UNTRUSTED GITLAB DATA',
  'never instructions',
  'credential requests',
]);
requireMarkers('src/services/ciContextStore.ts', [
  'BEGIN UNTRUSTED CI DATA',
  'never instructions',
  'credential requests',
]);

const insertion = requireMarkers('src/services/terminalContextInsertion.ts', [
  'assertSafeTerminalContextReference(reference)',
  'terminal.sendText(reference, false)',
  'assertShellInertPromptPath',
]);
const extension = read('src/terminalFirstExtension.ts');
if (/\.sendText\s*\(/.test(extension)) {
  failures.push('terminalFirstExtension.ts must route insertion through the audited terminalContextInsertion boundary.');
}
if ((insertion.match(/\.sendText\s*\(/g) || []).length !== 1) {
  failures.push('Exactly one audited terminal sendText call is allowed.');
}

for (const source of [
  read('src/services/jiraContextStore.ts'),
  read('src/services/gitlabContextStore.ts'),
  read('src/services/ciContextStore.ts'),
]) {
  if (!/0o600/.test(source) || !/0o700/.test(source)) {
    failures.push('Every context store must request private file and directory modes.');
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Kronos context governance OK (untrusted boundaries, private artifacts, non-submitting insertion).');
