---
id: gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy
title: touches-orthogonality-check.ts 的相对导入路径写死假设仓库顶层布局——在 npm 打包用的 staged
  plugin 副本下 ERR_MODULE_NOT_FOUND,quay driver 命令整体失败
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal

**实测证据（2026-09-14，本机排查驱动 dist 过期问题时意外发现）**：`plugin/scripts/touches-orthogonality-check.ts:25`：
```ts
import { isRuntimeArtifactPath, loadRuntimeArtifactPatterns } from "../../packages/quay/src/runtime-artifacts.ts";
```
这行相对路径写死假设自己位于仓库顶层 `plugin/scripts/`（往上两级到仓库根，再进 `packages/quay/src/`）。

但 `packages/quay/scripts/package.sh` 会把整个 `plugin/` 目录完整拷贝一份到 `packages/quay/plugin/`（npm 打包用的 staged 快照，供 `build-plugin-dist.mjs` 编译 dist）。**这份 staged 副本里的同一个文件，同一行相对路径，往上两级只到 `packages/quay/`**，于是实际解析成
`packages/quay/packages/quay/src/runtime-artifacts.ts`——一个不存在的路径。

**触发场景（真实复现，不是构造）**：`build-plugin-dist.mjs` 的"预编译 entrypoint"名单里没有收录
`touches-orthogonality-check.ts`（该脚本不在其中，具体名单条目需实现者核实——本任务标题不预先断言
名单大小，只断言这一个文件不在其中），因此这个文件**始终以裸 `.ts` 通过 `--experimental-strip-types`
执行，而不是被预编译进某个不受相对路径影响的 dist bundle**。当 `packages/quay/plugin/` 这份 staged
快照处于"刚被完整刷新"的状态时，`quay driver <verb>`（不带 `QUAY_PLUGIN_ROOT` 覆盖时，CLI 默认解析
到这份 staged 副本而非仓库顶层 `plugin/`）会在真正执行 stop/start 之前，因为这一行 `ERR_MODULE_NOT_FOUND`
而整体失败退出——**不会伤害已有 driver 状态**（失败发生在触碰 supervisor 之前），但会让操作者以为
`quay driver restart` 这个命令本身坏了。

**已验证的绕过方式（不是修法，只是当下的应急手段）**：`QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin`
强制 CLI 解析到仓库顶层（未嵌套）的 plugin 路径，绕开这份 staged 副本，`driver status`/`driver restart`
即可正常工作。

## Plan

1. 定位 `build-plugin-dist.mjs` 的预编译 entrypoint 名单，确认 `touches-orthogonality-check.ts`
   确实不在其中（若已经在，说明此文件应该被预编译成 dist、不该再以裸 `.ts` 形态执行，问题落在
   "为什么没编译进去"而不是路径本身）。
2. 若确认不在名单中且不适合硬加进预编译名单（若这个脚本有理由必须保持源码可读/独立执行），修法应
   该是让这一行相对路径**不再假设固定的目录深度**——用一个运行时可靠的锚点（如
   `import.meta.resolve` 配合仓库根探测，或复用本仓库已有的 `findRepoRoot`/`findWorkspaceRoot` 之类
   动态定位辅助函数，而不是硬编码 `"../../"` 这个字面量层数）。
3. 若加入预编译名单更简单直接（编译后 bundle 内部的模块解析不受源码目录相对位置影响），优先选择
   这条路径，除非有明确理由不能预编译这个文件。
4. ⛔ 不要只在这一个文件上打补丁——`grep -rn '"\.\./\.\./packages/quay/src"' plugin/scripts/*.ts`，
   核实是不是还有其他脚本用同样写死层数的相对路径（同一类缺陷可能不止这一处，硬规则 5b：在一处修好
   不等于只有那一处）。

## 实现与证据（2026-09-14 落地，第一手）

### 0. Plan 步骤 1 的核实：原 Proposal 的两条断言被实测推翻

