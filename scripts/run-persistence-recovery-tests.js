const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-persistence-recovery-')));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

const managedMonitorLease = require('../out/services/managedMonitorLease.js');
const privateFiles = require('../out/services/privateFilePrimitives.js');
const stateStore = require('../out/services/stateStore.js');
const workSessions = require('../out/services/workSessionStore.js');
const projectMonitoringStore = require('../out/services/projectMonitoringStore.js');
const gitLabMonitorStore = require('../out/services/gitlabMergeRequestMonitorStore.js');
const gitLabRestModule = require('../out/services/gitlabRestClient.js');
const { ManagedProviderMonitor } = require('../out/services/managedProviderMonitor.js');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test('one private open-flag layer omits unsupported Windows flags and fails closed on POSIX', () => {
  const windows = privateFiles.privateFileOpenFlags('exclusive-write', 'win32', {
    noFollow: undefined,
    nonBlocking: undefined,
    directory: undefined,
  });
  assert.equal(windows & fs.constants.O_WRONLY, fs.constants.O_WRONLY);
  assert.equal(windows & fs.constants.O_CREAT, fs.constants.O_CREAT);
  assert.equal(windows & fs.constants.O_EXCL, fs.constants.O_EXCL);
  assert.throws(
    () => privateFiles.privateFileOpenFlags('read', 'linux', { noFollow: undefined }),
    /require O_NOFOLLOW support/,
  );

  const leaseSource = fs.readFileSync(path.join(root, 'src/services/managedMonitorLease.ts'), 'utf8');
  assert.match(leaseSource, /privateFileOpenFlags\('exclusive-write'\)/);
  assert.match(leaseSource, /privateFileOpenFlags\('read-nonblocking'\)/);
  assert.doesNotMatch(leaseSource, /fs\.constants\.O_(?:RDONLY|WRONLY|CREAT|EXCL|NONBLOCK|NOFOLLOW)/);
});

test('expired monitor lease is reclaimed while a current owner remains exclusive', () => {
  const kronosDir = path.join(tempRoot, 'expired-lease');
  const first = managedMonitorLease.tryAcquireManagedMonitorLease({
    kronosDir,
    ttlMs: 1_000,
    now: new Date('2026-07-15T12:00:00.000Z'),
  });
  assert.equal(first.acquired, true);
  const active = managedMonitorLease.tryAcquireManagedMonitorLease({
    kronosDir,
    ttlMs: 1_000,
    now: new Date('2026-07-15T12:00:00.500Z'),
  });
  assert.equal(active.acquired, false);
  assert.equal(active.reason, 'active');

  const recovered = managedMonitorLease.tryAcquireManagedMonitorLease({
    kronosDir,
    ttlMs: 1_000,
    now: new Date('2026-07-15T12:00:02.000Z'),
  });
  assert.equal(recovered.acquired, true);
  assert.notEqual(recovered.lease.ownerId, first.lease.ownerId);
  assert.equal(first.renew({ now: new Date('2026-07-15T12:00:02.100Z') }), false);
  assert.equal(first.release(), false);
  assert.equal(recovered.release(), true);
});

test('distinct processes sharing one Kronos directory enforce one polling owner and clean handoff', async () => {
  const kronosDir = path.join(tempRoot, 'cross-process-lease');
  const owner = startLeaseWorker();
  const contender = startLeaseWorker();
  try {
    const first = await leaseWorkerRequest(owner, { command: 'acquire', kronosDir, ttlMs: 30_000 });
    assert.equal(first.acquired, true);
    assert.equal(first.pid, owner.pid);
    assert.match(first.ownerId, /^[a-f0-9]{48}$/);

    const blocked = await leaseWorkerRequest(contender, { command: 'acquire', kronosDir, ttlMs: 30_000 });
    assert.equal(blocked.acquired, false);
    assert.equal(blocked.reason, 'active');
    assert.equal(blocked.pid, contender.pid);

    const ownerRelease = await leaseWorkerRequest(owner, { command: 'release' });
    assert.equal(ownerRelease.released, true);
    assert.equal(ownerRelease.pid, owner.pid);
    const handedOff = await leaseWorkerRequest(contender, { command: 'acquire', kronosDir, ttlMs: 30_000 });
    assert.equal(handedOff.acquired, true);
    assert.notEqual(handedOff.ownerId, first.ownerId);

    const reverseBlocked = await leaseWorkerRequest(owner, { command: 'acquire', kronosDir, ttlMs: 30_000 });
    assert.equal(reverseBlocked.acquired, false);
    assert.equal(reverseBlocked.reason, 'active');
    const contenderRelease = await leaseWorkerRequest(contender, { command: 'release' });
    assert.equal(contenderRelease.released, true);
    assert.equal(contenderRelease.pid, contender.pid);
  } finally {
    await Promise.all([stopLeaseWorker(owner), stopLeaseWorker(contender)]);
  }
});

