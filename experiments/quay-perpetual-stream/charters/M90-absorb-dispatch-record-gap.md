# Charter M90-absorb-dispatch-record-gap — ABSORB dispatch-record documentation fix (exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP)

**Milestone id:** M90  
**Task:** `tasks/exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP.md` (milestone-candidate, defect)  
**Surface:** `experiments/quay-perpetual-stream/OUTER-LOOP.md` step 6 ABSORB narrative  
**Type:** governance-integrity / instrument-correction  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

M88 history-mining surfaced a recurring defect: the ABSORB step repeatedly fails Clause 12
(audit-independence) because the ABSORB-entry does not include a `Dispatch record:` line in the
`## Audit-independence check` section — or when it does, no dispatch-record file was pre-created
with the audit session ID. The error recurred 4× in M82 and was manually worked-around in M88 and
M89 without codifying the fix.

Root cause: `OUTER-LOOP.md` step 6's "Ordering + disposition authoring" sub-step describes the
`## Audit-independence check` section's three required fields (`Artifact:`/`Orchestrator id:`/
`Dispatch record:`) only in the context of Clause 12's mechanical description, not as an operator
procedure with a concrete example. The orchestrator lacks a step-by-step sample for:
1. Creating `/tmp/m<NN>-dispatch-record.txt` (bare audit session ID, one per line)
2. Populating `Dispatch record: /tmp/m<NN>-dispatch-record.txt` in the absorb entry

**Fix scope:** targeted text addition (~20 lines) to OUTER-LOOP.md step 6's "Ordering + disposition
authoring" sub-step — add an explicit operational procedure with a concrete sample ABSORB-entry
`## Audit-independence check` block and the dispatch-record file creation step.

## Scope

**In scope:**

1. **OUTER-LOOP.md step 6 text edit** — add to the "Ordering + disposition authoring" sub-step:
   - Explicit instruction to create `/tmp/m<NN>-dispatch-record.txt` containing the audit session
     ID (bare, one per line) when dispatching the adversarial audit subagent and recording the
     session ID it runs under.
   - A concrete sample `## Audit-independence check` block showing the correct format for all
     three fields, including `Dispatch record: /tmp/m<NN>-dispatch-record.txt`.
   - Reminder that `Dispatch record: N/A` is only valid if `--allow-uncorroborated` is
     intentional (no real independent audit was dispatched — unusual).

2. **Test proof** — create a synthetic ABSORB entry following the updated template and verify
   `it0-dod-check.mjs` Clause 12 passes on it (with a real dispatch-record file containing the
   expected session ID), proving the template is correct.

**Out of scope:**
- Changes to `it0-dod-check.mjs` Clause 12 logic (gate is correct)
- Changes to `it0-dod-check.sh` signature
- Changes to `audit-independence-check.sh` or `.mjs`
- Changes to any charter template or other scripts
- Fixing existing ABSORB entries retroactively

**Behavior-preserving constraints:**
- `it0-dod-check.mjs` Clause 12 logic: unchanged (grep confirms no edits)
- All existing ABSORB entries already landed: unaffected
- OUTER-LOOP.md behavior: text-only addition, no logic change

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** ~20L OUTER-LOOP.md text + ~15L test ABSORB entry = ~35L. Under 2000L ceiling.

**(b) gate-hash (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time.

**(d) domain-misfit audit-channel:** The audit mandate is to read OUTER-LOOP.md and verify the text change achieves its stated goal; independent iteration-1 re-derives the same edit from scratch and checks equivalence. Standard methodology-class audit channel.

**(e) plan-time line-budget gate:** ~35L estimated. Under 2000L ceiling.

## Class routing

**Methodology/design-class** (deliverable is a methodology doc edit to OUTER-LOOP.md — the
operator procedure document). **Whole-milestone independent dual-iteration**: iteration-0 authors
the text fix + test proof; iteration-1 independently re-derives the same edit from a fresh
worktree and checks equivalence.

No `quay-task-to-plan` pipeline invocation — unchanged for methodology-class milestones.

## Value hypothesis

- **Y:** OUTER-LOOP.md step 6 includes an explicit dispatch-record file creation step + sample `## Audit-independence check` block; a synthetic ABSORB entry following the updated template passes Clause 12 on first attempt
- **Δv̂ = 0** (governance-integrity / instrument-correction fix, no VT chart-1 cell)
- **Value type:** governance-integrity / instrument-correction

## Done-when (binary)

1. `OUTER-LOOP.md` step 6 "Ordering + disposition authoring" sub-step includes explicit operational guidance for creating the dispatch-record file and the correct `## Audit-independence check` sample block — paste the diff.
2. A synthetic ABSORB-entry file created following the updated template passes `it0-dod-check.mjs` Clause 12 (`clause12-audit-independence: PASS`) on first attempt — paste the output.
3. `it0-dod-check.mjs` Clause 12 logic is unchanged — grep/diff confirms no edits to `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` (only OUTER-LOOP.md touched).
4. Adversarial audit verdict recorded.
5. `quay gate exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP` exits 0 — paste exit code.

## Inner termination (§3.2)

1. All 5 Done-when confirmed.
2. ΔV < 0.02 both layers, K=2 consecutive.
3. Ceiling exceeded → `needs-human`.
4. Past budget ~10 iterations.
5. External HALT.

## HARD GATES (by-reference):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly.

## Per-milestone acceptance audit (UNCONDITIONAL)

Specific charge:
1. Read the updated OUTER-LOOP.md step 6 "Ordering + disposition authoring" sub-step; verify the dispatch-record file creation step and sample `## Audit-independence check` block are present and correct.
2. Read the synthetic test ABSORB entry produced by iteration-0; verify it follows the new template.
3. Paste the `it0-dod-check.mjs` output confirming Clause 12 PASS on the synthetic entry.
4. Confirm `it0-dod-check.mjs` was NOT modified (grep the Clause 12 block, compare SHA).
5. Run `quay gate exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP` — confirm exit 0; paste output.

Output to `milestones/M90/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP experiments/quay-perpetual-stream/charters/M90-absorb-dispatch-record-gap.md /tmp/m90-absorb-entry.md`
- `quay gate exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP`
- Worktree: `milestones/M90/worktrees/iteration-0` off master HEAD
- milestone_counter: do NOT increment until all gates clear
- Dashboard row: `m90 · exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M90/`
- No Web UI verification required (no Web UI surface change)
- VT Δ = 0
- **CHECKPOINT:** 90 % 5 == 0 → write `experiments/quay-perpetual-stream/checkpoints/cp-90.md` after `milestone_counter` increments; non-blocking (loop continues after writing).
