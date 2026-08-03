---
id: gap-dispatch-gate-has-no-checklist-and-no-trace
title: "The pre-dispatch mechanism review is a habit, not a mechanism — no
  trigger, no checklist, no record that it happened"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

快速模式绕开了 prepare 管线（实测 232 条遥测：**6.9% 成功率、73.5 小时墙钟**，ProposalReview +
PlanCheck 占 55% 成本）。这个取舍是对的——今天完成 15 个任务正因为绕开了它。

但被绕开的东西里有一件真有价值：**在开工前有人审查「选定机制」**。今天它以「外层在派发闸口看一眼」
的形式发生了四次，每一次都改变了产出：

| # | 任务 | 外层在闸口/执行中改了什么 | 若不改会怎样 |
|---|---|---|---|
| 1 | `4vs8`（内层自建） | 要求 6 次运行的 `selected N files` 必须一致 | 当时 flags-only 缺陷尚未发现，测试选择集会静默改变，整组数据作废 |
| 2 | `4vs8` | 只用 `=` 拼写（空格形式落进 explicit-file 分支） | 同上 |
| 3 | `4vs8` | 每跑完一次即增量写盘 | 该任务确实停摆两次；不写盘则整批作废 |
| 4 | `M243` 语料修复 | 否掉「`--check` 前先 `--sync-dist`」 | 一个在检查前修好被检对象的检查永远不会失败＝掩盖 |

**但它不是机制，是惯例**：

- **没有触发条件**——靠内层恰好停下宣告、外层恰好在 tick 里看到
- **没有清单**——四次介入里有两次（`=` 拼写、`duration_ms` 口径）靠的是**外层碰巧拥有内层没有的
  上下文**（来自另一个任务的对抗审查、来自自己跑过的一次实测）。换一个上下文不同的外层，这两条都会漏
- **没有留痕**——prepare 管线至少产出 `preparation.json` / `proposal-ledger.json`；这个闸口产出的
  是一条会滚走的 tmux 消息。**事后无法判断某次派发到底有没有过闸**

第三点还有一个更直接的后果：`duration_ms` 那次是在 run1 **已经写下错误结论之后**才拦住的。
闸口若有清单，「你打算怎么测 Σ」本该在方法段定稿时就被问到。

## Chosen mechanism

**两样东西，都要求便宜到不会被跳过。**

### 一、机制选择清单（`## Chosen mechanism` 必须回答的问题）

初稿直接从今天四次介入归纳，**不预先扩充**——ADR-021 原则：证据不足时不要把策略机械化。

| 问题 | 来自 | 不回答会怎样 |
|---|---|---|
| **口径**：要测的量怎么定义？用哪个字段？ | `duration_ms` 被当成 Σ 每文件耗时 | 六次跑带着同一个错误，结论由计算方式而非被测对象决定 |
| **不变量**：什么必须跨运行保持一致才能归因？ | `selected N files` | 变量不止一个，差异归因不了 |
| **失败长什么样**：这个方案失败时会看到什么？ | 「`--check` 前先 `--sync-dist`」 | 修法可能让检查永远不失败＝掩盖 |
| **中断保全**：中途停了，已得的数据留下吗？ | 增量写盘 | 触到 90 分钟阈值即整批作废 |
| **调用形态**：命令的确切写法有歧义吗？ | `=` vs 空格拼写 | 静默走进另一条代码路径 |

清单**写进任务模板**，`## Chosen mechanism` 段落之后。不回答的项要显式写「不适用」及理由——
留白与「没想过」不可区分。

### 二、过闸留痕

派发时把闸口结果写进任务体一个固定段落 `## Dispatch review`：

```
reviewer: outer | none
at: <ISO>
checklist: 口径 ✓ / 不变量 ✓ / 失败形态 ✓ / 中断保全 ✓ / 调用形态 n/a（无外部命令）
changed: <外层要求的改动，逐条；无则写「无」>
```

**`reviewer: none` 是合法值**——不是每个任务都需要过闸，但「没过闸」必须是一个**被记录的选择**，
而不是一个无法区分于「忘了」的空白。

## Acceptance Criteria

- [ ] AC1: 清单五项写进任务模板，位置在 `## Chosen mechanism` 之后
- [ ] AC2: `## Dispatch review` 段落格式定义，`reviewer: none` 是合法值
- [ ] AC3: 一个机械检查：任务进入 in-flight 时若缺 `## Dispatch review` 段则报出（**不阻断**——
      阻断会让人为了通过而敷衍填写）
- [ ] AC4: 用今天四个真实案例回填验证：`4vs8`、`M243` 语料修复、`M136` 第三轮、
      `blocked-signal`——每个都能用这五项表达出当时的介入，不能表达的说明清单缺项
- [ ] AC5: 检查带 `// @test-group engine` 声明
- [ ] AC6: 明确记录**不做**的事：不引入审查 agent、不加轮次、不阻断派发。这是一张清单加一条记录，
      不是把 prepare 管线换个名字装回来

## Definition of Done

- [ ] AC4 的四个回填案例贴进任务体
- [ ] `scripts/test.sh` 绿
- [ ] 明确记录：**闸口现在拦住的东西里，有一半靠外层碰巧知道**——清单的目的是把「碰巧」变成
      「每次都问」，而留痕的目的是让「有没有过闸」可事后判定

## Touches

- plugin/scripts/task-schema.ts
- plugin/scripts/dispatch-review-check.ts
- plugin/test/dispatch-review-check.test.mjs
- docs/analysis/fast-mode-loop-tick.md
- orchestration/orchestrator-loop-tick.md
