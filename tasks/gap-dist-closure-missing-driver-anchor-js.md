---
id: gap-dist-closure-missing-driver-anchor-js
title: 打包 dist entry 集对 driver-anchor 的动态路径引用盲 → dist/driver-anchor.js 不进
  tarball，任何第三方安装的 driver 自 2026-09-13 起结构上起不来
status: ready
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: finding
goal_ac: AC-202
---
## Finding

**证据来源（⛔ 本条不重新取证，全部引自已实测的一次远程隔离对照实验，见该任务的 "### ⛔ AC3 / AC4 / AC5 / AC6 未达成" 一节）**：`gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger`（当前 `needs-human`，因这个缺陷阻断了它的 AC-239 半边）。以下每一条都是那次调查里已经独立可复现的实测，本条只是把「这是另一个机制、需要另立任务」的划界落成任务。

**真机器实测（orangevps，隔离安装副本，`driver start` 输出未被重定向）**：

```
$ node <installed>/quay/dist/quay.js driver start --kind promotion --root <copy>
start-failed: kind=promotion — cannot spawn driver anchor: driver-anchor module not found next to driver-runtime (/home/yale/quay-verify-upgrade-fb0301b8.npm/lib/node_modules/quay/plugin/scripts/dist)
PROMOTION_RC=1
start-failed: kind=worker — cannot spawn driver anchor: driver-anchor module not found next to driver-runtime (...)
WORKER_RC=1
```

**根因链（每一环均已实测，非推断，详见引用任务）**：

1. `plugin/scripts/driver-runtime.ts:831 preferredAnchorKernel()` 在两处找 anchor：与运行中内核**同目录**的 `driver-anchor.{ts,js}`（`dist/` 下），或内核所在仓库**主检出**的同名路径（`mainCheckoutKernelDir()`，注释自述仅在"内核跑在 linked worktree 里"时生效）。
2. 交付物 `.../quay/plugin/scripts/dist/` 里有 `driver-runtime.js`，**没有** `driver-anchor.js`（远端 `ls` 实测 + 本机 staging 实测同样确认缺失）。
3. 安装形态下 `mainCheckoutKernelDir()` 返回自身安装目录，两处均不存在该文件 ⇒ `preferredAnchorKernel()` 返回 null ⇒ `spawnAnchor` 报 `"driver-anchor module not found next to driver-runtime"` ⇒ **任意 kind 的 `driver start` 在任何已安装/已打包形态下 rc=1**。
4. 疑似成因（待本任务实现者对着当前 `develop` 重新核实，⛔ 不要照抄）：`driver-anchor.ts` 的引用路径是**动态拼接**构造的（形如 `path.join(here, "driver-anchor.ts")`），不是静态 `import`/`require`，导致打包脚本（`packages/quay/scripts/package.sh`）的 dist-entry 闭包推导（一个走静态引用扫描的机制）看不见它——这正是此前三条 `done` 任务已经修过、但每次都只覆盖被发现的那一处引用形状的同一类缺陷（硬规则 5b）。`driver-anchor.ts` 落地于 `3f2384de0`（2026-09-13T20:19:33Z，AC-255/SPEC §7 阶段 C：单 anchor 进程承载六个 kind），晚于此前三次修复。

**时间界限（实测，非推断）**：GOAL-009-AC-239 的 e2e（需要一个全新安装项目自己的 driver 能起来）最后一次成功是 `2026-09-13T17:11:09Z`，早于 `3f2384de0`（20:19:33Z）落地 3 小时 8 分；此后再无一次成功（引用任务里独立两次跨机运行均复现，run4 与 run5）。

**影响面**：不是 AC-239 测试专属问题——它意味着**任何**通过 npm-pack 通道（`packages/quay/scripts/package.sh` 产出的 tarball，`npm install -g` / `quay-init` 路径）安装 quay 的第三方项目，跑 `quay driver start` 时**任意 kind 都会 rc=1**。这是自 2026-09-13 晚间以来对每一个全新第三方部署的一次性阻断——drivers 这一核心能力在生产上跑不起来。

