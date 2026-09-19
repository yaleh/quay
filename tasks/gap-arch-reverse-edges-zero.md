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
- packages/quay/src/kernel/control-state.ts (new)
- packages/quay/src/kernel/control-plane-http.ts (new)
- packages/quay/src/serve.ts
- packages/quay/src/server-state.ts
- packages/quay-native/src/store.ts
- plugin/scripts/write-json-atomic.ts
- plugin/scripts/shape-sections.ts
- plugin/scripts/worktree-process-reaper.ts
- plugin/scripts/driver-shared.ts
- plugin/scripts/mirror-pair-drift-allowlist.json
- plugin/scripts/capability-catalog.sh
- plugin/scripts/develop-deliver-tgz.sh
- experiments/quay-perpetual-stream/scripts/write-json-atomic.ts
- packages/quay/scripts/build-dist.mjs
- packages/quay/scripts/esbuild-sea.mjs
- plugin/import-graph-baseline.json
- plugin/test/worktree-process-reaper.test.mjs
- plugin/test/suite-slot-ssot-check.test.mjs
- plugin/test/promotion-driver-s08.test.mjs
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- packages/quay-native/test/gate-shape-dispatch.test.mjs
- packages/quay/test/serve.test.mjs
- tasks/gap-arch-reverse-edges-zero.md

（若实现者把 kernel 拆成别的模块名，新增文件仍属本任务 Touches，须在同一次编辑里补进本清单。已按 §8-①b 的裁定结果补入 `kernel/control-state.ts`、`kernel/control-plane-http.ts`、`plugin/scripts/driver-shared.ts`，以及随注释修正一并改动的两个构建脚本；另按 scoped 门实测结果补入 mirror-pair 的两处落点 —— 见 Notes §「scoped 门红」。`mirror-pair-drift-allowlist.json` 最终**内容未变**，但它是本轮实际编辑过的路径，按纪律仍留在清单里。**第 2 轮**（fan-in suite 红：两条与本改动真实相关的回归面）另补入 `capability-catalog.sh`（失效前提句被本改动打成字面命中）、`develop-deliver-tgz.sh`（运送闭集的实现落点 + 成员判定）、以及两条回归面测试 —— 见 Notes §「第 2 轮」。）

## AC

- [x] AC1（判据取假，负控制）在任务 worktree 里**临时**加一条 `packages/quay/src/<file>.ts` → `plugin/scripts/<x>.ts` 的 import，`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` 的 `reverseEdges` 增加且命令 exit 1；撤销后 exit 0 且 `reverseEdges` 为空数组。**两次输出（含 `reverseEdges.length`）贴进 notes。** ⛔ 若撤销前后读数相同 ⇒ 判据未取假，本任务不算完成。
- [x] AC2（目标读数，两个独立读法互校）在真实仓库根跑 AC-307 的判据本体 `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` ⇒ `evaluated===true` 且 `Array.isArray(reverseEdges) && reverseEdges.length === 0`；**同时** Proposal 里那条 `git ls-files` 位置判据的 grep 输出行数 = 0。**两者不一致 ⇒ 报仪器故障，不得只信其一**（硬规则 4 推论二检测半边）。
- [x] AC3（kernel 边界）`packages/quay/src/kernel/` 下每个 tracked `.ts` 的 import 均只指向 `node:*` 或 kernel/ 内文件；同一次 `--json` 的 `kernelChecked===true` 且无 kernel 越界项。`worktree-process-reaper.ts` **未被整文件搬入**（仍在 `plugin/scripts/` 且仍 import `./gate-script-base.ts`）。
- [x] AC4（生产载体，非 fixture —— 硬规则 4 推论三；**本任务最重要的一条**）在任务 worktree 内构建真产物并对其取读数：`bash packages/quay/scripts/package.sh` 产出的 dist bundle 中**不再内联 plugin 层路径**——对 `packages/quay/dist/quay.js` grep `plugin/scripts/{write-json-atomic,shape-sections,driver-shared,worktree-process-reaper}` 命中 0，或对每条仍存在的命中给出逐条说明；且 `node --test packages/quay/test/npm-pack-e2e.test.mjs` 与 `node --test packages/quay/test/build-dist.test.mjs` 绿。**命令与关键输出行贴进 notes。** ⛔ 只跑 `--json` 检查器不算本条的证据。
- [x] AC5（棘轮方向）`plugin/import-graph-baseline.json` 的 `reverseEdges` 值 = 0，且 notes 里说明本任务是**降低**基线而非抬高；`import-graph-check --selftest` 中「把基线任一值调高相对 HEAD 基线 ⇒ exit 1」的用例仍通过。
- [x] AC6（回归面不破）`scripts/test.sh` 的 scoped/静态入口（见其头注释）在本任务 Touches 上全绿；另单独跑并贴出：`plugin/test/worktree-process-reaper.test.mjs`、`plugin/test/suite-slot-ssot-check.test.mjs`、`packages/quay-native/test/gate-shape-dispatch.test.mjs`、`packages/quay/test/serve.test.mjs`。
- [x] AC7（注释不成为假话）三处注释（`quay-native/src/store.ts:36-41`、`server-state.ts:32-35`、`serve.ts:31-35`）中不再有「这些模块住在 plugin/scripts/ 是因为 quay-init 不铺 packages/ 树」这类**与落地后事实相反**的句子；`git diff` 里能看到它们被改写为 kernel 侧的可达性论证。