test('lease renewal and release refuse an identity replacement without deleting its owner', () => {
  const kronosDir = path.join(tempRoot, 'lease-identity-replacement');
  const first = managedMonitorLease.tryAcquireManagedMonitorLease({
    kronosDir,
    ttlMs: 5_000,
    now: new Date('2026-07-15T12:00:00.000Z'),
  });
  assert.equal(first.acquired, true);
  const replacement = {
    ...first.lease,
    ownerId: 'b'.repeat(48),
    acquiredAt: '2026-07-15T12:00:01.000Z',
    expiresAt: '2026-07-15T12:00:06.000Z',
  };
  const replacementPath = `${first.leasePath}.replacement`;
  fs.writeFileSync(replacementPath, `${JSON.stringify(replacement)}\n`, { mode: 0o600 });
  fs.rmSync(first.leasePath);
  fs.renameSync(replacementPath, first.leasePath);

  assert.equal(first.renew({ now: new Date('2026-07-15T12:00:02.000Z') }), false);
  assert.equal(first.release(), false);
  assert.equal(JSON.parse(fs.readFileSync(first.leasePath, 'utf8')).ownerId, replacement.ownerId);
  const competing = managedMonitorLease.tryAcquireManagedMonitorLease({
    kronosDir,
    now: new Date('2026-07-15T12:00:02.000Z'),
  });
  assert.equal(competing.acquired, false);
  assert.equal(competing.reason, 'active');
});

test('malformed, partial, oversized, future, and symbolic lease state fails closed', t => {
  const cases = [
    ['partial', '{"schema":'],
    ['malformed', 'not-json\n'],
    ['future', `${JSON.stringify({
      schema: 'kronos.managed-monitor-lease',
      schemaVersion: 99,
      ownerId: 'a'.repeat(48),
      pid: 1,
      acquiredAt: '2026-07-15T12:00:00.000Z',
      expiresAt: '2026-07-15T12:00:05.000Z',
    })}\n`],
    ['oversized', 'x'.repeat(4_097)],
  ];
  for (const [name, content] of cases) {
    const kronosDir = path.join(tempRoot, `unsafe-lease-${name}`);
    const leasePath = writeLeaseFixture(kronosDir, content);
    const before = fs.readFileSync(leasePath);
    const result = managedMonitorLease.tryAcquireManagedMonitorLease({ kronosDir });
    assert.equal(result.acquired, false, name);
    assert.equal(result.reason, 'unsafe', name);
    assert.deepEqual(fs.readFileSync(leasePath), before, `${name} state must not be replaced`);
  }

  const outside = path.join(tempRoot, 'unsafe-lease-outside');
  fs.writeFileSync(outside, 'outside\n', { mode: 0o600 });
  const linkedRoot = path.join(tempRoot, 'unsafe-lease-symbolic');
  const linkedPath = managedMonitorLease.managedMonitorLeasePath({ kronosDir: linkedRoot });
  fs.mkdirSync(path.dirname(linkedPath), { recursive: true, mode: 0o700 });
  try {
    fs.symlinkSync(outside, linkedPath);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`Symbolic links are unavailable on this host: ${error.code}`);
      return;
    }
    throw error;
  }
  const symbolic = managedMonitorLease.tryAcquireManagedMonitorLease({ kronosDir: linkedRoot });
  assert.equal(symbolic.acquired, false);
  assert.equal(symbolic.reason, 'unsafe');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside\n');
});

