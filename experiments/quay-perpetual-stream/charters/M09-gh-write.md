# Charter M09-gh-write — GitHub Provider write-completeness (Tier-A)

**Milestone id:** M09-gh-write · **surface:** Provider-ABI (20) · **type:** explore
**Source:** gap-list `PR-ABI-001` (significant) + `PR-ABI-002` (minor), found by M03-abi-eval (m3);
backlog `M-GH-WRITE`/`M-GH-PARENT` rows, next in the standing selection order recorded at m5/m6's
ABSORB ("M-SIZING → M-MERGE-RECOVER → M-GH-WRITE → M-GH-PARENT (bundled) → checkpoint 2").
**Charter authored:** m8→m9 boundary, 2026-07-18, chart-1.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's current
HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis (recorded BEFORE dispatch, §4.1/§6.2)
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **capability-growth** (primary —
  quay-github's `task_write` today only supports `status`; title/body/labels writes are real,
  previously-unbuilt capability, not a regression) + **risk/option** (secondary — PR-ABI-001's
  silent-drop failure mode is a real danger: a caller attempting `title` write today gets no error
  and no effect, which is worse than an explicit "unsupported" rejection; closing this reduces a
  live footgun even if the stretch write-support goal is only partially reached).
- Current baseline (`milestones/M03-abi-eval/capability-matrix.md`, confirmed live this
  charter-authoring pass via direct source read of `packages/quay-github/src/mcp-server.js` and
  `github-client.js`): **Provider-ABI cov = 0.654** (write fraction 1/5 fields — `status` only;
  `title`/`body`/`labels`/`parent`-`children`-write all unimplemented, `title` silently dropped by
  the MCP SDK's zod input stripping rather than erroring). `github-client.js#get()`'s `parent` is
  unconditionally `null` (single-issue lookup never builds `parentIndex`), asymmetric vs `list()`
  which resolves `parent` correctly (PR-ABI-002).
- Target (conservative, re-baseline at ABSORB from REALIZED evidence, not this placeholder):
  Provider-ABI cov 0.654→~0.80 (write fraction 1/5→~3/5 realistic for this milestone's scope —
  title+labels write real, body write real, parent/children write explicitly NOT attempted this
  milestone per scope note below) → Δv̂ ≈ (0.80−0.654)×20 = **+2.9**. Backlog's own pre-charter
  estimate was "+3 to +4" assuming full write completion (4/5 fields); this charter's scope is
  narrower (see below), so the placeholder is intentionally more conservative — realized number at
  ABSORB is authoritative, not this estimate.
- Metric `Y`: binary Done-when completion (below), each independently pasted-evidence checkable
  against the REAL `yaleh/quay` GitHub repository (same live-mutation discipline M01-dist/M03-abi-eval
  already established — no fabricated success, real API calls against a real repo).

## In-scope gap subset (the ONLY gaps this milestone may work; no gap-list-wide sweep)
1. **PR-ABI-001 (primary) — real `title`/`body`/`labels` write support.** Extend
   `packages/quay-github/src/mcp-server.js`'s `task_write` input schema to accept optional `title`,
   `body`, `labels` fields (alongside the existing `status`), and `packages/quay-github/src/
   github-client.js`'s `setStatus`-adjacent write path (rename/generalize as needed, e.g. a new
   `writeFields(id, fields)` sharing the existing `ghApiRun` PATCH pattern already used for
   `state`/labels) to actually apply them via `gh api ... -X PATCH -f title=... -f body=...` (title/
   body) and the existing add/remove-label endpoints generalized beyond just `status:*`/`lane:*`
   labels. Real, live-mutating write against the real `yaleh/quay` repo (an existing test/scratch
   issue, not a random real one) required for Done-when evidence — same live-mutation discipline as
   M01-dist's own CI dogfooding.
2. **PR-ABI-001 (floor) — hard error on any field this milestone does NOT implement.** Whatever
   subset of `title`/`body`/`labels`/`parent`/`children` remains unimplemented after item 1 (this
   charter does not commit to `parent`/`children` write — see exclusion below) MUST cause
   `task_write` to return an explicit MCP tool error (`isError: true`, descriptive message), not the
   current silent-drop-via-zod-stripping behavior. This floor must hold even if item 1's real-write
   stretch is only partially completed — it is the non-negotiable minimum this milestone must ship
   regardless of how much of item 1 lands.
3. **PR-ABI-002 — fix `get()`'s parent asymmetry.** `github-client.js#get()` currently always
   returns `parent: null` (single-issue lookup, no `parentIndex`). Fix by having `get()` also call
   `fetchAllIssues()` + `buildParentIndex()` (the same functions `list()` already uses) before
   building its view-model — accepting the extra API-call cost for correctness, per the gap-list
   entry's own suggested fix ("`github-client.js#get()` needs the same parentIndex lookup `list()`
   already does"). Verify live against a real parent/child issue pair already used by
   M03-abi-eval's own conformance suite (`gh-5`/`gh-7`, per PR-ABI-002's gap-list citation) — confirm
   `task_get gh-5` now reports `parent: "gh-7"`, matching `task_list`'s existing correct result.
