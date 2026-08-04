---
id: gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger
title: ruling-required is the reason the blocked channel was built for, and it
  is the one reason --detect-stop cannot fire
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

[[gap-the-blocked-channel-has-a-writer-nobody-calls]] 已关闭，**交付是实的**：
`--detect-stop` 机械检测停止条件并自动写入，双向负控制齐全，测试从 16 例扩到 23 例全绿。
**本条不是否定它。**

**但外层核实时发现一处缺口**：`--detect-stop` 自动检测的是

| 条件 | 性质 |
|---|---|
| `merge-conflict`（`git ls-files -u`） | **结构性**，真停止条件 |
| `task-over-90m`（遥测 inProgress > 90m） | **年龄代理** |

而 **`ruling-required`**——枚举里明写 *any question the outer must rule on*——
**没有任何机械触发**：源码 `:60` 与 `:120` 明确它是 judgment 条件，
**只能靠 `--assert-blocked` 手动写入、且永不自动清除**。

### 这正是那 68 分钟对应的那个 reason

那次事故：内层停下等外层批准，**68 分钟**。按现在的实现：

- `merge-conflict`：不适用（没有冲突）；
- `task-over-90m`：**在第 90 分钟才触发** ⇒ **比事故实际被解决晚 22 分钟**；
- `ruling-required`：**需要内层记得手动写** ⇒ **正是原任务判定「行不通」的那条路径**。

**⇒ 为那次事故建的机制，抓不住那次事故。**

**而原任务的 AC1 文本写的是**「内层进入**停下等外层**这个状态时自动产生」，
**它被勾上了，但实现满足的是一个更弱的性质**：
**检测两个与「停下等外层」相关但不等价的条件。**

### 值得记住的形态（今晚第二次）

**一条 AC 的文本跨度大于实现，于是它在「已实现的那部分」上被勾上。**
今晚第一次是 `gap-the-dod-gate-encodes-a-retired-task-shape` 的 AC6
（「41 个全部可过闸、ready 队列不再为 0」被勾上，而它自己贴出的输出显示 `DIR-082` 仍不过闸）。

**⇒ 判据的写法要么收窄到实现能覆盖的范围，要么在勾选时标出未覆盖的部分。**
**两次都不是执行者不诚实——两次的实跑输出都原样贴着，缺口都是外层读输出才发现的。**

## Contract

```
measure ruling_required_auto_fires = `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --root <fixture>` 在「内层停下等裁定」夹具下自动写出 reason=ruling-required 的次数字段
measure detection_latency_min = `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --root <fixture>` 从内层停止推进到文件产生的分钟数字段
band ruling_required_auto_fires = >0
invariant 停下等裁定必须由内层已在做的动作触发，不依赖它额外记得
invoke `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop`
control 内层停下等裁定 ⇒ 自动写出且 latency 远小于 90 分钟；内层正常长跑 ⇒ 不得写出
resume 先找出「停下等裁定」有没有可机械观测的痕迹，再决定触发点
```

## Chosen mechanism

**第一步是找痕迹，不是加条件。**

「停下等裁定」与「在攻难题」的区别，**必须有某处可机械观测**才谈得上触发。候选：

1. **内层向外层发问这个动作本身**——它已经在做（写进 pane / 发消息），
   **触发点应当挂在这个动作上**，而不是要求它之后再记得跑一条命令；
2. **会话 transcript 停止前进**——`session-liveness` 已在读它（心跳源）；
   **「transcript 不动 + 任务仍 in-progress + 工作树干净」** 三者合取，
   比单看任务年龄精确得多，**且延迟可以远小于 90 分钟**；
3. **停止推进时必然发生的某个状态写入**（若存在）。

**不做**：不把 `task-over-90m` 的阈值调小当作解决（**那是把代理调灵敏，不是换成结构信号**，
且会把正常长跑误报——今晚 e2e 正常跑了 78 分钟）；
不要求内层「记得」调用（**原任务已证明这条路行不通**）；
不退回轮询启发式（AC9c 已经在做，那次仍然是 68 分钟）。

## Acceptance Criteria

- [x] AC1: **痕迹先落定**——「停下等裁定」在哪一处可机械观测，给出证据；
      **若找不到，如实写明并说明为什么**，本条转为「已知不可机械检测」而非硬凑一个代理
