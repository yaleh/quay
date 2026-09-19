---
id: gap-arch-reverse-edges-zero
title: 架构棘轮：产品层反向依赖清零 —— packages/** → plugin|experiments 真实 import 边 5→0（3
  个共享原语下沉 packages/quay/src/kernel/）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-arch-import-graph-check
goal_ac: AC-307
---
**type:** execution

## Proposal

**把 5 条 `packages/**` → `plugin/**` 的真实 import 边清零：3 个共享原语下沉到 `packages/quay/src/kernel/`（人 2026-09-19 裁定落点），两侧都从 kernel 导入，plugin 侧旧路径保留 re-export 一个发布周期。**

来源：`orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md`（下称 SPEC）§1.2 T1 / §2 P1 / §5 Phase 2 / §8-① / §10.4 行 2。⚠️ 该文件此刻位于分支 `worktree-spec-architecture-refactor`（`.claude/worktrees/spec-architecture-refactor/`），可能尚未在 develop 上——**本任务体自足，不依赖读到它**。

**为什么需要它**：产品层（L1）反向 import 方法学层（L2/L3）违反 SPEC §2 P1「单向依赖」。当前**没有任何检查在盯这 5 条边**——`import-graph-check` 落地后才第一次有读数（本任务的 `depends_on` 就是它）。边一行 import 即可回升，故本量是长期棘轮（`long-term:true`，goal-mechanism §12b 三岔第二行）。

**当前 5 条边（2026-09-19 实机复核，按 import 语句位置判定，非关键词）**：
```
packages/quay/src/serve.ts:36         → plugin/scripts/driver-shared.ts           (serveControlPlane, type ControlPlaneHandle)
packages/quay/src/serve.ts:38         → plugin/scripts/write-json-atomic.ts       (writeJsonAtomic)
packages/quay/src/serve.ts:42         → plugin/scripts/worktree-process-reaper.ts (readProcCmdline, isQuayServe)
packages/quay/src/server-state.ts:38  → plugin/scripts/write-json-atomic.ts       (writeJsonAtomic)
packages/quay-native/src/store.ts:42  → plugin/scripts/shape-sections.ts         (SHAPE_SECTIONS)
```
复核命令（动态 `import()` 另查，实测 0 条）：
```
git ls-files 'packages/**/*.ts' | grep -vE '\.test\.|/test/' | while read f; do
  grep -nE "^\s*(import|export)[^;]*from\s+['\"][^'\"]*(plugin|experiments)/" "$f" | sed "s|^|$f:|"; done
