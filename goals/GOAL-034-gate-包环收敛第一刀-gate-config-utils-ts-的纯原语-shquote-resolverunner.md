---
id: GOAL-034
title: gate 包环收敛第一刀：gate/config/utils.ts
  的纯原语（shQuote/resolveRunnerOptions/resolveAcceptanceTimeoutMs/DEFAULT_ACCEPTANCE_TIMEOUT_MS
  + GateConfig/RunnerOptions 类型）下沉 kernel，删除死 re-export shim
  gate/factories/loader.ts（继 GOAL-033 6→4 之后的下一刀，不承诺本刀使 SCC<4）
status: achieved
kind: goal
origin: 继 GOAL-030~033 后第五个 goal branch 试点
activatedAt: 2026-10-10T06:03:50.080Z
statusLog:
  - at: 2026-10-10T06:03:50.080Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-10T07:08:40.465Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
branch: true
---
## 背景

继 GOAL-030/031/032/033 之后第五个 goal branch 试点。GOAL-033 把 core-root⇄core-cli 的 2 条边切除后，package SCC 由 6→4，显式把 `{"", gate, gate/config, gate/factories}` 剩余 4 环列为非目标，留给后续 slice（GOAL-033 body「停止扩大范围的信号」/「非目标」两节逐字点名「⛔ 不碰 gate/、gate/config、gate/factories、fan-in/、kernel/ 之间的其它互指」）。本 goal 承接其中一刀。

## 调查结论（创建本 goal 前完成；机械事实 / 判断 分开写，继续 GOAL-033 的做法）

机械事实（ArchGuard `detect_cycles(outputScope:package)`，scope `26b300e9` = `packages/quay/src` 单根扫描，generatedAt 2026-10-09T09:02；与 grep 按位置核对逐条一致）：

- 4 环仍在：`["", "gate", "gate/config", "gate/factories"]`，与 GOAL-033 留下的形状逐字相同。
- `root → gate/config` 恰好 **1 条**边，唯一命中 `goal-store.ts:88` `import { resolveAcceptanceTimeoutMs } from "./gate/config/utils.ts"`。
- `gate/config/utils.ts` 自身头注释逐字写明：「Shared utilities for gate config — pure, no imports from ../registry.ts or any other gate/ file.」—— 只 import 同目录 `./types.ts`（4 个纯函数 `shQuote`/`DEFAULT_ACCEPTANCE_TIMEOUT_MS`/`resolveAcceptanceTimeoutMs`/`resolveRunnerOptions`，零 Node-以外依赖、零 gate-内部依赖）。已经自认是叶子，只是物理位置住在 `gate/config/`。
- `packages/quay/src/gate/factories/loader.ts`（17 行）是 DIR-087 抽取遗留的纯 re-export shim（自己的头注释：「Existing consumers (registry.ts) continue to import from this path unchanged.」）。`grep -rn "factories/loader" packages/quay/src --include="*.ts"` 除它自身外 **0 命中**——没有任何文件导入它；`gate/factories/index.ts` 自己的头注释也写明「Does NOT re-export utils.ts or loader.ts content」。它是一个真正的死文件。
- `gate/config/loader.ts` 自身也 import `{ type GateConfig, resolveRunnerOptions } from "./utils.ts"`（同目录内部边，第 7 个真实消费点，调查过程中一度漏记，由独立同伴会话核实补上——见下方致谢）；`gate/config/index.ts` 的 barrel 再 `export { shQuote, resolveRunnerOptions } from "./utils.ts"`。
- `gate/factories/utils.ts`（真实消费者：`fixed-script.ts`/`it0.ts`/`coverage-floor.ts`/`test-pass.ts`/`red-green.ts`/`adr.ts` 共 6 处）与 `gate/factories/goal.ts` 都 re-export/直接 import `../config/utils.ts` 的 `shQuote`/`resolveRunnerOptions`。
- `cli/gate.ts` 直接 import `resolveRunnerOptions`（`../gate/config/utils.ts`），`gate/acceptance-runner.ts`/`gate/registry.ts` 分别 import `shQuote`+`DEFAULT_ACCEPTANCE_TIMEOUT_MS` 与 `resolveRunnerOptions`（均来自同一文件）。

