# Kronos Intent And Enhancement Plan

## Product Intent

Kronos is a VS Code operator cockpit for Claude Code driven SDLC work across enterprise projects. The extension should help an operator decide what needs attention, launch or supervise agent work, preserve ticket-centered evidence, and recover safely when automation stalls.

The important distinction is that Kronos is not meant to be a generic command launcher. A good Kronos workflow explains:

- what should happen next;
- why that action is recommended;
- what systems or files may change;
- what evidence proves the work is ready;
- what a human must inspect before publish, cleanup, deploy, or overnight work.

## Current Shape

The current implementation already has the main cockpit primitives:

- six activity-bar tree views for projects, tickets, queue, review, sessions, and ad-hoc tasks;
- dashboard, Jira board, ticket detail, run center, recovery center, evidence, planning, metrics, doctor, integration, profile, and prompt panels;
- Spec Beanstalk workflow for `.xlsx` API spec ingestion, generated Markdown/JSON trace artifacts, and Claude continuation runs in Java repos;
- ticket-centered state under `~/.claude/kronos/state.json` with evidence, linked MRs, builds, projects, and actions;
- manual queue state under `~/.claude/kronos/queue.json`;
- prompt governance and run records under `~/.claude/kronos/runs`, `sessions`, `stats`, and `prompts`;
- state validation, backups, write locks, audit events, stale-run repair, safe worktree tracking, and recovery inventory;
- regression coverage through `npm test` and feedback packaging through `npm run feedback:ready`.

## Enhancement Standard

"Serious" enhancements should move Kronos toward trusted operations, not just more buttons. New work should usually improve one of these outcomes:

- faster operator orientation: the dashboard and panels make the next decision obvious;
- stronger safety: destructive, branch-mutating, repo-writing, and external-publish actions preview their effects and require clear confirmation;
- better evidence: tickets carry acceptance criteria, checks, environment results, build/MR status, run completion data, and manual notes in one ledger;
- better recovery: failed, stale, paused, orphaned, dirty, or ambiguous work surfaces in a single reviewable path;
- realistic feedback: reviewers can exercise the cockpit against safe state without touching real Jira, GitLab, Jenkins, Sonar, or production worktrees;
- executable validation: important operator flows have automated or scripted smoke coverage beyond static source checks.
- traceable spec-to-code execution: source workbook cells, generated Markdown, Java changes, tests, and assumptions stay linked.

## Next Enhancement Tracks

1. Feedback-state onboarding

   Status: implemented for local dev-host review. `npm run feedback:state` creates isolated synthetic state in `.claude/kronos-feedback-state`, including safe fixture tickets, queue items, a sandbox project path, and a needs-human run record. The `Run Kronos Extension (Feedback State)` launch configuration resets that fixture before launch and points the extension host at it through `KRONOS_DIR`.

   Next: use the fixture as the default substrate for extension-host smoke testing and first human-feedback sessions.

2. Extension-host smoke testing

   Status: automated host smoke implemented and strengthened. `npm run feedback:smoke` prepares the safe fixture, compiles the extension, and runs the main cockpit commands inside a VS Code Extension Development Host through `@vscode/test-electron`. It verifies command registration, webview creation, rendered fixture content, and key action wiring for Dashboard, Jira Board, Ticket Detail, Evidence Gate, Evidence Handoff, Run Center, Recovery Center, Human Review Inbox, Doctor, Prompt Manager, Queue Planner, and Backlog Triage. `npm run webview:dom` covers the packaged Jira Board and action-panel browser scripts for board filtering, ticket modal actions, comments, duplicate handler protection, and posted action payloads.

   Next: expand DOM-level coverage to Recovery Center button routing when a stable browser/webview automation path can exercise recovery-specific action payloads.

3. Crash and stale-run reconciliation

   Status: run store repair covers terminal metadata, dead process records, stale processless running/preflight records, and log-derived outcomes. Recovery Center now also surfaces stale paused runs as operator-review warnings instead of leaving them hidden behind active-run counters. The safe feedback fixture includes both a needs-human run and a stale paused run so the extension-host smoke path exercises these recovery states.

   Next: add interruption tests for extension-host reload, killed child process, Windows process-tree edge cases, and failed post-completion callbacks. The goal is for Run Center and Recovery Center to show exactly what happened and what is safe to do next.

4. Provider contract hardening

   Jira, GitLab, Jenkins, Sonar, GCloud, Claude CLI, script bundles, and prompt packs should keep reporting missing or malformed dependencies through Doctor and Integration Manifest. The next pass should add provider contract fixtures and repair guidance without embedding credentials or enterprise details.

5. Spec Beanstalk traceability

   Status: initial workflow implemented. Kronos can generate `.xlsx` API workbook artifacts into a Java repo with a packaged Python standard-library analyzer, preserving cells, formulas, fills, font emphasis, comments, merges, hidden rows/columns, and validations. The Spec Beanstalk panel exposes separate generate-only and start/continue actions, and Claude runs are prompted to cite Markdown sections plus original Excel sheet/cell/range evidence.

   Next: exercise this against a real enterprise API workbook and refine how generated sheets collapse noise while preserving intuitive formatting details.

6. Planning quality

   Planning is intentionally heuristic and explainable today. Improve scoring only when backed by real signals: stale age, dependency collisions, open MR state, build/Sonar status, blocked tickets, evidence gaps, queue conflicts, and release grouping.

7. Entry-point decomposition

   `src/extension.ts` is still the central command coordinator. Keep user behavior stable while extracting command groups into smaller modules only where it reduces risk: evidence commands, run commands, planning panels, provider panels, and project setup actions are natural boundaries.

## Immediate Working Rule

Before adding a new surface, ask whether the same value should instead be added to Dashboard, Human Review Inbox, Run Center, Recovery Center, Evidence Gate, Doctor, or Ticket Detail. Kronos improves most when existing operator surfaces become more decisive and trustworthy.