- [x] AC2: **自动触发**——夹具中内层停下等裁定 ⇒ **自动**写出 `reason=ruling-required`（实跑贴出）
- [x] AC3: **延迟可判**——记录 `detection_latency_min`，**必须远小于 90 分钟**（数字贴出）
- [x] AC4: **反向负控制**——内层**正常长跑**（如 78 分钟的真实任务）⇒ **不得写出**（实跑贴出）。
      **这条不过，AC2 不算数**——**把「抓不到」修成「总在报」是更坏的交易**
- [x] AC5: **不破坏既有两条**——`merge-conflict` 与 `task-over-90m` 的既有行为不变（实跑对照）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`

## Evidence

### AC1 — 痕迹核实（三个候选逐个查证，非直接采信「找到了」）

**候选 1（内层发问这个动作本身）——查证结果：不可用，重演同一失败模式。**
`docs/analysis/batch2-queue-state.md:1601` 记录那次 68 分钟事故的实际形态：
「内层把阻塞写进了 tick 文本、外层读 worktree 时间戳、最后靠人搭桥」——那是**自由散文**，没有稳定
schema，不能被机械解析。仓库里唯一现成的「结构化」候选是 `plugin/scripts/inner-idle-log.ts` 的
`awaiting-ruling` reason（`--append --reason awaiting-ruling`）——但它与 `--assert-blocked` **同形**：
都要求内层「记得」调用一条命令。`plugin/loop/fast-mode-loop-tick.md:340-342` 已经明写这条失败模式的
判决：「写、读、以及本文件早先『记得调 `--assert-blocked`』的指令都在，而 `.quay/inner-blocked.json`
全历史 0 次写入……**再加一条文档指令不会有用**」——`inner-idle-log.ts` 会重演一模一样的结果。

**候选 2（transcript 停止前进 + 任务仍 inProgress + 工作树干净）——查证结果：真实存在，且三个子信号
都已是生产环境在用的机械观测，不需要内层新增任何配合：**
- transcript mtime：`plugin/scripts/session-liveness.sh` 的 `heartbeat_mtime()`（含 `<id>/subagents/`
  子目录取 max mtime，因为内层派 subagent 时主 transcript 会静默）已经在四个真实项目上跑；
  `plugin/scripts/inner-forensics.mjs` 的 `transcriptSet()` 是同一手法的第二个独立实现。
- 任务 inProgress：`plugin/scripts/fast-mode-telemetry.ts` 的 `aggregate()` 读同一份
  `.workflow-events/`——`task-over-90m` 检测器已经在用它，本任务原样复用，没有引入第二份遥测源。
- 工作树干净：`git status --porcelain`，`plugin/scripts/task-status-drift-check.ts:348` 已有先例。

**已知局限（如实写明，不是回避）：**
1. **这是形状代理，不是内容读取**——检测的是「停下」这个**形状**（transcript 静默 + 任务挂起 +
   无待提交改动），**不读问题文本本身**。这与 `task-over-90m` 的年龄代理性质相同，现在对
   `ruling-required` 也显式承认，不再含糊。
2. `--transcript <path>` 是**显式配置，绝不猜测**（与 `session-liveness.sh` 的 `SESSION_TRANSCRIPTS`
   同一原则——pid/会话 → 文件的映射不可靠地推断）。本任务 Touches 只覆盖
   `inner-blocked-signal.ts` 本体；把它接进 `fast-mode-loop-tick.md` 的生产调用（内层在自己的 tick
   里把自己的 transcript 路径传给 `--detect-stop`）是**范围外的后续接线工作**，本任务未做、未声称做。
3. 30 分钟阈值（`RULING_REQUIRED_STALL_MS`）**复用** `session-liveness.sh` 的 `OVERDUE_MIN=30`
   校准，不是新发明的数字——该文件记录的唯一一次实测真实长任务最大静默间隙是 **20.5 分钟**，30
   分钟留 ~9.5 分钟余量，与该文件自己的权衡完全一致（AC4 的证据见下）。

**候选 3（停止推进时必然发生的某个状态写入）——查证结果：未找到独立于候选 2 的第三类痕迹**；
候选 2 的「transcript 停写」本身已经是这一类信号里能拿到的最直接形式。

**⇒ AC1 结论：找到了机械可观测的痕迹（候选 2），已实现为 `detectRulingRequiredStall()`
（`plugin/scripts/inner-blocked-signal.ts`），不是「找不到」。**

### AC2/AC3 — 自动触发 + 延迟（实跑）

夹具：干净 git 工作区（含 `.gitignore` 忽略 `.workflow-events/`）+ 一条遥测 start 事件回填 35 分钟前
（`gap-ruling-demo`）+ 一份 transcript 文件 mtime 也回填 35 分钟前，工作树无未提交改动：

```
$ node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts \
    --root <fixture> --detect-stop --transcript <fixture>/transcript.jsonl
