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
goal_ac: AC-232
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

- [x] AC1（负控制，改前必须红）：在一个 provider.path 位于 quay 仓库内、且 config 的 `env:`
      **不含** `QUAY_NATIVE_GOAL_DIR` 的临时 workspace 上，`goal list` 返回的条目数 > 0
      （即复现串库）；应用本任务改动后，同一 workspace 同一命令返回 `(no goals)`。
- [x] AC2：`resolveSiblingDir` 的解析不再调用 `findRepoRoot(process.cwd())`；
      单测断言：给定 `QUAY_NATIVE_TASKS_DIR=<tmp>/tasks` 且 cwd 位于另一个带 `.quay/config.yml`
      的目录时，`resolveAdrDir()/resolveGoalDir()/resolveMetaDir()` 全部返回 `<tmp>/{adr,goals,meta}`。
- [x] AC3：`quay-init.sh` 对一个全新目录生成的 `.quay/config.yml`，其 `providers.native.env`
      同时包含 `QUAY_NATIVE_TASKS_DIR`/`QUAY_NATIVE_ADR_DIR`/`QUAY_NATIVE_GOAL_DIR`/`QUAY_NATIVE_META_DIR` 四个键。
- [x] AC4：`quay-init.sh` 对一个**已存在且缺这三个键**的 config 幂等增补（不覆盖用户已设的值，
      不重排其余键）；对已有四键的 config 再跑一次不产生 diff。
- [ ] AC5：全量 `scripts/test.sh` 绿。

## Definition of Done

在一个**真实的第三方项目**（非 fixture、非临时目录）上跑通：该项目 `goal list` / `adr list` /
`meta list` 三者都只返回该项目自己的记录，且在其中**真实创建**一条 goal 后，
`/home/yale/work/quay/goals/` 下**没有**新增任何文件。fixture 满足不算数
（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。

## 实现记录（2026-09-13，worker 直读代码 + 实测；含对立案基线的更正）

**⚠️ 立案基线有一处误读，先更正**：Proposal 与「相关任务」里引的
`plugin/scripts/quay-init.sh:989-990` 那个只有 `QUAY_NATIVE_TASKS_DIR` 一个键的 `env:` 块，
**属于 `write_provider_config`（:1097）——一个从未被任何路径调用的死函数**。活着的生成器是
`write_config`（:2187，调用点 :2549 / :2562），**它在全新安装路径上早已写出全部四个键**（:2214-2218）。
⇒ **AC3 在活路径上本来就是满足的**；本条实测到的价值是把它**钉住**（此前无测试）+ 补上 **AC4**
（升级路径确实缺三个键）+ 修**根因**。这也是「两副本」的一次实例：我在 `write_provider_config`
定义处加了 `⛔ DEAD CODE — NEVER CALLED` 标记并写明「立案基线就是被它误导的」（同族死函数还有
`backup_config`/`rollback_config_on_exit`）。**删除留作后续**，不在本条 Touches 内。

**实际改动（三处）**：
1. `packages/quay-native/src/carrier-dirs.ts`（新）——五个解析器从 `bin/quay-native.ts` 抽出。
   抽出理由是**可测性**：bin 在 import 时无条件执行 `main()`，测试**够不到**这些函数，而它们决定的
   正是「读/写哪个工作区的 adr/goal/meta」。sibling 现由**已解析的 tasksDir** 推导
   （`path.dirname(resolveTasksDir())`），与 `src/mcp-server.ts` 自己的默认值同形；env override 仍最高；
   cwd-relative fail-open 兜底原样保留、仍只在同一条件下打印落点。
   ⛔ 硬规则 5b：`resolveDocsDir` 是**同一文件里的兄弟实例**（自带一份同样的 cwd walk），
   一并走同一 helper —— 不是只修被报出来的那三个。
