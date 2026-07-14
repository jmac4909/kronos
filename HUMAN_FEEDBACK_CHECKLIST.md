# Kronos Terminal-First Human Feedback Checklist

Use this checklist for a 15-to-25-minute hands-on evaluation of the operator-owned terminal workflow.

## Non-Negotiable Boundary

During this review, Kronos may read provider data, insert a non-submitting context reference, monitor provider status, and write a private local audit record.

Kronos must never:

- launch Claude or create a terminal for the operator;
- read terminal input, output, or scrollback;
- press Enter or submit inserted text;
- run a project test, build, scan, deployment, or remediation command;
- create, switch, commit, push, merge, or otherwise change Git;
- mutate Jira, GitLab, Jenkins, SonarQube, or a database;
- close the operator's terminal when management stops.

Stop the review immediately if any boundary is crossed.

## Setup

1. Run `npm run compile` and `npm run package` from the Kronos repository.
2. Install with `code --install-extension kronos-0.1.0.vsix --force`.
3. Reload VS Code.
4. Start an interactive Claude session yourself in a terminal you control. Do not ask Kronos to create it.
5. Open the Kronos activity icon.
6. Confirm exactly three views are visible: **Work**, **Sessions**, and **Attention**.

For a safe synthetic local state, use:

```bash
npm run feedback:state
KRONOS_DIR="$PWD/.kronos/feedback-state" code .
```

On Windows PowerShell:

```powershell
npm run feedback:state
$env:KRONOS_DIR = "$PWD\.kronos\feedback-state"
code .
```

Use a real ticket only when its provider data is approved for local context capture. The fixture is synthetic and must not be used to post or mutate provider state.

## Work View

1. Refresh Jira tickets.
2. Filter Work, then clear the filter. Confirm both operations are understandable and reversible.
3. Open one ticket workspace and confirm the title, summary, description, status, provider links, and known completeness warnings are easy to find.
4. Confirm the visible actions are limited to the terminal-first read, insert, monitor, and audit workflow.
5. With the intended interactive terminal focused, choose **Manage Focused Terminal**.
6. Confirm Kronos identifies the ticket and focused terminal but does not read from or write to the terminal yet.
7. Choose **Insert `[TICKET-KEY]`**.
8. Confirm exactly one editable reference is inserted, Enter is not pressed, and the terminal remains fully interactive and operator-controlled.
9. Inspect the referenced Jira artifact. Confirm custom-field names and values, comments, attachment capture/skip reasons, provenance, and partial-completeness warnings are understandable.
10. Edit the inserted line and decide yourself whether to press Enter.

If GitLab and CI providers are safely configured:

11. Insert the linked `[MR-N]` context and confirm review, pipeline, job, and test completeness is explicit.
12. Insert `[CI-TICKET-KEY]` and confirm Jenkins and SonarQube evidence clearly says which provider portions were fetched, partial, or unavailable.

## Sessions View

1. Confirm the managed work session shows ticket key, attached terminal state, provider bindings, monitoring state, last attempt, and latest result without showing terminal content.
2. Focus the managed terminal from Sessions.
3. Detach it and confirm the terminal remains open.
4. Focus the intended terminal and explicitly reattach it.
5. Pause monitoring and confirm provider polling stops for that work session.
6. Resume monitoring and run **Poll Managed Providers** once.
7. Open the work-session audit and confirm it shows context artifacts, hashes/completeness, provider transitions, and acknowledgements but no terminal transcript.
8. Stop managing the work session and confirm the terminal remains open and usable.

## Attention View

1. Confirm provider failures, recoveries, partial reads, and monitoring blockers are grouped by ticket rather than scattered by provider.
2. Open an attention item's provider page and confirm it points to the expected configured provider.
3. Open the related ticket workspace from the same item.
4. Insert fresh MR or CI context from the item when applicable; confirm the reference goes only to the explicitly attached terminal and is not submitted.
5. Acknowledge the item and confirm acknowledgement changes only local Attention/audit state.
6. Confirm ordinary unchanged polls do not create repeated attention noise.

## Reload and Recovery

1. With a managed session present, reload VS Code.
2. Confirm the durable session and audit history remain.
3. Confirm the live terminal is shown as detached after reload; Kronos must not restore it from a saved name or process ID.
4. Explicitly reattach the focused terminal and confirm context insertion works again.
5. Temporarily make one provider unavailable or use a safe invalid test configuration. Confirm the other providers remain usable, the result is marked partial/blocked, and no stale success is reported as current.

## Feedback Questions

- Was it always clear that you, not Kronos, owned the terminal and submission decision?
- Could you move from a Jira ticket to the correct terminal in two obvious actions?
- Did Work show enough context without becoming another dashboard of unrelated controls?
- Could you distinguish attached, detached, paused, blocked, partial, and healthy session states?
- Which provider transition deserves an interrupting notification, and which should remain quietly in Attention?
- Was the audit sufficient to reconstruct what context was supplied without recording terminal content?
- What information was missing before you would trust background monitoring during normal interactive work?

## Stop Conditions

Stop and record the exact action if:

- any inserted terminal text is submitted automatically;
- Kronos launches a process or terminal;
- a project command, test, build, scan, or deployment runs;
- the current Git branch, worktree, index, commit history, or remote changes;
- provider state changes;
- terminal content appears in a local artifact or audit;
- a context reference is inserted into a terminal other than the explicitly managed one;
- a provider credential appears in UI, logs, context, or audit data;
- stopping management closes or interrupts the terminal;
- a malformed provider response or local record crashes a view.

## Signoff Bar

The terminal-first trial is ready for broader feedback when:

- only Work, Sessions, and Attention appear in the Kronos activity container;
- a reviewer can complete the ticket-to-terminal-to-context journey without source-code knowledge;
- every insertion is editable and non-submitting;
- terminal focus, detach, reattach, pause, resume, audit, and stop-management behavior is clear;
- meaningful MR/pipeline/CI changes reach Attention without duplicate unchanged noise;
- context and audit records expose provenance and partial completeness without terminal contents or credentials;
- the repository and all providers remain unchanged by Kronos throughout the review.
