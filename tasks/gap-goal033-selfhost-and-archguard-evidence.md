---
id: gap-goal033-selfhost-and-archguard-evidence
title: GOAL-033 ②：ArchGuard before/after（cli 与仅经 cli 入环的 fan-in 离开 package SCC
  6→4）+ 负对照 + CLI 语义现场重算
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal033-driver-control-and-vocab-to-core
goal_ac: AC-351
---
**type:** execution

## Proposal

GOAL-033 的第二块（分支自举 + ArchGuard before/after）：在实现已进入 `goal/GOAL-033` 之后，用**同一个 ArchGuard 构建**对 fork point 与分支 tip 各做一次单根分析，产出 AC-351 读取的证据文件，并附一个**可证伪的负对照**——证明「`cli` 离开 package SCC」这个读数不是恒真的。

为什么要单独一块：AC-350 只看源码层（grep 按位置判定 + 两个仓内检查器），它证明「边没了」；但 GOAL-033 的目标陈述是「目录环缩小」，那是 ArchGuard 的 package 级 SCC 读数，属于另一个仪器、另一个层面。两者都要有，且 SCC 读数必须能取假，否则它只是「与成功同形」的回声（硬规则 4）。

已知 before 读数（调查时取，scope `26b300e9`，develop `1025ab951`，与 fork point `1ac06fd85` 的 `packages/quay/src` 逐字相同）：`detect_cycles(outputScope:"package")` ⇒ 恰好 1 个 SCC，成员 `["", "cli", "fan-in", "gate", "gate/config", "gate/factories"]`；`get_package_metrics(packageName:"cli")` ⇒ `fanIn: 2`。本任务要在 fork point 上**重新取一次**（不抄调查读数），确认可复现。

## Plan

1. **记录 ArchGuard 版本**：before 与 after 必须是同一个构建；把版本串写进证据（`archguardVersion`）。若会话中 ArchGuard 版本变化，两次都重取。
2. **before（fork point）**：`git worktree add --detach /home/yale/work/quay-worktrees/goal033-fork 1ac06fd85`（⛔ 不放 `/tmp`）。对它跑 `archguard_analyze(projectRoot=<该 worktree>, sources:["packages/quay/src"], lang:"typescript", format:"json")`，**显式传回显的 scope key**（⛔ 不省略 scope——省略时会静默选中一个陈旧的无关 scope），再跑 `archguard_detect_cycles(outputScope:"package", scope:<key>)` 与 `archguard_get_package_metrics(packageName:"cli", scope:<key>)`。读完 `git worktree remove` 掉它。
3. **after（分支 tip）**：在本任务 worktree（已含实现）上做同样三步。期望 `cli.fanIn = 0`，SCC 成员恰为 `["", "gate", "gate/config", "gate/factories"]`——`cli` 离开，`fan-in` 随之离开（`cli/driver.ts:37` 是 `packages/quay/src` 内 `fan-in/` 的唯一 importer，它只经 `cli` 入环），**其余四员不多不少**，证明本 goal 没碰别的边、也没造出新边。（2026-10-09 goal 作者更正：原写 5 员，见下方 Resolved 段。）
4. **负对照**：把本 worktree 的 `packages/quay/src` 复制到一个 scratch 目录（`/home/yale/work/quay-worktrees/goal033-negctl/`），只在副本的 `serve-sessions.ts` 顶部注入一行 `import { handleDriver } from "./cli/driver.ts";`（选一个搬迁后仍存在的导出），对副本跑同样三步 ⇒ 期望 `cli.fanIn ≥ 1` 且 SCC 重新包含 `cli`。读完删掉 scratch 目录。
5. **落盘证据** `.quay/goal-033-evidence/archguard-before-after.json`（**要 `git add -f` 提交**，否则 goal 判据 worktree 读不到——GOAL-032 的同名证据就是这样进去的）：
   `{ archguardVersion, before: {treeSha, scopeKey, packageSccMembers, packageSccSize, cliPackageFanIn, packageSccContainsCli}, after: {...同上}, negativeControl: {injected, cliPackageFanIn, packageSccContainsCli, packageSccMembers}, consumerConvergence: [{file, importLine}...] }`。`consumerConvergence` 用 grep 的真实行文本（`serve-sessions.ts`、`serve.ts`、`cli/server.ts`、`cli/driver.ts`、`cli/help.ts` 五个文件各一条），不是推断。