## DoD

真实落地标准（DIR-026 Reading A）：**判据已在真实仓库上取到 0，且在真产物（npm-pack tarball / dist bundle）上验证过产品仍自包含**——不是「检查器在 fixture 上绿了」。**负控制已实做并留证**（AC1 的注入-撤销两次输出）。`serveControlPlane` 的选择（注入 / 下沉）与理由写在提交信息与 notes 里。**不修改 Provider ABI 与公开 CLI/MCP 表面**（`packages/quay/src/abi.ts` 及其 provider 契约）；**不改 `packages/**` 之外的语义**；**不动 `ff-merge.ts` 的运行时 spawn**；**不删任何 plugin 侧旧路径**（re-export 保留一个发布周期）。落地后 `bash plugin/scripts/capability-catalog.sh --summary` 的脚本数自报值不变（三个文件仍在原位，只是内容改为 re-export），UNCLASSIFIED=0。

## Notes

### §8-①b 裁定：`serveControlPlane` **下沉 kernel**，不注入（三条实测依据）

1. **注入没有注入者。** `startServer()` 全仓库唯一调用点是 `packages/quay/src/cli/serve.ts` —— 它本身就在 `packages/**` 下，与 `serve.ts` 一样拿不到 plugin 侧实现。注入的净效果是产品里 MCP 控制面**静默永不起**（GOAL-017/AC-251 的全部意义就是 `quay serve` 一个 pid 同时托管 web + control），且没有任何检查会报。
2. **「运行时解析缺省实现」会破坏产品自包含**，而那正是本任务 AC4 量的东西：用计算路径 resolve `plugin/scripts/driver-shared.ts`（`ff-merge.ts` 的 spawn 手法）会让 dist 依赖一个只在开发检出里存在的 `.ts` ⇒ 它按构造满足 import 图检查器，却让产品更不独立。任务体原文对这条形态已有预警（「把一条能被 import 图读到的边，改成在消费者里解析不到的边」）。
3. **「下沉会把 driver 语义带进 L0」经实测被证否。** `serveControlPlane` 的传递闭包 = {`kernel/control-state.ts`, `kernel/control-plane-http.ts`, `kernel/write-json-atomic.ts`} + `node:fs` / `node:path` / `node:http` / `node:crypto`，**够不到 driver 运行时**：`resourceGateCheck`、`resolveResourceGateScript`、`spawnSync`、`fileURLToPath` 全部留在 `plugin/scripts/driver-shared.ts` 原位未动（该文件 504 → 118 行）。真正下沉的是「控制态 + 身份闸 + MCP 托管」这一域，而 `packages/quay/src/serve.ts` 自 stage A2（AC-251）起就在本进程内托管它 ⇒ 按 L0 的定义它已是共享原语。

**方向**：`plugin/scripts/*.ts` re-export kernel（`export * from "../../packages/quay/src/kernel/…"`），恒为 plugin → kernel。kernel 侧无一条边反向。

### AC1 — 负控制（注入 → 撤销 两次输出）

探针 `packages/quay/src/ac1-reverse-edge-probe.ts`（临时，`git add -N` 使其进入 `git ls-files` 节点集，测毕删除并 `git reset`）：

