# Kronos Good-to-Great Review

## Executive take

Kronos has a strong idea: turn VS Code into an SDLC control tower for Jira tickets, GitLab merge requests, Jenkins builds, SonarQube issues, and Claude Code agent sessions. The extension already connects the main workflow surfaces: projects, tickets, queue, reviews, sessions, ad-hoc tasks, dashboards, local verification, Sonar flows, and multi-project implementation.

What keeps it at "good" is that it behaves more like a command launcher over state files and prompt templates than a reliable orchestration product. To become great, it needs first-class safety, explicit decisioning, structured evidence, stronger integration contracts, and operator-grade observability.

The most important shift: move from "run an agent on this thing" to "plan, dispatch, supervise, prove, and recover work with traceable evidence."

## What is already good

- Clear workflow coverage: tickets move from implementation to build, review, verification, deploy monitoring, and follow-up fixes.
- Useful SDLC aggregation: Jira, GitLab, Jenkins, SonarQube, and local agent sessions are surfaced in one VS Code activity bar.
- Parallel work concept: worktree-backed sessions can run multiple tickets or branches.
- Prompt externalization: prompt templates in `~/.claude/kronos/prompts` allow behavior tuning without rebuilding the extension.
- Human-in-the-loop controls: most meaningful actions are command-driven rather than fully autonomous.
- Session history and stats exist, even if they are still shallow.

## Core gaps developers missed

### 1. Agent lifecycle is not a real product surface yet

Evidence in code:
- `dispatchClaudeSession()` opens a progress webview, starts Claude, parses stream-json, and saves a compact session record.
- Session status in the tree is only `path + pid + status`.
- Closing a panel kills the shell process but does not robustly manage the full process tree.

What is missing:
- A persistent run record before launch, with stable run id, status, branch/worktree, prompt version, model, permissions, start/end time, exit reason, and recovery action.
- Pause, cancel, retry, resume, and "open logs" controls.
- Full transcript/log retention, not just summarized UI events.
- Run-level failure classification: auth, model, script, git, build, test, Sonar, timeout, user cancel.
- A clear distinction between "agent succeeded" and "work is actually ready."

Good-to-great addition:
- Build a Run Center view. Every dispatch becomes a `KronosRun` object with lifecycle states: `queued`, `preflight`, `running`, `waiting_for_review`, `failed`, `completed`, `needs_human`, `cancelled`.
- Persist runs in `~/.claude/kronos/runs/*.json` with raw logs and normalized events.
- Add actions: retry from last safe step, cancel full process tree, archive, open worktree, open diff, mark needs-human.

### 2. Safety and reversibility need to be designed in

Evidence in code:
- Worktree cleanup can run on extension activation.
- Cleanup ignores untracked files and can force-remove worktrees.
- Several commands mutate state or repository state through shell strings.
- Dispatch may check out `develop` in the user's main worktree to free feature branches.

What is missing:
- Preflight checks before any destructive or branch-mutating operation.
- A visible "what will change" confirmation for high-risk actions.
- No dry-run path for cleanup.
- No quarantine for uncertain worktrees.
- No rollback story for state file edits.

Good-to-great addition:
- Add a Safety Gate service used by all commands.
- Classify commands by risk: read-only, state-write, repo-write, branch-switch, destructive, external-publish.
- Require preflight and explicit confirmation for destructive and branch-switch actions.
- Replace auto cleanup with "stale worktrees found" notifications and a review panel.
- Snapshot `state.json` and `queue.json` before writes, with a small restore UI.

### 3. Queueing is manual, thin, and under-explained

Evidence in code:
- Queue state has `priority_score` and `reason`, but queue computation is not really a first-class command.
- Empty queue points to `kronos.computeQueue`, which is not registered.
- Queue items can be moved up/down/pinned, but there is no decision model visible to the user.

What is missing:
- "Why this next?" explanations that combine Jira priority, blocked status, MR state, build status, project health, age, and dependencies.
- A backlog triage mode.
- SLA/aging logic.
- Batch planning by project or release.
- Queue conflict detection: same project, same branch, same files, same service area.

Good-to-great addition:
- Add a Queue Planner view with ranked recommendations and a visible scoring breakdown.
- Include action suggestions: implement, verify local, fix build, review MR, run Sonar, deploy monitor.
- Let users accept, reject, snooze, or pin recommendations.
- Add "plan my next 2 hours" and "overnight candidate review" modes.

### 4. Evidence is not a first-class concept

Evidence in code:
- Verification commands dispatch prompts, but proof is mostly in session output.
- Stats track tool counts and file counts, not quality evidence.
- Ticket detail shows Jira/MR/build links, but not proof of acceptance criteria.