6. **三层分开记录**（⛔ 不合成一张表）：facts（上面的 ArchGuard 原始读数）/ declared rules（`import-graph-check.ts` 与 `enum-surface-parity-check.ts` 的 pass/fail——这两个是确定性检查，不是语义判断）/ judgment（对「这是 ownership 真迁移、不是搬壳」的结论，必须引用第一块里「注入 root→fan-in 边会被判据抓到」的负对照）。可选跑一次 `archguard:arch-layer-review` skill 做 before/after 语义复核，⛔ 不作硬性要求，若跑了把它的四态结论原样记下。
7. **自查**：在本任务 worktree 内跑 AC-351 判据（它会在被求值树上**现场**跑 `quay driver status --kind worker|promotion --json`，不读证据里的自报），exit 0 才算完。

## Acceptance Criteria

- [x] `.quay/goal-033-evidence/archguard-before-after.json` 已提交到本任务分支，且 before / after / negativeControl 三段都由同一 `archguardVersion` 取得、每段带显式 `scopeKey`
- [x] before 段复现调查读数：SCC 成员 6 个含 `cli`、`cliPackageFanIn = 2`
- [x] after 段：`cliPackageFanIn = 0`，SCC 成员恰为 `["", "gate", "gate/config", "gate/factories"]`（6→4：cli 与仅经 cli 入环的 fan-in 一同离开）
- [x] negativeControl 段：注入一条 core→cli 边后 `cliPackageFanIn ≥ 1` 且 SCC 重新包含 `cli`
- [x] AC-351 判据在本任务 worktree 内 exit 0，输出原文进 `## Evidence`
- [x] Evidence 里 facts / declared rules / judgment 三段分开记录
- [x] 临时 worktree `goal033-fork` 与 scratch 目录 `goal033-negctl` 已清理（`git worktree list` 读数进 Evidence）

## Definition of Done

AC-351 的证据文件在分支上可读，三段读数出自同一 ArchGuard 构建且显式 scope；`cli`（连同仅经 cli 入环的 `fan-in`）离开 package SCC、其余四员不变、负对照把它拉回——读数能取假；AC-351 判据（含现场重算的 CLI 语义探针）在分支树上 exit 0；临时产物已清理。

## Touches

- .quay/goal-033-evidence/archguard-before-after.json
- tasks/gap-goal033-selfhost-and-archguard-evidence.md

## Evidence

证据文件：`.quay/goal-033-evidence/archguard-before-after.json`（本任务分支提交 `3e7365ebd`）。

### facts（ArchGuard 原始读数——同一构建 `@yalehwang/archguard@0.1.38` 的同一个运行中 MCP server 产出三段）

    archguardVersion = "@yalehwang/archguard@0.1.38"
      （plugin archguard@archguard 0.1.38 → mcp-launcher.mjs → npm-cache/@yalehwang/archguard 0.1.38）

    before  fork point 1ac06fd85（detached worktree goal033-fork）, src tree 5213eb6141
      scopeKey = 50485561   (entities 981)
      detect_cycles(package) → [{ size: 6, modules: ["","cli","fan-in","gate","gate/config","gate/factories"] }]
      get_package_metrics(cli) → fanIn 2, fanOut 102

    after   goal/GOAL-033 tip d1ea4331d（本任务 worktree）, src tree d97c37aad1
      scopeKey = c85d8d95   (entities 982)
      detect_cycles(package) → [{ size: 4, modules: ["","gate","gate/config","gate/factories"] }]
      get_package_metrics(cli) → fanIn 0, fanOut 111
      ⚠️ 与 expect 不符：`fan-in` 也离开了 SCC（期望 5 员，实测 4 员）。

    negativeControl  scratch 副本 goal033-negctl，scopeKey = 0eef3e04（entities 983）
      注入：serve-sessions.ts 顶部 `import { handleDriver } from "./cli/driver.ts";` + 一次真实使用
      detect_cycles(package) → [{ size: 6, modules: ["","cli","fan-in","gate","gate/config","gate/factories"] }]
      get_package_metrics(cli) → fanIn 1
      ⇒ SCC 读数**可证伪**：重新注入一条 core→cli 边即把 cli（fanIn 0→1）拉回 6 员 SCC。

    ⚠️ 负对照的一个实测修正：Plan 第 4 步写的**裸 import（无使用）**只让 `detect_cycles` 看到边，
      `get_package_metrics(cli).fanIn` 仍读 0（该工具只数已解析的**值依赖**）。要让 fanIn ≥ 1，
      注入的符号必须被真实引用（本任务加了 `await handleDriver(undefined as never)` 的一次调用）。
      证据文件 `negativeControl.methodNote` 记录了这个差异。

    package 边增量的机制解释（`packageEdgeDelta`）：before→after 唯一消失的 package 边是
      core-root("") → cli；**没有新增任何边**（goal 的范围护栏在边层面成立）。
      fan-in 的**唯一入边**是 `cli → fan-in`（`packages/quay/src/fan-in/ff-merge.ts` 的唯一消费者是
      `cli/driver.ts`），而 `fan-in → ""` 存在（ff-merge import `../plugin-root.ts`/`../config.ts`/
      `../runtime-artifacts.ts`）。before 时 fan-in 靠环 `"" → cli → fan-in → ""` 留在 SCC；
      删掉 `"" → cli` 后 fan-in 只还能从 cli 到达、而 cli 自身已无入边 ⇒ **cli 与 fan-in 一起离开**
      ⇒ SCC 6 → **4**（不是 5）。