判断（ownership）：`gate/config/utils.ts` 的 4 个纯函数 + 它们所需的 2 个类型（`GateConfig`/`RunnerOptions`，定义于同目录 `types.ts`，该文件本身零 import）不是「config 加载」的职责——它们是「如何跑一个基于 shell 的 acceptance 检查」的通用原语，被 root、cli、gate 本体、gate/config 自身（loader.ts/index.ts）、gate/factories 共六个方向消费。物理住在 `gate/config/` 是四方反向伸手进 `gate/` 内部才能用到一个纯函数的根因。正确归属是 `packages/quay/src/kernel/`（已有 9 个同类纯原语模块：`task-transition.ts`/`verdict-parse.ts`/`write-json-atomic.ts` 等，GOAL-030/031/032 的既有先例）。

**机械 vs 语义的边界（逐条标注）**：「4 环仍在」「root→gate/config 恰好 1 条边」「zero importers」三条是 ArchGuard/grep 直接读数，机械事实。下面两条不是，均已独立核实并如实标注为**非工具计算（hand-derived）**：

1. ArchGuard `simulate_refactor_slice`（0.1.39；经「Quay refactor architecture liaison」会话独立读源码 `simulate.ts:232-251` 核实）要求「进入被搬目录的每一条边，其 importedNames 必须被 moves 的 symbols 完全覆盖才能判定该边消失」；目录粒度上 `"" -> gate`、`gate -> gate/config`、`gate/factories -> gate/config` 均混有本刀不搬的符号，工具对此正确 fail-closed 返回 `not-evaluated`——**本 goal 不从该工具拿到「本刀之后 4 环收缩到几」的机械计算结果**。
2. 同一会话随后给出一份**手工推导**（逐条标注 hand-derived、非工具计算）：本刀**不会**让 4 环收缩——`gate -> gate/config` 靠 `gate/registry.ts` 对 `discoverWorkspaceRoot`/`loadWorkspaceGates`/`loadWorkspaceGateMetadata`/`GatesConfig` 的真实依赖继续存活；`gate/factories -> gate/config` 靠 `gate/factories/loader.ts`（真实的、留在原处的那个——它导入 8 个不搬的 `*Entry`/`GatesConfig` 类型 + `../config/loader.ts`）继续存活；对照组：若把 `loader.ts` 的全部 5 个导出也一并搬出 `gate/config`，4 环会收缩到 3（`gate/config` 退出）——但那正是本刀判定为 ownership-wrong 的移动（`discoverWorkspaceRoot` 等是真实的 config 加载逻辑，不是通用原语），即「ownership 正确的窄切片」与「能让 SCC 收缩的宽移动」存在真实张力，本刀选择前者，**不预先承诺 SCC 会变小**，交给 AC-354 的边数读数实测确认「变小与否」本身（不是猜测）。

## 范围与非目标

范围：只搬 `gate/config/utils.ts` 的 4 个函数 + `gate/config/types.ts` 的 `GateConfig`/`RunnerOptions` 2 个类型到新文件 `packages/quay/src/kernel/gate-run-options.ts`；`gate/config/utils.ts` 整个删除（不留 shim，呼应方法论第 2 节反搬壳原则）；`gate/config/types.ts` 保留其余 8 个类型；七个真实消费点改口直连 kernel：`goal-store.ts`、`cli/gate.ts`、`gate/acceptance-runner.ts`、`gate/registry.ts`、`gate/config/loader.ts`、`gate/config/index.ts`（barrel 改源）、`gate/factories/goal.ts`；另删除死文件 `gate/factories/loader.ts`（zero importers）。

