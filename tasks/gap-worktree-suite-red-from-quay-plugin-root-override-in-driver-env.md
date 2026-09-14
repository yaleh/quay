---
id: gap-worktree-suite-red-from-quay-plugin-root-override-in-driver-env
title: worktree 全量套件结构性恒红 —— driver 环境带的 `QUAY_PLUGIN_ROOT` 覆盖指针 +
  一条把【断言者所在树】当【kernel 安装树】的断言（loop 自 2026-09-14T06:40Z 起零落地）
status: done
needs_human_cause: unclassified
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Finding

**直接读数（2026-09-14 06:40Z 起，两次独立 fan-in 全量轮）**：`plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs`
的 `AC3a'` 在 **worktree 里**恒红 ⇒ 全量套件红 ⇒ fan-in 不落地：

```
.quay/verification-round.jsonl r1688 (06:40:42Z, task gap-abi-task-list-times-out-at-2000-tasks-…)
  perFile plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs passed=false
r1689 (06:56:20Z, task gap-fan-in-ts-typecheck-gate-cannot-read-third-party-config)  同上 passed=false
同一文件 r1686 (05:42Z) 及此前**每一轮** passed=true
```

断言逐字（`:190`）：`assert.ok(cfgPath.startsWith(REPO_ROOT), "配置路径必须落在 quay 安装树下（⛔ 非 workspace root）")`，
其中 `REPO_ROOT = path.resolve(__dirname, "..", "..")`（= **该测试文件所在的那棵树**），
`cfgPath = kernelConfigPath("scripts/drivers.yml")`。

**根因（两条读数并列，不是自洽说法）**：

1. **运行时探针**（在 worktree 内直调生产函数）：
   ```
   process.env.QUAY_PLUGIN_ROOT = "/home/yale/work/quay/plugin"
   resolveQuayCodeRoot()                = /home/yale/work/quay          ← 主检出，⛔ 不是 worktree
   kernelConfigPath("scripts/drivers.yml") = /home/yale/work/quay/plugin/scripts/drivers.yml
   ```
   ⇒ `cfgPath.startsWith(<worktree root>)` 为假 ⇒ 断言必红。
2. **两向对照（区分性检查，一条命令）**：
   ```
   env -u QUAY_PLUGIN_ROOT node --test plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs
     ⇒ ✔ AC3a' 通过
   同一命令在不 unset 的环境下跑 ⇒ ✖ AC3a' 失败
   ```
   ⇒ **触发量已确证是环境变量**，与代码改动无关（本任务分支未触碰 `driver-runtime.ts`：`git diff develop -- plugin/scripts/driver-runtime.ts` 为空）。

**它怎么进来的**：全仓 grep 确认**没有任何生产代码设置** `QUAY_PLUGIN_ROOT`（只有测试与 `packages/quay/src/plugin-root.ts` 的读取侧）。
它是**启动 driver 的那个进程**的环境里的值。driver 六个 kind 于 `2026-09-14T06:33:06-06:33:25Z` 被整体重启，
重启后的 supervisor/driver 环境含该键：

```
$ tr '\0' '\n' < /proc/2781865/environ | grep QUAY_PLUGIN_ROOT     ≈ /home/yale/work/quay/plugin   (promotion supervisor)
$ ps -o lstart= -p 2781865  ⇒ Mon Sep 14 06:33:06 2026
```

`plugin/scripts/suite-driver.ts:180`（`spawnSuiteAndWait`）以 `env: { ...process.env, ...(env ?? {}), QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT: "1" }`
spawn 全量 suite ⇒ 该键被**继承进每一轮 worktree 套件** ⇒ `resolveQuayCodeRoot()` 指主检出。
时间线自洽：05:42Z 的 r1686 仍绿（重启前），06:40Z 的 r1688 起红（重启后），中间正是 06:33Z 的那次重启。