2. `packages/quay-native/bin/quay-native.ts`——删本地五个函数，改为 import。
3. `plugin/scripts/quay-init.sh`——新增 `ensure_provider_carrier_env`，挂在**已有 config 的升级路径**
   （`write_config` 的 existing 分支）。**行级插入**而非 yaml round-trip：`yaml.safe_dump` 会重排整个
   文档并吞注释（`ensure_loop_config` 自己的注释就点名过这个副作用）。值的形式**镜像已有
   `QUAY_NATIVE_TASKS_DIR` 的形式**（`./tasks` ⇒ `./adr`；绝对 ⇒ 绝对），env 块不混形。

**AC2 的字面与实质（避免读者按字面误判）**：`resolveSiblingDir` 函数体内**已无**
`findRepoRoot(process.cwd())`；它走 `resolveTasksDirWithSource()`，后者在 env pin 存在时
**根本不碰** `findRepoRoot`（env 分支先返回）。只有在 tasksDir 自己也得靠 cwd 兜底时才用——
那正是 Plan 要的形态，且 tasks 面的既有契约未改。

**取假控制（两个方向都做了，不是只做单向）**：
- 单测 12 个（`packages/quay-native/test/resolve-sibling-dir.test.mjs`）：每个隔离测试都把 cwd 放在
  **另一个真实 workspace** 里，使改前解析有**确定的错值**可返；端到端那个经 Core 同款 stdio seam
  拉起 provider MCP，并在「另一个 workspace」里放一条 **SENTINEL goal**。换回改前实现 ⇒ **5 红**。
- 配置面 8 个（`plugin/test/quay-init-config-env-keys.test.mjs`）：跑**真 quay-init.sh** 并读它写出的
  文件（不是单测那个函数——函数单测绿而函数从未被调用正是「实现但未接线」）；删掉调用点 ⇒
  **AC4 的 5 个红而 AC3 保持绿**（失败归因正确）。

**DoD（真实第三方项目 `/home/yale/work/quay-fleet`，非 fixture、非临时目录）**：
provider MCP 按 Core 的姿势拉起（`cwd=/home/yale/work/quay/plugin/vendor/quay-native`，
env **只** pin `QUAY_NATIVE_TASKS_DIR` —— 即 **pre-pin 项目的真实形状**），**同一项目、同一目录**，
改前/改后对照：

| 读数 | 改前（develop 的 bin，未改） | 改后（本任务 bin） |
|---|---|---|
| `goal_list` | **124**（AC-143…） | **5**（AC-001..004 + GOAL-001 = 该项目自己的） |
| `adr_list` | **36**（ADR-001…） | **0** |
| `meta_list` | **5**（META-001…） | **0** |

（该项目自有：goals 5 / adr 0 / meta 0。）改后**真实创建**一条 goal（AC-9901）⇒ 落在
`/home/yale/work/quay-fleet/goals/`，`/home/yale/work/quay/goals/` 计数 **124 → 124（无新增）**。
⇒ 读面、写面、DoD 三问同时满足。

**⚠️ 诚实记号（副作用未藏）**：那次 `goal_write` 还触发了 quay-fleet **自己的**
`goals: AC-9901 create by cli:…` 提交（该项目的 goal 写入带 git 包装）。已用
`git reset --mixed HEAD~1` + 删文件**原样还原**（HEAD 回到 `4aad8a9`，`git status` 干净，
`goals/` 回到 5 个文件）。**DoD 的写入探针在真实项目上不是零副作用的**，不留痕就等于谎报。

**顺带（都是被 scoped gate 逼出来的，非主动扩范围）**：
- `plugin/test/quay-init.test.mjs` 的「byte-identical no-op」fixture 补上四个 pin。它断言
  「无需改动的项目不得被改写」，而该 fixture 原本**一个 env 键都没有** ⇒ 在本条之后它已不是
  「无需改动」的项目（补 pin 是正确行为）。**恢复其前提，而不是放宽断言**，负控制力度不变。
- `docs/analysis/quay-init-closure-ratchet.baseline.json` 重新锚定：footprint **不变**
  （3 files / 568 bytes），只有 source sha 与 fingerprint 动 ⇒ 收缩棘轮未被削弱。