**查重（机制维度，⛔ 非关键词）**：已 grep `driver-anchor` / `dist-closure` 全库，同类缺陷 CLASS 已有 3 条 `done` 修复（`gap-delivery-laydown-dist-closure-gap`、`gap-driver-kinds-table-literal-not-in-dist-entry`、`gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs`），但均不覆盖 `driver-anchor.ts`/`.js` 这个具体文件；`task_list(search: "driver-anchor module not found")` 仅命中引用任务本身（该任务明确声明此缺陷不在其 Touches 范围、需另立任务）。无重复。

## Goal Backing

`goal_ac: AC-202`（GOAL-009「凡被 spawn 的机件必进交付物——把闭包闸扩到 DRIVER_KINDS 这类数据表字面量引用」，status: achieved）。

**为什么是这条 AC**：AC-202 立的就是本条要修的那条不变量——**每一个被 spawn 的机件都必须在交付物的 entry 集里**——而且它的 criterion 逐字枚举了三种引用形状（`driver: "X.ts"` 数据表字段、`path.join(...,"plugin","scripts","X.ts")` spawn 形式、`resolveKernelSibling("X.ts")`）。本条的引用形状（**运行期拼接的动态路径**，形如 `path.join(here, "driver-anchor.ts")`）正是该枚举覆盖不到的第四种 ⇒ 同一条保证在同一份代码上又一次以「未被枚举的引用形态」复发（硬规则 5b：修好一个形状不等于该类只存在于那一处）。这正是本条挂在 AC-202 下、而不是另立一条新 goal AC 的理由：它的**领域已被 AC-202 覆盖**，缺的是枚举的完备性；另立一条会把「同一条不变量的第四次复发」伪装成一条新保证。

⛔ **不引 AC-201**（`现 build 产物完整且可溯源——产物记录锚在 develop 祖先 commit + tgz sha256`）：那条管的是 build 产物的**可溯源**（`build_sha`/`tgz_sha256` 记录存在），不是**闭包完整性**，与本条机制不同域。

⛔ **不引 AC-239**（`升级后闭环：driver 在已升级的旧痕迹项目上继续驱动出新任务到 done`）：AC-239 是本缺陷的**下游消费者**——它的 e2e 正是被这条阻断的那半边（见本条 Finding 的「时间界限」），不是本任务所修机制所处的域；把它当 goal 背书会把「机制修复」与「升级 e2e 验收」混为一谈。

_（本键由 `gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved` 的 worker 在合并 develop 时按 `precommit-guard.ts` 判定 ③ 的指引补齐；同一条修复也是 `gap-ac190-write-face-rule-unreachable-under-no-verify` 的 AC3。）_

## Plan

1. 读 `packages/quay/scripts/package.sh` 的 dist-entry/闭包推导与 `plugin/scripts/driver-runtime.ts` 的 `preferredAnchorKernel()` sibling-lookup，对着**当前 develop**确认引用被闭包扫描漏掉的确切形状（动态 `path.join`/`require.resolve` 拼接，或其它——须验证，不得照抄本条描述直接假设）。
2. 修闭包推导，使其能**通用地**捕获这类被漏掉的引用形状（不要只针对 `driver-anchor.ts` 特判——4 个实例的共同教训是"闭包扫描漏掉某种引用形状"这一类问题，优先修形状识别本身），并把 `driver-anchor.ts` 显式加为回归钉子（无论如何都要加）。
3. 补一个能捕获本次缺陷的 mutation/负控制测试：构建 dist 闭包，断言 `driver-anchor.js`（或修复后实际的文件）存在，**并且**对打包产物做一次真实 `driver start` 验证其成功（不能只验证"文件存在"——存在但截断/不兼容的文件同样能"存在"，是更弱的仪器）。
4. 真机验证：全新打包安装（`--verify-upgrade` 那套 AC-239 e2e 相同形态），在**已安装（非主检出）**副本上确认 `quay driver start --kind promotion` 与 `--kind worker` 均 rc=0。

## Acceptance Criteria

