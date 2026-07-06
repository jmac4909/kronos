# Kronos Integration Script Contract

Kronos does not ship provider credentials. Runtime scripts are discovered from `KRONOS_SCRIPTS_DIR` or `~/.claude/scripts`, and sessions inherit the VS Code extension process environment. Kronos does not read `~/.claude/.env` or pass credential values on command lines.

Required scripts:

- `kronos_state.py`
- `pipeline_monitor.py`
- `gitlab_api.py`

All commands must print JSON to stdout and write diagnostics to stderr. Non-zero exits should include a concise stderr message. Credential values must come from inherited environment variables and must never be echoed, embedded in argv, or written to Kronos state files.

## Jira and State Commands

Kronos routes Jira ticket comments through `kronos_state.py`:

```text
kronos_state.py --ticket-comments <ticket_key>
```

The output may be either an array of comments or an object with `comments`. Each comment may include `body`, `renderedBody`, `created`, `author`, and `authorName`.

`kronos_state.py` also owns state refresh, project discovery, queue operations, and morning brief commands through `src/services/stateScriptAdapter.ts`. Keep those commands compatible with that adapter rather than calling script flags directly from the extension.

## GitLab Merge Request Commands

GitLab merge request polling uses registered project metadata and the ticket MR IID:

```text
gitlab_api.py --mr-status <gitlab_project_id> <mr_iid>
gitlab_api.py --mr-diff <gitlab_project_id> <mr_iid>
gitlab_api.py --mr-branch <gitlab_project_id> <mr_iid>
```

`--mr-status` should include MR state, review status or approval data, comment metadata, and discussion metadata when available. `--mr-diff` should include `mr` and `files` fields. `--mr-branch` should include `branch`.

Legacy ticket-key calls may still be attempted only as a compatibility fallback when project metadata is absent or an older script rejects the project-ID form:

```text
gitlab_api.py --mr-status <ticket_key>
gitlab_api.py --mr-diff <ticket_key>
gitlab_api.py --mr-branch <ticket_key>
```

Registered projects should define `config.gitlab_project_id`; review tickets should include `mr.iid` and at least one linked project.

Project setup may resolve project IDs with:

```text
gitlab_api.py --project-id <namespace/project>
```

The output should include numeric `id`.

## SonarQube Commands

Kronos routes SonarQube lookup and report data through `pipeline_monitor.py`:

```text
pipeline_monitor.py --find-sonar-key <project_name>
pipeline_monitor.py --sonar-branches <sonar_project_key>
pipeline_monitor.py --sonar-gate <sonar_project_key> --branch <branch>
pipeline_monitor.py --sonar-measures <sonar_project_key> --branch <branch>
pipeline_monitor.py --sonar-issues <sonar_project_key> --branch <branch>
```

`--find-sonar-key` should return `sonar_project_key`. `--sonar-branches` should return `branches`, where each branch has `name`, optional `isMain`, and optional quality gate status. The gate, measures, and issues commands may return provider-native JSON; Kronos keeps those payloads unknown until the report view normalizes the fields it renders.

## Dispatch Environment

Dispatched Claude sessions inherit the VS Code extension process environment. Kronos sets a run-scoped temporary directory with `TMPDIR`, `TMP`, and `TEMP` so generated helper scripts can be cleaned up after the run. Operators should provide provider tokens through the parent VS Code environment or OS credential setup, not through `~/.claude/.env`.
