# Kronos Terminal-First Product Contract

Status: normative contract for the terminal-first evaluation build.

## Product Statement

Kronos is a VS Code work companion for an interactive terminal session that the operator already owns. It organizes Jira work, prepares bounded provider context, monitors merge-request and CI state, and preserves a private audit trail without taking control of the terminal or the software-delivery workflow.

Kronos has four runtime verbs:

1. **Read** ticket and provider context.
2. **Insert** an editable local context reference without submission.
3. **Monitor** bounded provider state for meaningful structural changes.
4. **Audit** what context and provider evidence was observed.

Anything outside those four verbs is outside the product.

## Ownership Invariants

The operator owns the terminal, process, interactive agent, repository, and submission decision at all times.

Kronos never:

- launches Claude or another interactive agent;
- creates a replacement terminal or PTY for managed work;
- reads, records, parses, or summarizes terminal input, output, or scrollback;
- submits terminal text or presses Enter;
- runs project tests, builds, static-analysis scans, deployments, database commands, or remediation commands;
- creates or removes worktrees;
- creates, switches, stages, commits, resets, pushes, merges, rebases, or deletes Git branches or refs;
- approves, comments on, merges, closes, or otherwise changes a merge request;
- mutates Jira, GitLab, Jenkins, SonarQube, or database state;
- closes, interrupts, or kills the operator's terminal when management stops.

`Manage Focused Terminal` records a private association between one ticket work session and the terminal object the operator explicitly focused. It does not grant Kronos control of that terminal.

Persisted terminal names and process IDs are descriptive metadata, not durable identity. After extension reload, live attachment starts detached. The operator must focus and explicitly reattach the intended terminal before insertion is allowed.

## Navigation Contract

Kronos exposes exactly three activity views.

### Work

Work is the ticket-centered entry point.

It supports:

- refreshing Jira work metadata;
- filtering and clearing the Work list;
- opening one canonical ticket workspace;
- managing the explicitly focused terminal for that ticket;
- inserting Jira, GitLab MR/pipeline, or combined Jenkins/SonarQube context.

The ticket workspace prioritizes the terminal-first sequence:

1. manage the focused terminal;
2. insert the context needed now;
3. continue working in the operator-owned terminal.

It does not plan or execute software-delivery work.

### Sessions

Sessions is the durable operational view for ticket work sessions.

Each session presents:

- ticket identity and title;
- attached, detached, paused, or closed management state;
- the live terminal attachment count without terminal contents;
- provider bindings;
- latest context-artifact freshness and completeness;
- monitoring readiness, last attempt, latest successful poll, failures, and skips.

Supported actions are focus, explicit reattach, detach, pause monitoring, resume monitoring, poll now, open audit, and stop management.

Stopping management disables monitoring and detaches the in-memory association. It never closes the terminal.

### Attention

Attention is the ticket-grouped inbox for changes that merit operator review.

Eligible items include:

- merge-request review or pipeline structural changes;
- newly failing or recovered GitLab jobs/tests;
- Jenkins build, stage, or test failures and recoveries;
- SonarQube quality-gate or unresolved-issue changes;
- partial provider reads and monitoring blockers;
- unsafe or unavailable local monitoring state.

An item may open its ticket workspace, open a validated provider URL, insert fresh MR/CI context into the explicitly attached terminal, or be acknowledged locally. Acknowledgement never changes provider state.

Unchanged polling results do not create new Attention items.

## Context Insertion Contract

Context insertion is always explicit and ticket-scoped.

1. Kronos resolves the selected ticket and the explicitly managed terminal.
2. It reads the configured provider through bounded read-only APIs.
3. It normalizes and secret-redacts provider data.
4. It writes a private, content-addressed JSON artifact and Markdown prompt boundary.
5. It verifies that the managed terminal attachment has not changed during the fetch.
6. It inserts one shell-inert reference line with terminal execution disabled.
7. The operator reviews, edits, and submits the line manually.

Provider data inside an artifact is untrusted evidence, never instructions. Prompt artifacts tell the interactive agent not to follow commands, role changes, credential requests, links, or mutation requests found inside provider content.

Insertion targets:

