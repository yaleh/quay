---
id: gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root
title: 第三方项目上 driver 层实质不工作——driver 按 <project-root>/packages|plugin 找 quay 自己的脚本
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

**现象（2026-09-13 实测，全新第三方项目 /home/yale/work/quay-fleet，经 quay-init + upgrade-channel 安装，
四个 driver 进程均 alive=1、web server HTTP 200）**：进程全部活着、载体持续在写、
状态词表也诚实（该 not-evaluated 的地方确实报 not-evaluated，**硬规则 3b 这一层是做对的**），
**但所有实质判据都取不到值**：

`.quay/goal-round.jsonl` 末轮（round 14）：

```
fact goal-ring          state=failed
  reason: list failed: goal-store list failed (exit 1):
          Error: Cannot find module '/home/yale/work/quay-fleet/packages/quay/src/goal-store.ts'
fact goal-target-health state=not-evaluated (cause=no-target-configured)
```

`.quay/outer-round.jsonl` 末轮（round 14）——11 条 fact 里 6 条因同一根因取不到值：

```
occupancy              not-evaluated  slot-refill unreadable/unparseable
not_yet_flipped        not-evaluated  ready-pool-check unreadable/unparseable
slot_refill            not-evaluated  slot-refill unreadable/unparseable
closure_pass           not-evaluated  closure pass unreadable/unparseable
judgment_consumer      not-evaluated  judgment-consumer-check unreadable/unparseable
self_stop              failed         consecutive 3 rounds no task progress (0 terminal brackets closed)
```

**根因**：driver 调用 quay 自己的脚本/模块时，路径按 **`<workspaceRoot>/packages/...`**
或 `<workspaceRoot>/plugin/scripts/...` 拼装——那是 **quay 开发检出**的布局。
而 `quay-init` 的 upgrade-channel 安装把 provider 指向 `<plugin-root>/vendor/...`，
第三方项目的 root 下**根本没有** `packages/` 或 `plugin/`。
缺失模块路径 `'/home/yale/work/quay-fleet/packages/quay/src/goal-store.ts'` 逐字证明了这一点：
它把**项目 root** 和**quay 代码所在的 plugin root** 当成了同一个东西。

**这不是孤例，是同一族的第三个实例**（前两个已分别立案）：

- `gap-start-drivers-cli-resolve-blind-to-vendor-layout-and-swallows-enoent`
  —— `resolveCliInvocation` 只认 `<root>/packages/quay/bin/quay.ts` 与 PATH，不认 vendor 布局。
- `gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak`
  —— `resolveSiblingDir` 用 `findRepoRoot(process.cwd())`，而 cwd 是 provider path（在 quay 仓库内）。

**共同形态：quay 的运行时把「工作区 root」与「quay 代码所在地」当成同一个目录。**
在 quay 自己的检出里这两者恰好重合，所以全部自测都绿；一旦分离（正是 upgrade-channel 安装的定义），
整层就失效。**这是硬规则 4「一个结构上不可能取假的量不是测量」的实例**——
在开发检出里跑的 driver 测试，结构上无法暴露这个缺陷。

**影响**：任何经 upgrade-channel/vendor 安装 quay 的第三方项目，driver 层**实质不工作**。
它不会报错退出（进程活着、载体在写），因此从「进程 alive」这个代理量看一切正常——
**要看 `.quay/*-round.jsonl` 里 fact 的 state 才能发现**。

## Plan

1. 找出 driver 运行时**全部**按 `<workspaceRoot>/packages|plugin/...` 拼 quay 自身代码路径的位置
   （至少覆盖 goal-driver 调 goal-store、outer/worker driver 调 slot-refill / ready-pool-check /
   closure-pass / judgment-consumer-check 这几条），逐一改为从 **plugin root** 解析
   （`process.env.CLAUDE_PLUGIN_ROOT`，或调用方自身路径反推），与 workspaceRoot 彻底分离。
2. 落一个**单一**的解析入口（例如 `resolveQuayCodeRoot()`），禁止各处各拼一次——
   否则下一个实例还会出现。改完后加一条静态检查：driver 代码里不得再出现
   `path.join(root, "packages"` / `path.join(root, "plugin"` 这类拼法。
3. 因为「开发检出里两者重合」结构上掩盖该缺陷，测试必须**显式把两者分开**：
   fixture 用一个不含 `packages/`/`plugin/` 的临时 root + 一个独立的 plugin root。

## Acceptance Criteria

- [ ] AC1（负控制，改前必须红）：在一个不含 `packages/` 与 `plugin/` 的临时 workspace root 上，
      以独立 plugin root 跑 goal-driver 一轮，改前 `goal-round.jsonl` 末轮的 `goal-ring`
      state=failed 且 reason 含 `Cannot find module`；改后同一条件下 state=verified。
- [ ] AC2：同条件下跑 outer-driver 一轮，改后 `occupancy` / `not_yet_flipped` / `slot_refill` /
      `closure_pass` / `judgment_consumer` 五条 fact **均不再**因 `unreadable/unparseable` 而 not-evaluated
      （允许因「无数据」而 not-evaluated，但 reason 必须不含 unreadable/unparseable）。