- 该 config 形状（真实项目 config 逐字拷贝、env 块内含注释、loop 值全等）实测**逐字节不变**。

**AC5 留未勾（`全量 scripts/test.sh 绿`）**：全量套件由 fan-in 跑，worker 不跑全量；该条文本自带
`全量套件绿` 标记，按既有约定走 pass-external。

## Touches

- packages/quay-native/bin/quay-native.ts
- packages/quay-native/src/carrier-dirs.ts
- plugin/scripts/quay-init.sh
- packages/quay-native/test/resolve-sibling-dir.test.mjs
- plugin/test/quay-init-config-env-keys.test.mjs
- plugin/test/quay-init.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak.md

## 实现提示：测试落点与分组（2026-09-13 直读 `scripts/test.sh` 头注释核实，非转述）

**① 落点**：套件发现的 glob 是 `packages/*/test/`、`plugin/test/`、
`experiments/quay-perpetual-stream/test/`（`scripts/test.sh:80-85` 与 `:107-109`），**没有裸 `test/`**。
本任务 Touches 里的 quay-init 测试因此定在 **`plugin/test/`**（与既有 `plugin/test/quay-init.test.mjs` 同处）——
初稿曾写成 `test/quay-init-config-env-keys.test.mjs`，那个位置**套件永远跑不到** ⇒ AC3/AC4 会静默空转
（硬规则 3b：一个不可能报红的检查与「检查通过」同形）。已改正。
`packages/quay-native/test/resolve-sibling-dir.test.mjs` 命中 `packages/*/test/`，无需改。
**✅ worker 侧已核实**：落地文件名与 Touches 逐字一致（初稿曾写成 `quay-init-carrier-env-pins.test.mjs`，
已 `git mv` 到 Touches 声明的名字，不留第二个副本）。

**② 分组**：AC3/AC4 要跑**真实 quay-init**，属于 `scripts/test.sh:86-98` 点名的
**REAL-INSTALL install/quay-init family**——该族已于 round 162 整体收进 **`serial`** 组
（concurrency 1 独立相），理由是它在全套件负载下逐轮轮换 flake
（`gap-install-family-tests-rotate-flakes-under-full-suite`）。
⇒ 新测试文件首行应声明 **`// @test-group serial`**；漏声明会默认落到 `engine`（`:75-78`）
并回到那个已知会 flake 的负载相里。另注：新文件必须 `import { test } from "node:test"`
（`:16-20` 的 test-framework policy，豁免名单只减不增）。
**✅ worker 侧已核实**：落地文件首行是 `// @test-group serial` + `// @load-sensitive real-install`，
且 `import { test, describe, after } from "node:test"`。

**③ 额外发现（同一条纪律的第三个实例，留给下游）**：`scripts/worktree-include.sh:47-48` 的
`PRIMARY=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')` 在 `set -o pipefail`
下会因 awk 提前 `exit` 触发 git 的 SIGPIPE ⇒ 赋值语句拿到 **141** ⇒ `set -e` **静默终止整个脚本**
（无任何输出）。后果：`dispatch-worktree-setup.sh` 的 provision 步报 `worktree-include.sh failed`，
**worktree 里没有 `.quay/config.yml`**。本次 worker 实测命中一次（退出码 141、零输出），
绕法 = 手工补 `.quay/config.yml` + `plugin/vendor/*/dist/*.js`（即声明清单的内容）。
与 `gap-...-worker-worktree-provision` 同族但**根因不同**（那条是 grep -q 的 SIGPIPE），
本条是 **awk … exit** 的 SIGPIPE（本机复现率非 100%，故为间歇）。⛔ 本条**不改**
（不在 Touches 内），只留痕。

## 共同形态（本条是同一根因族的第一个实例）

