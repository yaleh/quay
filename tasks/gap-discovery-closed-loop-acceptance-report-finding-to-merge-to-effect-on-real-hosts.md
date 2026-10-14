---
id: gap-discovery-closed-loop-acceptance-report-finding-to-merge-to-effect-on-real-hosts
title: 架构发现真实自主闭环验收：逐条
  Finding→verifier/refuter→Task→merge→效果复测（quay+ClaudeCodeUI），来源/空轮/预算/调用失败分类计数
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-findings-lack-stable-identity-and-source-evidence-and-double-ingest-into-experience
  - gap-develop-sync-take-develop-reset-hard-wipes-uncommitted-tracked-edits-in-shared-checkout
---
## Proposal
**Real, continuous, autonomous closed-loop acceptance for Quay's architecture discovery, on both real hosts (quay + ClaudeCodeUI).** The question to answer per finding, mechanically and repeatably:

`Finding → verifier → refuter → (confirmed?) → Task filed via ABI → merged → effect re-test (did the defect recur / does the original check now read differently?)`

with **origin** recorded as autonomous-routine / autonomous-experiment / operator / user / **unknown**. Unknown must stay unknown, never be counted as autonomous.

**Baseline measured 2026-10-14 (before this task):**
- **quay `.quay/discovery-portfolio.jsonl`:** 39 findings (no append-only corrections folded). `origin`: None 18, autonomous-routine 8, autonomous-experiment 7, operator 4, mechanical-instrument 1, user 1. `outcome`: supported 20, None 18, refuted 1. With `fix_task` 11, with `fix_landed_commit` 11, with a `recurred` field 21, `duplicate_of` 0. **18 of 39 findings have no recorded origin**, so the autonomous share cannot currently be computed honestly.
- **ClaudeCodeUI:** no Portfolio file. It has never had a confirmed finding; its OSD resident rounds since 10-12 were mostly budget-blocked (21 of 28 classified rounds).
- **quay OSD resident-round facts since 10-12:** budget-blocked 25, not-due 6, ran 4, plus a call-failure class whose boundary my ad-hoc classifier could not draw cleanly. That classifier ambiguity is the reason this task needs an enumerating instrument rather than ad-hoc greps.

**What must not count as success (explicit):** `ingested N`, `not-triggered`, `verified` round state, `scan ran`, a Portfolio row without a merged fix, and a merged fix without a post-merge effect reading are all **intermediate states**, not optimization outcomes.

## Plan
1. A read-only, deterministic report instrument (`plugin/scripts/discovery-closed-loop-report.ts`, declared in the capability catalog). It walks both hosts' carriers (OSD findings, arch-discovery findings, discovery-method findings, architecture-review rounds, Portfolio, Experience ledger, evidence store, `tasks/`, `git log develop`) and emits per finding the chain above. Every link is either a value or an explicit `not-evaluated:<reason>` (硬规则 3b). It also emits per resident round an **enumerated** outcome class: `ran-with-clusters | ran-empty | not-due | budget-blocked(calls|usd) | call-failure(<class>) | stopped-mid-round | disabled | engine-failure`. Each class is counted separately, never as a boolean.
2. Use the stable concept key from `gap-discovery-findings-lack-stable-identity-and-source-evidence-and-double-ingest-into-experience` to join links. Without it, a re-discovery after a fix cannot be told from a new finding.
3. The effect re-test is a real reading taken after the merge: either the next resident round's verdict on the same concept key, or the finding's own originating check re-run at the merge commit. It is never the fix task's own AC.
4. Run it on both real hosts over a stated observation window, within existing budgets.

