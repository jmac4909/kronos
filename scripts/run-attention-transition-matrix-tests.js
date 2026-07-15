const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const mergeRequests = require('../out/services/gitlabMergeRequestTransitions.js');
const pipelines = require('../out/services/pipelineTransitions.js');
const ci = require('../out/services/ciTransitions.js');
const { currentAttentionTransitions } = require('../out/services/attentionProjection.js');

test('GitLab merge-request transition matrix covers every declared structural transition', () => {
  const thread = (id, noteId = id) => ({
    id,
    notes: [{ id: noteId, resolvable: true, resolved: false, updated_at: `2026-07-15T12:${String(noteId).padStart(2, '0')}:00.000Z` }],
  });
  const note = (id, updated = id) => ({ id, updated_at: `2026-07-15T13:${String(updated).padStart(2, '0')}:00.000Z` });
  const cases = [
    ['merge_request_merged', mrDigest({ state: 'opened' }), mrDigest({ state: 'merged' })],
    ['merge_request_closed', mrDigest({ state: 'opened' }), mrDigest({ state: 'closed' })],
    ['merge_request_reopened', mrDigest({ state: 'closed' }), mrDigest({ state: 'opened' })],
    ['merge_request_state_changed', mrDigest({ state: 'opened' }), mrDigest({ state: 'locked' })],
    ['changes_requested', mrDigest({ detailedStatus: 'mergeable' }), mrDigest({ detailedStatus: 'requested_changes' })],
    ['changes_request_cleared', mrDigest({ detailedStatus: 'requested_changes' }), mrDigest({ detailedStatus: 'mergeable' })],
    ['approval_satisfied', mrDigest({ approved: false, approvalsLeft: 1 }), mrDigest({ approved: true, approvalsLeft: 0, approvedBy: [{ user: { id: 9 } }] })],
    ['approval_required', mrDigest({ approved: true, approvalsLeft: 0, approvedBy: [{ user: { id: 9 } }] }), mrDigest({ approved: false, approvalsLeft: 1 })],
    ['approval_state_changed', mrDigest({ approved: false, approvalsRequired: 2, approvalsLeft: 2 }), mrDigest({ approved: false, approvalsRequired: 2, approvalsLeft: 1 })],
    ['reviewers_changed', mrDigest({ reviewers: [{ id: 1 }] }), mrDigest({ reviewers: [{ id: 2 }] })],
    ['unresolved_discussions_observed', mrDigest({ discussionsComplete: false }), mrDigest({ discussions: [thread('thread-1', 1)] })],
    ['unresolved_discussions_increased', mrDigest({ discussions: [thread('thread-1', 1)] }), mrDigest({ discussions: [thread('thread-1', 1), thread('thread-2', 2)] })],
    ['unresolved_discussions_decreased', mrDigest({ discussions: [thread('thread-1', 1), thread('thread-2', 2)] }), mrDigest({ discussions: [thread('thread-1', 1)] })],
    ['unresolved_discussions_changed', mrDigest({ discussions: [thread('thread-1', 1)] }), mrDigest({ discussions: [thread('thread-2', 2)] })],
    ['review_activity_added', mrDigest({ notes: [] }), mrDigest({ notes: [note(10)] })],
    ['review_activity_changed', mrDigest({ notes: [note(10, 10)] }), mrDigest({ notes: [note(10, 11)] })],
  ];
  assertMatrixCoverage(
    'src/services/gitlabMergeRequestTransitions.ts',
    'GitLabMergeRequestTransitionKind',
    cases.map(([kind]) => kind),
  );
  for (const [expected, previous, current] of cases) {
    const kinds = mergeRequests.compareGitLabMergeRequestDigests(previous, current).map(transition => transition.kind);
    assert.ok(kinds.includes(expected), `${expected} was not emitted; received ${kinds.join(', ') || 'none'}`);
    assert.deepEqual(
      mergeRequests.compareGitLabMergeRequestDigests(current, current),
      [],
      `${expected} must remain quiet when the normalized digest is unchanged`,
    );
  }
});