### declared rules（确定性检查，非语义判断——在本任务 worktree 内跑）

    $ node --experimental-strip-types plugin/scripts/enum-surface-parity-check.ts --root . --json
      ok=true status="pass" notEvaluated=[] violations=[]   （"all 25 registered surfaces consistent (6 known drift, 0 not evaluated)"）
    $ node --experimental-strip-types plugin/scripts/import-graph-check.ts --json
      verdict = {"ok":true,"over":[],"baselineRaised":[],"headBaseline":{"valueSccs":0,"typeSccs":0,"reverseEdges":0}}

### judgment（ownership 是真迁移、不是搬壳）

搬动的是「两层共用、却住在 `cli/` 的 driver 控制客户端与词表」，不是把 CLI 反向塞进 core；五个消费者
（`serve-sessions.ts`/`serve.ts`/`cli/server.ts`/`cli/driver.ts`/`cli/help.ts`）都**真实改口**到 core-root——
证据文件 `consumerConvergence` 逐条给出真实 import 行文本（非推断）。CLI 呈现职责（`probeInstruments` 的
仪器附加）按设计留在 `cli/driver.ts`，因此 core-root 未新增指向 `fan-in/` 的边——这正是 AC-350 的范围护栏，
也是「拆掉 root⇄cli 不会换来 root⇄fan-in」的依据。**未跑**可选的 `archguard:arch-layer-review` skill
（Plan 第 6 步标记为不作硬性要求），故此处无四态结论可记。

### AC-351 旧判据原文（更正前——after 期望 6→5；本任务 worktree 内跑）——exit 1

    $ bash <AC-351 criterion>
    CAUSE=scc-not-exactly-minus-cli — after members=["","gate","gate/config","gate/factories"] expected ["","fan-in","gate","gate/config","gate/factories"] (cli removed, nothing else changed)
    CAUSE=evidence-check-red — the check above printed the specific CAUSE
    EXIT=1

CLI 语义现场重算那一半（判据在证据检查之后才跑到，故此处单独跑以留读数）：

    worker:    with      （`quay driver status --kind worker --json` 含 `instruments` 键）
    promotion: without   （`quay driver status --kind promotion --json` 不含）

### AC-351 更正后判据原文（goal 作者已把 after 期望改为 6→4；本任务 worktree 内跑）——exit 0

    $ bash <AC-351 criterion（rest 去掉 fan-in；expect 6→4）>
    PASS: ArchGuard before/after shows cli leaving the package SCC (6 -> 4: cli plus fan-in, the other four unchanged) with a falsifying negative control, and the CLI status surface keeps its exact instrument semantics on this tree
    EXIT=0

判据两半都实跑到：证据检查段（before/after/negativeControl/archguardVersion）之后，现场重算的 CLI 语义探针
同段执行并给出 `worker=with` / `promotion=without`。跑判据时的被求值树 = 本 worktree tip `925f9e1b6`
（当时已并入 develop `0bf53745b`）。上方旧判据 exit 1 的读数保留更正前的历史记录；更正依据见 `## Resolved` 段。

### 清理读数

    $ git worktree list | grep -E 'goal033-(fork|negctl|after-check)'   → （空）
    goal033-fork / goal033-after-check 已 `git worktree remove --force`；goal033-negctl 已 rm -rf。

