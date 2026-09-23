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

**The entry point is ONE executable** — `bash ${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh`. This skill
delegates to it rather than repeating the write logic inline. Since
`gap-arch-quay-init-sh-python-heredocs-to-native` (2026-09-20) that script is the **orchestration**
(which step runs when, in what order, with which report lines) and the **step logic lives in
`packages/quay/src/init.ts`**, reached through the sibling `plugin/scripts/quay-init-steps.ts`. It
used to embed twelve `python3` invocations; it now embeds none, so a quay project can be initialized
with no Python on the machine at all.

## Re-running on an existing project: RECONCILE, not "already exists"

Re-running `/quay:init` after a plugin upgrade is a first-class operation, and since
`gap-quay-init-native-reconcile` (2026-09-18) the version-level part of it is a **per-key reconcile**
instead of a skip: keys this version added to the `loop:` schema are filled from the single-source
default table (`LOOP_VERSION_DEFAULTS` in `packages/quay/src/init.ts`), values this version considers
incompatible are rewritten through a declared migration table, and every other key — and every
comment — is left byte-for-byte alone. A config that is already current is not rewritten at all.
This retires the failure mode that made the same fix necessary twice: a default added to the
fresh-install template but never to the upgrade path was unreachable for every project initialized
before it, no matter how many times init re-ran.

Two equivalent surfaces, both calling the same `runInit`:

```
quay init --reconcile --root <dir>              # CLI
# MCP: the `init` tool with { "root": "<dir>" }   (reconcile is that tool's DEFAULT)
```

⛔ Neither needs a READABLE config — that is the point. An ABSENT config is written fresh; an
UNPARSEABLE one is rebuilt from the defaults with the broken bytes preserved beside it as
`.quay/config.yml.corrupt-<timestamp>`; a config that exists but cannot be read is reported as
exactly that, never as a name conflict ("already exists, use --force" was the old — and wrong —
answer, because it sends you looking for a conflict that does not exist). The MCP `init` tool is
registered BEFORE any config is read, so it is reachable in precisely the workspace where every other
tool is not (see `packages/quay/src/mcp-server.ts`, the two-phase `startMcpServer`).

⚠️ **The VERSION-LEVEL half is still not wired into the script below.** `bash quay-init.sh` is what
this skill runs, and its own `loop:` upgrade (`ensureLoopConfig` in `packages/quay/src/init.ts`,
dispatched by that script) updates only the four project-derived values
(`repo_root`/`test_command`/`tmux_session`/`worktree_root`); the version-level reconcile above is
reachable today through the CLI and the MCP tool, not yet from the script. Closing that gap is the
remaining half of `gap-quay-init-native-reconcile`, and the measured reason it was deferred is
recorded in that task's DoD evidence section.
(⛔ Do not read the 2026-09-20 port as having closed it: that port moved twelve embedded `python3`
steps into `init.ts` unchanged — it relocated CODE, it did not add the reconcile to the script's
path. `ensureLoopConfig` is the same four-value merge it always was.)

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
marketplace+plugin+version and **shared across scopes** — no scope owns a cache path).

**Resolve the scope first** — that step is not optional. `claude plugin uninstall <ref> --scope
project` FAILS outright when the record is held at **user** scope:

```
✘ Failed to uninstall plugin "quay@quay": Plugin "quay@quay" is installed in user scope, not
  project. Use --scope user to uninstall.
```

i.e. the CLI's own error message hands you the one command this note forbids. (That is the fifth
AC-161 regression, 2026-09-15: an agent followed the earlier form of this recipe verbatim and was
machine-redirected onto `--scope user`.) So, in this order:

```bash
# (1) which scope ACTUALLY holds the record? (never assume `project`)
claude plugin list --json | jq -r '.[] | select(.id=="quay@quay") | .scope' | sort -u
# (2) uninstall THERE — a USER-scope uninstall is AC-161-safe: it DELETES the user-level key,
#     it never adds one (and it does not remove the shared cache payload)
claude plugin uninstall quay@quay --scope <the scope just printed>
# (3) ALWAYS install at project scope — the only step that writes an enabledPlugins key, and it
#     writes it to <cwd>/.claude/settings.json, never to ~/.claude/settings.json
claude plugin install   quay@quay --scope project -y
```

(Measured 2026-09-15 / Claude Code 2.1.271–2.1.272 against a deliberately damaged cache entry: both
`claude plugin update --scope project` and a re-`install` short-circuit on the unchanged version and
re-materialize **nothing** — file count 0 → 0; the short-circuit is keyed on an install **record**,
not on the cache. Only remove-the-record-then-install re-filled it, 0 → 1, with no user-level key
appearing.)

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
inside the task worktree. **Which command it runs is decided ONLY by the `loop:` declarations in
your `.quay/config.yml`** (see "The `loop:` fan-in contract keys" below) — `quay-init` writes
`suite_runner: delegated`, so a fresh project runs `bash -c "cd <worktree> && <loop.test_command>"`
and nothing in this section applies. If you additionally ship a bucket-protocol `scripts/test.sh`
and declare `suite_runner: quay-buckets`, quay invokes **that** script with its **own value-taking
flags appended**:

```
bash scripts/test.sh --buckets <task-id> --root <worktree> --state-dir <root>/.quay \
                     --runner inner --log-file <suite-log> --run-id <suite-run-id> \
                     --test-concurrency=<N>
```

The flag set above is the real one passed to quay's suite runner (`--buckets` / `--root` /
`--state-dir` / `--runner` / `--log-file` / `--run-id`), plus `--test-concurrency=<N>` which the
runner splices into the command it hands to `test.sh`. Under `suite_runner: delegated` (the
`quay-init` default) the full suite is `bash -c "cd <worktree> && <loop.test_command>"` —
`loop.test_command` itself never receives these flags.

