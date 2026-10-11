# Bounded proposal-repair — replay report

Task: `gap-ownership-active-proposal-repair-loop`. Module: `docs/analysis/ownership-active-proposal-repair.mjs`.
Test: `plugin/test/ownership-active-proposal-repair.test.mjs` (23 tests).

This report is the DoD artefact. Every number below is a reading taken from a carrier file or from a
test run; where a reading did not exist it says so instead of being filled in.

---

## 1. The four rejection classes and the REAL production sample distribution

`classifyRejection(sliceDelta)` is a pure function that maps one `slice_delta` reading onto ONE of four
enumerated classes (硬规则 3 — enumerate, never boolean). `class === null` is a DISTINCT value meaning
"this is not a rejection at all" (`evaluated` / `guard-violated`), so "no refusal" can never be shaped
like "a refusal we decided not to repair".

| class | meaning | triggers (declared as data) | repairable? |
|---|---|---|---|
| `invalid_move` | the CUT is wrong/incomplete, and the refusal text carries enough structure to fix it | `NO_EDGE_EXPLAINED_BY_MOVES`, `MOVE_TO_NOT_AN_INTERNAL_DIR`, `MOVE_FROM_NOT_AN_INTERNAL_DIR`, `SUBJECT_NOT_AN_INTERNAL_DIR`, and ArchGuard's own `切法覆盖不足` (which names the uncovered symbols) | yes |
| `evidence_gap` | the judge lacked a fact that could have been looked up | `EVIDENCE_GAP` / `INSUFFICIENT_EVIDENCE` / `NEEDS_EVIDENCE` | yes (declared; **production UNSEEN**) |
| `tool_limitation` | the refusal is the primitive's own capability boundary | status `unavailable`, or a non-null `gap`, or `ARCHGUARD_*` / `SLICE_DELTA_*` / `SCOPE_ROOT_*` / `PACKAGE_GRAPH_BUILD_FAILED` / `NO_MODULE_GRAPH_IN_ARCHJSON` / `NO_REPORT`, or a `capability_gap` marker | **no — zero retries** |
| `honest_abstain` | cannot be parsed, or is none of the above | the **fail-closed default** (硬规则 3b), and the terminal state after budget exhaustion | no |

**Real distribution (read from `.quay/ownership-shadow-proposals.jsonl`, 2026-10-11).** Of 90 carrier
records, **11** carry a `slice_delta`; **all 11 are refusals**:

| reason (verbatim prefix) | count |
|---|---|
| `NO_EDGE_EXPLAINED_BY_MOVES` | 5 |
| `MOVE_TO_NOT_AN_INTERNAL_DIR:"model"` / `:"gate/runtime"` / `:"gate/core"` / `:"gate/contract"` | 4 |
| `切法覆盖不足…` (ArchGuard names the uncovered symbols) | 2 |

All 11 classify as `invalid_move` (the test asserts exactly this, over the 11 verbatim strings).

> Note on the task body's own summary: it predicted "NO_EDGE ×4, MOVE_TO ×4, 切法覆盖不足 ×2, 其余 1".
> The carrier today reads NO_EDGE **×5** and no "其他" sample at all. The task body's remembered
> breakdown was off by one on the first bucket; the reading above is the one this report stands on.

`evidence_gap` has **no production sample** — the module declares the enum value, provides a synthetic
trigger, and `PRODUCTION_OBSERVED_CLASSES` records the honest fact that it has never been seen. This is
deliberate: fabricating a plausible-looking sample to "complete the table" would be exactly the
hard-rule-3b failure (shaping "I did not observe this" like "I observed this").

---

## 2. What the two ArchGuard conversations established (quoted from the task body)

The task body records two real interactions; both were folded into the design **before** implementation,
not reconstructed afterwards:

