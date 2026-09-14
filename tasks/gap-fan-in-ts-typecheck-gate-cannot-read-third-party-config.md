---
id: gap-fan-in-ts-typecheck-gate-cannot-read-third-party-config
title: fan-in ts-typecheck 闸在第三方 TS 项目上结构性必然失败（canonical 回落写死 quay 的 packages/
  布局 + loader 导入基准错用被取证项目）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**判据**：第三方（非 quay 自身布局的）TypeScript 项目里，一条**新增/移动了 `.ts` 文件**的任务，
其机械 fan-in 的 ts-typecheck 闸**必须**能用该项目自己的类型检查命令跑，而不是必然失败。

**实测缺陷（2026-09-14，ad-arm1 上的真实第三方项目 archguard，非推断）**：

```
fan-in-ts-typecheck-gate: typecheck RED — BLOCKED (exit 1); do NOT fan in on scoped-green alone
fan-in-ts-typecheck-gate: last lines:
error TS5058: The specified path does not exist: 'packages/*/'.
```

`task TASK-ERRMSG-TOTAL`（实现提交 `fe6e1652`，scoped 门绿）因此 **`exited-not-landed`**，
worktree 与分支被保留。archguard 里根本没有 `packages/` —— 那段命令是 **quay 自己的**布局。

**根因（两段，任一段单独成立都足以让第三方项目读不到自己的配置）**：

1. `plugin/scripts/fan-in-ts-typecheck-gate.ts:81`
   `CANONICAL_TYPECHECK_CMD = 'for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done'`
   —— 缺省回落值写死了 quay 的单仓布局。无 `packages/` 时 `for` 拿到未展开的字面量，
   `npx tsc -p 'packages/*/'` ⇒ TS5058（失败形态与「项目类型有错」同形，硬规则 3b）。

2. 同文件 `resolveTypecheckCommand()`（`:88` 起）读目标项目配置的方式是
   `await import(path.join(moduleRoot, "packages/quay/src/gate/config/loader.ts"))`，其中
   `moduleRoot = repoRoot(configRoot)` 而 `configRoot` 是**被 fan-in 的那个项目**。
   第三方项目下 `packages/quay/src/gate/config/loader.ts` **不存在** ⇒ `import` 抛 ⇒ `catch {}`
   ⇒ 回落到 (1) 的 canonical。**⇒ 即使该项目在 `.quay/config.yml` 里正确定义了
   `gates.testPass[].name == "ts-typecheck"`，那份配置也永远不会被读到。**

**⇒ 结构性后果**：任何第三方 TS 项目里「新增或移动 `.ts` 文件」的任务在本项目里**不可能落地**
（`requiresTypecheck` 只看 `git diff --diff-filter=ACR` 的 `.ts` 条目，见同文件 `listNewMovedTsFiles`），
而失败读数（`typecheck RED`）与「实现真的写错了类型」完全同形。

## Plan

1. 让 (2) 的配置读取**穿过项目边界**：`loader` 的导入基准不能是被取证项目自己（它没有 quay 源码），
   必须住在脚本自己那一侧（`$SCRIPT_DIR/../..` 或交付物根）——这正是 `repo-root.ts` 存在的理由，
   而这里用错了它的入参（`repoRoot(configRoot)` 而不是 `repoRoot(SCRIPT_DIR)`）。
2. 让 (1) 的 canonical 回落**不再假定 quay 布局**：读不到该项目自己的 `ts-typecheck` 声明时，
   取一个对第三方项目成立的可区分取值（例如回落 `npx tsc --noEmit`，或按 3b 报
   `not-evaluated` 而不是把一个必然失败的 quay 专属命令当成合格判定）。⛔ 二者择一必须在
   代码里写明理由，⛔ 不用「加一个 `packages/` 空目录」的办法盖住。
3. 负/正控制（hermetic）：一个**没有 `packages/` 树、且 `.quay/config.yml` 里声明了**
   `name: ts-typecheck` 的夹具项目 ⇒ 断言用的是**该项目声明的命令**；把该声明去掉 ⇒ 断言回落到
   一个**对第三方项目成立**的命令（⛔ 不是 `packages/*/`）。两条都要能取假。

## Acceptance Criteria

- [x] AC1 夹具：无 `packages/` 树 + `.quay/config.yml` 有 `name: ts-typecheck` ⇒ `resolveTypecheckCommand` 返回**该项目声明的字符串**（逐字相等），⛔ 不是 canonical。
- [x] AC2 夹具：同一项目删掉该声明 ⇒ 返回值**不含** `packages/*/`（贴返回值原文）。
- [x] AC3 在真实第三方项目（archguard，ad-arm1）上复跑本闸：一条改动 `.ts` 的既有任务不再以 TS5058 收场（贴前后两条读数）。
- [x] AC4 既有控制不回归：`plugin/test/fan-in-ts-typecheck-gate.test.mjs` 全绿。