⚠️ **The decision is a DECLARATION, never a file's existence** (GOAL-027 / AC-316): quay used to
treat "this project has a `scripts/test.sh`" as "this project is quay-shaped" and then called that
script with quay's own flags. A third-party project that correctly named its own entrypoint
`scripts/test.sh` (the name `--test-command` detection suggests) therefore had quay's flags handed
to a script that never agreed to consume them, and every mismatch surfaced as "read nothing"
rather than as an error. Shipping a file no longer changes quay's behaviour; declaring the
capability does.

### The `loop:` fan-in contract keys

| key | values | meaning |
|---|---|---|
| `suite_runner` | `quay-buckets` or `delegated` | `quay-buckets` ⇒ the full suite runs through quay's bucket runner (`full-suite-runner.ts`), the only writer of `verification-round.jsonl` — **quay's own repo uses this**; `delegated` ⇒ run `loop.test_command` as the full suite (the `quay-init` default for a new project). Absent ⇒ `delegated` iff `loop.test_command` is declared, else a fail-closed "no test tooling" command (exit 2 — never exit 127, so "capability absent" stays distinguishable from "command not found"). |
| `scoped_command` | argv list; `{worktree}` and `{task}` are placeholders | The scoped gate's argv, e.g. `["bash", "{worktree}/scripts/test.sh", "--for-task", "{task}", "--allow-thin"]`. **Absent (or `null`) ⇒ this project has no scoped capability**: fan-in skips that step with its own distinguishable value, `no-scoped-command-declared`. A declared-but-malformed value (a bare string, an empty list) **fails closed** — it is never silently treated as "not provided". |
| `doc_check_command` | argv list; `{worktree}` is a placeholder | The doc-check argv, e.g. `["bash", "{worktree}/scripts/test.sh", "--static-checks-doc"]`. Same three-state rule as `scoped_command`; the absent state reads `no-doc-check-command-declared`. |

`quay-init` writes `suite_runner: delegated`, `scoped_command: null` and `doc_check_command: null`
into a fresh project's config, with these semantics spelled out in comments next to the keys. A
project that genuinely has a scoped gate or a doc check replaces the `null` with its own argv
list. An EXISTING config is never given these keys by an upgrade (the config-preserving merge only
updates the values it owns), so a project installed earlier simply has them absent — which is the
honest reading: it never declared those capabilities.

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

## The scoped gate's output contract (`SCOPED-THIN`) — read this before writing a scoped entrypoint

quay's mechanical fan-in has a **scoped gate**: before the full suite it runs the project's scoped
entrypoint (`.quay/config.yml` `loop.scoped_command`; a project that declares none is recorded as
`not-evaluated` — quay does not invent a scoped run for you) so that a per-task regression is
caught in seconds instead of after a full suite.

**The contract (one line, and it is the whole point of this section):** when the scoped
entrypoint resolves **no test files to evaluate** for the task (= nothing was measured), it MUST
print one line on stdout

```
SCOPED-THIN selected=0
```

and still exit **0**. The marker is matched **at the start of a line** (after trimming) — a
sentence that merely *mentions* `SCOPED-THIN` somewhere in its middle is not a match.

**Why this is required, not a nicety.** Exit-code-only signalling cannot tell "I ran your tests
and they passed" apart from "I ran nothing": both exit 0. quay records the two as *different
values* — `green` vs `not-evaluated` — and the only witness to "nothing was measured" is the
entrypoint itself. Without the marker, a scoped gate that measured nothing is recorded as a pass,
which is a green that can never go red. Two real consequences you will otherwise hit:

- Tasks whose deliverable is shell/script/config files list no test files in `## Touches`, so a
  "select the test files named in Touches" entrypoint selects **zero** and, without the marker,
  silently reports success on every round.
- A human reading a `scoped-gate: ok` record cannot tell whether the gate worked at all.

**Adopt it like this:**

1. **Touches names test files ⇒ the scoped run MUST really run them.** If your selector finds the
   files the task declares but runs none of them, that is a defect in your selector, not something
   to report as success. Do **not** print the marker in this case.
2. **Touches names no test files ⇒ run the check you do have** (your own linter/contract checker/
   build) and print the marker only if that check measured nothing either. A project-delivered
   checker that genuinely ran is a real scoped run: exit 0 with no marker, and it will be recorded
   `green`.
3. **Never print the marker to make a red run green.** A non-zero exit is recorded `red`
   regardless of the marker; the marker is only read when the command exited 0.

**What quay records** (`.quay/fan-in-step-trace.jsonl`, one `scoped-gate` `step-end` record per
fan-in; `ok` is the control-flow field, `verdict` is the value):

| scoped run | `verdict` | `reason` |
|---|---|---|
| ran ≥1 test file, all green | `green` | — |
| ran ≥1 test file, some red | `red` | the failure summary (and the step fails the fan-in) |
| exit 0 + `SCOPED-THIN …` | `not-evaluated` | `scoped-thin(selected=0)` |
| no scoped command declared | `not-evaluated` | `no-scoped-command-declared` |

`not-evaluated` does **not** fail the fan-in (the full suite still runs, and it is the only thing
that actually measured the change) — it is there so that "nothing was measured" is never written
down as a pass.

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
<!-- reference-doc: orchestration/SPEC-context-injection-slimming-2026-09-19.md -->
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
<!-- reference-doc: orchestration/SPEC-quay-init-reconcile-and-native-implementation-2026-09-18.md -->
<!-- reference-doc: orchestration/SPEC-quay-self-hosts-its-own-cold-start.md -->
<!-- reference-doc: orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md -->
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
