---
id: gap-dist-plugin-missing-node-modules-task-schema-yaml
title: dist-plugin 打包物缺 node_modules，driver 运行时对 task-schema.ts 走 raw 优先解析在离线安装下
  ERR_MODULE_NOT_FOUND('yaml')
status: ready
labels:
  - gap
  - mechanism
  - packaging
parent: null
children: []
extra:
  schema: finding
---
## Finding

**实测（2026-09-14，fleet-warden 在 quay-fleet 真机上装好 quay v0.6.2 后触发，我在本机独立复核过）**：

按官方安装路径把 `quay@quay@0.6.2` 装到 Claude Code 的 project-scope 插件缓存
（`~/.claude/plugins/cache/quay/quay/0.6.2/`，与 quay 开发检出物理隔离、无 node_modules）后，
跑该目录下的 `scripts/dist/start-drivers.js --root <third-party-workspace>` 直接崩溃：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from
/home/yale/.claude/plugins/cache/quay/quay/0.6.2/scripts/task-schema.ts
```

**独立复核（本机直接检查这份安装目录）**：
- `find <cache>/0.6.2/ -iname node_modules` 零命中——这份打包产物里根本没有 node_modules，
  是设计如此（dist bundle 应当自包含、不需要 npm install），不是遗漏步骤。
- `<cache>/0.6.2/scripts/task-schema.ts`（裸源码，随包一起 rsync 进来的）第 127 行
  `import { parse as parseYaml } from "yaml";`——一个真实的 npm 依赖，只有开发检出的
  `node_modules/yaml` 能满足它，打包环境里没有。
- 但 `<cache>/0.6.2/scripts/dist/task-schema.js`（预编译产物）确实存在；
  `scripts/dist/driver-runtime.js` 反查确认 task-schema 的代码也已经被静态内联进这个 bundle
  （grep 命中多处 `// plugin/scripts/task-schema.ts` 源边界注释），说明至少有一条路径是正确走
  预编译 bundle 的。

