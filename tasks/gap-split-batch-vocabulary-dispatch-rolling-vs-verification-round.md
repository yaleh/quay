---
id: gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round
title: "\"batch\" now means two things (rolling dispatch vs batched verification/closure) — a future reader could misread it as dispatch-gating and drift the behavior back; split the vocabulary, R2-family risk in tick-log/commit wording"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者 + 人（2026-08-05）：「batch」现在指两件不同的事——

1. **分派是滚动的**（gap-eighty-two 填空槽位已实测证明：槽位空即派、不等攒批）；
2. **全量套件验证 + 收尾记账仍是攒几个一起做**（fan-in 批模型）。

两者共用同一个词。人明确担心：inner（或未来任何读 tick-log/commit message 的会话，含换模型后的）
**望文生义**，把「batch」读成「分派要门控」，行为漂移回去——**与 R2（驱动文本只带数据不带行为）同一
类风险，只是载体是外层自己的 tick-log/commit message 措辞，不是驱动文本。**

> **AC7 交叉标注（2026-08-05，`gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-
> async` 落地时写）**：本任务（词汇拆分）是**措辞层**，`gap-closure-sync-...` 是**机制根**——批次边界
> 的真源是记账同步（「Close batch-N」三次在 inner 派发历史、收尾期零新派发），**改名解决不了同步点**。
> 机制根已把 inner 侧彻底清掉收尾/记账/批次概念：inner 只剩「派发 + 执行 + 合并」，全量验证/收尾节奏
> 由外层异步做并记 `verification-round-N`。因此本任务的词汇拆分范围**自然收窄**：inner 侧已不再有
> 「批」语义可被误读（`fast-mode-loop-tick.md` step 2 的「合并串行，全量套件批量」已随机制根删除）；
> 剩余词汇工作是外层文档同步 + 历史名（batch2-queue-state.md / batch4a/b/c / concurrent-batch-
> scheduler.ts）标注，以及 AC5 把「分派滚动 / 验证 verification-round」写死成规范语句。

### 核实：tick 文档里 `batch` 的分布（管理者精确重查，2026-08-05）

`fast-mode-loop-tick.md` 现存 **5 处** batch，分**两类**——**不是全仓替换这个词**：

| 位置 | 语义 | 处置 |
|---|---|---|
| `concurrent-batch-scheduler.ts` 路径 + 其 `--json` 输出 `{batch, deferred}` 字段（407/414/415 行） | **机件真名**（代码标识符 + 真实输出字段） | **白名单豁免**——改了会断调用和解析，不动 |
| 272 行引用任务名 `gap-closure-sync-is-the-true-batch-boundary` | **任务 id** | **白名单豁免**——id 不能改 |
| （fast-mode-loop-tick step 2「合并串行，全量套件批量」已随机制根删除；cold-start/SKILL.md 已 0 处） | — | 本条只剩 tick 文档要处理 |

**⇒ 真正该消除的是散文里暗示「门控」语义的用法**（batch 作调度单位），不是 batch 这个词本身。

**范围**：措辞与文档，**不改机制本身**；覆盖 tick 文档里所有会被 inner 读到的位置，不只是 commit
message。

### 选定机制

**词汇拆分，写死成规范**：

- **分派侧不需要编号**——它就是滚动的，不叫 `batch-N`（任何 batch-N 措辞都该是历史引用或错误）；
- **验证/收尾节奏叫 `verification-round-N`**（或等价），并显式注记「**这一节奏关于验证/收尾，不是
  分派门控**」；
- 历史名（文件名/过去批次）保留但标注「历史引用」。

## Acceptance Criteria

- [ ] AC1: `fast-mode-loop-tick.md` 派发节（step 4）措辞修正——「可同批」改为显式「可并发/无触摸重叠，
      非门控分批」；分派侧不再出现任何可读成「分派要门控」的 batch 措辞
- [ ] AC2: `fast-mode-loop-tick.md` fan-in/验证节（step 2）改名 `verification-round-N`，并显式注记
      「关于验证/收尾，不是分派门控」
- [ ] AC3: `orchestrator-loop-tick.md` 同步同一词汇拆分（派发滚动 / 验证 round）
- [ ] AC4: **grep 证明（白名单豁免 + 负控制）**——inner 会读到的散文里每个 `batch` 出现分类为：
      「门控语义（必须消除）/ 机件真名（concurrent-batch-scheduler.ts 路径 + {batch,deferred} 输出字段）
      / 任务 id（gap-closure-sync-is-the-true-batch-boundary）白名单豁免」；**散文零个把 batch 用作调度
      单位的新表述**；**负控制**——刻意在散文写一句「batch 门控」表述 ⇒ 检查必须报出（证明白名单不是
      万能借口，实跑输出贴任务体）
- [ ] AC5: **tick-log/commit message 词汇规范**——tick 文档加一条规范性语句：「分派是滚动的（不叫
      batch-N）；全量验证/收尾节奏叫 verification-round-N」，未来会话（含换模型后）沿用拆分词汇
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`（若词汇检查可测试化——grep 断言
      「tick 文档无『可同批/批派发』式措辞」）

## Definition of Done

- [ ] AC1–AC6 全部勾上；AC4 的 grep 分类表逐字贴任务体
- [ ] 一次真实使用：至少一条新 tick-log/commit 条目用 `verification-round-N` 词汇（记录）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- CLAUDE.md（process 段若提及 batch 语义，同步词汇拆分）
- （tick-log 惯例随 AC5 落文档）

## Contract

measure   batch_misread_count = `grep -rn '同批\|批派发\|batch-N' plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md` stdout 的行数字段
band      batch_misread_count = 0（零个可读成分派门控的 batch 措辞）
invariant verification_cadence_renamed = 1（验证/收尾用 verification-round-N，显式排除门控语义）
invoke    `grep -rn 'batch' plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md`
control   负控制：构造含「可同批/批派发」措辞的文本 ⇒ 检查器/人工必须标记（防回归）
resume    词汇拆分与规范语句分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T01:0xZ
changed: 外层受管理者+人裁定立案。四处收紧：
(1) **载体是外层自己的措辞**——不是驱动文本，是 tick-log/commit message 里的「batch」；措辞漂移会
让未来会话（含换模型）行为漂回门控；
(2) **AC4 用 grep 分类表证明**——每个 batch 出现要能归入三类（资格/验证/历史），零个门控误读新用法，
不允许「口头保证」；
(3) **AC5 写死规范语句**——词汇拆分进 tick 文档，未来会话不靠角色记得；
(4) **历史名不改名但标注**——batch2-queue-state 文件名 / batch4a/b/c / concurrent-batch-scheduler.ts
是历史引用，改名会破坏链接，标注即可。
status: todo——不阻塞当前批（batch-4 在飞）；排批后。
