---
id: gap-no-active-node-version-check-users-cant-tell-upgrade
title: "no ACTIVE Node version check — package.json engines>=20 is passive
  (user can't tell they must upgrade): --experimental-strip-types needs Node
  >=22.6, on Node 18.19.1 (B machine adopter test) the invocation
  `node --experimental-strip-types ...` fails with a BARE node error
  'bad option' and the user has no hint that upgrading Node fixes it;
  dist/quay.js path has its own declared floor (dist-verify-node-floor CI) —
  the source-execution path (strip-types) needs an ACTIVE probe that fails
  with a clear message naming the required floor"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**无主动 Node 版本检查——防御性缺口（原 B 机实证已撤回，2026-08-05 17:2xZ）。**

**【证据撤回（AC11 类，管理者自纠）】**：原「B 机 Node 18.19.1 撞裸 bad option」证据**为假**——B 机用
nvm 管理 node，管理者的**非交互 ssh 调用绕过了 nvm.sh**（~/.bashrc 首行非交互即退出），落到系统裸装
/usr/bin/node（18.19.1）；真实交互式/tmux shell 里 `node --version=v25.2.0` 满足 floor。**不要引用
「B 机撞 18.19.1」作为证据。**

**【剩余独立价值（防御性，无实证受害者的 UX 改进）】**：
- `node --experimental-strip-types` 需 **Node ≥ 22.6**（CLAUDE.md 的文档化调用方式）；
- Node 20（广泛 LTS）用户按文档直接跑 CLI 会撞裸 `bad option`，无升级提示；`engines>=20` 是**被动声明**
  （npm install 才警告）；
- quay 代码 grep 不到任何 node 版本检查 ⇒ 主动探针（清晰错误 + 升级提示）是防御性改进，非已确认缺陷。
已彻底撤回（2026-08-05 17:3xZ，管理者 tmux 交互式 v25.2.0 重测：quay init + task list 端到端干净成功；ERR_UNKNOWN_FILE_EXTENSION 同源非交互 ssh 假象，不要基于它建 defect）。

**【为什么是采纳者门槛缺陷】**：采纳者第一眼就撞裸报错，且无法得知「升级 Node 即可」。这正是
「写了但不在决策时被调用」的变体——engines 声明了但没有任何运行时检查把它变成可行动的提示。

**【两条执行路径分开看】**：
- **源码执行**（`node --experimental-strip-types`）⇒ 需要 Node ≥ 22.6；
- **dist 执行**（dist/quay.js）⇒ 走 `dist-verify-node-floor` CI 声明的 floor（可能有自己的更低版本）。

**【fix 方向】**：主动版本探针——CLI 入口 / quay-init 在启动时检查 node 版本，低于 floor 时
**fail-closed 报清晰错误**（命名所需版本 + 升级提示），而非 node 裸 bad option。探针判据以
`process.versions.node` 解析，不依赖 engines 被动声明。

### 选定机制

1. 入口版本探针：node < 22.6（strip-types 路径）时报清晰错误，给出升级提示
2. dist 路径按其声明的 floor 单独判断（若有差异）
3. 探针本身用纯 JS（不依赖 strip-types，鸡生蛋问题：检查器必须能在老 node 上跑）

## Acceptance Criteria

- [x] AC1: Node 18.x 上跑 quay 入口 ⇒ 清晰报错（命名所需版本 + 升级提示），非裸 bad option（实测）
- [x] AC2: Node ≥22.6 正常路径零影响（探针不挡正常使用）
- [x] AC3: 探针纯 JS 可在老 node 上执行（不依赖 strip-types）
- [x] AC4: 与 dist-follow/upgrade-channel（在飞）交叉标注——dist 路径 floor 单独判断

## Definition of Done

- [x] AC1-AC4 全勾（Node 18.x 清晰报错命名所需版本+升级提示；Node ≥22.6 零影响；探针纯 JS 老 node 可执行；与 dist-follow/upgrade-channel 交叉标注）
- [x] Node 18 实测清晰报错（非裸 bad option）；≥22.6 正常
- [x] scoped 门 `scripts/test.sh --for-task gap-no-active-node-version-check-users-cant-tell-upgrade` 绿

## Touches
- tasks/gap-no-active-node-version-check-users-cant-tell-upgrade.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- packages/quay/bin/（入口版本探针）
- plugin/scripts/quay-init.sh（若探针放 init）
- CLAUDE.md（调用方式注明所需 Node 版本）
- tasks/gap-upgrade-channel-cant-sync-build-artifacts-dist-stale.md（AC4 交叉标注）

## Test-Files
- packages/quay/test/node-version-check.test.mjs（探针纯函数 + wrapper/probe 子进程行为，AC1-AC3）

## Contract

measure   clear_error = `node --version && node <entry> 2>&1 | grep -c 'Node.*22\.\|升级\|>=22'` 在低版本实测 stdout 数字段
band      clear_error >= 1（低版本报清晰错误非裸 bad option）
invoke    `grep -rn 'versions.node\|process.version\|22\.6' packages/quay/bin/ plugin/scripts/`
control   高版本零告警（AC2）；低版本报错（AC1）
resume    探针与文档分步提交，任一步完成即写盘

## Evidence

**实现**（`packages/quay/bin/` 入口版本探针，AC1/AC2/AC3）：
- `packages/quay/bin/node-version-check.cjs` —— 纯 JS/CJS 探针（AC3：零 flag、无 strip-types 依赖，
  老 node 可执行）。判据 `process.versions.node` 解析（Contract invoke 命中）。`checkNodeVersion()`
  返回 `{ok, version, floor, message}`；低于 floor（Node ≥ 22.6）时 message 命名所需版本 + 升级提示。
  支持 `QUAY_NODE_VERSION_OVERRIDE` env 测试钩子（同 dist build 的 QUAY_BUILD_DIST_* 形态）。
- `packages/quay/bin/quay.js` —— 纯 JS 入口 shim：先跑探针，低版本 fail-closed 报清晰错误（exit 1）；
  Node ≥ 22.6 时 pass-through 以 `node --experimental-strip-types bin/quay.ts` spawn 真实 CLI（AC2）。
- `dist/quay.js`（npm bin）**不进**该探针——dist floor（Node 20）单独判断（AC4，dist-verify-node-floor CI）。
- `CLAUDE.md` —— 调用方式注明所需 Node 版本（源码路径 ≥ 22.6，dist 路径 floor 20）。
- `tasks/gap-upgrade-channel-cant-sync-build-artifacts-dist-stale.md` —— AC4 交叉标注（dist 安装物新鲜度 vs node 版本 floor 两轴分开）。

**AC1 实测（Node 18.20.4 真实二进制，2026-08-08）**：裸 bad option 基线 + 修复后对比。
```
$ /home/yale/.node18/bin/node --experimental-strip-types packages/quay/bin/quay.ts --version
node: bad option: --experimental-strip-types          # ← 缺陷基线（裸报错）

$ /home/yale/.node18/bin/node packages/quay/bin/quay.js --version; echo exit=$?
quay requires Node >= 22.6 (needed to run the quay CLI (source-execution path: `node --experimental-strip-types bin/quay.ts`)), but you are running Node 18.20.4.
Upgrade Node to >= 22.6 to run quay — e.g. with nvm: nvm install 22 && nvm use 22
Fix: upgrade Node to >= 22.6 (e.g. via nvm) and retry.
exit=1
```
Contract measure 实测：`node --version && node packages/quay/bin/quay.js 2>&1 | grep -c 'Node.*22\.\|升级\|>=22'` ⇒ `3`（band ≥ 1，低版本报清晰错误非裸 bad option）。

**AC2 实测（Node v26.5.0 ≥ 22.6，2026-08-08）**：
```
$ node packages/quay/bin/quay.js --version; echo exit=$?
0.4.0
exit=0
$ node packages/quay/bin/quay.js --help   # pass-through 正常
```
探针不挡正常使用；wrapper 零依赖 pass-through（一次 spawn 开销）。

**AC3**：`node-version-check.cjs` 是 `.cjs`（CommonJS、纯 JS），`quay.js` 是纯 JS ESM（无 TS、无
strip-types 语法）——Node 18.20.4 上直接 `node packages/quay/bin/quay.js` 即可执行（上面 AC1 实测即
Node 18 实跑，非模拟）。

**AC4**：`tasks/gap-upgrade-channel-cant-sync-build-artifacts-dist-stale.md` 的 Cross-annotation 段已加
交叉标注（dist floor Node 20 与源码 floor ≥ 22.6 两轴分开判断；探针只挂源码入口，不进 dist bundle）。

**测试**：`packages/quay/test/node-version-check.test.mjs`（node:test，@test-group product，8 条）——
纯函数比较、checkNodeVersion message 形态、wrapper/probe 子进程行为（old-node override → exit 1 清晰报错；
当前 node → pass-through 成功）。`node --test packages/quay/test/node-version-check.test.mjs` 全绿
（8 pass / 0 fail）。

## Dispatch review

reviewer: outer
at: 2026-08-05T16:5xZ
changed: 管理者 B 机采纳者实测（使用视角）立案——engines 被动声明非主动检查，裸 bad option 对采纳者不可行动。
