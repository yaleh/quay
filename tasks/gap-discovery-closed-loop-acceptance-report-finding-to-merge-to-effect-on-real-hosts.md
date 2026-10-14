---
id: gap-discovery-closed-loop-acceptance-report-finding-to-merge-to-effect-on-real-hosts
title: 架构发现真实自主闭环验收：逐条
  Finding→verifier/refuter→Task→merge→效果复测（quay+ClaudeCodeUI），来源/空轮/预算/调用失败分类计数
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-findings-lack-stable-identity-and-source-evidence-and-double-ingest-into-experience
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
- [ ] AC1: the report on quay's real carriers reproduces the baseline counts above (or explains each difference with a citation), proving it reads the same carriers.
- [ ] AC2: the report on ClaudeCodeUI's real carriers runs and enumerates its rounds by class (pasted). An empty Portfolio reads as `0 findings` with the round-class table explaining why, not as an error and not as success.
- [ ] AC3: for ≥1 real finding on quay, the full chain is shown with real ids at every link: carrier record → verifier/refuter verdicts → task id → merge commit on develop → post-merge effect reading. If no finding completes the chain within the window, this AC states that plainly with the furthest link reached per finding, rather than fabricating one.
- [ ] AC4: origin is enumerated per finding; `unknown` is reported as its own count; autonomous share = autonomous / (findings with known origin), with the unknown count shown beside it.
- [ ] AC5: negative control: a fixture where a fix merged but the concept recurs afterwards is reported as `recurred-after-fix`, not as closed.
- [ ] AC6: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC6 checked with pasted real-carrier output from both hosts. No budget change. No carrier written by the report.

## Touches
- tasks/gap-discovery-closed-loop-acceptance-report-finding-to-merge-to-effect-on-real-hosts.md
- plugin/scripts/discovery-closed-loop-report.ts
- plugin/scripts/capability-catalog.sh
- plugin/test/discovery-closed-loop-report.test.mjs
