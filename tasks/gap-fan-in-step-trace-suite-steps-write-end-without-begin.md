---
id: gap-fan-in-step-trace-suite-steps-write-end-without-begin
title: fan-in-step-trace 的 4 个 suite 步骤只写 step-end 不写 step-begin——最贵的 suite
  步骤在该载体里结构上不可测时长
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

`.quay/fan-in-step-trace.jsonl`（12,308 条，09-04 起）里有 **2,097 / 7,204 = 29%** 的
`step-end` 配不上 `step-begin`，且孤儿 **100% 集中在 4 个 step 名**：

| step | 配对 | 孤儿 end | 孤儿率 |
|---|---|---|---|
| `ac-precheck` | 0 | 697 | 100% |
| `suite-start` | 0 | 697 | 100% |
| `suite-end` | 0 | 695 | 100% |
| `suite-skip` | 0 | 15 | 100% |
| 其余 8 步（`merge-develop`/`anti-drift`/`typecheck`/`doc-check`/`scoped-gate`/`anti-drift-land`/`ac-gate`/`ff`） | 4,908 | 0 | **0%** |

根因方向：这 4 个 suite 决策步骤的 `step-begin` 自 2026-08-28 起改写到 per-run 日志文件，
而 `step-end` **仍在写共享载体**——半拉状态。

**⚠️ 与已有任务的关系（不是重复立案）**：`tasks/gap-fan-in-step-trace-suite-step-stopped-writing.md`
已 `status: done`，其标题声称这批步骤在共享载体上「永久停写」，**但盘上实际是 `step-end`
仍在写**（2,104 条）。这是那次修复的残留，且与该任务的结论不符。

**后果（要点）**：fan-in 里**最贵的一步（suite，中位 3–17 分钟）在该载体里结构上无法测出时长**。
实测 8 个可配对步骤合计中位仅约 2 分钟，而单次 fan-in 端到端中位 9.7 分钟、p90 154.6 分钟、
最大 693 分钟——缺口里既有排队也有 suite，**但因为 suite 不在载体里，二者无法拆开**。
本次定量复核因此把「75% 是等待」这个结论收回，见
`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §5 错误一。

## Touches

- `plugin/scripts/worker-driver.ts`
- `plugin/test/worker-driver-fan-in.test.mjs`
- `tasks/gap-fan-in-step-trace-suite-step-stopped-writing.md`
- `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md`
- `tasks/gap-fan-in-step-trace-suite-steps-write-end-without-begin.md`

## Acceptance Criteria

- [x] 定位并贴出 4 个 suite 步骤的 `step-begin` 与 `step-end` 各自的写入点（文件:行号），
      说明为何一半改了载体一半没改。
      **⇒ 见 `## Evidence` AC1**。写入点 `worker-driver.ts:4299`（`traceSuiteEvent`，只 `end`）
      vs `:4311/:4314`（`step()`，`begin`+`end`）；`begin` **从来就不存在**于这 4 个 step 名下。
- [x] 让 suite 步骤的**时长**在某一个载体里可测，三选一并落地：①恢复 `step-begin` 写共享载体；
      ②`step-end` 自带 `durationMs` 字段（不依赖配对）；③明确记录 per-run 文件路径并让消费者
      可联结。⛔ 不接受「两个文件各写一半、谁也测不出 suite 时长」的现状。
      **⇒ 落地选项②**（`## Evidence` AC2）：`step-end` 一律自带 `durationMs`，12 组统一。
      ⛔ 明确**不采用选项①**：这 4 步是单发决策事件，补一个「写下去就立刻被配掉」的 begin 是
      给孤儿率看的样子，不是挂起检测（硬规则 4）——测试里有负控制钉住这条。
- [x] 修复后 ≥3 天的真实生产记录里，孤儿 `step-end` 占比 <5%（当前 29%），或
      suite 步骤时长可从载体直接算出（给出实际算出的中位/p90 读数）。
      **⇒ 走分支 2**：suite 时长中位 **312 s**、p90 **600 s**（09-04 → 09-14 生产载体，n=757）。
      **⚠️ 分支 1 明确【不成立】，且修复后仍不成立**——孤儿率仍是 29%，**这是设计不是残留**：
      这 4 步永远没有 begin，「孤儿率」这个指标对它们测的不是同一个问题。详见 `## Evidence` AC3。
- [x] 回写 `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §5 错误一：
      用修复后能拆开的真实读数，给出「端到端时长里 suite 占多少、排队占多少」的实际拆分。
      **⇒ 已回写**（§5 第二版 + §6 表格更正 + 附录锚点）：锁段内 **suite 80%**、其余 8 步 35%、
      剩余 ≈0；**锁外等待仍无载体**（诚实标注，已记进 §7 待补仪器）。
- [x] 更正 `tasks/gap-fan-in-step-trace-suite-step-stopped-writing.md` 的结论表述
      （它声称整体停写，与盘上实际不符），或在本任务体里说明为何不改它。
      **⇒ 已更正**：标题改为「…共享载体**一度**停写（已由 f4bab32c3 修复为双写；残留 = 只有
      end 没有 begin）」，正文顶部加 `## Correction (2026-09-14)` 并给出盘上实际计数。