> - 与「archguard 架构语义映射」会话核实：liaison **纠正了原设计的一个真实风险**——用独立
>   `grep`/`find` 算"scope 内真实存在的目录",可能与 ArchGuard 自己判定的"scope 内部节点"不一致
>   (两个实测过的不一致来源：① ArchGuard 的目录节点来自分析快照,未被分析到的文件所在目录不一定是
>   节点；② 扁平目录如 `plugin/scripts` 被当成单一节点)。**采纳：合法目录清单改为直接复用同一次投研
>   轮次已经取得的 ArchGuard 图数据,不独立 find/grep 算一份。** 同时采纳"被拒绝 vs 没能评估"的失败
>   契约区分：ArchGuard 返回 `not-evaluated`/`capability_gap` 归入 `tool_limitation`,不折进 `invalid_move`。
> - 已联系「Quay refactor architecture liaison」会话…求证 `slice-delta`/`simulate_refactor_slice`
>   原语本身对"遗漏消费者"/"未知符号"是否已有独立拒绝码、以及是否存在 dry-validate 细粒度接口——
>   **回复待补;本任务不预先假设任何未确认的新接口已合并,按现有接口的具体反馈字段自洽设计**
>   (硬规则 12:没有发生率/确认数据不设新前置)。

**Implementation of the first finding.** `recordedLegalDirs(candidateRecord)` returns the
`detail.valid_dirs` list that the ORIGINAL investigation round's `buildSliceInput` already computed
from the ArchGuard module graph — verbatim. The module never runs `find`/`grep` and never re-derives a
directory list (the AC8 source scan asserts the module contains neither `child_process` nor `fs`). If
the record carries no such list, `attemptRepair` **abstains** rather than going to look one up.

**Status of the second interaction.** No reply arrived during this task's implementation window. No new
`slice-delta` interface is assumed: the module classifies only on fields the shipped surface already
returns (`status` / `reason` / `gap`), and it implements the "missing consumer" and "unknown symbol"
checks ITSELF, over the same graph data, precisely because it cannot assume the primitive reports them
separately.

---

## 3. The four negative controls (readings)

All four are asserted by tests in `plugin/test/ownership-active-proposal-repair.test.mjs`; the numbers
below are from a local run of that file (23/23 pass).

### ① `tool_limitation` → ZERO retries, from BOTH sources
- `{status:"unavailable", gap:{capability:"archguard.slice_delta"}}` ⇒ `outcome=abstained`,
  `class=tool_limitation`, **judge calls = 0**.
- The fixture's simulated ArchGuard `capability_gap` refusal ⇒ same verdict, **judge calls = 0**.
- A capability boundary cannot be fixed by revising the cut, so the session must not spend a single
  judge call pretending otherwise.

### ② Budget exhaustion ⇒ honest abstain
Four independent bounds, all hardcoded in `REPAIR_LIMITS` and only LOWERABLE by a caller:

