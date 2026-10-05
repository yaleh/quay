# quay plugin

quay plugin v0.16.0-dev — distributes the quay MCP server, skills, vendored agent types, and distributable workflows and gate scripts.

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
/quay:init --force         # Overwrite on conflict
/quay:init --dry-run       # Preview only
```

The former `--gate-scripts` category is **RETIRED** (2026-08-05): the classic-pipeline era gate
scripts it laid into `scripts/gates/` had no callers in target projects — dead weight shipped to
every install (layered retirement; the files remain in the plugin tree but are not laid down or
synced). The live fast-mode gate scripts ship with `--loop` via `plugin/scripts/`.

**Source → target mapping:**

| Source (`${CLAUDE_PLUGIN_ROOT}/`) | Target |
|---|---|
| `workflows/*.js` | `.claude/workflows/` |
| `agents/*.md` | `.claude/agents/` |

Behavior: idempotent (skips identical files), conflict-aware (reports but does not overwrite without `--force`).

## Distributed assets

### Workflows (`plugin/workflows/`)

- `drain-directives.js` — drains pending directives (Schedule → Dispose → Verify)
- `run-routines.js` — standing routine discovery track
  (execute-milestone.js and prepare-milestone.js were retired with the classic milestone loop — ADR-022 /
  gap-retire-the-prepare-execute-pipeline-cluster)

### Retired gate scripts (`plugin/gate-scripts/` — RETIRED, not distributed)

The classic-pipeline era gate scripts in `plugin/gate-scripts/` are **RETIRED** (2026-08-05):
they were laid into `scripts/gates/` in target projects but nothing called them (dead weight).
They remain in the tree as a historical artifact (分层退休 / layered retirement) but are
**no longer laid down by quay-init and no longer synced by sync.sh**. The live
fast-mode gate scripts ship under `plugin/scripts/` via the `--loop` category instead.

### Agent types (`plugin/agents/`)

- `quay-task.md` — task CRUD/lifecycle agent, the single ABI-only entry point for task operations

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
- Experiments directory contents (the canonical gate-script sources live in `experiments/`, never shipped from there)