## Definition of Done

读数取自**生产载体**，不接受 fixture：把注入 seam 关掉后，孤儿率与 suite 时长 AC 仍应成立。
修复后必须实际跑过 ≥3 天真实 fan-in 并给出落地后时间窗内的读数（硬规则 4 推论三：
实现了、测试绿了、但生产没跑过 ⇒ 与没实现同形）。

## Evidence

### AC1 — 写入点（文件:行号），以及「为何一半改了一半没改」

| 载体 | 写入者 | 位置 |
|---|---|---|
| 共享 `.quay/fan-in-step-trace.jsonl` | `step()` 的 begin + end | `plugin/scripts/worker-driver.ts:4311` / `:4314` |
| 共享 | `traceSuiteEvent()` 的 **只有 end** | `plugin/scripts/worker-driver.ts:4299` |
| 共享 | doc-check / scoped-gate 的第三方快路径、ff | `:4426` / `:4463` / `:4646` |
| per-run `.quay/fan-in-<task>-<runId>.log` | `trace()` = `appendFanInTrace(fanInLog, entry)` | `:4268` |

**「一半一半」不是一个疏忽，是两个提交各自的正确决策叠加出来的**：

1. `a5a301e03`（2026-08-28）把 4 个 suite 决策步的 trace 从共享载体改指到 per-run 日志（为了让
   web 详情页能点开单次 fan-in 的完整日志），**没有镜像回共享载体** ⇒ 08-28 → 09-04 共享载体上
   这 4 步 0 条（兄弟任务立案时的现场读数确实如此）。
2. `f4bab32c3`（2026-09-04）修复为**双写**，但共享那一半**刻意只写 `end`**——代码注释写明理由：
   「用 begin 会给挂起检测留下『begin 无 end』的假挂起」。
   **这个理由本身成立，但没有被追到下一步**：这 4 个 step **本来就没有 begin**（单发决策事件，
   不是区间），所以「用 begin/end 配对算时长」的读法对它们**恒返回「无数据」**，而「无数据」与
   「这一步不存在」同形（硬规则 3b）。
   ⇒ **孤儿不是「少写了一半」，是「配对」这个读法对这 4 个 step 不适用**。

### AC2 — 时长通道（选项②，不依赖配对）

`appendFanInStepTrace` 的每条 `step-end` 一律自带 `durationMs`，**12 个分组统一**（契约写在函数
文档注释里）；5 个写入点全部供给：`step()`（`:4314`）、`traceSuiteEvent()`（`:4299`）、
doc-check 第三方快路径（`:4426`）、scoped-gate 第三方快路径（`:4463`）、`ff`（`:4646`）。
共享载体用 `durationMs`、per-run 用 `wall_ms`——**各一个，⛔ 不互相复制**（同载体两个同义字段 =
漂移源）；`step()` 的 `durationMs` 与 per-run 的 `wall_ms` 用**同一个读数**（⛔ 不各算一次
`Date.now()`）。缺 `wall_ms` ⇒ `durationMs: null`（缺值 = 未查，不与 `0` 合流，硬规则 6/3b）。

**判别性对照（硬规则 4 推论四）** —— 同一个 step，两个读法给出**相反**结果：

```
配对读法： step-end[step=="suite-end"] 能配上 begin 的条数 = 0        ⇒ 「无数据」（旧的盲区）
直接读法： 同一条 step-end 的 durationMs          = 312,000 ms（中位）⇒ 有读数
```

测试 `AC2 负控制` 把这一对钉死：任一方向被改动（有人补 begin 去刷孤儿率 / 有人去掉 `durationMs`）
都会红。

### AC3 — 真实生产读数（生产载体，非 fixture）

窗口 09-04 → 09-14（该载体全历史），`.quay/fan-in-step-trace.jsonl` 12,556 行 ×
`.quay/fan-in-lock-events.jsonl` 配对出 **757** 次「同时有 suite 与锁段」的 fan-in：

| 量 | 载体字段 | 中位 | p90 | max |
|---|---|---|---|---|
| 锁段端到端 | lock-events 的 acquire→release | 382 s | 668 s | 1648 s |
| **suite** | `step-end[step=suite-end].durationMs` | **312 s** | **600 s** | 1462 s |
| 其余 8 步 | begin/end 配对之和 | 133 s | 205 s | 629 s |

**独立载体交叉核对（两个读法互校）**：`verification-round.jsonl`（09-04+，n=730）套件时长中位
**253 s** vs 本载体 suite 中位 **312 s**——同量级（差 19%），两读法不矛盾。（两者口径不同，
⛔ 不拿差值当结论，只用它证「没有互相矛盾」。）