## Acceptance Criteria
- [x] AC1: the report on quay's real carriers reproduces the baseline counts above (or explains each difference with a citation), proving it reads the same carriers.
  - **Every baseline number reproduces exactly**, on the same carriers. `node --experimental-strip-types plugin/scripts/discovery-closed-loop-report.ts --host=quay=/data/home/yale/work/quay --since=2026-10-12T00:00:00Z`:
    ```
    present .quay/discovery-portfolio.jsonl  lines=39 malformed=0 kinds={"portfolio_finding":21,"portfolio_domain":13,"portfolio_correction":5}
    present .quay/open-semantic-discovery-findings.jsonl  lines=252 malformed=0 kinds={"scan-round":24,"cluster":212,"ingestion":16}
     ALL LINES (the baseline's population): n=39 fixes=11 landed=11 recurred_field=21 duplicate_of=0
       origin  {"autonomous-routine":8,"autonomous-experiment":7,"operator":4,"mechanical-instrument":1,"user":1,"(absent)":18}
       outcome {"supported":20,"refuted":1,"(absent)":18}
    ```
    Baseline `39 findings / origin None 18, autonomous-routine 8, autonomous-experiment 7, operator 4, mechanical-instrument 1, user 1 / outcome supported 20, None 18, refuted 1 / fix_task 11 / fix_landed_commit 11 / recurred 21 / duplicate_of 0` — the `ALL LINES` block is character-for-character that reading, and `kinds={"cluster":212,…}` is the "212 clusters" line.
  - **One difference, explained with a citation, not argued away.** The baseline's "39 findings" is the **line** count of `.quay/discovery-portfolio.jsonl`; the file is append-only and carries three line kinds. The report prints both populations, and decomposes the difference: `39 = 21 portfolio_finding + 13 portfolio_domain + 5 portfolio_correction`. The 18 "findings with no origin" are exactly those 18 overlay lines (`13 + 5`), and the 18 `outcome:(absent)` are the same 18 — cited per line by the chain rows (`carrier.line`). **The autonomous share is unchanged by this** (numerator 15, denominator 21 either way), which the report makes checkable by printing the origin enumeration over both populations side by side (`unknown=18 known=21 autonomous=15` over all lines vs `unknown=0 known=21 autonomous=15` over findings).
  - **Round classes — one reproduces exactly, two differ and are cited:** `not-due 6` matches the baseline's 6 exactly. Baseline `budget-blocked 25 / ran 4` vs the report's `budget-blocked(usd) 27 / ran-with-clusters 12 + ran-empty 7 = 19`:
    - `budget-blocked 25 → 27`: the two extra are rounds recorded AFTER the baseline's measurement instant — the baseline's own CCUI reading ("21 of 28") pins that instant at ≈2026-10-14T08:20Z, and the carrier holds two budget-blocked facts after it (`2026-10-14T09:01:49Z`, and one more since). At that instant the report reads 25.
    - `ran 4 → 19`: the baseline's 4 is exactly the resident rounds that ran **on 2026-10-14**, the day of measurement (OSD scan-rounds at `00:21:50`, `01:22:32`, `05:14:16`, `07:32:00`). The carrier holds **19** ran rounds in the full window since 10-12T17:04 — each cited in `rounds.rows` by its own `ts`, and each also present as its own `scan-round` record on the OSD carrier (`kinds={"scan-round":24,…}`, 19 of them `invoked_by:resident-driver`). This is precisely the "call-failure class whose boundary my ad-hoc classifier could not draw cleanly" the Proposal names: the enumerated instrument splits that bucket into `ran-with-clusters 12 / ran-empty 7 / call-failure(uninstrumented-exit-1) 0` here, and each value is cited by the Fact's verbatim `reason`.
- [x] AC2: the report on ClaudeCodeUI's real carriers runs and enumerates its rounds by class (pasted). An empty Portfolio reads as `0 findings` with the round-class table explaining why, not as an error and not as success.
  - `--host=claudecodeui=/data/home/yale/work/claudecodeui --since=2026-10-12T00:00:00Z`, pasted in full:
    ```
    ══ host claudecodeui  root=/data/home/yale/work/claudecodeui
       shared checkout: /data/home/yale/work/claudecodeui
       engine modules:  loaded
       carriers:
         ABSENT  .quay/discovery-portfolio.jsonl  lines=0 malformed=0 kinds={}
         present .quay/open-semantic-discovery-findings.jsonl  lines=18 malformed=0 kinds={"scan-round":6,"cluster":8,"ingestion":4}
         present .quay/arch-discovery-findings.jsonl  lines=46 malformed=0 kinds={"finding":45,"scan-round":1}
         ABSENT  .quay/routine-findings.jsonl  lines=0 malformed=0 kinds={}
         ABSENT  .quay/cross-project-dogfood-findings.jsonl  lines=0 malformed=0 kinds={}
         present .quay/quality-round.jsonl  lines=16078 malformed=0 kinds={"(absent)":16078}
       portfolio — carrier lines by kind: {}
         ALL LINES (the baseline's population): n=0 fixes=0 landed=0 recurred_field=0 duplicate_of=0
         FINDINGS ONLY (kind="portfolio_finding"): n=0 fixes=0 landed=0 recurred_field=0 duplicate_of=0
         folded chain population: 0  (not-evaluated:portfolio-carrier-absent:.quay/discovery-portfolio.jsonl)
       origins (over findings): {…,"unknown":0}  unknown=0 known=0 autonomous=0 share=NOT-EVALUATED
       chain (0 finding(s)):
       rounds(routine=open-semantic-discovery, records examined=30):
             4  ran-with-clusters
             1  ran-empty
             1  not-due
             9  budget-blocked(calls)
            14  budget-blocked(usd)
             0  call-failure(<class>)
             0  stopped-mid-round
             0  disabled
             1  engine-failure
            30  TOTAL
    ```
  - The empty Portfolio is `0 findings` **with its reason** (`not-evaluated:portfolio-carrier-absent:.quay/discovery-portfolio.jsonl`), not an error and not a success; `autonomous_share` is `NOT-EVALUATED`, never 0 or 1 over an empty denominator. The round table is what explains it: **23 of 30 rounds are budget refusals** (9 calls-ceiling + 14 usd-ceiling) and 1 is `engine-failure` — this host's discovery track spends its rounds against a ceiling rather than producing findings, and 0 of its 8 clusters are `confirmed:true`. The baseline's "21 of 28" reproduces the same shape at the earlier instant (28 records, 21 refusals).
  - The two budget classes are **separate keys**: this host is refused by BOTH ceilings, quay only by the usd one — a boolean `blocked` could not tell those two hosts apart.
