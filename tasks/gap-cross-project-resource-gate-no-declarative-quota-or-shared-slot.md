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

- [x] 复现实测（不是推理）：在本机构造两个不同的根目录（quay 自己 + 一个临时第三方 fixture 根，参照 `gap-driver-resource-gate-path-anchored-at-root-third-party` 任务里用过的手法），在宿主确认空闲的窗口内，几乎同时各自调用一次 `resource-gate.sh --for full-suite --json`，核实两者是否都返回 GO（预期都返回，因为当前没有互斥机制）。把两次调用的实际输出贴入任务体。
- [x] 评估方向（不预设哪个对，先列选项再选，供 manager/人裁定）：
  ① 给 `resource-gate.sh` 加一个可选的跨进程文件锁（例如落在一个固定的、不随仓库变化的路径如 `~/.quay-global/resource-gate.lock`），把"检查宿主状态"与"预留一个起跑名额"合并成一次原子操作，短持有（只覆盖"检查+预留"这一瞬间，不覆盖整个 suite 运行期，否则退化成一个新的全局单飞锁、会把两个项目的重活完全串行化，这不是目标）；
  ② 维持现状，但把期望值订正为"这是软保护（基于共享宿主指标的弱协调），不是硬保证互斥"，写进 `resource-gate.sh` 的头注释或相关文档，不改代码。
  两个方向都要写出取舍依据——**按硬规则12（没有发生率数据就不能凭空设前置/立新机制），如果上面的复现测试显示"两边几乎同时起跑"这个场景实际发生率极低（例如两个项目的重活触发时间天然很少重叠），应倾向方向②，把这个当观察项而非阻塞项**；如果复现测试或历史数据显示确实有实际冲突发生过，再倾向方向①。
- [x] 把「两个根几乎同时调用同一复现命令」这一场景，以及它在**方向①被采纳时**的预期（一个 GO、另一个因名额被占而 WAIT，或排队后 GO），写成**观察项**记入任务体；并贴出**当前无锁状态下**同一命令两次调用都返回 GO 的实测输出，作为「今天确实没有互斥」的基线证据。（DIR-132 已裁定①不在本任务范围内实现，见本 `## AC` 末条——⛔ 本任务不实现锁；本 AC 的交付物是**记录 + 基线读数**，不是对锁的验证。）
- [x] 不论选哪个方向：`gap-driver-resource-gate-path-anchored-at-root-third-party`（done）的既有行为——第三方项目能从 kernel 安装位置解析到 `resource-gate.sh`——必须保持不变，其既有测试全部通过。
- [x] **新增（DIR-132 范围调整）**：复现实测确认 resource-gate.sh / suiteLockBase() 在完全没有 ClaudeCodeUI（或任何第二个项目）存在、且调用方根目录是一个全新临时目录（无 `.quay/config.yml`、无 `plugin/`）时，仍能正确运作（fail-closed 报错或走 QUAY_PLUGIN_ROOT 解析到 kernel 位置，不崩溃、不因为假定了一个不存在的第二仓库而出错）。贴实测命令与输出。
- [x] **新增（DIR-132 范围调整）**：原方案①（跨进程文件锁）保持为本任务体里记录的观察项，不在本任务范围内实现；若后续有实际竞态发生的证据（而不是理论推演），再由新任务或本任务的后续修订立案实现，本任务现在不得因为"方便"就顺手把锁加上。

## Evidence

### AC1 — 复现实测：两个根几乎同时调用，两次都返回 GO（无互斥）

**装置**：两个根 —— ① quay 本仓的任务 worktree `<WT>`；② 全新空临时目录 `/tmp/quay-crossproj-rg-fixture-thirdparty`（实测无 `.quay/`、无 `plugin/`、且非 git 仓）。两者调用**同一份** kernel 安装位置的 `resource-gate.sh`（这正是跨项目场景：两个项目的 driver 各自解析到同一脚本）。宿主空闲窗口内（预检 report 模式 GO：`cpu_stall some avg10=1.13 [limit 60] ok`、`loadavg=21.30 [limit nproc×2≈256] ok`、`mem_avail=168488MB ok`），背靠背同时起跑。

**实测输出（逐字，`/tmp/quay-crossproj-rg-evidence/ac1-run1.txt`）**：