```
⇒ **以 `import-graph-check --json` 的 `reverseEdges` 真实读数为准**；与上表有差异就逐条对账写进 notes，**不得调检查器去凑这 5 条**。

**⛔ 一条不算数的（先说清楚，免得实现者去「修」它）**：`packages/quay/src/fan-in/ff-merge.ts:585-597` 用 `siblingScriptArgv(scriptsDir, "worktree-process-reaper.ts")` **运行时 spawn** 那个脚本——那是运行时耦合，**不是 import 边**；`import-graph-check` 不读它，本任务也不得把它计入、⛔ 更不得顺手改它（SPEC §7 已声明该量不覆盖运行时耦合）。本任务的判据只认 import 语句位置。

**⚠️ 核心设计点一：`worktree-process-reaper.ts` 不是叶子，⛔ 不得整文件搬迁。**
实测它 `:82` import `./gate-script-base.ts`、`:86` import `./suite-lock-slots.ts`（`gate-script-base.ts` 有 186 个依赖者）。整文件搬进 kernel/ 会把这两个一起拖进 L0，直接违反 kernel 边界（AC-304 的第四条规则：kernel/ 下文件不得 import kernel/ 之外的任何模块）。
⇒ **拆出叶子谓词**：`serve.ts:42` 只用 `readProcCmdline`（reaper `:142`）与 `isQuayServe`（reaper `:323`），两者函数体只依赖 `node:fs` / `node:path` ⇒ 抽成 kernel 叶子模块（如 `kernel/proc-identity.ts`），reaper 从它 re-export 后本地继续使用。**搬迁后必须分别验证 reaper 自身的 suite 仍绿**（`plugin/test/worktree-process-reaper.test.mjs`、`plugin/test/suite-slot-ssot-check.test.mjs`）。
`write-json-atomic.ts` 与 `shape-sections.ts` 经复核**都是纯叶子**（前者只 import `node:fs`/`node:path`/`node:crypto`；后者 0 个 import），可整文件下沉。

**⚠️ 核心设计点二：`serveControlPlane`（`driver-shared.ts:283`）——由实现者现场裁定，并写出理由。**
`driver-shared.ts` 25 个导出、属 driver 运行时，**不是叶子**。SPEC §8-①b 是全文唯一未裁定项，推荐**注入**（只改 `serve.ts` 两处调用点 `:639` / `:870`），理由是下沉会把 driver 语义带进 L0。**选出哪个方案、依据是什么，必须写进提交信息与任务 notes**（这是 SPEC 有意留的裁定位，不是遗漏）。

**⚠️ 核心设计点三：方向是 plugin → kernel，绝不反向。**
`plugin/scripts/*.ts` 从 kernel 导入（仓库已有先例：`plugin/scripts/driver-runtime.ts:460`、`inner-blocked-signal.ts:149` 等 8 条 plugin→packages 正向边），旧路径保留 re-export 一个发布周期，避免在飞 worktree / 其它会话的检出中途断链。**若反过来让 kernel re-export plugin，就又造出一条 packages→plugin 边，判据仍红。**

**必须同轮改掉的注释（否则留下假话 = 漂移）**：三处注释正在为「这些模块住 `plugin/scripts/` 是因为 quay-init 铺机制层但不铺 packages/ 树」这条**当前理由**作证，改成 kernel 落点后它们全变成假：`packages/quay-native/src/store.ts:36-41`、`packages/quay/src/server-state.ts:32-35`、`packages/quay/src/serve.ts:31-35`。⇒ 要么改写这些句子、要么把该理由移到 kernel 模块头上并给出**新的可达性论证**。

**⚠️ 落地前必须实测的一件事（本任务最大的隐性风险）**：`packages/quay/plugin/` 是 **gitignored 的构建产物**（repo 根 `plugin/` 的副本，`package.sh` 在 `npm pack` 前 stage 它，使 tarball 布局为 `packages/quay/{plugin,src}`）。`.ts` 源码里的相对路径 `../../packages/quay/src/kernel/…` 在**安装后的布局里解析不到**。**现有实现是靠 esbuild 打包把 plugin 层源码 inline 进自包含 dist 来兜住的**（`packages/quay/scripts/build-dist.mjs:40-50` 的注释直接点名 `serve.ts → driver-shared.ts` 这一条）。⇒ **本任务不得只看检查器变绿就收工**：必须在一个**真产物**上验证（见 AC4）——否则就是把一条「能被 import 图读到」的边改成了「在消费者里解析不到」的边，且没有任何检查会报。

<!-- dedup-ref -->
**与相邻任务的分工（仅追溯，非前置声明）**：`gap-arch-import-graph-check`（AC-304）**建仪器**，本任务**用仪器并把读数降到 0**；`gap-arch-sh-census-check`（AC-305）与 `gap-arch-coverage-self-report`（AC-306）各管 shell 层与覆盖面自报，Touches 不相交。本任务的实现**必然**创建 `packages/quay/src/kernel/`，即 AC-309（kernel/ 建立且被消费）的前半 ⇒ AC-309 立案时应写成「**消费**已建立的 kernel 并验证 ≥3 个 kernel 模块被 packages 侧真实 import」，⛔ 不得再立一个「新建 kernel」的任务与本案抢同一批文件。

## Touches

- packages/quay/src/kernel/write-json-atomic.ts (new)
- packages/quay/src/kernel/shape-sections.ts (new)
- packages/quay/src/kernel/proc-identity.ts (new)
- packages/quay/src/serve.ts
- packages/quay/src/server-state.ts
- packages/quay-native/src/store.ts
- plugin/scripts/write-json-atomic.ts
- plugin/scripts/shape-sections.ts
- plugin/scripts/worktree-process-reaper.ts
- plugin/import-graph-baseline.json
- plugin/test/worktree-process-reaper.test.mjs
- plugin/test/suite-slot-ssot-check.test.mjs
- packages/quay-native/test/gate-shape-dispatch.test.mjs
- packages/quay/test/serve.test.mjs
- tasks/gap-arch-reverse-edges-zero.md

（若实现者把 kernel 拆成别的模块名，新增文件仍属本任务 Touches，须在同一次编辑里补进本清单。）

## AC

- [ ] AC1（判据取假，负控制）在任务 worktree 里**临时**加一条 `packages/quay/src/<file>.ts` → `plugin/scripts/<x>.ts` 的 import，`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` 的 `reverseEdges` 增加且命令 exit 1；撤销后 exit 0 且 `reverseEdges` 为空数组。**两次输出（含 `reverseEdges.length`）贴进 notes。** ⛔ 若撤销前后读数相同 ⇒ 判据未取假，本任务不算完成。
- [ ] AC2（目标读数，两个独立读法互校）在真实仓库根跑 AC-307 的判据本体 `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` ⇒ `evaluated===true` 且 `Array.isArray(reverseEdges) && reverseEdges.length === 0`；**同时** Proposal 里那条 `git ls-files` 位置判据的 grep 输出行数 = 0。**两者不一致 ⇒ 报仪器故障，不得只信其一**（硬规则 4 推论二检测半边）。
- [ ] AC3（kernel 边界）`packages/quay/src/kernel/` 下每个 tracked `.ts` 的 import 均只指向 `node:*` 或 kernel/ 内文件；同一次 `--json` 的 `kernelChecked===true` 且无 kernel 越界项。`worktree-process-reaper.ts` **未被整文件搬入**（仍在 `plugin/scripts/` 且仍 import `./gate-script-base.ts`）。
- [ ] AC4（生产载体，非 fixture —— 硬规则 4 推论三；**本任务最重要的一条**）在任务 worktree 内构建真产物并对其取读数：`bash packages/quay/scripts/package.sh` 产出的 dist bundle 中**不再内联 plugin 层路径**——对 `packages/quay/dist/quay.js` grep `plugin/scripts/{write-json-atomic,shape-sections,driver-shared,worktree-process-reaper}` 命中 0，或对每条仍存在的命中给出逐条说明；且 `node --test packages/quay/test/npm-pack-e2e.test.mjs` 与 `node --test packages/quay/test/build-dist.test.mjs` 绿。**命令与关键输出行贴进 notes。** ⛔ 只跑 `--json` 检查器不算本条的证据。
- [ ] AC5（棘轮方向）`plugin/import-graph-baseline.json` 的 `reverseEdges` 值 = 0，且 notes 里说明本任务是**降低**基线而非抬高；`import-graph-check --selftest` 中「把基线任一值调高相对 HEAD 基线 ⇒ exit 1」的用例仍通过。
- [ ] AC6（回归面不破）`scripts/test.sh` 的 scoped/静态入口（见其头注释）在本任务 Touches 上全绿；另单独跑并贴出：`plugin/test/worktree-process-reaper.test.mjs`、`plugin/test/suite-slot-ssot-check.test.mjs`、`packages/quay-native/test/gate-shape-dispatch.test.mjs`、`packages/quay/test/serve.test.mjs`。
- [ ] AC7（注释不成为假话）三处注释（`quay-native/src/store.ts:36-41`、`server-state.ts:32-35`、`serve.ts:31-35`）中不再有「这些模块住在 plugin/scripts/ 是因为 quay-init 不铺 packages/ 树」这类**与落地后事实相反**的句子；`git diff` 里能看到它们被改写为 kernel 侧的可达性论证。

## DoD

真实落地标准（DIR-026 Reading A）：**判据已在真实仓库上取到 0，且在真产物（npm-pack tarball / dist bundle）上验证过产品仍自包含**——不是「检查器在 fixture 上绿了」。**负控制已实做并留证**（AC1 的注入-撤销两次输出）。`serveControlPlane` 的选择（注入 / 下沉）与理由写在提交信息与 notes 里。**不修改 Provider ABI 与公开 CLI/MCP 表面**（`packages/quay/src/abi.ts` 及其 provider 契约）；**不改 `packages/**` 之外的语义**；**不动 `ff-merge.ts` 的运行时 spawn**；**不删任何 plugin 侧旧路径**（re-export 保留一个发布周期）。落地后 `bash plugin/scripts/capability-catalog.sh --summary` 的脚本数自报值不变（三个文件仍在原位，只是内容改为 re-export），UNCLASSIFIED=0。
