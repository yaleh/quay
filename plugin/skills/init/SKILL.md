---
name: quay-init
description: "Initialize a workspace as a quay project — write the six-file config surface (.quay/config.yml, .quay/profiles.yml, tasks/, .gitignore, .claude/launch.settings.json, .claude/settings.json) and print the explicit quay plugin install steps. Idempotent."
allowed-tools: Bash, Read
---

# quay-init

Initialize the current workspace as a quay project. **quay-init is a project initializer, NOT an
installer** (SPEC-plugin-lifecycle-single-bundle-2026-09-02 裁定 6): it writes ONLY the six-file
closed set below — no `.claude/{skills,workflows,agents}` copies, no `plugin/scripts` copies, no
`orchestration/`/`docs/analysis/` copies, no `.quay/runtime` laydown. The quay extension files and
scripts are delivered by the **quay Claude Code plugin**, which this skill's output tells you how to
install explicitly.

**The logic lives in ONE executable** — `bash ${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh`. This skill
delegates to it rather than repeating the write logic inline.

## Write surface (the six-file closed set)

```
.quay/config.yml            provider map + loop params (generated)
.quay/profiles.yml          launcher/model carrier (plugin template, verbatim)
tasks/                      task directory (created, empty)
.gitignore                  quay runtime-state ignore entries (appended, idempotent)
.claude/launch.settings.json  per-role launch config (plugin template, verbatim)
.claude/settings.json       enabledPlugins + permissions.allow (generated)
```

Nothing else is written. The retired extension-file copy machinery (`copy_one` / `copy_dir` /
`derive_loop_scripts` / `write_state_file` + the managed/conflict/stale three-state machine) was
archived with `gap-quay-init-closure-shrink-body` (AC168).

## ⚠️ Install the plugin first (config does NOT auto-install)

`enabledPlugins` only toggles an ALREADY-INSTALLED plugin, and an untrusted directory's project
settings are not read at all (SPEC §6 / T3) — so "config committed ⇒ auto-installed" is FALSE. The
script's output carries the explicit steps, which are:

```bash
claude plugin marketplace add quay "${CLAUDE_PLUGIN_ROOT}"
claude plugin install quay@quay --scope project
# (or the npm-global path: npm install -g quay — its register-plugin.mjs postinstall registers the
#  marketplace source only; the enable is deliberately NOT user-scope by default)
```