**(a) 该文件【在】预编译 entrypoint 名单里，不是不在。** `deriveEntries(pluginRoot)` 实测输出
`scripts` 条目 91 条，其中含 `'scripts/touches-orthogonality-check.ts'`；构建产物
`scripts/dist/touches-orthogonality-check.js` 也确实存在。⇒ Plan 步骤 3（加进名单）不适用。
**按 Plan 步骤 1 自己的分支**：「若已经在，说明此文件应该被预编译成 dist、不该再以裸 .ts 形态执行，
问题落在『为什么没编译进去』」——真正的答案是 **"它编译进去了，但仍以裸 .ts 执行"**：
`plugin-root.ts::resolvePluginScriptExec` 是 **raw 优先、dist 兜底**（`if (raw) return {path: raw,
stripTypes: true}`），而 staged 副本在"刚被完整刷新"（`package.sh` 的 `cp -R` 之后、`find -delete`
之前）时 **raw 与 dist 并存** ⇒ raw 胜出 ⇒ 走的正是本任务标题描述的那条相对路径。

**(b) 触发不是"某个文件漏编译"，是 raw 执行路径本身在 staged 布局下不可解析。** 该文件的裸 `.ts`
形态**在任何 staged 状态下都不可解析**，与该文件是否进过 dist 无关：只要它以 raw 执行，那行字面量
就落在不存在的 `packages/quay/packages/quay/src/…`。⇒ **修法只能落在"让这行字面量不再假设目录深度"
（Plan 步骤 2），加名单/换解析顺序都不解决 raw 形态。**（AC2 要求"在副本路径下运行同一个文件"也正是
这个方向。）

### 1. 复现（修复前，真实载体，非构造）

```
$ node --experimental-strip-types /home/yale/work/quay/packages/quay/plugin/scripts/touches-orthogonality-check.ts --help
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/home/yale/work/quay/packages/quay/packages/quay/src/runtime-artifacts.ts'
  imported from /home/yale/work/quay/packages/quay/plugin/scripts/touches-orthogonality-check.ts
```
主检出上**当前就处于这个状态**（`packages/quay/plugin/` 存在且 raw 与 dist 并存），所以 AC3 那个
命令在**修复前**打的是真·生产路径（无 `QUAY_PLUGIN_ROOT`）：
```
$ node --experimental-strip-types packages/quay/bin/quay.ts driver status --kind worker --root /home/yale/work/quay
Error [ERR_MODULE_NOT_FOUND]: … packages/quay/packages/quay/src/runtime-artifacts.ts   exit=1
```
**为什么 `quay driver` 会碰到这个文件**（不是巧合，是内核自己的 import 图）：
`driver-runtime.ts:52 → driver-filters.ts:29 → touches-orthogonality-check.ts:25`，另有
`driver-runtime.ts → driver-filters.ts → concurrent-batch-scheduler.ts → fast-mode-telemetry.ts:112
→ worktree-namespace.ts`。两条链都在 `quay driver` 的传递闭包里（闭包实测 21 个文件，含 Core-src
相对导入的只有这 2 个）——**所以这两个文件必须一起修，否则 AC3 仍挂。**

### 2. 修法：`plugin/scripts/core-src-import.ts`（新增，单一来源）

**静态字面量 primary + 走位 fallback，两者缺一不可**：
- ⛔ **不能只用计算出的 specifier**：esbuild 无法内联计算值，shipped `dist/*.js` 会退化成对
  node_modules 下 `.ts` 的运行时 import ⇒ Node ≥23.7 拒绝剥类型
  （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。这正是 `worker-driver.ts:3900` 那条裁定
  （"⛔ 不用 pathToFileURL(计算路径)"）的理由。
- ⛔ **不能只用静态字面量**：仓库树与 bundle 里都对，**在 staged 副本里以 raw 执行的那一刻就是错的**。

⇒ `() => import("<静态字面量>")` 由 esbuild 解析并 INLINE（bundle 自包含），**只有它抛
`ERR_MODULE_NOT_FOUND` 时**才走 fallback：以本模块自身目录为锚向上走位（同 `plugin-root.ts` 的
模块定位惯用法，⛔ 不是 `process.cwd()`），逐层探两种 Core-src 形态
`<dir>/packages/quay/src/<rel>`（仓库树）与 `<dir>/src/<rel>`（staged 包根）。
fallback 本身再失败 ⇒ **重抛原始错误**（硬规则 3b：不得把"解析不到"洗成另一个更安静的错误）；
非 `ERR_MODULE_NOT_FOUND` 的失败（目标模块自身 init 抛错等）一律不进 fallback——那里 fallback 会
(a) 报出与真因不同的错、(b) 有加载出第二份初始化状态不同的同模块实例的风险。