**为什么这是"结构性"而不是一条 flaky**：`scripts/test.sh` 的 worktree 套件路径**必然**继承 driver 环境，
而 `QUAY_PLUGIN_ROOT` 是 `plugin-root.ts` 文档化的**显式指针/测试缝**（operator override），
设计上允许被设置 ⇒ 只要 driver 环境里有它，**每一个任务的 fan-in 全量套件都会红**，与本任务改了什么无关。
观测到的直接后果：**自 06:40Z 起 0 个任务落地**（r1688/r1689 两轮 fan-in 全部 `exited-not-landed`）。

**两个候选修法（判定权不在本条立案者，需 owning layer 显式选定并留理由）**：

- **(a) 环境面**：六个 kind 从**不含该键**的环境重启（该键是 operator override，不是生产配置）。
  零代码改动；修完的判据见 AC3。
- **(b) 代码/测试面**：承认「operator 可以合法地把 kernel root 指向别处」是本机制的设计语义，
  则 `AC3a'` 的 `REPO_ROOT` 是**代理量**（它假定"断言者所在树 == kernel 安装树"，即假定 override 不存在），
  应换成直接量（如 `cfgPath.startsWith(<resolveQuayCodeRoot() 解析出的那棵树>)`，或显式断言
  「`cfgPath` 落在 `resolveQuayCodeRoot()` 所指的安装树下，且**不**落在 `REPO_ROOT` 的 `plugin/scripts` 之外」）。
  ⛔ **不得**改成"只要 existsSync 就算过"——那会把本测试存在的理由（driver 不得按 workspace root 解析）一起删掉。

⚠️ 两条修法**互斥地解决同一个现象**；(b) 若被选中，必须补**两向控制**（有/无 `QUAY_PLUGIN_ROOT` 两种环境下都断言同一语义），
否则 (b) 会把 (a) 这类真实异常也一起放行。

**与既有条目的关系**：`gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker`（done）修的是
「归因不出测试文件时仍重派」的**派发策略**；本条有**明确可归因**的测试文件与**已确证**的触发量，是另一个机制，
⛔ 不视为重复。`gap-closure-lag-driver-runtime-promotion-hardcoded-wallclock-margin`（ready）是墙钟余量击穿，
与本条差一个量（那条是负载相关、本条是环境相关）。

## Acceptance Criteria

- [x] **AC1 根因判定带对照（⛔ 不接受自洽解释）**：两向对照读数已取（worktree 内、同一文件、同一命令，只差环境）——
      改动前：`QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin` ⇒ `ℹ tests 6 / pass 5 / fail 1`（`✖ AC3a'`
      `AssertionError: 配置路径必须落在 quay 安装树下（⛔ 非 workspace root）` @ `:190`）；
      `env -u QUAY_PLUGIN_ROOT` ⇒ `ℹ tests 6 / pass 6 / fail 0`（`✔ AC3a'`）。
      **修法选定 (b)**（测试面：`REPO_ROOT` 代理量 → 直接量），理由与"为什么不选 (a)"见 `## Evidence`。
- [x] **AC2 修法落地且可核**（选 (b)，故贴两向控制 + 可取假证据，⛔ 非 (a) 的进程环境读数）：
      改动后有/无该键两种环境下 `AC3a'` **都通过**（各 `ℹ tests 7 / pass 7 / fail 0`）；
      变异控制（把 `resolveKernelPluginRoot()` 临时改成 `path.join(process.cwd(), "plugin")`，
      = "按 workspace root 解析"形态）⇒ 有该键 `pass 4 / fail 3`（`✖AC3a ✖AC3a' ✖AC3a''-red`）、
      无该键 `pass 5 / fail 2`（`✖AC3a ✖AC3a''-red`）⇒ 判据**两向都取假**；还原后
      `git diff -- plugin/scripts/driver-runtime.ts` 为空。读数逐条见 `## Evidence`。