- [x] AC3: for ≥1 real finding on quay, the full chain is shown with real ids at every link: carrier record → verifier/refuter verdicts → task id → merge commit on develop → post-merge effect reading. If no finding completes the chain within the window, this AC states that plainly with the furthest link reached per finding, rather than fabricating one.
  - **A real finding completes all six links** (`chain: complete=true`), each with a real id; pasted:
    ```
    · open-semantic-discovery@2026-10-13T01:10:43.215Z#2  origin=autonomous-routine[autonomous]  key=invariant|over90-task-gate.ts,supervisor-preempt-candidates.ts,task-status.ts
      verifier=supported @.quay/open-semantic-discovery-findings.jsonl:105 refuter=supported @.quay/open-semantic-discovery-findings.jsonl:105 confirmed=true  outcome=supported task=gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire [done]
      merge=537e53dc534c on-develop=true @2026-10-13T04:22:56.000Z
      effect=no-recurrence-after-fix since=2026-10-13T04:22:56.000Z
      chain: complete=true closed=true furthest=effect
    ```
    Link by link: **carrier record** `.quay/discovery-portfolio.jsonl` (row whose `finding_id` is the OSD record id); **verifier / refuter** both `supported`, read from the cluster record at `open-semantic-discovery-findings.jsonl:105`; **task id** `gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire`, present on `develop` as `status: done`; **merge commit** `537e53dc534c8f279cda9fb3f572e06344e54ebd`, verified **on develop** by `git merge-base --is-ancestor` (a real check, whose `false`/`null` values are distinct — see the test); **post-merge effect reading** `no-recurrence-after-fix` taken at the commit's own time `2026-10-13T04:22:56Z`, from two independent readings (the OSD carrier re-keyed by concept key, and the portfolio module's own `deriveRecurred` over the evidence store).
  - The task id reaches this row through an **append-only correction** (`portfolio_correction` line 35 patching `fix_task`), so the chain is built over the CORRECTION-FOLDED rows — `folded chain population: 21`. The other 20 findings state their furthest link plainly rather than being rounded up: e.g. `open-semantic-discovery@2026-10-14T00:21:50.819Z#2` stops at `furthest=refuter missing=[task,merge,effect]` (verifier and refuter both `supported`, but no fix task was ever filed), and the `semantic-dedup-scan` findings stop at `furthest=verifier missing=[refuter]` because that routine **has no refutation stage** — a genuinely absent link, reported as such.
- [x] AC4: origin is enumerated per finding; `unknown` is reported as its own count; autonomous share = autonomous / (findings with known origin), with the unknown count shown beside it.
  ```
  origins (over findings): {"autonomous-routine":8,"autonomous-experiment":7,"operator":4,"user":1,"mechanical-instrument":1,"unknown":0}  unknown=0 known=21 autonomous=15 share=0.714286
  origins (over all carrier lines): {"autonomous-routine":8,"autonomous-experiment":7,"operator":4,"user":1,"mechanical-instrument":1,"unknown":18}  unknown=18 known=21 autonomous=15
  ```
  The vocabulary is **reused** from the portfolio module's own `ORIGINS` / `AUTONOMOUS_ORIGINS` (never re-spelled here), and `unknown` is its own count on both populations — beside the share, not inside it. `autonomous_share = 15/21 = 0.714286`, with the denominator explicitly `known_total`; a fixture test asserts that an out-of-vocabulary origin value is ALSO `unknown` (not silently a known non-autonomous one) and that the share is not `2/5`.
