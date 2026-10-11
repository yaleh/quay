---
id: gap-hypgen-verifier-budget-exhaustion-is-unobservable-and-unscoped
title: "arch-hypothesis-generation verifier: turn-budget exhaustion is
  unobservable (no per-turn record), searches are unscoped, and there is no
  mechanical evidence pack or budget-aware ordering"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication
---
## Proposal
Measured from the acceptance verify file `/data/home/yale/work/quay-scratch/hg-accept-run/verify.json` (pin `e3163e519`, 8 turns, 300 s):
- **Budget exhaustion is common.** 7 of 15 clusters were `undetermined` because they reached the 8-turn limit; each output was exactly 28 bytes, `Error: Reached max turns (8)`. In round 1 it was 5 of 15.
- **Exhausted runs were faster, not slower.** They took 16-37 s, while decided runs took 20-70 s. Component counts were similar (mostly 5). So the turns went on many cheap tool calls, not on slow ones.
- **A real defect was among the exhausted clusters.** c13 claimed the routine quota window/K is declared both in config and in the gate. At the pin, `routine_quota.window_ms` really was parsed but inert; this was later fixed by the done task `gap-routine-quota-window-ms-parsed-but-inert`. The budget limit therefore hid a true positive, and it serves as an independent regression case.
- **The cause cannot be observed.** Verifier runs use `--no-session-persistence` and record only the final stdout. The only surviving traces are 4 tool-result overflow files under `~/.claude/projects/-data-home-yale-work-quay-scratch-hg-pin/`, each 24-40 KB.
  - Their content shows repo-wide searches that hit `.quay/goal-031-evidence/arch-layer-review-output.json` and `scripts/test.sh` comments, although the verifier prompt limits it to `plugin/scripts/` and `packages/`.
  - The stripped pin tree still contained tracked `.quay/` evidence files.
- This is a HYPOTHESIS, not yet a conclusion: unscoped searches produce oversized results that consume turns.

## Plan
1. **Instrumentation.** Capture each verifier call's per-turn tool calls (tool name, arguments, result byte size), for example by running with stream-json output. Store them next to the result. A call that ends with no record is reported as `not-evaluated:uninstrumented`.
2. **Scope enforcement.** The verify step refuses if `--pin-dir` contains `.quay/`, `tasks/`, `goals/`, `docs/`, `orchestration/`, `archive/`, `milestones/` or `measurements/`. This complements the strippedness check owned by the dependency task; do not duplicate it.
3. **Mechanical evidence pack**, an opt-in verifier strategy. Before the model call, deterministically assemble for each named component:
   - the definition line of each symbol cited in the claim;
   - the import lines among the named components;
   - bounded grep hits, at most N lines.

   Pass these in the prompt, through a NEW verifier prompt file. The frozen verifier prompt (`dba2e671…`) stays the default and unchanged.
4. **Budget-aware ordering**, opt-in. Run first the clusters whose evidence pack already decides them mechanically. Give each remaining cluster a fixed turn budget. Record the turns used.
5. **No hard-coding of any regression case.** Neither c13 nor any other label is named in code or prompts.

## Acceptance Criteria
- [ ] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0, with new cases:
  - (a) A pin dir containing `.quay/` is refused.
  - (b) A stubbed verifier that exhausts its turns leaves a per-turn record, and the cluster is `undetermined` with cause `turn-budget`.
  - (c) The evidence pack for a fixture names the definition lines and the import lines, and respects the line cap.
  - (d) The default verifier prompt file is byte-identical: its sha256 equals the frozen value.
- [ ] One instrumented diagnostic run on the real acceptance cluster c13 (from `/data/home/yale/work/quay-scratch/hg-accept-run/`), using a properly stripped pin at `e3163e519`, the default verifier, and 8 turns. Paste:
  - the per-turn tool-call list (tool, argument head, result bytes);
  - the final verdict.

  This AC only records what happened. It does not need a particular verdict.
- [ ] The same c13 run with the evidence-pack strategy. Paste the turns used and the verdict. Do not tune the strategy to make c13 pass. If it still exhausts the budget, record that as the result.
- [ ] Mutation control: remove `.quay/` from the refusal list and show case (a) goes red. Paste the output, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-hypgen-verifier-budget-exhaustion-is-unobservable-and-unscoped` green.
- Frozen prompt files are unchanged.

## Touches
- tasks/gap-hypgen-verifier-budget-exhaustion-is-unobservable-and-unscoped.md
- docs/analysis/arch-hypothesis-generation.mjs
- docs/analysis/arch-hypothesis-generation-prompts/verifier-evidence-pack.txt (new)
- plugin/test/arch-hypothesis-generation.test.mjs