```
=== WITH the injected import ===   import { isDirectEntry } from "../../../plugin/scripts/gate-script-base.ts";
exit=1
reverseEdges.length = 1
    {'from': 'packages/quay/src/ac1-reverse-edge-probe.ts', 'to': 'plugin/scripts/gate-script-base.ts', 'line': 2}
verdict.over = ['reverseEdges']

=== AFTER revert ===
exit=0 ; evaluated = True ; reverseEdges = [] -> length 0 ; kernelChecked = True kernelViolations = 0
```

两次读数不同 ⇒ 判据确实能取假。（第一次试跑用了 `../../plugin/…` 两级相对路径，`resolveSpecifier` 解析不到 ⇒ 读数仍 0 —— 这说明该量只计**可解析**的边，探针路径必须真实存在。）

### AC2 — 两个独立读法互校（都在真实仓库根）

- 读法一（判据本体）：`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` ⇒ `exit=0`，`evaluated=true`，`files=432`，`reverseEdges=[]`（length 0），`kernelChecked=true`，`kernelViolations=[]`，`valueSccs=1`，`typeSccs=2`，`baseline={'valueSccs':1,'typeSccs':2,'reverseEdges':0}`，`verdict.ok=true`。（`files` 由 428 → 433 → **432**：新增 5 个 kernel 文件 +1，随后 experiments 侧那一对由真实副本改为符号链接，realpath 去重使两处折叠为**一个**节点 −1。与另外 22 个链接同处理。`dangling` 清单未变。）
- 读法二（位置 grep）：Proposal 里那条 `git ls-files … | grep -nE "^\s*(import|export)…"` ⇒ **行数 = 0**。

两者一致。**kernel 文件必须已 tracked 才有效**：第一次（文件仅存在于工作树、未 `git add`）读数同样是 `kernelChecked=true / 0 violations`，但那是「目录存在而节点集为空」的空转；`git add` 后 `files` 由 428 升到 **433**，读数才是真的 —— 硬规则 3b 的形态，记录在此以免后人误信未 tracked 时的绿灯。

### AC3 — kernel 边界（枚举，非布尔）

`git ls-files 'packages/quay/src/kernel/*.ts'` = 5 个文件，其全部 `import … from` / `export … from` 语句：

```
kernel/control-plane-http.ts:22  import path from "node:path";
kernel/control-plane-http.ts:23  import { randomUUID } from "node:crypto";
kernel/control-plane-http.ts:24  import { createServer } from "node:http";
kernel/control-state.ts:46       import fs from "node:fs";
kernel/control-state.ts:47       import path from "node:path";
kernel/control-state.ts:48       import { writeJsonAtomic } from "./write-json-atomic.ts";
kernel/proc-identity.ts:29       import fs from "node:fs";
kernel/proc-identity.ts:30       import path from "node:path";
kernel/write-json-atomic.ts:32   import fs from "node:fs";
kernel/write-json-atomic.ts:33   import path from "node:path";
kernel/write-json-atomic.ts:34   import { randomBytes } from "node:crypto";
```

全部为 `node:*` 或 kernel/ 内文件。`control-plane-http.ts` 另有的 `@modelcontextprotocol/sdk/*` 与 `zod` 是 **`await import()` 惰性裸说明符**，按第四条规则不在「层间越界」范畴内（该规则明示裸说明符不在此列）。

`worktree-process-reaper.ts` **未被整文件搬入**：仍在 `plugin/scripts/`（`git ls-files` 可见），且 `:82` 仍 `import { isDirectEntry } from "./gate-script-base.ts";`，`:86` 仍 import `./suite-lock-slots.ts`；只把两个叶子谓词提走并在文件顶部 `import { readProcCmdline, isQuayServe } from "../../packages/quay/src/kernel/proc-identity.ts"; export { readProcCmdline, isQuayServe };`。

### AC4 — 真产物（**本任务最重要的一条**）

