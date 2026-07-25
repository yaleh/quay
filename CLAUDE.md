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
- `adr/ADR-*.md` — first-class decision records (`quay-native adr list`). ADR-004..010 (status: proposed) crystallize the GIT-lens program; read them before extending it.
- `docs/references/` — the GIT framework (goal-closure `L_T..L_S`, 硬形变/Π_{S→E}, two-phase breathing) AND its limits: the continuous math (Fisher/natural-gradient/intrinsic-dim/ρ) is NOT rigor (ADR-006).

## Tools

- **archguard** (MCP) — static architecture analysis: the `L_D`/`L_G` instrument (dependency structure/cycles, god-packages, duplicated/reinvented abstractions) per ADR-007. Consult it before calling a milestone done.
- **meta-cc** (MCP) — search Claude Code session history (past errors, edit sequences, work patterns).
- BOTH are maintained by the repo owner, so bugs get fixed fast — use them aggressively and report/fix issues rather than working around them.
- **tmux remote-drive** (→ ADR-016) — to drive a FOREIGN workspace's Claude Code session (e.g. run archguard's `/loop` from here): `send-keys` to kick off (reliable = 3 separate calls `C-u` → text → `Enter`; combined drops the Enter), then read the RESULT from the filesystem/`git`/meta-cc — never parse the TUI. One driver per session (never race a human typing there; beware gray ghost-suggestions). This is how cross-workspace proofs (DIR-048/049/051) can run without a human round-trip.

## Process

- Development is driven via **background Claude Code workflows at milestone granularity** (→ ADR-009), with a **scheduled milestone e2e incl. browser tests** (Playwright/chrome-devtools) that keeps `L_T` on the real product surface (→ ADR-010). Follow DIR-027 steering hygiene (`.halt` or private worktree; never race the loop on `master`).

## GIT review checklist

- Before calling a milestone done, ask **which of `L_T`/`L_C`/`L_D`/`L_G`/`L_S` is still dark** (ADR-006/007) and prefer **hard checks over prose** (ADR-004 — prose gets paraphrased away). See `docs/references/` for the framework and its limits (the continuous math is not rigor).

## Workflow resume anti-pattern (M144, 2026-07-25)

When a workflow Verify phase fails and the fix is to **external state** (gap-list.md, charter file, script on disk), do NOT resume with `resumeFromRunId`. The resume cache keys on (prompt, opts) only — it cannot see that external files changed. The cached failure returns instantly (~60ms, 0 tokens) and the Verify phase fails again with the same stale result.

**Rule:** if the fix touches anything OTHER than the workflow script's own agent prompt strings, re-run the workflow from scratch (`Workflow({script: ...})` without `resumeFromRunId`). Resume is safe ONLY when the fix is a prompt-text edit within the workflow script itself.

## Glob tool unavailable in subagent sessions (M148, 2026-07-25)

The `Glob` tool is **not available in subagent sessions**. Calling `Glob` from a subagent produces "Error: No such tool available: Glob". This has been observed in meta-cc session history as a recurring error pattern.

**Rule:** when you need file-pattern matching in a subagent, use `find` via Bash instead of `Glob`. Example: `find . -name '*.js' -not -path '*/node_modules/*'` instead of `Glob({pattern: '**/*.js'})`. All Bash tools (including `find`, `grep`, `ls`) work normally in subagent sessions.
