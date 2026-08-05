---
id: gap-web-board-needs-an-inconsistency-verdict-it-does-not-have
title: /board must join intent, execution and landing — and decide whether to
  reuse the drift checker or reimplement its judgment
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`docs/proposals/quay-web-observation-surface.md` §4 第一步的核心是 `/board`：
任务列表 + **意图 / 执行 / 落地三列** + 不一致高亮。

这比 [[gap-web-cannot-show-what-the-loop-is-doing-now]] 的两条路由难，因为它**要下判断**：

| 显示 | 判据 |
|---|---|
| `done 但未落地` | frontmatter `done` + `## Touches` 的代码根条目在 master 上不存在 |
| `已落地但未收尾` | 代码在 master + 遥测无 `--task-end` |
| `在飞超时` | `--task-start` 后超过阈值仍无 end |
| `孤儿` | 有 start 无 end 且进程已不存在 |

### 未决问题：复用还是重实现（提案 §7，人尚未裁定）

**前两条判据与 `plugin/scripts/task-status-drift-check.ts` 是同一个判断。**
那个检查器 2026-08-03 刚被修过（[[gap-reverse-drift-check-buries-true-positives-in-noise]]），
现在有 `BOOKKEEPING_ROOTS` 划分、`hasAnyCodeRootTouch()`、`stripTouchAnnotation()` 等
**踩过坑才得到的细节**——重实现几乎必然会漏掉其中几条，然后 `/board` 会显示与检查器**不同**的结论。

| 选项 | 代价 |
|---|---|
| **复用** `task-status-drift-check.ts` | Core（`packages/`）依赖 `plugin/scripts/` —— **架构上是倒置的**，Core 应当 provider-agnostic |
| **重实现** 在 `observation.ts` 里 | **双源**：同一个判断两份实现，必然漂移。今晚已被这种双源绊过一次（tick 文档重述 `VALID_BLOCKED_REASONS`） |
| **第三条路**：把判断抽到一个两边都能依赖的位置 | 需要决定那个位置在哪，成本未知 |

**本任务的第一步就是回答这个问题，并把依据写下来**——不是先写代码再补理由。

### 为什么这个判断值得单独一个任务

`/board` 的四条判据是**人用来判断「循环是否健康」的全部依据**。
它们如果与检查器不一致，人会同时看到两个互相矛盾的结论，
而**不知道该信哪个**——这比没有看板更糟。

## Contract

```
measure  board_flags = `curl -s http://127.0.0.1:4173/board` 输出中 data-flag 属性的计数字段
measure  checker_flags = `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --json` 输出的 suspects 与 reverse 字段长度之和
band     agreement = board_flags 与 checker_flags 必须逐个任务一致    # 不一致即本任务失败
invariant 被扫描的任务集合在两边一致                                  # 集合不同则计数不可比
invoke   `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173`
control  人为把一个 done 任务的 Touches 指向不存在的代码文件 ⇒ 两边都必须标它，且标同一种
resume   n/a: 单次请求，无中途产物
```

## Chosen mechanism

**先决定复用还是重实现，写下依据，再实现。顺序不能反。**

### 第一步：回答架构问题（本任务的主要产出）

逐条回答，**依据是代码事实不是偏好**：

1. `task-status-drift-check.ts` 的判定逻辑是否是**纯函数**（无 I/O、无进程）？若是，抽取成本很低。
2. Core 现在是否**已经**依赖 `plugin/` 的任何东西？（若已有先例，倒置的代价就不是新增的）
3. 抽到哪里两边都能依赖？`packages/quay/src/` 下？还是一个新的共享位置？
4. 若重实现，**两份实现漂移时谁是权威**？答不出来就不该重实现。

**输出一段结论 + 依据**，写进任务体。

### 第二步：按结论实现 `/board`

三列：**意图**（任务库的 status/labels）· **执行**（遥测的 start/end）· **落地**（git 里代码是否存在）。
四条判据按第一步的结论接线。

### 第三步：一致性回归

`/board` 的标记必须与 `task-status-drift-check.ts` 在**同一份任务库上逐个任务一致**。
不一致即失败——这是 AC2，也是本任务存在的理由。

**不做**：不新增判据（四条就是四条，不借机扩充）；不做写操作；
不因为「看板上不好看」而调整判据的阈值——那是把判断迁就展示。

## Acceptance Criteria

- [ ] AC1: 架构问题的四问逐条回答，**依据是代码事实**（grep/实跑），结论写进任务体
- [ ] AC2: `/board` 的标记与 `task-status-drift-check.ts` 在真实任务库上**逐个任务一致**；
      不一致的任务逐个列出并说明原因（应为 0 个）
- [ ] AC3: **负控制**——人为构造一个 `done` 但 Touches 指向不存在代码的任务，
      两边都必须标它且标同一种；移除后两边都不标
- [ ] AC4: 若选择重实现，任务体必须写明**漂移时谁是权威**；答不出则不许重实现
- [ ] AC5: 三列（意图/执行/落地）各自的数据源在页面上可见，读者能判断某一列为空是「无数据」还是「读失败」
- [ ] AC6: 数据源缺失时 `/board` 仍返回 200 并降级，不 500
- [ ] AC7: 现有路由行为不变，既有测试全绿
- [ ] AC8: 测试带 `// @test-group product` 声明

## Definition of Done

- [ ] AC1 的四问回答与 AC2 的逐任务一致性对照贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**看板与检查器给出不同结论，比没有看板更糟**——
      人会同时看到两个矛盾的答案且不知道该信哪个

## Touches

- packages/quay/src/observation.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/test/serve-board.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T03:46:00Z
changed: 把提案 §7 那个我提过、人未裁定的开放问题（复用 drift checker 还是重实现）**提升为本任务的第一步且是主要产出**，而不是留在实现里临时决定；并加 AC4——若选重实现必须先写明漂移时谁是权威，因为今晚已被同类双源绊过一次（tick 文档重述 VALID_BLOCKED_REASONS）