test('GitLab pipeline transition matrix covers every declared pipeline, job, and test transition', () => {
  const failedJob = { id: 4, name: 'verify', stage: 'test', status: 'failed', allow_failure: false };
  const cases = [
    ['new_pipeline', pipelineDigest({ id: 70 }), pipelineDigest({ id: 71 })],
    ['pipeline_failed', pipelineDigest({ status: 'running' }), pipelineDigest({ status: 'failed' })],
    ['pipeline_canceled', pipelineDigest({ status: 'running' }), pipelineDigest({ status: 'canceled' })],
    ['pipeline_recovered', pipelineDigest({ status: 'failed' }), pipelineDigest({ status: 'success' })],
    ['pipeline_succeeded', pipelineDigest({ status: 'running' }), pipelineDigest({ status: 'success' })],
    ['blocking_jobs_failed', pipelineDigest(), pipelineDigest({ jobs: [failedJob] })],
    ['blocking_jobs_recovered', pipelineDigest({ jobs: [failedJob] }), pipelineDigest()],
    ['tests_failed', pipelineDigest({ failedTests: 0 }), pipelineDigest({ failedTests: 2 })],
    ['tests_recovered', pipelineDigest({ failedTests: 2 }), pipelineDigest({ failedTests: 0 })],
  ];
  assertMatrixCoverage(
    'src/services/pipelineTransitions.ts',
    'GitLabPipelineTransitionKind',
    cases.map(([kind]) => kind),
  );
  for (const [expected, previous, current] of cases) {
    const kinds = pipelines.compareGitLabPipelineDigests(previous, current).map(transition => transition.kind);
    assert.ok(kinds.includes(expected), `${expected} was not emitted; received ${kinds.join(', ') || 'none'}`);
  }
});

test('Jenkins and SonarQube transition matrices cover every declared CI transition', () => {
  const jenkinsCases = [
    ['jenkins_new_build', jenkinsDigest({ buildNumber: 11 }), jenkinsDigest({ buildNumber: 12 })],
    ['jenkins_failed', jenkinsDigest({ status: 'running' }), jenkinsDigest({ status: 'failure' })],
    ['jenkins_recovered', jenkinsDigest({ status: 'failure' }), jenkinsDigest({ status: 'success' })],
    ['jenkins_succeeded', jenkinsDigest({ status: 'running' }), jenkinsDigest({ status: 'success' })],
    ['jenkins_tests_failed', jenkinsDigest({ failedTestCount: 0 }), jenkinsDigest({ failedTestCount: 2 })],
    ['jenkins_tests_recovered', jenkinsDigest({ failedTestCount: 2 }), jenkinsDigest({ failedTestCount: 0 })],
    ['jenkins_stages_failed', jenkinsDigest({ failedStageNames: [] }), jenkinsDigest({ failedStageNames: ['Verify'] })],
    ['jenkins_stages_recovered', jenkinsDigest({ failedStageNames: ['Verify'] }), jenkinsDigest({ failedStageNames: [] })],
  ];
  const sonarCases = [
    ['sonar_gate_failed', sonarDigest({ gateStatus: 'OK' }), sonarDigest({ gateStatus: 'ERROR' })],
    ['sonar_gate_recovered', sonarDigest({ gateStatus: 'ERROR' }), sonarDigest({ gateStatus: 'OK' })],
    ['sonar_issues_increased', sonarDigest({ unresolvedIssueCount: 1 }), sonarDigest({ unresolvedIssueCount: 2 })],
    ['sonar_issues_decreased', sonarDigest({ unresolvedIssueCount: 2 }), sonarDigest({ unresolvedIssueCount: 1 })],
  ];
  assertMatrixCoverage(
    'src/services/ciTransitions.ts',
    'JenkinsCiTransitionKind',
    jenkinsCases.map(([kind]) => kind),
  );
  assertMatrixCoverage(
    'src/services/ciTransitions.ts',
    'SonarCiTransitionKind',
    sonarCases.map(([kind]) => kind),
  );
  for (const [expected, previous, current] of jenkinsCases) {
    const kinds = ci.compareJenkinsCiDigests(previous, current).map(transition => transition.kind);
    assert.ok(kinds.includes(expected), `${expected} was not emitted; received ${kinds.join(', ') || 'none'}`);
  }
  for (const [expected, previous, current] of sonarCases) {
    const kinds = ci.compareSonarCiDigests(previous, current).map(transition => transition.kind);
    assert.ok(kinds.includes(expected), `${expected} was not emitted; received ${kinds.join(', ') || 'none'}`);
  }
});

