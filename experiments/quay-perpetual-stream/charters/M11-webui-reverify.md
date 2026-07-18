# Charter M11-webui-reverify — Re-verify M04-discover's Web UI cov claim with real browser tooling (Tier-A)

**Milestone id:** M11-webui-reverify · **surface:** Web UI (chart-1) · **type:** exploit
**Source:** `backlog.md` `M-WEBUI-REVERIFY` row (DIR-006 item 2 / M10-audit-consolidation Done-when 2).
**Charter authored:** m10→m11 boundary, 2026-07-18, chart-1.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's current
HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Why now
`inherited-core.md`'s "Web UI verification requirement" section (added M10-audit-consolidation)
demoted `curl`-only evidence for Web UI rendering/interaction claims. `dashboard.md`'s Web UI row
(cov 0.92) is annotated **⚠️ PROVISIONALLY UNCERTAIN** — its only pasted evidence is two `curl`
commands, zero `mcp__playwright__*`/`mcp__chrome-devtools__*` traces. This milestone performs the
actual re-verification DIR-006 item 3 explicitly deferred.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **discovery** (primary — an
  independent audit channel re-checking a provisionally-uncertain claim) + **risk/option**
  (secondary — closes the exact evidence gap DIR-006 found before a third instance of the same
  failure class recurs). If the re-verification finds the 0.92 number wrong, the correction itself
  is **instrument-correction** value (not capability-growth) — this must be recorded honestly at
  ABSORB, not folded into a capability-growth Δv̂.
- **VT-scoring**: this milestone's ABSORB may append a nonzero Web UI cov Δv (whichever direction
  the live evidence supports) — condition (a) of `OUTER-LOOP.md`'s Adversarial-audit cadence rule
  therefore applies. Per that gate, an out-of-band adversarial-audit dispatch is a HARD BLOCK on
  this milestone's VT-curve append / Done-when-complete claim, in addition to iteration-1. Record
  this explicitly at ABSORB — do not silently skip it.
- Metric `Y`: Web UI cov (currently 0.92, provisionally uncertain) — CONFIRM (remove the ⚠️
  annotation, keep 0.92) or CORRECT (new live-derived number, with full rationale) based on real
  evidence, never narrative.
- Δv̂ (rough estimate, stated for calibration tracking, not a target to hit): ±0.5 to ±2.0 VT
  points depending on direction/magnitude of any correction; 0 if fully confirmed unchanged.

## In-scope work
1. Re-run M04-discover's own claimed list/detail/filter/search/action-flow checks using REAL
   `mcp__playwright__*` or `mcp__chrome-devtools__*` tool calls (not `curl`), against the actual
   running product (same target M04-discover's own iteration-0 used).
2. Cover BOTH configured viewports per `inherited-core.md`'s dual-viewport requirement: desktop
   1280×800/900 and mobile 390×844 (device pixel ratio ×3, emulated touch).
3. Specifically re-check the two findings M04-discover's own report claimed (UQ-049 `?search=` vs
   `?q=` param no-op; UQ-050 mobile title-text CSS overflow) with live browser evidence, not just
   the flows generally.
4. Based on the live evidence: either (a) CONFIRM 0.92 and remove the ⚠️ PROVISIONALLY UNCERTAIN
   annotation in `dashboard.md`, or (b) CORRECT the cov number with a fully re-derived rationale
   (same per-capability arithmetic style as the existing Web UI row), explicitly labeled
   instrument-correction if it moves.
5. Do NOT touch product code — this is a verification-only milestone. If a genuine product bug is
   found in the process (not already known as UQ-049/UQ-050), record it as a new backlog candidate,
   do not fix it inline (out of scope, avoids scope creep into an exploit-and-fix milestone).

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` A literal pasted `mcp__playwright__*`/`mcp__chrome-devtools__*` tool-call trace exists,
   covering: navigation to the actual list/detail/filter/search/action-flow pages, AND at least one
   screenshot or DOM/accessibility snapshot per viewport, at BOTH desktop (1280×800/900) and mobile
   (390×844) viewports — per `inherited-core.md`'s Web UI verification requirement, verbatim
   evidence bar (not narrative language, not `curl`).
2. `[ ]` UQ-049 (`?search=` vs `?q=` param) and UQ-050 (mobile title overflow) are each explicitly
   re-checked with live evidence and their status (still-present / fixed / could-not-reproduce)
   recorded with the supporting trace.
3. `[ ]` `dashboard.md`'s Web UI row is updated: either the ⚠️ PROVISIONALLY UNCERTAIN annotation is
   removed (0.92 CONFIRMED, with the live evidence cited in place of the old curl-only citation) or
   the cov number is corrected with full re-derivation and the value type recorded as
   instrument-correction — pasted diff either way.
4. `[ ]` No product code touched this milestone (pure verification); if a genuine new product issue
   is found, it is recorded as a new `backlog.md` candidate row, not fixed inline — pasted diff of
   the new row if applicable, or explicit statement "no new issues found" if none.
5. `[ ]` `backlog.md`'s `M-WEBUI-REVERIFY` row is marked DONE with a realized-outcome summary
   (mirroring the M-GH-WRITE/M-GH-PARENT precedent from m9).
6. `[ ]` Per `OUTER-LOOP.md`'s Adversarial-audit cadence rule condition (a) (VT-scoring milestone):
   the out-of-band adversarial-audit role (`iteration-N-adversarial-audit.md`, dispatched by the
   OUTER loop itself, fresh-context `baime:iteration-executor`, NOT folded into iteration-1) MUST be
   dispatched and reach a verdict (REFUTED / CONCERNS / NO REFUTATION FOUND) BEFORE this milestone's
   Δv is appended to the VT curve or Done-when-complete is claimed. This is this gate's first real
   trigger since it was built at M10 — treat as a first-proof test, not a formality.

Milestone is DONE when all six are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2–5 if they fire first. Sized small-to-medium per `backlog.md`'s own note — a
single build+verify cycle, consistent with the recent 5-7-clause norm (M06-sizing's own gauge).

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
a. **Ceiling/floor arithmetic** — Web UI weight 20/120 at cov 0.92 = 18.40; ceiling at cov=1.00
   would be 20.00 (+1.60 max plausible upside); floor at cov=0.00 is not realistic (existing flows
   demonstrably work) — a real correction, if any, is expected to be small, consistent with Δv̂.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires a pasted tool-call trace or diff;
   no clause may be marked met on narrative alone (this IS the milestone's entire point, per DIR-006).
d. **Domain-misfit audit-channel** — this milestone's own domain (Web UI browser verification) has a
   directly-applicable mechanism: the `mcp__playwright__*`/`mcp__chrome-devtools__*` tool-call trace
   itself IS the audit channel (a reproducible, independently-inspectable artifact, not prose) — this
   is the domain M04-discover's own charter already scoped but under-evidenced; M11 supplies the
   missing audit channel for the same domain, closing the exact gap DIR-006 found.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher. Record each iteration under
`experiments/quay-perpetual-stream/milestones/M11-webui-reverify/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M11-webui-reverify/worktrees/iteration-N`, branch
`exp5-m11-iteration-N`.

**MCP tool access note:** the dispatched agent needs live access to
`mcp__playwright__*`/`mcp__chrome-devtools__*` tools and the actual running product (dev server) —
confirm both are reachable from the dispatch context before starting iteration-0; if neither is
reachable, this IS a §3.2 condition-3 ceiling trigger (no independent audit channel reachable) and
the milestone must be redesigned or the gap recorded, not silently worked around with `curl` again.