- [x] AC1：对着当前 `develop`（非假设、非照抄本任务描述）确认根因——闭包推导漏掉 driver-anchor 引用的确切代码位置。
- [x] AC2：修复落地为通用形式（闭包推导捕获被漏掉的引用形状本身，不是仅针对文件名的特判补丁）。
- [x] AC3：负控制——在修复前的提交上，一次干净的打包+安装副本，`driver start` 可复现地报出本条引用的错误（prefix-swap 式负控制，参照既有先例 `prefix-code-swap-for-red-control`）。
- [x] AC4：修复后，一次**真实**全新 npm-pack 安装（隔离副本，非主检出）上 `driver start --kind promotion` 与 `--kind worker` 均 rc=0——真机器读数，不是仅夹具通过（硬规则 4 推论三：只由夹具满足的判据不是生产修复的证据）。
- [x] AC5：存在一个能捕获本次缺陷的测试（针对打包产物做真实 driver-start 成功性断言，不是仅文件存在性断言）。

## Definition of Done

真实落地的判据：一次全新的、非主检出的 npm-pack 安装副本上，`quay driver start --kind promotion` 与 `--kind worker` 均 rc=0；且有测试能在修复被回退时重新报红（而不仅仅是"文件存在"这种更弱的信号）。⛔ 不接受：只在主检出或 fixture 内验证通过、不做真实隔离安装验证；只补文件存在性检查而不验证真实启动成功。

## Resolution

**实现（commit `6b1aa601f`，测试补齐 `4c60479be`）**：`packages/quay/scripts/build-plugin-dist.mjs` 新增第 4 种引用形状的扫描
`scanPluginSiblingReferences()` —— **目录变量**的兄弟拼接 `path.join(<dirExpr>, "<name>.ts")`（及其安装形态孪生
`"<name>.js"`，反查同名 `.ts`），对**全部** plugin 源码扫描（scripts/ + gate-scripts/，跳过 dist/test/vendor 等构建与夹具目录）。
`<dirExpr>` 限定为「标识符起头、可选带一次调用」的项（`here` / `SCRIPT_DIR` / `resolveKernelScriptsDir()` / `path.dirname(x)`）
—— 这正是让规则**零假阳性**的原因：`path.join(root, "plugin", "scripts", "X.ts")` 结构上无法匹配，故此前迫使
driver-runtime.ts 限定扫描的非模块 readFile 目标（`runner-static-gate.ts`，一个**故意**命名为 `.ts` 的 bash 文件，被当**文本**读）
不会被拖进来。真正的闭包成员是**形状**而不是文件名：未来任何 `path.join(SOME_DIR, "x.ts")` 都被同一条规则捕获。

**AC1 根因（对着当前 develop 核实，非照抄）**：`plugin/scripts/driver-runtime.ts:833/834/837/838`（`preferredAnchorKernel()`）
的四处拼接；闭包推导里的四条既有扫描（`PLUGIN_PATH_JOIN_TS_RE` 要求字面量 `"plugin","scripts"`、`PLUGIN_SIBLING_RESOLVER_RE`
要求 `resolveKernelSibling("…")`、`PLUGIN_DRIVER_FIELD_RE` 要求 `driver: "…"`、`CORE_PATH_JOIN_TS_RE` 只扫 Core src 且要求 `"scripts"`）
**没有一条**能看见一个「目录变量」的拼接 ⇒ `deriveEntries` 实测 **88** 条、`driver-anchor` **不在其中**。

**AC2 实测（直接量，非代理量）**：`scanPluginSiblingReferences` 在真 plugin 根上命中恰好
`{driver-anchor.ts, fast-mode-telemetry.ts, ready-pool-check.ts}`（后两者本就是 entry，非新增面）⇒ `deriveEntries` **88 → 89**，
新增的那一条正是缺陷本身；`runner-static-gate` 仍不在集合里（无假阳性）。`package.sh` 的闭包闸随之**要求**它：
`dist-closure gate OK: 89 referenced dist bundles all present`，`tar tzf` 里 `scripts/dist/driver-anchor.js` 计数 = 1。