- [ ] **AC3 生产读数（硬规则 4 推论三：读生产载体，⛔ 不是夹具）**：修复后**至少一轮 worktree 全量套件**对该文件留 `perFile … passed=true` 的记录 ∧ 该轮之后**至少一个任务落地**（fan-in 走完 ff）——逐项判据见续行（待外部）
      ① 在 `.quay/verification-round.jsonl` 里对该文件留 `perFile … passed=true` 的记录（贴 round 号 + startedAt + commit）；
      ② 该轮之后**至少一个任务落地**（fan-in 走完 ff）。
      ⚠️ 本条**结构上无法由本 worker 在自身回合内观测**：本任务自己的 fan-in 全量轮就是"修复后第一轮"，
      而它在本 worker 退出之后才跑 ⇒ 读数留给外层按上述判据取，⛔ 不得由 worker 预填。

## Evidence

### 修法选定 (b)：理由 + 为什么不选 (a)

**不选 (a) 的三条理由**：

1. **不可达（实证）**：该键不是一次性手工 export。扫描全部 `/proc/*/environ`：带
   `QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin` 的 `claude` 进程**全部**是 quay driver 的后代
   （PID 270675 / 2815107 / 730432 / 781238，ppid 均为 worker driver 2782792）；
   而人的交互会话一族（ppid 2737115 派生）**一个都不带**（实测 key=0）。
   ⇒ loop 的重启动作恰恰是**从 driver 派生会话发起**的 ⇒ **每次重启都会把该键重新注入**，
   (a) 只在当次有效、下一轮就回退 —— 它治不了本任务命名的"结构性"。
2. **越层**：driver 生命周期（start/stop/restart）是人 2026-08-24 授权给 **manager** 的常设控制权；
   worker 代行 restart 属跨层动作，且会杀掉自己所在的 worker driver。
3. **(a) 不消除耦合**：套件的红/绿**依赖环境里的 operator override** 这一耦合仍在，(a) 只让当前这次读数变绿。

**选 (b) 的理由**：`REPO_ROOT` 是**代理量**（硬规则 4b）—— 它无名地假定「断言者所在树 == kernel 安装树」，
而 `QUAY_PLUGIN_ROOT` 是 `plugin-root.ts:83` **文档化**的显式指针（"explicit pointer (hermetic tests /
operator override)"；`driver-runtime.ts` `resolveKernelPluginRoot()` 的第一分支），其存在使该前提为假。
改成**直接量** = 解析器自己解析出的 kernel 安装位置。

**生产等价性（(b) 为什么不把 (a) 那类真实异常一起放行）**：实测 driver 载入的是
`/home/yale/work/quay/plugin/scripts/driver-runtime.ts`（ps 命令行），⇒ 该键的值与「无 override 时
`resolveKernelPluginRoot()` 自己算出的值」**逐字相同**（`/home/yale/work/quay/plugin`）⇒ 该键在**生产 driver**
上不改变任何解析结果；它只在 **worktree 套件**里把 kernel 树从「被测树」换成「常驻主检出」——
而后者正是 `plugin-root.ts` 约束①（"from a worktree, NEVER hit that worktree's `plugin/` copy"）所要求的方向。
补偿控制：新判据① 要求「锚定处必须真的是一棵 kernel 安装树」，指针若指向非 kernel 目录即报红（红面 A 实测）。

### 两向对照读数（AC1 / AC2）

worktree 内、同一文件、同一命令，只差环境：

改动**前**（基线，证明触发量是环境变量而不是代码改动）：
```
A) QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin  node --experimental-strip-types --test plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs
   ⇒ ℹ tests 6 / pass 5 / fail 1
   ⇒ ✖ AC3a': AssertionError: 配置路径必须落在 quay 安装树下（⛔ 非 workspace root）
      at …/driver-resolves-code-root-separate-from-workspace.test.mjs:190:10
B) env -u QUAY_PLUGIN_ROOT  <同一命令>
   ⇒ ℹ tests 6 / pass 6 / fail 0    ⇒ ✔ AC3a'
```

