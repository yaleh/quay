---
id: gap-preverified-suite-bypasses-verification-round-ledger
title: pre-verified-suite 路径绕开 verification-round.jsonl 写入——趋势账本对最新落地路径变瞎
status: done
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
   **实现（2026-08-17）**：新增等价 writer `plugin/scripts/pre-verified-round-record.ts`（**不改** `per-task-suite-record.ts`——外层 B9 裁定，bootstrap 任务在飞需不相交）。fan-in-execute.js step 4 复用 capture 时追加 `suite_preverified=1` 标记；step 4.5 新增 `# preverified-round-block`，标记为 1 时调 writer 写 verification-round.jsonl（`preverified:true` + 复用 capture 的 wall_ms + 钉死 suite_head 为 commit + scope=worktree + pass/fail/cancelled/tests 省略——capture 无测试计数，不伪造）。`.claude/workflows/` 与 `plugin/workflows/` 双副本逐字节一致（dual-copy drift gate）。
3. 确认不与 per-task-suite-records.jsonl 重复职责（两份账本分工：verification-round=全量趋势 / per-task-suite=逐任务验证）——新 writer 只写 verification-round.jsonl，per-task-suite-record.ts 原样保留。
4. **AC4 独立信号**：新增独立脚本 `plugin/scripts/suite-duration-exceed-check.ts`——读 verification-round 最新记录（任何 scope，pre-verified worktree 行即落地路径）与最新 main-scope 记录（AC101 `scope!=worktree` 定义），`durationMs > 600000` 即 exit 1 + SUITE-DURATION-EXCEEDED；无记录 = NOT-EVALUATED（硬规则 3b）。独立可跑（tick/ cron/排障里一行判据），不依赖 fan-in 是否卡死。
5. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [x] AC1: 走 pre-verified-suite 路径的 fan-in 落地在 verification-round.jsonl 产生新记录（含 preverified 标记），不再让趋势账本出现 7h+ 空档。
- [x] AC2: 记录 schema 与 full-suite-runner 既有记录兼容（`/tests` 与成本分析可读），durationMs 语义明确（复用 capture 墙钟 vs 全量跑）。
- [x] AC3: 与 per-task-suite-records.jsonl 职责不重复（逐任务验证账本不受影响）。
- [x] **AC4: AC101 超标独立显性信号（manager 2026-08-17 治理疑虑，已核实成立）**——main-scope 全量 suite 耗时超 600s 时，要有**独立的、不依赖 fan-in 是否卡死的**显性信号（哪怕只是 tick 里的一行判据），让「suite 变慢了」不再兼职由「suite 能不能在回合内跑完」担任唯一判据。**背景**：pre-verified-suite（ec434eb8）把 suite 挪到回合外跑，同时拆掉了 AC101 仅剩的两层哨兵——①10min Bash 回合上限（客观起哨兵作用，被精确绕开）②verification-round.jsonl 耗时趋势账本（从 round227 起静默）。round227（04:13:31Z）durationMs=936519=936.5s **已超 AC101 600s 目标 55%**，且是账本静默前最后一条——**超标无警报**。账本恢复（AC1）≠ 有人在主动检查它，故本条补独立信号。
- [x] AC5: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [x] pre-verified-suite 路径补 verification-round 入账（含 preverified 标记），趋势账本对最新落地路径可见，与 per-task-suite 分工清晰，scoped + 全量绿。

## Touches

- plugin/workflows/fan-in-execute.js（pre-verified-suite 分支补 verification-round 写入——复用 capture 时追加 suite_preverified=1 标记 + step 4.5 新增 # preverified-round-block 调 writer）
- .claude/workflows/fan-in-execute.js（同 dual-copy 的 landed 副本，与 plugin/workflows 逐字节一致）
- plugin/scripts/pre-verified-round-record.ts（新增等价 writer——verification-round.jsonl 入账，含 preverified:true + 复用 capture 的 wall_ms；不改既有 per-task-suite-record.ts）
- plugin/scripts/suite-duration-exceed-check.ts（新增，AC4 独立显性信号——verification-round 最新 main-scope 记录 >600s 即报，不依赖 fan-in 卡死）
- plugin/scripts/capability-catalog.sh（新增脚本的能力声明表 + 频率表登记）
- plugin/test/pre-verified-round-record.test.mjs（新增 writer 测试）
- plugin/test/suite-duration-exceed-check.test.mjs（新增 AC4 信号测试）
- plugin/test/fan-in-execute-paths.test.mjs（新增 ⑦ verification-round 入账路径测试）
- packages/quay/test/serve-ac95-views.test.mjs（/tests 读取 pre-verified 记录测试）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照随新增 scripts 重生成）
- tasks/gap-preverified-suite-bypasses-verification-round-ledger.md（自身）