**一处有意保留的 re-export（非遗漏，明确裁定）**：`gate/factories/utils.ts` 两行的来源从 `../config/{utils,types}.ts` 改成 `../../kernel/gate-run-options.ts`，继续把 `GateConfig`/`RunnerOptions`/`shQuote`/`resolveRunnerOptions` re-export 给 factories/ 目录内 6 个真实消费者（`fixed-script.ts:8`/`it0.ts:9`/`coverage-floor.ts:10`/`test-pass.ts:8`/`red-green.ts:8`/`adr.ts:10`，均 import `./utils.ts`）——它是这 6 个文件的来源，不是把它们本身 re-export 出去。严格反搬壳读法会要求删掉它、让 6 个文件直连 kernel；本刀选择保留（同目录内 barrel，不是跨目录掩盖），因为经核实它对 `gate/factories ⇄ gate/config` 的边不改变（该边靠 `factories/loader.ts` 的其它 8 个类型独立存活），为此多改 6 个文件没有 ownership 收益——这是「编排可以继续留在原处」（方法论第 1 节）的一个变体：barrel 角色留在原处，只是它背后的正本变了；这是本刀唯一保留的 re-export 性质的间接 import，与 `gate/config/utils.ts`（整个文件的所有权在搬，不能留 shim）性质不同。

⛔ 非目标（有意排除，供下一刀接手）：
- `discoverWorkspaceRoot`/`loadWorkspaceGates`/`loadWorkspaceGateMetadata`（真实的 config 加载逻辑，留在 `gate/config/loader.ts`）；
- `gate/config/loader.ts → gate/factories/index.ts` 的声明式装配 wiring 边（config 需要调用 factory 构造函数，这是合法耦合，不碰）；
- `gate/config/types.ts` 其余 8 个类型（`GateSource`/`GateDiagnostic`/`It0Entry`/`FixedEntry`/`TestPassEntry`/`CoverageFloorEntry`/`RedGreenEntry`/`GatesConfig`）留在原处；
- root⇄gate 经 `abi.ts` 的 `Task`/`TASK_STATUS` 类型边（`gate/driver.ts`/`types.ts`/`registry.ts`/`engine.ts`/`lifecycle.ts` 都 import `../abi.ts`；`mcp-handlers.ts`/`config-validate.ts`/`goal-merge.ts` 调 gate 引擎）——这是 API handler 调 service + service 依赖域类型的合法耦合，不是「原语放错位置」，需要独立调查，不在本 goal 范围；
- `gate/factories → root`（`abi.ts`/`goal-store.ts`/`adr-store.ts`/`document-store.ts`/`contract-validator.ts`）边：factory 读具体 store 是其职责本身，不碰；
- 不重启任何生产进程；不改任何 gate 的运行时行为/退出码/错误文案；不预先承诺本刀会让 4 环的 SCC 大小改变（见上「调查结论」第 2 条）。

## 判据形态

三态退出码（同 GOAL-030~033）：0 达成；1 未达成且同行带 `CAUSE=`；3 未评估。

## AC

- AC-353（结构护栏，pre-merge）：新文件存在并持有 4 函数+2 类型的单一定义；`gate/config/utils.ts`、`gate/factories/loader.ts` 均已删除（无 shim）；七个真实消费点改口；五项非目标逐条核实未动；`git diff --name-only develop...HEAD` 不越界到 `gate/engine.ts`/`lifecycle.ts`/`driver.ts`/`types.ts`/`abi.ts`/`fan-in/`。
- AC-354（before/after 边数读数 + 可证伪负对照，pre-merge；4 环是否收缩按本条实测为准，不采信「调查结论」第 2 条的手工推导作为结论，只作为前置假设）：fork point 已记录基线（commit `162f8c380ed1dd9267167cc791ef8727fd13269d`：`root→gate/config`=1，`gate/factories→gate/config` 行数=5）；分支尖端重读同一组数字应为 `root→gate/config`=0、`gate/factories→gate/config`=0；负对照——在 `goal-store.ts` 的 scratch 字符串副本里重新插入旧 import 行，断言计数法能检测到（从 0 变回 ≥1）。
- AC-355（post-merge 生产验证）：合并落地后，在 `develop` 尖端（`git merge-base develop HEAD == develop` 一致性核验，非凭 cwd 假设）重跑 AC-353 的同一结构检查；`packages/quay/test/{gate-config-loader,gate,goal-store,acceptance,acceptance-env,gate-diagnostics,gate-ergonomics}.test.mjs` 回归全绿——这七个文件覆盖本刀触达的全部运行时路径：config loader、gate 引擎、goal 生命周期、acceptance runner 行为与环境变量、诊断/人类可读输出。

