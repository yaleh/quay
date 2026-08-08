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

- **Node floor (source execution):** the source CLI runs via `node --experimental-strip-types`,
  which requires **Node ≥ 22.6** (gap-no-active-node-version-check-users-cant-tell-upgrade). The
  pure-JS entry `packages/quay/bin/quay.js` probes `process.versions.node` and fails with a clear
  upgrade message on older Node (instead of node's bare `bad option`); it then spawns the real TS
  CLI under `--experimental-strip-types`. The shipped npm bin (`dist/quay.js`) is a bundle that runs
  on the **dist floor (Node 20, `dist-verify-node-floor` CI)** — the source and dist floors are
  judged separately.
- **Run the CLI:** `node packages/quay/bin/quay.js <cmd>` (Core, version-probing entry), or
  `node --experimental-strip-types packages/quay/bin/quay.ts <cmd>` on Node ≥ 22.6,
  `node --experimental-strip-types packages/quay-native/bin/quay-native.ts <cmd>` (native provider directly).
- **Tests** (Node's built-in runner, `.mjs` under each package's `test/`):
  - **Canonical entrypoint: `scripts/test.sh`** (ADR-019/DIR-109) — the single script both this
    file and `.github/workflows/ci.yml` invoke; it owns the test-file glob
    (`packages/*/test/*.test.mjs plugin/test/*.test.mjs`) and derives its default concurrency
    from `max(1, floor(nproc / 1.0))` = nproc (gap-no-resource-awareness-heavy-ops-run-blind AC5;
    AMPLIFICATION was 2.1 until the cost-side experiment ran 2026-08-08 —
    `gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible` AC1/AC3: zero
    cancelled at concurrency 4 AND 8, nproc is the wall-clock sweet spot, "avoid cancel" refuted;
    the old hardcoded 8 was a 4.25× oversubscription on 4 cores — 8 workers + spawned subprocesses
    = 17 processes; see `gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived`
    for the 2026-08-03 TEMPORARY pin to 8 and its 2026-08-06 revert to the derived form — the
    dead-code-after-return static check bans that pin shape from returning). The 17-process
    oversubscription number is the cross-annotation baseline of
    `gap-test-concurrency-cap-does-not-scope-nested-spawns`: the derivation is now BUDGET-AWARE —
    default = `max(1, floor((nproc − in_use) / 1.0))` where `in_use` = node-MainThread processes
    already running across ALL worktrees (single authority `plugin/scripts/process-budget.sh`,
    total_budget = nproc), so nested spawns can no longer multiply beyond the total budget. An explicit
    `--test-concurrency=N` always overrides (ci.yml pins it for the 10-minute budget). The full-suite default path
    also consults the shared resource gate (`plugin/scripts/resource-gate.sh --for full-suite`) and exits
    non-0 on WAIT. Do not hand-write a new copy of the glob or an exclusion list elsewhere — edit the script.
  - Full safe-by-default suite: `scripts/test.sh` (no args)
  - Single file: `scripts/test.sh packages/quay/test/gate.test.mjs`
  - Single test by name: `scripts/test.sh --test-name-pattern="flag before id" packages/quay/test/gate.test.mjs`
  - Coverage: `scripts/test.sh --experimental-test-coverage` (flags-only form KEEPS the default
    glob — extra node `--test` flags alone run the same selected set, `--test-concurrency=N` and
    friends still last-flag-win over the derived default; every glob-selected run self-reports
    `selected N files (groups=…)`). Flags-only value flags MUST use the `=` spelling
    (`--test-concurrency=4`); a space-separated value (`--test-concurrency 4`) is treated as a file
    path and silently auto-discovers (see scripts/test.sh header).
    For a coverage run over an explicit subset: `scripts/test.sh --experimental-test-coverage packages/quay/test/*.mjs`.
  - **SCOPED STATIC-CHECK TIER** (gap-scoped-runs-pay-full-static-check-overhead, AC1/AC2/AC6): a
    task-scoped run (`scripts/test.sh --for-task <id>` / `--scoped <id>`, the inner loop's per-task
    verification) runs the **change-relevant** static-check subset — checkers whose object intersects
    the task's `## Touches` (e.g. test-framework-policy/test-isolation when a test file is touched,
    the doc/shell ratchets when their objects are touched) PLUS the `## Contract` consumer on the
    TOUCHED task files (`--strict-subset`, AC4-i) — **skipping** `checker-mutation-check` (~13s) and
    the unrelated repo-level ratchets. The mapping is MECHANICAL: `plugin/scripts/
    select-static-checks-for-touches.ts` parses the `# @static-tier <always|change|full>` /
    `# @static-object <glob>…` annotations in `scripts/test.sh`'s `run_static_checks()` (the same
    single source checker-mutation-check.sh parses — never a hand-maintained list, AC3). The COMPLETE
    set (run_static_checks) is byte-unchanged and always runs in full-suite mode (`scripts/test.sh`
    no-args / `--static-checks`) — the outer verification-round gate is NOT weakened (AC2). Trade-off
    (AC6): **scoped = fast feedback on the change; full = complete gate.** A scoped skip is DEFERRED
    to the full-suite gate, never dropped — an unrelated repo-level ratchet violation is not caught by
    the scoped run and MUST be caught by the full run (AC4-ii). `--static-checks` runs the complete
    static set with no test run (the outer's gate-only surface).
  - **3 files hit LIVE GitHub** (`packages/quay/test/serve-github.test.mjs`,
    `provider-abi-conformance.test.mjs`, `cli-edit-parity-conformance.test.mjs`) — each declares
    its OWN in-file `node:test` skip condition (ADR-019 decision #1), so `scripts/test.sh`'s
    default glob always includes them and a credential-less run reports them `skipped`, not
    silently excluded. Opt in with `QUAY_TEST_LIVE_GITHUB=1 scripts/test.sh` (requires
    `GH_TOKEN`/`gh auth login` with access to `yaleh/quay`; they FAIL if that repo's state drifts
    from what the fixture assumes).
  - Tests build a temp workspace with a real `.quay/config.yml` (see `makeWorkspace()` in a test file) — a bare tasks dir is NOT a valid workspace; the config is a **provider map** with `mcp_entry`/`path`/`env`, not a flat tasks path.
  - **NOT covered by `scripts/test.sh`** (DIR-111/ADR-019 decision #5 — named explicitly, not
    silently absent): **packaging e2e** — the `dist-verify-node-floor` CI job builds the real
    npm-pack tarball, installs it, and runs it on the declared Node floor, no `*.test.mjs` file
    involved; and **browser/agent-driven e2e** — a milestone-cadence, MCP-tool-driven manual/agent
    process (Playwright/chrome-devtools), `status: proposed` in `adr/ADR-010-scheduled-milestone-
    e2e-incl-browser-tests.md`. A green `scripts/test.sh` run is evidence for neither category.
  - **Cross-cut scoped selection (gap-scoped-selection-blind-to-packaging-state-diff):** scoped
    selection (`scripts/test.sh --for-task <id>`) is blind to packaging-vs-source diffs — a task
    touching `packages/*/src` resolves its own unit tests but NOT the packaging-state tests
    (`npm-pack-e2e`/`build-dist`/`plugin-packaging`), the ADR-conformance check (`check-adr`), or a
    lint check, so a src-touching task can be scoped-green and still break the packaged artifact
    (archguard TASK-62/64/65/66 — the same three-project, three-check pattern). The selector
    (`plugin/scripts/select-tests-for-touches.ts`) carries a **cross-cut marker** (AC2): cross-cut
    checkers enter the `--for-task` selection whenever a touch triggers the registry, regardless of
    basename pairing; the author SKILL.md task template defaults new-code ACs to a cross-cut checklist
    (lint-clean + check-adr 0 violations + packaging-state by task type — AC1/AC5). Pure plugin/doc
    tasks get no cross-cut tests (AC6 — scoped stays sub-second). The cross-cut packaging tests are a
    **proxy**, not the floor proof — the real Node-floor artifact still needs the `dist-verify-node-floor`
    CI job above (DIR-111). Cross-annotated with adaptive concurrency (`cap-from-gate.sh` +
    `concurrent-batch-scheduler.ts`, same mechanism-once-reused-downstream principle).
  - **Test-framework policy (gap-no-test-framework-policy-for-new-tests, AC1):** NEW test files
    MUST use `node:test` (`import { test } from "node:test"`). Enforced mechanically by
    `plugin/scripts/test-framework-policy-check.ts` (wired into `scripts/test.sh` via
    `run_static_checks`, alongside the split-or-commit scan): every file in the canonical glob must
    either import `node:test` or be on the legacy exemption list
    (`plugin/test-framework-policy-exemptions.txt`, **currently 34 files** — the pre-existing
    hand-rolled `makeAssert()`/`failures`-counter tests, 12,204 lines, measured 2026-08-02 in
    `orchestration/test-shape-analysis.md`). That list is a **shrink-only ratchet (AC4)**, enforced
    three ways: a **count ceiling** — the list can never exceed the data file header's own
    `# baseline-count: 34` at any state (a clean commit, a fresh clone, a smuggled addition), so a
    new hand-rolled test can never be exempted; a **shrink-only ceiling** — raising
    `# baseline-count` itself in the working tree fails, because the header is the control surface
    guarded pre-commit by the git strict-subset; and a **git-HEAD strict-subset** — a working-tree
    addition that isn't in the committed list fails before it can land (catches same-count swaps).
    Scope note: the ceiling is read from the working-tree data file, so raising it *and* adding
    files *in the same commit* moves the baseline past both (a code-review-grade edit) — the
    durable backstop is the pre-commit Audit window plus the shrink-only ceiling check. A listed
    file that converts to `node:test` must be REMOVED from the list. Existing legacy files are NOT
    migrated by this policy; each converts one at a time, when someone is already editing it (first
    intended application: relation-sync's harness). New files must also declare
    `// @test-group <product|engine|governance>` (AC5); existing files may omit it and default to
    `engine`. The import detection is a code-position fast heuristic (comments, strings, and regex
    literals that merely mention `node:test` do not count; a method call like
    `loader.import("node:test")` does not count). The `@test-group` requirement is enforced at the
    point a file is introduced (Audit-before-commit); a committed new file without it is treated as
    existing (`存量缺省 engine`) by design.
  - **Test-layer selection (AC7 — not coverage):** test at the boundary you are willing to keep
    stable, in three layers: (1) user-facing **contracts** (CLI commands, MCP tools, Provider ABI,
    web routes) → **≥1 real end-to-end check** against the shipped artifact (`dist/quay.js`, the
    `npm pack` output); (2) **branch-dense pure functions** (`checkSplitRecommendation`,
    `planCheckNextAction`, `checkTouchesPair`, …) → direct `import` unit tests — a failed CLI
    assertion only says "output lacks X", not which branch is wrong; (3) **internal implementation
    details** → **do not test** (testing them prepays refactor cost: behavior unchanged, test goes
    red). No numeric thresholds — setting a threshold before the cost structure is known is the AC9/416s
    mistake; do not repeat it. (`gap-suite-cost-model-is-wrong-optimizations-buy-nothing` is done and its
    measured output is that wall-clock diff is INDETERMINATE within the 17–63s noise band — it produced
    no usable cost numbers to wait on; the fixed-overhead breakdown is instrumented per run as
    `gap-suite-fixed-overhead-decomposition`.)
  - **Coverage is NOT a goal (AC7b):** three reasons. (1) It has never been measured — 
    `scripts/test.sh --experimental-test-coverage` exists and CLAUDE.md documents it, but there is
    no CI job and no recorded number, and setting a target for an unmeasured quantity is the 416s
    mistake. (2) It is gameable — this repo ships `gate-gameability.test.mjs`; a coverage
    percentage invites "executes lines but asserts nothing" tests. (3) The places that matter are
    already covered — the five branch-dense decision functions all have direct `import` unit
    tests; the 2.1:1 process/module ratio does NOT mean decision logic is untested. If coverage is
    ever looked at, it is a reference, not a target.
  - **`ToolSearch` is a mandatory pre-fetch step for deferred MCP tools** (exp5-ADR-TOOLSEARCH-
    DEFERRED-SCHEMA-PATTERN, M148 precedent style): the harness defers most MCP tool schemas —
    they are NOT loaded at session start, and calling a deferred tool before fetching its schema
    fails with `InputValidationError`. Before the FIRST call to any tool listed as deferred in a
    `<system-reminder>`, call `ToolSearch` with a `select:<name>[,<name>...]` (exact) or keyword
    query, confirm the result actually returned the tool's schema, and only then call it — this
    applies to every quay/meta-cc/archguard/playwright MCP tool used across this repo's workflows
    and skills. If `ToolSearch` returns zero results for a name you expect to exist, that is a
    real failure signal (a renamed/removed tool, a stale skill reference) — do not retry blindly.
- **Web UI:** `node --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>` (renders task bodies as markdown; reads the task store live per request).

## Architecture — the product (`packages/`)

Three packages, one ABI:

| Package | Role |
|---|---|
| `packages/quay` | **Core** — provider-agnostic CLI + web UI (`src/serve.ts`) + MCP client/server (`src/mcp-server.ts`). Talks to whichever provider is `enabled` in `.quay/config.yml` over the Provider ABI. |
| `packages/quay-native` | **Native provider** (reference) — a **markdown+YAML-frontmatter task store on local disk** (`tasks/*.md` ARE the data). CLI + MCP server. |
| `packages/quay-github` | **GitHub provider** — maps GitHub Issues onto the same task view-model. Proves the ABI transfers. |

Key cross-cutting facts (require reading several files to see):
- **Core is written against the task view-model only**, never a specific backend. A task = `{id, title, status, role (primitive|compound), labels, parent/children, body}`; the `body` markdown carries `## Proposal / ## Plan / ## Acceptance Criteria / ## Definition of Done` sections. Providers translate to/from this shape.
- **`.quay/config.yml`** (per-workspace) is the provider map: which provider is enabled, its `path`, `tasks_dir`, `mcp_entry`, `env`. `QUAY_NATIVE_TASKS_DIR` selects the native store's directory.
- **Core CLI `task edit` is status-only in v1** (QN-024) for backward compat unless full flags are given — for a body/extra/labels write, prefer MCP `task_write` or the native provider's own richer `quay-native task edit`. (Full-field parity was later added — see `packages/quay/bin/quay.ts` help; when in doubt check which surface you're on.)
- **Gate engine ("QENG")** — `packages/quay/src/gate/{engine,registry,gate-event-store,gate-log,acceptance-runner,lifecycle,driver}.js`, exposed as verb-less CLI commands `gate` / `gate-log` / `complete` / `adjudicate` / `promote` / `retreat` / `run`. Gates evaluate a named check and append an immutable **GateEvent** to `<workspaceRoot>/.quay/gate-events.jsonl` (gitignored). `quay gate <task>` defaults to the `acceptance` gate (runs `task.extra.acceptance` as a shell command, fail-closed if unset); lifecycle transitions live in `lifecycle.ts` (`todo→ready→done`, terminal `needs-human`). "The meter is runnable, not asserted."

## Architecture — the methodology layer (`experiments/`, `tasks/`, `docs/`)

- **RETIRED (ADR-022, 2026-08-03): the classic milestone loop — `OUTER-LOOP.md` + `prepare-milestone.js` + `execute-milestone.js` + the `composite-*` phases + `milestone-preparation-check.ts` + `diagnose-verify-failure.ts` — is retired.** The **two-layer fast mode is the sole development mode**. The gap tasks below that described `execute-milestone.js`/`prepare-milestone.js` as current mechanisms now describe **retired** mechanisms: those workflow files and the composite pipeline were physically deleted at `gap-retire-the-prepare-execute-pipeline-cluster` (2026-08-03). The surviving pieces of that cluster are `workflow-metadata-conformance.mjs` (shelled out to by `it0-dod-check.ts` clause 14) and the fast-mode-reused pure functions that were extracted into their consumers (`computeTouchesExpansion` → `concurrent-batch-scheduler.ts`; `parsePlanStages`/`validatePlanStructure` → `prepare-admission-check.ts`; `mapEvidenceToTasks` + composite types → `build-evidence-manifest.ts`). The mechanics below that reference the deleted files are kept as historical record of WHY the two-layer mode exists; the live driver for new work is the two-layer fast mode (fast-mode telemetry aggregated under `milestones/fast-mode-telemetry/<date>.json` — the old `.quay/fast-mode-telemetry.jsonl` path was drifted/never-existing, fixed 2026-08-05 by manager finding; `## Contract` six-key + `task-contract-check.ts` replacing ProposalReview/PlanCheck, subagent REFUTE rounds replacing the Audit phase).
- **`experiments/quay-perpetual-stream/`** is the active BAIME experiment (exp5): an autonomous outer loop that builds quay one milestone at a time. **`OUTER-LOOP.md` was the classic-loop driver document** (retired under ADR-022 — see the notice above); `inherited-core.md` is the pinned methodology; `dashboard.md` is mutable outer state; `scripts/it0-*.{sh,mjs}` are the mechanical gates (notably `it0-dod-check.sh` — the **DoD meta-enforcer**, Clauses 0-9, fixture-pinned by `dod-fixture-selfcheck.sh`).
- **The loop ran directly on `master`** (there is no driver branch — DIR-027 retired it) **under the RETIRED classic loop** (ADR-022). The worktree-isolation mechanics below are kept as historical record of the classic loop's concurrency design; the two-layer fast mode isolates per-task via `git worktree add /tmp/quay-wt-<task>` directly (no `milestone-worktree.ts` — that tool was retired after the 2026-08-03 reclaim). **Default (no-isolation) path — strictly serial:** with no `isolationMode` arg, `execute-milestone.js`'s Build phase edits "in place, commit, done" directly in the shared working tree, so **two default `execute-milestone` dispatches must never run concurrently against this repo, regardless of whether their tasks' own `## Touches` are disjoint** — the risk is the shared working tree itself (uncommitted Build-phase state colliding), not task-level file overlap; wait for one milestone's Land commit before dispatching the next. **Opt-in concurrent-safe path (DIR-123, 2026-07-31):** passing `$a.isolationMode: 'worktree'` routes Build/Audit/Gate through a REAL per-milestone `git worktree` (`milestones/M<NN>/worktrees/iteration-0`, created by `scripts/milestone-worktree.ts` before Build), so a file-disjoint dispatch's uncommitted state lives in its own worktree, NOT the shared checkout. **Land is the SOLE phase that touches the shared checkout, and it is serialized by a single-flight Land lock (`.quay/land-locks/shared-checkout.lock`) held for the ENTIRE Land phase** — not just the merge: in the SERIAL path the lock is acquired before the real `git merge --no-ff` of the worktree branch + `git worktree remove`/`git branch -d` and released only AFTER the CAPTURE commits, the dashboard.md `## Log` append, the `milestone_counter` increment, and the `it0-backlog-regen.ts` regeneration, so two concurrent worktree Lands serialize over EVERY shared-checkout mutation (no lost-update on `milestone_counter`/`dashboard.md`/`backlog.md`, no git-index/HEAD race on CAPTURE). In the CONCURRENT (`mode:'concurrent'`) path the workflow merges NOTHING — it returns `buildBranch` and the fan-in (`OUTER-LOOP.md` step g) is the SOLE merge owner, doing each survivor's merge + CAPTURE + worktree-remove under that same Land lock. The lock uses the atomic `wx`-create grant with an `rmSync` + retry-`wx` bounded-loop stale reclaim (mirroring `proposal-convergence.ts`'s hardened epoch lock — never a plain overwrite, never a permanent lockout). A crashed dispatch that stranded a worktree was recovered by `milestone-worktree.ts --clean-stale` (retired 2026-08-03 after the reclaim; cleans only a branch with ZERO commits ahead of master; a branch WITH commits fails closed to needs-human, never discarded). Pre-dispatch eligibility for concurrent dispatch REUSES the existing `concurrent-batch-scheduler.ts`'s `assembleBatch` → `touches-orthogonality-check.ts`'s `checkTouchesPair` as the real production eligibility mechanism (the named `worktreeDispatchEligibility` is a thin TEST-FACING wrapper over `assembleBatch` that additionally tags same-file conflicts — it has no separate production callers). Same-file overlap → rejected pre-dispatch and serialized, never left to collide at Land; a real merge conflict that nonetheless reaches Land is auto-aborted + needs-human, never a blanket --ours/--theirs. A requested-but-unusable isolation (unknown mode, or no numeric milestone) FAILS CLOSED rather than silently falling back to the shared tree. Omitted/empty `isolationMode` is byte-for-behavior the old direct-on-`master` path (golden-replay-proven; the only legacy delta is Land's corrected step-1 prompt text). **HARD PRECONDITION (mixed modes):** the default (no-isolation) path takes NO Land lock and commits directly to master in Build, so it is NOT serialized against worktree Lands — therefore a no-isolation dispatch must NEVER overlap a concurrent batch against the same checkout; concurrent batches are worktree-isolated BY CONSTRUCTION (`OUTER-LOOP.md` step a always passes `isolationMode:'worktree'`). **Status (RETIRED under ADR-022):** mechanism + concurrency-safety fixes were implemented and real-git fixture/golden-replay/lock tested; the "two genuinely concurrent real milestone journals" proof never ran because the classic loop was retired before it. The two-layer fast mode is the sole mode.
- **`prepare-milestone.js` also supported the SAME opt-in `isolationMode: 'worktree'`** (gap-prepare-milestone-no-worktree-isolation, M252) — **RETIRED under ADR-022** (the file is deleted; kept as historical record): a per-milestone `git worktree` (`milestones/M<NN>/worktrees/iteration-0`, branch `milestone/M<NN>/iteration-0` — the SAME path/branch convention execute-milestone's Build worktree uses) was created via `milestone-worktree.ts --add` BEFORE the Admission lease is acquired; coordination primitives (Admission lease, epoch records, generation telemetry, split-decision records) stayed in the primary checkout while CONTENT outputs (task Proposal/Plan edits, `docs/plans/*.md`, receipt/ledger/inventory files, ProposalReview checkpoints) happened EXCLUSIVELY in the worktree. Content-agent prompts carried a single module-level `_worktreeIsolationNote` prefix (empty string when isolation is off → byte-for-behavior golden replay) that routed agents to `cd <worktree>` and use Bash `cat`/`>>` instead of the MCP `task_get`/`task_write` (which resolve against the primary checkout). Every terminal return was wrapped by `_wtRet`, adding `worktreeRel` so a stranded worktree was discoverable by the caller. **prepare-merge** (AFTER Receipt success + lease release): commit worktree changes (`git add -A && git commit`) → `milestone-worktree.ts --merge` (real `git merge --no-ff`) → `--remove`; a merge conflict auto-aborts leaving master clean and the worktree intact, returning needs-human `prepare-merge-conflict` + the conflict file list (the lease is already released, so a merge failure never strands it). In CONCURRENT mode (`$a.mode === 'concurrent'`, AC8), prepare-merge COMMITS-ONLY on the branch and returned `{ outcome: 'building', buildBranch, worktreeRel }` — it did NOT merge/remove/take the Land lock; the fan-in (`OUTER-LOOP.md` concurrent_execute step g) was the SOLE merge owner of prepared worktrees before any execute-milestone dispatch. The concurrent prepare dispatch proof (two file-disjoint tasks on `master`) was task #22's scope; the mechanism was opt-in, not the default, and never became it.
- **`.halt` sentinel** — pauses the loop at the next milestone boundary. **Correction (2026-07-27, `gap-halt-sentinel-path-mismatch`):** the real, mechanically-checked location is the **repo root** (`<repo-root>/.halt`, workspace-root-relative — matches `plugin/skills/loop-driver/SKILL.md`'s documented convention and `select-preflight.ts`'s actual `checkHalt()` implementation). A previous version of this file incorrectly documented `experiments/quay-perpetual-stream/.halt`; that path is NOT read by any live code path. **When editing while the loop may run, follow DIR-027 human-steering hygiene: pause via a root-level `.halt`, OR work in a private git worktree off `master` and fast-forward at a clean window** — never race the loop on `master`. Before REMOVING `.halt` to un-pause, run
  `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh` (fixed to check this same
  repo-root path at M187) — the mechanical go/no-go for whether `master` is safe to hand back to
  the loop (clean tree, no mid-flight merge, `master` not checked out in a stray worktree, etc.).
  **This is a manual, human-invoked check, not CI/loop-wired** (`gap-orphaned-check-scripts-not-
  wired`, M-DIR119-C-CANARY, 2026-07-27, explicit decision) — nothing runs it for you automatically
  before an un-halt; run it yourself.
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
- **tmux remote-drive** (→ ADR-016) — to drive a FOREIGN workspace's Claude Code session (e.g. run archguard's `/loop` from here): `send-keys` to kick off (reliable = 3 separate calls `C-u` → text → `Enter`; combined drops the Enter), then read the RESULT from the filesystem/`git`/meta-cc — never parse the TUI. The screen-use carve-out is pinned in ADR-016's `## Amendment 2026-08-04`: only the bottom region (input box + status line), only the enumerated states (waiting-input / permission-prompt / busy / error-banner / unknown), and never a whole-screen equality/hash of `capture-pane` (enforced by `plugin/scripts/adr016-screen-use-check.ts`). One driver per session (never race a human typing there; beware gray ghost-suggestions). This is how cross-workspace proofs (DIR-048/049/051) can run without a human round-trip.

## Process

- Development is driven via **background Claude Code workflows at milestone granularity** (→ ADR-009), with a **scheduled milestone e2e incl. browser tests** (Playwright/chrome-devtools) that keeps `L_T` on the real product surface (→ ADR-010). Follow DIR-027 steering hygiene (`.halt` or private worktree; never race the loop on `master`).

## Split-decision routing policy (DIR-124-A1b, 2026-08-01)

> **STATUS: reference/manual policy — NOT mechanically enforced (2026-08-06,
> `gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode`).**
> `checkSplitRecommendation` is retained and unit-tested, but **no fast-mode dispatch or
> task-authoring code path calls it** (grep-verified: zero non-test callers outside
> `proposal-convergence.ts`). The table below is the intended procedure for a human/agent
> authoring or triaging a task **by hand** — nothing enforces it automatically. It was NOT wired
> in because the classifier's inputs (a typed mechanism inventory from a review agent's
> `mechanisms` array, and a blocking-findings `ledger`) do not exist in the fast-mode
> task-authoring path (ProposalReview/PlanCheck were replaced by `task-contract-check.ts` +
> subagent REFUTE rounds), and the only mechanical count source (`countMechanisms()` in
> `wiring-coverage-check.ts`) was measured 3/5 correct — "NOT reliable enough to wire into the
> split path (A4 would falsely split)" (`gap-extract-mechanism-claims-calibration`, done). The
> fast mode's ACTUAL mechanical scope guards are touch orthogonality (`checkTouchesPair` /
> `concurrent-batch-scheduler.ts`), compound decomposition (`it0-split-or-commit-check.ts`), and
> touch resolvability (`touches-orthogonality-check.ts --resolve`). Revisit the wire-in when
> mechanism-count calibration is fixed. Full decision record:
> `tasks/gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode.md`.