两个调用点：`touches-orthogonality-check.ts:25`、`fast-mode-telemetry.ts:112`。

### 3. 红/绿对照（同一路径、同一命令，只换文件）

| 载体 | 文件 | 结果 |
|---|---|---|
| staged 副本（`cp -R` 复现 `package.sh` 拷贝步骤） | 修复前 | `ERR_MODULE_NOT_FOUND … packages/quay/packages/quay/src/runtime-artifacts.ts` exit=1 |
| 同一 staged 副本 | 修复后 | `usage: touches-orthogonality-check.ts …` exit=0 |
| 沙箱 staged 副本 + 真 `quay driver status`（**无 `QUAY_PLUGIN_ROOT`**） | 修复前 | 同上 ERR_MODULE_NOT_FOUND exit=1 |
| 同一沙箱，同一命令 | 修复后 | 输出 worker 状态行，**exit=0** |
| 同一沙箱，真 `quay driver restart --kind promotion`（**无覆盖**） | 修复后 | `started: supervisor pid=… confirmed_ms=1515`，exit=0（已 `driver stop` 回收，无孤儿） |

**⛔ 为什么 AC3 用沙箱**：`plugin-root.ts` 约束①规定「从 linked worktree 加载 ⇒ 一律重定位到主检出
的 `plugin/`」，所以从任务 worktree 里跑 `quay driver` **永远打不到 worktree 的 staged 副本**（实测
`resolvePluginRoot()` 返回 `/home/yale/work/quay/plugin`）。沙箱 = 同构 staged 布局 + 一份 Core src，
**不带任何环境变量覆盖**，跑的确实是 CLI 的真实解析 + spawn 路径。真实生产载体上的复现见 §1。

**AC1 负控制**：仓库顶层 `plugin/scripts/` 下两个文件 `--help` 均 exit=0（未嵌套场景行为不变）。
**bundled 形态**：`build-plugin-dist.mjs` 在 HEAD 树与修复后树各跑一次，均为 **87 个 entrypoints**
（无增减）；`node <staged>/scripts/dist/touches-orthogonality-check.js --help`（**裸 node、不带
`--experimental-strip-types`**）exit=0，`dist/driver-runtime.js` 可 import —— shipped 形态仍自包含
（bundle 内残留的 `packages/quay/src/runtime-artifacts.ts` 只是 `__esm` 注册表键与源边界注释，
fallback 那行在 bundle 里是**取不到的死码**：primary 已内联，不会抛）。

### 4. AC4 同类清单（实测枚举，按位置判定非关键词）

**先纠一条判据本身**：AC4 写的 `grep -rn '"\.\./\.\./packages/quay/src"'` 带了闭合引号，
而实际代码是 `from "../../packages/quay/src/runtime-artifacts.ts"`（`src` 后还有 `/…`），
**该模式命中 0**——照它对比会得到"0 比 0、无同类"的假结论（硬规则 2 的零计数形态）。
正确的模式去掉闭合引号：`grep -rn '\.\./\.\./packages/quay/src' plugin/scripts/*.ts`。

**真代码命中：15 个文件 / 20 处**（修复前）：
`anti-drift-touches-check.ts:18`、`dark-axis-record-check.ts:40,52`、`peer-identity-probe.ts:33`、
`fast-mode-telemetry.ts:112`、`inner-blocked-signal.ts:146`、`orphan-session-check.ts:50`、
`build-evidence-gate.ts:313`、`criterion-failure-attribution-check.ts:69,89`、
`measure-trend-check.ts:45`、`meta-driver.ts:58,62`、`send-to-session.ts:53,91`、
`worktree-namespace-literal-check.ts:33`、`touches-orthogonality-check.ts:25`、
`worker-driver.ts:3904,4607`、`goal-driver.ts:73`
（其中 `peer-identity-probe/inner-blocked-signal/orphan-session-check` 是 `primitives/*.mjs` 形态，
`build-evidence-gate/send-to-session/worker-driver` 是函数体内的动态 import 形态。）