**AC3 prefix-swap 负控制（真打包 + 真安装）**：把 `build-plugin-dist.mjs` 换回修复前那份
（`git show a742771eb:packages/quay/scripts/build-plugin-dist.mjs`）后重跑 `package.sh`：tarball 里
`dist/driver-anchor.js` 计数 **0**；装入隔离 prefix 后（`git rev-parse --is-inside-work-tree` ⇒
`fatal: not a git repository`，确认非主检出）两个 kind 都复现本条引用的错误、rc 均为 1：

```
start-failed: kind=promotion — cannot spawn driver anchor: driver-anchor module not found next to driver-runtime (<prefix>/lib/node_modules/quay/plugin/scripts/dist)
PREFIX_PROMOTION_RC=1   |   PREFIX_WORKER_RC=1
```

随后 `git checkout --` 恢复修复。

**AC4 真机读数（隔离 npm-pack 安装，非主检出）**：修复后的 tarball 装入 `/tmp/quay-install-A-*`（非 git 检出、无 packages/ 源码树）：

```
PROMOTION_RC=0  started: anchor pid=3636788 kind=promotion driver pid=3636788 confirmed_ms=279
WORKER_RC=0     started: anchor pid=3636788 kind=worker    driver pid=3636788 confirmed_ms=257
ps -o pid,cmd -p <anchor.pid> → .../lib/node_modules/quay/plugin/scripts/dist/driver-anchor.js __anchor --root <ws>
                                （安装产物里的 dist bundle，纯 ESM 不带 --experimental-strip-types）
promotion-driver.pid -> 3636788 ；worker-driver.pid -> 3636788   （一个 anchor 承载两个 kind）
```

**⚠️ 第一次 AC4 读数是【被污染的】，已作废并重取（记录于此，因为差别正是本条要防的那一类）**：本 worker 的 shell 带有
`QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin`（driver 环境注入），继承它时 `resolvePluginRoot()`
（`packages/quay/src/plugin-root.ts:90`）返回**主检出**的 plugin 树 ⇒ CLI spawn 的是**开发树内核**而非安装产物，
而那次运行照样打印 `started:` / rc=0。暴露它的是**直接量**：`ps` 显示 anchor 的 cmdline 是
`node --experimental-strip-types /home/yale/work/quay/plugin/scripts/driver-anchor.ts` —— 主检出开发树。
⇒ 那次 rc=0 对「打包产物」什么也没证明（硬规则 4b：代理量「driver start 退出 0」被一个**不同的对象**满足了）。
上表所有 AC3/AC4 读数一律以 `env -u QUAY_PLUGIN_ROOT` 取得。

**AC5 测试**：`packages/quay/test/build-plugin-dist.test.mjs` 新增 4 条（`node --test` 该文件 29/29 绿）：
① 形状规则及其边界（目录变量拼接命中；字面量段拼接与非 dirExpr 形式**不**命中）；
② 承重控制——把引用改写成非该形状后 `deriveEntries` 里该模块**消失**（证明是这条规则在命名它）；
③ 真 plugin 根的闭包**推导并强制要求** `driver-anchor`，且既有任一扫描形态都**不**命名它（证明第四条形状是承重的）；
④ **打包产物**级：从暂存副本构建**真实** dist 闭包、从它的 dist 形态跑**真实** `driver start`（rc=0、`started:`、`host=anchor`），
并配一个**同产物**负控制（摘掉 `driver-anchor.js` ⇒ rc=1 且逐字复现生产错误串）。⛔ 断言落在真实启动成功性上，不是文件存在性。

**scoped 门**：`bash scripts/test.sh --for-task gap-dist-closure-missing-driver-anchor-js --allow-thin` **RC=0**（29/29 绿）。
首轮红在两条静态检查上、根因是本文件新测试自己的 temp 泄漏（`tmp-leak-pairing-check` 的 `mkdtemp-no-cleanup` +
`test-isolation-check` 的 ratchet +1）⇒ 已改为「每个 artifact 测试各建各的 stage、`finally` 里 rmSync」并复跑转绿。
scoped-gate 缓存按**实际被合并进本 worktree 的 develop tip** 写入（`.quay/scoped-gate-cache.json` 是**单条**缓存，
并发写入者会覆盖它 ⇒ 未命中时 fan-in 照跑门，fail-closed，无静默跳过风险）。