| bound | value | test reading |
|---|---|---|
| `maxRounds` | 3 | a judge repeating one bad move ⇒ 3 rounds, 3 judge calls, `outcome=abstained`, `repaired_delta=null` |
| `maxJudgeCalls` | 3 | `maxJudgeCalls:2` ⇒ the judge is invoked **exactly twice**, then abstain |
| `maxWallClockMs` | 1 800 000 (3 × the primitive's 600 000 ms ceiling) | an injected slow clock ⇒ abstain mid-loop with `WALL_CLOCK_EXHAUSTED` |
| `maxEvidenceBytesPerRound` | 90 000 (reuses `DEFAULT_BUDGET.max_total_evidence_bytes`, never widened) | a 200 KB feedback block renders to **≤ 90 000 bytes** with `truncated:true` |

Raising any of the three numeric bounds throws `REPAIR_BUDGET_OVER_LIMIT`.

### ③ Missing consumer is NOT success
Fixture `repair-missing-consumer-fixture.arch.json`: the revision fully covers the `b -> a` edge (so the
primitive's own rule is satisfied and the delta **does compute**) while the `c -> a` edge keeps one
name (`other`) dangling. Reading: `outcome=abstained`, `repaired_delta=null`, the round is recorded with
`matched=MISSING_CONSUMER`. **The primitive was reached** (`computeSliceDelta` was called — the trap is
"formally computes"), and the module still refused to read it as a repair. This is the check the
liaison's open question is about; until the primitive is confirmed to report it separately, the module
computes it itself from the same graph.

### ④ A fabricated symbol never yields a computed delta
Fixture `repair-unknown-symbol-fixture.arch.json`. A revision naming `ghostSymbol` (present in **no**
edge of the graph) ⇒ `computeSliceDelta` is **never called** (call count 0), no delta is produced, the
round is recorded `bucket=unknown_symbol, computed=false`. "Not in the graph" is treated as an invalid
revision, never as "in the graph but uncovered" — the distinction the task calls out explicitly.

---

## 4. Live blind replays (pre-merge and post-merge)

### 4a. pre-merge (this task's worktree)

Command (run inside `/data/home/yale/work/quay-worktrees/gap-ownership-active-proposal-repair-loop`):

```
node --experimental-strip-types docs/analysis/ownership-active-loop.mjs --live --repair --rounds 1
```

Evidence location: the run stdout/stderr were written under the worktree's `.quay/` and mirror-copied
to `/tmp/repair-live-evidence/` — a worktree's `.quay/` is **not durable** (the driver's periodic
`refresh-worktree-quay` restores the main checkout's copy over it, which is how an earlier 93-line run
carrier reverted to main's 90 without an error). The table above and the numbers in it are the durable
copy.

The real judge is a tool-less `claude -p` completion (`role meta-driver`, model `v4.1flash-anthropic`);
the primitive is the installed ArchGuard CLI. Every investigation below is an independent blind draw —
nothing is steered, and the dedup set (`existingConcernKeys`) only excludes what an earlier draw
already proposed.

| # | command | draw | terminal | cost (rounds / requests / evidence bytes / wall ms) | slice_delta | repair attempted |
|---|---|---|---|---|---|---|
| 1 | `--live --repair --rounds 1` | r1 | `propose_slice` (canonicalization: `plugin/scripts/goal-driver.ts` status literals), `action=propose-goal`, `gate_ok=true` | 7 / 6 / 25 184 / 123 695 | **null** — not a package-cycle, so the primitive was never called | **no** |
| 2 | `--live --repair --rounds 2` | r1 | `abstain` — the hypothesis WAS the real cycle ("the only package cycle, size 4: `quay/src`, `quay/src/gate`, …") but the judge judged its evidence insufficient | 7 / 6 / 33 602 / 236 478 | null | no |
| 2 | (same invocation) | r2 | `not-evaluated` (`forced:judge-unavailable`) | 3 / 1 / 9 014 / 18 798 | null | no |
| 3 | `--live --repair --rounds 3` | r1 | `propose_slice` (package-cycle, subject `gate/factories`, 3 moves) → `action=investigate` | 7 / 6 / 26 524 / 369 413 | **`evaluated`** — SCC 4 → 3, `gate/config` left the cycle, negative control **falsified**, guards clean | **no** (an `evaluated` reading is not a rejection) |
| 3 | (same invocation) | r2 | `propose_slice` (non-cycle) → `action=propose-goal`, `gate_ok=true` | 8 / 6 / 30 347 / 137 444 | null | no |
| 3 | (same invocation) | r3 | `not-evaluated` (`forced:judge-unavailable`) | 1 / 0 / 0 / 4 | null | no |
| 4 | `--live --repair --rounds 2` | r1 | `propose_slice` (package-cycle, subject `gate/config`, 1 move / 11 symbols) → `action=investigate` | 8 / 5 / 31 044 / 244 778 | **`not-evaluated`** — `切法覆盖不足：… 中 [GatesConfig] 未被任何 move 的 symbols 覆盖` | **YES — the live repair fired** |
| 4 | (same invocation) | r2 | `propose_slice` (non-cycle) → `action=propose-goal`, `gate_ok=true` | 8 / 5 / 27 474 / 128 110 | null | no |

**Draw 4 r1 — the one live repair reading (the module's whole point).** The primitive refused a
package-cycle cut of exactly the historically dominant kind (`切法覆盖不足`, naming the one uncovered
symbol `GatesConfig`). The bounded repair was invoked and returned:

```
outcome      = abstained          judge_calls = 0
class        = invalid_move       rounds      = 0
matched      = INVALID_MOVE:COVERAGE_INSUFFICIENT
locked       = { commit: f3a13c48346a4273a72bcdea91893f23575af6d0, scope_root: packages/quay/src }
reason       = no recorded legal-dir list in the original evidence; refusing to recompute one independently
attempt[0]   = { bucket: honest_abstain, matched: NO_RECORDED_LEGAL_DIRS, judge_called: false }
```

So the live path **is reachable**, classifies correctly (the refusal text names the uncovered
symbol), locks to the right commit+scope, and **abstains with zero judge calls** — because
`slice_delta.detail` is `null` on this path. That is the contract the task prescribes ("若原投研证据里
没有携带可用的目录节点清单 … 直接按'证据不足以支持结构化反馈'归入 `honest_abstain`"), and it is what the
module does. **It is also the concrete next increment**, recorded here rather than smoothed over: the
adapter records `detail.valid_dirs` only on the cut-builder refusal path
(`NO_EDGE_EXPLAINED_BY_MOVES` / `MOVE_TO_NOT_AN_INTERNAL_DIR` / …); a refusal reported by **ArchGuard
itself** carries no `detail`, so this — the dominant real refusal — can never reach the judge. Fixing
that means recording the ORIGINAL round's graph-derived node list on the carrier (the same ArchGuard
graph data, taken at investigation time — not a repair-time `find`/`grep`), which is outside this
task's declared Touches (it needs the slice adapter, which the task explicitly excludes).

**Reading the rest honestly.**

1. Across four independent invocations (8 investigations) **one** `package-cycle` cut was refused —
   draw 4 r1. The repair's behaviour on a live refusal is therefore evidenced by exactly one draw;
   its success path is evidenced by the fixture corpus (§3, AC9).

2. **The task's premise did not reproduce at its stated rate.** The task body says "11/11
   package-cycle candidates are refused". In these 8 live draws the primitive was reached three times:
   one computed a valid delta (SCC 4 → 3, control falsified), one was refused for coverage (draw 4 r1),
   one abstained before reaching the primitive. Draw 2 r1 additionally shows the judge *finding* the
   real cycle and then abstaining on evidence. ⛔ None of this is attributable to this task's module —
   the repair layer does not change the FIRST-attempt cut or the candidate generation at all
   (硬规则 4 推论四: a story that explains the observation is not a tested conclusion). The comparison
   in §5 is stated with that limit.

3. **Draw 3 r1 carries a self-inflicted environment artefact, recorded rather than hidden.** It was
   downgraded `PROVENANCE_MISMATCH` — `工作区 HEAD=f3a13c48… 与 slice.provenance.commit=ffcd440f… 不一致`.
   Cause: the loop pins `commit` at run start, the primitive re-reads `HEAD` at call time, and **a
   commit was made in the worktree while the run was in flight** (this task's own import-cleanup
   commit, 13:36:51, inside a run started 13:34:01). The delta itself is genuine (4 → 3, control
   falsified); only the commit-consistency guard tripped. **Lesson for any future live replay: do not
   commit in the worktree while a live run is in flight** — the downgrade is not a defect of the run's
   subject.


### 4b. post-merge (develop's new tip) — NOT RUN HERE

This half is **structurally post-landing**: it can only run against a develop tip that contains this
task's code, which does not exist until fan-in's ff-merge creates it — after this worker exits. Running
it now, from this worktree, would produce a record whose tree does not contain the fix, i.e. exactly the
false-attribution reading 硬规则 4 推论三 exists to exclude. The task body names it as the second,
independent invocation; it is therefore carried as an external item (see the task's AC10) with the
replay command above as the registered 承接 path. **This report deliberately contains no fabricated
post-merge reading.**

---

## 5. Candidate-quality comparison before/after

**Before** (production carrier, 2026-10-11): of the 11 package-cycle cuts that reached `slice-delta`,
**11/11 (100%)** were refused, and the refusal was the END of the line — nothing downstream attempted a
repair, so the limited-proposal entry bar could never be satisfied.

**After** (this task): a refused cut now has a bounded second chance. The reading that matters is
whether any refusal becomes a computed, negative-control-falsified delta. Two effects are visible from
the test corpus regardless of the live outcome:

1. The refusal is now **classified**, so `tool_limitation` (unrepairable) is separated from
   `invalid_move` (repairable) instead of both being one dead end. The 11 real refusals are all
   `invalid_move` — i.e. all 11 are, on their face, the repairable kind.
2. The module refuses to *appear* to fix things: a missing consumer and a fabricated symbol both keep
   the session at `honest_abstain` even when the primitive would have computed a delta.

3. The **refusal reason distribution did not change** — it was never the module's to change. The
   module consumes a refusal; it does not produce the cut. Across the 8 live draws in §4a the
   distribution is simply *different input*: 3 draws reached the primitive (1 computed, 1 refused for
   coverage, 1 abstained upstream), i.e. the historical `NO_EDGE ×5 / MOVE_TO ×4 / 覆盖不足 ×2` set was
   **not reproduced**. Any claim that "the repair improved candidate quality" would be a story
   (硬规则 4 推论四). What CAN be said is narrow and measured: the one live refusal (draw 4 r1) was
   classified `invalid_move / INVALID_MOVE:COVERAGE_INSUFFICIENT` — i.e. **on its face repairable** —
   and the session still **abstained with ZERO judge calls**, because the ArchGuard-origin refusal
   records no `detail.valid_dirs` (§4a). Candidate quality is therefore **unchanged by this task**: a
   refusal now ends in a classified, bounded abstain instead of an unclassified dead end, and nothing
   more.

**Honest limit.** Classifying a refusal as repairable is not the same as repairing it, and in the one
live refusal the module did not get to try. The after-reading establishes exactly this much: a refused
cut now has a bounded, structurally-informed second chance whose failure modes (no recorded graph
data, missing consumer, fabricated symbol, capability boundary, budget exhaustion) all terminate at
`honest_abstain` rather than at an unearned success (§3) — and the single live data point confirms the
abstain branch fires correctly, with `judge_calls = 0`, on a real refusal. The success branch is
established by the fixture corpus only.

---

## 6. What was NOT touched (red lines, each checkable)

- `evaluateEntryBar` four conditions, `deterministicGate`, `quotaGate`, the run-streak count, the
  3-consecutive-round admission and the human-approval mechanism: **unchanged**. The repair module does
  not import any of them (AC8 source scan).
- No source file written, no directory created, no holdout (A/B) result read or used as feedback.
- No four-cycle answer hardcoded: the module source contains none of `gate/config`, `gate/runtime`,
  `gate/contract`, `ff-merge`, `probeInstruments`, `shQuote`, `DEFAULT_ACCEPTANCE_TIMEOUT_MS`.
- The only new persistence is the append-only `repair_attempt` record type in
  `docs/analysis/architecture-evidence-store.mjs` (`.quay/architecture-evidence-store.jsonl`, gitignored).
- The loop's `--repair` flag is **opt-in and default OFF**; without it the loop's behaviour is byte-identical
  to before (the two additive record fields `proposed_slice` / `slice_delta.detail` are the only change to
  the default path).

---

## 7. post-merge independent blind test + the legal-dirs fix（post-merge 独立盲测 + legal-dirs 修复）

Task: `gap-ownership-active-repair-legal-dirs-lost-on-archguard-refusal`. §4a closed with a recorded next
increment — *"the adapter records `detail.valid_dirs` only on the cut-builder refusal path; a refusal reported
by ArchGuard itself carries no `detail`, so this — the dominant real refusal — can never reach the judge."*
This section is that increment, executed and measured.

### 7.1 The post-merge reading that motivated it (2026-10-11 joint regression)

`gap-ownership-active-proposal-repair-loop`'s **AC10 post-merge half** was run on the clean develop tip
`ec00fcc00` (`.quay/ownership-shadow-proposals.jsonl`, record 91, `run_id`
`live:2026-10-11T09-28-34-622Z:1`; default resolution path = published `@yalehwang/archguard@0.1.39`,
`snapshot_matches_ref: true`, `tracked_changes_in_scope: []`). The investigation drew a 4-package cycle and
produced a `propose_slice` (3 moves: `gate→kernel` ×2, `gate/config→gate`). ArchGuard refused it
(`切法覆盖不足`, edge ` -> gate`, exit 2). `attemptRepair` classified it correctly and then **abstained at
attempt 0 with zero judge calls**:

```
outcome      = abstained          judge_calls = 0        rounds = 0
class        = invalid_move       original_matched = INVALID_MOVE:COVERAGE_INSUFFICIENT
locked       = { commit: ec00fcc00da73c8f8e7f64a6d69bd734285a02b2, scope_root: packages/quay/src }
attempt[0]   = { bucket: honest_abstain, matched: NO_RECORDED_LEGAL_DIRS, judge_called: false }
reason       = no recorded legal-dir list in the original evidence; refusing to recompute one independently
slice_delta.detail = null          ← the defect, recorded verbatim in the carrier
```

### 7.2 Root cause, by position

`recordedLegalDirs(candidateRecord)` reads exactly one place: `slice_delta.detail.valid_dirs`
(`docs/analysis/ownership-active-proposal-repair.mjs`). `computeSliceDelta`
(`docs/analysis/ownership-active-slice-adapter.mjs`) filled `detail` on **its own** pre-flight refusal only
(`buildSliceInput` → `bad(...)`, carrying `valid_dirs`). The branch where **ArchGuard itself** refuses
(`first.report.status !== "evaluated"`) returned `{status, reason, provenance, stays_*}` — **no `detail`** —
even though the very same function had built and was still holding that graph a few lines earlier
(`built.json…moduleGraph`; `internalNodes(graph)` *is* the source of `valid_dirs`). This is 硬规则 4c: the
list existed at the producer and was dropped at a layer boundary before the reader.

**Consequence:** repair could only ever start on Quay pre-flight refusals
(`NO_EDGE_EXPLAINED_BY_MOVES` / `MOVE_TO_NOT_AN_INTERNAL_DIR`). The class that actually reaches ArchGuard —
the repair loop's whole reason to exist — was **structurally unable** to start.

**Incidence (硬规则 12, from history, not from waiting):** 2/2 — §4a's pre-merge live draw (draw 4 r1) and
this post-merge draw. The unit suite was green because 3 tests hand-inject `detail.valid_dirs`
(`grep -c valid_dirs plugin/test/ownership-active-proposal-repair.test.mjs` = 3) — a criterion only a fixture
can satisfy is not a measurement (硬规则 4 推论三).

### 7.3 The fix

One helper, placed immediately after the graph is validated, and attached to **every** `not-evaluated` return
reachable once the graph exists:

```js
const legalDirs = () => ({ valid_dirs: [...internalNodes(graph)].sort() });
```

| branch | carries `detail.valid_dirs`? |
|---|---|
| pre-flight refusal (`buildSliceInput` → `bad`) | already did — unchanged, same `internalNodes` |
| `NO_REPORT:exit=…` | **now yes** |
| ArchGuard's own refusal (`切法覆盖不足`, exit 2) | **now yes** ← the one that mattered |
| `PACKAGE_GRAPH_BUILD_FAILED` / `ARCHGUARD_CLI_NOT_FOUND` / `NO_MODULE_GRAPH_IN_ARCHJSON` | **no** — deliberate: a list that was never built is not a list we may invent (3b) |

`recordedLegalDirs` is untouched: it still reads only `detail.valid_dirs` and still never runs its own
`find`/`grep`. No threshold, no gate, and no fail-closed behaviour was relaxed; no Goal was created.

### 7.4 Production-shape replay — the measurement (AC2)

Input = the **real** record's `proposed_slice` from the run above, plus the package graph of
`packages/quay/src` **at `ec00fcc00`**, produced by `git archive` + `archguard analyze` and vendored as
`plugin/fixtures/ownership-active-slice/live-ec00fcc00-coverage-gap.json`:

- `tree_sha` = `20898960d55309de503c474aec960ba2567f1dd8` — **equal** to the carrier's recorded `tree_sha`;
- `moduleGraph` sha256 = `a3946f0828a93ecba114457e1c0586ee17718cc9efa3e910ae3a46829158c9a2` — **equal** to the
  carrier's recorded `graph_sha256`, i.e. the fixture *is* the snapshot the production run was judged
  against (20 nodes / 55 edges; cycle `["gate/config","gate/factories","gate",""]`), not merely one rebuilt
  from the same commit;
- file sha256 = `68e93d1a516e581212dd6843e0297da39a8162863b0670b09897ad86a424f50c`.

The stub CLI reproduces the published 0.1.39 refusal verbatim (exit 2 + the carrier's own recorded reason
string). **Nothing injects a legal-dir list anywhere in this test.**

| | pre-fix control (`detail: null`, the recorded shape) | after the fix (the adapter's real output) |
|---|---|---|
| `recordedLegalDirs` | `null` | `["", "cli", "fan-in", "gate", "gate/config", "gate/factories", "kernel", "ts-demo"]` |
| `attempts[0].matched` | `NO_RECORDED_LEGAL_DIRS` | — (absent) |
| `attempts[0].judge_called` | `false` | **`true`** |
| `judge_calls` | 0 | **3** (the bound ends it) |
| primitive re-runs | 0 | **3** |
| engaged-round bucket / matched | — | `invalid_move` / `MISSING_CONSUMER`, `computed: not-evaluated` |
| feedback shown to the judge | never built | `legal_dirs` = the 8 graph dirs; `locked.subject` = `gate/config` |

Each engaged round is a genuine re-judgement of a revised cut by the primitive; the graph-derived
missing-consumer guard fires on the ` -> gate` edge before the tool's coverage text is reached, which is why
the recorded `matched` is `MISSING_CONSUMER` and the bucket is `invalid_move` throughout. The session ends by
**exhausting its bound** (`budget exhausted without a positive delta`), not by abstaining before it started —
which is the whole difference this task buys.

**Negative control (硬规则 4 推论四).** The one-line fix was reverted and both suites re-run: exactly the two
tests targeting the ArchGuard-refusal branch go red (the adapter AC1 test and the repair AC2 test), 33 stay
green. The tests measure the fix; they do not echo it.

### 7.5 AC6 live reading

Run inside this task's worktree, default resolution path:

```
node --experimental-strip-types docs/analysis/ownership-active-loop.mjs --live --repair --rounds 1
```

This draw ran against a tree that **contains the fix** (worktree HEAD `b287ad904417d85ba88707d867fe6002c8ce0218`)
— the property §4b structurally could not have. It is a fresh, blind draw: nothing is steered, the judge is the
same tool-less `claude -p` completion (`role meta-driver`), and the primitive is the installed ArchGuard CLI.

The prescribed round was followed by four more draws (same command, `--rounds 4`) so that the "not triggered"
reading is not a one-draw accident. All five ran against worktree HEAD
`b287ad904417d85ba88707d867fe6002c8ce0218`:

| # | run_id | terminal | action | cost (rounds / requests / evidence bytes / wall ms) | `proposed_slice` | `slice_delta` | repair |
|---|---|---|---|---|---|---|---|
| 1 | `live:2026-10-11T09-40-40-920Z:1` | `investigate_more` | `investigate` | 8 / 1 / 8 071 / 48 951 | **null** | null | **未触发** |
| 2 | `live:2026-10-11T09-41-39-387Z:1` | `propose_slice` | `propose-goal` | 7 / 4 / 17 292 / 116 150 | **null** — a goal concern, not a `package-cycle` cut | null | **未触发** |
| 3 | `live:2026-10-11T09-41-39-387Z:2` | `abstain` (forced `not-enough-evidence:rounds`) | `abstain` | 8 / 2 / 9 067 / 66 618 | null | null | **未触发** |
| 4 | `live:2026-10-11T09-41-39-387Z:3` | `investigate_more` | `investigate` | 8 / 6 / 30 549 / 164 931 | null | null | **未触发** |
| 5 | `live:2026-10-11T09-41-39-387Z:4` | `abstain` | `abstain` | 8 / 1 / 8 071 / 70 579 | null | null | **未触发** |

**Reading, stated exactly — 0/5 triggered, and why.**

1. `attemptRepair` is invoked only when `res.proposed_slice` exists **and** `isRepairableRejection(res.slice_delta)`
   holds. None of the five draws produced a `proposed_slice` (every round's `envelope.concern_kind` is `null`),
   so the repair loop correctly did not start. There is **no live post-fix repair reading in this section**, and
   none is fabricated (硬规则 4 推论三).

2. **Four of the five draws landed on this task's own defect as their concern.** Their `envelope.concern`
   strings name it directly — *"The legal-dir list is a single graph-derived quantity (internalNodes of the built
   package graph) but is materialized on only one exit path of computeSliceDelta…"*. That is not a coincidence
   and it is worth recording: the loop's evidence reader resolves file contents with
   `git show <commit>:<path>` at the **run-start commit** (`b287ad904`), where this task's fix is **not yet
   committed**. The judge therefore keeps rediscovering the un-fixed source and proposing to fix it, instead of
   roaming for a package-cycle refactor. The consequence for this reading is bounded and one-directional: it
   depresses the draw rate for the class that would exercise the repair, and it is an artefact of the fix being
   uncommitted at run time — not a property of the fix.

3. The positive live reading this task was aiming at is the one §7.1 recorded **before** the fix
   (`abstained` / 0 judge calls / `NO_RECORDED_LEGAL_DIRS`). §7.4 reproduces that exact production record and
   the exact production graph deterministically, where the identical input yields `judge_called: true` and 3
   judge calls. A *live* post-fix repair remains a registered follow-up, not a claim: reaching it needs a draw
   that lands on a `package-cycle`, and the observed base rate is low (§4a: one refusal across 8 draws; §7.5
   adds five more draws and no cut). This is recorded as the honest limit of the live half, not smoothed over.

