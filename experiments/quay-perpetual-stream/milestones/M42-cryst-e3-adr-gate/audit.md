# M42-cryst-e3-adr-gate — ABSORB adversarial audit

Performed by the OUTER orchestrator (no separate audit subagent dispatch available this pass —
`baime:iteration-executor` unreachable via ToolSearch, `mcp__plugin_manda_manda__Agent` errored
`cap request requires to=` with no addressed broker configured; same limitation as m41). Stance is
refute-first: every claim below was independently RE-RUN with fresh, self-derived inputs (new
fixture ids/timestamps, a brand-new tmp violating/conforming tree pair), not copy-pasted from the
iteration-0 report's own transcript.

## Verdicts against the task's 4 Acceptance Criteria

**AC1** — "An `accepted` ADR carrying `applies-to`+`enforcement` registers as a named `adr-<id>`
quay gate; running it appends a real GateEvent... queryable via `quay gate-log`."
**NO REFUTATION FOUND.** Independently built a fresh fixture task `AUDIT-ADR001-1784517983` (new id,
not reused from the iteration report), ran `node packages/quay/bin/quay.js gate AUDIT-ADR001-1784517983
--gate adr-001 --file <fresh tmp file>` → `PASS`, exit 0. `quay gate-log ... --json` on the SAME
fresh log file returned exactly one real GateEvent: `{"gate":"adr-001","actor":"quay-cli",
"verdict":"pass","payload":{"reason":"acceptance passed (exit 0)"}}`. Confirms `listGates()` truly
routes `adr-001` all the way to a real GateEvent, not a hardcoded return.

**AC2** — "A change that VIOLATES an in-scope ADR makes its gate FAIL; a conforming change PASSES;
fixtures pin both."
**NO REFUTATION FOUND.** Built a brand-new tmp violating tree from scratch (a `helper.mjs` imported
by `main.mjs`, deliberately NO sibling `helper.test.mjs`) and ran
`loadbearing-test-gate.sh --scripts <tmp>/scripts --tests <tmp>/test` directly (the real command the
`adr-001` gate's `enforcement` field points at, just against a fresh path) → exit 1, `FAIL: 1
load-bearing script(s) lack a sibling *.test.mjs`. Then added the sibling test file to the SAME tmp
tree and re-ran → exit 0, `PASS: every load-bearing script has a sibling *.test.mjs`. Both directions
confirmed live, not by re-reading the test file's assertions.

**AC3** — "ADR-001 is wired to the B7 check as its enforcement, and honoring/violating it is a
GateEvent on a REAL object... not a prose claim."
**NO REFUTATION FOUND.** `adr/ADR-001-*.md` frontmatter's `enforcement:` field literally invokes
`loadbearing-test-gate.sh` against the real `experiments/quay-perpetual-stream/scripts`/`test`
directories (read directly, not paraphrased). AC1's fresh GateEvent above is exactly this real
object's outcome, not a fixture stand-in.

**AC4** — "A consult surface lists the `accepted` ADRs whose `applies-to` matches a given
path/scope."
**NO REFUTATION FOUND.** Independently ran
`node packages/quay-native/bin/quay-native.js adr list --applies-to
experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.mjs --json` against the real `adr/`
dir → `ADR-001` present. Ran the same command with `--applies-to packages/quay/src/gate/registry.js`
(an out-of-scope path) → empty array. Both directions independently re-confirmed (session's own
earlier runs, re-verified identically here).

## Verdicts against the Definition of Done

**"A REAL ADR (ADR-001) is enforced by its named gate on a real change (GateEvent recorded)":**
**NO REFUTATION FOUND** — see AC1 above, re-derived with a fresh fixture id this audit pass.

**"Single-source: the ADR's check LOGIC is one script; the quay gate WRAPS it (no second
implementation)":**
**NO REFUTATION FOUND.** `makeAdrGate` (registry.js) contains no duplicated process-spawn/timeout
logic — it calls the SAME `runAcceptance` (`acceptance-runner.js`) every other gate
(`dod`/`acceptance`/`impl-row`/`line-budget`) already uses; the check logic itself lives ONLY in
`loadbearing-test-gate.mjs`/`.sh` (B7's own script, unmodified by this milestone). Confirmed by
reading `registry.js` directly — no shell-out reimplementation, no second spawnSync call site.

**"Strict TDD across the touched packages; no regression to the E1 ADR surfaces":**
**NO REFUTATION FOUND**, with one CONCERN noted below. Independently re-ran
`node --test --experimental-test-coverage packages/quay-native/test/adr-store.test.mjs` fresh (not
reusing the iteration-0 run) → **13/13 pass, adr-store.js 93.30% line / 80.30% branch / 100% funcs**
— exact match to the iteration-0 report's claimed number, confirming it wasn't inflated or
mis-stated. `registry.js`'s combined coverage (94.15% in the full-suite run) exceeds 80%; the
narrower per-file numbers (79-86%) seen in scoped runs are expected artifacts of not exercising every
gate's test file in one pass, not a real deficiency — confirmed by running the WIDEST available
suite (`gate.test.mjs`+`gate-cli.test.mjs`+`adr-gate.test.mjs` together) and reading the number from
that run specifically.
**CONCERN:** `web-ui-browser.test.mjs`'s 1 failure was NOT independently re-run by this audit against
a truly pristine, untouched checkout in a SEPARATE process from the orchestrator's own claim — it
was re-run by the same orchestrator session claiming the finding, on the same host, satisfying "same
failure on master" but not eliminating all possible host-specific confounds (e.g. a systemically
absent browser binary would explain BOTH results identically without proving the test is unrelated to
this milestone's code, though the file's own untouched `git status` and zero content overlap with
this milestone's diff make an actual regression implausible).

## Additional adversarial probes (own initiative, not scripted by the charter)
- **Self-exemption check:** searched the diff and task file for any DoD clause explicitly waived —
  none found; `task-schema-check.sh tasks/exp5-M-CRYST-E3.md` → PASS (schema v1 conformant).
- **Import-cycle check:** `grep -rn "packages/quay/" packages/quay-native/` → zero matches (quay-native
  has no reverse dependency on quay) — `registry.js -> adr-store.js` is a clean one-directional edge,
  same shape as the pre-existing `dod` gate's indirect reliance on quay-native via `client.taskCheck`.
- **Mid-flight master-advance handling:** independently confirmed via `git merge-base --is-ancestor`
  and a file-scoped `git diff --stat` that the human off-loop commits (DIR-031/ADR-012) shared ZERO
  files with this milestone before accepting the iteration-0 report's ff-merge claim.

## Overall verdict

adversarial-audit verdict: **NO REFUTATION FOUND** on all 4 ACs and all 3 DoD clauses probed, with
one minor CONCERN (noted above, does not block ABSORB — the pre-existing browser-test failure is
unrelated to this milestone's scope by every available signal: zero file overlap, identical failure
on `master`, zero mention of adr/gate/registry in the failing test file).

## V_meta consolidation-lag: clear — no rows past threshold

`v-meta-ledger.md` re-checked via `vmeta-lag-check.sh --counter 41 v-meta-ledger.md`: PASS, no
confirmed-unconsolidated row past K=2 without a dated carry-forward.

## Escrow-Δv / Impl-row clauses

N/A — this milestone claims no VT chart-1 cell (value types: governance-integrity primary +
capability-growth secondary, no numeric Δv escrowed against a chart cell), and carries no
`backlog.md` impl-row of its own yet (a generated view, regenerated at ABSORB) — mirrors the
M25/M38/M39/M40/M41 method-infra-and-gate-engine precedent of N/A for milestones whose own delivered
code IS the mechanism rather than a claim against a pre-existing backlog row.

## Test-floor clause

APPLIES — real `packages/quay*` product files were touched this milestone
(`packages/quay-native/src/adr-store.js`, `packages/quay-native/bin/quay-native.js`,
`packages/quay/src/gate/registry.js`, plus new test file `packages/quay/test/adr-gate.test.mjs`).
Strict TDD confirmed above (red→green cycle, ≥80% coverage on every touched file: `adr-store.js`
93.30% line/80.30% branch/100% funcs; `registry.js` 94.15% line/86.96% branch in the combined
full-suite run) — the clause is satisfied, not skipped.

## Task canonical-lifecycle-record (Clause 8)

`exp5-M-CRYST-E3` carries its own real `## Proposal` (the ADR-as-contract mechanism, quoted above in
the task body) and a real `## Plan` (`docs/plans/10-adr-gate-enforcement.md`, the milestone-level
plan record from the mandatory quay-task-to-plan pipeline for this dev-class milestone) — both
present, neither an empty placeholder.