test('Attention projection rebuilds after restart without stale-row resurrection', () => {
  const session = workSession();
  const oldFailure = transitionEvent('failure-old', '2026-07-15T12:00:00.000Z', 'provider_read_failed', 'failed');
  const recovery = transitionEvent('recovery-current', '2026-07-15T12:01:00.000Z', 'provider_read_recovered', 'complete');
  const sonar = transitionEvent('sonar-current', '2026-07-15T12:02:00.000Z', 'sonar_gate_failed', 'ERROR', {
    source: 'sonar',
    subject: { kind: 'quality-gate', id: 'app:main', project: 'Application', ticketKey: 'MATRIX-1' },
  });
  const audit = [oldFailure, recovery, sonar];
  const first = currentAttentionTransitions(audit, [session]);
  assert.deepEqual(first.map(event => event.id), ['sonar-current', 'recovery-current']);

  const acknowledged = {
    schemaVersion: 1,
    id: 'ack-recovery-current',
    at: '2026-07-15T12:03:00.000Z',
    sessionId: session.id,
    type: 'notification.acknowledged',
    source: 'operator',
    summary: 'Acknowledged current GitLab health.',
    metadata: { acknowledgedEventId: recovery.id },
  };
  const reloadedAudit = JSON.parse(JSON.stringify([...audit, acknowledged]));
  const afterRestart = currentAttentionTransitions(reloadedAudit, [JSON.parse(JSON.stringify(session))]);
  assert.deepEqual(afterRestart.map(event => event.id), ['sonar-current']);
  assert.equal(afterRestart.some(event => event.id === oldFailure.id), false, 'acknowledging newest state must not resurrect stale history');
  assert.equal(reloadedAudit.filter(event => event.type === 'provider.transition').length, 3, 'the append-only audit still reconstructs all transitions');

  const laterFailure = transitionEvent('failure-later', '2026-07-15T12:04:00.000Z', 'provider_read_failed', 'failed');
  assert.deepEqual(
    currentAttentionTransitions([...reloadedAudit, laterFailure], [session]).map(event => event.id),
    ['failure-later', 'sonar-current'],
    'a later real change becomes current even after the prior state was acknowledged',
  );
});

test('Attention read-health state replaces failure, recovery, partial, and later failure in one stream', () => {
  const session = workSession();
  const states = [
    transitionEvent('health-failed-first', '2026-07-15T14:00:00.000Z', 'provider_read_failed', 'failed', {
      metadata: {
        transitionKind: 'provider_read_failed',
        mergeRequestIid: 77,
        readState: 'failed',
        readReason: 'timeout',
        readComponents: 'merge-request',
      },
    }),
    transitionEvent('health-recovered', '2026-07-15T14:01:00.000Z', 'provider_read_recovered', 'complete', {
      metadata: {
        transitionKind: 'provider_read_recovered',
        mergeRequestIid: 77,
        readState: 'complete',
        readReason: 'complete',
        readComponents: 'none',
      },
    }),
    transitionEvent('health-partial', '2026-07-15T14:02:00.000Z', 'provider_read_partial', 'partial', {
      metadata: {
        transitionKind: 'provider_read_partial',
        mergeRequestIid: 77,
        readState: 'partial',
        readReason: 'bounded_read_incomplete',
        readComponents: 'discussions,notes',
      },
    }),
    transitionEvent('health-failed-later', '2026-07-15T14:03:00.000Z', 'provider_read_failed', 'failed', {
      metadata: {
        transitionKind: 'provider_read_failed',
        mergeRequestIid: 77,
        readState: 'failed',
        readReason: 'authentication',
        readComponents: 'merge-request',
      },
    }),
  ];

  for (let index = 0; index < states.length; index += 1) {
    assert.deepEqual(
      currentAttentionTransitions(states.slice(0, index + 1), [session]).map(event => event.id),
      [states[index].id],
      'each meaningful read-health change replaces the prior current row',
    );
  }

  const acknowledgement = {
    schemaVersion: 1,
    id: 'ack-health-failed-later',
    at: '2026-07-15T14:04:00.000Z',
    sessionId: session.id,
    type: 'notification.acknowledged',
    source: 'operator',
    summary: 'Acknowledged the newest provider-read state.',
    metadata: { acknowledgedEventId: states.at(-1).id },
  };
  const audit = [...states, acknowledgement];
  assert.deepEqual(currentAttentionTransitions(audit, [session]), []);
  assert.equal(audit.filter(event => event.type === 'provider.transition').length, 4);
});

