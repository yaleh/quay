---
name: quay-init
description: "Initialize a workspace with quay workflows, agents, gate scripts, and the two-layer loop mechanism from the quay plugin bundle. Idempotent — safe to run multiple times."
allowed-tools: Bash, Read
---

# quay-init

Copy quay methodology assets from the plugin installation into the current workspace.
Source: `${CLAUDE_PLUGIN_ROOT}` (the quay plugin directory).
Target: the current workspace's `.claude/`, `plugin/scripts/`, `orchestration/`, and
`docs/analysis/` directories.

**The copy logic lives in ONE executable** — `bash ${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh`
(`gap-loop-mechanism-lives-outside-the-package-and-cannot-ship`). This skill delegates to it rather
than repeating the idempotent-copy loop inline: a second copy of the copy logic is exactly the drift
this repo keeps removing. Run the script; do not hand-reimplement its behavior.

## Arguments

```
--workflows       Copy workflows only    (plugin/workflows/     → .claude/workflows/)
--agents          Copy agents only       (plugin/agents/        → .claude/agents/)
--loop            Copy the two-layer loop mechanism (tick docs + checkers + gate + token + observation)
                  AND the workflows category — the loop execution cores reference
                  `.claude/workflows/{fan-in-execute,execute-suite-fix,pool-quality-judge}.js`, so a
                  loop without its workflows is a broken loop (AC91, gap-ac91-delivery-core-refs-
                  undelivered-files)
--all             Copy all of the above except --loop (default if no flag given)
--force           Overwrite on conflict  (default: skip and report conflict)
--dry-run         List what would happen, do not copy
```