改动**后**：
```
A) 有该键 ⇒ ℹ tests 7 / pass 7 / fail 0
B) 无该键 ⇒ ℹ tests 7 / pass 7 / fail 0
```

### 仍能取假（变异控制，⛔ 不是"看着它绿"）

把 `resolveKernelPluginRoot()` 临时改成 `return path.join(process.cwd(), "plugin")`（= 「按
workspace root / cwd 解析」的形态，即本测试文件**存在**的理由），同一文件再跑两向：
```
A) 有该键 ⇒ ℹ tests 7 / pass 4 / fail 3 ：✖AC3a  ✖AC3a'  ✖AC3a''-red
B) 无该键 ⇒ ℹ tests 7 / pass 5 / fail 2 ：✖AC3a            ✖AC3a''-red
```
⇒ 新判据在**两种环境下都取假**；"cwd 形态"恰在**无该键**那一向由 `AC3a''-red` 抓住
（有该键那一向由 `AC3a'` 抓住）—— **两向各缺一角，两个用例必须都在**。
还原后 `git diff -- plugin/scripts/driver-runtime.ts` 为空（exit 0）⇒ 变异**未进提交**。

### 落地内容

- `plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs`：
  `AC3a'` 的 `cfgPath` 判据由 `startsWith(REPO_ROOT)`（代理量）换成三条**直接量**判据
  —— ①`isKernelInstallTree(kernelRoot)`（锚定处必须真的是一棵 kernel 安装树，含 kernel anchor；
  抽成函数以便红面控制测**同一条**判据而非手抄副本）②`fs.existsSync(cfgPath)`（解析落空即红）
  ③锚点由显式指针决定：**有指针 ⇒ `cfgPath === join(override, "scripts/drivers.yml")`（⛔ 不被断言者所在树俘获）；
  无指针 ⇒ 两者重合、保留原有的齿 `startsWith(REPO_ROOT)`**。
  ⛔ **没有**退化成"只要 existsSync 就算过"——原测试存在的理由（driver 不得按 workspace root 解析）仍在，且更锋利。
  新增用例 `AC3a''-red`：绿面 = hermetic 假 kernel 树上解析跟随指针；红面 A = 指针指向**非 kernel 目录**
  ⇒ 判据①取假 ∧ `existsSync` 取假；红面 B = `process.chdir` 到带 decoy `plugin/scripts/drivers.yml` 的
  合法 workspace root ⇒ 解析**不得**被 decoy 俘获。
- `plugin/scripts/suite-driver.ts`：**(b) 不需要动生产代码 ⇒ 未改**（Touches 把它列为"两条候选修法的落点"，
  此处注明实际未改；若选 (a) 才需要在环境面处理）。

### 在飞兄弟分支在同一处的另一版改动（硬规则 5b 扫描）

`task/gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp`（worktree HEAD `c2d6686db`，**未落地**）
在**同一文件同一处**另有一版改动：把 `AC3a'` 全体包进 `try/finally` 并 `delete process.env.QUAY_PLUGIN_ROOT`
（中和该键、原判据不动），并在 r1692（07:37:45Z）实测让该文件转绿。**本条不采用它**，因为它把
「显式指针存在」这一**合法配置**从被测面上抹掉——中和后断言的对象不再是 AC 声明的那个量，
且"有该键"那一向完全失去覆盖。⇒ 本条取**更强的一版**：两向都断言 + 补锚点树直接量判据。
该分支后续合并时此文件会有语义冲突，需由它那侧解决（其任务体已把本文件列入 Touches）。

### 本续做轮（2026-09-14）：AC3 的（待外部）注解位置修正 + AC1/AC2 复验

**读到的机制缺陷（一条命令的读数，⛔ 不是推测）**：本轮开始时对**盘上的任务体**跑 `flipAcGateVerdict(body)` ⇒
`{ok:false, status:"fail", checked:2, total:3, message:"AC 未全勾（checked 2/3，剩余未勾 1 含非待外部项）——未翻 done"}`；
`countCompletionCheckboxes(body).uncheckedItems[0]` 逐字为
`**AC3 生产读数（硬规则 4 推论三：读生产载体，⛔ 不是夹具）**（待外部）：修复后**至少一轮 worktree 全量套件**`，
`isExternalVerificationItem(该文本)` = **false**。

