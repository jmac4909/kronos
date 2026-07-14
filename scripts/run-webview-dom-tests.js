const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const actionPanelSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'kronos-action-panel.js'), 'utf8');

function createHarness() {
  const messages = [];
  const attributes = new Map();
  const listeners = new Map();
  const scriptAttributes = new Map([
    ['data-kronos-webview-name', 'Kronos Ticket Workspace'],
    ['data-kronos-ready-command', '__kronosWebviewReady'],
    ['data-kronos-action-fields', JSON.stringify([
      { messageKey: 'ticket', dataAttribute: 'data-ticket' },
    ])],
  ]);
  const document = {
    currentScript: { getAttribute: name => scriptAttributes.get(name) || null },
    documentElement: { setAttribute: (name, value) => attributes.set(name, value) },
    readyState: 'complete',
    addEventListener(name, listener) {
      const values = listeners.get(name) || [];
      values.push(listener);
      listeners.set(name, values);
    },
    getElementById() { return null; },
    querySelector() { return null; },
  };
  const runtime = {
    createReadyPoster({ readyCommand, webviewName }) {
      return () => messages.push({ command: readyCommand, webviewName });
    },
    markReady(name) { attributes.set('ready-name', name); },
    installDiagnostics(name) { attributes.set('diagnostics-name', name); },
    vscodeApi() { return { postMessage: message => messages.push(JSON.parse(JSON.stringify(message))) }; },
  };
  const context = vm.createContext({
    document,
    KronosWebviewRuntime: runtime,
    console: { info() {}, warn() {}, error() {} },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  });
  context.globalThis = context;
  context.window = context;
  return { context, document, attributes, listeners, messages };
}

test('ticket workspace action panel posts one normalized, ticket-scoped message', () => {
  const harness = createHarness();
  vm.runInContext(actionPanelSource, harness.context, { filename: 'kronos-action-panel.js' });

  assert.equal(harness.attributes.get('data-kronos-action-handler-attached'), 'true');
  assert.equal(harness.attributes.get('data-kronos-actions-ready'), 'true');
  assert.equal(harness.listeners.get('click').length, 1);

  const buttonAttributes = new Map([
    ['data-action', 'insertJiraContext'],
    ['data-ticket', 'JIRA-123'],
  ]);
  const button = { getAttribute: name => buttonAttributes.get(name) || null };
  let prevented = false;
  harness.listeners.get('click')[0]({
    target: { closest: selector => selector === '[data-action]' ? button : null },
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.deepEqual(harness.messages.at(-1), { command: 'insertJiraContext', ticket: 'JIRA-123' });
});

test('loading the action panel twice does not attach a duplicate click handler', () => {
  const harness = createHarness();
  vm.runInContext(actionPanelSource, harness.context, { filename: 'kronos-action-panel.js' });
  vm.runInContext(actionPanelSource, harness.context, { filename: 'kronos-action-panel.js' });
  assert.equal(harness.listeners.get('click').length, 1);
});
