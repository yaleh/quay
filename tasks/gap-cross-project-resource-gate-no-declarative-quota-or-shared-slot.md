---
id: gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot
title: resource-gate.sh 只是宿主级只读建议门，不是跨项目准入——suiteLockBase 锚在各自
  .git，没有共享槛/声明式配额，两个项目的重活可能同时通过 GO 并同时起跑
status: ready
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

**范围调整（人 2026-10-09 裁定，见 DIR-132）**：本任务原方案①（给 resource-gate.sh 加跨进程文件锁，统一跨项目准入）**降为非优先**——人的新裁定把 Quay/ClaudeCodeUI 在低算力环境（2/4/8 vCPU、内存受限、cgroup 受限）下的单项目独立测试稳定性/性能列为优先项，跨项目协调整体降级为可选、显式启用的宿主层。本任务后续的交付重心改为：①验证/保证当前机制（resource-gate.sh 的只读快照 GO/WAIT）在跨项目配置完全缺失时依然正确、完全独立工作，不写死任何路径、不假定第二个仓库存在（这本来就应该是现状，但要用复现实测确认，不能只靠读代码推断）；②把原方案①的跨进程锁设计保留作为**观察项**而非阻塞项——按硬规则12，没有实际竞态发生率数据之前不强行立新机制。

## AC

- [ ] 复现实测（不是推理）：在本机构造两个不同的根目录（quay 自己 + 一个临时第三方 fixture 根，参照 `gap-driver-resource-gate-path-anchored-at-root-third-party` 任务里用过的手法），在宿主确认空闲的窗口内，几乎同时各自调用一次 `resource-gate.sh --for full-suite --json`，核实两者是否都返回 GO（预期都返回，因为当前没有互斥机制）。把两次调用的实际输出贴入任务体。
- [ ] 评估方向（不预设哪个对，先列选项再选，供 manager/人裁定）：
  ① 给 `resource-gate.sh` 加一个可选的跨进程文件锁（例如落在一个固定的、不随仓库变化的路径如 `~/.quay-global/resource-gate.lock`），把"检查宿主状态"与"预留一个起跑名额"合并成一次原子操作，短持有（只覆盖"检查+预留"这一瞬间，不覆盖整个 suite 运行期，否则退化成一个新的全局单飞锁、会把两个项目的重活完全串行化，这不是目标）；
  ② 维持现状，但把期望值订正为"这是软保护（基于共享宿主指标的弱协调），不是硬保证互斥"，写进 `resource-gate.sh` 的头注释或相关文档，不改代码。
  两个方向都要写出取舍依据——**按硬规则12（没有发生率数据就不能凭空设前置/立新机制），如果上面的复现测试显示"两边几乎同时起跑"这个场景实际发生率极低（例如两个项目的重活触发时间天然很少重叠），应倾向方向②，把这个当观察项而非阻塞项**；如果复现测试或历史数据显示确实有实际冲突发生过，再倾向方向①。
- [ ] 把「两个根几乎同时调用同一复现命令」这一场景，以及它在**方向①被采纳时**的预期（一个 GO、另一个因名额被占而 WAIT，或排队后 GO），写成**观察项**记入任务体；并贴出**当前无锁状态下**同一命令两次调用都返回 GO 的实测输出，作为「今天确实没有互斥」的基线证据。（DIR-132 已裁定①不在本任务范围内实现，见本 `## AC` 末条——⛔ 本任务不实现锁；本 AC 的交付物是**记录 + 基线读数**，不是对锁的验证。）
- [ ] 不论选哪个方向：`gap-driver-resource-gate-path-anchored-at-root-third-party`（done）的既有行为——第三方项目能从 kernel 安装位置解析到 `resource-gate.sh`——必须保持不变，其既有测试全部通过。
- [ ] **新增（DIR-132 范围调整）**：复现实测确认 resource-gate.sh / suiteLockBase() 在完全没有 ClaudeCodeUI（或任何第二个项目）存在、且调用方根目录是一个全新临时目录（无 `.quay/config.yml`、无 `plugin/`）时，仍能正确运作（fail-closed 报错或走 QUAY_PLUGIN_ROOT 解析到 kernel 位置，不崩溃、不因为假定了一个不存在的第二仓库而出错）。贴实测命令与输出。
- [ ] **新增（DIR-132 范围调整）**：原方案①（跨进程文件锁）保持为本任务体里记录的观察项，不在本任务范围内实现；若后续有实际竞态发生的证据（而不是理论推演），再由新任务或本任务的后续修订立案实现，本任务现在不得因为"方便"就顺手把锁加上。

## DoD

必须先有复现证据，再决定方案；本任务允许的合法交付之一是"决定现状已经足够、只订正文档期望值、不改代码"（如果复现显示实际冲突窗口极小、发生率可忽略）。不得在没有复现证据的情况下直接假设需要方向①并动手写锁。

## Touches

- plugin/scripts/resource-gate.sh
- plugin/scripts/driver-shared.ts
- plugin/scripts/suite-lock-slots.ts
- tasks/gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot.md