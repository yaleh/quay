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
- test/driver-resolves-code-root-separate-from-workspace.test.mjs
- tasks/gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root.md

## 相关任务（同一根因族的三个实例；立案时按机制查重的记录，非上文证据的一部分）

**根因族（同一句话）**：quay 的运行时把「工作区 root」与「quay 代码所在地」当成同一个目录。
在 quay 自己的开发检出里两者恰好重合 ⇒ 全部自测绿；upgrade-channel（vendor）安装下两者分离 ⇒ 该面失效，
且失效形态静默（进程活着 / 读到别人的数据 / 零字节诊断，都不是报错）。

三个实例，各在**不同的面**，⛔ 互不覆盖：

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