What is missing:
- Evidence ledger per ticket: tests run, build ids, Sonar gate, screenshots, logs, endpoint checks, local-vs-test comparison, manual notes.
- Acceptance criteria extraction and checklist tracking.
- "Ready for review" gates that require evidence.
- A way to attach evidence back to Jira or MR comments.

Good-to-great addition:
- Add `evidence` to ticket state:
  - `acceptance_criteria[]`
  - `checks[]` with command, result, timestamp, artifact path, and confidence
  - `environment_results` for local, develop, test
  - `risk_notes[]`
- Add an Evidence tab in ticket detail and review views.
- Require evidence before queue removal or marking done.

### 5. Integrations are hidden script dependencies

Evidence in code:
- Extension calls scripts under `~/.claude/scripts` (`kronos_state.py`, `pipeline_monitor.py`, `gitlab_api.py`).
- The package does not include those scripts or prompt templates.
- Errors are often swallowed and shown as generic failures.

What is missing:
- Version checks for scripts and prompt packs.
- Typed API contracts between extension and scripts.
- A health dashboard for Jira, GitLab, Jenkins, SonarQube, GCP auth, Claude CLI, model access, and local project config.
- Install/repair path for missing scripts/prompts.

Good-to-great addition:
- Add `kronos doctor` inside the extension:
  - expected files present
  - script versions
  - credentials present but not printed
  - network/API reachability
  - project config completeness
  - compatible Claude CLI version
- Move script invocation to a typed service layer with schemas and precise errors.
- Keep a manifest file for the external script bundle, e.g. `~/.claude/kronos/manifest.json`.

### 6. The UI is a set of lists, not yet an operator cockpit

Evidence in code:
- Six tree views exist: Projects, Tickets, Queue, Review, Sessions, Tasks.
- Dashboard is simple cards plus morning brief.
- Jira board is useful but implemented as static HTML strings with inline handlers.

What is missing:
- Search, filters, grouping, and saved views.
- Cross-view context: project -> tickets -> MRs -> runs -> evidence.
- Clear "now / next / blocked / needs human" workspace.
- Rich session inspection with command output, artifacts, and recovery actions.
- Accessibility and webview security posture.

Good-to-great addition:
- Make the Dashboard the daily command center:
  - Needs human
  - Next best action
  - Active runs
  - Failing gates
  - Recently completed with evidence
  - Stale MRs and aging tickets
- Add filters to Tickets and Review: project, status, priority, label, MR state, build state, stale age.
- Add a ticket side panel with timeline, evidence, commands, linked projects, runs, and risk.

### 7. Prompt governance is missing

Evidence in code:
- Prompts are loaded from `~/.claude/kronos/prompts`.
- Dispatch stores the rendered prompt only indirectly in session result, not as versioned run metadata.

What is missing:
- Prompt versioning.
- Prompt diff history.
- Prompt test cases.
- Per-project prompt overrides with provenance.
- Visibility into which prompt produced which run.

Good-to-great addition:
- Add a Prompt Manager:
  - list prompt templates
  - validate required variables
  - show last modified/version hash
  - attach prompt hash to every run
  - run prompt smoke tests against fixture tickets

### 8. State is too trusting and too loosely typed

Evidence in code:
- State files are parsed with `JSON.parse`.
- TypeScript interfaces describe expected shape, but runtime validation is absent.
- Direct state writes happen in extension code for queue and MR linking.

What is missing:
- Runtime schema validation.
- Migrations between state versions.
- Atomic writes.
- File-locking or concurrent write protection.
- Audit log of state changes.

Good-to-great addition:
- Introduce a state service:
  - validates with schemas before accepting state
  - writes atomically to temp file then rename
  - maintains `state.audit.jsonl`
  - exposes typed methods instead of ad hoc file writes
  - rejects unknown or malformed action states

### 9. No testing strategy exists

Evidence in repo:
- Package scripts only include compile, watch, and package.
- No test command, fixture states, or VS Code extension tests.

What is missing:
- Unit tests for state loading, queue manipulation, action mapping, and prompt variable expansion.
- Fixtures for `state.json`, `queue.json`, and script outputs.
- Webview rendering tests for escaping and message handling.
- Integration tests with fake script adapters.
- Regression tests for command registration vs manifest.

Good-to-great addition:
- Add a small test harness first:
  - `npm test`
  - fixtures under `test/fixtures`
  - command manifest parity test
  - queue reorder tests
  - webview escaping tests
  - script adapter contract tests

### 10. Configuration is too environment-specific

Evidence in docs:
- The documented environment assumes Windows 11, Git Bash, GCP Vertex, BCBSMA-like Jira/GitLab/Sonar/Jenkins shape.
- Code uses hardcoded defaults like `origin/develop`, `develop`, and specific model names.

