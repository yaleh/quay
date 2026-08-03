---
id: gap-dispatch-gate-has-no-checklist-and-no-trace
title: Give the task body a machine-readable contract between goal and code —
  the pre-dispatch review is a habit with no checklist and no trace
status: done
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

**把闸口那五个问题从「口头问」变成「任务创建时写下的、机器能消费的声明」。两者不并存。**

### 为什么必须是机器能消费的（实测依据）

任务体各段落被脚本引用的实际情况（2026-08-03 实测）：

| 段落 | 引用脚本数 | **内容**被消费吗 | 今晚漂移过吗 |
|---|---|---|---|
| `## Touches` | 24 | **是**——解析成路径，驱动并发资格与测试选择 | **否** |
| `## Acceptance Criteria` | 14 | 否，只数勾选框 | 是 |
| `## Proposal` | 14 | 否，只验存在与长度 | 是 |
| `## Chosen mechanism` | 4 | 否，只验存在 | 是 |

**唯一内容真正驱动决策的字段，也是唯一没漂移的字段。** 结论直接可用：

> **一个没有读者的字段，就是带标题的散文。**

因此本任务不新增散文段落。新增的每一个键都必须指名它的消费者，且消费者读的是**内容**。

### 这在双层机制下是核心而非润色

quay 交付的是双层机制，**内层没有人可以澄清歧义**——任务体就是全部的规格交接。
在人驱动单会话模式下，含糊的一句话由人在对话里当场补齐；这里没有那个人。
散文的不确定性在这个模式下是直接成本，今晚四次闸口介入就是这笔成本的账单。

### 一、`## Contract`——目标与代码之间的中间层

六个键，**每个都能指回今天一次真实介入**，不预先扩充（ADR-021：证据不足不要把策略机械化）：

```
## Contract

measure   suite_wall  = `scripts/test.sh` stdout 的 duration_ms 字段   # 单次墙钟，非 Σ 每文件
band      noise       = 20000..63000 ms                                # 实测基线
invariant selected_files = 2296                                        # 变了则差异不可归因
invoke    `scripts/test.sh --test-concurrency=4`                       # 必须 `=`；空格形式走另一分支
control   把并发改回 8 ⇒ AC2 必须不成立
resume    每跑完一次即写盘                                              # 中断保全
```

| 键 | 来自今天哪次介入 | 不写会怎样 |
|---|---|---|
| `measure` | `duration_ms` 被当成 Σ 每文件耗时 | 六次跑带着同一个错误口径 |
| `band` | 20–63s 噪声带 | 阈值声明没有分母，差异无法判显著 |
| `invariant` | `selected N files` 必须一致 | 变量不止一个，归因不了 |
| `invoke` | `=` vs 空格拼写 | 静默走进另一条代码路径 |
| `control` | 否掉「`--check` 前先 `--sync-dist`」 | 修法让检查永不失败＝掩盖 |
| `resume` | 增量写盘 | 触到 90 分钟阈值即整批作废 |

**`n/a: <理由>` 是每个键的合法值；留白不是。** 留白与「没想过」不可区分——
这和 `reviewer: none` 是同一条原则。

### 二、消费者（这是本任务的实质，不是格式）

一个检查脚本，读**内容**：

| 检查 | 拦住的是 |
|---|---|
| AC 里出现阈值/数字 ⇒ 必须引用一个已声明的 `measure` 或 `band` 名 | 「对照噪声带宽判定」不说是哪个字段 |
| 每条 `measure` 必须同时含**命令**（反引号）与**字段名** | 「用 duration_ms」不说哪个命令产出 |
| 每条 `invoke` 必须是反引号命令；任务完成时贴回的证据里必须**逐字**出现该串 | 拼写漂移 |
| `labels: defect` 的任务必须有 `control` | 「在检查前修好被检对象」这一类 |
| 键存在但值为空 ⇒ 报出（`n/a: 理由` 不报） | 留白与「没想过」不可区分 |