**⚠️ 分支 1（孤儿率 <5%）明确不成立，且修复后仍不成立**：孤儿 `step-end` 仍是 2,150 / 7,353 =
**29%**。**这是设计，不是没修好**——这 4 步是单发决策事件，永远不会有 begin。所以本 AC 只能走
分支 2；而「孤儿率」这个指标对这批 step **测的不是同一个问题**（它测的是「配不配得上对」，而这
4 步的正确问题是「时长能不能直接读出来」）。

**⚠️ 修复后 ≥3 天窗口（DoD）本任务内结构上不可能取得**——它要求落地后 3 天的生产数据，任何实现
都无法在落地当天产出。因此上面这张表取自**修复前**的生产记录（字段名是 `wall_ms`，与 `durationMs`
**同一个写入者、同一个读数**，改名不改数值）。**落地后必须复取一次**，复取的锚点已写进文档附录；
它在字段层面唯一的变化是「12 组全部都有 `durationMs`」而不是「只有那 4 组有 `wall_ms`」。
⛔ 这条按「外部/延后验证」登记，**不冒充本轮已验**。

### AC4 — §5 错误一 已回写

`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md`：§5 增第二版（缺口拆开 =
**suite 占锁段 80%**、其余 8 步 35%、锁段内剩余 ≈0）⇒ 初稿「75% 以上是等待」**是错的，错的方向
是低估了 suite**；§6 表格那一行的旧表述（「suite 结构上不可测时长」）一并更正；附录加可复跑锚点。
**诚实标注仍量不出的那一半**：锁【外】等待（决定要跑 → 拿到锁）**没有任何载体记录**
（`fan-in-lock-events.jsonl` 只有 `acquire`/`release`，没有「开始等待」）⇒「排队占多少」目前
只能回答**锁段内 ≈ 0**，不能回答整段端到端。补法已记进 §7 待补仪器（给 `acquire-fan-in-lock`
写 begin/end——它是**真区间**，与那 4 个决策事件不同类）。

### AC5 — 兄弟任务结论已更正

`tasks/gap-fan-in-step-trace-suite-step-stopped-writing.md`：标题改为「…共享载体**一度**停写
（已由 f4bab32c3 修复为双写；残留 = 只有 end 没有 begin）」；正文顶部加
`## Correction (2026-09-14, by gap-fan-in-step-trace-suite-steps-write-end-without-begin)`，
给出盘上实际计数（`ac-precheck` 713 / `suite-start` 713 / `suite-end` 709 / `suite-skip` 15，
全部是 `step-end`）。其 AC1–AC4 与 DoD 结论**不变**——它们测的是「当时共享载体上看不到这批步骤」，
当时确实看不到。

### 取证纪律：本轮跑过的对照

| 对照 | 做法 | 结果 |
|---|---|---|
| 判据在修复前必须**红** | 前缀码互换：`git checkout -- plugin/scripts/worker-driver.ts` 后跑新测试 | **两条都红**（`ac-precheck carries its own durationMs` / `durationMs` 缺失），随后按 md5 `a866ad419b22b308a97009de1e4030fc` 换回 |
| 修复后必须**绿** | 同两条测试（`node --experimental-strip-types plugin/test/worker-driver-fan-in.test.mjs`） | **绿**：该文件 97 ✔ / 0 ✖ / exit 0；scoped 门内同样绿 |
| ⛔ **不刷指标** | 负控制断言这 4 步**没有** begin（有人补 begin 刷孤儿率 ⇒ 红） | 绿 |
| 注入 seam 关掉 | 全部读数取自 `.quay/*.jsonl` **生产**载体；测试跑的是真 `runMechanicalFanIn`，不是 fixture 注入 | 成立 |

### 本轮实际执行

- 实现提交：`5557a9535`（worktree `task/gap-fan-in-step-trace-suite-steps-write-end-without-begin`）
- scoped 门：`bash scripts/test.sh --for-task gap-fan-in-step-trace-suite-steps-write-end-without-begin --allow-thin`
  → **exit 0，194 pass / 0 fail**；新测试在门内确实被选中（按**测试名**确认，不是只看文件名）
- scoped-gate 缓存已写：`--develop-sha 866540f8d750589749b8668dbe83776aa51b3bea`（= 本 worktree
  实际 merge 的 develop tip）

### 已知残留（不在本任务范围，⛔ 不冒充已修）

- `tasks/gap-archguard-p5-instrument-decay-standing-guard.md`（:23/:42/:72）与
  `plugin/scripts/runner-static-gate.ts:1061` 的注释仍写「suite 相关步骤**停写**」——同样的陈旧
  表述。它们不在本任务 Touches 内，改它们会招 anti-drift 常驻红（`## Touches` 外改动），
  **故留给下一个触碰它们的任务**，在此显式登记而不是静默放过。
- `instrument-decay-check.ts` 的 MANIFEST `expected` 词表**不需要改**：它只判「分组在不在写」，
  本改动没有新增分组名，12 个分组一个不少。