```
$ bash packages/quay/scripts/package.sh          # exit 0
  ... dist-closure gate OK: 98 referenced dist bundles all present in quay-0.10.0-dev.tgz
  Artifact: packages/quay/dist/../../packages/quay/quay-0.10.0-dev.tgz   (12.4 MB, 513 files)

$ grep -c "plugin/scripts/<name>" packages/quay/dist/quay.js   (2474591 bytes)
  plugin/scripts/write-json-atomic     -> 0
  plugin/scripts/shape-sections        -> 0
  plugin/scripts/driver-shared         -> 0
  plugin/scripts/worktree-process-reaper -> 0
```

bundle 里 **13 行**仍含 `plugin/` 字样，**逐条说明（全部为运行时耦合 / 文案，无一条是 import 边）**：`path.join(root, "plugin/scripts/drivers.yml")` 读文件；`task-status-drift-check.ts` / `runtime-usage-inventory.ts` / `loop-driver-check.sh` / `dark-axis-record-check.ts` 的 **spawn 目标或存在性探测**；`quay-init.sh` 出现在工具帮助文案与错误消息里；另有 1 行注释。这与任务体点名「`ff-merge.ts` 的运行时 spawn 不算边、不得顺手改」是同一条边界。

两条测试（AC4 要求）：
- `node --test packages/quay/test/npm-pack-e2e.test.mjs` ⇒ **11 pass / 0 fail**，exit 0（其中包含「tarball 必须携带整个 plugin bundle」「bin 解析到 dist/quay.js」「installed `quay task list` 真 provider 往返」）。
- `node --test packages/quay/test/build-dist.test.mjs` ⇒ **7 pass / 0 fail**，exit 0。

### AC5 — 棘轮方向：**降低**基线

`plugin/import-graph-baseline.json` 的 `reverseEdges` 由 **5 → 0**（降低方向，无需仪式，但改动已提交）。`valueSccs=1` / `typeSccs=2` 未动（实测未变，见 AC2）。

`node --experimental-strip-types plugin/scripts/import-graph-check.ts --selftest` ⇒ **PASS — all 9 case(s) behaved**，exit 0，其中含 `baseline-raised-above-head`：`equal⇒0 · lowered⇒0 · raised(+1)⇒1 · missing-baseline⇒2`（把基线任一值调高相对 HEAD ⇒ exit 1 的用例仍通过）。

### AC6 — 回归面

- `plugin/test/worktree-process-reaper.test.mjs` ⇒ **22 pass / 0 fail**
- `plugin/test/suite-slot-ssot-check.test.mjs` ⇒ **20 pass / 0 fail**
- `packages/quay-native/test/gate-shape-dispatch.test.mjs` ⇒ **14 pass / 0 fail**
- `packages/quay/test/serve.test.mjs` ⇒ **1 pass / 0 fail**（97.5 s，QN-031 serve/action 全组）
- `plugin/test/driver-shared.test.mjs` ⇒ **7 pass / 0 fail**
- `experiments/quay-perpetual-stream/test/write-json-atomic.test.mjs` ⇒ **2 pass / 0 fail**
- `scripts/test.sh --for-task gap-arch-reverse-edges-zero --allow-thin` ⇒ 见 §「scoped 门红」与提交信息

`bash plugin/scripts/capability-catalog.sh --summary` ⇒ `341 scripts | 341 declared | 0 unclassified | 336 ship` —— 与主检出读数**逐字相同**（三个文件仍在原位，只是内容改为 re-export）。

### scoped 门红：mirror-pair-drift-check + sync-vendor --check（**修因；且我第一轮把方向判错了**）

第一次 `scripts/test.sh --for-task … --allow-thin` ⇒ `STATIC_CHECK_FAILED: mirror-pair-drift-check exit=1`：
```
DRIFT: plugin/scripts/write-json-atomic.ts vs experiments/quay-perpetual-stream/scripts/write-json-atomic.ts — not allow-listed
```
按「按自身目录深度改写相对路径 + 登记 allow-list 豁免」改完后第二跑，`sync-vendor.sh --check` 又红：
```
[sync-vendor --check] DRIFT: scripts/write-json-atomic.ts differs between source and destination
```

**⚠️ 方向先判错了一次，记在这里免得后人重走**：我以为 canonical 在 plugin 侧、experiments 是镜像。**实际相反** —— `plugin/scripts/sync-vendor.sh` 的 `SYNC_SCRIPTS` 把 `experiments/quay-perpetual-stream/scripts/<s>.ts` **镜像进** `plugin/scripts/<s>.ts`（`--check` 用 `cmp` 断言两侧逐字节相同）。所以「按 experiments 的深度改路径」既没修好 sync-vendor，也把 allow-list 用错了地方。

