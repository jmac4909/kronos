const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(root, 'test-fixtures', 'providers');
const stateStore = require('../out/services/stateStore.js');
const jiraWorkCatalog = require('../out/services/jiraWorkCatalog.js');
const gitlabContext = require('../out/services/gitlabMergeRequestContext.js');
const { JenkinsRestClient } = require('../out/services/jenkinsRestClient.js');
const { SonarRestClient } = require('../out/services/sonarRestClient.js');

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

function jsonResponse(value) {
  return { statusCode: 200, body: JSON.stringify(value), headers: {} };
}
