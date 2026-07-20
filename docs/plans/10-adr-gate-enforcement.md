# Plan 10 — ADR-as-contract enforcement: `adr-<id>` engine gates (exp5-M-CRYST-E3)

Milestone-level plan record (quay-task-to-plan Stage 7.1), kept out of the quay task tree per that
skill's own convention. Reconciled proposal: `tasks/exp5-M-CRYST-E3.md`'s `## Proposal` section /
`experiments/quay-perpetual-stream/milestones/M42-cryst-e3-adr-gate/pipeline/adjudication.md`.

**Grounded plan-check note (Stage 7.1b):** this plan was drafted, then re-checked once against the
real files it touches (`adr-store.js`, `registry.js`, `it0-gates.test.mjs`'s existing pattern,
`loadbearing-test-gate.sh`'s real flag shape, ADR-001's real frontmatter) — a single grounded-check
pass found zero material issues on that re-read (F_1 = 0 → stop condition met, no re-derivation
needed per the Phase-5 stopping rule). Same limitation as the proposal step: this check was performed
by the same orchestrator context, not a separately-dispatched subagent — stated explicitly.

## Phase 1 — `adr-store.js`: surface `applies-to`/`enforcement` in the view-model [code]

**Files:** `packages/quay-native/src/adr-store.js`, `packages/quay-native/test/adr-store.test.mjs`
**Line budget:** ~15 lines changed (2 view-model fields + a filter predicate), well under the
200-line stage ceiling.
**Stage:**
1. RED: add unit tests asserting `get()`/`list()` return `appliesTo`/`enforcement` when present in
   frontmatter, `[]`/`undefined`-safe when absent, and `list({ appliesTo: <path> })` filters to only
   ADRs whose `applies-to` glob-matches the given path.
2. GREEN: extend `toViewModel` to read `frontmatter["applies-to"] ?? []` → `appliesTo`,
   `frontmatter.enforcement` → `enforcement` (both already round-tripped verbatim per `OWNED_KEYS`
   excluding them — no serialize-path change needed, `write()` already preserves unknown keys
   verbatim via the existing `for (const k of Object.keys(frontmatter)) if (!OWNED_KEYS.has(k))` loop).
   Add a small glob-match helper (reuse Node's `path.matchesGlob` if available on the pinned Node
   version, else a minimal hand-rolled `**`/`*` matcher — no new npm dependency) and wire it into
   `list()`'s filter chain, same shape as the existing `status`/`tag` filters.
**TDD acceptance (code stage):** ≥80% line coverage on the touched lines in `adr-store.js`
(`node --test --experimental-test-coverage packages/quay-native/test/*.mjs`), red-then-green
(failing assertions before the view-model/filter change, passing after).

## Phase 2 — `registry.js`: `makeAdrGate` factory + `adr-001` registration [code]