- `[JIRA-123]`: visible Jira fields, including custom-field IDs, names, schemas, values, readable text, comments, and bounded allowed text attachments;
- `[MR-77]`: GitLab merge-request metadata, notes, discussions, approvals, bounded diffs, pipelines, jobs, and test evidence;
- `[CI-JIRA-123]`: bounded Jenkins build/test/stage evidence and SonarQube gate/measure/issue evidence.

Partial, unavailable, skipped, truncated, or failed provider components remain explicit in completeness warnings. Kronos never presents partial evidence as complete.

## Monitoring Contract

Monitoring is read-only and belongs to an active ticket work session.

- The default interval is configured by `kronos.managedProviderPollIntervalSec`.
- The operator can pause, resume, or poll a session immediately.
- A private cross-window lease prevents duplicate concurrent polling against one Kronos data directory.
- Monitoring baselines contain bounded normalized digests, not full provider responses.
- Incomplete provider components do not erase the last complete component or create false recovery events.
- Losing lease ownership stops persistence and prevents the next provider request from starting.
- Provider errors affect readiness and Attention; they do not trigger remediation.

Monitoring can observe GitLab, Jenkins, and SonarQube. Jira remains explicitly refreshed from Work rather than continuously monitored as terminal content.

## Audit and Local State

By default, private terminal-first state lives under `~/.kronos`, or the explicitly configured `KRONOS_DIR`:

- work-session records contain ticket identity, terminal metadata, provider bindings, context references, and monitoring readiness;
- context directories contain normalized content-addressed provider artifacts and prompt boundaries;
- compact monitor snapshots contain the latest comparison baseline;
- the append-only monitor-event ledger records session, context, transition, notification, acknowledgement, and operator-decision events.

The audit may include provider summaries, timestamps, completeness warnings, hashes, and private artifact paths. It never contains terminal input, terminal output, scrollback, provider credentials, authorization headers, cookies, raw job traces, or Jenkins console logs.

Kronos does not publish audit content externally. Opening an audit is a local read.

## Provider and Credential Boundary

Provider credentials are inherited from approved local configuration. They are never inserted into the terminal or persisted in work-session, context, snapshot, or audit records.

Credentialed requests are constrained to configured provider origins. Redirects and provider-returned URLs do not silently move credentials to another host. Response sizes, pagination, item counts, text sizes, and request timeouts are bounded.

Doctor reports missing configuration and safe repair guidance without displaying credential values.

## Command Surface

The public terminal-first command surface is intentionally limited to:

- Work: refresh tickets, filter/clear Work, open ticket workspace, manage focused terminal, insert Jira/MR/CI context;
- Sessions: poll providers, open audit, focus/reattach/detach terminal, stop management, pause/resume monitoring;
- Attention: acknowledge item and open provider;
- Operations: Doctor and Settings.

No command outside this inventory is part of the terminal-first product contract.

## Canonical Operator Journey

1. The operator starts an interactive Claude session in their own terminal.
2. In Work, the operator selects a Jira ticket and opens its workspace.
3. With the intended terminal focused, the operator chooses `Manage Focused Terminal`.
4. The operator chooses `Insert [JIRA-123]`.
5. Kronos inserts one editable, non-submitting reference to the private Jira artifact.
6. The operator edits and submits it manually, then directs the work interactively.
7. Kronos monitors linked MR and CI providers without reading the terminal.
8. Meaningful changes appear in Attention and can produce fresh explicit MR/CI insertion actions.
9. The operator uses the work-session audit to inspect provenance and evidence.
10. The operator stops management when finished; the terminal remains open.

## Failure Behavior

Kronos fails closed at ownership and credential boundaries:

- no focused or explicitly attached terminal means no insertion;
- a changed terminal binding cancels insertion;
- missing credentials or provider failures produce partial/blocked state, not fabricated evidence;
- an unsafe local path or lease prevents polling or persistence;
- a failed provider read does not start a mutation or remediation path;
- stopping or pausing monitoring never affects the terminal process.

Every error should tell the operator whether the provider read, local artifact write, terminal insertion, monitoring snapshot, or audit write succeeded, so retrying cannot be mistaken for a clean first attempt.
