const assert = require('node:assert/strict');
const test = require('node:test');

const { buildLocalEvidenceSearchIndex } = require('../out/services/localEvidenceSearch.js');

test('local evidence search covers sessions, tickets, projects, branches, providers, artifacts, and events without terminal content', () => {
  const index = buildLocalEvidenceSearchIndex({
    projects: [project('Application', 'feature/SEARCH-1')],
    sessions: [session({
      title: 'Fix account synchronization',
      ticketKeys: ['SEARCH-1'],
      providerBindings: [providerBinding()],
      artifacts: [artifact()],
      terminals: [{ name: 'TERMINAL-CONTENT-MUST-NOT-INDEX', transcript: 'SECRET-SCROLLBACK' }],
    })],
    events: [event()],
  });
  assert.deepEqual(new Set(index.map(entry => entry.kind)), new Set([
    'project', 'session', 'ticket', 'provider', 'artifact', 'event',
  ]));
  const searchable = index.map(entry => `${entry.label} ${entry.description} ${entry.detail}`).join('\n');
  for (const expected of [
    'Application',
    'feature/SEARCH-1',
    'Fix account synchronization',
    'SEARCH-1',
    'GitLab merge-request: 77',
    '[MR-77] review evidence',
    'Merge request now needs review',
  ]) {
    assert.match(searchable, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(searchable, /TERMINAL-CONTENT-MUST-NOT-INDEX|SECRET-SCROLLBACK/);
});

test('local evidence search enforces independent source budgets and a 2000-entry total ceiling', () => {
  const sessions = Array.from({ length: 200 }, (_, index) => session({
    id: `session-${index}`,
    title: `Session ${index}`,
    ticketKeys: [`SEARCH-${index + 1}`, `SEARCH-${index + 201}`],
    providerBindings: [providerBinding(`provider-${index}-a`), providerBinding(`provider-${index}-b`)],
    artifacts: [artifact(`artifact-${index}-a`), artifact(`artifact-${index}-b`)],
  }));
  const index = buildLocalEvidenceSearchIndex({
    projects: Array.from({ length: 250 }, (_, index) => project(`Project ${index}`, `branch-${index}`)),
    sessions,
    events: Array.from({ length: 700 }, (_, index) => event({ id: `event-${index}`, sessionId: `session-${index % 200}` })),
  });
  assert.equal(index.length, 2_000);
  assert.deepEqual(Object.fromEntries([...new Set(index.map(entry => entry.kind))].map(kind => [
    kind,
    index.filter(entry => entry.kind === kind).length,
  ])), {
    project: 200,
    session: 200,
    ticket: 300,
    provider: 400,
    artifact: 400,
    event: 500,
  });
});

test('local evidence search strips controls and bounds every visible field', () => {
  const index = buildLocalEvidenceSearchIndex({
    projects: [project(`Project\n${'x'.repeat(500)}`, `branch\u0000${'y'.repeat(800)}`)],
    sessions: [],
    events: [event({ summary: `Changed\n${'z'.repeat(1_500)}` })],
  });
  for (const entry of index) {
    assert.doesNotMatch(`${entry.id}${entry.label}${entry.description}${entry.detail}`, /[\u0000-\u001f\u007f\u2028\u2029]/);
    assert.ok(entry.label.length <= 300);
    assert.ok(entry.description.length <= 700);
    assert.ok(entry.detail.length <= 1_000);
  }
});

test('local evidence search actions retain only the bounded local target needed to open a result', () => {
  const index = buildLocalEvidenceSearchIndex({
    projects: [],
    sessions: [session({ providerBindings: [providerBinding()], artifacts: [artifact()] })],
    events: [event({ responseBody: 'PROVIDER-BODY-MUST-NOT-INDEX' })],
  });
  const provider = index.find(entry => entry.kind === 'provider');
  const savedArtifact = index.find(entry => entry.kind === 'artifact');
  const savedEvent = index.find(entry => entry.kind === 'event');
  assert.deepEqual(provider.action, {
    kind: 'provider',
    sessionId: 'session-search',
    url: 'https://gitlab.example/group/app/-/merge_requests/77',
  });
  assert.deepEqual(savedArtifact.action, {
    kind: 'artifact',
    sessionId: 'session-search',
    promptPath: '/private/kronos/MR-77/prompt.md',
  });
  assert.deepEqual(savedEvent.action, { kind: 'event', sessionId: 'session-search' });
  assert.doesNotMatch(JSON.stringify(index), /PROVIDER-BODY-MUST-NOT-INDEX/);
});

function project(name, branch) {
  return { name, path: `/projects/${name}`, branch, detached: false, available: true };
}

function session(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'session-search',
    kind: 'ticket',
    ticketKey: 'SEARCH-1',
    ticketKeys: ['SEARCH-1'],
    title: 'Search session',
    status: 'active',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: true },
    projectName: 'Application',
    projectPath: '/projects/Application',
    ...overrides,
  };
}

function providerBinding(id = 'provider-gitlab-77') {
  return {
    id,
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '77',
    projectId: 'group/app',
    url: 'https://gitlab.example/group/app/-/merge_requests/77',
    attachedAt: '2026-07-15T12:00:00.000Z',
  };
}

function artifact(id = 'artifact-mr-77') {
  return {
    id,
    kind: 'gitlab-merge-request',
    label: '[MR-77] review evidence',
    promptPath: '/private/kronos/MR-77/prompt.md',
    fetchedAt: '2026-07-15T12:00:00.000Z',
    recordedAt: '2026-07-15T12:00:00.000Z',
    complete: true,
    warnings: [],
    contentSha256: 'a'.repeat(64),
  };
}

function event(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'event-search',
    at: '2026-07-15T12:05:00.000Z',
    sessionId: 'session-search',
    type: 'provider.transition',
    source: 'gitlab',
    summary: 'Merge request now needs review',
    subject: { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'SEARCH-1' },
    ...overrides,
  };
}