**Files:** `packages/quay/src/gate/registry.js`, `packages/quay/test/it0-gates.test.mjs` (extend,
mirrors the existing `impl-row`/`line-budget` test shape in the SAME file — no new test file needed,
consistent with that file's own multi-gate coverage).
**Line budget:** ~40 lines added (one factory function + a small `ADR_GATE_IDS` table + the
registration loop), well under the 200-line stage ceiling.
**Dependency:** Phase 1 (reads the ADR store's new `enforcement` field).
**Stage:**
1. RED: add tests for `makeAdrGate` — (a) fails closed with a clear reason when the ADR is
   missing/not-`accepted`/has an empty `enforcement`; (b) PASSes and appends a `pass` GateEvent when
   `enforcement`'s command exits 0; (c) FAILs and appends a `fail` GateEvent when it exits non-zero;
   (d) `gateRegistry["adr-001"]` exists and `listGates()` includes it.
2. GREEN: implement `makeAdrGate(adrId, adrDir)` — reads the ADR via `createAdrStore(adrDir).get
   (adrId)` at CALL TIME (not module load — an `enforcement` edit takes effect without a process
   restart), fails closed per the reasons above, else calls the existing `runAcceptance` with the
   ADR's `enforcement` string (same `QUAY_ACCEPTANCE_CWD`/`QUAY_ACCEPTANCE_TIMEOUT_MS` env
   convention `acceptance`/`impl-row`/`line-budget` already use — no new env var). `ADR_GATE_IDS =
   ["ADR-001"]` at module scope, resolved against `REPO_ROOT/adr` (same `REPO_ROOT` constant
   `registry.js` already computes for `IMPL_ROW_SCRIPT`/`LINE_BUDGET_SCRIPT`), iterated once to
   populate `gateRegistry["adr-001"] = makeAdrGate("ADR-001", path.join(REPO_ROOT, "adr"))`.
**TDD acceptance (code stage):** ≥80% line/branch coverage on the new registry.js code
(`node --test --experimental-test-coverage packages/quay/test/*.mjs`), red-then-green.

## Phase 3 — ADR-001 frontmatter: wire `applies-to`/`enforcement` to B7 [prose — frontmatter data, not code]

**Files:** `adr/ADR-001-tdd-scope-product-code-red-green-80-stage-load-bearing-metho.md`
**Line budget:** ~4 lines (2 frontmatter fields).
**Dependency:** Phase 2 (the gate must exist to be meaningfully wired; Phase 3 can be done in
parallel with Phase 2's implementation but its END-TO-END verification depends on Phase 2 landing).
**Stage:**
1. Add `applies-to: ["experiments/quay-perpetual-stream/scripts/**"]` and `enforcement: "bash
   experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh --scripts
   experiments/quay-perpetual-stream/scripts"` to ADR-001's frontmatter (confirmed real flag shape by
   reading `loadbearing-test-gate.sh`'s own usage line directly).
2. Re-run `node packages/quay-native/bin/quay-native.js adr get ADR-001 --json` and confirm the new
   fields round-trip (paste output as evidence).
**Prose-branch gate (per the classifier):** no coverage percentage applies; instead — (a)
`adr-store.js`'s existing frontmatter-passthrough test still PASSes unmodified against this real
file (no regression), (b) a `grep` confirms both new frontmatter lines are present verbatim, (c) the
end-to-end AC (Phase 4 below) is the real isolation test that this frontmatter, once read by the
real `adr-001` gate, produces a correct PASS/FAIL — that IS this phase's acceptance, not a synthetic
fixture alone.

## Phase 4 — Fixture pair + consult-surface CLI + end-to-end proof [code]

**Files:** `packages/quay/test/it0-gates.test.mjs` (extend further — fixture pair against
disposable on-disk workspaces, mirroring that file's own `makeWorkspace()` pattern for
`impl-row`/`line-budget`), `packages/quay-native/bin/quay-native.js` (add `--applies-to` flag to `adr
list`), `packages/quay-native/test/*.test.mjs` or a new small CLI test file for the flag.
**Line budget:** ~60 lines (fixture setup + 2-3 new test cases + one CLI flag + its test), under the
200-line stage ceiling; total milestone line budget (Phases 1-4 combined, ~120 lines net new/changed)
is well under the 2000-line milestone ceiling and the small-milestone norm the it0 line-budget check
already confirmed against the charter.
**Dependency:** Phases 1-3.
**Stage:**
1. RED: a synthetic on-disk fixture (a temp copy of `loadbearing-test-gate.sh`'s scripts dir with one
   module deliberately missing its sibling test) that the `adr-001` gate run against it must FAIL;
   a conforming fixture (or the real repo's own `scripts/` dir, which B7 already reports 0
   violations against per ADR-001's own Consequences text) that the gate must PASS. `quay-native adr
   list --applies-to <path>` test: a path matching `experiments/quay-perpetual-stream/scripts/**`
   returns ADR-001; a non-matching path does not.
2. GREEN: run `quay gate <any-task> --gate adr-001` against both fixtures end-to-end via the real
   CLI (mirrors `it0-gates.test.mjs`'s existing `runQuay([...])` helper), confirm exit codes AND the
   resulting GateEvents via `quay gate-log <task> --json`. Run the consult-surface CLI flag
   end-to-end.
**TDD acceptance (code stage):** ≥80% coverage on the touched CLI/test code; this phase's own output
IS the milestone's AC1-AC4 real-landing proof (paste all four raw command outputs into the iteration
report and the ABSORB entry, per the audit's evidence discipline).

## Cross-phase notes

- **No dual source:** the B7 check logic stays exactly one script (`loadbearing-test-gate.sh/.mjs`);
  the `adr-001` gate is a thin wrapper (`runAcceptance` invocation), same discipline as
  `impl-row`/`line-budget`.
- **Single runner:** `runAcceptance` (already exists, `packages/quay/src/gate/acceptance-runner.js`)
  is reused unchanged — no second command-runner introduced anywhere in this plan.
- **Backward compatibility:** the ADR view-model's new fields are additive; the `list()` filter's new
  predicate is optional (absent `appliesTo` filter arg = no behavior change to existing callers,
  mirrors `status`/`tag`'s own optional-filter shape).