test('catalog, session, and monitor readers reject incomplete or unsupported private JSON', () => {
  fs.mkdirSync(stateStore.KRONOS_DIR, { recursive: true, mode: 0o700 });
  for (const content of [
    '{"schemaVersion":2,',
    '[]\n',
    '{"schemaVersion":99,"projects":{},"tickets":{}}\n',
  ]) {
    fs.writeFileSync(stateStore.STATE_FILE, content, { mode: 0o600 });
    const result = stateStore.readStateFileWithIssues();
    assert.deepEqual(result.state, stateStore.emptyWorkCatalog());
    assert.ok(result.issues.length > 0);
  }
  fs.writeFileSync(stateStore.STATE_FILE, '', { mode: 0o600 });
  fs.truncateSync(stateStore.STATE_FILE, stateStore.MAX_WORK_CATALOG_BYTES + 1);
  const oversizedCatalog = stateStore.readStateFileWithIssues();
  assert.deepEqual(oversizedCatalog.state, stateStore.emptyWorkCatalog());
  assert.ok(oversizedCatalog.issues.length > 0);

  const sessionOptions = { kronosDir: path.join(tempRoot, 'invalid-session-state') };
  const session = workSessions.createStandaloneWorkSession({ title: 'Invalid state fixture' }, sessionOptions);
  const sessionPath = path.join(workSessions.workSessionDirectory(session.id, sessionOptions), 'session.json');
  for (const content of ['{"schemaVersion":1,', '{"schemaVersion":99}\n']) {
    fs.writeFileSync(sessionPath, content, { mode: 0o600 });
    assert.deepEqual(workSessions.listWorkSessions(sessionOptions), []);
    assert.equal(workSessions.listWorkSessionStoreIssues(sessionOptions).length, 1);
  }
  fs.writeFileSync(sessionPath, '', { mode: 0o600 });
  fs.truncateSync(sessionPath, workSessions.MAX_WORK_SESSION_RECORD_BYTES + 1);
  assert.deepEqual(workSessions.listWorkSessions(sessionOptions), []);
  assert.equal(workSessions.listWorkSessionStoreIssues(sessionOptions).length, 1);

  const snapshotOptions = { kronosDir: path.join(tempRoot, 'invalid-monitor-state') };
  const monitorSession = workSessions.createStandaloneWorkSession({ title: 'Monitor state fixture' }, snapshotOptions);
  const snapshotPath = gitLabMonitorStore.gitLabMergeRequestMonitorSnapshotPath(monitorSession.id, snapshotOptions);
  fs.writeFileSync(snapshotPath, '{"iid":', { mode: 0o600 });
  assert.throws(
    () => gitLabMonitorStore.readGitLabMergeRequestMonitorSnapshot(monitorSession.id, snapshotOptions),
    SyntaxError,
  );
  const readStatusPath = gitLabMonitorStore.gitLabMergeRequestReadStatusPath(monitorSession.id, snapshotOptions);
  fs.writeFileSync(readStatusPath, '{"schemaVersion":99}\n', { mode: 0o600 });
  assert.equal(gitLabMonitorStore.readGitLabMergeRequestReadStatus(monitorSession.id, snapshotOptions), null);
});

