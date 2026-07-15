const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const kronosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-provider-health-'));
process.env.KRONOS_DIR = kronosDir;

const {
  projectProviderMonitoringHealth,
  providerMonitoringHealthSummary,
  sessionProviderMonitoringHealth,
} = require('../out/services/providerMonitoringHealth.js');
const {
  createOrGetWorkSessionByTicket,
  readWorkSession,
  recordWorkSessionMonitoringResult,
} = require('../out/services/workSessionStore.js');

test.after(() => fs.rmSync(kronosDir, { recursive: true, force: true }));

test('session provider health derives the next poll and legacy successful-poll fallback', () => {
  const health = sessionProviderMonitoringHealth(session({
    lastAttemptAt: '2026-07-14T12:00:00.000Z',
    lastPolledAt: '2026-07-14T12:00:00.000Z',
    lastFailureCount: 0,
    lastState: 'healthy',
    suppressedUnchangedCount: 4,
  }), 300_000);
  assert.equal(health.lastSuccessfulAt, '2026-07-14T12:00:00.000Z');
  assert.equal(health.nextScheduledAt, '2026-07-14T12:05:00.000Z');
  assert.equal(health.suppressedUnchangedCount, 4);
  assert.equal(providerMonitoringHealthSummary(health), 'poll healthy • quiet 4');
});

test('project provider health aggregates latest evidence and earliest scheduled poll', () => {
  const health = projectProviderMonitoringHealth([
    session({
      lastAttemptAt: '2026-07-14T12:00:00.000Z',
      lastSuccessfulAt: '2026-07-14T11:55:00.000Z',
      lastMeaningfulChangeAt: '2026-07-14T11:50:00.000Z',
      lastState: 'healthy',
      suppressedUnchangedCount: 3,
    }),
    session({
      lastAttemptAt: '2026-07-14T12:01:00.000Z',
      lastSuccessfulAt: '2026-07-14T12:01:00.000Z',
      lastMeaningfulChangeAt: '2026-07-14T11:59:00.000Z',
      lastState: 'partial',
      currentError: 'provider_evidence_partial',
      suppressedUnchangedCount: 2,
    }),
  ], 300_000);
  assert.equal(health.state, 'partial');
  assert.equal(health.lastSuccessfulAt, '2026-07-14T12:01:00.000Z');
  assert.equal(health.lastMeaningfulChangeAt, '2026-07-14T11:59:00.000Z');
  assert.equal(health.nextScheduledAt, '2026-07-14T12:05:00.000Z');
  assert.equal(health.currentError, 'provider_evidence_partial');
  assert.equal(health.suppressedUnchangedCount, 5);
});

test('monitoring results persist success, meaningful change, and quiet suppression separately', () => {
  const created = createOrGetWorkSessionByTicket({ ticketKey: 'HEALTH-1', title: 'Health fixture' });
  recordWorkSessionMonitoringResult(created.id, {
    polled: 3,
    transitions: 1,
    failures: 0,
    skipped: 0,
    attemptedAt: '2026-07-14T12:00:00.000Z',
  });
  let stored = readWorkSession(created.id);
  assert.equal(stored.monitoring.lastSuccessfulAt, '2026-07-14T12:00:00.000Z');
  assert.equal(stored.monitoring.lastMeaningfulChangeAt, '2026-07-14T12:00:00.000Z');
  assert.equal(stored.monitoring.suppressedUnchangedCount, 0);

  recordWorkSessionMonitoringResult(created.id, {
    polled: 3,
    transitions: 0,
    failures: 0,
    skipped: 0,
    attemptedAt: '2026-07-14T12:05:00.000Z',
  });
  stored = readWorkSession(created.id);
  assert.equal(stored.monitoring.lastSuccessfulAt, '2026-07-14T12:05:00.000Z');
  assert.equal(stored.monitoring.lastMeaningfulChangeAt, '2026-07-14T12:00:00.000Z');
  assert.equal(stored.monitoring.suppressedUnchangedCount, 1);
  assert.equal(stored.monitoring.currentError, undefined);
});

test('current normalized provider error clears only after a non-failing result', () => {
  const created = createOrGetWorkSessionByTicket({ ticketKey: 'HEALTH-2', title: 'Error fixture' });
  recordWorkSessionMonitoringResult(created.id, {
    polled: 0,
    transitions: 1,
    failures: 1,
    skipped: 0,
    attemptedAt: '2026-07-14T12:00:00.000Z',
  });
  assert.equal(readWorkSession(created.id).monitoring.currentError, 'provider_read_failed');
  recordWorkSessionMonitoringResult(created.id, {
    polled: 2,
    transitions: 1,
    failures: 0,
    skipped: 1,
    attemptedAt: '2026-07-14T12:05:00.000Z',
  });
  assert.equal(readWorkSession(created.id).monitoring.currentError, 'provider_evidence_partial');
  recordWorkSessionMonitoringResult(created.id, {
    polled: 3,
    transitions: 1,
    failures: 0,
    skipped: 0,
    attemptedAt: '2026-07-14T12:10:00.000Z',
  });
  assert.equal(readWorkSession(created.id).monitoring.currentError, undefined);
});

function session(monitoring) {
  return { status: 'active', monitoring: { enabled: true, ...monitoring } };
}