When the split classifier (`checkSplitRecommendation` in `proposal-convergence.ts` — retained; under the classic loop this surfaced via `prepare-milestone` returning `needs-human`/`split-recommended`, which is retired under ADR-022) returns `splitRecommendation.code`, the orchestrator MUST route by that code, NOT auto-approve all splits indiscriminately:

| Code | Action | Rationale |
|---|---|---|
| `split-multi-mechanism` | **Auto-record split** + create children | Not repairable — scope requires charter edit. >2 independently landable mechanisms. |
| `split-touch-set-too-large` | **Auto-record split** + narrow touches | Not repairable — surface too broad (>8 files). |
| `split-subsystem-blocking-cluster` | **Consume repairable bypass FIRST** | Repairable — one focused delta revision may close ALL findings. Only split if bypass fails (findings persist after the focused revision). The bypass is a ONE-SHOT per generation (`splitBypassAvailable` consumed once at `deltaRound === 0`). |
| `split-recursive-guard` | **Route to needs-human** — do NOT auto-split | Level-2+ leaf still multi-mechanism. The real defect is UPSTREAM decomposition was too shallow (e.g., DIR-124-A→A1→A1b should have produced more children at level 2 rather than a level-3 leaf that still spans 8 boundaries). Auto-splitting deeper compounds the problem. |

