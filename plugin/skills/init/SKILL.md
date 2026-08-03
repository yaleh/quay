---
name: quay-init
description: "Initialize a workspace with quay workflows, agents, gate scripts, and the two-layer loop mechanism from the quay plugin bundle. Idempotent — safe to run multiple times."
allowed-tools: Bash, Read
---

# quay-init

Copy quay methodology assets from the plugin installation into the current workspace.
Source: `${CLAUDE_PLUGIN_ROOT}` (the quay plugin directory).
Target: the current workspace's `.claude/`, `scripts/`, `plugin/scripts/`, `orchestration/`, and
`docs/analysis/` directories.

**The copy logic lives in ONE executable** — `bash ${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh`
(`gap-loop-mechanism-lives-outside-the-package-and-cannot-ship`). This skill delegates to it rather
than repeating the idempotent-copy loop inline: a second copy of the copy logic is exactly the drift
this repo keeps removing. Run the script; do not hand-reimplement its behavior.

## Arguments

```
--workflows       Copy workflows only    (plugin/workflows/     → .claude/workflows/)
--agents          Copy agents only       (plugin/agents/        → .claude/agents/)
--gate-scripts    Copy gate scripts only (plugin/gate-scripts/  → scripts/gates/)
--loop            Copy the two-layer loop mechanism (tick docs + checkers + gate + token + observation)
--all             Copy all of the above except --loop (default if no flag given)
--force           Overwrite on conflict  (default: skip and report conflict)
--dry-run         List what would happen, do not copy
```

`--loop` extra parameters (see the script for the full list):

```
--test-command <cmd>   the target project's test command (REQUIRED for --loop; there is no
                       universal default — quay uses scripts/test.sh, archguard uses npm test)
--repo-root <path>     the target repo root (default: the workspace being initialized)
--project <name>       project name (default: basename of the workspace)
--tmux-session <sess>  tmux session name (default: <project>-0:0.0)
```

## Mapping

| Plugin source (`${CLAUDE_PLUGIN_ROOT}/`) | Workspace target |
|---|---|
| `workflows/*.js` | `.claude/workflows/` |
| `agents/*.md` | `.claude/agents/` |
| `gate-scripts/*.sh`, `gate-scripts/*.ts` | `scripts/gates/` |
| `loop/orchestrator-loop-tick.md` | `orchestration/orchestrator-loop-tick.md` (with placeholder substitution) |
| `loop/fast-mode-loop-tick.md` | `docs/analysis/fast-mode-loop-tick.md` (with placeholder substitution) |
| `scripts/fast-mode-telemetry.ts`, `task-contract-check.ts`, `task-status-drift-check.ts`, `touches-orthogonality-check.ts`, `concurrent-batch-scheduler.ts`, `inner-blocked-signal.ts`, `inner-idle-log.ts`, `it0-split-or-commit-check.ts` | `plugin/scripts/` |
| `scripts/resource-gate.sh`, `heavy-op-token.sh`, `inner-state.sh`, `inner-forensics.mjs`, `pipe-exit-code-check.sh` | `plugin/scripts/` |
| `scripts/gate-script-base.ts`, `workflow-event-schema.mjs`, `task-schema.ts`, `touches-parser.ts`, `wiring-coverage-check.ts` (transitive deps of the checkers — the laid-down mechanism must be functional) | `plugin/scripts/` |

## Behavior

For each file in the requested category, the script runs an idempotent copy:
- **Target does not exist** → copy
- **Target exists, content identical** → skip (idempotent)
- **Target exists, content differs**:
  - Without `--force`: report conflict, skip — **local changes are never overwritten** (upgrade path)
  - With `--force`: overwrite (with backup comment)
- **Source directory empty or missing** → warn, skip category (never fail)

For `--loop` tick docs, the copy is **substituted**: the target's test command / repo root / tmux
session replace the quay-specific literals (`scripts/test.sh`, the quay repo root, `quay-0:0.0`).
The substitution is mechanical (in the script) — no hand `sed`. After laying down, grep the copies
for `scripts/test.sh` and the quay repo root: both must be absent (negative control).

`--loop` also writes `.quay/quay-init-state.json` recording the plugin version, so a re-run after a
plugin upgrade detects "upgrade from vX to vY" and only fills the diff (per-file idempotent copy;
conflicts listed for a human, never silently overwritten).

## Steps

### 1. Parse arguments

Read the user's argument string. Default to `--all` if no category flag given. For `--loop`, require
`--test-command` (fail-closed — there is no universal default).

### 2. Verify plugin root

Read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` to confirm this is the quay plugin.
If `${CLAUDE_PLUGIN_ROOT}` is not set or the file is absent → error, exit.

### 3. Run the copy script

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh" \
  --root "$(pwd)" \
  [--all|--workflows|--agents|--gate-scripts|--loop] \
  [--force] [--dry-run] \
  [--test-command <cmd> --project <name> --repo-root <path> --tmux-session <sess>]
```

### 4. Report summary

The script prints a per-category `copied=N skipped=M conflicted=K` summary. If conflicts were
detected, it prints:

```
Conflicts detected. To overwrite: /quay:init --force
To see diffs: diff <target> ${CLAUDE_PLUGIN_ROOT}/<category>/<file>
```

### 5. Workspace detection (informational only)

Check if `.quay/config.yml` exists in the workspace root. If absent, print:
```
Note: .quay/config.yml not found. This may not be a quay workspace.
Run `quay init` (CLI) to create one, or configure manually.
```
This is a WARNING, not a block — the copy proceeds regardless.
