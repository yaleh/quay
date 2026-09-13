---
id: gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak
title: 第三方项目的 adr/goal/meta store 串到 quay 仓库——quay-init 只 pin 了 tasks_dir
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（2026-09-13 在全新项目 /home/yale/work/quay-fleet 实测）**：跑完 `quay-init.sh` 后，
从该项目执行 `quay goal list` 返回的是 **quay 自己的 goals（AC-143 … AC-153）**，
`quay adr list` 返回 quay 自己的 **ADR-001 … ADR-011**，`meta list` 同理返回 quay 的 META-001…。
只有 `task list` 正确隔离（返回 `No tasks found.`）。**读会串，写同样会串**——
在该项目创建 goal 会写进 `/home/yale/work/quay/goals/`，污染 quay 自己的 goal store。

**根因（已定位到行）**：
- `packages/quay-native/bin/quay-native.ts:66` `resolveSiblingDir(envName, kind)`：
  env 未设时走 `findRepoRoot(process.cwd())`，即**从 MCP 进程 cwd 向上找第一个 `.quay/config.yml`**。
- `resolveAdrDir`(:78) / `resolveGoalDir`(:96) / `resolveMetaDir`(:104) 三者全部走这条路径。
- MCP 进程的 cwd 是 provider.path，而 `quay-init.sh` 的 **upgrade-channel runtime migration**
  会把 provider.path 从项目本地的 `./node_modules/quay-native` 改写为
  `/home/yale/work/quay/plugin/vendor/quay-native`（init 输出原文：
  `migrated: path './node_modules/quay-native' -> /home/yale/work/quay/plugin/vendor/quay-native`）。
  自该目录向上，第一个带 `.quay/config.yml` 的目录就是 **quay 仓库本身**。
- `tasks` 之所以幸免，仅仅因为 `quay-init` 在 config 的 `env:` 里显式写了 `QUAY_NATIVE_TASKS_DIR`，
  而 adr/goal/meta **没有对应的 env**。

**设计意图已被违背**：`packages/quay-native/src/mcp-server.ts:35-36` 的注释明写
「default to `<parent-of-tasksDir>/adr` when adrDir is not supplied」，
即 sibling 目录本应**跟着已解析的 tasksDir 走**；而 bin 层的 `resolveSiblingDir` 却重新从 cwd 找 repo root，
两层不一致。src 层的默认是对的，bin 层传进来的值覆盖了它。

**影响面**：任何经 upgrade-channel（vendor）安装 quay 的第三方项目，其 adr / goal / meta
三个 store 全部与 quay 仓库共享，且静默——`quay-init` 的输出里没有任何警告，
只有 MCP server 启动时那行 `serving tasks from … ADRs from … meta from …` 里能看出来，
而它混在 stderr 噪声里。

## Plan

两处都改，缺一不可：

1. **根因修**：`packages/quay-native/bin/quay-native.ts` 的 `resolveSiblingDir` 改为
   **从已解析的 tasksDir 推导** —— `path.join(path.dirname(resolveTasksDir()), kind)`，
   与 `src/mcp-server.ts:36` 文档化的意图一致；env override 仍然最高优先级。
   这样即使 provider.path 在 quay 仓库内，只要 tasksDir 正确，三个 sibling store 就跟着正确。
2. **配置面修**：`plugin/scripts/quay-init.sh` 生成 config 时，
   与 `QUAY_NATIVE_TASKS_DIR` 并列写出 `QUAY_NATIVE_ADR_DIR: ./adr`、
   `QUAY_NATIVE_GOAL_DIR: ./goals`、`QUAY_NATIVE_META_DIR: ./meta`（对已有 config 幂等增补）。
   即便根因修好，显式 pin 也是对的——它让隔离在 config 里可见可审。

## Acceptance Criteria

- [ ] AC1（负控制，改前必须红）：在一个 provider.path 位于 quay 仓库内、且 config 的 `env:`
      **不含** `QUAY_NATIVE_GOAL_DIR` 的临时 workspace 上，`goal list` 返回的条目数 > 0
      （即复现串库）；应用本任务改动后，同一 workspace 同一命令返回 `(no goals)`。
- [ ] AC2：`resolveSiblingDir` 的解析不再调用 `findRepoRoot(process.cwd())`；
      单测断言：给定 `QUAY_NATIVE_TASKS_DIR=<tmp>/tasks` 且 cwd 位于另一个带 `.quay/config.yml`
      的目录时，`resolveAdrDir()/resolveGoalDir()/resolveMetaDir()` 全部返回 `<tmp>/{adr,goals,meta}`。
- [ ] AC3：`quay-init.sh` 对一个全新目录生成的 `.quay/config.yml`，其 `providers.native.env`
      同时包含 `QUAY_NATIVE_TASKS_DIR`/`QUAY_NATIVE_ADR_DIR`/`QUAY_NATIVE_GOAL_DIR`/`QUAY_NATIVE_META_DIR` 四个键。
- [ ] AC4：`quay-init.sh` 对一个**已存在且缺这三个键**的 config 幂等增补（不覆盖用户已设的值，
      不重排其余键）；对已有四键的 config 再跑一次不产生 diff。
- [ ] AC5：全量 `scripts/test.sh` 绿。

## Definition of Done

