# Distributing quay workflows, agents, and gate scripts to target workspaces

- **Status:** PROPOSAL — analysis and design, no code changes applied. Records the
  distribution gap discovered during cross-workspace analysis (quay → archguard) and
  proposes a phased path to close it. No directive has been filed; adoption, if any,
  should enter through the normal directive channel.
- **Date:** 2026-07-24
- **Context:** a structured survey of what a target project (here, `yaleh/archguard`,
  live at `/home/yale/work/archguard`) needs from quay to run an autonomous loop,
  compared against what the quay Claude Code plugin actually delivers today. The
  trigger was the observation that workflows are not distributable through the
  current plugin system, and the question of what else is missing.
- **Related:**
  [`exp5-driver-deliverability-packaging.md`](./exp5-driver-deliverability-packaging.md)
  — the earlier packaging analysis that decomposed the perpetual-stream harness into
  Layers A/B/C and recommended a plugin deliverable. This proposal is the concrete
  distribution-mechanism design that the earlier analysis deferred. ·
  [`proposal-quay-driver.md`](./proposal-quay-driver.md) ·
  [`baime-lite-driving-external-projects.md`](./baime-lite-driving-external-projects.md)
  · `experiments/quay-perpetual-stream/OUTER-LOOP.md` (the engine) ·
  `packages/quay/src/mcp-server.ts` (the quay MCP aggregator).

---

## 1. The gap — what quay delivers vs what target workspaces receive

### 1.1 What the quay plugin delivers today

The quay plugin (v0.3.20, installed from directory marketplace
`/home/yale/work/quay/plugin/`) distributes:

| Asset | Plugin mechanism | Installed at | Resolved via |
|-------|-----------------|--------------|--------------|
| MCP server (quay aggregator + native/github providers) | `.mcp.json` → `mcpServers.quay` | `${CLAUDE_PLUGIN_ROOT}/vendor/quay/` | MCP tool registry |
| Skills (author, execute, quay-directive, loop-driver) | `plugin.json` → `commands[]` | `${CLAUDE_PLUGIN_ROOT}/skills/` | Skill tool, namespaced as `quay:*` |
| Scripts (routine-scheduler, routine-file-gate, read-probe-spec, concurrent-batch-scheduler, task-schema-check, etc.) | Convention: `scripts/` directory | `${CLAUDE_PLUGIN_ROOT}/scripts/` | `${CLAUDE_PLUGIN_ROOT}/scripts/` in skill bodies |
| Probes (self-validation, history-mining, architecture-analysis) | Convention: `probes/` directory | `${CLAUDE_PLUGIN_ROOT}/probes/` | `${CLAUDE_PLUGIN_ROOT}/probes/` via readProbeSpec |
| Vendored provider code | `vendor/` directory | `${CLAUDE_PLUGIN_ROOT}/vendor/quay/` | `.mcp.json` command path |

### 1.2 What is NOT distributed

Three categories of assets that exist in the quay repository but are **not** carried
by the plugin:

**Category 1 — Workflows (`.claude/workflows/*.js`)**
- `drain-directives.js` — drains pending directives (Schedule → Dispose → Verify)
- `execute-milestone.js` — full milestone pipeline (Verify → Build → Audit → Gate → Land)
- `run-routines.js` — standing routine discovery track (Schedule → Dispatch → Gate → Verify)

These are harness-native JavaScript files executed by Claude Code's `Workflow` tool.
The tool requires scripts to be in the workspace's `.claude/workflows/` directory or
passed as inline script text — there is no `${CLAUDE_PLUGIN_ROOT}/workflows/`
convention and the plugin manifest has no `workflows` field.