**After recording a split decision** (via `--record-split-decision --decision split`), the orchestrator MUST verify the split is enacted:
1. Parent task's `children:` frontmatter is populated
2. Each child's `tasks/<childId>.md` file EXISTS on disk
3. Each child has `status: todo` + `parent:` backlink
4. M-numbers are assigned (if development-class)

A split decision where children haven't been created is **incomplete** — the task is in limbo (`status: todo`, no way to execute). The split-completion check is as important as the split decision itself.

**The `> 2` mechanism threshold in `checkSplitRecommendation` is correctly calibrated — do NOT adjust it.** The five DIR-126 children (1 mechanism each, all completed) and the DIR-124-B/F splits (4/6 mechanisms, correctly decomposed) confirm the threshold. Overcounting of coverage items as mechanisms is a calibration issue in `extractMechanismClaims`, not a threshold defect.

## GIT review checklist

- Before calling a milestone done, ask **which of `L_T`/`L_C`/`L_D`/`L_G`/`L_S` is still dark** (ADR-006/007) and prefer **hard checks over prose** (ADR-004 — prose gets paraphrased away). See `docs/references/` for the framework and its limits (the continuous math is not rigor).

## Workflow resume anti-pattern (M144, 2026-07-25)

When a workflow Verify phase fails and the fix is to **external state** (gap-list.md, charter file, script on disk), do NOT resume with `resumeFromRunId`. The resume cache keys on (prompt, opts) only — it cannot see that external files changed. The cached failure returns instantly (~60ms, 0 tokens) and the Verify phase fails again with the same stale result.