```
----- caller 1: quay (<WT>) -----
label=quay cwd=<WT> start=18:05:32.242
{"cpu_stall_avg10": 1.28, "cpu_stall_avg300": 1.09, "cpu_limit": 60.0, "mem_avail_mb": 168770.0, "mem_limit_mb": 2048.0, "loadavg": 21.3, "load_threshold": 256, "load_over_factor": 2.0, "nproc": 128, "node_procs": 265, "swap_kb": 16777212, "nproc_invariant": "ok", "node_comm_mainthread": 7, "node_cmdline_procs": 265, "instrument_failure": 0, "instrument_failure_note": null, "total_budget": 128, "budget_in_use": 0, "budget_available": 128, "worktree_node_tests": 0, "caller_scope": "worktree", "orphans": [], "priority_override": 0, "cpu_wait": 0, "mem_wait": 0, "load_wait": 0, "verdict": "GO", "reason": "=> GO: 资源充足，可以跑"}
exit=0 end=18:05:34.035

----- caller 2: third-party (/tmp/quay-crossproj-rg-fixture-thirdparty) -----
label=third-party cwd=/tmp/quay-crossproj-rg-fixture-thirdparty start=18:05:32.243
{"cpu_stall_avg10": 1.28, "cpu_stall_avg300": 1.09, "cpu_limit": 60.0, "mem_avail_mb": 168770.0, "mem_limit_mb": 2048.0, "loadavg": 21.3, "load_threshold": 256, "load_over_factor": 2.0, "nproc": 128, "node_procs": 265, "swap_kb": 16777212, "nproc_invariant": "ok", "node_comm_mainthread": 7, "node_cmdline_procs": 265, "instrument_failure": 0, "instrument_failure_note": null, "total_budget": 128, "budget_in_use": 0, "budget_available": 128, "worktree_node_tests": 0, "caller_scope": "unknown", "orphans": [], "priority_override": 0, "cpu_wait": 0, "mem_wait": 0, "load_wait": 0, "verdict": "GO", "reason": "=> GO: 资源充足，可以跑"}
exit=0 end=18:05:33.951

=== verdict extraction ===
quay.txt: "verdict": "GO" exit=0
third.txt: "verdict": "GO" exit=0
```

**读数**：两次调用起跑时刻 `18:05:32.242` 与 `18:05:32.243`（相隔 1ms），执行窗口重叠（`242→34.035` × `243→33.951`），**都返回 GO / exit 0**，且读到的字段值逐字相同（同一份宿主快照）⇒ 现在确实没有任何互斥：两个根可以在同一瞬间各自拿到 GO 并各自起跑重活。唯一差异是 `caller_scope`（`worktree` vs `unknown`），那是调用方身份，不参与互斥。

**补充（机制层，非本次 AC 要求但支撑 Finding #1）**：`suiteLockBase()` 对两个不同 git 仓解析出两个**不同**的槽基路径 —— `git rev-parse --git-common-dir` 分别得 `<WT>`→ `/data/home/yale/work/quay/.git/full-suite.lock.0`、`/tmp/quay-crossproj-rg-secondrepo`（一个 `git init` 的空仓）→ `/tmp/quay-crossproj-rg-secondrepo/.git/full-suite.lock.0`。两条路径不相交 ⇒ 单飞槽跨仓不通。

### AC2 — 方向评估（列选项 → 取舍依据 → 选择）

**选项①（跨进程文件锁）**
- 收益：把"检查宿主状态"与"预留起跑名额"合并为一次原子操作，能真正防住"几乎同时双起跑"。
- 代价/风险：(a) 引入一个固定的宿主级路径（如 `~/.quay-global/…`）——正是 DIR-132 要求避免的"把跨项目协调变成隐式前置"；(b) 需处理持锁进程崩溃留下的 stale lock（TTL/清理协议），否则新的全局死锁源；(c) 跨用户 / 跨安装 / 容器命名空间下，固定的宿主路径会带来权限与隔离问题；(d) 短持有窗口只有毫秒级，而两个项目的重活触发是分钟级事件——锁只覆盖"起跑那一瞬"，其削减效果取决于两次起跑是否恰好落在同一毫秒窗口内。

**选项②（订正文档期望值，不改代码）**
- 收益：零新运行时状态、零新前置，与 DIR-132"缺失时必须完全独立运行、不写死路径、不假定双仓库存在"一致；把"这是软保护，不是预留"写进机制头注释，直接纠正"读到 GO 就当已占名额"这一误读——正是硬规则 3b 的形态（不具备的能力不得与"合格"输出同形）。
- 代价：不消除竞态，只是诚实地标注它；若将来真发生冲突，读注释的人不会误以为已有保护（这是刻意保留的透明度）。

**取舍依据（硬规则 12）**：今天**没有任何"两个项目几乎同时起跑"的实际发生记录**。本次 AC1 实测证明的是"机制不具备互斥能力（两者都 GO）"——**能力缺失 ≠ 事件发生**；它不能作为"竞态已经发生过"的证据。DIR-132 人裁定亦已将①降为非优先。
⇒ **选择方向②**。这不等于"问题不存在"：结论是"在拿到发生率数据之前，不立新机制"；竞态被如实记为观察项（见 AC3），一旦有真实冲突证据即可重新立案。

### AC3 — 观察项 + 无锁基线证据

**观察项（记入任务体，供后续 manager/人裁定）**：两个（或更多）独立根几乎同时调用同一份 `resource-gate.sh --for full-suite --json` 时，**当前都返回 GO**，因为该门是一次性只读快照，不持有任何预留。**方向①若被采纳时的预期**：同一装置下应观察到「一个 GO、另一个因名额被占而 WAIT（exit 1）」，或排队后 GO——即两次调用不再同时返回 GO。⛔ 这个预期**本任务不验证**（DIR-132 裁定①不在本任务范围内）。