**报出而不阻断**（初期）——与 [[gap-test-isolation-contract-is-unwritten]] 同款棘轮：违规名单只能变短。
**匹配必须按代码/字段位置，不按文本**：今晚有 7 次「匹配到提到它的注释而非它本身」的教训。

### 三、过闸留痕

`## Contract` 承载「审查问了什么」，留痕只需承载「谁审的、改了什么」：

```
## Dispatch review
reviewer: outer | none
at: <ISO>
changed: <外层要求的改动，逐条；无则写「无」>
```

清单项**不再在这里重复**——它们在 `## Contract` 里，且有消费者。
`reviewer: none` 仍是合法值：不是每个任务都需要过闸，但「没过闸」必须是被记录的选择。

**不做**：不引入审查 agent、不加轮次、不阻断派发、不恢复 prepare 管线。
这是一个可机器消费的声明块加一条记录——**如果它变成第五段散文，它就失败了**，
AC4 的回填验证正是为了在早期发现这一点。

## Contract

```
# 本任务自己的 Contract——六个键描述本机制本身（Contract 语法 + Dispatch review + 消费者检查器）。
measure  violation_count = `node --experimental-strip-types plugin/scripts/task-contract-check.ts` 的 violations 数
band     ratchet_ok      = 违规名单只减不增（数据文件 docs/analysis/contract-violations.md）
invariant six_keys       = measure|band|invariant|invoke|control|resume，每个都能指回一次真实介入
invoke   `node --experimental-strip-types plugin/scripts/task-contract-check.ts --root <repo>`
control  人为构造违规任务 ⇒ 检查器必须报（AC5 fixture，不只在存量上验证）
resume   回填的 ## Contract 块与 AC5/AC6 输出贴进任务体（DoD）
```

## Dispatch review

reviewer: none
at: 2026-08-03T00:00:00Z
changed: 无（本任务建立该机制本身；它的派发没有经过正式闸口审查——这正是 `reviewer: none` 是被记录的选择）

## Acceptance Criteria

- [x] AC1: `## Contract` 六个键（`measure`/`band`/`invariant`/`invoke`/`control`/`resume`）的语法定义
      写进 `task-schema.ts`（模板即 schema）；`n/a: <理由>` 是每个键的合法值，留白不是
- [x] AC2: 检查脚本（`plugin/scripts/task-contract-check.ts`）实现「二、消费者」表中的五条判定，
      **读内容不只验存在**；按代码/字段位置匹配（declared name / field token），剥离注释与字符串字面量
- [x] AC3: `## Dispatch review` 段落格式定义（`reviewer: outer|none` / `at: <ISO>` / `changed: <逐条|无>`）；
      `reviewer: none` 是合法值；缺段则报出（**不阻断**）
- [x] AC4: 用今天四个真实案例回填：`4vs8`、`M243` 语料修复、`M136` 第三轮、`blocked-signal`。
      每个都写完整 `## Contract` 块 + `## Dispatch review`，并逐个说明当时那次介入对应哪个键。
      **没有任何一次介入无法用这六个键表达 ⇒ 无清单缺项**（见下方「AC4 回填」）
- [x] AC5: 用人为构造的违规任务演示检查器确实会报（`plugin/test/task-contract-check.test.mjs` 的
      `VIOLATING_TASK` fixture）——至少覆盖「AC 有阈值但无 measure」（`ac-threshold-no-measure-ref`）
      与「measure 缺命令」（`measure-no-command`）两种（见下方「AC5 演示」）
- [x] AC6: 在当前 `tasks/` 全量实跑，输出违规清单；违规名单是数据文件
      （`docs/analysis/contract-violations.md`），**只能变短**（见下方「AC6 违规清单」）
- [x] AC7: 明确记录**不做**的事：不引入审查 agent、不加轮次、不阻断派发、不恢复 prepare 管线
      （见下方「AC7 不做清单」）
