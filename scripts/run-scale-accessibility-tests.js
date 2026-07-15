const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { performance } = require('node:perf_hooks');

const { buildJiraWorkBoardHtml } = require('../out/services/jiraWorkBoardView.js');
const {
  collectWorkTicketFilterOptions,
  workTicketMatchesFilter,
} = require('../out/services/workTicketFilters.js');
const { buildWorkSessionAuditMarkdown } = require('../out/services/workSessionAuditView.js');
const { JiraRestClient, JiraRestCancelledError } = require('../out/services/jiraRestClient.js');

const root = path.resolve(__dirname, '..');

test('500-ticket board stays inside the checked render and output budget', () => {
  const state = scaleWorkCatalog(500);
  const started = performance.now();
  const html = buildJiraWorkBoardHtml({
    state,
    nonce: 'scale-fixture-nonce',
    scriptUri: 'vscode-resource://kronos/media/kronos-jira-work-board.js',
  });
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 2_000, `500-ticket board took ${elapsedMs.toFixed(1)} ms`);
  assert.ok(Buffer.byteLength(html, 'utf8') < 8 * 1024 * 1024, 'board HTML exceeded 8 MiB');
  assert.equal((html.match(/data-ticket-card/g) || []).length, 500);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /tabindex="0" aria-label="Open SCALE-1:/);
  assert.match(html, /@media \(max-width: 580px\)/);
});

test('500-ticket filtering and facet collection stay inside the checked CPU budget', () => {
  const tickets = scaleWorkCatalog(500).tickets;
  const started = performance.now();
  const options = collectWorkTicketFilterOptions(tickets);
  const matched = Object.entries(tickets).filter(([key, ticket]) => workTicketMatchesFilter(key, ticket, {
    query: 'bounded fixture',
    jiraProject: 'TEAM-3',
    completion: 'all',
  }));
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 1_000, `500-ticket filter pass took ${elapsedMs.toFixed(1)} ms`);
  assert.equal(options.jiraProjects.length, 8);
  assert.ok(options.labels.length <= 12);
  assert.ok(matched.length > 0 && matched.length < 500);
});

test('2000 supplied audit events render only the newest 500 inside the checked budget', () => {
  const session = scaleSession();
  const events = Array.from({ length: 2_000 }, (_, index) => ({
    schemaVersion: 1,
    id: `event-${index}`,
    at: new Date(Date.UTC(2026, 6, 14, 12, 0, index % 60)).toISOString(),
    sessionId: session.id,
    type: 'provider.transition',
    source: 'gitlab',
    summary: `Bounded transition ${index} ${'detail '.repeat(20)}`,
    subject: { kind: 'merge-request', id: String(index % 25), ticketKey: 'SCALE-1' },
    before: { state: 'running' },
    after: { state: 'success' },
  }));
  const started = performance.now();
  const markdown = buildWorkSessionAuditMarkdown(session, events);
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 1_000, `audit summary took ${elapsedMs.toFixed(1)} ms`);
  assert.ok(Buffer.byteLength(markdown, 'utf8') < 2 * 1024 * 1024, 'audit Markdown exceeded 2 MiB');
  assert.equal((markdown.match(/^\- \*\*/gm) || []).length, 500);
  assert.match(markdown, /Showing the newest 500 of 2000 supplied events/);
});

test('shared webview accessibility CSS and form labels cover focus, forced colors, and narrow panels', () => {
  const baseCss = fs.readFileSync(path.join(root, 'src', 'services', 'webviewHtml.ts'), 'utf8');
  const projectIntegration = fs.readFileSync(path.join(root, 'src', 'services', 'projectIntegrationView.ts'), 'utf8');
  const board = fs.readFileSync(path.join(root, 'src', 'services', 'jiraWorkBoardView.ts'), 'utf8');
  assert.match(baseCss, /:focus-visible/);
  assert.match(baseCss, /@media \(forced-colors: active\)/);
  assert.match(baseCss, /@media \(max-width: 760px\)/);
  assert.match(projectIntegration, /<label>\$\{escapeHtml\(label\)\}[^]*<input[^]*<\/label>/);
  assert.match(projectIntegration, /input\.projects\.slice\(0, 200\)/);
  assert.match(board, /role="\$\{isError \? 'alert' : 'status'\}"/);
  assert.match(board, /aria-label="Open \$\{escapeAttr\(ticket\.key\)\}/);
});

test('an aborted Jira read rejects before transport and is not reported as a provider failure', async () => {
  let transportCalls = 0;
  const client = new JiraRestClient({
    env: {
      JIRA_BASE_URL: 'https://jira.example.test',
      JIRA_EMAIL: 'fixture@example.test',
      JIRA_API_TOKEN: 'fixture-token-not-a-secret',
    },
    transport: async () => {
      transportCalls += 1;
      throw new Error('transport must not run');
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.searchWorkList({ signal: controller.signal }), JiraRestCancelledError);
  assert.equal(transportCalls, 0);
});

function scaleWorkCatalog(count) {
  const tickets = {};
  for (let index = 1; index <= count; index += 1) {
    const completed = index % 7 === 0;
    tickets[`SCALE-${index}`] = {
      summary: `Bounded fixture ${index} ${'long summary '.repeat(24)}`,
      type: index % 9 === 0 ? 'Bug' : 'Story',
      priority: ['Low', 'Medium', 'High'][index % 3],
      jira_status: completed ? 'Done' : ['Open', 'In Progress', 'Review'][index % 3],
      jira_status_category: completed ? 'done' : 'indeterminate',
      jira_project_key: `TEAM-${index % 8}`,
      source: 'jira',
      labels: Array.from({ length: 12 }, (_, label) => `label-${label}`),
      linked_local_project: `Project ${index % 20}`,
      mr: null,
      build: null,
    };
  }
  return {
    schemaVersion: 2,
    refreshedAt: '2026-07-14T12:00:00.000Z',
    projects: {},
    tickets,
  };
}

function scaleSession() {
  return {
    schemaVersion: 1,
    id: 'session-scale-1',
    kind: 'ticket',
    ticketKey: 'SCALE-1',
    ticketKeys: ['SCALE-1'],
    title: 'Scale fixture session',
    status: 'active',
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: '2026-07-14T12:00:00.000Z',
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: true },
  };
}