detect-stop: STOP CONDITION — ruling-required (auto-block written) — <fixture>/.quay/inner-blocked.json

$ cat <fixture>/.quay/inner-blocked.json
{
  "since": 1785835809300,
  "taskId": "gap-ruling-demo",
  "reason": "ruling-required",
  "question": "transcript has not advanced in 35.0m while task gap-ruling-demo is in-progress and the working tree is clean — likely stopped waiting on a ruling; rule on it, then run --clear",
  "source": "auto",
  "evidence": [
    "transcript heartbeat stale 35.0m (threshold 30m)",
    "gap-ruling-demo in-progress since 2026-08-04T08:55:08.819Z",
    "working tree clean (git status --porcelain empty)"
  ]
}
```

`ruling_required_auto_fires` = 1（次），`reason=ruling-required` 确认自动写出，`source: "auto"`
（不是手动 assert）。

**AC3 — detection_latency_min（实测数字）：**
```
latency_min = (record.since − transcript_mtime) / 60000 = 35.01
```
**35.01 分钟，远小于 90 分钟**——比 `task-over-90m` 早 ~55 分钟捕获同一形状的停止（生产环境的
端到端延迟还叠加 tick 调用间隔，`fast-mode-loop-tick.md` 记录的固定间隔是 25 分钟，最坏情形
`30+25=55` 分钟，仍远小于 90 分钟；本任务 Touches 不包含把 `--transcript` 接进该 tick 调用，见
AC1 局限 2）。

### AC4 — 反向负控制（两个独立实跑，均不得写出）

**负控制 1（复原生产环境真实假阳性的形状）**：任务 inProgress **78 分钟**（与
`docs/analysis/batch2-queue-state.md` 2026-08-04 01:22Z 记录的真实数字一致——那次正是纯「提交
年龄 + 干净树」判据 `AC9c` 命中、需要人读 pane 才排除的假阳性），工作树干净，但 transcript
**2 分钟前**才写过（对应那次事故里 pane 读到的「agent 仍在活跃回合」）：

```
$ node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts \
    --root <fixture2> --detect-stop --transcript <fixture2>/transcript.jsonl
detect-stop: no stop condition; no block
```
`.quay/inner-blocked.json` 未产生。**这正是 `AC9c` 命中过的假阳性形状，transcript 新鲜这一维把它
正确排除——不需要人读 pane。**

**负控制 2（真实时间因果，非回填时间戳）**：其余测试都用回填 mtime 证明逻辑（与既有
`task-over-90m` 测试同一手法——没人会真等 90 分钟）；这一条额外用**压缩但真实**的阈值
（`INNER_BLOCKED_RULING_STALL_MS=1200`，1.2 秒）证明时间因果是真的，不是单个伪造时刻：

```
=== 阶段一：真实活跃（每 300ms 真实 touch 一次 transcript，持续 ~2 真实秒） ===
detect-stop: no stop condition; no block
detect-stop: no stop condition; no block
detect-stop: no stop condition; no block
block after active phase? no-correct

=== 阶段二：活动真正停止；真实 sleep 越过（压缩后的）阈值 ===
detect-stop: STOP CONDITION — ruling-required (auto-block written) — <fixture3>/.quay/inner-blocked.json
```
持续的真实活动**从未**触发；活动真正停止、真实时间越过阈值后**立即**触发。

### AC5 — 既有两条不受影响（实跑对照）

不传 `--transcript` 时，`merge-conflict` 路径与之前逐字节相同：
```
$ node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --root <conflict-fixture> --detect-stop
detect-stop: STOP CONDITION — merge-conflict (auto-block written) — <conflict-fixture>/.quay/inner-blocked.json
```
`task-over-90m` 路径未改动一行（`detectStopConditions` 里该检测器的调用与产出不变，见
`plugin/scripts/inner-blocked-signal.ts` 里 23 条既有测试全部保持绿——见下方测试运行记录）。
另有专门测试 `AC5 — --detect-stop without --transcript is byte-for-behavior unchanged`
锁定「不传 `--transcript` 时新检测器绝不参与判定」这一不变量。

### AC6 — 测试框架

`plugin/test/inner-blocked-signal.test.mjs` 文件头已声明 `// @test-group governance`
（第 1 行）且全篇 `import { test } from "node:test"`（不在 legacy 豁免名单里，本来就不需要）；
本任务新增的 8 个测试写在同一文件，继承同一声明，未新建文件。

