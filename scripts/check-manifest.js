const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const source = fs.readFileSync('src/extension.ts', 'utf8');

const allowedCodicons = new Set([
  'add',
  'archive',
  'arrow-down',
  'arrow-up',
  'beaker',
  'check',
  'check-all',
  'checklist',
  'clear-all',
  'clockface',
  'close',
  'cloud',
  'cloud-upload',
  'comment-discussion',
  'compass',
  'dashboard',
  'debug-continue',
  'debug-pause',
  'debug-rerun',
  'debug-reverse-continue',
  'debug-stop',
  'diff',
  'export',
  'eye',
  'filter',
  'gear',
  'go-to-file',
  'graph',
  'graph-line',
  'history',
  'inbox',
  'json',
  'layout',
  'link',
  'link-external',
  'list-selection',
  'list-tree',
  'list-unordered',
  'merge',
  'milestone',
  'notebook',
  'open-preview',
  'pin',
  'play',
  'play-circle',
  'project',
  'pulse',
  'refresh',
  'run-all',
  'save',
  'search',
  'server-environment',
  'server-process',
  'settings-gear',
  'shield',
  'symbol-keyword',
  'terminal',
  'tools',
  'trash',
  'verified',
  'warning',
  'watch',
]);

const contributed = (manifest.contributes.commands || [])
  .map((command) => command.command)
  .sort();

const registered = [...source.matchAll(/registerCommand\(['"]([^'"]+)['"]/g)]
  .map((match) => match[1])
  .sort();

const missing = contributed.filter((command) => !registered.includes(command));
const extra = registered.filter((command) => !contributed.includes(command));

if (missing.length || extra.length) {
  console.error('Command manifest mismatch');
  if (missing.length) {
    console.error(`Missing registrations:\n${missing.join('\n')}`);
  }
  if (extra.length) {
    console.error(`Registered but not contributed:\n${extra.join('\n')}`);
  }
  process.exit(1);
}

const iconProblems = [];
for (const command of manifest.contributes.commands || []) {
  if (!command.icon) {
    iconProblems.push(`${command.command}: missing icon`);
    continue;
  }
  const match = String(command.icon).match(/^\$\(([a-z0-9-]+)\)$/);
  if (!match) {
    iconProblems.push(`${command.command}: icon must use $(codicon-name) syntax`);
    continue;
  }
  if (!allowedCodicons.has(match[1])) {
    iconProblems.push(`${command.command}: unknown codicon ${match[1]}`);
  }
}
if (iconProblems.length > 0) {
  console.error(`Command icon validation failed:\n${iconProblems.join('\n')}`);
  process.exit(1);
}

if (source.includes('kronos.computeQueue')) {
  console.error('Stale kronos.computeQueue reference found');
  process.exit(1);
}

console.log(`Command manifest OK (${contributed.length} commands).`);
