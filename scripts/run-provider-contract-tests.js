const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(root, 'test-fixtures', 'providers');
const stateStore = require('../out/services/stateStore.js');
const jiraWorkCatalog = require('../out/services/jiraWorkCatalog.js');
const gitlabContext = require('../out/services/gitlabMergeRequestContext.js');
const { GitLabRestClient } = require('../out/services/gitlabRestClient.js');
const { JenkinsRestClient } = require('../out/services/jenkinsRestClient.js');
const { SonarRestClient } = require('../out/services/sonarRestClient.js');

test('provider contract matrix covers requests, bounds, normalization, completeness, and errors for every provider', () => {
  const matrix = fs.readFileSync(path.join(root, 'docs', 'provider-contract-matrix.md'), 'utf8');
  const heading = '| Provider | Requests and enterprise variants | Collection and response bounds | Normalization and retained evidence | Completeness and optional evidence | Error behavior |';
  assert.match(matrix, new RegExp(escapeRegex(heading)));
  for (const provider of ['Jira', 'GitLab', 'Jenkins', 'SonarQube']) {
    const row = matrix.split('\n').find(line => line.startsWith(`| ${provider} |`));
    assert.ok(row, `${provider} contract row is present`);
    assert.equal(row.split('|').length, 8, `${provider} retains every contract column`);
  }
  assert.match(matrix, /origin-pinned, read-only HTTP requests/);
  assert.match(matrix, /no provider SDK or third-party runtime library/);
});

