# Charter M12-abi-parent-write — GitHub Provider parent/children WRITE (Tier-A)

**Milestone id:** M12-abi-parent-write · **surface:** Provider-ABI (chart-1) · **type:** exploit
**Source:** `backlog.md`'s Provider-ABI stretch scope, explicitly excluded by `charters/M09-gh-write.md`
Done-when item 4 ("parent/children WRITE ... out of scope this milestone ... worth its own future
milestone if selected"). Picked at m11→m12 boundary over the four DIR-001-sourced methodology-infra
candidates (M-OUTCOME-EVAL/M-ADVERSARIAL-EVAL/M-COMPETITIVE-BENCH/M-HUMAN-REVIEW-CADENCE, all still
"not yet charter-ready" per `backlog.md`) because this candidate is: (a) already well-bounded and
scoped by M09's own exclusion note, (b) real capability-growth VT-scoring work — genuinely typed
`capability-growth` in its value hypothesis below, unlike m11's discovery/risk-option-only
re-verification — giving `OUTER-LOOP.md`'s new adversarial-audit-role gate (built M10, adjudicated
as correctly NOT firing at m11's ABSORB) its actual first-proof trigger, per cp-02's own stated
expectation that "the next VT-scoring milestone" would be that test.
**Charter authored:** m11→m12 boundary, 2026-07-18, chart-1.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's current
HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **capability-growth** (primary
  — closes the last unimplemented Provider-ABI write field, github write cov 4/5→5/5) + **risk/option**
  (secondary — a materially different write path than M09's PATCH-on-self fields; getting it right
  reduces future divergence risk between native and github providers' parent/child semantics).
- Δv̂ (rough estimate): Provider-ABI weight 20/120 at cov formula `(reads+writes+gate+skill)/(5+5+2+1)
  = 13`. Current write=4/5; closing to 5/5 moves cov from 12/13=0.9231 to 13/13=1.00, i.e.
  20×(1.00−0.9231) ≈ **+1.54 VT points** if fully closed. Stated as a ceiling, not a promise — actual
  realized Δv may be smaller if the implementation only partially closes the gap (e.g. add-child-link
  only, not full reassign-parent semantics) or larger only up to this ceiling (§4.4a).
- Metric `Y`: Provider-ABI cov (dashboard.md's existing per-capability table), re-derived per-capability
  exactly as M09's own ABSORB did.

## In-scope work
1. **Add parent/children WRITE to `packages/quay-github/src/github-client.js`.** The GitHub provider's
   read-side convention (`extractChildRefs`, `CHILD_CHECKBOX_RE = /^\s*-\s*\[[ xX]\]\s*#(\d+)\s*$/gm`,
   `github-client.js:28`) parses a parent issue's BODY TEXT for `- [ ] #<number>` / `- [x] #<number>`
   checkbox lines to derive child links. The write side must produce/maintain that SAME format when a
   parent-child link is created or changed — i.e. writing `parent`/`children` for a task means editing
   the appropriate issue's body text to add/remove a checkbox line referencing the other issue's number,
   not a separate metadata field (GitHub issues have no native parent-link field).
2. **Scope the write semantics precisely, matching the native provider's `task_write` contract where
   reasonable** (`packages/quay-native/src/store.js:264-307`, `parent`/`children` frontmatter fields) —
   but adapted to the checkbox-in-body mechanism: writing `children: [...]` on a task should add/remove
   `- [ ] #<n>` lines in THAT task's own body to reflect the desired child set; writing `parent: <id>`
   on a task should add a `- [ ] #<n>` line (referencing this task) to the TARGET parent's body (a
   cross-issue mutation) and remove it from any PRIOR parent's body (reassignment case) — record the
   exact chosen semantics explicitly in the iteration report, since GitHub's checkbox convention has no
   single canonical direction and this decision needs to be stated, not implicit.
3. **Preserve checkbox check-state.** If a checkbox line for a given child already exists with `[x]`
   (checked/done), a write that merely reorders/re-derives the children list must not silently reset it
   to `[ ]` — this is a real footgun the native provider's frontmatter-array approach doesn't have to
   worry about (no per-item state to lose) but the github checkbox format does.
4. **Update `packages/quay-github/src/mcp-server.js`'s `task_write` tool**: accept `parent`/`children`
   fields (add to `TASK_WRITE_SUPPORTED_FIELDS` and the zod schema), remove the explicit isError
   rejection text currently citing "M09-gh-write charter" for these two fields specifically, update the
   tool description. Any field still genuinely unsupported keeps the existing hard-error floor
   (PR-ABI-001's fix) — do not weaken that for unrelated fields.
5. **Update `packages/quay/test/provider-abi-conformance.test.mjs`** to assert real parent/children
   write behavior for github (mirroring however the native provider's own conformance scenario is
   asserted), replacing any now-stale "parent/children write unsupported" assertion.
6. **Live-verify against a real parent/child issue pair** — reuse or extend the same `gh-5`/`gh-7` (or
   equivalent) scratch pair M03-abi-eval's conformance suite and M09's own PR-ABI-002 fix already used,
   with real `gh issue view` before/after transcripts proving the checkbox line was actually added/
   removed/preserved on the real GitHub-hosted issue body, not just asserted in a mocked test.
7. **Explicit exclusions** (state, don't silently drop): if full bidirectional reassign-parent semantics
   (removing from old parent AND adding to new parent atomically) proves materially harder than a
   simpler add/remove-child-on-one-issue primitive, it is acceptable to ship the narrower primitive and
   record the remaining gap as a new, precisely-scoped backlog candidate — do not silently claim full
   parity if only a subset ships. This mirrors M09's own precedent (shipped 4/5 fields, hard-error floor
   for the rest, explicit backlog candidate for what remained).

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `github-client.js` gains a parent/children write function (name of your choosing, following
   the `writeFields`-adjacent style already established) that mutates the correct issue's body text to
   add/remove `- [ ] #<n>` checkbox lines, preserving existing checked (`[x]`) state — pasted diff.
2. `[ ]` The exact write semantics chosen (which issue's body is mutated for a `parent` write vs. a
   `children` write, and whether reassignment removes the old link) are explicitly stated in the
   iteration report, not left implicit.
3. `[ ]` `mcp-server.js`'s `task_write` tool accepts `parent`/`children`, the now-stale hard-error text
   citing M09's exclusion is removed/updated, and the schema change is pasted as a diff.
4. `[ ]` A real live `gh issue view` before/after transcript on an actual GitHub-hosted issue pair
   proves the checkbox write worked (added), and a second transcript proves either removal or
   reassignment worked as scoped by item 2 above.
5. `[ ]` `provider-abi-conformance.test.mjs` is updated and passing (full raw test output pasted, not a
   summary) to assert the new real write behavior, not the old unsupported-field assertion.
6. `[ ]` `dashboard.md`'s Provider-ABI write cov is re-derived per-capability (same style as M09's own
   ABSORB entry) — pasted diff — reflecting whatever was actually shipped (full 5/5 or a documented
   partial, per item 7's exclusion allowance).
7. `[ ]` Full existing test suite passes (pasted raw output, not summarized) — this milestone DOES touch
   product code (`github-client.js`, `mcp-server.js`), unlike m10/m11.
8. `[ ]` If any scope had to be narrowed per the "Explicit exclusions" item above, a new backlog.md
   candidate row is added recording exactly what remains, with the same rigor M09 used for its own
   parent/children-write exclusion note.

Milestone is DONE when all eight are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2–5 if they fire first. Sized to the recent 6-8-clause norm, consistent with M09's
own comparable scope (real cross-issue GitHub write, live-verified against a real repo).

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
a. **Ceiling/floor arithmetic** — max plausible upside ≈+1.54 VT points (cov 12/13→13/13 at Provider-
   ABI's 20/120 weight); re-verify at it0 that this arithmetic still holds against the CURRENT
   dashboard.md numbers (not stale) before dispatch.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires a pasted diff, raw test output, or
   real `gh issue view` transcript; no clause may be marked met on narrative alone.
d. **Domain-misfit audit-channel** — this milestone's own domain (GitHub provider write) has a
   directly-applicable, already-twice-confirmed mechanism: `provider-abi-conformance.test.mjs`
   (domain-audit-channel≡CI-job pattern, φ-consolidated at m7) — a THIRD reuse of this convention,
   same domain M03/M09 already used it in.

## Adversarial-audit gate — this milestone is expected to trigger it (record explicitly at ABSORB)
Per `inherited-core.md`'s Adversarial-audit cadence rule condition (a): this charter's own value
hypothesis types the milestone `capability-growth` with a nonzero Δv̂ ceiling stated above. If ABSORB's
realized Δv is nonzero (expected, though possibly smaller than the ceiling per item 7's exclusion
allowance), condition (a) fires and the out-of-band adversarial-audit role
(`inherited-core.md`'s "Adversarial-audit role" section) MUST be dispatched by the OUTER loop itself
before the VT-curve append / Done-when-complete claim is finalized — this is the gate's real
first-proof test (m11's own ABSORB determined the gate correctly did NOT fire there, since m11 was
discovery/risk-option-typed with Δv=0; m12 is the first milestone since M10 built the gate that is
genuinely capability-growth-typed).

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher. Record each iteration under
`experiments/quay-perpetual-stream/milestones/M12-abi-parent-write/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M12-abi-parent-write/worktrees/iteration-N`, branch
`exp5-m12-iteration-N`.

**Live GitHub access note:** this milestone requires real `gh` CLI / GitHub API write access to the
same scratch repo M03-abi-eval/M09-gh-write already used (parent/child issue pair `gh-5`/`gh-7` or
equivalent) — confirm reachability at it0 before dispatch, same discipline as M09's own it0 check.