- [ ] AC3：`resolveQuayCodeRoot()`（或等价单一入口）存在，且 driver 目录下
      `path.join(<root变量>, "packages"` / `"plugin"` 的出现次数为 0——静态检查器 + fixture 双向控制。
- [ ] AC4：全量 `scripts/test.sh` 绿。

## Definition of Done

在**真实的第三方项目** /home/yale/work/quay-fleet 上（非 fixture、非临时目录）：
`goal-round.jsonl` 新一轮的 `goal-ring` state=verified，且 `outer-round.jsonl` 新一轮里
AC2 那五条 fact 的 reason 均不含 `unreadable/unparseable`。
fixture 满足不算数（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/scripts/driver-filters.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/ready-pool-check.ts
- plugin/scripts/slot-refill.ts
- plugin/scripts/outer-driver.ts
- plugin/scripts/meta-driver.ts
- plugin/scripts/kernel-sibling-resolution-check.ts
- plugin/scripts/checker-mutation-cases/kernel-sibling-resolution-check.sh
- plugin/scripts/capability-catalog.sh
- plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs
- tasks/gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root.md

**测试落点更正（coordinator 2026-09-13，立案当轮）**：原给定的 Touches 写的是裸 `test/…`，
而 `scripts/test.sh` 头注释（唯一正本）里套件发现的 glob 只有 `packages/*/test/`、`plugin/test/`、
`experiments/quay-perpetual-stream/test/` —— **没有裸 `test/`** ⇒ 落在那里的测试套件永远不会执行，
AC3 的静态检查随之空转（**与「验过了」同形**，硬规则 3b / 4c）。
已改为 `plugin/test/…`，与本任务其余 Touches 全在 `plugin/scripts/` 下的惯例对应。

**实现轮 Touches 增补（worker 2026-09-13，实现后按实际改动补齐——⛔ 不改完就退出会让 fan-in 的 delta
判定把改动文件判成「与任务无关」）**：立案清单之外实际改了 5 个文件，各附「为什么清单没预见」：

- `plugin/scripts/outer-driver.ts` —— **AC2 逐字点名的那个 driver**（五条 fact 的 argv 全在本文件里），
  立案清单却漏列它；AC2 与 Touches 不一致时按 AC 执行，并把缺口记在这里。
- `plugin/scripts/meta-driver.ts` —— `goalStoreArgv` 是 goal-store 脚本路径的**唯一构造点**
  （goal-driver 经它消费）；只改 goal-driver 的 `scriptRoot` 等于把单一入口做了一半。
- `plugin/scripts/kernel-sibling-resolution-check.ts` 与
  `plugin/scripts/checker-mutation-cases/kernel-sibling-resolution-check.sh` —— AC3 要的静态检查器。
  **复用而非新建**：本仓已有该检查器，但它对 `kernel-sibling-dev-tree-only` 标记的豁免**正是本缺陷
  活下来的原因**（AC-225 的残差：生产 driver 被误标 dev-tree-only ⇒ 检查器恒绿 ⇒ 记录上看起来这条
  义务正在被执行）。故在其上加 DRIVER-SCOPE 规则（该范围**不认**豁免 + 收 P2 正则结构上覆盖不到的
  资源形，如 `drivers.yml`/`.claude-plugin`），并补突变用例把红/绿两面都钉住。
- `plugin/scripts/capability-catalog.sh` —— 该检查器声明的 QUESTION 是本仓「机件回答什么问题」的
  唯一正本；判定面扩了半个，QUESTION 必须同步，否则 catalog 与实现漂移。

⚠️ `driver-filters.ts` / `ready-pool-check.ts` / `slot-refill.ts` 三个立案清单条目**零改动**：
按位置检索（`path.join(<root>, "packages"|"plugin"`）在这三个文件里命中 **0** 处
（它们是**被解析方**而非解析方）——保留在清单里，作为「计划看过、确认无需改」的记录。

## 相关任务（同一根因族的三个实例；立案时按机制查重的记录，非上文证据的一部分）

**根因族（同一句话）**：quay 的运行时把「工作区 root」与「quay 代码所在地」当成同一个目录。
在 quay 自己的开发检出里两者恰好重合 ⇒ 全部自测绿；upgrade-channel（vendor）安装下两者分离 ⇒ 该面失效，
且失效形态静默（进程活着 / 读到别人的数据 / 零字节诊断，都不是报错）。

三个实例，各在**不同的面**，⛔ 互不覆盖（另两条的 id 与 `status: ready` 已由 coordinator 用文件系统核实）：

1. `gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak`（status: ready）
   —— **provider 载体解析面**：`packages/quay-native/bin/quay-native.ts:66` `resolveSiblingDir`
   走 `findRepoRoot(process.cwd())`，cwd 是被迁到 `$PLUGIN_ROOT/vendor/quay-native` 的 provider.path
   ⇒ 向上第一个 `.quay/config.yml` 是 **quay 仓库自己** ⇒ 第三方项目的 adr/goal/meta 串到 quay 仓库。
