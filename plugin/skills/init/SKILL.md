---
name: init
description: "Initialize a workspace as a quay project — write the six-file config surface (.quay/config.yml, .quay/profiles.yml, tasks/, .gitignore, .claude/launch.settings.json, .claude/settings.json) and print the explicit quay plugin install steps. Idempotent."
allowed-tools: Bash, Read
---

# init

Initialize the current workspace as a quay project. **init is a project initializer, NOT an
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
claude plugin marketplace add yaleh/quay
claude plugin install quay@quay --scope user     # or --scope project / --scope local — see below
# (or the npm-global path: npm install -g quay — its register-plugin.mjs postinstall registers the
#  marketplace source only; pass QUAY_PLUGIN_SCOPE=user|project|local to enable it in the same run)
```

⚠️ **`marketplace add` takes ONE `<source>`, not `<name> <source>`.** The two-argument form is
rejected outright (Claude Code 2.1.280: `✘ Invalid marketplace source format. Try: owner/repo,
https://..., or ./path`). The registered name is **not** aliasable either — it is the `name` field
of the source root's `.claude-plugin/marketplace.json`. And registering a *directory* here would be
wrong twice over: it pins the project to a path on one machine, and a directory source loads the
plugin **in place** with no install record — `claude mcp list` looks Connected while nothing was
ever installed. The published channel is the github source above; this repo's own dog-food channel
is the separate name `quay-dev` (directory → `<this repo>/plugin`, declared at user scope, SPEC §4b).

⚠️ **Choose `--scope` deliberately — but the value is the consumer's.** `claude plugin install`
defaults to `scope=user`, so it is always worth passing `--scope` explicitly; which value is right
depends on how you want to run quay (human ruling 2026-10-06, SPEC §4b revision):

| `--scope` | what it means | where the enable is written |
|---|---|---|
| `user` | ONE version for every project on this machine — upgrade once, here | `~/.claude/settings.json` |
| `project` | a per-project on/off switch, version pinned for that project | `<cwd>/.claude/settings.json` |
| `local` | this working copy only, not committed | `<cwd>/.claude/settings.local.json` |

⚠️ **Only the DEV channel is scope-restricted.** The published channel `quay@quay` may be enabled at
**any** of the three scopes. What the user level must not carry is the **dev** channel — the
`quay@quay-dev` key, the directory source `<this repo>/plugin`, and quay paths in `env` — because
that injects this repository's working tree into every project on the machine (STANDING goal AC-161 /
SPEC §4b). `--scope user` for `quay@quay` is a legal, deliberate choice, **not** an AC-161 violation.

### Upgrading: update IN PLACE, at the scope the record already holds

⛔ Never uninstall-then-reinstall at a different scope: for a consumer who installed at `user` scope
that recipe *removes their install* and replaces it with a project-scoped one. `claude plugin update`
upgrades in place, and guessing the wrong scope fails closed instead of moving the record:

```bash
# (1) which scope ACTUALLY holds the record? (never assume `project`)
claude plugin list --json | jq -r '.[] | select(.id=="quay@quay") | .scope' | sort -u
# (2) update IN PLACE, at that scope
claude plugin update quay@quay --scope <the scope just printed>
# (3) re-run /quay:init in the project: it re-points `.quay/plugin` at the new version's directory
```

Measured 2026-10-06 / Claude Code 2.1.290 in a throwaway `CLAUDE_CONFIG_DIR`, at both scopes:

- version unchanged ⇒ `✔ quay is already at the latest version (0.15.0).`, exit 0, and
  `installed_plugins.json` is byte-identical — safe to run speculatively;
- version changed (0.15.0 → 0.99.0) ⇒ `✔ Plugin "quay" updated from 0.15.0 to 0.99.0 for scope
  user. Restart to apply changes.`, exit 0; the entry keeps its `scope` and its `installedAt`, and
  only `installPath` / `version` / `lastUpdated` move. Nothing is written to another scope's
  settings file;
- wrong scope ⇒ exit 1, `✘ Failed to update plugin "quay@quay": Plugin "quay" is not installed at
  scope user` — the record is not moved.

(Re-filling a *damaged* cache payload is a different problem, and `update` does not solve it:
measured 2026-09-15 / Claude Code 2.1.271 against a cache entry whose payload was empty, `update` and
a re-`install` both short-circuit on the unchanged version — 0 → 0 files.
Remove-the-record-then-install re-materialized it, 0 → 1.)

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

## `loop.doc_surfaces` — what quay is allowed to skip the full suite for

Before running the full suite, quay's mechanical fan-in classifies the task branch's delta
(`git diff --name-only <fork> HEAD`) as **doc** (the scoped + doc phases already verified it ⇒ the
full suite is skipped) or **code** (the full suite must re-run). Which paths count as doc is decided
in three states, never a bare yes/no:

| state | when | doc = |
|---|---|---|
| `registry` | the tree carries quay's own checker registry (`runner-static-gate.ts`, under the plugin's `scripts/` directory) | the paths no change/full-tier checker's `@static-object` glob matches, among quay's own surfaces |
| `declared` | no registry, and `.quay/config.yml` declares `loop.doc_surfaces` | those path prefixes, plus `tasks/` |
| `conservative-default` | neither | only `tasks/`, `goals/`, `.quay/` — the surfaces quay itself writes |

**Why you should declare it.** `quay-init` writes the conservative default so that a project is
never left without a judgment, but that default names only quay's own directories: in **your**
project a delta under `docs/`, `website/`, `notes/` — or whatever your documentation and telemetry
live in — counts as **code**, and every such task pays a full suite. Add them:

```yaml
loop:
  doc_surfaces: ["tasks/", "goals/", ".quay/", "docs/", "website/docs/"]
```

Rules of the declaration:

1. **A listed entry is a path PREFIX, matched segment-wise** — `docs` covers `docs/a/b.md` but not
   `docs-old/a.md`. A trailing slash, a leading `./` and a doubled slash are all normalised away, so
   write it the way your tree reads.
2. **Anything not listed is CODE** (fail-closed): an unrecognized path may break a suite quay cannot
   see, so it is never assumed harmless. Declaring a path quay has no checker for costs a suite run;
   failing to declare a path a checker reads loses a verification. Only one of those is recoverable.
3. **`tasks/` is always doc**, declared or not — it is the fan-in's own task file, already covered by
   the scoped and doc phases.
4. **The declaration is yours.** `quay-init` writes it only when the key is absent; a value you set
   is preserved verbatim by every upgrade.
5. **It only applies where there is no registry.** A tree carrying quay's checker registry (i.e.
   quay itself) is judged by that registry — so **do not commit a copy of that registry into your
   project** to make classification "work": it does not fix the judgment, it makes quay's checker
   list decide your project's doc/code split.

Run the judgment yourself, on any set of paths:

```bash
node --experimental-strip-types <plugin-root>/scripts/select-static-checks-for-touches.ts \
     --classify-delta --root . docs/a.md server/x.ts
```

It prints the CODE paths (one per line, empty = the whole delta is doc) and always exits 0 for
well-formed input — no registry required.

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
<!-- reference-doc: orchestration/SPEC-goal-author-branch-2026-10-05.md -->
<!-- reference-doc: orchestration/SPEC-goal-branch-2026-10-03.md -->
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
<!-- reference-doc: orchestration/SPEC-plugin-surface-area-by-usage-evidence-2026-10-05.md -->
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