**根因（与今天已修复的 gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy
同一机制，触发条件不同）**：`plugin-root.ts::resolvePluginScriptExec` 是"raw 优先、dist 兜底"
（源码有 raw `.ts` 副本存在时总是优先选它，只有 raw 缺失才退回 dist）。sync-vendor.sh 把
`scripts/*.ts` 的裸源码和编译产物一起 rsync 进了发布包（供 driver 自身热重载场景使用），
于是即便有对应的自包含 dist/*.js 存在，某条运行时动态解析路径（具体调用点尚未定位到行号——
怀疑是 driver-filters.ts 或 driver-runtime.ts 里对 task-schema.ts 的某次"作为独立脚本动态
resolve+import"而非静态 import 的调用，需要实现者用 `grep -rn resolvePluginScriptExec` 交叉
调用点定位）仍然选中了 raw `.ts`——这条路径在【有 node_modules 的开发检出】里从不报错（能找到
`yaml`），只有在【真正干净的打包安装、无 node_modules】环境下才会现形，因此这个缺陷一直没被
发现，直到今天第一次有人真的按发布物在完全隔离的环境里启动 driver。

**影响面**：任何真正走 project-scope 干净安装（而不是直接跑开发检出）的第三方消费者，
只要触发到这条动态解析路径，driver 启动就会崩溃——这正是今天促成整个"给 quay-fleet 切正式
版本"这件事的最终验收步骤，目前被这个缺陷卡住。

**相关但不同的任务**：`gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy`
（status: ready，本仓库同日已落地一部分）修的是同一个"raw 优先解析器"根子机制下的另一个具体症状——
`touches-orthogonality-check.ts` 里一个写死目录深度的**相对路径导入**在 `packages/quay/plugin/`
这份**构建期 staged 副本**里解析错位。本任务的症状不同、环境也不同：这里是一个真实的**npm 包依赖**
（`yaml`）在**最终发布给终端用户的 plugin cache 安装**（完全没有 node_modules）里找不到——同一族
"raw .ts 在不该被直接执行的布局下仍被选中"，但具体判据、修复点、验证环境都不同，不是重复。

## Evidence

- fleet-warden 报告的完整错误堆栈（见上）。
- 本机独立复核：cache 目录无 node_modules（find 命中 0）；task-schema.ts:127 的 yaml import；
  dist/task-schema.js 存在；driver-runtime.js 反查确认 task-schema 代码已被内联（多处源边界注释）。

## Touches

- packages/quay/src/plugin-root.ts（isPluginSourceCheckout + resolvePluginScriptExec 的 raw/dist 选择）
- packages/quay/test/plugin-root.test.mjs（AC4 Core 半边：shipped 优先 bundle + 源检出负控制）
- plugin/scripts/driver-runtime.ts（isKernelSourceCheckout 镜像 + resolveKernelSibling 同一判据）
- plugin/test/driver-runtime.test.mjs（AC4 kernel 半边 + kernelSiblingArgv 的 argv 断言）
- docs/analysis/quay-init-closure-ratchet.baseline.json（re-anchor：v0.6.3 bump 漏重锚造成的既存 stale 红）
- plugin/scripts/publish-dist-branch.sh（**本任务已落地的发布侧半边**：commit `018253163`，非本分支 delta）
- plugin/scripts/build-plugin-dist.mjs（同上，发布侧预编译入口推导；非本分支 delta）
- plugin/scripts/sync-vendor.sh（同上，随包内容规则；非本分支 delta）
- tasks/gap-dist-plugin-missing-node-modules-task-schema-yaml.md

（发布侧三行由**并行会话**在同一 task id 下落进 develop，本分支不改动它们——把它们留在 Touches 里是为了
让 scoped 门继续覆盖打包面（`plugin-packaging` / `npm-pack-e2e` / `sync-vendor --check`），
并让这条任务的记录完整。）

## Acceptance Criteria

- [x] AC1 定位真实调用点：用 `grep -rn resolvePluginScriptExec` 交叉核对，找到具体是哪一行代码触发了对 task-schema.ts 的动态 raw 解析，贴出文件名+行号+调用上下文，⛔ 不接受"大概是哪里"这种未核实的猜测。
- [x] AC2 复现与修复：在一份【无 node_modules】的干净目录里复现这个 ERR_MODULE_NOT_FOUND（构造一份最小化的、模拟 dist-plugin 打包布局的夹具，或直接在真实的 plugin cache 安装目录上跑），确认修复后同样命令不再报错。
- [x] AC3 不破坏开发检出场景的行为：修复后，在正常的开发检出（有 node_modules）里跑同样的 driver 启动流程，行为不变（不能只为了打包场景牺牲开发时的热重载能力，除非确认这条路径本就不需要热重载）。
- [x] AC4 单测覆盖：至少一条测试断言"在缺少 node_modules 的环境下，driver 相关的入口不依赖任何裸 .ts 的 npm 包 import"（可以是扫描 dist 产物真的自包含，或扫描运行时不会触碰带 npm import 的裸 .ts 文件）。
- [x] AC5 `scripts/test.sh` 对应泳道绿。

## Definition of Done

真实落地 = 在一份真正干净的、按 v0.6.2 或更新版本安装出来的 plugin cache 目录上（不是开发检出、不是夹具），跑 `start-drivers.js --root <第三方 workspace>` 成功启动全部 driver kind，不报 ERR_MODULE_NOT_FOUND。

## Resolution

**AC1 定位真实调用点**：`packages/quay/src/observation.ts:3169-3174` 的 `loadDriverRuntime()`——
`resolvePluginScriptExec(path.join("scripts", "driver-runtime.ts"))` 动态 raw-优先解析
`driver-runtime.ts`，后者静态 import `driver-filters.ts`，再静态 import `task-schema.ts`，
三层全部落在裸 `.ts` 兄弟文件上（Node ESM 对动态 import 进来的裸 .ts 模块，其自身的静态 import
仍按磁盘位置解析兄弟文件）。用 `node .../scripts/dist/start-drivers.js` 直接复现，完整错误堆栈
证实调用链止于 `packages/quay/src/plugin-root.ts:141 resolvePluginScriptExec`（raw 优先、dist 兜底）
命中裸 `task-schema.ts`。

**真正的根因不在 resolvePluginScriptExec 本身**（它的 raw 优先设计是刻意的，文档字符串明确写着
"the npm-pack artifact carries consumer-referenced plugin .ts ONLY as bundled dist/*.js (no raw .ts)"
——即它假设"打包产物只有 dist 形式"）。真正的根因是**打包流水线没有维护这个假设**：
`packages/quay/scripts/package.sh`（npm-pack 通道）确实有 `find ... -delete` 步骤清掉裸 .ts
（保留 `runner-static-gate.ts` 例外），但 `plugin/scripts/publish-dist-branch.sh`（marketplace/
dist-plugin 通道，也就是 `claude plugin install` 实际走的那条）从来没有做这一步——一直原样
把 `plugin/` 目录 rsync 进 orphan 分支，裸 .ts 和（如果磁盘上恰好有的话）dist/*.js 一起带出去。

**AC2 修复**：给 `publish-dist-branch.sh` 补上与 `package.sh` 完全一致的
build+strip+rewrite 三步（复用同一个 `build-plugin-dist.mjs`，同样的 `runner-static-gate.ts`
排除例外，同样的 fail-closed 检查）。顺带修了一个前置问题：`$WORK` 原来建在系统 `/tmp` 下，
而 `build-plugin-dist.mjs` 内部用 esbuild 打包每个文件时是按**被打包文件自己的磁盘位置**向上
walk 找 `node_modules` 的——`/tmp` 路径样样以上都没有 `node_modules`，esbuild 直接报
`Could not resolve "yaml"` 构建失败。改成在 `$REPO_ROOT` 下建 `$WORK`（命中仓库现有的
`**/worktrees/` gitignore 规则，不会被提交），让 walk-up 能找到真正的 `node_modules`。

修复提交：`2f2fa36d3`（落地 develop）。

**端到端验证（非夹具，真实复现）**：
1. 用修好的脚本重新 `--push` 发布 dist-plugin 分支。
2. 全新 `git clone --branch dist-plugin` 到一个干净的 `/tmp` 目录（树上任何位置都没有
   `node_modules`）。
3. 确认 `scripts/task-schema.ts` 已经不存在、`scripts/dist/task-schema.js` 存在。
4. 用 `CLAUDE_PLUGIN_ROOT` 指向这个干净 clone，跑真实的 `start-drivers.js --root
   /home/yale/work/quay-fleet`——**promotion driver 启动成功**（`started: supervisor
   pid=... confirmed_ms=758`），不再报 `ERR_MODULE_NOT_FOUND`。验证完毕立即 `driver stop`
   清理，quay-fleet 没有留下任何测试状态。

已经切出并发布了修复后的版本 **v0.6.3**（tag + GitHub Release + dist-plugin 分支均已更新），
供第三方项目安装。

**AC3（不破坏开发检出场景）**：本次改动只影响 `publish-dist-branch.sh` 自己的 `$WORK`
临时目录处理逻辑，从未触碰 `$PLUGIN_DIR`（真实开发检出的 `plugin/` 目录）本身——driver-runtime.ts
自身的热重载（监测源码 mtime）机制完全未受影响。

**AC4/AC5（未完成，如实记录）**：没有补充自动化回归测试，也没有跑
`scripts/test.sh` 对应泳道——本轮按人的明确指示优先级是"尽快让 quay-fleet 能装上能跑的
build"，用真实端到端验证（而非夹具）替代了自动化测试的即时补齐。遗留跟进项：为
`publish-dist-branch.sh` 的输出补一条断言"不含带 npm import 的裸 plugin/gate-scripts .ts"。

## Resolution（第二条修法：resolver 半边 · per-task worker，同日第二次落地）

**先读背景（否则会以为这是重复工作）**：本 task id 已被另一会话落地了一半——发布侧修法
（`plugin/scripts/publish-dist-branch.sh` 补 build+strip+rewrite 三步，commit `018253163`，已进 develop）
+ v0.6.2→0.6.3 发布；AC1–AC3 由那次勾上，AC4/AC5 明确留作跟进。本次 worker 被驱动器按同一 task id
派发，落地的是**本任务 Touches 里原列的"第三条修法"**（"driver 侧改成 dist 优先、raw 仅在开发检出
场景兜底"）+ AC4/AC5。两条修法互补、不重复：

- **发布侧**（已落地）：`github/dist-plugin` 通道的产物不再带裸 `.ts` —— 走该通道安装的第三方拿到的是纯 bundle；
- **resolver 侧**（本次）：**任何** raw 与 dist 并存的安装仍然选中自包含 bundle。这一条发布侧结构上覆盖不到：
  `claude plugin marketplace add <本地插件目录>`（**quay-init 自己打印给用户的安装步骤**、
  也是本机 `known_marketplaces.json` 的实际形态）是**整棵 `plugin/` 原样拷贝**进 cache 的，
  本地检出里有什么就带什么——实测本机 `~/.claude/plugins/cache/quay/quay/0.6.2/` 里 237 个裸 `.ts`
  与 85 个 dist bundle 并存，正是这一种。

### AC1（更正上一节的定位）

上一节把触发点写成 `observation.ts:3169-3174 loadDriverRuntime()`。实测触发 `quay driver start` 的是
**另一处**，而且**不是"动态 resolve 一个 .ts 依赖"**——是一条**静态 import 链被整体加载**：

| 环节 | 位置 | 内容 |
|---|---|---|
| 解析入口（触发 `quay driver start` 的） | `packages/quay/src/cli/driver.ts:181` | `resolvePluginScriptExec(path.join("scripts","driver-runtime.ts"))` → 选中 raw，`stripTypes:true` |
| 同款入口（in-process kernel 懒加载） | `packages/quay/src/observation.ts:3174` | 同一次调用 |
| 静态 import | `plugin/scripts/driver-runtime.ts:52` | `… from "./driver-filters.ts"` |
| 静态 import | `plugin/scripts/driver-filters.ts:25` | `… from "./task-schema.ts"` |
| 裸 npm import（崩点） | `plugin/scripts/task-schema.ts:127` | `import { parse as parseYaml } from "yaml"` |

⛔ 所以上一节"怀疑是 driver-filters.ts/driver-runtime.ts 里对 task-schema.ts 的某次**动态**
resolve+import"**不成立**：全仓没有任何一行 `resolvePluginScriptExec("scripts/task-schema.ts")`
（`grep -rn resolvePluginScriptExec` 的全部非测试调用点只有 5 处，已逐条核过）——
**raw kernel 是被"选中"的那个，task-schema.ts 是它自己的静态闭包拖进来的。**

**独立复现（同一安装目录、只换被执行的形态，其它全不变）**：
```
$ node --experimental-strip-types <cache>/scripts/driver-runtime.ts status --kind promotion --root <ws>
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from <cache>/scripts/task-schema.ts
$ node <cache>/scripts/dist/driver-runtime.js status --kind promotion --root <ws>
worktree-process-reaper: one of --worktree <path> or --orphans is required
promotion-driver: kind=promotion · supervisor pid=none alive=0 · … · carrier_files=…:missing
```
**闭包实测**（注释剥离后的静态扫描，不是"大概"）：raw kernel 闭包含 **23 个文件**；其中的裸依赖是
`yaml`（`task-schema.ts` / `profile-policy.ts`）、`@modelcontextprotocol/sdk/{server/mcp,server/streamableHttp,types}.js`
与 `zod`（`driver-shared.ts`）——**四个都不在安装目录里**（该目录 `find -iname node_modules` 命中 0）。
同一函数的另外 3 个调用点里，`observation.ts:2291`（`task-status-drift-check.ts:35 → task-schema.ts`）
同样触到 `yaml`，一并被同一次修改覆盖；`mcp-server.ts:157`（runtime-usage-inventory）与
`serve-send.ts:195`（transcript-delivery-check）的 raw 闭包**不含** npm 依赖（实测），
它们只是跟着改成走 bundle（形态统一，行为无差）。

### AC2/AC3 修法

- `packages/quay/src/plugin-root.ts`：新增 **`isPluginSourceCheckout(root)`** =「Core 源码就在 plugin root
  旁边」（`<root>/../packages/quay/src` 存在）。`resolvePluginScriptExec` 改为 **raw 只在源检出里胜出**；
  非源检出且存在 dist bundle ⇒ 选 bundle（`stripTypes:false`）；bundle 不存在 ⇒ 仍回退 raw
  （⛔ 不把可解析的脚本变成 null）。
- `plugin/scripts/driver-runtime.ts`：同一判据的 kernel 镜像 **`isKernelSourceCheckout()`**，`resolveKernelSibling`
  同样处理——`runSupervisor` 的 `spec.driver` 正是经它解析（**六个 kind 全在这一条上**），
  `kernelSiblingArgv` 随之继承。

**为什么判据是"源检出"而不是"有没有 node_modules"**：出厂树是静态的（`sourceFilesMaxMtimeMs` 的注释
自己就写着"installed artifact 只有 dist bundle、无原始 .ts ⇒ 恒 0 ⇒ 无自刷新"），在出厂安装里选 raw
零收益、代价是启动即崩；而"有没有 node_modules"是会随宿主变化的**代理量**（硬规则 4b：共享机/
用户 HOME 下都可能存在）。源检出判据把"raw 是真相源"这件事直接说清楚，也保住了源检出里的
编辑即生效 + 源码自刷新。

### AC2/DoD 端到端（真实安装，不是夹具）

1. 从**修好的树**构建 plugin（`sync-vendor.sh` + `build-plugin-dist.mjs <pluginRoot>` ⇒ 87 entrypoints），
   拷成一份目录源 marketplace；
2. `HOME=/tmp/qa-home2 claude plugin marketplace add ./qa-ship2` + `claude plugin install quay@quay`
   ⇒ **走官方路径真实安装**出 `/tmp/qa-home2/.claude/plugins/cache/quay/quay/0.6.3/`
   （修好的树上 `plugin/VERSION` 已是 develop 的 0.6.3；报障那份是 0.6.2，两者同形）：
   **无 node_modules、无 .git、237 个裸 .ts + 85 个 dist bundle**；
3. `CLAUDE_PLUGIN_ROOT=<cache> node <cache>/scripts/dist/start-drivers.js --root /tmp/qa-thirdparty --port 4199`
   ⇒ **四个 kind 全部启动**：`promotion` / `worker` / `outer` / `goal` 均 `alive:1 running:1`
   （+ `serve: started` 在 4199）；跑完逐 kind `driver stop` + 收掉 serve，**无残留进程**。

**单变量红/绿对照（同一安装目录、同一条命令，只换一个文件）**：把 `vendor/quay/dist/quay.js`
换回**修复前**那份（取自真实 cache 0.6.2 的 bundle）⇒ 同一条命令立刻复现报障原文
`ERR_MODULE_NOT_FOUND: Cannot find package 'yaml' imported from …/scripts/task-schema.ts`；
换回修复版 ⇒ 全绿。⇒ 结论钉在"跑的是哪个 Core bundle"这**一个**变量上，不是环境差异、不是夹具差异。

### AC3（开发检出行为不变）

同一 resolver 在源检出上：`resolvePluginScriptExec("scripts/driver-runtime.ts")` ⇒
`<repo>/plugin/scripts/driver-runtime.ts` + `stripTypes:true`（= 修复前行为）；kernel 侧
`resolveKernelSibling("promotion-driver.ts")` ⇒ 同样选 raw（实测探针输出见下）。负控制见 AC4 的两条测试
（同一夹具，只多加一个 `packages/quay/src` 目录 ⇒ 结论翻转回 raw）：

```
SHIPPED(cache 0.6.2) | core: <root>/scripts/dist/driver-runtime.js    strip=false | kernel: <root>/scripts/dist/promotion-driver.js strip=false
DEV(repo plugin)     | core: <root>/scripts/driver-runtime.ts         strip=true  | kernel: <root>/scripts/promotion-driver.ts        strip=true
```

### AC4 单测（新增 6 例，含红对照）

- `packages/quay/test/plugin-root.test.mjs`：`isPluginSourceCheckout()` 真值表；**raw+dist 并存、
  非源检出 ⇒ 选 bundle**；**同一夹具 + 源检出标记 ⇒ 选 raw（负控制）**；无 bundle 的裸 `.ts` 仍回退 raw。
- `plugin/test/driver-runtime.test.mjs`：`resolveKernelSibling` 同一对（含 `kernelSiblingArgv` 的 argv 断言）。
- **红对照（实际跑过，不是声称）**：把两个判据临时改成 `return true`（= 修复前的 raw 优先语义）
  ⇒ Core 侧恰好多出 2 条红、kernel 侧 1 条红，两条负控制保持绿；改回即全绿。
- AC 要求的属性（"用不到 node_modules 的环境里，driver 入口不碰带 npm import 的裸 .ts"）=
  上面的**运行时半边**（本次新增）**∧** `packages/quay/test/build-plugin-dist.test.mjs:256`
  的**产物半边**（"deriveEntries DERIVES the 6 driver kinds + send-to-session.ts"，已存在）：
  每个 driver 入口都有 bundle 可被选中 ⇒ 非源检出下不会落到裸 `.ts`。

### AC5 scoped 门

`bash scripts/test.sh --for-task gap-dist-plugin-missing-node-modules-task-schema-yaml --allow-thin`
（在任务 worktree 内、已 `merge develop`、源码已冻结）——读数见下（**有实测输出，不是空日志**）：

```
✔ resolveKernelSibling() — shipped install (raw .ts + dist coexist): the BUNDLE wins, stripTypes false
✔ resolvePluginScriptExec() prefers the dist bundle when raw .ts and dist COEXIST outside the source checkout
ℹ tests 159
ℹ pass 159
ℹ fail 0
GATE_EXIT=0
```
静态检查面 **0 个 STATIC_CHECK_FAILED**；选择集 11 个测试文件（含 `packages/quay/test/plugin-root.test.mjs`、
`plugin/test/driver-runtime.test.mjs` + crosscut packaging-state/check-adr/lint）——
**159 条实测输出，不是 `--allow-thin` 在 0 文件时的静默放行**。

### 顺手修掉一个 develop 上的既存红（不属本任务，但不修则本任务无法落地）

第一次跑 scoped 门时静态检查 **fail-closed 红**：`STATIC_CHECK_FAILED: quay-init-closure-ratchet-stale exit=1`
⇒ `changed: plugin/.claude-plugin/plugin.json`。根因**不是本次改动**：v0.6.3 发布（`92c5b1b15`）
改了 `plugin/.claude-plugin/plugin.json`（在 ratchet 的 fingerprint source set 里），但没有随附
`--reanchor`——上一次 re-anchor（`9ea261f14`）是 0.6.2 bump 时做的。**即 develop 上该静态检查是红的，
且它对每个任务都 fail-closed。** 实测 `--gate` 通过（真实 laydown **3 files / 1022 bytes ≤ baseline
3/1022**，shrink-only 成立）⇒ 重锚只刷新指纹、**不动任何数字**。已 `--reanchor` 并随本分支提交
`docs/analysis/quay-init-closure-ratchet.baseline.json`（diff 仅 `fingerprint` 与 plugin.json 的 `sha`）。

### 覆盖边界（如实记录，未修）

1. **装了裸 `.ts` 但一个 dist bundle 都没有**的树：resolver 无从选择（bundle 不存在）⇒ 仍落回 raw，
   报错形态不变。这类安装必须先构建（或改从 dist-plugin 通道安装）。本次修的是"raw 与 dist 并存"
   的安装——报障那份 cache 正是这一种。
2. **同类未修点（枚举，按位置判定）**：`packages/quay/src/mcp-server.ts:141 resolveWorkspaceInstrument`
   对 `<workspaceRoot>/plugin/scripts/*.ts` 也是 raw 优先。但那是**工作区本地** instrument 目录轴
   （quay-init 铺进消费方工作区的副本），与 driver 入口无关，不在本任务 DoD 路径上。
3. `plugin/scripts/driver-runtime.ts` 在 Core 侧还有一个**同形但未修**的镜像点：
   `packages/quay/src/fan-in/ff-merge.ts:313 siblingScriptArgv`（同样是 raw 优先）。它的
   `scriptsDir` 在生产里是 `<plugin>/scripts/dist`（kernel 是 bundle 时），raw 候选不存在 ⇒ 不触发；
   只有在 `QUAY_PLUGIN_ROOT` 被显式指向一个出厂 plugin root（**实测全仓没有任何生产写入者**，
   只有测试缝/运维覆盖）时才会选到裸 `.ts`，故本任务不改（改动面越出 DoD，且无生产触发路径）。
4. `plugin/scripts/start-drivers.ts:109 resolvePluginRoot` 要求 `basename(dir)==="scripts"`，
   于是 `node <cache>/scripts/dist/start-drivers.js`（不带 `CLAUDE_PLUGIN_ROOT` 时）推导不出 plugin root、
   回退 PATH `quay`（实测 ENOENT）。生产里 `CLAUDE_PLUGIN_ROOT` 由 harness 给出，非阻塞；
   且失败是**响亮报错**（打印 argv0/argv），不是静默假绿。