2. `gap-start-drivers-cli-resolve-blind-to-vendor-layout-and-swallows-enoent`（status: ready）
   —— **「用哪个 quay CLI」解析面**：`plugin/scripts/start-drivers.ts:83` `resolveCliInvocation`
   只认 `<root>/packages/quay/bin/quay.ts` 与 PATH，不认 vendor 布局；且 spawn ENOENT 被吞（零字节诊断）。
3. **本条** —— **driver 运行时「quay 自己的脚本/模块在哪」解析面**：按
   `<workspaceRoot>/packages|plugin/...` 拼装 ⇒ goal-driver 调 goal-store 报 `Cannot find module`、
   outer-driver 的五条 fact 因 `unreadable/unparseable` 取不到值。

⇒ 三条应按**同一根因族**一起看：①②③ 修任一条，其余两条仍会独立失效。
⛔ 不要把其中任一条的修复当作该族已闭合的证据（硬规则 5b：在某处修好 X ≠ X 只在那一处）。
本条的 Plan 2（单一 `resolveQuayCodeRoot()` 入口 + 静态检查）是该族**唯一**的收敛点，
若只按现象逐处补丁，下一个实例仍会出现。

### 既有 done 任务（命中相邻机制，⛔ 不视为重复，且其残差正是本条的证据）

`gap-driver-runtime-driver-path-anchored-at-project-root-not-dist`（**status: done**，`goal_ac: AC-203`）
修的是 **driver-runtime 拼 `<opts.root>/plugin/scripts/<driver>.ts`**（supervisor spawn driver 本体）
与 **start-drivers 只信退出码不读活体**。其 AC2 逐字要求
`grep -n 'path.join(.*"plugin"' plugin/scripts/driver-runtime.ts` 命中数为 0。

**为什么本条不是它的重复（两条独立理由）**：

- **面不同**：它解决的是「driver **进程本身**能否被 spawn 起来」——本条现场实测四个 driver 进程
  `alive=1`、载体持续在写，即那一层**已经修好且在生产上生效**。本条坏的是 driver **跑起来之后
  再去调用 quay 的其它脚本/模块**（goal-store / slot-refill / ready-pool-check / closure-pass /
  judgment-consumer-check）时的解析——这些调用点不在该任务的 Touches 里。
- **它自己的 AC6（生产复跑）未勾**（任务体标注「待外部」）⇒ 该族在真实第三方项目上从未被端到端确认过；
  本条的实测读数正是那次缺席的复跑所暴露的残差。

⊢ 实现本条时应先核对该 done 任务留下的解析手法（driver-runtime 已改为从自身安装位置解析），
**优先把它推广成 Plan 2 的单一入口**，而不是再造第二套解析——否则该族会出现第四个实例。

### 实现轮的两个额外发现（同族的不同「层」，已随本条一并修掉；读这里的读者不要以为只有路径一层）

1. **脚本路径之外还有 cwd 一层**：`judgment-consumer-check.ts` 审计的是【kernel 自己的代码】
   （判定面全是 repo 相对路径 `plugin/scripts/*.ts`、`plugin/loop/*.md`）。只把脚本路径修对、
   cwd 仍落在目标工作区 ⇒ 全部判 `missing-file` ⇒ `drift=true` / exit 1 ⇒ `runJson` 读成 null
   ⇒ 该 fact 恒 not-evaluated（**工具能跑、读数恒空 = 空转**，硬规则 4c）。
   实测：路径修好后这一条仍 not-evaluated，改 `cwd = quay 代码根` 才 verified。
2. **缺省 root 是「脚本自己所在仓库」而不是 cwd**：`closure-lag-check.sh` 无 `--root` 时用
   `$SCRIPT_DIR/../..`。修好脚本路径后若不传 `--root`，它会去扫 **quay 自己的 `tasks/`**——
   第三方项目上表现为「工具跑起来了、读数来自别的项目」，比 not-evaluated 更难发现
   （且 `--close-terminal` 是写类动作）。三条 closure 例程已改为一律显式传 `--root root`。

## 立案当轮的状态读数（直接量，不给成因结论）

本任务以 `status: todo` 写入（`task_write` 返回体逐字 `"status":"todo"`，`updatedAt` 1789288681257）。
紧接着的一次 Touches 修正写入（`expectedStatus: todo`）撞到 CAS conflict，报文逐字：
`expected status "todo" but actual current status is "ready" — another writer changed it first`。
⇒ **本任务在立案后数十秒内被另一写者翻成 `ready`**，本轮正文修正改用 `expectedStatus: ready` 完成。
形态与同族任务 `gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak` 立案当轮记录的读数一致
（该条也在约 49 秒内被翻 ready）。**写这段的会话无 Bash/git 工具，未能核实翻转者身份**——
形态符合 promotion-driver 的机械晋升，但未验证（硬规则 4 推论四：能解释现象的说法不是被检验的结论）。