**正解 = 该仓库对这一形态的既有约定：符号链接。** `experiments/quay-perpetual-stream/scripts/` 下有 22 个指向 `../../../plugin/scripts/<name>.ts` 的链接，而 `sync-vendor.sh:333` 的 `if [ -L "$src_file" ]; then … skip` 正是为它们写的。同在该 `SYNC_SCRIPTS` 里、**同样 import `packages/quay/src/...`** 的 `anti-drift-touches-check.ts` 就是链接（`git ls-files -s` = `120000`）⇒「plugin 复制品里有 packages 相对路径」这件事，仓库早就用链接解决过，本案只是第 24 个。

⇒ 落点：`experiments/quay-perpetual-stream/scripts/write-json-atomic.ts` → `../../../plugin/scripts/write-json-atomic.ts`（git mode `120000`）。`plugin/scripts/mirror-pair-drift-allowlist.json` **已还原为原始两条条目**（中途新增的那条不再需要）。

四条复验：
- `bash plugin/scripts/sync-vendor.sh --check` ⇒ `CLEAN: all files verified, no drift detected`（exit 0）
- `mirror-pair-drift-check` ⇒ `PASS — every mirror pair matches or is allow-listed with an unchanged signature.`
- `node --test experiments/quay-perpetual-stream/test/write-json-atomic.test.mjs` ⇒ 2/2 绿（该测试 import 的正是这个路径；链接解析得到并导出 `writeJsonAtomic`）
- `import-graph-check --json` ⇒ `files` 433 → **432**（realpath 去重），其余读数不变

**⛔ 没有把检查器改绿**：allow-list 回到原样、未新建豁免；两个检查都是靠**内容真实成立**过的，不是靠豁免过的。

### AC7 — 注释不成为假话

三处点名的注释已改写（`git diff` 可见），新的论证是 kernel 侧可达性论证而非删除。**同轮另发现并修掉两处同形假话**（硬规则 5b：修好一个不等于只有这一个）：
- `plugin/scripts/worktree-process-reaper.ts` 文件末尾的 `isDirectEntry` 理由段原写「serve.ts 现在 import 本模块 ⇒ reaper 被 inline 进 quay bundle」—— 本改动后该前提消失，已改为「该 inlining 已随本任务消失，NAME-based guard 仍保留（本文件仍被 import 它的 PLUGIN bundle inline、仍被 ff-merge 直接 spawn）」。
- `packages/quay/scripts/build-dist.mjs` 的 `bundleNodePaths` 与 `packages/quay/scripts/esbuild-sea.mjs` 的 `nodePaths` 注释原以「serve.ts inline plugin/scripts/driver-shared.ts」为理由 —— 已标明该理由随本任务失效、机制保留为防御（additive），并指明当前真正的判据是 `reverseEdges === 0`。

全仓库再 grep「quay-init 铺机制层但不铺 packages/ 树」这一说法，唯一命中在 `kernel/shape-sections.ts` 内部，且处于「**该旧理由现已是假**」的引述句中，非断言。

### 与 Proposal 5 条边的对账

实现后 5 条边全部消失，**无一条为凑数而被改检查器**：`serve.ts` 三条 → `./kernel/{control-plane-http,write-json-atomic,proc-identity}.ts`；`server-state.ts` 一条 → `./kernel/write-json-atomic.ts`；`packages/quay-native/src/store.ts` 一条 → `../../quay/src/kernel/shape-sections.ts`。Proposal 表格的行号（`:36/:38/:42/:38/:42`）与实现前实测一致，未出现差异。

### 第 2 轮（fan-in suite 红 = `fail 2`：两条**都是本改动引起的真实回归**，⛔ 不是环境问题）

上一轮 exited-not-landed 的 suite 红是 `fail 2`，两条都落在**本改动真实触及的判据面**上。delta 提示两条都标 `UNRELATED`（测试文件不在 Touches、单跳 import 不相交）—— **提示这次是错的**，而且错得有结构原因：这两条判据读的都不是 import 图（一条 grep 源码字面量、一条跑 shell 的运送闭集自检），所以「单跳 import 不相交」这个谓词对它们**按构造取不到真**。按纪律**先在 worktree 里各复跑一遍**确认可复现，才动手。