- [x] AC8: 测试带 `// @test-group engine` 声明（`plugin/test/task-contract-check.test.mjs` 首行）

## Definition of Done

- [x] AC4 的四个回填 `## Contract` 块与 AC5 的演示输出贴进任务体（见下方）
- [x] `scripts/test.sh --for-task gap-dispatch-gate-has-no-checklist-and-no-trace` 绿（task-schema 22 +
      task-contract-check 30；全量由外层 fan-in 负责）
- [x] 明确记录：**唯一内容被消费的字段 `## Touches` 是唯一没漂移的字段**——新增的每个键都有真读它的
      消费者（`task-contract-check.ts`）；没有读者的字段就是带标题的散文
- [x] 明确记录：**闸口现在拦住的东西里有一半靠外层碰巧知道**——把「碰巧」变成「写下来时就被问到」，
      是这个中间层唯一的目的

## AC4 回填（四个真实案例）

四次介入、四个案例，**每个都能用这六个键表达，无清单缺项**：

| 案例 | 介入 | 表达为 |
|---|---|---|
| `4vs8`（`gap-suite-concurrency-4-vs-8-measurement`） | 6 次运行 `selected N files` 必须一致 | `invariant selected_files = 163` |
| `4vs8` | 只用 `=` 拼写，空格形式走 explicit-file 分支 | `invoke \`scripts/test.sh --test-concurrency=4\`` |
| `4vs8` | `duration_ms` 就是墙钟本身，非 Σ 每文件 | `measure suite_wall` + `band noise = 20–63s` |
| `4vs8` | 每跑完一次即增量写盘 | `resume` |
| `4vs8` | 并发度是唯一变量，其余钉死 | `control 把并发改回 8 ⇒ 判定必须不成立` |
| `M243` 语料修复（`gap-sync-vendor-drift-mislabelled-as-task-schema`） | 否掉「`--check` 前先 `--sync-dist`」 | `control --check 必须只读` |
| `M136` 第三轮（同上任务） | 消除干扰源，5 个写共享路径的文件一个都不必须 | `invariant shared_dist` + `control 改脏 vendor ⇒ 全量必红` |
| `blocked-signal`（`gap-no-explicit-blocked-signal-from-inner-layer`） | 演练必须写临时 `--root`，不得污染真实遥测 | `control` |
| `blocked-signal` | 基线数以文本记任务体，不留在遥测存储 | `resume` |

四个任务体已各自写入完整的 `## Contract` 块 + `## Dispatch review` 段（见 `## Touches` 之外的回填文件）。
**结论：六个键足够表达全部介入——不需要加第七个键，也没有硬塞。**

## AC5 演示（人为构造的违规任务）

`plugin/test/task-contract-check.test.mjs` 的 `VIOLATING_TASK` fixture（`status: todo`、`labels: [gap, defect]`）构造了
一个 `measure = 20000..63000`（无命令、无名字）、`invoke scripts/test.sh`（无反引号）、AC 含「20–63s 噪声带宽」、
defect 无 `control`、无 `## Dispatch review` 的任务。检查器对其报出 **7 条违规**：

```
VIOLATION: tasks/t-bad.md — contract-measure-no-name: "measure" must declare a NAME ...
VIOLATION: tasks/t-bad.md — contract-invoke-not-command: "invoke" must be a backtick command ...
VIOLATION: tasks/t-bad.md — measure-no-command: measure "measure = 20000..63000" has no backtick command ...
VIOLATION: tasks/t-bad.md — ac-threshold-no-measure-ref: AC mentions a threshold/band but references none ...
VIOLATION: tasks/t-bad.md — invoke-not-command: invoke must be a backtick command ...
VIOLATION: tasks/t-bad.md — defect-no-control: task is labelled `defect` but ## Contract has no `control` key ...
VIOLATION: tasks/t-bad.md — dispatch-review-missing: no '## Dispatch review' section ...
```