The former `--gate-scripts` category (plugin/gate-scripts/* → scripts/gates/) is **RETIRED**
(2026-08-05): those classic-pipeline era gates were laid into every target project but nothing
called them — dead weight shipped to every install. 分层退休（Layered retirement）: the files stay
in the plugin tree but are no longer laid down or synced. The live fast-mode gate scripts ship
with `--loop` via the `plugin/scripts/` landing.

`--loop` extra parameters (see the script for the full list):

```
--test-command <cmd>   the target project's test command (OPTIONAL — when omitted, quay-init
                       DETECTS it via the ladder scripts/test.sh → package.json scripts.test →
                       go.mod → Cargo.toml, prints the detection for the human to confirm, and
                       fails closed with the searched locations if nothing is detected; an
                       explicit value always takes priority over detection. Never a guessed default.)
--repo-root <path>     the target repo root (default: the workspace being initialized)
--project <name>       project name (default: basename of the workspace)
--tmux-session <sess>  tmux session name (default: <project>-0:0.0)
```

Residue cleanup (AC4): the install DISPOSES of stale same-name product files — a file with the
same name as a loop mechanism executable but different content is a hot-copy leftover (residue),
so quay-init backs it up under `<workspace>/.quay/quay-init-backups/<ts>/` and replaces it with
the product content, reporting both. This is visible, never a silent overwrite, and needs no
`--force`. Localizable files (the tick docs) are NOT residue-cleaned: a local edit there is a
conflict, listed and left untouched (upgrade path).

## Mapping

For `--loop`, the mechanism-script landing list is **DERIVED** from the shipped skills + tick
docs' own `plugin/scripts/*` references (gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down,
Chosen-mechanism (a)) — a script referenced by a shipped skill/tick doc ships automatically, so the
table below is illustrative, not exhaustive. The `referenced ⊆ landed` invariant is enforced
mechanically by quay-init's `verify-referenced-landed` (see below).

| Plugin source (`${CLAUDE_PLUGIN_ROOT}/`) | Workspace target |
|---|---|
| `workflows/*.js` | `.claude/workflows/` |
| `agents/*.md` | `.claude/agents/` |
| `loop/orchestrator-loop-tick.md` | `orchestration/orchestrator-loop-tick.md` (byte-identical, no substitution) |
| `loop/fast-mode-loop-tick.md` | `docs/analysis/fast-mode-loop-tick.md` (byte-identical, no substitution) |
| `loop/orchestrator-tick-core.md` | `orchestration/orchestrator-tick-core.md` (byte-identical, no substitution; the ≤80-line outer exec core — `gap-ac37-exec-core-ships-with-package`) |
| `loop/fast-mode-tick-core.md` | `orchestration/fast-mode-tick-core.md` (以 orchestration/ 本为正本；plugin/loop/ 为 quay-init --loop 铺出模板——引用目标 docs/analysis 源，非 byte-identical，两副本承担不同角色；正本改动后由 inner 按正本语义落地副本) |
| `loop/manager-tick-core.md` | `orchestration/manager-tick-core.md` — **opt-in**: laid only with `--manager` (human ruling 2026-08-10: the typical path is two-layer, outer + inner), NOT in the default `--loop` set |
| `scripts/*` referenced by a shipped skill/tick doc (e.g. `fast-mode-telemetry.ts`, `monitor-mount-check.sh`, `send-keys-reliable.sh`, `session-liveness-mount.sh`, `ready-pool-check.ts`, `read-probe-spec.ts`, `task-schema-check.ts`, `quay-launch.sh`, `quay-topology.sh`, `topology-check.sh`, …) | `plugin/scripts/` |
| `scripts/` bare-name mechanism files the docs call without a `plugin/scripts/` prefix (`inner-idle-log.ts`, `it0-split-or-commit-check.ts`, `pipe-exit-code-check.sh`; `heavy-op-token.sh` was retired 2026-08-06) | `plugin/scripts/` |
| `scripts/gate-script-base.ts`, `workflow-event-schema.mjs`, `task-schema.ts`, `touches-parser.ts`, `wiring-coverage-check.ts` (transitive deps of the checkers — the laid-down mechanism must be functional) | `plugin/scripts/` |
| `scripts/session-liveness.sh` (the ONE observer; `inner-state.sh` is retired and NOT laid down) | `plugin/scripts/` |
| `.claude/launch.settings.json` (default launch template — the consumer edits model/env per project; `quay-launch.sh` materializes it, so a cold-started target's launcher does NOT fail closed; `gap-quay-init-coldstart-usability-launch-not-used-...` F4) | `.claude/launch.settings.json` |

## Loop install: local-state files (self-create) and quay reference docs

**Session topology lay-down (`gap-tmux-session-topology-no-factory-definition`):** the two-window
session factory + check (`plugin/scripts/quay-topology.sh`, `plugin/scripts/topology-check.sh`) ship
with `--loop` because the shipped cold-start / session-topology skills reference them (referenced ⊆
landed). The topology is `outer` + `inner`; manager is cross-project and NOT part of a project's
topology (`gap-manager-baked-into-project-topology-factory`). The topology **definition** itself
lives in the `quay-session-topology` skill (a plugin
skill, not laid down); cold start builds the windows by definition via the laid-down factory and
verifies them via the laid-down check. The per-project session name comes from the same config
(`orchestration/session-liveness.env` `SESSION_TMUX_SESSION`), so the factory and check address the
target's real session without a guessed default.

`--loop` does NOT lay down the following. They are referenced by the shipped tick template by
path, and are resolved as follows:

**Local-state files — declared self-create, NOT shipped empty (AC8).** These are per-project
state the loop writes to on first use. Laying down an empty factory copy would break the
byte-identical upgrade check (gap-install-rewrites-files-…): the target writes to them
immediately, so an upgrade would forever see a "user edit" and CONFLICT. The mechanical check does
not count them as missing:

| File | Self-create command (first tick / first tool run) |
|---|---|
| `orchestration/tick-log.md` | `touch orchestration/tick-log.md` (outer tick appends) |
| `orchestration/escalations.md` | `touch orchestration/escalations.md` (outer tick appends) |
| `docs/analysis/batch2-queue-state.md` | `touch docs/analysis/batch2-queue-state.md` (inner tick writes queue state) |
| `docs/analysis/contract-violations.md` | `touch docs/analysis/contract-violations.md` (task-contract-check.ts writes) |
| `orchestration/session-liveness.env` | `write_session_env` in quay-init `--loop` (SESSION_TMUX_SESSION per project; referenced by the laid orchestrator-loop-tick.md + session-liveness.sh — declared self-create so referenced ⊆ landed holds) |

**Quay-specific reference docs — referenced by the tick template but not loop deliverables.**
The shipped tick template is quay-flavored prose and references quay's own experiment/analysis docs
that do not ship with the plugin bundle. They are declared here so the mechanical check can tell a
documented reference from a genuine missing file:

| File | Why it is not shipped |
|---|---|
| `orchestration/exp6-phase1-sustained-unattended-operation.md` | quay's exp6 goals/AC/DoD — not a generic loop deliverable |
| `orchestration/throughput-decomposition.md` | quay's analysis doc — not a generic loop deliverable |
| `orchestration/outer-phase-goal.md` | retired outer-phase-goal (referenced as historical) |
| `docs/analysis/normative-prose-audit.md` | quay's audit doc — not a generic loop deliverable |
| `orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md` | quay's reliable-send crystallization doc (cold-start key-4 delivery criterion) — not a generic loop deliverable |
| `orchestration/outer-rulings-2026-08-04-A-F.md` | quay's outer rulings incl. ruling F (superseded-judgment provenance) — not a generic loop deliverable |
| `orchestration/SPEC-cut-the-waiting.md` | quay's "cut the waiting" spec (referenced by fast-mode-loop-tick §4 dispatch form rationale) — not a generic loop deliverable |
| `orchestration/REVIEW-cadence.md` | quay's daily-review cadence mechanism (referenced by the shipped manager skill as its cadence hook) — not a generic loop deliverable |
| `orchestration/manager-loop-tick.md` | quay's manager operational tick doc (the shipped manager skill's §1.5/§1.6 rules are extracted from it; its consumer landing is the same `orchestration/` path the arm-loop pointer resolves to — the pack's factory template is a runtime detail of `manager-arm-loop.sh`, not a shipped-doc reference) — not a generic loop deliverable |
| `orchestration/manager-tick-log.md` | quay's manager tick log — gitignored runtime telemetry the manager appends each tick (see `gap-manager-tick-mechanical-checks...`); referenced by the shipped manager-loop-tick template but NOT a loop deliverable — declared so referenced ⊆ landed holds |
| `orchestration/manager-anchor-check.py` | quay's own manager anchor-check tool (referenced by the opt-in manager exec core, `loop/manager-tick-core.md`) — quay-specific, not a generic loop deliverable — declared so referenced ⊆ landed holds |
| `orchestration/manager-visual-check.py` | manager's own visual-conformance tool (referenced by the shipped manager skill §10, 2026-08-17) — personal-credential-dependent (operator's Aliyun Token Plan key), structurally cannot ship as product code; quay-specific, not a generic loop deliverable — declared so referenced ⊆ landed holds. **Note (2026-08-17): the `orchestration/manager-` glob below did NOT cover this reference in practice** (`quay-init-laydown-closure.test.mjs` AC3 failed until this exact-name marker was added) — the checker's glob prefix-matching has a gap; this exact entry is the working fix, not a duplicate. |
| `orchestration/manager-` (glob) | the opt-in manager exec core's `orchestration/manager-*` glob (its own quay-local manager-layer files) — quay-specific development-process docs, not loop deliverables — declared so referenced ⊆ landed holds |
| `orchestration/orchestrator-` (glob) | the outer exec core's `orchestration/orchestrator-*` glob (its own quay-local outer-layer files) — quay-specific development-process docs, not loop deliverables — declared so referenced ⊆ landed holds |
| `plugin/loop/manager-` (glob) | the opt-in manager exec core's `plugin/loop/manager-*` glob (its own quay-local manager-layer files, pointer-only) — quay-specific, not loop deliverables — declared so referenced ⊆ landed holds |
| `orchestration/outer-tick-prompt.txt` | quay's own outer tick live-prompt file (the outer exec core's AC81 判据④ "活 prompt == 正本" points at it) — quay-specific runtime state, not a loop deliverable — declared so referenced ⊆ landed holds |
| `orchestration/SPEC-worker-driven-inner-2026-08-16.md` | quay's worker-driven-inner SPEC (referenced by the shipped manager skill's SPEC index) — quay-specific, not a generic loop deliverable |
| `orchestration/SYNTHESIS-four-gaps-2026-08-05.md` | quay's four-gap synthesis that motivated shipping the manager layer — not a generic loop deliverable |
| `orchestration/SPEC-manager-productization-2026-08-05.md` | quay's manager productization SPEC (C1–C5 constraints, build-vs-run ownership) — not a generic loop deliverable |
| `orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md` | quay's three-layer (manager/outer/inner) unified-architecture SPEC — referenced by the shipped manager/init skills, not a generic loop deliverable |
| the manager skill's SPEC methodology-source index | the SPEC files the manager skill lists as an index (AC6) are each declared reference-doc below — referenced, not batch-crystallized, not shipped |

<!-- self-create: orchestration/tick-log.md -->
<!-- self-create: orchestration/escalations.md -->
<!-- self-create: orchestration/observer-registry.conf -->
<!-- self-create: docs/analysis/batch2-queue-state.md -->
<!-- self-create: docs/analysis/contract-violations.md -->
<!-- self-create: orchestration/session-liveness.env -->
<!-- reference-doc: orchestration/exp6-phase1-sustained-unattended-operation.md -->
<!-- reference-doc: orchestration/throughput-decomposition.md -->
<!-- reference-doc: orchestration/outer-phase-goal.md -->
<!-- reference-doc: docs/analysis/normative-prose-audit.md -->
<!-- reference-doc: orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md -->
<!-- reference-doc: orchestration/outer-rulings-2026-08-04-A-F.md -->
<!-- reference-doc: orchestration/archive -->
<!-- reference-doc: orchestration/SPEC-cut-the-waiting.md -->
<!-- reference-doc: orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md -->
<!-- reference-doc: orchestration/REVIEW-cadence.md -->
<!-- reference-doc: orchestration/manager-loop-tick.md -->
<!-- reference-doc: orchestration/manager-tick-log.md -->
<!-- reference-doc: plugin/loop/fast-mode-loop-tick.md -->
<!-- reference-doc: orchestration/SYNTHESIS-four-gaps-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md -->
<!-- reference-doc: orchestration/SPEC-fan-in-ff-merge-lock-2026-08-14.md -->
<!-- reference-doc: orchestration/SPEC-manager-productization-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-cold-start-one-liner.md -->
<!-- reference-doc: orchestration/SPEC-complete-delivery-surface-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-instruments-behind-one-entry.md -->
<!-- reference-doc: orchestration/manager-phase-goal.md -->
<!-- reference-doc: orchestration/SPEC-cold-start-one-liner.md -->
<!-- reference-doc: orchestration/SPEC-methodology-layer-architecture-2026-08-25.md -->
<!-- reference-doc: orchestration/SPEC-suite-lifecycle-and-failure-semantics-2026-08-26.md -->
<!-- reference-doc: orchestration/SPEC-complete-delivery-surface-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-instruments-behind-one-entry.md -->
<!-- reference-doc: orchestration/SPEC-manager-productization-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-methodology-as-a-deliverable.md -->
<!-- reference-doc: orchestration/SPEC-no-text-substitution-at-install.md -->
<!-- reference-doc: orchestration/SPEC-one-observer-two-surfaces.md -->
<!-- reference-doc: orchestration/SPEC-outer-liveness-productization.md -->
<!-- reference-doc: orchestration/SPEC-quay-self-hosts-its-own-cold-start.md -->
<!-- reference-doc: orchestration/SPEC-state-crystallization-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-suite-speed.md -->
<!-- reference-doc: orchestration/SPEC-typed-axes-and-standing-dynamics.md -->
<!-- reference-doc: orchestration/SPEC-branching-model-integration-branch-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-integration-architecture-2026-08-05.md -->
<!-- reference-doc: orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md -->
<!-- reference-doc: orchestration/SPEC-goal-store-2026-08-09.md -->
<!-- reference-doc: orchestration/SPEC-dispatch-ordering-semantic-2026-08-13.md -->
<!-- reference-doc: orchestration/SPEC-task-status-flow-target-vs-actual-2026-08-13.md -->
<!-- reference-doc: orchestration/SPEC-per-task-suite-verification-2026-08-13.md -->
<!-- reference-doc: orchestration/manager-anchor-check.py -->
<!-- reference-doc: orchestration/manager-visual-check.py -->
<!-- reference-doc: orchestration/manager- -->
<!-- reference-doc: orchestration/manager-tick-core.md -->
<!-- reference-doc: orchestration/SPEC-tick-read-path-slimming-2026-08-14.md -->
<!-- reference-doc: orchestration/SPEC-tick-quality-2026-08-14.md -->
<!-- reference-doc: orchestration/SPEC-in-flight-semantics-2026-08-14.md -->
<!-- reference-doc: orchestration/SPEC-tick-mechanical-checks-mcp-2026-08-15.md -->
<!-- reference-doc: orchestration/SPEC-worker-driven-inner-2026-08-16.md -->
<!-- reference-doc: orchestration/orchestrator- -->
<!-- reference-doc: orchestration/outer-tick-prompt.txt -->
<!-- reference-doc: plugin/loop/manager- -->
<!-- reference-doc: orchestration/SPEC-unified-driver-architecture-2026-08-23.md -->
<!-- reference-doc: orchestration/SPEC-web-session-observability-and-control-2026-08-24.md -->
<!-- reference-doc: orchestration/SPEC-codex-session-communication-host-adapter-2026-08-24.md -->
<!-- reference-doc: orchestration/SPEC-fan-in-workflow-lock-and-S1-2026-08-26.md -->

## Behavior

For each file in the requested category, the script runs an idempotent copy:
- **Target does not exist** → copy
- **Target exists, content identical** → skip (idempotent)
- **Target exists, content differs**:
  - Without `--force`: report conflict, skip — **local changes are never overwritten** (upgrade path)
  - With `--force`: overwrite (with backup comment)
- **Source directory empty or missing** → warn, skip category (never fail)

For `--loop` tick docs, the copy is **byte-identical** — no text substitution
(gap-install-rewrites-files-…: install is configuration-driven, not text-substitution). The target's
test command / repo root / tmux session live in ONE config file (`.quay/config.yml` `loop:`), read at
runtime; the laid-down tick docs are `cmp`-identical to the product, so the upgrade path can tell a
stale install-managed copy from a genuine user edit. The `managed` copy mode handles that upgrade
distinction; a local tick-doc edit is a reported CONFLICT, never silently overwritten.

`--loop` also writes `.quay/quay-init-state.json` recording the plugin version, so a re-run after a
plugin upgrade detects "upgrade from vX to vY" and only fills the diff (per-file idempotent copy;
conflicts listed for a human, never silently overwritten).

## Steps

### 1. Parse arguments

Read the user's argument string. Default to `--all` if no category flag given. For `--loop`,
`--test-command` is optional: an explicit value is used as-is, otherwise the script DETECTS the
target project's test command (scripts/test.sh → package.json scripts.test → go.mod → Cargo.toml),
prints the detection for the human to confirm, and FAILS CLOSED naming the searched locations when
nothing is detected — never a guessed default. (AC2/AC3, gap-cold-start-…-eight-steps)

### 2. Verify plugin root

`quay-init.sh` resolves the plugin root in this order: `--plugin-root <dir>` (highest precedence),
then `${CLAUDE_PLUGIN_ROOT}`, then **self-resolution from the script's own path**
(`<plugin-root>/scripts/quay-init.sh`). The script verifies `<plugin-root>/.claude-plugin/plugin.json`
exists and **fails closed otherwise — never a silent wrong path** (gap-init-ships-a-skill-that-calls-
files-it-does-not-lay-down AC6).

### 3. Run the copy script

The host does NOT inject `CLAUDE_PLUGIN_ROOT` under Skill invocation, so determine the plugin root
first: `PLUGIN_ROOT` is the quay plugin directory containing `.claude-plugin/plugin.json` (use
`${CLAUDE_PLUGIN_ROOT}` when set; otherwise locate it yourself — the plugin install directory, or
the parent of this skill's `scripts/`). Then run:

```bash
bash "${PLUGIN_ROOT}/scripts/quay-init.sh" \
  --root "$(pwd)" \
  --plugin-root "${PLUGIN_ROOT}" \
  [--all|--workflows|--agents|--loop] \
  [--force] [--dry-run] \
  [--test-command <cmd> --project <name> --repo-root <path> --tmux-session <sess>]
```

Passing `--plugin-root` explicitly makes the call work without the injected variable, and the
script's self-resolution is the fallback when the flag is omitted. **Fail-closed is retained**: a
missing/unusable plugin root aborts with an error naming the searched location — never a silent
wrong path.

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

### 6. Next step: cold start

After `--loop` lays down the mechanism, the workspace is READY for the cold-start skill
(`/quay:cold-start`): one command that mounts the loop monitor (session-liveness.sh — the ONE
observer; inner-state.sh is retired, gap-retire-inner-state-one-observer-targets-by-parameter) via
the Monitor tool, re-creates the 20-minute outer cron, drives the inner session to start fast mode,
and asserts a real `--task-start` telemetry record in `.workflow-events/`.
The inner start is DRIVEN there, never assumed as a side effect.
