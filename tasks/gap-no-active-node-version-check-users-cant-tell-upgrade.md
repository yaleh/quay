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
      —— 实测：worktree 无 Node 18 二进制（nvm 仅 v22.23.1/v25.2.0），用 `QUAY_TEST_NODE_VERSION`
      seam 等价替换探针解析的 `process.versions.node` 字符串，走**真实 launcher 同一代码路径**。该
      seam 无法制造假通过——在真正无 strip-types 的老运行时上跳过探针只会重现裸 bad option。
      ```
      $ QUAY_TEST_NODE_VERSION=18.19.1 node packages/quay/bin/quay.cjs --version; echo exit=$?
      quay: requires Node >= 22.6 to run from source (this is Node 18.19.1).
      quay: `node --experimental-strip-types` needs Node >= 22.6; upgrade Node and re-run.
      quay: 升级提示 — upgrade Node (e.g. nvm install 22) and re-run, or use the built dist/quay.js whose floor is declared separately (AC4).
      exit=1
      ```
      Contract measure（低版本实测）：
      ```
      $ node --version && QUAY_TEST_NODE_VERSION=18.19.1 node packages/quay/bin/quay.cjs --version 2>&1 | grep -c 'Node.*22\.\|升级\|>=22'
      v25.2.0
      3
      ```
      `clear_error` = 3 ≥ band 1（低版本报清晰错误非裸 bad option）。scoped 测试 AC1 e2e（模拟低版本走真实
      launcher，断言 stderr 含 22.6 + 升级提示且**不含** `bad option`）PASS。
- [x] AC2: Node ≥22.6 正常路径零影响（探针不挡正常使用）
      —— 高版本 control：`node packages/quay/bin/quay.cjs --version` 正常透传（exit 0，输出 0.3.13），
      grep 计数 = 0（零告警）。scoped 测试 AC2 e2e（真实 launcher 透传到 quay.ts）PASS。探针仅在新
      `.cjs` 入口；旧直连 `node --experimental-strip-types packages/quay/bin/quay.ts` 原样可用。
- [x] AC3: 探针纯 JS 可在老 node 上执行（不依赖 strip-types）
      —— probe 为纯 CommonJS（`packages/quay/bin/node-version-probe.cjs`，`.cjs`，仅用
      require/process/console，无任何 strip-types/ESM-only 语法）。scoped 测试 AC3 用
      `createRequire` 无 strip-types 纯加载通过（老 node 上 `require` 即可执行，满足鸡生蛋约束）。
- [x] AC4: 与 dist-follow/upgrade-channel（在飞）交叉标注——dist 路径 floor 单独判断
      —— CLAUDE.md Run-the-CLI 注明：dist 路径（dist/quay.js，esbuild 转译产物）由
      dist-verify-node-floor CI 声明**独立 floor**，不经过源码探针（探针只保护
      `--experimental-strip-types` 源码路径的 22.6 floor）。`tasks/gap-upgrade-channel-cant-sync-
      build-artifacts-dist-stale.md` `## Cross-annotation` 加交叉标注段（见该文件）。

## Evidence（scoped 验证实跑输出）

```
$ bash scripts/test.sh --for-task gap-no-active-node-version-check-users-cant-tell-upgrade --allow-thin
warning: test-selection-thin: ... resolved tests for 0/5 Touches entries (0.00) < 0.5; pass --allow-thin to run anyway
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: run_checker "task-contract-check" ... --strict-subset '<this task>' '<upgrade-channel task>'
task-contract-check: no violations.
...
  scoped check: run_checker "adr016-screen-use-check" ...
adr016-screen-use-check — 117 shell script(s) scanned
violations: 1
  plugin/scripts/session-liveness.sh:913 ... [taint-flow ← $masked_content]
PASS: active whole-screen-hash violations (1) within band (0..1)
== build dist/quay.js ... ==
== build dist/quay-native.js ... ==
== mirror vendored plugin dist ... ==
✔ AC3: the probe module is pure CommonJS — loads without strip-types (plain node:test run)
✔ AC1: versions below the 22.6 floor fail closed with a clear message (naming floor + upgrade hint)
✔ AC2: versions at/above the 22.6 floor are a no-op (ok, empty message)
✔ AC1 e2e: the real launcher fails closed on a simulated low Node (QUAY_TEST_NODE_VERSION seam)
✔ AC2 e2e: the real launcher passes through on the current Node (>= floor, zero impact)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Contract invoke（探针存在性 grep）：
```
$ grep -rn 'versions.node\|process.version\|22\.6' packages/quay/bin/ plugin/scripts/
packages/quay/bin/quay.cjs:7:  // real TS entry when the runtime is below the `--experimental-strip-types` floor (22.6),
packages/quay/bin/node-version-probe.cjs:6:  // (`node --experimental-strip-types bin/quay.ts`) requires Node >= 22.6. package.json's
packages/quay/bin/node-version-probe.cjs:23:  // `node --experimental-strip-types` needs Node >= 22.6 (the source-execution floor).
packages/quay/bin/node-version-probe.cjs:39:  // version string the way Node reports it in `process.versions.node` — it does NOT trust the
packages/quay/bin/node-version-probe.cjs:42:  // When `versionString` is omitted, the REAL runtime's `process.versions.node` is checked,
packages/quay/bin/node-version-probe.cjs:52:  // *   required — the floor as "22.6"
packages/quay/bin/node-version-probe.cjs:57:      versionString || process.env.QUAY_TEST_NODE_VERSION || process.versions.node
```

## Touches

- tasks/gap-no-active-node-version-check-users-cant-tell-upgrade.md
- packages/quay/bin/（入口版本探针）
- plugin/scripts/quay-init.sh（若探针放 init）
- CLAUDE.md（调用方式注明所需 Node 版本）
- tasks/gap-upgrade-channel-cant-sync-build-artifacts-dist-stale.md（AC4 交叉标注）

## Test-Files

- packages/quay/test/node-version-probe.test.mjs（AC1/AC2/AC3 探针测试；用 createRequire 纯加载探针 + 真实启动 launcher 的 QUAY_TEST_NODE_VERSION seam）

## Contract

measure   clear_error = `node --version && node <entry> 2>&1 | grep -c 'Node.*22\.\|升级\|>=22'` 在低版本实测 stdout 数字段
band      clear_error >= 1（低版本报清晰错误非裸 bad option）
invoke    `grep -rn 'versions.node\|process.version\|22\.6' packages/quay/bin/ plugin/scripts/`
control   高版本零告警（AC2）；低版本报错（AC1）
resume    探针与文档分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T16:5xZ
changed: 管理者 B 机采纳者实测（使用视角）立案——engines 被动声明非主动检查，裸 bad option 对采纳者不可行动。