test('registered-project monitoring owners refresh identity, reject stale bindings, and isolate returned state', () => {
  const firstPath = path.join(tempRoot, 'registered-project-v1');
  const renamedPath = path.join(tempRoot, 'registered-project-v2');
  const options = {
    kronosDir: path.join(tempRoot, 'project-monitor-owner'),
    now: new Date('2026-07-15T12:00:00.000Z'),
  };
  const newestSeed = {
    id: 'gitlab-merge-request-82',
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '82',
    projectId: 'team/application',
    url: 'https://gitlab.example/team/application/-/merge_requests/82',
    attachedAt: '2026-07-15T11:59:00.000Z',
  };
  const created = projectMonitoringStore.ensureProjectMonitoringRecord({
    name: 'Application',
    path: firstPath,
    displayName: 'Customer API',
    seedBindings: [newestSeed],
  }, options);
  assert.match(created.id, /^project-monitor-[a-f0-9]{48}$/);
  assert.equal(created.title, 'Customer API provider monitoring');
  assert.deepEqual(created.ticketKeys, []);
  assert.deepEqual(created.terminals, []);
  assert.equal(created.providerBindings[0].subjectId, '82');
  assert.equal(projectMonitoringStore.isProjectMonitoringRecord(created), true);
  assert.equal(projectMonitoringStore.isProjectMonitoringRecord({ id: created.id }), false);

  created.ticketKeys.push('MUTATED-1');
  created.providerBindings[0].subjectId = 'mutated';
  created.monitoring.enabled = false;
  const isolated = projectMonitoringStore.readProjectMonitoringRecord('Application', options);
  assert.deepEqual(isolated.ticketKeys, []);
  assert.equal(isolated.providerBindings[0].subjectId, '82');
  assert.equal(isolated.monitoring.enabled, true);

  const recordPath = projectMonitoringStore.projectMonitoringRecordPath(created.id, options);
  const closed = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  closed.status = 'closed';
  closed.closedAt = '2026-07-15T12:01:00.000Z';
  closed.monitoring.enabled = false;
  fs.writeFileSync(recordPath, `${JSON.stringify(closed, null, 2)}\n`, { mode: 0o600 });

  const refreshed = projectMonitoringStore.ensureProjectMonitoringRecord({
    name: 'Application',
    path: renamedPath,
    displayName: 'Customer API v2',
    seedBindings: [{
      ...newestSeed,
      id: 'gitlab-merge-request-stale',
      url: 'https://gitlab.example/team/application/-/merge_requests/82?stale=1',
      attachedAt: '2026-07-15T11:58:00.000Z',
    }],
  }, { ...options, now: new Date('2026-07-15T12:02:00.000Z') });
  assert.equal(refreshed.status, 'active');
  assert.equal(refreshed.closedAt, undefined);
  assert.equal(refreshed.monitoring.enabled, true);
  assert.equal(refreshed.title, 'Customer API v2 provider monitoring');
  assert.equal(refreshed.projectPath, renamedPath);
  assert.equal(refreshed.providerBindings[0].id, newestSeed.id, 'an older legacy seed must not replace current project state');
  assert.equal(refreshed.updatedAt, '2026-07-15T12:02:00.000Z');

  const rebound = projectMonitoringStore.ensureProjectMonitoringRecord({
    name: 'Application',
    path: renamedPath,
    displayName: 'Customer API v2',
    seedBindings: [{
      ...newestSeed,
      id: 'gitlab-merge-request-82-newer',
      url: 'https://gitlab.example/team/application/-/merge_requests/82?current=1',
      attachedAt: '2026-07-15T12:03:00.000Z',
    }],
  }, { ...options, now: new Date('2026-07-15T12:03:00.000Z') });
  assert.equal(rebound.providerBindings[0].id, 'gitlab-merge-request-82-newer');
  assert.equal(rebound.providerBindings[0].attachedAt, '2026-07-15T12:03:00.000Z');

  const withJenkins = projectMonitoringStore.addProjectMonitoringProviderBinding(rebound.id, {
    provider: 'jenkins',
    resource: 'build',
    subjectId: '41',
    projectId: 'https://jenkins.example/job/application',
    url: 'https://jenkins.example/job/application/41/',
  }, { ...options, now: new Date('2026-07-15T12:04:00.000Z') });
  assert.deepEqual(withJenkins.providerBindings.map(binding => binding.provider), ['gitlab', 'jenkins']);
  const healthy = projectMonitoringStore.recordProjectMonitoringResult(rebound.id, {
    polled: 2,
    transitions: 1,
    failures: 0,
    skipped: 0,
    summary: 'GitLab and Jenkins are healthy.',
  }, { ...options, now: new Date('2026-07-15T12:05:00.000Z') });
  assert.equal(healthy.monitoring.lastState, 'healthy');
  assert.equal(healthy.monitoring.lastSuccessfulAt, '2026-07-15T12:05:00.000Z');
  assert.equal(healthy.monitoring.lastSummary, 'GitLab and Jenkins are healthy.');
});

test('project monitoring state fails closed for missing owners, invalid identity, and invalid timestamps', () => {
  const options = { kronosDir: path.join(tempRoot, 'project-monitor-invalid') };
  assert.throws(() => projectMonitoringStore.projectMonitoringRecordId('  '), /requires a project name/i);
  assert.equal(projectMonitoringStore.readProjectMonitoringRecordById('session-not-a-project-owner', options), null);
  assert.throws(
    () => projectMonitoringStore.ensureProjectMonitoringRecord({ name: 'Invalid Time', path: tempRoot }, {
      ...options,
      now: new Date('invalid'),
    }),
    /timestamp is invalid/i,
  );
  assert.throws(
    () => projectMonitoringStore.addProjectMonitoringProviderBinding(
      projectMonitoringStore.projectMonitoringRecordId('Missing'),
      { provider: 'gitlab', resource: 'merge-request', subjectId: '1' },
      options,
    ),
    /record not found/i,
  );

  const created = projectMonitoringStore.ensureProjectMonitoringRecord({
    name: 'Corrupt Identity',
    path: tempRoot,
  }, options);
  const recordPath = projectMonitoringStore.projectMonitoringRecordPath(created.id, options);
  const serialized = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  serialized.projectName = 'Different Project';
  fs.writeFileSync(recordPath, `${JSON.stringify(serialized, null, 2)}\n`, { mode: 0o600 });
  assert.throws(
    () => projectMonitoringStore.readProjectMonitoringRecord('Corrupt Identity', options),
    /invalid owner identity/i,
  );
});