**① `promotion-driver-s08.test.mjs` AC150-3 —— 判据把「一份实现」钉在了文件位置上。**
原断言 `assert.match(sharedSrc, /export function isHalted/)`（sharedSrc = `driver-shared.ts`）。本改动把 halt 实现下沉 kernel（现 `packages/quay/src/kernel/control-state.ts:149`），`driver-shared.ts` 改为 `export *` 转出 ⇒ 该断言按字面取假，**而「单份实现」这个不变量仍然成立**（函数级 identity 的两条断言本来就通过，本轮的失败点只有这一条位置 grep）。
修正 = 断言改成「**每条判定各只有一处 DEFINITION**」：`resourceGateCheck` ∈ `driver-shared.ts`、`isHalted` ∈ `kernel/control-state.ts`，其余三处 `doesNotMatch` 一字未动（复制粘贴仍取假），并**新增**一条转出口断言 `export * from "../../packages/quay/src/kernel/control-state.ts"`（否则该文件可以悄悄变成一个 stub，而 identity 断言会因为 stub 恰好等于 worker 侧那条链而仍然通过）。
⚠️ **AC150-3 的判据正本未改，也无需改**：`orchestration/manager-phase-goal.md:1150` 与 `goals/AC-150-*.md:25` 写的是「**必须是与 worker-driver 共用的同一份**（函数级复用，不是复制粘贴）。**⊢ 本条是给下一阶段分层留的接口：先共用，再上收**」——**位置无关**，而本改动正是它预留的「再上收」，按原判据仍成立。
⛔ **没有为了变绿而放宽**：新断言比原来**多**一条（转出口），取假面比原来更宽。同轮 5b 扫过 `plugin/test/worker-driver-fan-in-s01.test.mjs` 与 driver 测试 harness 里的同形断言 —— 两者用的是**函数引用 identity**、不是位置 grep ⇒ 本来就对，不动。

**② 运送闭集（shipped-set closure）—— 本改动第一次把一条「跨树相对 import」带进了跨机运送集。**
`plugin/scripts/write-json-atomic.ts` 现在是 re-export shim（内容 = `export * from "../../packages/quay/src/kernel/write-json-atomic.ts"`）。`develop-deliver-tgz.sh` 把这个集合**扁平** scp 到远端 `$HOME/`（`scp "${flat[@]}" "${target}:~/"`）⇒ 远端那份 shim 会去找 `$HOME/../..` 下的 `/packages/...` ⇒ **远端 MODULE_NOT_FOUND，而本地全绿**。这正是任务体点名要防的形态（「把一条能被 import 图读到的边，改成在消费者里解析不到的边」），只不过消费者是跨机运送面而不是 dist。自检如实地报了它：
`IMPORT-UNSHIPPED: write-json-atomic.ts imports ../../packages/quay/src/kernel/write-json-atomic.ts — not in the shipped set`。

**修因（两处，都不是把检查器调绿）**：
- **`transport_flat_files`**：该条由 `plugin/scripts/write-json-atomic.ts`（shim）改为 `packages/quay/src/kernel/write-json-atomic.ts`（**实现叶子** —— 只 import `node:fs/node:path/node:crypto`，扁平下去自足）。扁平运送使两者落点同名 `$HOME/write-json-atomic.ts`，两个远端消费者（`verify-deliver-coldstart.sh` 的 `$SCRIPT_DIR/write-json-atomic.ts`、`runner-state-write.ts` 的 `./write-json-atomic.ts`）**都仍解析得到**。⚠️ 该清单里**本来就有**一条树外条目（SPEC 的 `.md`）⇒「条目可以不在 `$SCRIPT_DIR` 下」不是新造的先例，只是第一次用在 `.ts` 上。
- **成员判定改为按「远端名」**：原判据 `in_shipped "${SCRIPT_DIR}/${imp#./}"` 把**本地路径**当成了**远端路径** —— 在全部条目都住 `$SCRIPT_DIR/` 时恰好等价，一旦有树外条目就变成**假红**（会把一条正确运送的文件报成未运送，而它的「修法」是把该文件**撤出**运送集）。改为按 basename 判定，这正是它自己注释写的意图（"a ./ relative import that is itself shipped"）；**同时**把 `../` 与 `./sub/x` 拆成两条独立判词（`IMPORT-ESCAPES-REMOTE` / 平面布局无子目录），因为对扁平远端两者有**不同的修法**。⛔ **不是放宽**：`../` 在扁平远端按构造解析到 `$HOME` 之外，**仍然报红**。

