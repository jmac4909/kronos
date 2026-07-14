# Kronos — Terminal Work Companion

Kronos is a terminal-first VS Code extension. The operator owns and controls the interactive terminal session; Kronos only reads bounded provider context, inserts editable references without submission, monitors provider state, and keeps a private local audit.

## Current Host Notes

The repository root is `/home/ec2-user/kronos`. Do not move or reclassify it during workspace cleanup. Keep credentials, provider payloads, context artifacts, work-session records, and feedback fixtures out of Git.

Read `README.md`, `docs/terminal-first-product-contract.md`, and `HUMAN_FEEDBACK_CHECKLIST.md` before significant work.

## Non-negotiable Runtime Boundary

Kronos never launches an agent or terminal, reads terminal contents, submits text, runs project commands, mutates Git, mutates a provider, or closes the operator's terminal. `src/services/terminalContextInsertion.ts` is the only allowed `sendText` boundary and must always pass `false` as the execution flag.

Runtime code uses only the VS Code API and Node built-ins. Do not add runtime dependencies, external helper scripts, subprocess execution, provider POST/PUT/PATCH/DELETE requests, or project automation.

## Product Shape

- `src/extension.ts` is a thin activation export.
- `src/terminalFirstExtension.ts` owns exactly 20 public commands.
- `src/views/WorkTreeProvider.ts` renders Jira work.
- `src/views/ManagedSessionTreeProvider.ts` renders operator-managed work sessions.
- `src/views/AttentionTreeProvider.ts` renders unacknowledged provider transitions.
- `src/state/TerminalFirstState.ts` refreshes the bounded Jira Work catalog through native GET requests.
- `src/services/*RestClient.ts` contains credential-pinned, bounded provider reads.
- context stores write private, content-addressed artifacts under `~/.kronos` or `KRONOS_DIR`.
- work-session and monitor stores persist terminal metadata and provider transitions, never terminal content.

The activity container exposes exactly three views: Work, Sessions, and Attention. Every visible capability must stay within the read, insert, monitor, and audit product boundary.

## Build and Validation

```bash
npm install
npm run compile
npm test
npm run feedback:smoke
npm run package
npm run feedback:ready
```

`npm test` enforces the manifest allowlist, hard runtime boundary, prompt/context governance, strict TypeScript compilation, focused unit tests, and dependency-free webview behavior.

For an isolated manual fixture:

```bash
npm run feedback:state:force
KRONOS_DIR="$PWD/.kronos/feedback-state" code .
```

The fixture uses `.invalid` provider URLs and must not contact or mutate real systems.

## Credentials and Local Data

Kronos loads provider values from the extension process environment and, when present, `~/.kronos/.env` (or `KRONOS_ENV_FILE`). Supported provider variables are documented in `README.md`. Never log, persist, insert, or commit their values.

The default data directory is `~/.kronos`; `KRONOS_DIR` may point to an isolated directory.