test('disposing the monitor releases its lease and prevents late provider state writes', async () => {
  const state = stateStore.emptyWorkCatalog();
  state.projects.Application = {
    path: tempRoot,
    config: { gitlab_project_path: 'team/application' },
  };
  state.tickets['JIRA-601'] = {
    summary: 'Dispose monitor fixture',
    type: 'Story',
    priority: 'High',
    jira_status: 'Open',
    source: 'jira',
    linked_local_project: 'Application',
    build: null,
  };
  let session = workSessions.createOrGetWorkSessionByTicket({
    ticketKey: 'JIRA-601',
    title: 'Dispose monitor fixture',
    projectName: 'Application',
    projectPath: tempRoot,
  });
  session = workSessions.addWorkSessionProviderBinding(session.id, {
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '601',
    projectId: 'team/application',
    url: 'https://gitlab.example/team/application/-/merge_requests/601',
  });

  const originalMonitor = gitLabRestModule.gitlabRestClient.mergeRequestMonitor;
  let rejectRead;
  let readStarted = false;
  gitLabRestModule.gitlabRestClient.mergeRequestMonitor = () => {
    readStarted = true;
    return new Promise((resolve, reject) => { rejectRead = reject; });
  };
  const monitor = new ManagedProviderMonitor({ state: () => state });
  try {
    const polling = monitor.poll();
    for (let index = 0; index < 20 && !readStarted; index += 1) { await Promise.resolve(); }
    assert.equal(readStarted, true);
    const leasePath = managedMonitorLease.managedMonitorLeasePath();
    assert.equal(fs.existsSync(leasePath), true);
    monitor.dispose();
    assert.equal(fs.existsSync(leasePath), false, 'runtime shutdown must release the lease immediately');
    rejectRead(new Error('Deferred read ended after disposal.'));
    const result = await polling;
    assert.equal(result.leaseUnavailable, true);
    assert.equal(result.leaseReason, 'renewal-failed');
    assert.equal(gitLabMonitorStore.readGitLabMergeRequestReadStatus(session.id), null);
    assert.deepEqual(await monitor.poll(), {
      polled: 0,
      transitions: 0,
      failures: 0,
      skipped: 0,
      unconfigured: 0,
      leaseUnavailable: false,
    });
  } finally {
    gitLabRestModule.gitlabRestClient.mergeRequestMonitor = originalMonitor;
    monitor.dispose();
  }

  const extensionSource = fs.readFileSync(path.join(root, 'src/terminalFirstExtension.ts'), 'utf8');
  assert.match(extensionSource, /dispose\(\): void \{[^]*this\.monitor\.dispose\(\);/);
});

function writeLeaseFixture(kronosDir, content) {
  const leasePath = managedMonitorLease.managedMonitorLeasePath({ kronosDir });
  fs.mkdirSync(path.dirname(leasePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(leasePath, content, { mode: 0o600 });
  if (process.platform !== 'win32') {
    fs.chmodSync(kronosDir, 0o700);
    fs.chmodSync(path.dirname(leasePath), 0o700);
    fs.chmodSync(leasePath, 0o600);
  }
  return leasePath;
}

let leaseWorkerRequestId = 0;

function startLeaseWorker() {
  const worker = fork(path.join(__dirname, 'managed-monitor-lease-worker.js'), [], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  worker.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-2_000); });
  worker.kronosStderr = () => stderr;
  return worker;
}

function leaseWorkerRequest(worker, input, timeoutMs = 5_000) {
  const requestId = ++leaseWorkerRequestId;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      worker.off('message', onMessage);
      worker.off('exit', onExit);
      worker.off('error', onError);
    };
    const onMessage = message => {
      if (!message || message.requestId !== requestId) { return; }
      cleanup();
      if (message.error) {
        reject(new Error(`Lease worker rejected ${input.command}: ${message.error}`));
        return;
      }
      resolve(message);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(
        `Lease worker exited before ${input.command} completed (code ${code}, signal ${signal || 'none'}). ${worker.kronosStderr()}`.trim(),
      ));
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Lease worker timed out during ${input.command}. ${worker.kronosStderr()}`.trim()));
    }, timeoutMs);
    worker.on('message', onMessage);
    worker.once('exit', onExit);
    worker.once('error', onError);
    worker.send({ requestId, ...input }, error => {
      if (!error) { return; }
      cleanup();
      reject(error);
    });
  });
}

async function stopLeaseWorker(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null) { return; }
  try { await leaseWorkerRequest(worker, { command: 'shutdown' }, 1_000); } catch { /* cleanup below */ }
  if (worker.connected) { worker.disconnect(); }
  if (worker.exitCode !== null || worker.signalCode !== null) { return; }
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      worker.kill();
      resolve();
    }, 1_000);
    worker.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