## Resolved — AC-351 的 after 期望已由 goal 作者更正为 6→4（2026-10-09，采纳下方选项 1）

**裁定**：采纳选项 1。本任务的分析经 goal 作者独立复核成立——`git grep` 按位置判定 develop 上 `packages/quay/src` 内 `fan-in/` 的 importer **只有** `cli/driver.ts:37`（同一谓词对 `gate/` 命中 10 个文件作正对照）⇒ 删除 `"" → cli` 后 `fan-in` 随 `cli` 一起离开 SCC，6→4 是唯一自洽的期望；错的是 goal 作者当初只核了 `cli` 的入边、没核 `fan-in` 的入环路径。已更正：AC-351 的 criterion（`rest` 去掉 `fan-in`）、expect、title（author 提交 `e2abedc55`），GOAL-033 的 title/body（`adcefec15`）。选项 2（把仪器附加搬进 core-root）**不采纳**——它恰是 GOAL-033 明令避开的 root⇄fan-in 搬壳。更正后的 AC-351 判据已在本任务 worktree 内 dry-run ⇒ exit 0（含现场重算的 CLI 语义探针），旧判据同处 ⇒ `CAUSE=scc-not-exactly-minus-cli`，与本任务的报告一致。**证据文件无需重取**；续做只需在本 worktree 重跑 AC-351 判据、如实勾选剩余两条 AC。⛔ 文件名 `goals/AC-351-…-6-5-…` 是旧 slug，store 不随 title 改名，属外观问题，不影响判定。

以下为本任务原始分析（保留原文）：

**是任务前提错，不是实现错。** GOAL-033 / AC-351 期望 after SCC 恰为 5 员
`["","fan-in","gate","gate/config","gate/factories"]`，但**在 goal 自己的约束下这是结构上不可能达到的**：

- 若 cli 离开 SCC（本 goal 的目标）⇒ 环里必须有 `"" → ... → fan-in` 的通路，而**唯一**能到 fan-in 的边是
  `cli → fan-in`，cli 又只被 `"" → cli` 喂入。删掉 `"" → cli` 后 fan-in 与 cli **同时**失去入边 ⇒ 一起离开。
- 要让 fan-in 留在 SCC，就必须存在 core-root → fan-in 边（或别的成环入边）——而 goal 明确**禁止**
  core-root import `fan-in/`（AC-350 断言其归零；`cli/driver.ts` 是 `fan-in/` 的唯一消费者，仪器附加刻意留在 CLI）。
  ⇒ 「cli 离开」与「fan-in 留下」两条要求互斥。

实测（两次独立 worktree、同一构建、同一 scope 纪律）= **6 → 4**；负对照（重新注入一条 core→cli 边）把 cli
拉回 6 员，证明读数非恒真（硬规则 4）。goal 的**范围护栏在边层面成立**（before→after 唯一消失的 package 边是
`"" → cli`，无新增边）——错的只是「成员集不变」这条预测，它把「边不变」误推成了「成员不变」。

**请求裁定（二选一，均由 goal owner 做，⛔ 本任务不改 AC-351 迁就结果）**：

1. **接受 6→4**（推荐）：环缩得比预测更小，目标「cli 离开 package SCC」达成。需把 AC-351 判据里的 `rest`
   改为 `["","gate","gate/config","gate/factories"]`、`expect`/title 的 `6→5` 改为 `6→4`；`GOAL-033` 标题与
   `goals/AC-351-*` 文件名同源需一并改。改完本证据文件（`after.packageSccMembers` 已是 4 员）**无需重取**，
   AC-351 即可 exit 0。
2. **改设计**：若坚持 after 必须是含 fan-in 的 5 员，则须把仪器附加从 `cli/driver.ts` 移入 core-root ⇒ 造出
   core-root → `fan-in/` 边 ⇒ 换来 root⇄fan-in 新互指，并违反 AC-350 的「不新增 core-root→fan-in 边」。
   本任务判断这不是 goal 的本意（goal 明写避开此陷阱）。

**未落地原因**：AC-3（after 成员集）与 AC-5（AC-351 exit 0）**不能如实勾选**，故保留 `- [ ]`；status 字段归
driver 所有，本任务不改。其余 5 条 AC 均已满足（见上）。

## Needs-Human

**执行 2026-10-09T06:58:16.498Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：AC 未全勾（checked 5/7，剩余未勾 2）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：1c8c4a2d-bd69-4696-9d9a-80cd47b2dcd2