### 测试运行记录（`scripts/test.sh` 的 canonical glob 阻塞于一个与本任务无关的既存问题——见下）

`bash scripts/test.sh plugin/test/inner-blocked-signal.test.mjs` 在本 worktree 里先跑仓库级静态
检查（`## Contract consumer check`），该检查在**未被本任务触碰的另外三个任务文件**
（`gap-no-inventory-of-what-the-two-layer-mode-actually-runs.md` /
`gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files.md` /
`gap-serve-task-list-dies-on-one-malformed-task.md`）上报出 6 条既存 violation（ratchet ceiling 5,
new 1）——这在一个刚从 `master` 分出、未改动这些文件的干净 worktree 上同样复现，确认是**派发前
已存在、与本任务无关**的仓库状态（`orchestration/tick-log.md` 里也已经记录这条正在被跟进）。
不在本任务 Touches 范围内，未修。因此本任务的直接验证证据是 `node --test`（同一文件，同样是
`scripts/test.sh` 最终会跑的那批测试）：

```
$ node --no-warnings --experimental-strip-types --test plugin/test/inner-blocked-signal.test.mjs
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
连跑两次，均 `pass 31 / fail 0 / cancelled 0`（23 条既有测试字节不变地保留 + 8 条新测试）。

## Definition of Done

- [x] AC2 与 AC4 两个方向的实跑输出都贴进任务体（见上方 Evidence）
- [x] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）——batch fan-in 套件核验：
      2026-08-04 全量套件 **tests 2227 / pass 2203 / fail 0 / cancelled 0 / skipped 24**（一次批套件，
      即 fan-in 的完整套件验证点；加上本文件 `node --test` 连跑 2 次 `pass 31 / fail 0 / cancelled 0`）。
      此前任务体内的 Contract-check 既存违规已随 `gap-contract-ratchet` 修复消除，不再阻塞
- [x] 任务体记录：**为那次事故建的机制抓不住那次事故**——
      `task-over-90m` 会在第 90 分钟触发，**比事故实际被解决晚 22 分钟**（见 Proposal 一节
      「这正是那 68 分钟对应的那个 reason」，本任务的机制把同一形状的捕获延迟从 90 分钟降到
      ~35-55 分钟，见 AC3）

## Touches

- plugin/scripts/inner-blocked-signal.ts
- plugin/test/inner-blocked-signal.test.mjs

## Dispatch review
reviewer: outer
at: 2026-08-04T01:45:00Z
changed: **不重开** [[gap-the-blocked-channel-has-a-writer-nobody-calls]]——
它的交付是实的（机械触发、双向负控制、23 例全绿），**且它把全量套件未跑如实标了 `[ ]`
并写明是外层的派发指令禁止的**。**新建本条承接未覆盖的那一条件。**
**核实过程**：`--detect-stop` 自动检测 `merge-conflict`（结构性）与 `task-over-90m`（年龄代理），
而 `ruling-required`（枚举里明写 *any question the outer must rule on*）
**源码 `:60`/`:120` 明确是 judgment 条件、只能手动 `--assert-blocked`**
⇒ **那 68 分钟只会在第 90 分钟被抓到，晚于它实际被解决 22 分钟。**
**AC1 要求先找痕迹再加触发**，并**允许「找不到」作为合法结论**——
硬凑一个代理会重演 `task-over-90m` 的问题。
**并预先堵死最省事的错误修法**：**不许把 90 分钟阈值调小**——
那是把代理调灵敏而非换成结构信号，且会误报正常长跑（今晚 e2e 正常跑了 78 分钟）。
**排序如实说明**：本条**不在门槛的四条断言与十条缺陷清单内**
⇒ 按管理者 01:05Z 的裁定，**排在那六条之后**。