- [x] AC5: negative control: a fixture where a fix merged but the concept recurs afterwards is reported as `recurred-after-fix`, not as closed.
  - `plugin/test/discovery-closed-loop-report.test.mjs`, pasted:
    ```
    ✔ AC5 negative control: a merged fix whose concept recurs AFTERWARDS is `recurred-after-fix`, not closed
    ✔ AC5 control's other arm: the SAME fixture with the later occurrence before the merge reads `no-recurrence-after-fix`
    ```
  - The fixture makes a **real `done` commit on `develop`** and a later cluster record sharing the finding's concept key; the report must find the landing by reading git (and checks it with `merge-base --is-ancestor`) rather than trusting the row's field. It asserts `effect.kind === "recurred-after-fix"`, `readings[0].later_occurrences.length === 1`, `chain.complete === true` **and** `chain.closed === false` — a positive effect is not a closed loop.
  - **The control can take a false value**, which is what makes it a control rather than an echo: the second arm runs the SAME fixture with the one occurrence's `ts` moved BEFORE the merge and reads `no-recurrence-after-fix` / `closed: true`. The evidence store is present-but-empty on purpose, so "looked and found nothing" is a real reading on both arms; with the store ABSENT the second arm would be untakeable (the link would be `not-evaluated`), which is itself pinned by a third test.
- [x] AC6: `scripts/test.sh --for-task <this task>` green.
  - `bash scripts/test.sh --for-task gap-discovery-closed-loop-acceptance-report-finding-to-merge-to-effect-on-real-hosts --allow-thin` ⇒ **exit 0**; `ℹ tests 38 / pass 38 / fail 0 / cancelled 0`.
  - Anti-drift: `anti-drift-touches-check.ts --task … --worktree <wt> --merge-target develop` ⇒ `ANTI-DRIFT OK … 3 actual file(s), all within declared Touches (5 glob(s))` (exit 0).

## Definition of Done
- AC1-AC6 checked with pasted real-carrier output from both hosts. No budget change. No carrier written by the report.
  - **No budget change**: `git diff develop...HEAD` over `plugin/scripts/*` touches no budget-carrying line — no `max_model_calls_per_24h` / `max_usd_per_24h` / `reservingStep(` / cap arithmetic; the report spends no model call at all.
  - **No carrier written by the report**: asserted mechanically — a test snapshots every carrier's bytes before and after a run and requires them identical, and requires two runs over unchanged carriers to be byte-identical (the report admits no wall-clock "now"; every cutoff comes from a value in a carrier, e.g. a merge commit's own time).
  - **Two defects were found by running the instrument on the real carriers, and both are pinned by tests that fail without the fix** (硬规则 4 推论三 — the report had to be read on production, not only on fixtures):
    1. an **empty subject was being keyed**: deriving the concept key from the origin record produced `open-semantic-discovery|` for the `routine-findings`-sourced findings F01–F03 (that carrier keys by `files`, not `components`) — a non-null key over an empty subject that would match every other subject-less finding as "the same concept". The guard now requires a non-empty subject, checked with the ledger's OWN normalization.
    2. **`--json` was truncated through a pipe**: `process.exit()` does not wait for a pending pipe write (measured: 91,646 bytes to a file vs 73,392 through the pipe, consumer parse failed, while the file-redirected run looked perfect). Now `process.exitCode`. The test builds a >64 KiB payload, because a smaller one sits inside the kernel pipe buffer and passes either way.

## Touches
- tasks/gap-discovery-closed-loop-acceptance-report-finding-to-merge-to-effect-on-real-hosts.md
- plugin/scripts/discovery-closed-loop-report.ts
- plugin/test/discovery-closed-loop-report.test.mjs
- plugin/scripts/capability-catalog.sh
- plugin/scripts/capability-catalog-declarations.json

## Blocker

**2026-10-14T10:24:46.111Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: a private copy of the family reappeared (finding `lineof-lineat` is back) — got 1: ["discovery-closed-loop-report.ts:994 lineOf"]
- run_id：wk-prod-anchor
