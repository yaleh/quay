---
id: gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-budget-truncated
title: "open discovery: supported hypotheses never reach a determinate
  refutation (refuter budget 6 truncates, undetermined cause unrecorded,
  cluster↔call join wrong) — attributable verdicts, measured budgets, one
  counted fresh-context retry; undetermined never confirmed"
status: todo
labels:
  - gap
  - defect
  - open-discovery
  - discovery-method
parent: null
children: []
extra: {}
depends_on:
  - gap-open-discovery-model-calls-exit-without-result-are-unattributed-zero-token
---
## Proposal
**Production reading (`.quay/open-semantic-discovery-findings.jsonl`, resident rounds 2026-10-12T20:40:00Z and 21:47:31Z): the investigator now produces hypotheses, but no hypothesis has ever reached a determinate independent refutation.**

| round | clusters | verified | verifier verdicts | refuter | confirmed |
|---|---|---|---|---|---|
| 20:40 | 12 (9 beyond cap) | 3 | #1 undetermined (cause `exit-1`, a 0-token call), #2 undetermined (`unparseable`), #3 **supported** (4 evidence lines) | #3: refuter `error_max_turns` 7/6 ⇒ 1-turn `refuter-report` ⇒ **undetermined** | 0 |
| 21:47 | 9 (6 beyond cap) | 3 | #1 undetermined (`unparseable`), #2 undetermined (1 evidence line), #3 **supported** (10 evidence lines) | #3: refuter exit 1, 0 tokens, `uninstrumented-exit-1` ⇒ **undetermined** | 0 |

Verifier calls: 3 of 6 hit `error_max_turns` (budget 8). The refuter budget is 6, the smallest in the chain, although refuting needs at least as much reading as verifying. So "undetermined" currently mixes three things the record cannot tell apart:
- (i) budget truncation;
- (ii) a real absence of counter-evidence;
- (iii) a broken call.

The verdict is therefore uninformative. It must stay NOT confirmed, but it also teaches nothing.

Record-join defects found while reading:
- cluster 20:40#3 records `refutation_turns: 0` while its refuter call ran 7 turns;
- cluster 21:47#3 records `refutation_turns: 9` while its refuter call was a 0-token exit 1;
- several calls report `subtype: success` with `turns` above `max_turns` (investigator 26/12, verifier 17/8), so the routine's "turns" is not the CLI's max-turns unit.

Independent manual check, coordinator, 2026-10-12: one shadow-arm hypothesis about status sync was verified by hand (code + executed function) and fixed. The hypotheses are worth verifying; the automated chain is what fails.

Governing rule (unchanged): **undetermined is never confirmed**, the refuter keeps a fresh context and a different prompt from the verifier, and the bar for confirmation does not drop.

## Plan
1. **Make each verdict attributable.** Per verifier and refuter call, persist:
   - subtype, realized turns in the CLI's own unit (`num_turns`);
   - tool-use counts by tool (from the parsed stream turns, which the parser already extracts: Read/Grep counts and the first N `args_head` paths);
   - evidence lines cited;
   - an explicit `undetermined_cause ∈ {budget-truncated, no-counter-evidence, call-failed, unparseable}`.
   Fix the cluster↔call join so a cluster's refutation fields come from ITS refuter call.
2. **Budget from measurement, not guess.** From the persisted turn distributions, set the verifier and refuter `max_turns` so that a stated percentile of past successful calls fits. Paste the distribution. A truncated refuter (`budget-truncated`) gets ONE fresh-context retry with a larger budget, reserved through the same hard 24h ledger (counted, capped).
3. **Context aid, not a verdict shortcut.** Hand the refuter the verifier's cited evidence lines as STARTING POINTS to attack, with an explicit instruction that agreeing without its own reading is not a refutation outcome. It must name a counterexample or state the positions it checked.
4. **No change** to what counts as confirmed, to report-only, or to the kill switch.

## Acceptance Criteria
- [ ] AC1 (unit, stub launcher):
  - (a) a refuter stream ending `error_max_turns` ⇒ `undetermined_cause:"budget-truncated"` and exactly one retry reservation in the ledger;
  - (b) a refuter that returns no counterexample after reading ⇒ `no-counter-evidence`;
  - (c) a 0-token exit ⇒ `call-failed`;
  - (d) **in every case `confirmed:false` unless the refuter verdict is a determinate "survived"**.
  Negative control: let `undetermined` count as survived ⇒ (d) goes red. Paste both runs.
- [ ] AC2: the cluster↔call join. A fixture round with two clusters whose refuter calls differ ⇒ each cluster's `refutation_turns` / subtype equal its own call's. Negative control: the old join ⇒ red. Paste.
- [ ] AC3: the turn budgets are set from a pasted distribution of persisted `num_turns` per step (CLI unit), with the chosen percentile stated. If fewer than 10 samples exist, say so and keep the current budget plus the retry; do not guess a number.
- [ ] AC4 (real production round): ≥1 resident or `--force` manual round on the real pin, run after the change, in which ≥1 cluster gets a **determinate** refuter verdict (survived or refuted) with the refuter's own Read/Grep counts > 0 and ≥1 cited file:line. Paste:
  - the claim, the verifier evidence and the refuter outcome (the counterexample if refuted, the checked positions if survived);
  - the per-call turns, tool counts and cost;
  - the ledger reservation ids.
  If the round yields only undetermined, paste it with its `undetermined_cause` per cluster and leave this box unticked.
- [ ] AC5 (counterexample discipline): from the same or another real round, paste ≥1 hypothesis that the chain REFUTED or left undetermined, with the reason, to show the bar was not lowered.

## Definition of Done
- `scripts/test.sh --for-task <this task>` green.
- Report-only, the hard budget (24h cap and USD cap) and the kill switch are unchanged; existing tests green.

## Touches
- tasks/gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-budget-truncated.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- docs/analysis/arch-hypothesis-generation.mjs
- .quay/config.yml