test('Attention collapses newer pipeline, build, test, gate, and issue occurrences without deleting audit history', () => {
  const session = workSession();
  const events = [
    resourceTransition('pipeline-failed', '2026-07-15T15:00:00.000Z', 'gitlab', 'pipeline', '100', 'pipeline_failed', {
      mergeRequestIid: 77,
      pipelineId: 100,
    }),
    resourceTransition('pipeline-jobs', '2026-07-15T15:01:00.000Z', 'gitlab', 'pipeline', '100', 'blocking_jobs_failed', {
      mergeRequestIid: 77,
      pipelineId: 100,
    }),
    resourceTransition('pipeline-tests-new', '2026-07-15T15:02:00.000Z', 'gitlab', 'pipeline', '101', 'tests_failed', {
      mergeRequestIid: 77,
      pipelineId: 101,
    }),
    resourceTransition('jenkins-failed', '2026-07-15T15:03:00.000Z', 'jenkins', 'build', '31', 'jenkins_failed', {
      buildNumber: 31,
    }),
    resourceTransition('jenkins-stages', '2026-07-15T15:04:00.000Z', 'jenkins', 'build', '31', 'jenkins_stages_failed', {
      buildNumber: 31,
    }),
    resourceTransition('jenkins-tests-new', '2026-07-15T15:05:00.000Z', 'jenkins', 'build', '32', 'jenkins_tests_failed', {
      buildNumber: 32,
    }),
    resourceTransition('sonar-gate', '2026-07-15T15:06:00.000Z', 'sonar', 'quality-gate', 'app:main', 'sonar_gate_failed', {
      projectKey: 'app',
      branch: 'main',
    }),
    resourceTransition('sonar-issues', '2026-07-15T15:07:00.000Z', 'sonar', 'quality-gate', 'app:main', 'sonar_issues_increased', {
      projectKey: 'app',
      branch: 'main',
    }),
    resourceTransition('sonar-feature', '2026-07-15T15:08:00.000Z', 'sonar', 'quality-gate', 'app:feature', 'sonar_gate_failed', {
      projectKey: 'app',
      branch: 'feature',
    }),
  ];
  const reloadedAudit = JSON.parse(JSON.stringify(events));
  assert.deepEqual(
    currentAttentionTransitions(reloadedAudit, [JSON.parse(JSON.stringify(session))]).map(event => event.id),
    ['sonar-feature', 'sonar-issues', 'jenkins-tests-new', 'pipeline-tests-new'],
  );
  assert.equal(reloadedAudit.length, 9, 'the append-only audit retains every stale occurrence and current row');
});

function mrDigest(overrides = {}) {
  const snapshot = {
    mr: {
      iid: 77,
      state: overrides.state || 'opened',
      detailed_merge_status: overrides.detailedStatus || 'mergeable',
      updated_at: '2026-07-15T12:00:00.000Z',
      web_url: 'https://gitlab.example/group/app/-/merge_requests/77',
      reviewers: overrides.reviewers || [{ id: 1 }],
    },
    approvals: {
      approved: overrides.approved === true,
      approvals_required: overrides.approvalsRequired ?? 1,
      approvals_left: overrides.approvalsLeft ?? (overrides.approved ? 0 : 1),
      approved_by: overrides.approvedBy || [],
    },
    discussions: overrides.discussions || [],
    notes: overrides.notes || [],
    fetchedAt: '2026-07-15T12:00:01.000Z',
    completeness: {
      approvalsComplete: true,
      discussionsComplete: overrides.discussionsComplete !== false,
      notesComplete: overrides.notesComplete !== false,
    },
  };
  return requiredDigest(mergeRequests.normalizeGitLabMergeRequestDigest(snapshot), 'merge request');
}