**Rule:** if the fix touches anything OTHER than the workflow script's own agent prompt strings, re-run the workflow from scratch (`Workflow({script: ...})` without `resumeFromRunId`). Resume is safe ONLY when the fix is a prompt-text edit within the workflow script itself.

**Extension (M176, 2026-07-26, gap-workflow-name-dispatch-stale-script-cache):** the same staleness
class also hits plain `Workflow({name: "<saved-workflow>"})` calls, with NO `resumeFromRunId`
involved at all. Within one long-running session, a `name:`-based dispatch made AFTER the first
`name:`-based dispatch of that same workflow can still materialize the **old** script body, even
minutes after the underlying checked-in file (e.g. `.claude/workflows/execute-milestone.js`) was
edited and committed to `master` in between — confirmed via `diff` against the materialized script
under `~/.claude/projects/.../workflows/scripts/`. This is undocumented behavior (confirmed via
Claude Code's own docs/changelog — no mention of `name:`-resolution caching), not a repo bug.

**Rule:** in a session where a checked-in workflow script may have changed since the session
started (e.g. this session is itself implementing/patching that very script), always dispatch it
via `Workflow({scriptPath: "<absolute path to the real checked-in file>", ...})`, never
`Workflow({name: ...})` — `scriptPath` reliably re-reads the current on-disk content;
`name` may not. If the staleness is suspected but unconfirmed, diff the materialized script
(printed in the tool result / notification) against the real checked-in file before trusting a run's
outcome.

## Glob tool unavailable in subagent sessions (M148, 2026-07-25)

The `Glob` tool is **not available in subagent sessions**. Calling `Glob` from a subagent produces "Error: No such tool available: Glob". This has been observed in meta-cc session history as a recurring error pattern.

**Rule:** when you need file-pattern matching in a subagent, use `find` via Bash instead of `Glob`. Example: `find . -name '*.js' -not -path '*/node_modules/*'` instead of `Glob({pattern: '**/*.js'})`. All Bash tools (including `find`, `grep`, `ls`) work normally in subagent sessions.

## Pre-Edit freshness check (M150, 2026-07-25)

78% of Edit errors are stale `old_string` matches — the file has changed since you last read it, and the string you are trying to replace no longer exists at the expected location.

**Rule:** before calling `Edit` with an `old_string`, re-read the target region of the file with `Read` to confirm the string you intend to replace is still present exactly as you expect. Do not construct `old_string` from memory or from a stale read earlier in the conversation. A fresh read immediately before the edit is the only reliable source of the current file state.
