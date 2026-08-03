# quay plugin

quay plugin v0.4.0 — distributes the quay MCP server, skills, vendored agent types, and distributable workflows and gate scripts.

## Installation

```
/plugin marketplace add yaleh/quay
/plugin install quay
```

**Where the installed bytes come from (DIR-108/M172):** `.claude-plugin/marketplace.json`'s
`quay` plugin entry sources from the `dist-plugin` branch of this repo
(`{"source":"github","repo":"yaleh/quay","ref":"dist-plugin"}`), **not** the `master`
branch's `./plugin` directory. `dist-plugin` is a force-pushed orphan branch
containing a fully-built `plugin/` subtree — including the esbuild bundle
`vendor/quay/dist/quay.js`, which runs on the plugin's declared Node ≥20 floor
with no separate `npm install` (all runtime deps, e.g.
`@modelcontextprotocol/sdk`, are inlined). `.github/workflows/publish-plugin-dist.yml`
rebuilds and force-publishes that branch on every version-tag release (and on
demand via `workflow_dispatch`) by running `plugin/scripts/sync-vendor.sh` then
`plugin/scripts/publish-dist-branch.sh --push`. `master` never carries the built
bundle — only its source, `packages/quay/{bin,src}`.

**Developing quay itself** (this repo IS its own MCP runtime via `.mcp.json` →
`${CLAUDE_PLUGIN_ROOT}/vendor/quay/dist/quay.js`): the root `npm install`
`postinstall` script runs `sync-vendor.sh` automatically, so a fresh clone +
`npm install` regenerates the gitignored `plugin/vendor/quay/dist/quay.js`
locally with no manual step. Re-run `bash plugin/scripts/sync-vendor.sh` by hand
any time `packages/quay/{bin,src}` changes without a full reinstall.

## Adoption tiers

| Tier | Description | Needs from quay plugin | Setup required |
|------|-------------|----------------------|----------------|
| **Tier 1: Basic loop** | `quay:loop-driver` with simple gates, no directives, no routines | MCP server + loop-driver skill | None — plugin install only |
| **Tier 2: Loop + routines** | Tier 1 + standing probe-based discovery track | Tier 1 + scripts + probes | None — probes ship with plugin |
| **Tier 3: Full methodology** | Tier 2 + directive lifecycle + multi-gate quality + custom agents | Tier 2 + workflows + gate scripts + agent types | Run `/quay:init --all` |

Most workspaces start at Tier 1 or Tier 2. Tier 3 is for workspaces that want to replicate quay's full BAIME perpetual-stream development methodology.

## Bootstrap: /quay:init

The `quay:init` skill copies methodology assets from the plugin into the current workspace:

```
/quay:init --all           # Copy all assets (default)
/quay:init --workflows     # Copy workflows only
/quay:init --agents        # Copy agent types only
/quay:init --gate-scripts  # Copy gate scripts only
/quay:init --force         # Overwrite on conflict
/quay:init --dry-run       # Preview only
```

**Source → target mapping:**

| Source (`${CLAUDE_PLUGIN_ROOT}/`) | Target |
|---|---|
| `workflows/*.js` | `.claude/workflows/` |
| `agents/*.md` | `.claude/agents/` |
| `gate-scripts/*.sh`, `gate-scripts/*.ts` | `scripts/gates/` |

Behavior: idempotent (skips identical files), conflict-aware (reports but does not overwrite without `--force`).

## Distributed assets

### Workflows (`plugin/workflows/`)

- `drain-directives.js` — drains pending directives (Schedule → Dispose → Verify)
- `run-routines.js` — standing routine discovery track
  (execute-milestone.js and prepare-milestone.js were retired with the classic milestone loop — ADR-022 /
  gap-retire-the-prepare-execute-pipeline-cluster)

### Gate scripts (`plugin/gate-scripts/`)

- `it0-ceiling-check.sh` — milestone ceiling enforcement
- `it0-dod-check.sh` — DoD meta-enforcer
- `it0-gate-hash-check.sh` — gate hash integrity
- `it0-dogfood-evidence-gate.sh` — dogfood evidence
- `it0-ceiling-line-budget-check.sh` — line budget enforcement
- `it0-impl-row-check.sh` — implementation row verification
- `it0-dashboard-line-budget-check.sh` — dashboard line budget
- `it0-backlog-projection-check.sh` — backlog projection
- `vmeta-lag-check.sh` — value meta lag detection
- `tree-hygiene-check.sh` — repository tree hygiene
- `worktree-branch-hygiene-check.sh` — worktree branch hygiene
- `audit-independence-check.sh` — audit independence verification
- `drain-scheduler.ts` — DRAIN classifier

### Agent types (`plugin/agents/`)

- `baime-iteration-executor.md` — iteration executor agent (vendored from baime)

**Agent dependency declaration:** The `baime:iteration-executor` agent references meta-agents, capabilities, and skills defined by the baime plugin. For full functionality, install the baime plugin alongside quay. Without baime, the agent's lifecycle phases that reference `meta-agents/*.md` and baime-specific skills will degrade — the agent shell is present but the runtime ecosystem it expects may be incomplete.

## Sync: keep plugin assets current

Run `plugin/sync.sh` from the repo root to sync canonical sources into the plugin directory:

```bash
./plugin/sync.sh && git diff --exit-code plugin/
```

CI enforces this: if canonical sources are edited without re-syncing, the CI check fails.

## Exclusions

Per the Layer A/B/C decomposition, the following are intentionally NOT distributed:

- `OUTER-LOOP.md` — delivered as the `quay:loop-driver` skill
- `inherited-core.md` — each domain authors its own methodology
- `dashboard.md` / `backlog.md` — generated views, not source files
- Experiments directory contents beyond the gate scripts listed above