**负控制（新分支必须能取假，实测两轮 + 还原）**：临时往 `plugin/scripts/repo-root.ts` 各追加一条 import，跑 `--selfcheck-transport-closure`，随后 `git checkout --` 还原（`diff` 对备份逐字相同）：
```
追加 export * from "../../packages/quay/src/kernel/write-json-atomic.ts";
  ⇒ positive → violations=1（⛔ 期望 0）；IMPORT-ESCAPES-REMOTE: repo-root.ts imports … ⇒ FAIL
追加 import "./nope/x.ts";
  ⇒ positive → violations=1；IMPORT-UNSHIPPED: repo-root.ts imports ./nope/x.ts — the remote layout is flat ⇒ FAIL
还原后 ⇒ positive → violations=0；6 组控制全部按期望取值；PASS（exit 0）
```
⇒ 新分支**实测能取假**，且**原缺陷形态仍被抓住**（只是换成了更精确的判词）。

**两个独立读法互校（硬规则 4）**：`--selfcheck-transport-closure` 的 `positive → violations=0`（判据本体）与测试 ⑥ 里**镜像 `transport_flat_files()` 推导出的** `drop-gate-script-base → violations=3`（= 消费者中值-import `./gate-script-base.ts` 的 shipped `.ts` 数，**不是钉死的字面量**）一致。同轮把测试 ⑥ 的镜像捕获从「basename 形」改为「相对 `plugin/scripts` 的路径形」—— 否则该镜像会把树外那条**静默漏掉**，两个读法就会**靠遗漏而一致**（那正是这条测试自己的注释在防的形态）。

**③ 5b 扫描（修好一个 ≠ 只有这一个）：`capability-catalog.sh` 的失效前提句被本改动打成字面命中。**
`[write-json-atomic.ts]` 的失效前提含触发句「**若 … state 写载体迁出 plugin/scripts/，本条退休**」——本改动正是把**实现**迁出 `plugin/scripts`。逐条查其余被搬模块：`shape-sections.ts` / `worktree-process-reaper.ts` 的前提都是「无可测前提，靠周期复核」⇒ **只有这一条命中**。
**处置 = 改写前提并在句内写明读法（既不静默退休，也不静默无视）**：本条的**断言对象**（本路径仍是 plugin 侧取用 `writeJsonAtomic` 的唯一入口）**未失去** ⇒ 不退休；判据由「实现在哪个目录」改成「本路径是否仍是唯一入口」。
⚠️ **这是扩范围的动作，理由与两种读法都写在句内，并明确标为可被推翻**：字面条件成立、而后果（退休）会让一个**活着的机件从清册里消失**，那比留一句不精确的前提更贵。
同轮还实测到该前提**原有的 import 者名单已经失真**（两处都**不是**本改动造成的：`driver-shared.ts` 现经 `kernel/control-state.ts` 间接取用、不再直接 import 本路径；`proposal-convergence.ts` 早已 import 本路径却从来不在名单里）⇒ 句内已标注「前提里不要再钉死 import 者名单或处数」。
`capability-catalog.sh --summary` 复跑 = `341 scripts | 341 declared | 0 unclassified | 336 ship`，与主检出**逐字相同** ⇒ DoD 的该条仍成立。（该文件自 2026-09-10 起不在 quay-init 的 `LAYDOWN_SOURCES` 里，改它不触发 closure-ratchet ⇒ 无需 `--reanchor`。）

**本轮回归面（改动后实测）**：
- `node --test plugin/test/promotion-driver-s08.test.mjs` ⇒ **5 pass / 0 fail**
- `node --test plugin/test/develop-deliver-tgz-evidence-transport.test.mjs` ⇒ **20 pass / 0 fail**
- `bash plugin/scripts/develop-deliver-tgz.sh --selfcheck-transport-closure` ⇒ exit 0，PASS
- `bash -n` 两个被改的 shell 文件 ⇒ 语法 OK