**Category 2 — Agent types (`.claude/agents/*.md`)**
- `baime:iteration-executor` — the inner-iteration build agent that exp5 dispatches
- (currently none bundled in quay's plugin; baime ships its own agent types)

The baime plugin *does* distribute agent types via `plugin.json` → `agents[]`,
proving the mechanism works. The quay plugin does not yet declare any agents, so
target workspaces that want quay-specific agent types (e.g. a directive-drainer, a
routine-probe-runner) must copy them manually.

**Category 3 — Gate scripts (`experiments/quay-perpetual-stream/scripts/it0-*.sh`)**
- `it0-ceiling-check.sh`, `it0-gate-hash-check.sh`, `it0-dogfood-evidence-gate.sh`
- `it0-dod-check.sh` (the DoD meta-enforcer)
- `vmeta-lag-check.sh`, `it0-impl-row-check.sh`, `it0-dashboard-line-budget-check.sh`
- `tree-hygiene-check.sh`, `worktree-branch-hygiene-check.sh`
- `audit-independence-check.sh`, `it0-ceiling-line-budget-check.sh`
- `drain-scheduler.ts` (the DRAIN classifier)

These are quay-experiment-specific mechanical gate checks referenced by the
perpetual-stream workflows. A target workspace with simple gates (e.g.
archguard's `npx vitest run`) does not need them, but a workspace that wants to adopt
quay's multi-gate quality discipline does.

### 1.3 The plugin capability matrix (what Claude Code plugins can declare)

Verified against installed plugin manifests for quay, baime, and meta-cc:

| Manifest field | Purpose | Used by quay? | Used by baime? |
|----------------|---------|---------------|----------------|
| `commands[]` | Skills | ✅ 4 skills | ✅ 28 skills |
| `agents[]` | Agent types (`.claude/agents/*.md`) | ❌ | ✅ 4 agents |
| `.mcp.json` | MCP server declarations | ✅ quay aggregator | ❌ (skills-only plugin) |
| `workflows[]` | **Does not exist** | — | — |
| `gateScripts[]` | **Does not exist** | — | — |

**Finding:** The `agents[]` field works today — baime ships `iteration-executor`,
`iteration-prompt-designer`, `knowledge-extractor`, and `workflow-coach` through it.
The absence of `workflows[]` and a convention for gate scripts is the distribution
gap this proposal addresses.

---

## 2. Analysis — what a target workspace actually needs

### 2.1 Case study: archguard

Archguard (`/home/yale/work/archguard`) runs an autonomous development loop driven
by `quay:loop-driver`, configured through `.quay/config.yml`:

```yaml
loop:
  board: native
  gates: [vitest]          # simple gate: npx vitest run
  stop: once
  policy: ready-first
  concurrency: 4
  routines:
    - name: self-validation
      trigger: on(idle)
      dispatch: adversarial-explore       # legacy dispatch path
    - name: architecture-analysis
      trigger: every(2)
      dispatch: arch-self-analyze         # legacy dispatch path
```

**What works today (zero additional setup):**
- MCP server → `task_list`, `task_get`, `task_write`, `gate_run` against
  `quay-tasks/*.md`
- `quay:loop-driver` skill → select → isolate → build → gate → land cycle
- Routine scheduler → fires on triggers, dispatches probe agents
- Simple gate (`npx vitest run`) configured entirely in `.quay/config.yml`

**What is missing for archguard's current use pattern:**
- Nothing critical — the loop works without quay's workflows or gate scripts.
  Archguard's routines use the legacy `dispatch:` path (DIR-051), which names a
  dispatch action as a plain string interpreted by the loop-driver skill. To
  modernize to the `probe:` path (DIR-056), archguard would switch to:
  ```yaml
  routines:
    - name: self-validation
      trigger: on(idle)
      probe: self-validation          # uses ${CLAUDE_PLUGIN_ROOT}/probes/self-validation.md
  ```
  This requires no file distribution — the probes are already in the plugin.

**What archguard would need to adopt quay's multi-stage workflow model:**
- `drain-directives.js` — if archguard starts using the directive lifecycle
- `execute-milestone.js` — if archguard wants the 5-phase Verify→Build→Audit→Gate→Land pipeline
- `run-routines.js` — if archguard wants the dedicated routine workflow (currently
  routines are handled inline by loop-driver)
- Gate scripts — only if adopting quay's specific quality gates beyond vitest
- Agent types — if archguard wants custom agent definitions for its domain

### 2.2 Three tiers of target-workspace adoption

| Tier | Description | Needs from quay plugin | Distribution gap? |
|------|-------------|----------------------|-------------------|
| **Tier 1: Basic loop** | `quay:loop-driver` with simple gates, no directives, no routines | MCP server + loop-driver skill | ✅ None — fully covered |
| **Tier 2: Loop + routines** | Tier 1 + standing probe-based discovery track | Tier 1 + scripts + probes | ✅ None — probes ship with plugin; `dispatch:` path works |
| **Tier 3: Full methodology** | Tier 2 + directive lifecycle + multi-gate quality + custom agents | Tier 2 + workflows + gate scripts + agent types | ❌ Workflows and gate scripts not distributed |

Most target workspaces will start at Tier 1 or Tier 2. Tier 3 is relevant for
projects that want to replicate quay's own development methodology — the full BAIME
perpetual-stream pattern with DRAIN → SELECT → EXECUTE → CHECKPOINT.

---

## 3. Design — distribution strategies

### 3.1 Approach A: `quay init` command (the bootstrap action)

**Concept:** Add a `quay init` CLI command (or `quay:init` skill) that copies
assets from the plugin installation directory into the target workspace.

**Source → target mapping:**

```
${CLAUDE_PLUGIN_ROOT}/workflows/*.js     → <workspace>/.claude/workflows/
${CLAUDE_PLUGIN_ROOT}/agents/*.md        → <workspace>/.claude/agents/
${CLAUDE_PLUGIN_ROOT}/gate-scripts/*.sh  → <workspace>/scripts/gates/
${CLAUDE_PLUGIN_ROOT}/gate-scripts/*.ts  → <workspace>/scripts/gates/
```

**Behavior:**
- Idempotent: if a file already exists with identical content, skip it; if content
  differs, report the conflict and skip (never overwrite without explicit `--force`)
- Detects whether the target is already a quay workspace (`.quay/config.yml` present);
  if not, warns but proceeds
- Supports selective initialization: `--workflows`, `--agents`, `--gate-scripts`,
  `--all`
- Reports: copied N files, skipped M (already present), conflicted K (content differs)

**Implementation as a skill (recommended over CLI command):**

A `quay:init` skill is preferred because:
1. It runs in the target workspace's own Claude Code context, with direct filesystem
   access to `.claude/`
2. No npm package update required — the skill ships through the existing plugin
   `commands[]` mechanism
3. It can use `${CLAUDE_PLUGIN_ROOT}` to locate its own bundled assets
4. It can interrogate the workspace (`.quay/config.yml`, existing `.claude/`
   contents) and adapt its behavior

**Skill sketch (`skills/init/SKILL.md`):**

```markdown
---
name: quay-init
description: "Initialize a workspace with quay workflows, agents, and gate scripts
  from the quay plugin bundle. Idempotent — safe to run multiple times."
---

# quay-init

Copy quay methodology assets from the plugin installation into the current workspace.

## Steps

1. Read `${CLAUDE_PLUGIN_ROOT}/plugin.json` to discover available assets
2. For each asset category requested (--workflows, --agents, --gate-scripts, --all):
   - List files in `${CLAUDE_PLUGIN_ROOT}/<category>/`
   - For each file: if target does not exist → copy; if exists and content matches → skip;
     if exists and content differs → report conflict, skip
3. Report summary: copied N, skipped M, conflicted K
```

**Plugin bundling prerequisite:**

Before `quay init` can work, the plugin source directory (`/home/yale/work/quay/plugin/`)
must carry the assets to distribute. Currently it has `skills/`, `scripts/`, `probes/`,
and `vendor/`. It needs three new directories:

```
plugin/
├── workflows/           # NEW — copies of .claude/workflows/*.js
│   ├── drain-directives.js
│   ├── execute-milestone.js
│   └── run-routines.js
├── agents/              # NEW — agent type definitions for target workspaces
│   └── baime-iteration-executor.md   # vendored fallback (see §3.3)
├── gate-scripts/        # NEW — the mechanical gate checks
│   ├── it0-ceiling-check.sh
│   ├── it0-dod-check.sh
│   ├── it0-gate-hash-check.sh
│   ├── it0-dogfood-evidence-gate.sh
│   ├── it0-ceiling-line-budget-check.sh
│   ├── it0-impl-row-check.sh
│   ├── it0-dashboard-line-budget-check.sh
│   ├── vmeta-lag-check.sh
│   ├── tree-hygiene-check.sh
│   ├── worktree-branch-hygiene-check.sh
│   ├── audit-independence-check.sh
│   └── drain-scheduler.ts
├── skills/              # existing
├── scripts/             # existing
├── probes/              # existing
└── vendor/              # existing
```

**Keep-in-sync mechanism:** The plugin directory should not become a second
divergent copy. Options:
- **(a) Symlinks** — `plugin/workflows/drain-directives.js` → `../../.claude/workflows/drain-directives.js`.
  Simple, zero-drift, but fragile across git clones.
- **(b) Build script** — a `plugin/sync.sh` that copies from the canonical locations
  into `plugin/`. Run before publishing. Explicit, traceable, works across clones.
- **(c) Single source** — move the canonical copies to `plugin/` and symlink the
  other way (`.claude/workflows/` → `plugin/workflows/`). Cleanest but changes
  quay's own development layout.

**Recommendation: (b) build script** — a `plugin/sync.sh` that copies from canonical
locations. It is explicit (you can see what was synced), works everywhere, and the
sync is a deliberate pre-publish step. Add a CI check that sync is not stale.

### 3.2 Approach B: Extend the plugin manifest (upstream coordination)

**Concept:** Work with the Claude Code plugin team to add `workflows` and
`gateScripts` fields to the plugin manifest schema.

**Proposed `plugin.json` extension:**

```json
{
    "name": "quay",
    "version": "0.4.0",
    "commands": [
        "./skills/author/SKILL.md",
        "./skills/execute/SKILL.md",
        "./skills/quay-directive/SKILL.md",
        "./skills/loop-driver/SKILL.md",
        "./skills/init/SKILL.md"
    ],
    "agents": [
        "./agents/baime-iteration-executor.md"
    ],
    "workflows": [
        "./workflows/drain-directives.js",
        "./workflows/run-routines.js"
    ],
    "gateScripts": [
        "./gate-scripts/*.sh",
        "./gate-scripts/*.ts"
    ]
}
```

**Install-time behavior:**

When a user runs `/plugin install quay@quay` in a workspace that has the plugin
already enabled at user scope, the installer:

1. Detects `workflows` and `gateScripts` in the manifest
2. Prompts: "quay v0.4.0 wants to install 2 workflows and 12 gate scripts into this
   workspace. Allow? [y/N]"
3. On approval: copies files to `.claude/workflows/` and `scripts/gates/`
   respectively
4. Records installed versions in workspace metadata for update detection

**Advantages over Approach A:**
- Managed lifecycle — plugin updates can prompt to update workflows
- Discoverable — the plugin manifest is the single declaration of what the plugin
  provides
- No separate init step — assets arrive with the plugin

**Disadvantages:**
- Requires upstream Claude Code changes (not under quay's control)
- Automatic overwrite risk — if a workspace has modified a workflow, the update
  prompt must handle merge/conflict gracefully
- Plugin installs are user-scoped, but workflows are workspace-scoped — the
  installer must handle the mismatch (install once, deploy to many workspaces)

**Relationship to Approach A:** Approaches A and B are complementary, not competing.
Approach A works today without any upstream dependency. Approach B, when available,
makes distribution automatic. The `quay:init` skill from Approach A becomes the
**backend** that Approach B's installer delegates to — same copy logic, two
invocation paths (manual via skill, automatic via plugin installer).

### 3.3 Approach C: Vendoring the baime agent dependency

A cross-cutting concern: workflows like `execute-milestone.js` dispatch
`baime:iteration-executor` as a subagent. If the target workspace does not have the
baime plugin installed, this dispatch fails silently.

**Assessment of the dependency:**

The `execute-milestone.js` workflow's Build phase dispatches the iteration executor
with a charter-only prompt. Per the analysis in
`exp5-driver-deliverability-packaging.md` §4, the executor's runtime dependency on
the full baime meta-agent tree is **unverified** — it may degrade gracefully
(charter + inherited-core carry all needed guidance) or it may hard-fail (the
`verify(complete)` on its line 12 treating an empty `meta-agents/*.md` read as an
error).

**Recommendation (conditional, same as the prior analysis):**

1. **First, empirically resolve the vendoring caveat** — run the executor against a
   charter in a sandbox with no baime `meta-agents/`/`agents/` tree reachable and
   confirm it resolves entirely from charter + inherited-core.
2. **If it degrades gracefully:** vendor the single agent file
   `plugin/agents/baime-iteration-executor.md` in the quay plugin. A target workspace
   that runs `quay init --agents` gets the agent without needing the baime plugin.
3. **If it requires the meta-agent tree:** either (a) vendor the full transitive
   closure (still bounded, but larger than one file), or (b) declare baime as a
   prerequisite plugin (documentation dependency — cheapest but brittle).

This is recorded here as a design decision that must be resolved before the agent
distribution path is finalized. It does not block the workflow and gate-script
distribution paths, which have no external dependencies.

---

## 4. What changes in the quay repo

### 4.1 Plugin directory restructure

```
plugin/
├── .claude-plugin/
│   ├── plugin.json              # add init skill to commands[]; add agents[]
│   └── marketplace.json         # update description, version bump
├── .mcp.json                    # unchanged
├── skills/
│   ├── author/SKILL.md          # existing
│   ├── execute/SKILL.md         # existing
│   ├── quay-directive/SKILL.md  # existing
│   ├── loop-driver/SKILL.md     # existing
│   └── init/SKILL.md            # NEW — the bootstrap skill (§3.1)
├── workflows/                   # NEW — synced from .claude/workflows/
│   ├── drain-directives.js
│   ├── execute-milestone.js
│   └── run-routines.js
├── agents/                      # NEW — synced + vendored
│   └── baime-iteration-executor.md   # vendored from baime (conditional on §3.3)
├── scripts/                     # existing
├── probes/                      # existing
├── gate-scripts/                # NEW — synced from experiments/quay-perpetual-stream/scripts/
│   ├── it0-ceiling-check.sh
│   ├── it0-dod-check.sh
│   ├── it0-gate-hash-check.sh
│   ├── it0-dogfood-evidence-gate.sh
│   ├── it0-ceiling-line-budget-check.sh
│   ├── it0-impl-row-check.sh
│   ├── it0-dashboard-line-budget-check.sh
│   ├── vmeta-lag-check.sh
│   ├── tree-hygiene-check.sh
│   ├── worktree-branch-hygiene-check.sh
│   ├── audit-independence-check.sh
│   └── drain-scheduler.ts
├── vendor/                      # existing
└── sync.sh                      # NEW — sync script (§4.2)
```

### 4.2 Sync script (`plugin/sync.sh`)

A mechanical script that copies canonical files into the plugin directory. Run
manually before plugin publication; verified by CI.

```bash
#!/usr/bin/env bash
# plugin/sync.sh — sync canonical assets into the plugin distribution directory.
# Run from repo root. Idempotent (overwrites on each run).

set -euo pipefail
PLUGIN_DIR="$(dirname "$0")"
REPO_ROOT="$(cd "$PLUGIN_DIR/.." && pwd)"

# Workflows
cp "$REPO_ROOT/.claude/workflows/drain-directives.js"   "$PLUGIN_DIR/workflows/"
cp "$REPO_ROOT/.claude/workflows/execute-milestone.js"  "$PLUGIN_DIR/workflows/"
cp "$REPO_ROOT/.claude/workflows/run-routines.js"       "$PLUGIN_DIR/workflows/"

# Gate scripts
GATE_DIR="$REPO_ROOT/experiments/quay-perpetual-stream/scripts"
cp "$GATE_DIR/it0-ceiling-check.sh"              "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-dod-check.sh"                  "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-gate-hash-check.sh"            "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-dogfood-evidence-gate.sh"      "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-ceiling-line-budget-check.sh"  "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-impl-row-check.sh"             "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-dashboard-line-budget-check.sh" "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/vmeta-lag-check.sh"                "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/tree-hygiene-check.sh"             "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/worktree-branch-hygiene-check.sh"  "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/audit-independence-check.sh"       "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/drain-scheduler.ts"                "$PLUGIN_DIR/gate-scripts/"

# Agent (conditional — only if vendoring decision resolved, §3.3)
# cp "$VENDORED_AGENT" "$PLUGIN_DIR/agents/baime-iteration-executor.md"

echo "Sync complete."
```

**CI check (`.github/workflows/plugin-sync-check.yml` or equivalent):**
Run `plugin/sync.sh` and then `git diff --exit-code plugin/` — if the sync produces
changes, the check fails, meaning someone edited a canonical file without re-syncing.

### 4.3 The `quay:init` skill

A new skill at `plugin/skills/init/SKILL.md` (also symlinked or synced to
`.claude/skills/quay-init/` for quay's own use). The skill:

1. Parses arguments: `--workflows`, `--agents`, `--gate-scripts`, `--all` (default:
   `--all`)
2. For each requested category, reads `${CLAUDE_PLUGIN_ROOT}/<category>/` and copies
   files to the workspace's `.claude/<category>/` or `scripts/gates/`
3. Reports a structured summary

The skill body is the detailed implementation.

### 4.4 Plugin manifest update (`plugin.json`)

```json
{
    "name": "quay",
    "version": "0.4.0",
    "description": "quay: a provider-agnostic task board. Bundles the quay MCP server, the quay-directive and loop-driver skills, the init bootstrap skill, vendored agent types, and distributable workflows and gate scripts.",
    "author": {
        "name": "Yale Huang",
        "url": "https://github.com/yaleh"
    },
    "license": "MIT",
    "homepage": "https://github.com/yaleh/quay",
    "repository": "https://github.com/yaleh/quay",
    "commands": [
        "./skills/author/SKILL.md",
        "./skills/execute/SKILL.md",
        "./skills/quay-directive/SKILL.md",
        "./skills/loop-driver/SKILL.md",
        "./skills/init/SKILL.md"
    ],
    "agents": [
        "./agents/baime-iteration-executor.md"
    ]
}
```

Note: `workflows` and `gateScripts` are **not** declared in `plugin.json` today
because the plugin system does not recognize those fields. They exist as directories
alongside the manifest, reachable via `${CLAUDE_PLUGIN_ROOT}`, and are copied by the
`quay:init` skill. If/when the plugin system adds those manifest fields, they can be
added to `plugin.json` in a later version.

---

## 5. User experience — the target-workspace operator's view

### 5.1 New workspace setup (archguard example)

```bash
# 1. Already done: quay plugin installed at user scope
#    /plugin install quay@quay  (one-time)

# 2. Configure .quay/config.yml (already done for archguard)

# 3. Initialize quay methodology assets
claude> /quay:init --all

# Output:
# quay-init: scanning ${CLAUDE_PLUGIN_ROOT}
#   workflows:    3 copied  (drain-directives, execute-milestone, run-routines)
#   agents:       1 copied  (baime-iteration-executor)
#   gate-scripts: 11 copied (it0-*, vmeta-lag, tree-hygiene, ...)
#   skipped:      0
#   conflicts:    0
# Done. Workspace initialized with quay methodology assets.

# 4. Verify
claude> /drain-directives   # workflow is now available
claude> /run-routines       # workflow is now available
```

### 5.2 Updating an initialized workspace

```bash
# After a quay plugin update that includes newer workflow versions:
claude> /quay:init --workflows

# Output:
# quay-init: scanning ${CLAUDE_PLUGIN_ROOT}
#   workflows:    0 copied
#   skipped:      1 (drain-directives.js — identical)
#   conflicts:    2 (execute-milestone.js, run-routines.js — content differs)
#
# Conflicts detected. The workspace has local modifications to these workflows.
# To overwrite: /quay:init --workflows --force
# To see diffs: diff .claude/workflows/execute-milestone.js ${CLAUDE_PLUGIN_ROOT}/workflows/execute-milestone.js
```

### 5.3 Selective initialization (Tier 1 workspace)

A workspace that only wants the basic loop (Tier 1, §2.2) needs zero initialization
— the MCP server and loop-driver skill are already available through the plugin.

A Tier 2 workspace (loop + routines) also needs nothing — probes ship with the
plugin and the `probe:` path resolves through `${CLAUDE_PLUGIN_ROOT}`.

Only Tier 3 workspaces (full methodology) need `quay init`. This is by design: the
init step is only required when the workspace wants quay's full multi-stage
development methodology, not just the task-board + loop-driver engine.

---

## 6. What to exclude from distribution

Following the Layer A/B/C decomposition from `exp5-driver-deliverability-packaging.md`:

| Category | Distribute? | Rationale |
|----------|-------------|-----------|
| Workflows (drain-directives, execute-milestone, run-routines) | **Yes** | Layer A — domain-independent engine |
| Gate scripts (it0-*.sh, vmeta-lag, tree-hygiene, etc.) | **Yes** | Layer A — mechanized quality checks |
| Agent types (baime-iteration-executor) | **Conditional** | Layer A — but see §3.3 caveat |
| `OUTER-LOOP.md` (driver prompt) | **No** | Layer A engine, but delivered as the `quay:loop-driver` skill, not a raw prompt file |
| `inherited-core.md` (methodology) | **No** | Layer B (quay-specific instance config); each domain authors its own methodology |
| `dashboard.md` (runtime state) | **No** | Layer C — this run's ledger; a new instance starts from `UNINITIALIZED` |
| `backlog.md` (generated view) | **No** | Generated from the task store; not a source file |
| Probes (self-validation, etc.) | **Already distributed** | Ships with plugin; used by `probe:` path in loop config |
| Routine scripts (routine-scheduler.ts, etc.) | **Already distributed** | Ships with plugin under `scripts/` |
| MCP server + skills | **Already distributed** | Ships with plugin |

---

## 7. Implementation phases

### Phase 1: Bundle (zero user-visible change)

1. Create `plugin/workflows/`, `plugin/agents/`, `plugin/gate-scripts/` directories
2. Write `plugin/sync.sh` and run it to populate the directories
3. Verify: `find plugin/workflows plugin/agents plugin/gate-scripts -type f` shows
   all expected files
4. Add CI check for sync staleness

**Deliverable:** assets are in the plugin directory, but nothing consumes them yet.

### Phase 2: The `quay:init` skill

1. Author `plugin/skills/init/SKILL.md` — the bootstrap skill
2. Add `./skills/init/SKILL.md` to `plugin.json` → `commands[]`
3. Test in quay's own workspace: `/quay:init --workflows` (should report "already
   present, skipped")
4. Test in a clean workspace or temporary directory

**Deliverable:** `/quay:init` works. Target workspaces can bootstrap.

### Phase 3: Agent vendoring resolution (gated)

1. Run the isolation test from §3.3: can `baime:iteration-executor` resolve from
   charter + inherited-core alone, with no baime meta-agent tree reachable?
2. **If yes:** vendor the single agent file into `plugin/agents/`; update sync.sh
3. **If no:** determine the transitive closure of required baime agent files; vendor
   that set; or declare baime as a prerequisite plugin with clear documentation

**Deliverable:** `quay init --agents` works, with a known-resolved dependency story.

### Phase 4: Plugin manifest extension (upstream, follow-on)

1. Propose `workflows` and `gateScripts` fields to the Claude Code plugin team
2. If accepted: add those fields to quay's `plugin.json`
3. The `quay:init` skill becomes the backend for the plugin installer's automatic
   deployment

**Deliverable:** zero-step distribution — install plugin → workflows arrive.

---

## 8. Status / next step

- No directive filed, no scaffold change applied.
- This proposal is the written record of the distribution gap analysis and the
  design for closing it.
- If adopted, Phase 1 (bundling) is mechanical and can be done immediately — it has
  zero impact on the running loop and zero user-visible change. Phase 2 (the init
  skill) is the first user-visible deliverable.
- The agent vendoring question (§3.3, Phase 3) is the only unresolved design
  decision; it can be deferred past Phase 2 without blocking workflow and
  gate-script distribution.
- Recommended entry: file a directive for Phase 1 + Phase 2 as a single milestone,
  with Phase 3 as a separate follow-on gated on the isolation test result.