同时测试**退出码仍是 0**（`CLI: violating workspace → exit 0`）——报出而不阻断（AC7）。反向演示：`CLEAN_TASK`
fixture（合法六键 + 引用 `band noise` + 合法 Dispatch review）报 **0 条**违规。

## AC6 违规清单（数据文件，只能变短）

全量实跑 `node --experimental-strip-types plugin/scripts/task-contract-check.ts --root <repo>` 的初始基线：
**1 条违规**——`tasks/gap-no-resource-awareness-heavy-ops-run-blind.md: dispatch-review-missing`（该在飞任务已
opt-in 了 `## Contract`，但尚无 `## Dispatch review` 段；待其正式派发、记录审查后该条目即被移除）。

基线写入 `docs/analysis/contract-violations.md`（`# baseline-count: 1`）。检查器对**新增**违规退出 1
（名单只减不增）；`--write-ratchet` 在名单收缩后刷新文件、拒绝膨胀。

## 对抗审查记录（REFUTE，2026-08-03）

轮 1（独立审查 agent）找到 **2 must-fix + 4 minor**，全部已修复并加测试；轮 2 同步复验通过：

- **R1（must-fix）**：`n/a:` 空理由在 `invoke`/`control`/`resume` 上被静默接受（`n/a: <理由>` 合法、留白不是 的
  不变量被破坏）。修法：`parseContract` 的 NA 分支改为 `n/a\s*[:：]?\s*(.*)`，空理由 → `contract-empty-value`。
- **R2（must-fix）**：注释剥离 `\s+#.*$` 不认反引号跨度，`measure x = \`echo a # b\` 的 y 字段` 的值被截断。
  修法：`stripCommentOutsideBackticks()` 只在非反引号段剥离 `#` 注释。
- **MINOR1**：`checkDispatchReview` 现在校验 `reviewer ∈ {outer,none,human,inner}`、`at:` 形如 `YYYY-MM-DD`。
- **MINOR2**：显式 `<task-file>` 子集扫描跳过 ratchet 比较（否则把基线外条目误报成 `resolved`）。
- **MINOR3**：随 R1 修复——裸 `measure n/a:` 现在报 `contract-empty-value` 而非错位的 `measure-no-name`。
- **MINOR4**：从 `measureRefTokens` 移除过泛的 CJK 词「值」（避免幸运命中）。

轮 2 复验：`node --test plugin/test/task-contract-check.test.mjs` → 35 tests / 34 pass / 0 fail（1 opt-in skip）；
`node --test experiments/quay-perpetual-stream/test/task-schema.test.mjs` → 22/22 pass；全量 store 扫描仍恰 1 条
基线违规（`gap-no-resource-awareness-heavy-ops-run-blind.md: dispatch-review-missing`），exit 0、`new since baseline: 0`。
R1/R2/MINOR1 逐一复验输出见上（`n/a:` 空理由 → `contract-empty-value`；`# b` 保留；`reviewer: me` → malformed）。

## AC7 不做清单

- **不引入审查 agent**——这是一个可机器消费的声明块加一条记录，不是把人换成另一个模型
- **不加轮次**——没有 ProposalReview / PlanCheck 式的多轮收敛
- **不阻断派发**——报出而不阻断；阻断会让人为了通过而敷衍填写（`reviewer: none` 合法即为此）
- **不恢复 prepare 管线**——不是把被绕开的 prepare 换个名字装回来；没有 preparation.json /
  proposal-ledger.json 这类账本

**判据：如果 `## Contract` 变成第五段散文（没有真读它的消费者），它就失败了。** AC4 的回填验证 +
`task-contract-check.ts` 的五条消费者判定 + AC6 的只减不增名单，是让这个中间层保持「机器能消费」的三重保险。

## Touches

- plugin/scripts/task-schema.ts
- plugin/scripts/task-contract-check.ts
- plugin/test/task-contract-check.test.mjs
- docs/analysis/fast-mode-loop-tick.md
- orchestration/orchestrator-loop-tick.md