What is missing:
- First-class provider abstraction.
- Multi-user setup.
- Workspace-local config vs global config separation.
- Enterprise profile import/export.
- Clear minimum setup path for a new user.

Good-to-great addition:
- Add profiles:
  - `personal-local`
  - `enterprise-gitlab-jira`
  - `github-actions`
  - `no-sonar`
- Store workspace-safe config in `.vscode/settings.json` or project `.claude/project.json`, and user secrets in secure storage.
- Make branch names, providers, and action workflows configurable.

## Product features that would most improve daily usefulness

1. Next Best Action

Show one prioritized recommendation with the reason, risk, required preflight, and exact command that will run.

2. Ticket Timeline

For every ticket, show chronological events: Jira refresh, linked projects, queue changes, runs, branch/MR creation, builds, Sonar scans, verification evidence, human decisions.

3. Evidence Gate

Before sending to review or removing from queue, require evidence matching the ticket type: build result, test result, local verification, Sonar status, MR link.

4. Recovery Center

Show failed/abandoned runs, dirty worktrees, orphan branches, stale MRs, and broken integrations. Offer safe repair actions.

5. Dependency and Collision Detection

Warn before starting parallel work that touches the same project, branch, ticket area, or likely files. Use MR diffs and recent session file edits.

6. Human Review Inbox

Aggregate "needs user decision" items: ambiguous Jira ticket, missing project link, auth expired, failing preflight, stale branch, dangerous cleanup, conflicting MRs.

7. Prompt and Policy Studio

Let the user tune the rules agents follow, validate prompts, and see which prompt version was used for each run.

8. Agent Quality Score

Track not just success/failure, but whether runs produced merged code, clean builds, passed verification, low rework, and low manual intervention.

## Architecture changes that would unlock quality

### Split the extension into services

Current `src/extension.ts` is doing command registration, workflow logic, state mutation, webview construction, and integration calls. Split into:

- `commands/` command handlers
- `services/stateStore.ts`
- `services/scriptClient.ts`
- `services/runManager.ts`
- `services/worktreeManager.ts`
- `services/safetyGate.ts`
- `services/evidenceStore.ts`
- `webviews/` builders or controllers
- `views/` tree providers

### Use adapters for external systems

Do not let UI commands know script flags. Define typed methods:

- `jira.listTickets()`
- `gitlab.getMergeRequest()`
- `jenkins.getBuild()`
- `sonar.getIssues()`
- `kronosQueue.add(ticketKey)`
- `kronosQueue.next()`

The current scripts can remain behind the adapter initially.

### Make run orchestration stateful

`dispatchClaudeSession()` should become a run manager that:

- creates a run record
- performs preflight
- prepares workspace
- launches process
- streams events
- records artifacts
- applies post-run gates
- cleans up only when safe
- surfaces recovery actions

### Treat webviews as untrusted surfaces

Build all webviews with:

- nonce-based CSP
- no inline event handlers
- no raw URLs
- DOM rendering from serialized data
- strict message validation
- centralized `escapeHtml` and `safeUri`

## Suggested roadmap

### Phase 0: Stop the risky edges

- Remove automatic forced worktree cleanup on activation.
- Replace shell string execution with argv-based `spawn`/`execFile`.
- Fix webview escaping and add CSP.
- Fix `verifyFix` project resolution.
- Fix the nonexistent `kronos.computeQueue` command.
- Normalize line endings and remove bundled `node_modules` from archives.

### Phase 1: Make operations reliable

- Add `Kronos Doctor`.
- Add runtime state schema validation.
- Add atomic state writes and state audit log.
- Add command manifest parity and queue tests.
- Add script adapter layer with typed results.

### Phase 2: Make orchestration visible

- Add Run Center.
- Store full run records with prompt hash, model, branch, worktree, evidence, and raw logs.
- Add cancel/retry/resume/open-worktree/open-log actions.
- Add Recovery Center for failed runs, dirty worktrees, and orphan MRs.

### Phase 3: Make planning intelligent

- Add Queue Planner with scoring breakdown.
- Add Next Best Action.
- Add collision detection for parallel work.
- Add stale ticket/MR/build aging.
- Add human review inbox.

### Phase 4: Make quality provable

- Add evidence ledger per ticket.
- Add acceptance criteria extraction and checklists.
- Add quality gates before queue removal or review handoff.
- Add Jira/MR evidence posting.
- Add trend metrics: rework rate, build pass rate, verification pass rate, average cycle time.

## The "great" version in one sentence

Kronos becomes great when it is not merely a VS Code launcher for Claude sessions, but a safe, explainable SDLC operations console that can plan the next action, supervise agent work, preserve evidence, prevent destructive mistakes, and recover gracefully when the automation gets stuck.
