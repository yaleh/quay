---
id: gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-budget-truncated
title: "open discovery: supported hypotheses never reach a determinate
  refutation (refuter budget 6 truncates, undetermined cause unrecorded,
  cluster↔call join wrong) — attributable verdicts, measured budgets, one
  counted fresh-context retry; undetermined never confirmed"
status: ready
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
- [x] AC1 (unit, stub launcher):
  - (a) a refuter stream ending `error_max_turns` ⇒ `undetermined_cause:"budget-truncated"` and exactly one retry reservation in the ledger;
  - (b) a refuter that returns no counterexample after reading ⇒ `no-counter-evidence`;
  - (c) a 0-token exit ⇒ `call-failed`;
  - (d) **in every case `confirmed:false` unless the refuter verdict is a determinate "survived"**.
  Negative control: let `undetermined` count as survived ⇒ (d) goes red. Paste both runs. — **EVIDENCE §AC1**
- [x] AC2: the cluster↔call join. A fixture round with two clusters whose refuter calls differ ⇒ each cluster's `refutation_turns` / subtype equal its own call's. Negative control: the old join ⇒ red. Paste. — **EVIDENCE §AC2**
- [x] AC3: the turn budgets are set from a pasted distribution of persisted `num_turns` per step (CLI unit), with the chosen percentile stated. If fewer than 10 samples exist, say so and keep the current budget plus the retry; do not guess a number. — **EVIDENCE §AC3** (answered samples per step are 5 / 6 / 3 / 1 — fewer than 10 for EVERY step ⇒ both step budgets KEPT at 8 and 6, plus the retry; the retry's own budget is the measured p100 = 26 of the pooled answered tool-reading calls, n = 11)
- [x] AC4 (real production round): ≥1 resident or `--force` manual round on the real pin, run after the change, in which ≥1 cluster gets a **determinate** refuter verdict (survived or refuted) with the refuter's own Read/Grep counts > 0 and ≥1 cited file:line. — **EVIDENCE §AC4** (manual `--force` round on develop `8fddb223df38a8ad76eaedfe8ae41ea91bd2abe1`, 2026-10-13T01:10:43Z: cluster 2 **survived** — refuter Read 12 / Grep 22, 8 cited lines, `confirmed:true`; cluster 1 **refuted** — Read 11 / Grep 32, 11 cited lines)
- [x] AC5 (counterexample discipline): from the same or another real round, paste ≥1 hypothesis that the chain REFUTED or left undetermined, with the reason, to show the bar was not lowered. — **EVIDENCE §AC5**

## Definition of Done
- `scripts/test.sh --for-task <this task>` green. — **159 tests / 159 pass / 0 fail, exit 0** (plus `plugin/test/discovery-method-routine.test.mjs`, which the scoped selection does not pick up for this change, run directly: 56/56).
- Report-only, the hard budget (24h cap and USD cap) and the kill switch are unchanged; existing tests green.
  - Unchanged and un-filed: the round is still `report-only` (no task, no Goal); the 24h ceilings are still `max_model_calls_per_24h: 120` / `max_usd_per_24h: 30`; `enabled:false` still returns before any other key is read. The AC4 round spent 14 of 120 reservations (cap 120, used_at_start 59) and $1.243376 (cap $30, used_at_start $18.52).
  - ⚠️ **ONE FOREIGN FILE WAS TOUCHED** (declared in `## Touches`, flagged here because it is not this task's own change): `plugin/test/discovery-method-routine.test.mjs` carried a **date-expiring develop-wide red** — `AC1(d)` read the budget ledger with the WALL clock while dating its round at `ROUND_AT = 2026-10-12T00:00Z`, so the line it had just written fell out of the trailing-24h window at 2026-10-13T00:00Z and the assertion went red with no code change. The fix injects the same clock the file's own convention already injects two tests below (`openModelBudget({ root: ws, cap: 24, now: () => ROUND_AT })`); no assertion was weakened.

## Evidence

### §AC1 — an ATTRIBUTABLE verdict, and a cause for every `undetermined`
`node --experimental-strip-types --test --test-name-pattern="AC1|AC2|AC3" plugin/test/open-semantic-discovery-routine.test.mjs` (20 pass / 0 fail):

```
    NEGATIVE CONTROL AC1(d): mutant reports confirmed=true for a BUDGET-TRUNCATED refutation (claim was «confirmed only for a determinate survived»)
    NEGATIVE CONTROL AC2: old join reports refutation_turns=2/2 for calls of 11 and 19 CLI turns (claim was «each cluster's own call»)
✔ AC1(a) — a refuter stream ending `error_max_turns` ⇒ `budget-truncated`, and EXACTLY ONE retry reservation on the ledger
✔ AC1(b) — a refuter that READ the tree and names no counterexample ⇒ `no-counter-evidence` (and NOT a confirmation)
✔ AC1(c) — a 0-token exit with no result ⇒ `call-failed`, which is NOT the budget's fault
✔ AC1(d) — `confirmed` is TRUE only for a DETERMINATE «survived», never for an undetermined one
✔ AC1(d) NEGATIVE CONTROL — let `undetermined` count as survived ⇒ the (d) claims go RED
✔ AC2 — each cluster's refutation fields come from ITS OWN call, off the CLI's own turn unit
✔ AC2 NEGATIVE CONTROL — restore the OLD join (the engine row's units) ⇒ the AC2 claims go RED
✔ AC3 — the retry budget is a MEASURED default, OPTIONAL, and REQUIRED to be strictly larger than the step's
```

What each asserts, and what the control proves:

* **(a)** a refuter whose stream ends `error_max_turns` — and whose RETRY is truncated too, i.e. the
  production shape — reports `refutation_undetermined_cause:"budget-truncated"`, with
  `refutation_call.calls = [{role:"first", subtype:"error_max_turns", num_turns:7}, {role:"retry", …}]`,
  `retried:true`. The ledger holds **exactly two `refuter` reservations**, of which **exactly one** was
  granted `max_turns = 26` (`DEFAULT_REFUTATION_RETRY_MAX_TURNS`) and one kept the step's 6. The transport
  retry of `reservingStep` does not fire (a turn-cap kill carries a `result` event), so the count is the
  budget retry alone.
* **(b)** a refuter that ANSWERED (`exit 0`, `subtype:"success"`, 5 tool turns) with `verdict:"undetermined"`
  ⇒ `no-counter-evidence`, `refutation_turns:12` (CLI unit), `retried:false` (nothing was truncated, so no
  reservation was spent), with the tool-use counts and the `checked` positions on the record.
  `confirmed:false`.
* **(c)** a 0-token exit that left no result event ⇒ `call-failed`, **one** refuter reservation only, and
  `refutation_call.tool_use: null` — «no turns were captured» is NOT spelled as a zero-count reading
  (硬规则 3b).
* **(d)** the positive arm (determinate `supported` + cited evidence) is the only one with
  `confirmed:true`; all four `undetermined` arms (budget-truncated / no-counter-evidence / call-failed /
  unparseable) report `confirmed:false` and `round.confirmed.count == 0`.
  **Negative control (live, in-scratch copy)**: mutating the `confirmed` line to
  `row.verdict === "supported" && refutationRead.verdict !== "refuted"` («undetermined counts as
  survived») makes the mutant report `confirmed:true` for a budget-truncated refutation while still
  naming the cause ⇒ the (d) claim is FALSIFIED by the mutant, so the assertion has teeth.

### §AC2 — the cluster↔call join
One round, two clusters, two DIFFERENT refuter calls: cluster 1's answers at 11 CLI turns with 4 tool
calls; cluster 2's is truncated at 7 and answered by its retry at 19 with 6 tool calls.

| cluster | `refutation_turns` | `refutation_subtype` | `refutation_call.calls` | `tool_use.by_tool` |
|---|---|---|---|---|
| 1 | 11 | `success` | `[["first",11,"success"]]` | `{Read:2, Grep:2}` |
| 2 | 19 | `success` | `[["first",7,"error_max_turns"],["retry",19,"success"]]` | `{Read:3, Grep:3}` |

Each cluster's fields equal its OWN call's, and the two readings differ (11 ≠ 19) — so the fixture can
tell a join from a constant. Three distinct refuter reservation ids resolve across the two clusters.
**Negative control (live, in-scratch copy)**: restoring the old join
(`entry.refutation_turns = refutation?.turns_used`, `subtype = null`) makes the mutant report
`refutation_turns = 2` for BOTH clusters (the engine row's parser tool-call count, which the stub emits as
a constant) and `refutation_subtype = null` ⇒ both AC2 claims are FALSIFIED by the mutant.

### §AC3 — the budgets, from a pasted distribution
Persisted `num_turns` per step (CLI unit), over every `kind:"scan-round"` line in
`.quay/open-semantic-discovery-findings.jsonl` (12 rounds, read 2026-10-13):

| step | calls | ANSWERED (`not_evaluated:null`) with a measured `num_turns` | values |
|---|---|---|---|
| `investigator` | 12 | 5 | `[16, 20, 23, 23, 26]` |
| `shadow-investigator` | 11 | 6 | `[13, 13, 17, 18, 22, 23]` |
| `verifier` | 18 | 3 | `[14, 14, 17]` |
| `refuter` | 3 | 1 | `[9]` |
| `verifier-report` | 10 | 10 | `[1 ×10]` |
| `refuter-report` | 1 | 1 | `[1]` |
| `investigator-report` | 1 | 1 | `[1]` |
| `value-assessment` | 1 | 0 | `[]` |
| `value-assessment-report` | 1 | 1 | `[1]` |
| `novelty-check` | 1 | 1 | `[5]` |

**Fewer than 10 answered samples exist for EVERY step** (5 / 6 / 3 / 1), so AC3's own escape clause
applies: **the current budgets are KEPT** — `verifier_max_turns: 8`, `refutation_max_turns: 6` — and the
retry is added. Setting either step's budget from a 1–5 sample distribution would be exactly the guess AC3
forbids. The unit mismatch the Proposal flagged is CONFIRMED here: an answered `verifier` call reports
`num_turns` 17 under `--max-turns 8`, so `num_turns` is not the cap's unit — a second reason not to
re-derive a cap from it.

The **retry** budget is a separate quantity and IS measured: the pooled ANSWERED tool-reading calls
(`investigator` + `shadow-investigator` — the only population the carrier holds whose cap demonstrably did
NOT fire) are n = 11, `[13,13,16,17,18,20,22,23,23,23,26]`, whose **p100 = 26** is
`DEFAULT_REFUTATION_RETRY_MAX_TURNS`. Stated basis: those calls read the same pin with the same read-only
tool envelope and finished; the retry's job is to be LARGER than the truncated attempt, not to tune the
step. The parse refuses a DECLARED retry budget that is not strictly larger than `refutation_max_turns`,
and when the key is absent the default is `max(26, refutation_max_turns + 1)`, so raising the step budget
cannot silently turn the retry into a no-op.

### §AC4 — a real production round, with a DETERMINATE refutation
`node --experimental-strip-types plugin/scripts/open-semantic-discovery-routine.ts --once --root /data/home/yale/work/quay --force --json`
— `invoked_by: manual`, pin = the real develop rev `8fddb223df38a8ad76eaedfe8ae41ea91bd2abe1`, round
`2026-10-13T01:10:43.215Z`, state `verified`, 12 clusters / 3 verified, **`confirmed.count: 1`** (the first
production round ever to confirm anything), 14 model calls, $1.243376, wall 622187 ms.

**Cluster 2 — SURVIVED (determinate).**
Claim: *"A task's own status is judged with an out-of-vocabulary word: `over90-task-gate.taskStatusAllowsOver90m` returns true only when the frontmatter `status === 'in-progress'`, but the single-source `task-status.ts  TASK_STATUSES = ['todo','ready','done','needs-human','superseded']` contains no `in-progress`. `supervisor-preempt-candidates.ts` consumes that gate as its 'no-real-progress' criterion, so the over-90m preemption path can be permanently gated off for every task carrying a valid lifecycle word."*
Components: `task-status.ts`, `over90-task-gate.ts`, `supervisor-preempt-candidates.ts`.

| call | reservation | `--max-turns` | `num_turns` | subtype | exit | cost |
|---|---|---|---|---|---|---|
| first | `dmr-590202-7-09yg9vz2` | 6 | 7 | `error_max_turns` | 1 | $0.051567 |
| **retry** | `dmr-590202-8-jf8l232i` | **26** | 35 | `success` | 0 | $0.277074 |
| value-assessment | `dmr-590202-9-m7c9o34f` | 6 | 7 | `error_max_turns` | 1 | $0.047005 |

* refuter verdict `supported` (survived), `refutation_undetermined_cause: null`, `confirmed: true`;
* **the refuter's OWN reading**: `tool_use { total: 34, by_tool: { Read: 12, Grep: 22 } }`, 8 cited
  evidence lines;
* the positions it checked (excerpt): `plugin/scripts/over90-task-gate.ts:76,90-113 — full helper; no
  other status literal`; `plugin/scripts/task-status.ts:9-28 — full file; vocabulary + isTaskStatus, no
  in-progress`; `packages/quay/src/abi.ts:30-42 — TASK_STATUSES/TASK_STATUS constants, no in-progress`;
* it reached the Portfolio as a novel finding (`finding_id open-semantic-discovery@2026-10-13T01:10:43.215Z#2`).

**Cluster 1 — REFUTED (determinate).** Claim: the worker `final_state` vocabulary is declared three times
with different membership (`worker-driver.FINAL_STATES` 7 values; `rework-predictors` accounting for 5, so
`timed-out` / `spawn-failed` / `not-dispatched` would be `unrecognized`).
Components: `worker-driver.ts`, `rework-predictors.ts`, `task-granularity-advice.ts`.

| call | reservation | `--max-turns` | `num_turns` | subtype | exit | cost |
|---|---|---|---|---|---|---|
| first | `dmr-590202-5-w8xbnqlp` | 6 | 7 | `error_max_turns` | 1 | $0.044878 |
| **retry** | `dmr-590202-6-246tui8z` | **26** | 44 | `success` | 0 | $0.207763 |

* refuter verdict `refuted`, `refutation_undetermined_cause: null`, `confirmed: false`;
* **the refuter's OWN reading**: `tool_use { total: 43, by_tool: { Read: 11, Grep: 32 } }`, 11 cited
  evidence lines.

**What this round settles.** Both refuters were truncated at their cap (7 `num_turns` under
`--max-turns 6`) and both FINISHED on the retry at the measured budget — so `budget-truncated` is now a
state the chain can LEAVE, and `confirmed`/`refuted` are states it can REACH. The round also shows the
cause-value vocabulary doing its job: `verifier-report`, `value-assessment-report` and
`novelty-check-report` each answered exactly 1 turn and the whole round finished in 14 reservations.

### §AC5 — the bar was not lowered
From the SAME real round (§AC4), the hypothesis the chain **REFUTED**, with the refuter's own reason:

* **cluster 1** — verifier `supported`, refuter **`refuted`**, `confirmed: false`, ingested as
  `not-confirmed` (`portfolio.skipped: "verdict:refuted-is-never-a-Portfolio-supported-row"`).
  The refutation's reason, verbatim: *"For the claim to hold, timed-out / spawn-failed / not-dispatched
  would have to actually occur as final_state in the live quay carrier (non-dead) so that real records get
  misclassified 'unrecognized'; they do not (0/3109). A test asserting
  union(SUCCESS_STATES, LEGACY_SUCCESS_ALIASES, NON_LANDED_STATES) == FINAL_STATES would also refute the
  'undetected divergence' framing, but no such test exists."* — a counterexample requirement the claim
  does not meet, established by READING the carrier (Grep 32 / Read 11).

And the hypothesis the chain left **undetermined** (it never reached a refuter, because the verifier did
not support it):

* **cluster 3** — verifier `undetermined` ⇒ `refutation_verdict: "not-run"`, `confirmed: false`, ingested
  as `not-confirmed` (`portfolio.skipped: "verdict:undetermined-is-never-a-Portfolio-supported-row"`).
  Claim: `.quay/full-suite-state.json` is written by multiple independent code paths with different
  shapes (`full-suite-runner.writeState` ×2, `runner-state-write.writeState/writeStateGuarded`,
  `mirror-full-suite-state.writeMirrorState`, `red-window-triage`'s own local writer).

Three clusters were verified and exactly **one** was confirmed — the refuter did real work on the other.

## Touches
- tasks/gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-budget-truncated.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs
- plugin/test/discovery-method-routine.test.mjs
- .quay/config.yml

> ⚠️ **Two files outside this task's own change are declared above on purpose.**
> `plugin/test/arch-hypothesis-generation.test.mjs` carries the two unit tests for the ONE new engine
> reader (`toolUseSummary`) and for the conditional `checked` key — an export this task adds must be
> tested where it lives. `plugin/test/discovery-method-routine.test.mjs` is the **foreign date-expiring
> develop-wide red** described in the DoD: it is not this task's change, it was fixed here because a
> deterministic foreign red blocks every worker's landing and the fix is one argument, and the assertion
> it repairs was left exactly as strict as it was.
> `.quay/config.yml` is listed but **unchanged**: it is gitignored (`.gitignore:533`), so a value written
> there cannot land, and the worktree copy is refreshed from the shared checkout on every scoped-gate run.
> The retry budget therefore reaches production as the module's stated default (26) — the same number the
> measurement gives — and is overridable by declaring `refutation_retry_max_turns` (strictly greater than
> `refutation_max_turns`).
