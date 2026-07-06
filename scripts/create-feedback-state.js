const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const ROOT = process.cwd();
const DEFAULT_DIR = path.join(ROOT, '.claude', 'kronos-feedback-state');

function fail(message) {
  console.error(`Feedback state failed: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { targetDir: DEFAULT_DIR, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--dir') {
      const value = argv[index + 1];
      if (!value) { fail('--dir requires a path'); }
      options.targetDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    fail(`unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log([
    'Create an isolated Kronos feedback state directory.',
    '',
    'Usage:',
    '  node scripts/create-feedback-state.js [--dir <path>] [--force]',
    '',
    'The default target is .claude/kronos-feedback-state in this repo.',
    'Point the extension at it with KRONOS_DIR before launching VS Code.',
  ].join('\n'));
}

function ensureSafeTarget(targetDir) {
  const resolved = path.resolve(targetDir);
  const homeKronos = path.resolve(process.env.HOME || '', '.claude', 'kronos');
  if (resolved === homeKronos && !process.env.KRONOS_ALLOW_HOME_FEEDBACK_STATE) {
    fail('refusing to write directly to ~/.claude/kronos; choose --dir or set KRONOS_ALLOW_HOME_FEEDBACK_STATE=1');
  }
  return resolved;
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function shortHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function buildFixture(now, targetDir) {
  const sandboxProject = path.join(targetDir, 'sandbox-project');
  const runId = 'feedback-run-needs-human';
  const pausedRunId = 'feedback-run-paused-stale';
  const logPath = path.join(targetDir, 'runs', `${runId}.log`);
  const promptPath = path.join(targetDir, 'runs', `${runId}.prompt.txt`);
  const pausedLogPath = path.join(targetDir, 'runs', `${pausedRunId}.log`);
  const pausedPromptPath = path.join(targetDir, 'runs', `${pausedRunId}.prompt.txt`);
  const promptText = 'Fixture prompt for Kronos human feedback. Do not dispatch against production systems.\n';
  const pausedPromptText = 'Fixture prompt for a stale paused Kronos run. Continue only inside the feedback state.\n';
  const nowMs = new Date(now).getTime();
  const pausedStartedAt = new Date(nowMs - 4 * 60 * 60 * 1000).toISOString();
  const pausedAt = new Date(nowMs - 3 * 60 * 60 * 1000).toISOString();
  const state = {
    version: 3,
    last_updated: now,
    settings: {
      scan_dirs: [sandboxProject],
      jira_project_key: 'KRONOS',
      overnight: {
        enabled: false,
        max_concurrent: 1,
        max_open_mrs_per_project: 1,
        nightly_implement_cap: 1,
        vpn_check_host: '',
        vpn_check_port: 0,
        vpn_check_interval_sec: 60,
      },
    },
    projects: {
      'feedback-service': {
        path: sandboxProject,
        priority: 10,
        config: {
          repo_name: 'feedback-service',
          jira_project_key: 'KRONOS',
          jira_ticket_filter: 'project = KRONOS AND labels = kronos-feedback',
          gitlab_project_id: 1001,
          jenkins_url: 'https://example.invalid/jenkins/job/feedback-service',
          sonar_project_key: 'feedback-service',
          base_branch: 'develop',
        },
        health: 'yellow',
        summary: 'Synthetic project for safe Kronos cockpit review.',
        last_polled: now,
        open_mr_count: 2,
      },
    },
    tickets: {
      'KRONOS-FB-1': {
        summary: 'Review-ready fixture with evidence and a linked MR',
        type: 'Story',
        priority: 'High',
        jira_status: 'In Review',
        source: 'jira',
        updated: now,
        description: 'AC1: Dashboard shows next action.\nAC2: Evidence handoff is safe to paste.',
        labels: ['kronos-feedback', 'safe-fixture'],
        fixVersion: 'feedback-r1',
        jira_url: 'https://example.invalid/browse/KRONOS-FB-1',
        projects: ['feedback-service'],
        mr: {
          iid: 41,
          state: 'opened',
          review_status: 'pending_review',
          url: 'https://example.invalid/gitlab/feedback-service/-/merge_requests/41',
          title: 'Fixture review-ready change',
          source_branch: 'feature/kronos-fb-1',
          target_branch: 'develop',
          comment_count: 2,
          unresolved_discussion_count: 1,
        },
        build: {
          number: 142,
          status: 'SUCCESS',
          url: 'https://example.invalid/jenkins/job/feedback-service/142',
        },
        next_action: 'await_review',
        last_action: 'verify-local',
        last_action_at: now,
        evidence: {
          updated_at: now,
          notes: [
            { at: now, kind: 'decision', text: 'Fixture ticket is safe for evidence mutation during human feedback.' },
            { at: now, kind: 'test', text: 'Synthetic local verification passed.' },
          ],
          acceptance_criteria: [
            { id: 'ac-1', text: 'Dashboard shows next action.', checked: true, source: 'description' },
            { id: 'ac-2', text: 'Evidence handoff is safe to paste.', checked: true, source: 'description' },
          ],
          checks: [
            {
              id: 'check-feedback-local',
              at: now,
              name: 'Synthetic local smoke',
              result: 'pass',
              command: 'npm test',
              environment: 'feedback-fixture',
              confidence: 'high',
              summary: 'Fixture check only; no external provider was contacted.',
            },
          ],
          environment_results: {
            local: {
              environment: 'local',
              status: 'pass',
              checked_at: now,
              detail: 'Synthetic local feedback state loaded.',
            },
          },
        },
      },
      'KRONOS-FB-2': {
        summary: 'Failed build fixture that should draw operator attention',
        type: 'Bug',
        priority: 'Critical',
        jira_status: 'In Progress',
        source: 'jira',
        updated: now,
        description: 'AC1: Failed build is visible before retry.',
        labels: ['kronos-feedback', 'needs-attention'],
        jira_url: 'https://example.invalid/browse/KRONOS-FB-2',
        projects: ['feedback-service'],
        mr: {
          iid: 42,
          state: 'opened',
          review_status: 'changes_requested',
          url: 'https://example.invalid/gitlab/feedback-service/-/merge_requests/42',
          title: 'Fixture failed-build change',
          source_branch: 'feature/kronos-fb-2',
          target_branch: 'develop',
        },
        build: {
          number: 143,
          status: 'FAILURE',
          url: 'https://example.invalid/jenkins/job/feedback-service/143',
        },
        next_action: 'fix_build',
        last_action: 'implement',
        last_action_at: now,
        evidence: {
          updated_at: now,
          notes: [
            { at: now, kind: 'risk', text: 'Fixture failure should stay inside the sandbox feedback state.' },
          ],
          checks: [
            {
              id: 'check-feedback-build',
              at: now,
              name: 'Synthetic Jenkins build',
              result: 'fail',
              command: 'fixture-build',
              environment: 'feedback-fixture',
              confidence: 'high',
              summary: 'Intentional fixture failure for Recovery and Human Review surfaces.',
            },
          ],
        },
      },
      'KRONOS-FB-3': {
        summary: 'Unlinked backlog fixture for triage and planning panels',
        type: 'Task',
        priority: 'Medium',
        jira_status: 'Open',
        source: 'jira',
        updated: now,
        description: 'AC1: Unlinked ticket is easy to spot.',
        labels: ['kronos-feedback', 'triage'],
        jira_url: 'https://example.invalid/browse/KRONOS-FB-3',
        projects: [],
        mr: null,
        build: null,
        next_action: 'implement',
        last_action: null,
        last_action_at: null,
      },
    },
    adhoc_tasks: {
      'feedback-task-1': {
        title: 'Capture first unclear Kronos panel',
        description: 'Use this synthetic task during the 20-30 minute feedback pass.',
        status: 'todo',
        projects: ['feedback-service'],
        created_at: now,
      },
    },
    overnight: {
      enabled: false,
      last_run: null,
    },
    discovered_projects: [
      {
        path: sandboxProject,
        repo_name: 'feedback-service',
        has_project_json: false,
        git_remote: null,
        pom_artifact_id: null,
        suggested_jira_key: 'KRONOS',
      },
    ],
  };

  const queue = {
    items: [
      {
        id: 'feedback-queue-1',
        ticket: 'KRONOS-FB-2',
        ticket_summary: state.tickets['KRONOS-FB-2'].summary,
        projects: ['feedback-service'],
        project_path: sandboxProject,
        action: 'fix_build',
        priority_score: 95,
        reason: 'Intentional fixture failed build should be first.',
      },
      {
        id: 'feedback-queue-2',
        ticket: 'KRONOS-FB-1',
        ticket_summary: state.tickets['KRONOS-FB-1'].summary,
        projects: ['feedback-service'],
        project_path: sandboxProject,
        action: 'await_review',
        priority_score: 70,
        reason: 'Fixture review handoff should exercise evidence panels.',
      },
    ],
    last_computed: now,
    decisions: {},
  };

  const run = {
    id: runId,
    project: 'feedback-service',
    projectPath: sandboxProject,
    skill: 'verify',
    ticket: 'KRONOS-FB-1',
    status: 'needs_human',
    model: 'fixture',
    promptHash: shortHash(promptText),
    promptPreview: 'Fixture prompt for Kronos human feedback.',
    startedAt: now,
    endedAt: now,
    exitCode: 1,
    cwd: sandboxProject,
    logPath,
    promptPath,
    failureReason: 'Synthetic run requires human review so Recovery Center has a safe item.',
    failureKind: 'unknown',
    events: [
      { type: 'system', label: 'Fixture run created', detail: 'Safe synthetic run for feedback surfaces.', timestamp: now },
      { type: 'error', label: 'Needs human review', detail: 'Synthetic attention item.', timestamp: now },
    ],
  };

  const pausedRun = {
    id: pausedRunId,
    project: 'feedback-service',
    projectPath: sandboxProject,
    skill: 'implement',
    ticket: 'KRONOS-FB-2',
    status: 'paused',
    model: 'fixture',
    promptHash: shortHash(pausedPromptText),
    promptPreview: 'Fixture prompt for a stale paused Kronos run.',
    startedAt: pausedStartedAt,
    pausedAt,
    cwd: sandboxProject,
    logPath: pausedLogPath,
    promptPath: pausedPromptPath,
    events: [
      { type: 'system', label: 'Fixture paused run created', detail: 'Safe synthetic paused run for recovery review.', timestamp: pausedStartedAt },
      { type: 'recovery', label: 'Run paused', detail: 'Synthetic pause older than the Recovery Center threshold.', timestamp: pausedAt },
    ],
  };

  return {
    sandboxProject,
    state,
    queue,
    run,
    pausedRun,
    promptText,
    pausedPromptText,
    logText: 'Synthetic Kronos feedback run log.\nNo external systems were contacted.\n',
    pausedLogText: 'Synthetic paused Kronos feedback run log.\nNo external systems were contacted.\n',
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetDir = ensureSafeTarget(options.targetDir);
  const stateFile = path.join(targetDir, 'state.json');
  const queueFile = path.join(targetDir, 'queue.json');
  if (!options.force && (fs.existsSync(stateFile) || fs.existsSync(queueFile))) {
    fail(`${targetDir} already contains state files; rerun with --force to replace fixture data`);
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  const now = new Date().toISOString();
  const fixture = buildFixture(now, targetDir);
  fs.mkdirSync(fixture.sandboxProject, { recursive: true });
  writeText(path.join(fixture.sandboxProject, 'README.md'), [
    '# Kronos Feedback Sandbox',
    '',
    'This directory is generated by scripts/create-feedback-state.js.',
    'It exists only so Kronos panels have a safe local project path during feedback.',
    '',
  ].join('\n'));
  writeJson(stateFile, fixture.state);
  writeJson(queueFile, fixture.queue);
  writeJson(path.join(targetDir, 'runs', `${fixture.run.id}.json`), fixture.run);
  writeJson(path.join(targetDir, 'runs', `${fixture.pausedRun.id}.json`), fixture.pausedRun);
  writeText(fixture.run.promptPath, fixture.promptText);
  writeText(fixture.run.logPath, fixture.logText);
  writeText(fixture.pausedRun.promptPath, fixture.pausedPromptText);
  writeText(fixture.pausedRun.logPath, fixture.pausedLogText);

  console.log('Kronos feedback state created.');
  console.log(`- KRONOS_DIR: ${targetDir}`);
  console.log('- Tickets: KRONOS-FB-1, KRONOS-FB-2, KRONOS-FB-3');
  console.log('- Launch dev host with this environment variable before opening Kronos panels.');
}

main();