function pipelineDigest(overrides = {}) {
  const failedTests = overrides.failedTests || 0;
  return requiredDigest(pipelines.normalizeGitLabPipelineDigest({
    mr: { head_pipeline: {
      id: overrides.id || 70,
      status: overrides.status || 'running',
      web_url: `https://gitlab.example/group/app/-/pipelines/${overrides.id || 70}`,
    } },
    jobs: overrides.jobs || [],
    testReportSummary: {
      total: { count: 10, failed: failedTests, error: 0, skipped: 0, success: 10 - failedTests },
    },
    fetchedAt: '2026-07-15T12:00:00.000Z',
    completeness: { jobsComplete: true, testsComplete: true },
  }), 'pipeline');
}

function jenkinsDigest(overrides = {}) {
  const buildNumber = overrides.buildNumber || 11;
  return requiredDigest(ci.normalizeJenkinsCiDigest({
    schemaVersion: 1,
    provider: 'jenkins',
    jobOrBuildUrl: 'https://jenkins.example/job/app',
    buildUrl: `https://jenkins.example/job/app/${buildNumber}`,
    buildNumber,
    status: overrides.status || 'running',
    building: overrides.status === 'running',
    testsAvailable: true,
    failedTestCount: overrides.failedTestCount || 0,
    stagesAvailable: true,
    failedStageNames: overrides.failedStageNames || [],
    failedStageNamesTruncated: false,
  }), 'Jenkins');
}

function sonarDigest(overrides = {}) {
  return requiredDigest(ci.normalizeSonarCiDigest({
    schemaVersion: 1,
    provider: 'sonarqube',
    projectKey: 'app:key',
    branch: 'main',
    dashboardUrl: 'https://sonar.example/dashboard?id=app%3Akey&branch=main',
    gateAvailable: true,
    gateStatus: overrides.gateStatus || 'OK',
    issueCountAvailable: true,
    unresolvedIssueCount: overrides.unresolvedIssueCount || 0,
    metricsAvailable: true,
    metrics: [],
  }), 'SonarQube');
}

function requiredDigest(value, label) {
  assert.ok(value, `${label} fixture did not normalize`);
  return value;
}

function assertMatrixCoverage(relativeFile, typeName, coveredKinds) {
  const source = fs.readFileSync(path.join(root, relativeFile), 'utf8');
  const start = source.indexOf(`export type ${typeName} =`);
  const end = source.indexOf(';', start);
  assert.ok(start >= 0 && end > start, `could not locate ${typeName}`);
  const declared = [...source.slice(start, end).matchAll(/'([^']+)'/g)].map(match => match[1]).sort();
  assert.deepEqual([...new Set(coveredKinds)].sort(), declared, `${typeName} declarations and matrix cases drifted`);
}

function transitionEvent(id, at, transitionKind, state, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    at,
    sessionId: 'session-matrix-1',
    type: 'provider.transition',
    source: 'gitlab',
    summary: `${transitionKind} fixture`,
    subject: { kind: 'provider-read', id: 'gitlab:77', project: 'Application', ticketKey: 'MATRIX-1' },
    after: { state, fingerprint: `${id}-fingerprint` },
    metadata: { transitionKind, readState: state, readReason: state },
    ...overrides,
  };
}

function resourceTransition(id, at, source, kind, subjectId, transitionKind, metadata = {}) {
  return transitionEvent(id, at, transitionKind, transitionKind, {
    source,
    subject: { kind, id: subjectId, project: 'Application', ticketKey: 'MATRIX-1' },
    metadata: { transitionKind, ...metadata },
  });
}

function workSession() {
  return {
    schemaVersion: 1,
    id: 'session-matrix-1',
    kind: 'ticket',
    ticketKey: 'MATRIX-1',
    ticketKeys: ['MATRIX-1'],
    title: 'Transition matrix session',
    projectName: 'Application',
    status: 'active',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: true },
  };
}