4. **Explicit exclusions**: `parent`/`children` WRITE (creating/reassigning the checkbox-based
   parent/child link) is out of scope this milestone — read-side (item 3) only. This is a
   deliberately smaller, safer slice: parent/child write would require editing another issue's BODY
   TEXT (the parent's checkbox list), a materially different and riskier write path than the
   title/body/labels PATCH-on-self path items 1-2 use — worth its own future milestone if selected,
   not bundled here to keep this milestone's blast radius contained (per the M06-sizing gauge, avoid
   over-sizing). Do not attempt cross-issue body mutation this milestone.
5. **Conformance-suite update**: `packages/quay/test/provider-abi-conformance.test.mjs`'s existing
   `github/primitive/task_write-unsupported-field-probe` scenario (which currently asserts the
   silent-drop behavior as a documented finding, per PR-ABI-001's own citation) must be updated to
   assert the NEW behavior — real write for title/labels/body, explicit error for whatever remains
   unsupported (item 2's floor) — not left asserting the now-fixed old behavior as if it were still
   correct.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `task_write` with a real `title` value against a real scratch/test issue on `yaleh/quay`
   actually changes the issue's title (live-verified via `gh issue view <id>` before/after) —
   pasted before/after output.
2. `[ ]` `task_write` with a real `body` value likewise actually changes the issue's body
   (live-verified) — pasted before/after output.
3. `[ ]` `task_write` with a real `labels` value actually adds/removes labels on the real issue
   (live-verified via `gh issue view <id> --json labels`) — pasted before/after output.
4. `[ ]` `task_write` with any field this milestone does NOT implement (e.g. `parent`/`children`, or
   any field left unimplemented if items 1-3 are only partially completed) returns an explicit MCP
   tool error (`isError: true`) rather than silently no-op'ing — pasted tool-call output showing the
   error.
5. `[ ]` `task_get gh-5` (or the equivalent real parent/child pair used by M03-abi-eval) reports
   `parent` matching `task_list`'s already-correct result for the same task (PR-ABI-002 fixed) —
   pasted output, both commands compared.
6. `[ ]` `provider-abi-conformance.test.mjs`'s `task_write-unsupported-field-probe` scenario (and any
   other affected scenarios) updated to assert the NEW real-write/explicit-error behavior; full
   existing test suite (native + github, all files) passes — pasted raw output, not a summary.
7. `[ ]` `milestones/M03-abi-eval/capability-matrix.md`'s write-fraction cells and
   `dashboard.md`'s chart-1 Provider-ABI cov re-scored from this milestone's OWN live re-verification
   evidence (not the placeholder above); gap-list.md's `PR-ABI-001`/`PR-ABI-002` entries updated to
   reflect real closure, citing live command output directly (mirroring MD-001/M08's own closure
   discipline).

Milestone is DONE when all seven are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2–5 if they fire first (ΔV plateau K=2, ceiling, budget≈10 past with nothing
climbing, external HALT). If item 1's real-write stretch proves infeasible within budget (e.g. GitHub
API rate-limiting, permissions), Done-when 2 (floor: explicit error for unimplemented fields) is the
minimum-viable fallback the milestone must still ship — do not silently drop the floor requirement
even if the stretch goal is abandoned.

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch.

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop · (4) budget≈10
backstop, past→default HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — re-verify at it0 that PR-ABI-001/PR-ABI-002 are still live-confirmed
   present on current master (charter-authoring-time evidence is from a direct source read at
   charter-authoring time; re-check via fresh `gh api`/source-read in case anything shifted).
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted live command/file/test
   output; items 1-3/5 specifically require REAL live-mutation evidence against `yaleh/quay` (a
   scratch/test issue for title/body/labels mutation — do not mutate real production issues that
   matter to this repo's own tracking; `gh-5`/`gh-7` for the read-only parent-check in item 5 is safe,
   already used read-only by M03-abi-eval).
d. **Domain-misfit audit-channel** — per `inherited-core.md`'s CONSOLIDATED φ-confirmed pattern (added
   m7 ABSORB, reused m8): the audit channel for this milestone is a CI job / independently-triggered
   test run of the updated conformance suite, NOT the same-process local test run that writes the
   fix — apply the now-twice-confirmed convention as a further real-world reuse.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher. Record each iteration under
`experiments/quay-perpetual-stream/milestones/M09-gh-write/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M09-gh-write/worktrees/iteration-N`, branch
`exp5-m09-iteration-N`.
