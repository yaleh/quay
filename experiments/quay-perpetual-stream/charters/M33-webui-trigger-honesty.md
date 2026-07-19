# Charter M33-webui-trigger-honesty — Web UI action_buttons: stop overstating success when
# trigger delivery is degraded/async (G-S4-01 only)

**Milestone id:** M33-webui-trigger-honesty · **surface:** web-ui (`packages/quay/src/serve.js`)
· **type:** exploit (fix a real, dogfooding-confirmed UX-honesty defect)
**Source:** `tasks/exp5-M-WEBUI-TRIGGER-HONESTY.md` (SELECTed m33) — M28-outcome-eval
outcome-eval-report.md, Scenario 4 reconciliation, gap G-S4-01. M28's reconciled scenario-4 verdict
was FAIL: the Web UI's "Advance" button redirects with an unconditional "Done: Task X advanced"
success banner even when delivery degraded to print-only (no live `manda` dispatcher), leaving the
task's `status`/`updatedAt` byte-identical to their pre-click values — an operator trusting only the
UI would be misled into believing the task transitioned.
**Charter authored:** m32→m33 boundary, 2026-07-19. Base commit: `exp5-outer-driver` HEAD
`c6e55dd` (post-m32-publish, confirmed via `git rev-parse exp5-outer-driver`).

## Acceptance Criteria / Definition of Done
Authored into the task, not duplicated here — see `tasks/exp5-M-WEBUI-TRIGGER-HONESTY.md`'s
`## Acceptance Criteria` (5 clauses) and `## Definition of Done` sections (per `inherited-core.md`'s
Clause 0, "AC/DoD live in the TASK"). This charter is the implementation PLAN against that task's
AC/DoD, not a second copy of them.

## Value hypothesis
- Value type(s): **exploit (primary)** — fixes a real, dogfooding-confirmed UX-honesty defect
  M28's own reconciled verdict rated FAIL-severity. **capability-growth (secondary)** — Web UI
  surface correctness. No exploration/design-decision component (the fix shape is dictated
  directly by `deliverTrigger()`'s existing return contract, `{ delivered: "mock"|"manda"|"print" }`
  — see Current-state notes).
- **Δv̂:** TBD at ABSORB per the standing VT-chart-1 rubric for `surface:web-ui` exploit fixes
  (mirrors M11-webui-reverify/M29-cli-create-ergonomics precedent — a real UX-correctness fix on an
  existing scored surface, not a new capability cell). Not escrowed (this milestone is not
  design-only — it ships real code directly).
- Metric `Y`: the task's 5 Acceptance Criteria, verbatim (see task file) — banner text is
  conditioned on `result.delivered`, degraded/async modes use "requested" language not "advanced",
  live-browser-verified (not static-only), full test suite green, G-S4-02 untouched.

## Current-state notes (re-verified directly against source at charter-authoring time)
- `packages/quay/src/action.js`'s `deliverTrigger()` (lines 96-127) already returns a structured
  `{ delivered: "mock" | "manda" | "print", ... }` result — the delivery-mode signal this milestone
  needs already exists, is not being invented. `"mock"` = deterministic test-log mode
  (`QUAY_ACTION_MOCK_LOG`, DIR-009/QN-042); `"manda"` = async dispatch via `manda-dispatch submit
  --async` (fire-and-forget, no confirmation callback the caller can wait on); `"print"` = degraded,
  stdout-only, the realistic default for a bare `quay serve` with no `manda` configured (see the
  function's own doc comment, lines 76-95, for the full precedence contract — do not re-derive it,
  cite it).
- `packages/quay/src/serve.js`'s POST `/task/:id/action/:actionId` handler (lines 909-963) currently
  calls `deliverTrigger()`, captures `result`, but the very next line hardcodes
  `const successMsg = \`Task ${t.id} advanced\`;` — `result.delivered` is read only for the
  `console.log` line immediately after, never consulted for the user-facing banner text. This is
  the exact, isolated bug: the honesty-relevant signal exists in scope but is discarded before it
  reaches the user.
