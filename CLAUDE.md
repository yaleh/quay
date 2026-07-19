# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`quay` is a **provider-agnostic task board**: a small **Core** CLI/MCP client + a pluggable
**Provider ABI** for where tasks actually live. This same repo is ALSO the live workspace of a BAIME
(Bootstrapped AI Methodology Engineering) research experiment where quay's own backlog is driven by
an autonomous loop under `experiments/`. Both layers coexist — the `packages/` code is the product;
`experiments/` + `tasks/` + `docs/proposals/` are the methodology/research layer.

## Commands

No `package.json` scripts and no build step (plain ESM Node ≥20; repo developed on Node 25). `npm install` at the root (npm workspaces, `packages/*`).

- **Run the CLI:** `node packages/quay/bin/quay.js <cmd>` (Core), `node packages/quay-native/bin/quay-native.js <cmd>` (native provider directly).
- **Tests** (Node's built-in runner, `.mjs` under each package's `test/`):
  - Full package: `cd packages/quay && node --test test/*.mjs`
  - Single file: `node --test packages/quay/test/gate.test.mjs`
  - Single test by name: `node --test --test-name-pattern="flag before id" packages/quay/test/gate.test.mjs`
  - Coverage: `node --test --experimental-test-coverage test/*.mjs`
  - **Two suites hit LIVE GitHub (`test/serve-github.test.mjs`, `test/provider-abi-conformance.test.mjs`)** — they FAIL offline / when github.com/yaleh/quay state drifts. Exclude them for a clean local run: `node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')`.
  - Tests build a temp workspace with a real `.quay/config.yml` (see `makeWorkspace()` in a test file) — a bare tasks dir is NOT a valid workspace; the config is a **provider map** with `mcp_entry`/`path`/`env`, not a flat tasks path.
- **Web UI:** `node packages/quay/bin/quay.js serve --port <p>` (renders task bodies as markdown; reads the task store live per request).

## Architecture — the product (`packages/`)

Three packages, one ABI:

| Package | Role |
|---|---|
| `packages/quay` | **Core** — provider-agnostic CLI + web UI (`src/serve.js`) + MCP client/server (`src/mcp-server.js`). Talks to whichever provider is `enabled` in `.quay/config.yml` over the Provider ABI. |
| `packages/quay-native` | **Native provider** (reference) — a **markdown+YAML-frontmatter task store on local disk** (`tasks/*.md` ARE the data). CLI + MCP server. |
| `packages/quay-github` | **GitHub provider** — maps GitHub Issues onto the same task view-model. Proves the ABI transfers. |

Key cross-cutting facts (require reading several files to see):
- **Core is written against the task view-model only**, never a specific backend. A task = `{id, title, status, role (primitive|compound), labels, parent/children, body}`; the `body` markdown carries `## Proposal / ## Plan / ## Acceptance Criteria / ## Definition of Done` sections. Providers translate to/from this shape.
- **`.quay/config.yml`** (per-workspace) is the provider map: which provider is enabled, its `path`, `tasks_dir`, `mcp_entry`, `env`. `QUAY_NATIVE_TASKS_DIR` selects the native store's directory.
- **Core CLI `task edit` is status-only in v1** (QN-024) for backward compat unless full flags are given — for a body/extra/labels write, prefer MCP `task_write` or the native provider's own richer `quay-native task edit`. (Full-field parity was later added — see `packages/quay/bin/quay.js` help; when in doubt check which surface you're on.)
- **Gate engine ("QENG")** — `packages/quay/src/gate/{engine,registry,gate-event-store,gate-log,acceptance-runner,lifecycle,driver}.js`, exposed as verb-less CLI commands `gate` / `gate-log` / `complete` / `adjudicate` / `promote` / `retreat` / `run`. Gates evaluate a named check and append an immutable **GateEvent** to `<workspaceRoot>/.quay/gate-events.jsonl` (gitignored). `quay gate <task>` defaults to the `acceptance` gate (runs `task.extra.acceptance` as a shell command, fail-closed if unset); lifecycle transitions live in `lifecycle.js` (`todo→ready→done`, terminal `needs-human`). "The meter is runnable, not asserted."

## Architecture — the methodology layer (`experiments/`, `tasks/`, `docs/`)

- **`experiments/quay-perpetual-stream/`** is the active BAIME experiment (exp5): an autonomous outer loop that builds quay one milestone at a time. **`OUTER-LOOP.md` is the driver document** (the operational loop); `inherited-core.md` is the pinned methodology; `dashboard.md` is mutable outer state; `scripts/it0-*.{sh,mjs}` are the mechanical gates (notably `it0-dod-check.mjs` — the **DoD meta-enforcer**, Clauses 0-9, fixture-pinned by `dod-fixture-selfcheck.sh`).
- **The loop runs directly on `master`** (there is no driver branch — DIR-027 retired it). Per-milestone work happens in `milestones/M<NN>/worktrees/iteration-{0,1}` worktrees merged into `master` at ABSORB.
- **`.halt` sentinel** (`experiments/quay-perpetual-stream/.halt`) pauses the loop at the next milestone boundary. **When editing while the loop may run, follow DIR-027 human-steering hygiene: pause via `.halt`, OR work in a private git worktree off `master` and fast-forward at a clean window** — never race the loop on `master`.
- **Directives are TASK-CANONICAL** (DIR-028 / "Plan A", the single-source-of-truth principle): a directive is a `label:directive` quay task (`tasks/DIR-NNN.md`) and nothing else — there is no `directives/*.md` file, no projection, no anti-drift check (all retired). Create/steer via the `quay-directive` skill. Milestone candidates are `label:milestone-candidate` tasks; `backlog.md`/`dashboard.md` are **generated views** of the task store, not hand-edited sources.
- Recurring design principle enforced across this repo (see `docs/proposals/exp5-crystallization-strategy.md`): **single source of truth + executable invariants over prose.** When you find content living in two places (a file + a task copy; a charter copying a task's AC/DoD; a status in a field AND a body line), that is drift — fix the SOURCE (usually a doc/skill/template that generated it), not just the artifact.

## Reference docs

- `README.md` — install/usage + the three-package overview.
- `packages/quay/DESIGN.md`, `docs/proposals/quay-proposal.md` — Core architecture + Provider ABI rationale.
- `docs/proposals/exp5-crystallization-strategy.md` — the current "molten prose → executable single-source" direction (canonical task schema, formalized prompt-doc style).