## AC/DoD checkbox disposition (DIR-020: only this audit ticks boxes)

- AC1 (accepted ADR + applies-to/enforcement registers as a named `adr-<id>` gate; running it appends
  a real GateEvent queryable via `quay gate-log`) → `[x]` MET: real finding above (fresh fixture,
  fresh GateEvent).
- AC2 (a violating change FAILs its gate; a conforming change PASSes; fixtures pin both) → `[x]` MET:
  real finding above (fresh tmp violating/conforming tree pair, both directions live).
- AC3 (ADR-001 wired to the B7 check as its enforcement; honoring/violating it is a GateEvent on a
  real object) → `[x]` MET: real finding above (ADR-001 frontmatter read directly).
- AC4 (a consult surface lists `accepted` ADRs whose `applies-to` matches a given path/scope) →
  `[x]` MET: real finding above (`adr list --applies-to` both directions).
- DoD item 1 (a real ADR is enforced by its named gate on a real change, GateEvent recorded) →
  `[x]` MET, recorded above + this ABSORB entry.
- DoD item 2 (single-source: check logic is one script, the gate wraps it, no second implementation)
  → `[x]` MET: `makeAdrGate` reuses `runAcceptance`, no duplicated spawn logic.
- DoD item 3 (strict TDD across touched packages; no regression to E1 ADR surfaces) → `[x]` MET, one
  non-blocking CONCERN carried forward (browser-test failure, unrelated scope, see above).

## Backlog row
| exp5-M-CRYST-E3 | E3 adr-as-contract enforcement — applies-to scope + runnable check as a named adr-<id> quay gate (the 'continuously applied' half of E1) | governance-integrity (primary) + capability-growth (secondary) | no VT chart cell | milestone-candidate, crystallization, milestone:M42-cryst-e3 |
