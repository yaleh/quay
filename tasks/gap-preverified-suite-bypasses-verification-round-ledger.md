---
id: gap-preverified-suite-bypasses-verification-round-ledger
title: pre-verified-suite 路径绕开 verification-round.jsonl 写入——趋势账本对最新落地路径变瞎
status: ready
labels:
  - gap
  - instrumentation
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-direct-to-develop-exclude-cron-registry-receipt
---
**type:** execution

## Proposal

**现象（manager 实读核实，outer 复核确认）**：`.quay/verification-round.jsonl` 自 `04:13:31Z`（round227，green 5019 tests）起**无新记录**（截至 12:2xZ 已 7h+），即使期间有 4 次真实 fan-in 落地（10:58/11:33/11:53/11:56Z）。

**根因（实读代码确认）**：`verification-round.jsonl` 的写入点在 `full-suite-runner.ts:1455-1462`（`appendVerificationRound`）——只有**实际跑 suite** 时触发。pre-verified-suite 路径（fan-in-execute.js step 4，ec434eb8 落地）**跳过 suite 重跑、复用 capture**（suite_head 钉死 + suite_exit=0），因此**从不调用 full-suite-runner、从不触发 verification-round 写入**；只有 `per-task-suite-records.jsonl` 走了入账（per-task-suite-record.ts）。⇒ 新路径没接上老记录点。

**影响**：`verification-round.jsonl` 本是 suite 耗时/红绿趋势账本（`/tests` 页面、suite 成本分析的数据源）。现在最新最常用的落地路径对它不可见——「suite 到底变没变快」这类问题只能翻 /tmp 日志和 git log 现拼，拼不出干净趋势线。**manager 指出：不补，未来 suite 成本/趋势分析结构性盲**。

**能取假（⊢ 对照）**：修复后，一次走 pre-verified-suite 的 fan-in 落地在 verification-round.jsonl 产生一条新记录（state=green、durationMs=复用 capture 的墙钟、含 preverified 标记）；或至少产生一条结构等价的可机读记录，且 `/tests` 能读到它。

## Plan

1. 读 fan-in-execute.js step 4/4.5（pre-verified-suite 分支，ec434eb8）与 full-suite-runner.ts:1455 `appendVerificationRound` 的 schema。
2. 决定补写位置与语义：pre-verified 分支应调用与全量跑等价的 verification-round 入账（复用 capture 的 durationMs/wall_ms + `preverified: true` 标记），或补一条结构等价记录；保证 `/tests` 与成本分析读得到。
3. 确认不与 per-task-suite-records.jsonl 重复职责（两份账本分工：verification-round=全量趋势 / per-task-suite=逐任务验证）。
4. **AC4 独立信号**：main-scope 全量 suite 耗时超 600s（AC101 目标）时产生独立显性信号——建议在 outer tick 判据或 suite-state-trigger 里加一行（读 verification-round 最新 main-scope 记录，`durationMs > 600000` 即报），不依赖 fan-in 是否卡死；亦可复用 A10 closure-lag 的升级形态。
5. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [ ] AC1: 走 pre-verified-suite 路径的 fan-in 落地在 verification-round.jsonl 产生新记录（含 preverified 标记），不再让趋势账本出现 7h+ 空档。
- [ ] AC2: 记录 schema 与 full-suite-runner 既有记录兼容（`/tests` 与成本分析可读），durationMs 语义明确（复用 capture 墙钟 vs 全量跑）。
- [ ] AC3: 与 per-task-suite-records.jsonl 职责不重复（逐任务验证账本不受影响）。
- [ ] **AC4: AC101 超标独立显性信号（manager 2026-08-17 治理疑虑，已核实成立）**——main-scope 全量 suite 耗时超 600s 时，要有**独立的、不依赖 fan-in 是否卡死的**显性信号（哪怕只是 tick 里的一行判据），让「suite 变慢了」不再兼职由「suite 能不能在回合内跑完」担任唯一判据。**背景**：pre-verified-suite（ec434eb8）把 suite 挪到回合外跑，同时拆掉了 AC101 仅剩的两层哨兵——①10min Bash 回合上限（客观起哨兵作用，被精确绕开）②verification-round.jsonl 耗时趋势账本（从 round227 起静默）。round227（04:13:31Z）durationMs=936519=936.5s **已超 AC101 600s 目标 55%**，且是账本静默前最后一条——**超标无警报**。账本恢复（AC1）≠ 有人在主动检查它，故本条补独立信号。
- [ ] AC5: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] pre-verified-suite 路径补 verification-round 入账（含 preverified 标记），趋势账本对最新落地路径可见，与 per-task-suite 分工清晰，scoped + 全量绿。

## Touches

- plugin/workflows/fan-in-execute.js（pre-verified-suite 分支补 verification-round 写入）
- plugin/scripts/per-task-suite-record.ts 或新增等价 writer（verification-round 入账复用）
- packages/quay/test/（/tests 读取测试）或 plugin/test/
- tasks/gap-preverified-suite-bypasses-verification-round-ledger.md（自身）
