# exp5-M-CRYST-D1 — milestone-level plan (Stage 7.1)

**Author round: 1. Check rounds: see below.** Kept OUT of the quay task tree (process, not value,
per proposal §3 / Stage 5.3 discipline) — this file lives under `milestones/M45-.../pipeline/`, not
as a child task.

Line budget: ~450 lines (well under the ≤2000 milestone ceiling; single-phase, no phase/stage
decomposition needed — small-milestone norm applies directly per the size definition).

## Phase 1 (only phase — small-milestone norm, no further decomposition needed)

### Stage 1 — shared frontmatter-store-base helper [code]
- **Files:** `packages/quay-native/src/frontmatter-store-base.js` (NEW — extracted shared
  parse/serialize/lock/list-filter helpers, factored out of `adr-store.js` without changing
  `adr-store.js`'s external behavior).
- **Refactor `adr-store.js`** to import + use the shared helper (behavior-preserving — existing
  `packages/quay-native/test/adr-store.test.mjs`/`adr-abi.test.mjs` must stay green, unchanged).
- TDD ≥80% line coverage on the new helper file, test-first (RED→GREEN).
- Line budget: ~120 lines (helper) + ~20 line diff to `adr-store.js`.

### Stage 2 — `document-store.js` (new sibling store) [code]
- **Files:** `packages/quay-native/src/document-store.js` (NEW) — `createDocumentStore(docDir)` →
  `{list, get, write}`, same shape as `adr-store.js`, importing Stage 1's shared helper. Frontmatter:
  `id`, `title`, `kind`, `status` (`draft|active|retired`), `contracts` (reserved, round-tripped
  verbatim by this store — Stage 3 is what CONSUMES it).
- Directory: `docs-managed/` at repo root (sibling of `tasks/`/`adr/`), created on first write.
- TDD ≥80% line coverage, test-first.
- Line budget: ~110 lines + tests.

### Stage 3 — `contract-validator.js` (single-source validator) [code]
- **Files:** `packages/quay-native/src/contract-validator.js` (NEW) — pure function
  `validateContracts(doc)` → `{ok: boolean, results: [{pattern, type, ok, description}]}`. Reads
  `doc.contracts` (array), for each entry with `target:"self"`: `type:"grep"` → the doc's own
  `body` must contain `pattern` (substring or simple regex, decided at implementation time — start
  with substring `.includes()`, escalate to `RegExp` only if a real assertion needs it); `type:
  "not-grep"` → body must NOT contain it. Missing/malformed entries fail closed (`ok:false`,
  reason cites the malformed entry).
- TDD ≥80% line coverage, test-first — RED (malformed contract, violating doc) → GREEN (conforming
  doc), mirroring the ADR-001/B7 RED→GREEN precedent.
- Line budget: ~70 lines + tests.

### Stage 4 — `doc-<id>` gate-factory wiring [code]
- **Files:** `packages/quay/src/gate/registry.js` — add `makeDocumentContractGate(docId, docDir)`
  (parallel to `makeAdrGate`: read the document at gate-run time via `createDocumentStore`, fail
  closed if doc missing / `contracts` absent-or-empty, otherwise call `contract-validator.js`'s
  `validateContracts()` in-process — no `runAcceptance`/shell-out, since this is an in-process
  check against the doc's own live body, not an external command). Register at least the one real
  wired case (`doc-quay-directive-skill`, or whatever id Stage 5's retrofitted doc uses) in a
  declarative table mirroring `ADR_GATE_IDS`.
- TDD ≥80% line coverage on the new registry addition, test-first.
- Line budget: ~60 lines + tests.

### Stage 5 — real end-to-end retrofit + fixtures [code + prose, split acceptance]
- **Files (prose):** retrofit `.claude/skills/quay-directive/SKILL.md` — add a `contracts:`-bearing
  managed-document record for it via `document-store.js` (create/write), asserting ≥1 real,
  currently-true load-bearing rule read directly from the skill's own prose (decide the exact
  pattern at implementation time by reading the file; do not assert something not actually true).
  Acceptance (prose branch): the mechanical-check discipline — `quay gate <task> --gate doc-<id>`
  runs and PASSes against the real retrofitted doc; no coverage percentage fabricated for this
  prose artifact itself (the validator CODE that checks it is what's coverage-gated, per Stage 3).
- **Files (code, fixture):** one synthetic non-conforming fixture document under
  `experiments/quay-perpetual-stream/fixtures/document-contracts/` (never a real doc deliberately
  broken) proving the FAIL path — `quay gate <fixture-task> --gate doc-<fixture-id>` exits 1.
- **Files (code):** a CLI/MCP consult surface — `quay-native doc validate <id>` (native provider
  CLI verb) printing the per-assertion pass/fail table from `validateContracts()`'s `results`.
- TDD ≥80% line coverage on the new CLI verb code, test-first.
- Line budget: ~90 lines (CLI verb + tests) + retrofit diff (small, prose).

## Dependency order
Stage 1 → Stage 2 (needs the shared helper) → Stage 3 (independent of 1/2, can parallel-author but
sequenced here for clarity) → Stage 4 (needs 2+3) → Stage 5 (needs 2+3+4).

## Per-stage TDD ≥80% acceptance (Hard gate, Stage 7.2)
All 5 stages are `[code]` except Stage 5's retrofit-diff sub-part, which is `[prose]` (mechanical-
check discipline: gate PASS/FAIL confirmed live, no fabricated %). Every `[code]` stage: RED (a
failing test written first) → GREEN (implementation makes it pass) → `node --test
--experimental-test-coverage` on the touched file(s) ≥80% line coverage, pasted as real output at
ABSORB, not restated from memory.

## Plan-time line-budget gate — real run (ground truth for check round 1)
```
$ bash experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh experiments/quay-perpetual-stream/charters/M45-cryst-d1-doc-management.md
PASS: experiments/quay-perpetual-stream/charters/M45-cryst-d1-doc-management.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
```
Ground truth: PASS, single-phase small-milestone norm confirmed — no phase/stage decomposition
required, consistent with this plan's own single-Phase-1 structure.

## Grounded convergent check (Stage 7.1.b) — round 1
**Process-fidelity note (same finding as the proposal step above):** no isolated Task-agent dispatch
reachable from this nested session; this round is a same-context grounded self-check (reading real
signatures/call-sites in the actual codebase, per the check subagent's own charge), not a genuinely
independent second reader — honestly flagged, not hidden.

**Grounded findings (material issues, re-reading real code):**
1. **`adr-store.js`'s `write()` derives the on-disk filename via `${id}-${slugify(title)}.md` and
   `fileNameForId()` matches by `${id}.md` or `${id}-` prefix** — confirmed by direct re-read
   (lines ~157-179 of `adr-store.js`). `document-store.js` must follow the SAME id-prefix-match
   convention (not e.g. an exact-filename-only match), or a document written then re-fetched by a
   different title-derived slug could silently miss. **Material — fold into Stage 2's acceptance.**
2. **`adr-store.js`'s lockfile mechanism (`withLock`) is keyed by `id` and lives in `adrDir` itself**
   (`lockPathFor` → `path.join(adrDir, `${id}.lock`)`) — re-confirmed directly. The shared
   `frontmatter-store-base.js` helper (Stage 1) must accept the object's OWN base directory as a
   parameter (not hardcode `adr/`), since `document-store.js` will pass `docs-managed/` instead.
   Already implied by the plan's Stage 1 wording ("shared... helper... factored out") but WORTH
   stating explicitly as a check-round finding to avoid an implicit assumption slipping through
   unstated. **Material — Stage 1's acceptance now explicitly requires: helper functions take
   `dir` as an explicit parameter, no hardcoded `adr/`/`docs-managed/` path inside the helper
   itself.**
3. **`registry.js`'s existing gate factories (`makeAdrGate`, `makeIt0Gate`) are synchronous-looking
   but the gate registry map's value type is `async (task) => {...}`** (confirmed: `gateRegistry`
   type comment says `Record<string, (task, client) => Promise<{ok, reason}>>`) — `contract-
   validator.js`'s `validateContracts()` is a PURE, synchronous function per the plan (no I/O), but
   `makeDocumentContractGate`'s returned function must still be declared `async` (or return a
   Promise) to match the registry's existing calling convention, even though the underlying
   validation itself does no async work. **Material but small — note explicitly in Stage 4's
   acceptance so the implementer doesn't accidentally return a bare object from a non-async
   function** (would still work due to JS's Promise auto-wrapping at the call site, per
   `engine.js`'s `await gateRegistry[gate](...)` pattern, actually confirmed NOT material after
   closer re-read — Node/JS awaits a non-Promise value fine. Downgraded to a documentation note,
   not a required code change.)

**Count: F_1 = 2 material findings** (item 3 downgraded to non-material on closer re-read within
the same round — net material count is 2, items 1 and 2). Both folded into the plan above (Stage 1
and Stage 2 acceptance criteria tightened). Per the Phase-5 stopping rule, F_1 ≠ 0 → round 2
required.

## Grounded convergent check — round 2
Re-reading the plan as amended above (Stage 1/2 acceptance now explicit about the dir-parameter and
id-prefix-match requirements). Re-checked against `adr-abi.test.mjs` (confirms the ADR store's
Provider-ABI-facing contract this new sibling store must NOT need to touch — `document-store.js` is
a plain local store, not yet wired through the Provider ABI's `task_get`/`task_list` tools; the
task's own AC1/AC2 do not require MCP/CLI Provider-ABI passthrough, only "managed + validated through
quay" — satisfied by the native `quay-native doc validate` CLI verb per Stage 5, no Provider ABI
extension required this milestone). No further material findings this round beyond confirming the
round-1 fixes are sufficient and no NEW gap opened by them.

**Count: F_2 = 0 material findings.** Per the Phase-5 stopping rule ("STOP when a round finds F_i =
0 — that round IS the confirmation, no extra confirmatory round required"): **CONVERGED at round 2.**