**触发重新立案的条件**（必须是证据而非推演）：出现实际重叠的记录 —— 例如两份 round / telemetry 记录显示两个项目的全量 suite 起跑时刻重叠、且各自都在读到 GO 之后同时起跑。在拿到这种读数之前，本项保持观察项。

**无锁基线证据（今天确实没有互斥）**：见 AC1 的逐字输出 —— `quay.txt: "verdict": "GO" exit=0` / `third.txt: "verdict": "GO" exit=0`，起跑相隔 1ms、窗口重叠。

### AC4 — sibling 行为不变（第三方项目仍能解析到 kernel 侧的 resource-gate.sh）

既有行为保持不变：`driver-shared.ts` 的 `resolveResourceGateScript()`（AC-207 落地的那条 kernel-安装位置解析）**未改动**；本任务只在其契约点的注释/文档侧补了"这是软保护"的说明。既有测试全部通过：
- `plugin/test/driver-shared.test.mjs`（双向覆盖：kernel 侧有 ⇒ 非 127；kernel 侧无 ⇒ fail-closed 报 not found）——**13/13 pass**（scoped 门内实测）。
- `plugin/test/driver-third-party-fixture.test.mjs`、`plugin/test/kernel-sibling-resolution-check.test.mjs`、`plugin/test/suite-slot-ssot-check.test.mjs`、`plugin/test/resource-gate-s01..s07` —— **合计 119/119 pass**。
- scoped 门（`scripts/test.sh --for-task … --allow-thin`）**EXIT=0**（全绿）。

### AC5 — 全新临时根、无第二项目、无 `.quay/`、无 `plugin/`

装置：`FRESH=/tmp/quay-crossproj-rg-fresh-root`（空目录，非 git 仓）。实测：

```
=== A) resource-gate.sh 以 cwd = fresh root 调用（无 .quay、无 plugin/、非 git 仓）===
{"cpu_stall_avg10": 0.57, ..., "caller_scope": "unknown", ..., "verdict": "GO", "reason": "=> GO: 资源充足，可以跑"}
exit=0

=== B) 驱动路径：resolveResourceGateScript() 从 kernel 安装位置解析（QUAY_PLUGIN_ROOT override）===
resolved: <WT>/plugin/scripts/resource-gate.sh

=== C) suiteLockBase() 以 root = fresh dir（非 git 仓）===
fatal: not a git repository (or any of the parent directories): .git
/tmp/quay-crossproj-rg-fresh-root/.git/full-suite.lock.0
exit=0

=== D) suiteLockSlotCount() 以 root = fresh dir ===
1
exit=0
```

**读数**：不崩溃、不依赖第二个仓库存在。resource-gate.sh 以自身 `SCRIPT_DIR` 定位辅助脚本 ⇒ 从任意 cwd 调用均正常（`caller_scope=unknown` 是诚实的"非 git 调用方"取值，不冒充 main/worktree）。驱动路径经 `QUAY_PLUGIN_ROOT` 解析到 kernel 位置。`suiteLockBase()` 在非 git 根上 fallback 到 `<root>/.git/…`（git 自己打了一条 stderr 提示，属预期；函数返回一个**确定的**路径而非抛错/挂死），`suiteLockSlotCount()` 仍返回默认 1 —— 即"缺跨项目配置时完全独立工作，不假定第二个仓库存在"。

### AC6 — 原方案①（跨进程文件锁）保持观察项，本任务未实现

- `grep -c "flock" plugin/scripts/resource-gate.sh` ⇒ **0**（没有任何加锁代码）。
- 新增的注释里提到的 `~/.quay-global/resource-gate.lock` / `quay-global` 各出现 1 次，**只出现在 SCOPE 注释中作为"被推迟的设计"描述**，不是可执行代码。
- 净代码改动（非注释）只有 1 行：`resource-gate.sh` 的 `-h|--help` 分支由 `sed -n '2,14p'` 改为单行委派 `tool_help`（原因：SCOPE 注释块把原固定的行区间顶偏，会截断 help；该文件处于零富余的 sh-census 棘轮下，故保持**行数中性**）。
- 变更文件仅 2 个：`plugin/scripts/resource-gate.sh`（+28−1，全为注释 + 上述 1 行）与 `plugin/scripts/suite-lock-slots.ts`（+11−1，纯 docstring 补充）。

## DoD

必须先有复现证据，再决定方案；本任务允许的合法交付之一是"决定现状已经足够、只订正文档期望值、不改代码"（如果复现显示实际冲突窗口极小、发生率可忽略）。不得在没有复现证据的情况下直接假设需要方向①并动手写锁。

## Touches

- plugin/scripts/resource-gate.sh
- plugin/scripts/driver-shared.ts
- plugin/scripts/suite-lock-slots.ts
- tasks/gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot.md