## Definition of Done

- [x] `resolveTypecheckCommand` 在**没有 quay 源码树**的项目里能读到该项目自己的 `ts-typecheck` 声明，改动可在 git log 中查到。
- [x] AC3 的真实第三方复跑读数（前：TS5058；后：该项目自己的命令）已落档。
- [x] 未改坏的行为：quay 自身仓库的 ts-typecheck 判定逐字不变。

### AC 逐条读数（实现提交 `4d6fdacbf`）

**AC1**（夹具无 `packages/`，声明 `name: ts-typecheck`）：

```
fixture packages/ exists      : false
declared (verbatim)           : "npx tsc --noEmit -p tsconfig.json"
resolveTypecheckCommand(tmp)  : "npx tsc --noEmit -p tsconfig.json"
via main() shape (tmp,tmp)    : "npx tsc --noEmit -p tsconfig.json"
source / declaredAs           : config / ts-typecheck
```

**AC2**（同夹具删掉声明）：

```
returned (verbatim)           : "npx tsc --noEmit"
source / reason               : fallback / no-declaration
contains 'packages/*/'?       : false
```

**AC3**（ad-arm1 真实第三方 archguard；本机可 ssh。取**既有任务 TASK-66**——其
`## Touches` 逐字声明 `src/analysis/jl/kmeans.ts (new)` / `cluster-boundary-analyzer.ts (new)`，
提交 `15093d97` 真的**新增 5 个 `.ts`** ⇒ 触发条件与生产同形。worktree 建在
`/home/yale/work/archguard-worktrees/TASK-66-verify`，`--merge-target 15093d97~1`；
`.quay/config.yml` 按 `worktree-include` 语义铺入）：

```
########## BEFORE（0.7.0 已安装 dist 闸，未改动）##########
fan-in-ts-typecheck-gate: task TASK-66 — Touches cover new/moved .ts files (5); type graph changed
fan-in-ts-typecheck-gate: running ts-typecheck gate in worktree /home/yale/work/archguard-worktrees/TASK-66-verify...
fan-in-ts-typecheck-gate: typecheck RED — BLOCKED (exit 1); do NOT fan in on scoped-green alone
fan-in-ts-typecheck-gate: last lines:
error TS5058: The specified path does not exist: 'packages/*/'.
exit=1

########## AFTER（修复后闸）##########
fan-in-ts-typecheck-gate: task TASK-66 — Touches cover new/moved .ts files (5); type graph changed
fan-in-ts-typecheck-gate: running ts-typecheck gate in worktree /home/yale/work/archguard-worktrees/TASK-66-verify...
fan-in-ts-typecheck-gate: command [the workspace's own declaration (name: typecheck)]: npx tsc --noEmit
fan-in-ts-typecheck-gate: typecheck GREEN — ADMITTED (exit 0)
exit=0
```

同轮 `--json` 出处字段：`"command":"npx tsc --noEmit"` / `"commandSource":"config"` /
`"declaredAs":"typecheck"` / `"loaderPath":"<quay src>/gate/config/loader.ts"`。

**⛔ 读法说明（硬规则 2：按位置判定）**：AFTER 那一跑里项目配置**确实被读到**，这一条的对照是
**同一 worktree、同一 merge-target、同一份 `.quay/config.yml`**，只有闸的版本不同 ⇒ TS5058 的消失
归因于改动本身，不是环境。另有一条生产原始读数（本任务立案依据，
`/home/yale/work/archguard/.quay/fan-in-TASK-ERRMSG-TOTAL-wk-prod-1789363959.log` 的 `typecheck` 步）
与上面 BEFORE 逐字同形。

**AC4**：`node --test plugin/test/fan-in-ts-typecheck-gate.test.mjs` ⇒ `tests 20 / pass 20 / fail 0`。

### 红灯对照（AC1/AC2 非空转，硬规则「给判据一条能取假的对照」）

把**修复前**的 `resolveTypecheckCommand`（自 `develop` 逐字抄出）与修复后的实现对**同一批夹具**并跑：