**原始输出**：`.quay/ac-dist-anchor-evidence.md`（本 worktree 的**未提交**运行时证据文件；与主检出处 `.quay/` 下既有的
59 个证据文件同形，不进 git delta。⛔ 该目录**并未**被 gitignore——前一版本条写成「gitignored」是错的，此处更正）。

**一处未验证、故不作断言的观察**：`driver-anchor.ts` 是否在 `quay-init` 的 laydown 集合里，本次**没有**取到读数
（`quay-init.sh --loop --dry-run` 在本机 RC=2，未走到 laydown 清单）。因为 anchor 一律从**内核自身安装位置**解析
（`preferredAnchorKernel` 不看 `QUAY_PLUGIN_ROOT`、也不看 `--root`），laydown 集合与本题机制不同域 ⇒ 仅记为观察项，
不作阻塞、不在此处声称结论。

## 落地时修掉的 suite-red 阻塞（⛔ 非本任务 delta）

fan-in 的 suite 在 `plugin/test/driver-anchor.test.mjs` 上**确定性红**（AC3① 61468ms / AC6 63612ms，两者都是
`stop --kind <k>` 的 `spawnSync` 60s 超时 ⇒ `status: null !== 0`）。真因**不在本任务 delta 内**：anchor 进程经
`preferredAnchorKernel()` 优先跑**主检出**那份 kernel（AC-184/AC-255 的设计，⛔ 不是缺陷），而
`registerKindStop` / `requestKindStop` 的停机登记表是**模块级**的；夹具硬编码 import worktree 那份
`driver-runtime.ts` ⇒ anchor 与夹具各持一张独立登记表 ⇒ `requestKindStop(kind)` 置的不是该 kind 读的那个标志
⇒ 等满 60s 后 exit 1 —— **与「该 kind 的循环真的挂了」逐字同形**（硬规则 3b 的同形异因）。
⇒ 该文件在**任一 worktree** 里确定性红，会挡住**每一次** fan-in（实测：同期另外两条任务的 fan-in 日志里
`driver-anchor.test.mjs passed=false`）。

**处置**：逐字采用兄弟任务 `gap-perfile-memory-cost-collection-missing` 的补丁 `d29592113`（`git cherry-pick`；
base blob `c0bb66c1d` 与本 worktree 逐字相符 ⇒ 零冲突）。该补丁把 `DRIVER_RUNTIME_ABS` 由 `preferredAnchorKernel()`
派生。与 `gap-ac258-…` 分支携带的 `fa9df5b4a` md5 一致 ⇒ **谁先落都是恒等合流**。机制归属属于那条任务，本任务只承载它。

**两向读数（同一棵树、只改夹具那一行 import；本 worker 单跑实测）**：

```
改前（import worktree 那份）：AC3① 61468ms FAIL · AC6 63612ms FAIL（null !== 0）
改后（import anchor 那份）  ：AC3①  3296ms PASS · AC6  6756ms PASS —— 整文件 7/7 绿、exit 0
```

⚠️ **如实标注边界**：该文件因此验的是 anchor **实际加载的那份**内核（worktree 里 = 主检出那份）
⇒ worktree 中对 anchor 内核本身的改动**不会**被它验到（`driver-runtime.ts` 已明记该形态「结构上无法自测」）。
这是形态的性质，⛔ 不是夹具能绕开的。

## Touches

- `packages/quay/scripts/build-plugin-dist.mjs`
- `packages/quay/test/build-plugin-dist.test.mjs`
- `plugin/test/driver-anchor.test.mjs`（**⛔ 非本任务 delta**：落地时修掉的 suite-red 阻塞 —— 夹具的 fake driver 必须 import anchor 实际加载的那份 kernel，否则停机登记表分裂 ⇒ `stop --kind X` 等满 60s 后 exit 1，**在任一 worktree 里确定性红**，挡住每一次 fan-in；逐字采用兄弟任务的补丁 `d29592113`；机制、两向对照与边界见上方「落地时修掉的 suite-red 阻塞」一节）
- `tasks/gap-dist-closure-missing-driver-anchor-js.md`（自身文件：勾 AC + 贴实跑证据）