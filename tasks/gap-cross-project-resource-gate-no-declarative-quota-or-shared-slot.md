---
id: gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot
title: resource-gate.sh 只是宿主级只读建议门，不是跨项目准入——suiteLockBase 锚在各自
  .git，没有共享槛/声明式配额，两个项目的重活可能同时通过 GO 并同时起跑
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**背景**：2026-10-09，本仓库（quay）与 ClaudeCodeUI 项目的会话就"跨项目资源准入"做过一次协同确认。ClaudeCodeUI 侧核实并回复：他们**没有独立的 driver**——跑在其仓库上的就是 quay 自己的 `worker-driver.js`/promotion-driver 本身（装在 quay 插件安装位置），调用的是**同一份** `resource-gate.sh`、同一套 PSI（`/proc/pressure/cpu` some avg10）+ loadavg 判据。这个回复**本身是真实、已核实的**——不是本任务要质疑的点；本任务记录的是协同对话之后，进一步读代码发现的一个**机制层面**的缺口，跟 ClaudeCodeUI 那次回复的真实性无关。

**机制缺口（读代码确认）**：

1. `plugin/scripts/suite-lock-slots.ts` 头注释与 `suiteLockBase()` 实现：全量 suite 的单飞锁路径解析到 `git-common-dir → <root>/.git`——**锚在各自仓库自己的 `.git` 目录**。quay 与 ClaudeCodeUI 是两个不同的 git 仓库 ⇒ 它们各自的 single-flight 槛（`concurrentSuiteSlots()`，默认 1）**互不相通**：quay 内部"最多 N 个 suite 同时跑"的保证，不延伸到"quay + ClaudeCodeUI 加起来最多 N 个"。
2. `resource-gate.sh` 本身是**一次性、只读**的宿主级指标快照（PSI/loadavg/mem，GO/WAIT，退出即结束，不持有任何资源），**不是一个预留/互斥机制**。两个项目的 driver 可以在几乎同一时刻各自独立调用它、各自读到"宿主当前空闲 ⇒ GO"、然后都各自起一个重活（全量 suite）——因为这个检查只覆盖"起跑前的一瞬间"，不覆盖"对方几乎同时也要起跑"这个窗口。
3. 结论：当前**没有**真正跨仓库共享的槛（slot）或配额声明（quota declaration）——只有"两边碰巧读同一份宿主级指标快照"这个弱保证，不是用户想要的"Driver 声明配置 + 独立 Policy/Gate 判准 + 保留 global 安全上限"里"global 安全上限"这一项的完整实现。这不是任何一方的误用，是机制本身目前只做到"读",没做到"互斥/预留"。

## AC

- [ ] 复现实测（不是推理）：在本机构造两个不同的根目录（quay 自己 + 一个临时第三方 fixture 根，参照 `gap-driver-resource-gate-path-anchored-at-root-third-party` 任务里用过的手法），在宿主确认空闲的窗口内，几乎同时各自调用一次 `resource-gate.sh --for full-suite --json`，核实两者是否都返回 GO（预期都返回，因为当前没有互斥机制）。把两次调用的实际输出贴入任务体。
- [ ] 评估方向（不预设哪个对，先列选项再选，供 manager/人裁定）：
  ① 给 `resource-gate.sh` 加一个可选的跨进程文件锁（例如落在一个固定的、不随仓库变化的路径如 `~/.quay-global/resource-gate.lock`），把"检查宿主状态"与"预留一个起跑名额"合并成一次原子操作，短持有（只覆盖"检查+预留"这一瞬间，不覆盖整个 suite 运行期，否则退化成一个新的全局单飞锁、会把两个项目的重活完全串行化，这不是目标）；
  ② 维持现状，但把期望值订正为"这是软保护（基于共享宿主指标的弱协调），不是硬保证互斥"，写进 `resource-gate.sh` 的头注释或相关文档，不改代码。
  两个方向都要写出取舍依据——**按硬规则12（没有发生率数据就不能凭空设前置/立新机制），如果上面的复现测试显示"两边几乎同时起跑"这个场景实际发生率极低（例如两个项目的重活触发时间天然很少重叠），应倾向方向②，把这个当观察项而非阻塞项**；如果复现测试或历史数据显示确实有实际冲突发生过，再倾向方向①。
- [ ] 若选方向①：落地后用同一复现命令（两个根几乎同时调用）应观察到一个 GO、另一个因名额被占而 WAIT（或排队后 GO），把实测输出贴入任务体。
- [ ] 不论选哪个方向：`gap-driver-resource-gate-path-anchored-at-root-third-party`（done）的既有行为——第三方项目能从 kernel 安装位置解析到 `resource-gate.sh`——必须保持不变，其既有测试全部通过。

## DoD

必须先有复现证据，再决定方案；本任务允许的合法交付之一是"决定现状已经足够、只订正文档期望值、不改代码"（如果复现显示实际冲突窗口极小、发生率可忽略）。不得在没有复现证据的情况下直接假设需要方向①并动手写锁。

## Touches

- plugin/scripts/resource-gate.sh
- plugin/scripts/driver-shared.ts
- plugin/scripts/suite-lock-slots.ts
- tasks/gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot.md