**quay 运行时把「工作区 root」与「quay 代码所在地」当成同一个目录**。在 quay 自己的检出里这两者
恰好重合 ⇒ 全部自测绿；**upgrade-channel（vendor）安装下两者分离 ⇒ 整层失效**，且失效形态是
静默的（读到的是 quay 自己的数据，而不是报错）。本条是该族在 **provider 载体解析**面的实例
（`findRepoRoot(process.cwd())` 把 quay 仓库当成第三方项目的 root）。

同族的另两个实例（**2026-09-13 由 coordinator 用文件系统直读核实，非 MCP 读**）：

- `gap-start-drivers-cli-resolve-blind-to-vendor-layout-and-swallows-enoent`
  —— **已落盘，status `ready`**。start-drivers 的 CLI 解析只认 dev 源码树与 PATH。
- `gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root`
  —— **⚠️ 尚未落盘，仍在立案中**（此 id 为预告，引用前先确认其已存在）。
  driver 运行时按 `<project-root>/packages/...` 找 quay 自己的脚本；实测第三方项目上
  goal-ring failed、outer 六条 fact unreadable。

⇒ 三条应按**同一根因族**一起看：修完本条的载体面，另两条的**代码定位面**仍会独立失效；
反之亦然。⛔ 不要把其中任一条的修复当作该族已闭合的证据（硬规则 5b：在某处修好 X ≠ X 只在那一处）。

## 相关任务（立案时按机制查重的记录，非上文证据的一部分）

> **⚠️ 更正（2026-09-13 worker 实测，先读这条再读下面）**：本节的「立案时的位置读数」引的是
> **死函数** `write_provider_config`；活路径 `write_config` 早已写四键。详见上面「实现记录」首段。
> 保留原文不改写，因为**误读本身是证据**（这条误读正是死副本造成的）。

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

立案时曾打 `delivery-critical`，随后由 coordinator 裁定**去掉**。裁定时给了两条理由，**事后只有第一条成立**：

- ✅ 成立：quay 当前 goal store 里没有一条 active 的 AC 适合承接「第三方项目安装面」这个方向
  （AC-174/AC-245 已 achieved，AC-180..187 已 retired），而**为了让任务能晋升去新建 goal AC，
  是把 goal 当晋升通行证用，方向反了**。
- ❌ 不成立（已被同轮实测证否，见下）：「`delivery-critical` + `goal_ac: null` ⇒ 结构上永不晋升
  ⇒ 保留标签等于白立案」。

⇒ 标签保持去掉（凭第一条理由），现为 `gap`/`defect`/`mechanism`，`goal_ac` 留空，走正常晋升路径。

**证否那条说法的直接读数**：本任务以 `todo` + `delivery-critical` + `goal_ac: null` 建立后，
**约 49 秒内就被翻成 `ready`**（`updatedAt` 1789287438222 → 1789287487646；标签编辑的 CAS
撞到 conflict 才暴露出来）。翻转者身份**已由直接量坐实**（coordinator 核 `git log`）：
提交 `980988b56 tasks: … todo→ready（promotion-driver 机械晋升）`——即机械晋升，不再是假说。
⇒ 在 **author→ready 这条边**上，该组合**没有**阻止晋升。
⛔ 但不要把它推广成「那条说法整个是错的」：那条记述原本点名的是 `ready-pool-check` 的
`candidates[].goalAcMissing`，那是**派发面**，与 author→ready 面是两条不同的边；
引用时不分边，才是它被误用的原因（硬规则 4c：判据点名的量必须穿过它实际所在的那一层）。


## goal_ac 背书（2026-09-13，由 `gap-ac190-goal-ac-rule-not-enforced-at-filing` 补）

**本任务 top-level `goal_ac: AC-232`**（`goals/AC-232-下游-goal-载体必须能写-能读回-ac-206-只断言目录建了与可读-写入失败被注为-不阻塞-从未追查.md`，goal=GOAL-009）。

### 为什么是这条 AC（AC3 要求写明的理由）