⚠️ **Always pass `--scope`.** `claude plugin install` defaults to `scope=user`, which writes a
user-level `enabledPlugins` key and reddens the STANDING goal AC-161 (the user level is allowed to
carry only the marketplace *source*). Same class of mistake, same fix: to merely *re-fill* a shared
plugin-cache entry (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>` is keyed by
marketplace+plugin+version and **shared across scopes** — no scope owns a cache path), use
`claude plugin update quay@quay --scope project`, **never** `--scope user`.

Then accept the trust dialog the first time you enter the directory, and restart the session.

## Arguments

```
--root <dir>            workspace root (default: cwd)
--project <name>        project name (default: basename of --root)
--repo-root <path>      → .quay/config.yml loop.repo_root (default: --root)
--test-command <cmd>    → loop.test_command (detected via scripts/test.sh → package.json
                        scripts.test → go.mod → Cargo.toml when omitted; FAIL CLOSED on a miss)
--tmux-session <sess>   → loop.tmux_session (optional: detected best-effort by project name; null
                        when absent/ambiguous — never guessed, never a hard failure — the dual-tmux
                        model retired in SPEC-tmux-retirement-2026-09-03)
--worktree-root <dir>   → loop.worktree_root (default: sibling-of-repo; FAIL CLOSED on tmpfs)
--plugin-root <dir>     quay plugin dir (overrides ${CLAUDE_PLUGIN_ROOT} / self-resolution)
--force                 overwrite an existing .claude/settings.json
--dry-run               print what would happen, write nothing
--auto-commit-confirm   commit the laid-down files (non-interactive)
--auto-commit-skip      never commit
```

`--all` / `--loop` / `--manager` / `--workflows` / `--agents` are accepted for backward
compatibility and now all converge to the same six-file closed set (they no longer select copy
categories). `--check-drift` / `--check-dependency-closure` are retired (no copy surface to report).

## `loop.test_command` contract (what quay appends to your test entrypoint)

**Read this before writing `scripts/test.sh`.** quay's mechanical fan-in runs the project's suite
inside the task worktree, and when the project ships its own `scripts/test.sh` quay invokes it with
its **own value-taking flags appended**:

```
bash scripts/test.sh --buckets <task-id> --root <worktree> --state-dir <root>/.quay \
                     --runner inner --log-file <suite-log> --run-id <suite-run-id> \
                     --test-concurrency=<N>
```

The flag set above is the real one passed to quay's suite runner (`--buckets` / `--root` /
`--state-dir` / `--runner` / `--log-file` / `--run-id`), plus `--test-concurrency=<N>` which the
runner splices into the command it hands to `test.sh`. A project **without** `scripts/test.sh` is
run as `bash -c "cd <worktree> && <loop.test_command>"` — `loop.test_command` itself never receives
these flags; only a project-supplied `scripts/test.sh` does.

**Your tolerance obligations** (a violation is not harmless — it burns whole worker sessions):

1. **Consume a value-taking flag together with its value.** `case "$1" in --buckets|--root|…) shift 2 ;;`
   — shifting only the flag leaves the value behind, it falls through to your positional handling,
   and it is then read as a *test file name*: `--buckets <task-id>` produced
   `Could not find '<task-id>'` on every fan-in round in a real adopter project (quay-fleet,
   2026-09-13, three consecutive rounds with byte-identical logs).
2. **Never treat a flag's value as a positional test-file argument.** Anything you do not recognize
   as a flag must not be consumed as a path.
3. **A positional path that does not exist is an ERROR, not a skip.** Skipping it empties your file
   list, falls back to the full glob, and makes any criterion naming a missing file pass
   unconditionally — a green that cannot go red is not a measurement.

A defensive `scripts/test.sh` head (drop-in; `quay-init` writes the same note into the generated
`.quay/config.yml` next to `loop.test_command`):

```bash
while [ $# -gt 0 ]; do
  case "$1" in
    --for-task) SCOPED="${2:-}"; shift 2 ;;
    # quay's fan-in passes value-taking flags; drop flag AND value.
    --buckets|--root|--state-dir|--runner|--log-file|--run-id) shift 2 ;;
    --test-concurrency=*) shift ;;
    --allow-thin) shift ;;
    -*) shift ;;                       # ignore other unknown flags rather than failing the gate
    *) [ -e "$1" ] || { echo "error: test file not found: $1" >&2; exit 1; }
       FILES+=("$1"); shift ;;
  esac
done
```

**Why the driver stops instead of retrying**: a suite log that names *no* failing test file cannot
be fixed by a worker (there is nothing in it to fix — the cause is this contract, not the tested
code). quay therefore bounds unattributable suite-red retries to **one**, and stops earlier still
when two consecutive rounds produce byte-identical logs (a retry provably cannot change the
result), leaving the task in a human-readable `needs-human` terminal state. Keeping the obligations
above costs one `shift 2`; violating them costs a full agent session per round.

## Steps

### 1. Resolve the plugin root

`quay-init.sh` resolves the plugin root in this order: `--plugin-root <dir>` (highest precedence),
then `${CLAUDE_PLUGIN_ROOT}`, then self-resolution from the script's own path
(`<plugin-root>/scripts/quay-init.sh`). It verifies `<plugin-root>/.claude-plugin/plugin.json`
exists and fails closed otherwise.

### 2. Run the script

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh" \
  --root "$(pwd)" \
  --plugin-root "${CLAUDE_PLUGIN_ROOT}" \
  [--test-command <cmd> --project <name> --repo-root <path> --tmux-session <sess>]
```

### 3. Follow the printed install steps

The script prints `claude plugin marketplace add` + `claude plugin install` (or the npm-global
`register-plugin.mjs` path). Run them, accept the trust dialog, restart — then the `.claude/settings.json`
`enabledPlugins` block takes effect.

