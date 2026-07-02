const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const source = fs.readFileSync('src/extension.ts', 'utf8');

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

if (source.includes('kronos.computeQueue')) {
  console.error('Stale kronos.computeQueue reference found');
  process.exit(1);
}

console.log(`Command manifest OK (${contributed.length} commands).`);
