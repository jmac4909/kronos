# Kronos — Terminal Work Companion

Kronos is a terminal-first VS Code companion for organizing work around an interactive terminal that the operator already owns. It reads Jira, GitLab, Jenkins, and SonarQube context; inserts editable context references into the focused terminal without submitting them; monitors provider status; and keeps a private audit trail.

## Product Boundary

Kronos does four things: **reads, inserts, monitors, and audits**.

Kronos never:

- launches Claude or creates a replacement terminal;
- reads terminal input, output, or scrollback;
- presses Enter or submits terminal input;
- runs project tests, builds, scans, deployments, or remediation commands;
- creates, switches, commits, pushes, merges, or otherwise changes Git branches or worktrees;
- changes Jira, GitLab, Jenkins, SonarQube, or database state.

The operator starts and controls the interactive session, edits every inserted reference, decides when to submit it, directs the work, and can stop Kronos management without closing the terminal.

The normative boundary and navigation model are in [docs/terminal-first-product-contract.md](docs/terminal-first-product-contract.md).

## Three Views

### Work

Work is the ticket-centered starting point. Refresh or filter Jira work, open one ticket workspace, attach the focused terminal to that ticket, and explicitly insert the context needed for the next instruction:

- `[JIRA-123]` for Jira fields, description, comments, custom fields, and bounded safe-text attachments;
- `[MR-77]` for GitLab merge-request, review, diff, pipeline, job, and test evidence;
- `[CI-JIRA-123]` for Jenkins build/test/stage and SonarQube gate/measure/issue evidence.

Every insertion is one editable line and is sent with execution disabled. The operator reviews it and presses Enter only when ready.

**Refresh Jira Tickets** uses Jira Cloud's bounded read-only JQL search directly from the extension. Set `JIRA_JQL` to choose the Work list; otherwise Kronos reads unresolved work assigned to the current Jira user. A partial paginated read retains prior rows instead of silently dropping them.

### Sessions

Sessions shows durable ticket work sessions and their ephemeral live-terminal attachment. It reports whether the terminal is attached, which providers are bound, context freshness, monitoring health, and the latest poll result.

From Sessions, the operator can focus or reattach the terminal, poll providers, pause or resume monitoring, inspect the audit, detach the terminal, or stop management. Detaching and stopping management never close the terminal.

After VS Code reloads, persisted history remains but the live terminal starts detached. Kronos does not trust a saved terminal name or process ID as proof of identity; the operator must focus and explicitly reattach the intended terminal.

### Attention

Attention is the ticket-grouped inbox for meaningful provider changes and monitoring problems: merge-request review changes, pipeline failures or recoveries, Jenkins test/stage changes, SonarQube gate or issue changes, partial provider reads, and monitoring blockers.

An attention item can open the originating provider page, open its ticket workspace, insert fresh MR or CI context into the managed terminal, or be acknowledged. Acknowledgement changes only the local audit state.

## Typical Journey

1. Open **Kronos > Work** and select a Jira ticket.
2. Review the ticket workspace and focus the already-running interactive terminal you want to use.
3. Choose **Manage Focused Terminal**.
4. Choose **Insert `[JIRA-123]`**. Kronos writes a private context artifact and inserts its non-submitting reference.
5. Edit the line if needed, press Enter yourself, and continue directing the interactive session normally.
6. When an MR or CI provider is linked, Kronos monitors its bounded structural status in the background.
7. Respond to meaningful changes from **Attention** by opening the provider, inserting fresh context, or acknowledging the event.
8. Use **Sessions > Open Work Session Audit** to inspect context provenance, completeness, transitions, and acknowledgements. Terminal contents are never part of the audit.
9. Choose **Stop Managing Work Session** when finished. The terminal remains open and under operator control.

## Runtime, Local Data, and Credentials

The installed extension has **zero third-party runtime dependencies**. It uses the VS Code API and Node built-ins only; it does not call external helper scripts or CLIs. TypeScript and the official VS Code type packages are development-only tooling. Release packaging uses the pinned official VS Code Extension Manager CLI (`@vscode/vsce@3.9.2`), which is not shipped in the extension.

Kronos uses local operator state under `~/.kronos` by default, or the explicitly configured `KRONOS_DIR`. Provider credentials are inherited from the extension environment and, when present, `~/.kronos/.env` (or `KRONOS_ENV_FILE`). Credential values are not written to context artifacts, work-session records, or audit events.

Common read-only configuration variables are:

- Jira: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, optional `JIRA_JQL`;
- GitLab: `GITLAB_TOKEN` and `GITLAB_API_BASE_URL` or `GITLAB_BASE_URL`;
- Jenkins: `JENKINS_URL`, plus optional `JENKINS_USER`/`JENKINS_USERNAME` and `JENKINS_API_TOKEN`/`JENKINS_TOKEN`;
- SonarQube: `SONAR_HOST_URL`/`SONAR_URL` and `SONAR_TOKEN`.

Context artifacts are bounded, normalized, secret-redacted, wrapped as untrusted provider data, and stored in private per-user files where the platform supports private file permissions. Provider reads are pinned to configured origins when credentials are sent. Kronos does not fetch GitLab job traces, Jenkins console logs, or unsupported Jira attachment bodies.

Run **Kronos: Doctor** to inspect missing or invalid provider configuration without displaying credential values.

## Install for Local Evaluation

```bash
npm install
npm run compile
npm run package
code --install-extension kronos-0.1.0.vsix --force
```

Reload VS Code, open the Kronos activity icon, and confirm exactly three views appear: **Work**, **Sessions**, and **Attention**.

For an isolated local fixture:

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

Fixture data is synthetic. Do not use it to post or mutate real provider state.

## Developer Validation

These commands validate and package the extension itself; they are run manually by a developer. The installed Kronos runtime never invokes project tests, builds, or deployments.

```bash
npm run compile
npm test
npm run webview:dom
npm run feedback:smoke
npm run package
npm run feedback:ready
```

Use [HUMAN_FEEDBACK_CHECKLIST.md](HUMAN_FEEDBACK_CHECKLIST.md) for the terminal-first evaluation pass.