### 4. Next step: cold start

After the six-file laydown, the workspace is READY for the cold-start skill (`/quay:cold-start`):
one command that drives the loop to start and asserts a real `--task-start` telemetry record.

## Reference docs (SPEC declaration point)

The init skill is a SPEC declaration point (`spec-declaration-point-check`): every on-disk
`orchestration/SPEC-*.md` must be declared here.

<!-- reference-doc: orchestration/SPEC-branching-model-integration-branch-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md -->
<!-- reference-doc: orchestration/SPEC-checker-mechanical-spine-contract-2026-08-28.md -->
<!-- reference-doc: orchestration/SPEC-codex-session-communication-host-adapter-2026-08-24.md -->
<!-- reference-doc: orchestration/SPEC-cold-start-one-liner.md -->
<!-- reference-doc: orchestration/SPEC-complete-delivery-surface-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-cut-the-waiting.md -->
<!-- reference-doc: orchestration/SPEC-dispatch-ordering-semantic-2026-08-13.md -->
<!-- reference-doc: orchestration/SPEC-execution-loop-productization-2026-08-28.md -->
<!-- reference-doc: orchestration/SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md -->
<!-- reference-doc: orchestration/SPEC-fan-in-ff-merge-lock-2026-08-14.md -->
<!-- reference-doc: orchestration/SPEC-fan-in-workflow-lock-and-S1-2026-08-26.md -->
<!-- reference-doc: orchestration/SPEC-goal-mechanism-2026-09-06.md -->
<!-- reference-doc: orchestration/SPEC-goal-store-2026-08-09.md -->
<!-- reference-doc: orchestration/SPEC-in-flight-semantics-2026-08-14.md -->
<!-- reference-doc: orchestration/SPEC-instruments-behind-one-entry.md -->
<!-- reference-doc: orchestration/SPEC-integration-architecture-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-manager-productization-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-methodology-as-a-deliverable.md -->
<!-- reference-doc: orchestration/SPEC-methodology-layer-architecture-2026-08-25.md -->
<!-- reference-doc: orchestration/SPEC-no-text-substitution-at-install.md -->
<!-- reference-doc: orchestration/SPEC-one-observer-two-surfaces.md -->
<!-- reference-doc: orchestration/SPEC-outer-liveness-productization.md -->
<!-- reference-doc: orchestration/SPEC-per-task-suite-verification-2026-08-13.md -->
<!-- reference-doc: orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md -->
<!-- reference-doc: orchestration/SPEC-quay-self-hosts-its-own-cold-start.md -->
<!-- reference-doc: orchestration/SPEC-state-crystallization-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-store-commit-unification-2026-09-08.md -->
<!-- reference-doc: orchestration/SPEC-suite-lifecycle-and-failure-semantics-2026-08-26.md -->
<!-- reference-doc: orchestration/SPEC-suite-speed.md -->
<!-- reference-doc: orchestration/SPEC-task-status-flow-target-vs-actual-2026-08-13.md -->
<!-- reference-doc: orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md -->
<!-- reference-doc: orchestration/SPEC-tick-mechanical-checks-mcp-2026-08-15.md -->
<!-- reference-doc: orchestration/SPEC-tick-quality-2026-08-14.md -->
<!-- reference-doc: orchestration/SPEC-tick-read-path-slimming-2026-08-14.md -->
<!-- reference-doc: orchestration/SPEC-tmux-retirement-2026-09-03.md -->
<!-- reference-doc: orchestration/SPEC-typed-axes-and-standing-dynamics.md -->
<!-- reference-doc: orchestration/SPEC-unified-driver-architecture-2026-08-23.md -->
<!-- reference-doc: orchestration/SPEC-unified-quay-server-2026-09-13.md -->
<!-- reference-doc: orchestration/SPEC-web-session-observability-and-control-2026-08-24.md -->
<!-- reference-doc: orchestration/SPEC-worker-driven-inner-2026-08-16.md -->