在一个**真实的第三方项目**（非 fixture、非临时目录）上跑通：该项目 `goal list` / `adr list` /
`meta list` 三者都只返回该项目自己的记录，且在其中**真实创建**一条 goal 后，
`/home/yale/work/quay/goals/` 下**没有**新增任何文件。fixture 满足不算数
（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。

## Touches

- packages/quay-native/bin/quay-native.ts
- plugin/scripts/quay-init.sh
- packages/quay-native/test/resolve-sibling-dir.test.mjs
- test/quay-init-config-env-keys.test.mjs
- tasks/gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak.md

## 共同形态（本条是同一根因族的第一个实例）

**quay 运行时把「工作区 root」与「quay 代码所在地」当成同一个目录**。在 quay 自己的检出里这两者
恰好重合 ⇒ 全部自测绿；**upgrade-channel（vendor）安装下两者分离 ⇒ 整层失效**，且失效形态是
静默的（读到的是 quay 自己的数据，而不是报错）。本条是该族在 **provider 载体解析**面的实例
（`findRepoRoot(process.cwd())` 把 quay 仓库当成第三方项目的 root）。

已知另两个同族实例（**id 由 coordinator 2026-09-13 提供；本条立案时 `task_get` 在本 workspace 的
default provider 对两者均返回 `no such task`，`task_list` 搜索连续超时未能复核 ⇒ 引用前请先核对
id 是否已落盘、或是否落在另一个 store**）：

- `gap-start-drivers-cli-resolve-blind-to-vendor-layout-and-swallows-enoent`
  —— start-drivers 的 CLI 解析只认 dev 源码树与 PATH。
- `gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root`
  —— driver 运行时按 `<project-root>/packages/...` 找 quay 自己的脚本；实测第三方项目上
  goal-ring failed、outer 六条 fact unreadable。

⇒ 三条应按**同一根因族**一起看：修完本条的载体面，另两条的**代码定位面**仍会独立失效；
反之亦然。⛔ 不要把其中任一条的修复当作该族已闭合的证据（硬规则 5b：在某处修好 X ≠ X 只在那一处）。

## 相关任务（立案时按机制查重的记录，非上文证据的一部分）

`gap-quay-init-env-only-tasks-dir-goals-adr-meta-land-inside-npm-package`（**status: done**，2026-09-10）
命中同一个函数，但**是另一条分支、另一种落点**，故不视为重复：

- 那一条管 `findRepoRoot` **落空**的分支（vendored 包目录向上没有 `.quay/config.yml`）⇒ 退到
  `path.resolve(process.cwd(), kind)` ⇒ 载体落进**安装的 npm 包内**。其修法逐字保留了这个 fallback
  （`bin/quay-native.ts:63-65` 注释：「We keep the fallback (fail-open …) but PRINT where it resolved to」），
  只加了一行 stderr。
- 本条管 `findRepoRoot` **命中了错误的 repo** 的分支（`:69-70`）：provider.path 被 upgrade-channel 迁到
  `$PLUGIN_ROOT/vendor/quay-native` 后，向上第一个 `.quay/config.yml` 就是 **quay 仓库自己** ⇒ 直接
  `return path.resolve(repoRoot, kind)`，**连那行 stderr 都不会打印**（它只在 fallback 分支里）。
  ⇒ 前一条的修法在结构上覆盖不到本条。
- **立案时的位置读数（改前基线，2026-09-13 读当前盘上代码）**：
  `plugin/scripts/quay-init.sh:989-990` 生成的 `env:` 块**只有 `QUAY_NATIVE_TASKS_DIR` 一个键**——
  即前一条任务 AC2/AC3 声称的「四个 `QUAY_NATIVE_*_DIR` 键」**在当前生产脚本里不存在**。
  本条的 AC3/AC4 因此是对该配置面的重新落实，实现时应先核对这段历史（是从未落地、落在了另一个副本、还是被回退）。

## 标签裁定记录（2026-09-13）

立案时曾打 `delivery-critical`，随后由 coordinator 裁定**去掉**：quay 当前 goal store 里没有一条 active
的 AC 适合承接「第三方项目安装面」这个方向（AC-174/AC-245 已 achieved，AC-180..187 已 retired），
而**为了让任务能晋升去新建 goal AC，是把 goal 当晋升通行证用，方向反了**。
⇒ 现标签 `gap`/`defect`/`mechanism`，`goal_ac` 留空，走正常晋升路径。

**⚠️ 同轮实测，与「delivery-critical + `goal_ac: null` ⇒ 结构上永不晋升」这条既有说法不符，记录读数**：
本任务以 `todo` + `delivery-critical` + `goal_ac: null` 建立后，**约 49 秒内就被另一写者翻成 `ready`**
（`updatedAt` 1789287438222 → 1789287487646；标签编辑的 CAS 因此撞到 conflict 才暴露出来）。
⇒ 至少在 **author→ready 这条边**上，该组合**没有**阻止晋升。
⛔ 不要据此反推「那条说法是错的」——它可能针对的是另一条边（ready→派发/goal-backed 晋升，
即 `ready-pool-check` 的 `candidates[].goalAcMissing`）。这里只记录**直接读数**，不给成因结论
（硬规则 4 推论四：能解释现象的说法不是被检验的结论）。写这段的会话无 Bash/git 工具，
**未能核实翻转者身份**（形态符合 promotion-driver 的机械晋升，但未验证）。