- **None of the three delivery modes currently perform a synchronous status write** — confirmed by
  reading `deliverTrigger()` in full: `"mock"` appends a JSON-lines test record, `"manda"` fires an
  async dispatch call, `"print"` only logs to stdout; none of the three branches touch
  `client.taskWrite`/task status at all. This means, per AC 2, the "advanced"/"done" language is not
  earned by ANY current mode — the honest fix is "requested"-flavored text for `"print"`/`"manda"`
  (per AC 2's explicit requirement) and a mode-appropriate label for `"mock"` (test-only, does not
  need to claim a production status write either — do not invent new claims for it, just don't
  reuse the same over-claiming "advanced" wording that caused this bug). Exact wording is an
  implementation choice; the constraint is "no delivery mode's banner text claims a synchronous
  status change occurred."
- `packages/quay/test/serve.test.mjs` (checked directly, not assumed): no existing test asserts the
  exact banner STRING "advanced" — assertions check only for `?success=` param presence/absence and
  generic `.success-banner` element rendering (lines 609-612, 597-605, 565-573). Changing the banner
  TEXT is confirmed safe for the existing suite; do not skip AC 4's full-suite-green re-check anyway.

## In scope
1. Condition the POST action-route's `successMsg` on `result.delivered` in `serve.js` — three
   distinct, honest banner strings (or a shared template parameterized by delivery mode), per AC 1/2.
2. Verify the corrected banner text live in a real browser (Playwright or chrome-devtools MCP) for
   at least the `"print"`-degraded case, per AC 3 — this is the realistic default deployment
   (bare `quay serve`, no `manda`), and is the exact evidence class (live browser, not static
   inspection) that surfaced this gap at M28 in the first place. Do not substitute a unit/integration
   test alone for this step.
3. Add or update `packages/quay/test/serve.test.mjs` coverage asserting the new conditional banner
   behavior (both a `"print"`-mode and, if feasible without a live `manda` binary, a `"mock"`-mode
   case using the existing `QUAY_ACTION_MOCK_LOG` test harness pattern already used elsewhere in
   this suite) — this satisfies Clause 7's test-floor requirement for this product-touching
   (`surface:web-ui`) milestone; record the resulting coverage disposition explicitly at ABSORB.

## Explicitly OUT of scope
- **G-S4-02** (wiring a real synchronous/in-process delivery mode for bare `quay serve`) — a
  separate, larger, future candidate per the task's own scope note; `deliverTrigger()`'s
  `mock`/`manda`/`print` branch LOGIC must be unchanged, confirmed via `git diff --stat` at ABSORB
  (only the `serve.js` banner-text consumer changes).
- Any change to `client.taskCheck`/gate logic, the `?error=` path, or the open-redirect
  `isSafeRelativeRedirect()` guard (M26-adversarial-eval/DIR-something scope) — this milestone only
  touches the SUCCESS-path banner text.
- V_meta consolidation-lag gate: N/A — `v-meta-ledger.md`'s one row is already `consolidated` (m7),
  no `confirmed`-and-unresolved rows exist (re-confirm at ABSORB, not assumed here).
- Design-only-milestone impl-row/escrow-Δv gates: N/A — this milestone ships real code directly, not
  a design doc (gates do not apply per their own trigger condition, no exemption claimed).

## Done-when (binary clauses)
Mirrors the task's 5 Acceptance Criteria exactly (see `tasks/exp5-M-WEBUI-TRIGGER-HONESTY.md`) plus
the standard cross-cutting hygiene clause:
1. `serve.js`'s POST action-route banner text is conditioned on `result.delivered`, no mode claims a
   synchronous status write that did not occur.
2. `"print"`/`"manda"` cases use "requested"-flavored language, not "advanced"/"done".
3. Live-browser verification (Playwright/chrome-devtools) confirms the corrected text renders for
   the `"print"`-degraded case — screenshot or DOM-snapshot evidence cited in the report.
