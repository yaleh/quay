# Charter M89-yaml-frontmatter-crash — YAML frontmatter colon crash fix (exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH)

**Milestone id:** M89  
**Task:** `tasks/exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH.md` (milestone-candidate, defect)  
**Surface:** `packages/quay-native/src/` task write path  
**Type:** capability-growth / risk-reduction (production-safety defect)  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

M88 history-mining exploration (explore) surfaced this defect from session history:
a single task file whose frontmatter value contains `: ` (a colon-space, as in the YAML
nested-mapping delimiter) crashes `task_list` for the ENTIRE task store. The YAML parser
throws `Nested mappings are not allowed` on the offending file, and the error propagates
to every tool call that needs the task list — including `task_list`, `task_get`, and the
loop's own board-reading at session start.

Evidence: session `a653b2e9-8c25-4560-8c85-bd3e757e56f3`, 2026-07-21T15:48:10Z (the first
error in the current loop session — the loop couldn't read its own task board on startup).
Root cause: `dirStatus` value `mechanism-landed; ... routines: run (...)` — the substring
`routines: run` parsed as a nested YAML mapping start.

**This is a production-safety defect.** One corrupted task silently blocks the whole board.
There is no existing validation gate to catch it at write time.

## Scope

**In scope:**

1. **Post-write YAML validation** in `packages/quay-native/src/` task write path:
   after writing a task's frontmatter to disk, immediately re-parse it with the same YAML
   parser and return a descriptive error if parsing fails. The file must never be left in
   a corrupted state that breaks `task_list` for all other tasks.

2. **RED→GREEN test** in `packages/quay-native/test/`: a test that writes a task whose
   `dirStatus` (or any frontmatter string field) value contains `: ` (a colon-space),
   confirms the write either produces valid YAML (auto-quoted) OR returns a clear error —
   not a silent corrupt file. The test must exercise the real write path, not a fixture.

3. **Vendor sync** if any modified file has a vendor copy under `plugin/vendor/`.

**Out of scope:**
- Fixing existing corrupted task files in the store (those are already fixed; this prevents future corruption)
- Changing the task schema or field semantics
- Full YAML hardening of arbitrary edge cases — only the `: ` (nested-mapping) crash path

**Behavior-preserving constraints:**
- `tsc --noEmit` exits 0
- Test suite ≤ 11 failures (quay + quay-native)
- `task_list` still works after the fix for all valid task files

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** ~50L product + ~30L test = ~80L. Under 2000L ceiling.

**(b) gate-hash (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time.

**(d) domain-misfit audit-channel:** N/A — deliverable is TS source + test file.

**(e) plan-time line-budget gate:** ~80L estimated. Under 2000L ceiling.

## Class routing

**Development-class** (deliverable = working product fix + test). Direct to implementation.

## Value hypothesis

- **Y:** `task_write` rejects or auto-quotes frontmatter values with `: `; RED→GREEN test pins the fix; `task_list` no longer crashes on the bad-task case
- **Δv̂ = 0** (defect fix / risk-reduction, no VT chart-1 cell)
- **Value type:** risk-reduction / production-safety

## Done-when (binary)

1. Post-write YAML validation added to `quay-native` task write path; the `: ` case is caught at write time. Paste: diff of modified file.
2. RED→GREEN test covering the colon-in-value case; test output showing the failing case now passes. Paste: test output.
3. `task_list` no longer crashes when one task has a frontmatter value with `: `; demonstrates the fix with a before/after example.
4. `tsc --noEmit` exits 0. Paste exit code.
5. Test suite ≤ 11 failures (quay + quay-native). Paste `ℹ tests / ℹ pass / ℹ fail`.
6. Adversarial audit verdict recorded.
7. Vendor sync: `diff packages/quay-native/src/<file> plugin/vendor/quay-native/src/<file>` — empty or annotated.

## Inner termination (§3.2)

1. All 7 Done-when confirmed.
2. ΔV < 0.02 both layers, K=2 consecutive.
3. Ceiling exceeded → `needs-human`.
4. Past budget ~10 iterations.
5. External HALT.

## HARD GATES (by-reference):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly.

## Per-milestone acceptance audit (UNCONDITIONAL)

Specific charge:
1. Verify post-write YAML validation: read the modified write path, confirm a post-write parse call exists and returns error on failure.
2. Verify RED→GREEN test: paste test output showing the colon-in-value case now passes.
3. Confirm `task_list` no longer crashes on a task with `: ` in frontmatter value.
4. Run `tsc --noEmit` — confirm exit 0.
5. Run test suite — confirm ≤11 failures; paste output.
6. Confirm vendor sync.

Output to `milestones/M89/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH experiments/quay-perpetual-stream/charters/M89-yaml-frontmatter-crash.md /tmp/m89-absorb-entry.md`
- `quay gate exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH`
- Worktree: `milestones/M89/worktrees/iteration-0` off master HEAD
- milestone_counter: do NOT increment until all gates clear
- Dashboard row: `m89 · exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M89/`
- No Web UI verification required (no Web UI surface change)
- VT Δ = 0
