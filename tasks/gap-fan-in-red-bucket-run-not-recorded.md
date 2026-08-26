---
id: gap-fan-in-red-bucket-run-not-recorded
title: fan-in 桶路径跑红不入账——verification-round.jsonl 只在全绿后写、writer 硬编码 state:green（红分支「无记录」与「没跑过」同形，硬规则 3b）
status: ready
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（manager 实读，outer 读码复核）**：`gap-suite-lock-starvation-long-validation-hold` 的全量轮 `exit=1`（1 个已知 flaky fail），但 `/tests` 页面显示最近轮次（含 #628）全绿。追到根子，是真实机制缺口：

```
① .quay/verification-round.jsonl 全文件搜「lock-starvation」：0 命中（628 行全部有效 JSON，非静默丢行）
② fan-in-execute.js 注释「step 4.5 全绿后 # suite-record-block 写」⇒ record 写入块挂在 suite_exit=0 后面，
   红色分支根本走不到它
③ 唯一 writer pre-verified-round-record.ts 字面量写死 state:"green"（:31/:76 注释「both fan-in branches
   only write after suite_exit=0」）
④ /tests 页面读的正是这份文件（observation.ts:2514 VERIFICATION_ROUND_REL）
```

**⇒ fan-in 桶路径（`--buckets <task>`，`setsid bash scripts/test.sh` 真跑 suite）一旦跑红，就【完全不落账】——不是记成绿，是压根没有这条记录。**

**硬规则 3b 形状**：一个只在成功时才写的账本，把「没跑过」和「跑了但红了」伪装成同一种外观（都是「无记录」）。危害不是理论的：任何人（含 manager 自己刚才）拿 `/tests` 页面判断「最近是不是都健康」，都会漏掉所有 fan-in 桶路径上的真实红。

**与 done 任务不重叠（manager 核实，outer 复核确认）**：`gap-preverified-suite-bypasses-verification-round-ledger`（done）修的是**另一半**——pre-verified 分支**复用 capture 跳过重跑**时的绿结果不入账（suite_exit 隐含 0）。它的 AC1 从未要求覆盖「真跑了但跑红了」这个分支。两个分支共用同一个 green-only 的 writer，红色分支从设计上就没被那条任务的验收范围覆盖过。

## Plan

1. `pre-verified-round-record.ts` 的调用点传**真实 `suite_exit`**（不是隐含假设 0）；writer 按传入值记 `state: green/red`，而非硬编码 `green`。
2. `fan-in-execute.js` 桶路径的 record 写入块在 `suite_exit != 0` 时也写（红分支走到 record block，传真实 suite_exit），⛔ 不再只在「全绿」后写。
3. `.claude/workflows/` 与 `plugin/workflows/` 双副本逐字节一致（dual-copy drift gate）。

## Acceptance Criteria

- [ ] AC1（能取假，红桶入账）：一次跑红的 fan-in 桶路径落地，在 verification-round.jsonl 产生一条 `state=red` 记录（含真实 suite_exit + 任务 id + fail 计数）；（⛔ 仍无记录 / 记绿 ⇒ 假）。
- [ ] AC2（能取假，负控制红绿对照）：绿桶路径记 `green`、红桶路径记 `red`，两者都入账（无「只成功才写」）——用红绿两条对照证明「写 red 分支」真实生效，非恒绿（硬规则 4c：恒绿判据 = 空转）；（⛔ 红分支仍不入账 ⇒ 假）。
- [ ] AC3（能取假，硬规则 3b 区分）：`/tests` 页面（或 verification-round.jsonl 消费者）能区分「没跑过（无记录）」与「跑了但红（state=red 记录）」——两者不再同形。

## Definition of Done

红桶路径入账 + writer 按真实 suite_exit 记 green/red；AC1-AC3 全勾；「没跑过」与「跑了但红」在账本上可区分。

## Touches

- plugin/scripts/pre-verified-round-record.ts（writer 接受真实 suite_exit/state，记 green/red，不硬编码 green）
- .claude/workflows/fan-in-execute.js（红分支也写 record，传真实 suite_exit）
- plugin/workflows/fan-in-execute.js（dual-copy 同步，逐字节一致）
- plugin/test/pre-verified-round-record.test.mjs（red 记录测试 + 红绿对照）
- tasks/gap-fan-in-red-bucket-run-not-recorded.md（自身）