4. Full `packages/quay` test suite green before AND after; new/updated test coverage for the
   conditional banner behavior recorded as this milestone's Clause 7 (test-floor) disposition.
5. `git diff --stat` confirms `deliverTrigger()`'s delivery-mode branch logic in `action.js` is
   byte-for-byte unchanged (only `serve.js`'s banner-text consumption changes) — G-S4-02 untouched.
6. `git diff --stat` scoped to `packages/quay/src/serve.js`, `packages/quay/test/serve.test.mjs`,
   `tasks/exp5-M-WEBUI-TRIGGER-HONESTY.md`, this milestone's own charter/reports — no unrelated
   files touched, real repo-root `tasks/` directory confirmed untouched by any test run.

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131 for the full literal text; both dispatched iteration prompts must include it verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged (same discipline as M25-M32). The manda
healthz gate and port-4173 reachability gate from the pinned block ARE applicable this time (Web UI
surface, live browser verification required) — both iterations must actually stand up `quay serve`
and verify port reachability as part of AC 3's live-browser step, not state N/A.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-line-budget-check.sh` against this charter: 3 in-scope items — under the
  small-milestone threshold (8). PASS expected, re-confirm before dispatch.
- `it0-impl-row-check.sh exp5-M-WEBUI-TRIGGER-HONESTY backlog.md`: not design-only, gate does not
  apply — PASS expected (re-run after `backlog.md` regen picks up this task's new row/status).

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Runs regardless of VT cadence per the now-corrected Clause 1 text — dispatch a fresh-context,
out-of-band adversarial-audit subagent at ABSORB, refute-first stance against this task's 5 AC
clauses + DoD. Given this milestone is `surface:web-ui` (product-touching, Clause 7 fires), the
audit must independently confirm the live-browser verification evidence is real (re-run it, not
trust a screenshot/log claim at face value) and confirm the recorded test-coverage disposition for
Clause 7 is genuine (tests actually pass, not merely asserted to exist).

## Note for ABSORB
1. Confirm the banner-text fix was verified live in a real browser for the `"print"`-degraded case
   specifically (the realistic default), not merely unit-tested.
2. Confirm `deliverTrigger()`'s branch logic is byte-identical pre/post (G-S4-02 untouched) via
   `git diff --stat`.
3. Record the Clause 7 (test-floor) disposition explicitly — either a real ≥80%-equivalent coverage
   statement for the touched banner-text logic, or reasoning for why the existing
   `serve.test.mjs` coverage already suffices, with the new/updated test(s) named.
4. State whether G-S4-02 (larger scope, deferred) should be a future SELECT candidate, and whether
   this milestone's work surfaced anything that changes that scope estimate.
5. `exp5-M-NATIVE-RELATION-SYNC` remains the other open exploit/capability-growth candidate,
   untouched by this milestone — state explicitly whether it or a DIR-017-Step-3-sourced candidate
   should be the m34 SELECT pick, per the same "do not silently assume" discipline used at m32→m33.

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit, same
worktree/branch-per-iteration pattern as M25-M32 (`experiments/quay-perpetual-stream/milestones/
M33-webui-trigger-honesty/worktrees/iteration-{0,1}`, branches
`exp5-m33-iteration-{0,1}`). Iteration-1 must NOT read iteration-0's materials (independent-
verification discipline). Both iterations MUST use real Playwright or chrome-devtools MCP browser
automation for AC 3/Done-when-3 — a static-source-only "verification" does not satisfy this
milestone's own Done-when clause (this is the exact gap class M28 found and this charter exists to
close; iterating without live-browser evidence would repeat the same evidence-quality mistake at
one remove). Both iterations must also independently confirm no existing `serve.test.mjs` assertion
depends on the literal "advanced" banner string before changing it (already spot-checked at
charter-authoring time above — re-confirm, do not just trust this charter's own claim).