## 验证步骤

1. fork point：已对 `packages/quay/src` 做一次 ArchGuard 单根扫描（scope `26b300e9`，generatedAt 2026-10-09T09:02）并记录 develop tip `162f8c380ed1dd9267167cc791ef8727fd13269d` 作为基线提交。
2. goal 转 active + `branch:true` ⇒ `goal/GOAL-034` 从 develop tip 懒创建。
3. 一个 task 在该分支上落地（范围见上）。
4. before/after 边数读数（AC-354）；可选：请独立同伴会话（架构互查）对分支尖端重跑一次手工 SCC 推导，作为第二来源核对（非阻塞项——不具备就跳过，不作前置）。
5. 人工触发 `quay goal merge GOAL-034 --reason ...`；worker-driver 机械 fan-in。
6. 规定 merge shape（develop first-parent 恰好一个合并提交）。
7. post-merge 验证（AC-355）。

## 自举说明（为何本 goal 不做 GOAL-030/031 式的 realpath 自举证明）

本刀是纯源码级符号搬迁，不涉及任何常驻进程「加载了哪棵树」的问题（不像 GOAL-030/031 那样有 driver/serve 子进程在运行时解析模块）——验证靠现有测试套件在分支树上重跑 + AC-353/355 的静态结构检查即可覆盖「代码是否真的被加载/生效」，不需要 `/proc/<pid>/cmdline` realpath 证明。这是一个范围判断，写在这里供复核，不是遗漏。

## 停止扩大范围的信号

与 GOAL-030~033 同构：需要碰 `gate/engine.ts`/`lifecycle.ts`/`driver.ts`/`abi.ts`/`fan-in/*` 任一文件才能完成本刀；或 `gate/config/loader.ts` 的装配 wiring 必须改变才能完成；或为了让 AC-354 的 SCC 数字好看而顺手把 `discoverWorkspaceRoot` 等真实 config 加载逻辑也搬进 kernel——任一出现 ⇒ 不扩大范围，回到调查，必要时放弃分支（直接对应方法论第 4 节"指标服从 scope"的教训：AC-354 的边数读数服务于已划定的范围，不能反过来牵动范围）。

## 退出条件

`gate/config/utils.ts` 的 4 个纯函数 + 2 个类型在 `kernel/` 有唯一定义；七个真实消费点改口；`gate/config/utils.ts`/`gate/factories/loader.ts` 两个死文件/shim 均消失；`root→gate/config` 边数按 AC-354 实测归零（4 环本身是否因此收缩不作退出条件，按实测如实记录）；GOAL-034 以恰好一个合并提交进入 develop；AC-353/354/355 全部 achieved。

## 致谢

本 goal 的调查阶段与「Quay refactor architecture liaison」会话（archguard 仓库，只读查阅 quay 仓库）协作核实：(1) 确认无文件级任务冲突；(2) 独立验证 ArchGuard `simulate_refactor_slice` 的 fail-closed 行为与边界原因（源码级）；(3) 两轮手工 SCC 推导，发现并纠正了本调查最初遗漏的 `gate/config/loader.ts` 消费点与 `gate/factories/utils.ts` shim 的归属判断。所有「hand-derived」标注的结论均来自该协作，不是本 session 独立产出，如实署名以符合硬规则 1/5。