**注释/文档提及、不是缺陷：4 处** —— `precommit-guard.ts:606`、`kernel-sibling-resolution-check.ts:35`、
`send-to-session.ts:48`、`task-status.ts:5`（按位置判定，不计入）。

**本任务修了 2 个（`quay driver` 闭包内的全部），其余 13 个未修但已枚举——实测其残余状态**
（把 staged 副本的模块图逐个 import 一遍，不是靠读代码断言）：
- **11 个在 staged 裸执行下 module load 即挂**：`anti-drift-touches-check`、`dark-axis-record-check`、
  `peer-identity-probe`、`inner-blocked-signal`、`orphan-session-check`、
  `criterion-failure-attribution-check`、`measure-trend-check`、`meta-driver`、
  `worktree-namespace-literal-check`、`worker-driver`、`goal-driver`
  （`worker-driver.ts` 自身那两处是动态 import，它 module load 挂是因为**传递**到了
  `measure-trend-check.ts`——归因按实测错误行，不是按猜测）
- **2 个 module load 通过、调用时才挂**：`build-evidence-gate.ts`、`send-to-session.ts`
  （Core 导入在函数体内，属**潜伏**形态，与上 11 个不是同一可见度）
- 修好的 2 个：`touches-orthogonality-check.ts`、`fast-mode-telemetry.ts`

⚠️ **诚实标注**：修法保留了静态字面量（作为 primary），所以**裸 grep 的命中数修复前后几乎不变
（15 文件/20 处）**——`grep` 是"类"的检测器，不是"缺陷"的检测器；判断某处是否已修必须**跑它**，
不能数 grep。上表的"残余状态"就是这么测出来的。

## Acceptance Criteria

- [ ] AC1 在仓库顶层 `plugin/scripts/` 直接运行 `touches-orthogonality-check.ts`（现有行为）仍然正常
      工作（负控制：本任务不能破坏未嵌套场景下的既有行为）。
- [ ] AC2 构造一份 staged 副本（复现 `package.sh` 的拷贝步骤，或直接对现有 `packages/quay/plugin/`
      跑一次同类刷新），在这份副本路径下运行同一个文件，**不再**报 `ERR_MODULE_NOT_FOUND`。
- [ ] AC3 `quay driver status`/`quay driver restart --kind <any>`（不带 `QUAY_PLUGIN_ROOT` 覆盖）在
      staged 副本处于"刚完整刷新"状态时，跑通不报错——这是这次真实撞到的触发条件，必须直接复现并
      验证修复。
- [ ] AC4 `grep -rn '"\.\./\.\./packages/quay/src"' plugin/scripts/*.ts` 的命中数与本任务处理前的命中数
      对比，若发现其他文件有同类写死路径，须在本任务体里列出清单（不必在本任务里全部修完，但必须
      枚举出来，不能只顾自己撞到的这一个）。
- [ ] AC5 全量 `scripts/test.sh` 绿。

## Definition of Done

- 五条 AC 全部满足。
- 任务体保留第一手证据：`touches-orthogonality-check.ts:25` 的原始导入行、staged 副本下实际解析出的
  错误路径、`QUAY_PLUGIN_ROOT` 应急绕过方式的验证结果。
- ⛔ 不得只用 `QUAY_PLUGIN_ROOT` 环境变量覆盖当作最终修法写进文档了事——那是应急手段，本任务要修的
  是"默认（不设覆盖变量）情况下就不出错"。

## Touches
- tasks/gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy.md
- plugin/scripts/core-src-import.ts（新增：布局无关的 Core-src 取得，静态字面量 primary + 走位 fallback）
- plugin/scripts/touches-orthogonality-check.ts
- plugin/scripts/fast-mode-telemetry.ts（`quay driver` 闭包内第二个同类调用点，AC3 要求一并修）
- plugin/scripts/capability-catalog.sh（新脚本入件必须补的目录声明 5 行，否则 AC1c 门 exit 1）
- ~~packages/quay/scripts/build-plugin-dist.mjs~~：**已核实不需要改动**（该文件本来就在派生 entry 集里，
  `touches-orthogonality-check.ts` 的 dist bundle 一直存在；缺的不是编译，是 raw 执行路径）。
  按 Plan 步骤 1 的要求"精确声明是否真的改动"，结论是不改动 ⇒ 从 Touches 移除。