1. **主题命中——AC-232 的判据点名的正是被本条弄坏的那一面**：本条的实质是「第三方项目的
   goal/adr/meta 载体**不指向该项目自己**」：读串（`quay goal list` 返回 quay 自己的 124 条
   AC-143…）、写也串（在该项目创建 goal 会写进 `/home/yale/work/quay/goals/`，污染 quay 自己的
   goal store）。AC-232 的判据要求的正是**下游 goal 载体能写、能读回**（`goal_write_ok` /
   `goal_read_back_ok` / `goal_records > 0` 三问，其 origin 逐字说明三者缺一不可）。而在串库状态下，
   这三问会被**错误的 store** 满足——写进 quay 自己的 goals 也算「写成功」、从 quay 自己的 store
   读回也算「读回成功」⇒ **本条是 AC-232 那条判据在载体解析层的反例来源**（硬规则 4：一个能被
   说谎字段满足的判据不是测量）。
   ⚠️ 立案时点名的候选是 **AC-206**，读其 criterion 后**改选**：AC-206 的主题是**载体的创建**
   （quay-init 与 `CLOSED_SET_DIRS` 一起创建 `goals/` 目录、判据读 `goals_dir_created` /
   `goal_store_readable`），而本条**不碰创建面**（目录本来就有，问题在解析），只碰**解析面**
   ⇒ 用 AC-206 承接会把「建了没有」和「用的是不是它」两层判据混成一条。
2. **同族单源**：同一个函数的**姊妹实例**
   `gap-quay-init-env-only-tasks-dir-goals-adr-meta-land-inside-npm-package`
   （`findRepoRoot` **落空**那条分支 ⇒ goal/adr/meta 落进安装的 npm 包内）已用 `goal_ac: AC-232`。
   同族的两个实例挂在同一条 AC 上，「这一族何时算闭合」才可判（硬规则 5b：在某处修好 X ≠ X 只在那一处）。
3. **「没有 active 的 AC 可承接」这条前提，按其取假面实测为假**：全仓枚举（2026-09-13）——
   带 `delivery-critical` 标签且 `goal_ac` 非空的任务 **41 条**，其 `goal_ac` 去重后 **22 条，
   status 全部是 `achieved`，0 条 active**（读法：`frontmatterLabels`/`frontmatterGoalAc` 单源解析
   `tasks/*.md`，再读各 `goals/AC-*.md` 的 `status:`）。⇒ 仓库的既有约定是「`goal_ac` 指向**领域覆盖**
   本任务的那条 AC」，**与 AC 的 status 无关**；「必须 active」不是该字段的语义，用它作过滤器得到的
   「无 AC 可承接」是**谓词取错面**（硬规则 2 / 4c：判据点名的量必须穿过它实际所在的那一层）。

### 同时遵守原裁定里成立的那半边

- ⛔ **不新建 goal AC**：为了让任务能晋升而新建 AC = 把 goal 当晋升通行证用，方向反了
  （原裁定理由①的实质部分成立）；本次只补**背书声明**，不为晋升造 AC。
- ⛔ **不恢复 `delivery-critical` 标签**：标签的取舍是 coordinator 的裁定，本次不动标签。
  若后续判定本条确实需要长期保证，再单独立 AC 并重新上标签，而不是先上标签再补 AC。
- 该 `goal_ac` **不改变任何派发/晋升判定**：准入合取不得读 goal 源（人 2026-09-11 裁定，机械守卫
  `plugin/scripts/eligible-no-goal-source-check.ts`，本轮实测 exit 0）；AC-190 的判据只对带
  `delivery-critical` 标签的任务生效，本条无该标签 ⇒ 检测器读数不变（实测 compliant 36 / violating 0）。

> **为什么由本条补**：`gap-ac190-goal-ac-rule-not-enforced-at-filing` 的 AC3/DoD 要求反例被**真实背书**
> 而不是被删掉标签消掉；同时那条任务自己的 DoD 逐字要求「⛔ 只补这一条任务的 `goal_ac` 而不接写入面
> ⇒ 不算完成」。两半合起来才是「规则在违反发生的那一刻起作用，且现存的违反真的被清掉」。