**根因**：该注解**写在条目首行的中间**，而判定是**按位置**的（硬规则 2）——`ready-pool-check.ts:884`
`/（待外部）\s*$/` 只认**条目文本的末尾**，而 `uncheckedItems` 用
`/^\s*-\s*\[[^xX]\]\s+(.+)$/gm` 取条目（`.` 不跨行 ⇒ 条目文本 = **第一条物理行**）。
⇒ 作者已声明的「待外部」语义**未被机制读到**，被 fail-closed 默认成「待本任务」
（`ready-pool-check.ts:877` 契约 3）⇒ worker-driver 的 `acShortCircuitVerdict` 每轮短路
（原因「AC 未全勾（checked 2/3，剩余未勾 1）」）⇒ **本任务结构上永远无法落地，与实现是否完成无关**。

**修正**：仅把 `（待外部）` 移到 AC3 条目**首行末尾**（语义逐字不变；判据内容、续行文字、DoD **均未改**），
使**已经声明过的**语义变得机制可读。⛔ **未勾选 AC3**——生产读数确实不存在，不得预填（续行原文即如此要求）。
修正后同一条命令的读数：`flipAcGateVerdict` ⇒ `{ok:true, status:"pass-external", message:"剩余未勾 1 项均为（待外部）/外层验证——可翻 done"}`。
（`quay task check` 仍报 `2/3`——它只数复选框、不读注解；**flip 闸**才读注解，两者的分歧是既有设计，
见 `fan-in-ac-completion-gate.ts` 与 `ready-pool-check.ts:1026`。）

**AC1/AC2 复验（本轮实跑，⛔ 非照抄上节）**：worktree 内、`git merge develop` 之后，
`plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs`：
A) `QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin` ⇒ `ℹ tests 7 / pass 7 / fail 0`；
B) `env -u QUAY_PLUGIN_ROOT` ⇒ `ℹ tests 7 / pass 7 / fail 0`。
变异控制（`resolveKernelPluginRoot()` 临时改为 `return path.join(process.cwd(), "plugin")`）复验：
A) 有该键 ⇒ `pass 4 / fail 3`（✖AC3a ✖AC3a' ✖AC3a''-red）；B) 无该键 ⇒ `pass 5 / fail 2`（✖AC3a ✖AC3a''-red）
—— 与上节记录的读数**逐条一致**；还原后 `git diff -- plugin/scripts/driver-runtime.ts` 为 **0 字节**。

## Definition of Done

上一条 AC3 的两项读数都在**真实生产轮**里出现（worktree 全量轮的 perFile 绿 + 其后至少一个任务落地），
且 AC1/AC2 的对照读数贴在该条任务体里。⛔ 「本地跑一次绿」不算达成——本条的现象只在
「driver 进程环境 + worktree 套件」这个组合下出现，夹具复现不出。

## Touches

- plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs
- plugin/scripts/suite-driver.ts
- tasks/gap-worktree-suite-red-from-quay-plugin-root-override-in-driver-env.md（自身文件：派发授权的 C8 self-touch——勾 AC + 贴实跑证据）

（若选 (a) 环境面，则本任务零代码改动，Touches 保留为「两条候选修法的落点」并在任务体注明实际未改。）
（**实际选定 (b)**：只改了 `plugin/test/…test.mjs`；`plugin/scripts/suite-driver.ts` 保留为落点声明、实际未改。）

## Needs-Human

**执行 2026-09-14T08:05:48.603Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：unclassified
- 失败步/判词：AC 未全勾（checked 2/3，剩余未勾 1）——续做只需验证并勾选 AC
- run_id：wk-prod-1789367589
- session_id：561c8809-573e-477e-9604-60429656f327