test('sanitized provider fixture set is bounded, credential-free, and reserved-origin only', () => {
  const fixtureNames = fs.readdirSync(fixtureRoot).sort();
  assert.deepEqual(fixtureNames, [
    'gitlab-merge-request-enterprise.json',
    'jenkins-multibranch.json',
    'jira-work-partial.json',
    'sonarqube-branch.json',
  ]);
  for (const name of fixtureNames) {
    const raw = fs.readFileSync(path.join(fixtureRoot, name), 'utf8');
    assert.ok(Buffer.byteLength(raw, 'utf8') < 16 * 1024, `${name} stays inside the fixture bound`);
    assert.doesNotMatch(raw, /(?:authorization|access[_-]?token|api[_-]?token|private[_-]?token|password|secret)\s*[":=]/i);
    for (const match of raw.matchAll(/https?:\/\/[^\s"<>]+/g)) {
      assert.match(new URL(match[0]).hostname, /\.(?:example|invalid)$/);
    }
  }
});

test('sanitized Jira fixture retains rich fields and prior rows after a partial page read', () => {
  const fixture = readFixture('jira-work-partial.json');
  const current = stateStore.emptyWorkCatalog();
  current.tickets[fixture.cachedTicketKey] = {
    summary: 'Cached Jira fixture',
    type: 'Story',
    priority: 'Medium',
    jira_status: 'In Progress',
    source: 'jira',
    mr: null,
    build: null,
  };
  const result = jiraWorkCatalog.catalogFromJiraWorkList(fixture.snapshot, current, 'https://jira.example');
  const ticket = result.state.tickets[fixture.expected.ticketKey];
  assert.equal(ticket.jira_status, fixture.expected.status);
  assert.equal(ticket.jira_status_category, fixture.expected.statusCategory);
  assert.equal(ticket.jira_project_key, fixture.expected.jiraProject);
  assert.match(ticket.description, /Rich Jira description\.\nBounded item/);
  assert.equal(ticket.attachments[0].filename, fixture.expected.attachmentFilename);
  assert.equal(result.retainedFromPrevious, fixture.expected.retainedFromPrevious);
  assert.ok(result.state.tickets[fixture.cachedTicketKey]);
  assert.equal(Object.hasOwn(ticket, 'unexpectedFutureField'), false);
});

test('sanitized GitLab fixture normalizes enterprise MR review, pipeline, job, and test evidence', () => {
  const fixture = readFixture('gitlab-merge-request-enterprise.json');
  const context = gitlabContext.normalizeGitLabMergeRequestContext(fixture.ticketKey, fixture.iid, fixture.snapshot);
  assert.equal(context.mergeRequest.title, 'ENTERPRISE-42 provider fixture');
  assert.equal(context.discussions[0].resolved, fixture.expected.discussionResolved);
  assert.equal(context.pipeline.id, fixture.expected.pipelineId);
  assert.equal(context.jobs[0].id, fixture.expected.jobId);
  assert.equal(context.testReport.failedCount, fixture.expected.failedTests);
  assert.equal(context.completeness.complete, true);
  assert.equal(Object.hasOwn(context.mergeRequest, 'provider_extra'), false);
});

test('GitLab enterprise paths retain paginated evidence and explain permission and rate-limit gaps', async () => {
  const fixture = readFixture('gitlab-merge-request-enterprise.json');
  const requests = [];
  const encodedProject = encodeURIComponent(fixture.projectRef);
  const mergeRequestPath = `/api/v4/projects/${encodedProject}/merge_requests/${fixture.iid}`;
  const client = new GitLabRestClient({
    env: { GITLAB_API_BASE_URL: 'https://gitlab.example/api/v4', GITLAB_TOKEN: 'fixture-only' },
    transport: async request => {
      requests.push(request);
      const url = new URL(request.url);
      if (url.pathname === `/api/v4/projects/${encodedProject}`) {
        return jsonResponse({ id: 4815, provider_extra: true });
      }
      if (url.pathname === `/api/v4/projects/4815/merge_requests/${fixture.iid}`) {
        return jsonResponse(fixture.snapshot.mr);
      }
      if (url.pathname === mergeRequestPath) { return jsonResponse(fixture.snapshot.mr); }
      if (url.pathname === `${mergeRequestPath}/notes`) {
        return Number(url.searchParams.get('page')) === 1
          ? jsonResponse(fixture.snapshot.notes, { 'x-next-page': '2' })
          : { statusCode: 429, body: '{"private":"not displayed"}', headers: {} };
      }
      if (url.pathname === `${mergeRequestPath}/discussions`) { return jsonResponse(fixture.snapshot.discussions); }
      if (url.pathname === `${mergeRequestPath}/approvals`) {
        return { statusCode: 403, body: '{"private":"not displayed"}', headers: {} };
      }
      if (url.pathname === `${mergeRequestPath}/diffs`) { return jsonResponse(fixture.snapshot.diffs); }
      if (url.pathname === `${mergeRequestPath}/pipelines`) { return jsonResponse([]); }
      return { statusCode: 404, body: '', headers: {} };
    },
  });

  assert.equal(await client.projectId(fixture.projectRef), 4815);
  assert.equal((await client.mergeRequest({ projectIdOrPath: '4815', iid: fixture.iid })).iid, fixture.iid);
  const snapshot = await client.mergeRequestContext({ projectIdOrPath: fixture.projectRef, iid: fixture.iid });
  assert.equal(snapshot.notes.length, fixture.snapshot.notes.length);
  assert.equal(snapshot.discussions.length, fixture.snapshot.discussions.length);
  assert.equal(snapshot.completeness.notesComplete, false);
  assert.equal(snapshot.approvals, undefined);
  assert.match(snapshot.completeness.warnings.join(' '), /HTTP 429/);
  assert.match(snapshot.completeness.warnings.join(' '), /HTTP 403/);
  assert.doesNotMatch(snapshot.completeness.warnings.join(' '), /"private"|not displayed"/);
  assert.ok(requests.every(request => request.method === 'GET'));
  assert.ok(requests.every(request => new URL(request.url).origin === 'https://gitlab.example'));
  assert.ok(requests.some(request => request.url.includes(`/projects/${encodedProject}/`)));
  assert.ok(requests.some(request => request.url.includes('/projects/4815/merge_requests/')));
});

test('sanitized Jenkins fixture resolves a multibranch build and treats missing stages as optional', async () => {
  const fixture = readFixture('jenkins-multibranch.json');
  const client = new JenkinsRestClient({
    env: { JENKINS_URL: 'https://jenkins.example' },
    transport: async request => {
      const url = new URL(request.url);
      if (url.pathname === '/job/service-api/api/json') { return jsonResponse(fixture.parent); }
      if (request.url.startsWith(`${fixture.branchJobUrl}api/json`)) { return jsonResponse(fixture.branchBuild); }
      if (url.pathname.endsWith('/testReport/api/json')) { return jsonResponse(fixture.testReport); }
      if (url.pathname.endsWith('/wfapi/describe')) { return { statusCode: 404, body: '', headers: {} }; }
      if (url.pathname.endsWith('/config.xml')) { return { statusCode: 200, body: fixture.configXml, headers: {} }; }
      return { statusCode: 404, body: '', headers: {} };
    },
  });
  const context = await client.buildContext(fixture.jobUrl, { branch: fixture.branch });
  assert.equal(context.build.number, fixture.expected.buildNumber);
  assert.equal(context.tests.totalCount, fixture.expected.testTotal);
  assert.equal(context.sonarProjectKey, fixture.expected.sonarProjectKey);
  assert.equal(context.completeness.stages, fixture.expected.stagesStatus);
  assert.equal(context.completeness.complete, true);
  assert.equal(JSON.stringify(context).includes('flow-definition'), false);
});

test('sanitized SonarQube fixture retains branch-qualified gate, measures, and issues', async () => {
  const fixture = readFixture('sonarqube-branch.json');
  const client = new SonarRestClient({
    env: { SONAR_HOST_URL: 'https://sonar.example', SONAR_TOKEN: 'fixture-value' },
    issuesPerPage: 2,
    transport: async request => {
      const url = new URL(request.url);
      if (url.pathname === '/api/qualitygates/project_status') { return jsonResponse(fixture.qualityGate); }
      if (url.pathname === '/api/measures/component') { return jsonResponse(fixture.measures); }
      if (url.pathname === '/api/issues/search') { return jsonResponse(fixture.issues); }
      return { statusCode: 404, body: '', headers: {} };
    },
  });
  const context = await client.branchContext(fixture.projectKey, fixture.branch);
  assert.equal(context.qualityGate.status, fixture.expected.gateStatus);
  assert.equal(context.measures.length, fixture.expected.measureCount);
  assert.equal(context.issues.length, fixture.expected.issueCount);
  assert.equal(context.completeness.complete, fixture.expected.complete);
  const dashboard = new URL(context.dashboardUrl);
  assert.deepEqual([...dashboard.searchParams.keys()], ['id', 'branch']);
  assert.equal(dashboard.searchParams.get('branch'), fixture.branch);
});

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}

function jsonResponse(value, headers = {}) {
  return { statusCode: 200, body: JSON.stringify(value), headers };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
