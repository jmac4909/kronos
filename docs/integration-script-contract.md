# Kronos Integration Script Contract

Kronos does not ship provider credentials. Runtime scripts are discovered from `KRONOS_SCRIPTS_DIR` or `~/.claude/scripts`, and sessions inherit the VS Code extension process environment. Kronos does not read `~/.claude/.env` or pass credential values on command lines.

Required scripts:

- `kronos_state.py`
- `pipeline_monitor.py`
- `gitlab_api.py`

GitLab merge request polling uses registered project metadata and the ticket MR IID:

```text
gitlab_api.py --mr-status <gitlab_project_id> <mr_iid>
gitlab_api.py --mr-diff <gitlab_project_id> <mr_iid>
gitlab_api.py --mr-branch <gitlab_project_id> <mr_iid>
```

Each command must print JSON to stdout. `--mr-status` should include MR state, review status or approval data, comment metadata, and discussion metadata when available. `--mr-diff` should include `mr` and `files` fields. `--mr-branch` should include `branch`.

Legacy ticket-key calls may still be attempted only as a compatibility fallback when project metadata is absent or an older script rejects the project-ID form:

```text
gitlab_api.py --mr-status <ticket_key>
gitlab_api.py --mr-diff <ticket_key>
gitlab_api.py --mr-branch <ticket_key>
```

Registered projects should define `config.gitlab_project_id`; review tickets should include `mr.iid` and at least one linked project.