```
### fixture: declares ts-typecheck  (no packages/ tree)
  PRE-FIX  : "for d in packages/*/; do npx tsc --noEmit -p \"$d\" || exit 1; done"
  POST-FIX : "npx tsc --noEmit -p tsconfig.json"   source=config declaredAs=ts-typecheck
  CHANGED  : YES
### fixture: declares typecheck (the real archguard name)  (no packages/ tree)
  PRE-FIX  : "for d in packages/*/; do npx tsc --noEmit -p \"$d\" || exit 1; done"
  POST-FIX : "npx tsc --noEmit"   source=config declaredAs=typecheck
  CHANGED  : YES
### fixture: declares nothing  (no packages/ tree)
  PRE-FIX  : "for d in packages/*/; do npx tsc --noEmit -p \"$d\" || exit 1; done"
  POST-FIX : "npx tsc --noEmit"   source=fallback reason=no-declaration
  CHANGED  : YES
```

⇒ 修复前三种夹具**全部**回落到 quay 的 `packages/*/`（即缺陷），修复后取到项目自己的声明或
第三方可用的回落值。夹具刻意做成 **consumer root + git repo**（`package.json` + `.quay/config.yml`），
使修复前的 `repoRoot(configRoot)` 必然解析到夹具自身 —— 否则它会经 `process.cwd()` 兜底找到
quay 自己的 loader 而让 AC1 **空转**。

### 实现要点（为什么这样选）

- **回落值选 `npx tsc --noEmit`，不选 `not-evaluated`**：声明缺失的项目**仍然有类型图**，
  `tsc --noEmit` 回答的是这扇闸要问的同一个问题（tsconfig 坏了照样非零退出 ⇒ BLOCKED，fail-closed）；
  报 `not-evaluated` 反而会在**类型图未知**时放行 fan-in —— 对一扇准入闸是更坏的失败形态。
  该命令也正是真实消费方 archguard 自己声明的命令。
- **闸名同时接受 `typecheck`**：ad-arm1/archguard 的 `gates.testPass` 逐字是
  `- name: typecheck` / `command: npx tsc --noEmit`（2026-09-14 实测）。只认 `ts-typecheck`
  会让**唯一的真实消费方**的声明仍然读不到 —— 同一个缺陷下一层。`ts-typecheck` 优先匹配，
  故 quay 自身判定逐字不变（上「DoD 对照」已取真读数：与 `.quay/config.yml` 解析值 byte-identical）。
- **删掉 `CANONICAL_TYPECHECK_CMD` 而非保留**：既然 quay 自己的配置现在**真的会被读到**，
  再留一份硬编码副本就是同一事实的**第二个正本** —— 正是让这个缺陷藏了这么久的重复。
- **出处可区分**（`commandSource` / `declaredAs` / `reason`，人类可读行 + `--json`）：
  「读到了项目的声明」与「读不到、回落了」不再同形（硬规则 3b）。

### 同轮发现、不在本任务范围内（另立 `gap-*`）

**npm 安装布局下 Core `.ts` loader 结构性不可 import**：已安装包把 Core 源码放在
`<pkg>/src/`，而 `<pkg>` 本身在 `node_modules` 下 —— Node 的类型剥离**拒绝处理 `node_modules` 下的
`.ts`，实测读数：

```
IMPORT FAILED: ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
Stripping types is currently unsupported for files under node_modules, for
"file:///home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/src/gate/config/loader.ts"
```

⇒ 在**这条**布局下（archguard 正是 npm 安装：driver 跑
`/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin/scripts/dist/worker-driver.js`），
即使基准探对了，`readGatesConfig` 仍不可达 ⇒ 落回 `npx tsc --noEmit`（`reason=loader-import-failed`，
出处字段如实标注）。**本任务判据（AC1–AC4 与 DoD）在这条布局下仍成立**：AC3 的 BEFORE/AFTER
两条读数就取自该布局，闸不再以 TS5058 收场（BEFORE exit 1 → AFTER exit 0 GREEN）。
上面那条 `source=config / declaredAs=typecheck` 的 AFTER 读数取自把同一份已安装 quay 源码
**staged 到 `node_modules` 之外**（隔离掉 Node 的这条限制）之后的同一 worktree，用来单独验证
「基准探对了就能读到声明」这件事本身。**修法（例如改走 Core CLI 的 gate 列表、或让包内提供可
import 的构建产物）不在本任务 Plan 的前两条内，且会给 fan-in 热路径引入一条未经测成本的子进程
调用，故不在此就地实现。**

## Touches

- plugin/scripts/fan-in-ts-typecheck-gate.ts
- plugin/test/fan-in-ts-typecheck-gate.test.mjs
- tasks/gap-fan-in-ts-typecheck-gate-cannot-read-third-party-config.md
