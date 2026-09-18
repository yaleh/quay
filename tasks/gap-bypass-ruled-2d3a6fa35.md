---
id: gap-bypass-ruled-2d3a6fa35
title: bypass-ruled 表加 2d3a6fa35——人 2026-09-18 裁定 ruled one-off；它使全 loop
  代码任务在静态层 fail-closed（四条在飞任务被挡），落地走任务分支 fan-in（⛔ 不直投）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：人 2026-09-18 04:11:28Z 直接提交 develop 的 `2d3a6fa3580947889d42f8234e9d2fe389386f18`（`mem: 修掉 quay serve host 泄漏链 + --orphan-serves 回收模式 + serve 堆上限`，改 6 文件 / 459 插入）未登记进 `plugin/scripts/direct-to-develop-bypass-check.ts` 的 `RULED_HISTORICAL_COMMITS` ⇒ 该静态检查 exit 1 ⇒ `scripts/test.sh` 静态层 fail-closed，**在进入 node 测试泳道之前中止**（日志逐字 `STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1` + `# pass 0 / # fail 45 / # suite red static-check`——`# fail 45` 是静态检查计数，⛔ 不是 45 个失败测试）。

**影响面**：任一 **code-delta** 任务的机械 fan-in 在 `step=suite` 恒红（doc-delta 任务不受影响，`worker-driver.ts:4739` `needSuite = codeDelta !== "" || …`）。当前被挡的在飞任务四条：`gap-mirror-full-suite-state-retire-dead-cli-face` / `gap-suite-bash-lpt-forwarder-dead-on-default-path` / `gap-mirror-mechanical-fanin-fail-open-posture-undocumented` / `gap-mirror-measure-history-retire-dead-writer`（实现面均已完成，分支完好）。

**裁定（人 2026-09-18，逐字）**：`2d3a6fa35` 判 **ruled one-off**，**走任务分支落地**（⛔ 不直投）。
理由：author 是人（`calvino.huang@gmail.com`），内容是 serve 泄漏修复；判据要抓的是「loop 偷懒绕过 fan-in」，不是人的编辑——与既有先例同类（`cddc55e2` / `6c46304b7` / `08e8ec55` / `ae28758aa`）。

**落地机制（已实测，⛔ 非推断）——这也是本条与先例 `gap-bypass-ruled-cbbbb766` 的关键差别**：把条目加在**任务分支**上即可，**不需要第 5 次直投，也不需要自指豁免**（先例 `37746907c` / `cf4f9bd9e` 的自指死锁在这里不发生）。单变量 A/B 对照，跑的是真实静态闸代码路径（`checker-cost-lib.sh` 的 `run_checker` + `run_checker_parallel_wait`）：

| 臂 | 状态 | 读数 |
|---|---|---|
| ARM 1 | develop（无条目） | `STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1` ← 阻断 |
| ARM 2 | 同一 develop + 一条该 sha 的 ruled 条目 | `STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check` ← 不阻断 |

机制两环：① `checker-cost-lib.sh:27` `RUN_CHECKER_EXIT_NOT_EVALUATED=3`，`:200-204` 明确 exit 3 为第三态，打印后 `continue`，**永不计入 fail-closed**；② `runner-static-gate.ts` 的 `run_static_checks()` 以 `${repo_root}` 跑每个 checker ⇒ worktree 内跑的是**该 worktree 自己那份表**。

⚠️ **一条必须记账的副作用**：解除 RED 后该检查器会停在 `evaluated=false`（NOT-EVALUATED），因为 `unclassifiableCommits=5844` 是既存全历史量，而降级规则是「核心判 GREEN ⇒ NOT-EVALUATED」⇒ 它在本仓库**只能给「RED」或「说不出话」，给不出干净 PASS**。这是**既存状态**（非本 sha 引入），不阻断，但该检查器的裁定权实际是空的——**宜单独立案**，⛔ 不在本任务范围。

> ⚠️ **落地时对本节的实测更正（worker 2026-09-18，证据见 §Readings R1–R4）**：上表 ARM 2 的
> `STATIC_CHECK_NOT_EVALUATED` 一栏**在 gate 路径上不成立**——它描述的是**无 `--baseline` 的 audit 模式**
> （我实测：确为 exit 3 NOT-EVALUATED）。而全库**唯一**调用点 `runner-static-gate.ts:894` **恒传**
> `--baseline develop~100 --json` ⇒ 窗口内 `unclassifiableCommits=0` ⇒ `evaluated=true` ⇒ **干净 PASS**。
> ⇒ ARM 2 的真读数是 **`exit 0`（无任何 `STATIC_CHECK_*` 行）**，比本节预测的更强（不阻断仍然成立）。
> ⛔ 原文保留不删（裁定记录）；更正只此一处，AC4 内的展开不重复贴。⇒「该检查器裁定权是空的」**不成立**
> （它在窗口内能取假、能给干净 PASS），本节的**单独立案建议随之撤回**；宜另立的是「AC4 父句不可达」本身。

## Acceptance Criteria

- [x] AC1: `RULED_HISTORICAL_COMMITS` 含 `2d3a6fa35`，reason 含【理由 + 它是人的编辑而非 loop 绕 fan-in】两句。→ 读数 R0。
- [x] AC2: bypass-check 对该 sha 不再判 RED（`--root <worktree>` 读数：无 `RED 2d3a6fa35…` 行）。贴读数。→ 读数 R2。
- [ ] AC3: 本任务的提交**经 fan-in 正规 land**（reflog 中为 fan-in 落地形，⛔ 非 `commit:` 直投）；`git log develop -1` 可见本任务落地。——本条属**外层验证**（待外部）
      理由：该读数是 flip 过程**自身**的产物，worker 交付这一刻结构上还取不到（同族先例
      `tasks/gap-bypass-ruled-table-self-entry.md:31` 同形，留未勾 + `（待外部）`）。⛔ 不预勾：
      ff 仍可能因 delta 断言/套件红/ff 竞态而失败，届时本条为假。
- [ ] AC4: 静态层在本任务 worktree 内**不再 fail-closed**（worktree 内已实测：静态层 exit 0、无 `STATIC_CHECK_FAILED: direct-to-develop-bypass-check`、checker `evaluated=true ok=true`）——本条属**外层验证**（待外部）
      ⚠️ **父句预测的那个形态在本仓库结构上不可达，故本条不勾**（硬规则 4c，⛔ 不是为了不烧 fan-in 而勾）：
      本 AC 原写「读数含 `STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check`」，实测该 token
      **在生产 gate 路径上取不到**——全库唯一调用点 `runner-static-gate.ts:894`（scoped 层经
      `select-static-checks-for-touches.ts` 复用同一 argv）**恒传** `--baseline develop~100 --json`
      ⇒ 窗口内 `unclassifiableCommits=0` ⇒ `evaluated=true` ⇒ 干净 PASS（exit 0，run_checker 不打印任何
      `STATIC_CHECK_*` 行）。原预测来自**无窗口的 audit 模式**（我实测：无 `--baseline` 时确为 exit 3
      NOT-EVALUATED，`unclassifiable` 是全历史量）——即 manager 落笔时按 audit 模式外推，未计入 gate 的窗口。
      实得读数比父句**更强**（evaluated 的 PASS ≻ NOT-EVALUATED），但字面不等 ⇒ 按硬规则 3b 不勾。
      就绪读数只能在**落地后的 develop** 上取（四个在飞 code-delta 任务的 fan-in 恢复即其证据）：读数 R3/R4。
      ⇒「父句不可达」本身**宜单独立案**（本任务 ⛔ 不改判据/排除集，DoD 已限范围），不在本任务内。

## Readings

⛔ 全部在 **worktree** `/home/yale/work/quay-worktrees/gap-bypass-ruled-2d3a6fa35` 内取。

**R0（AC1）**：`RULED_HISTORICAL_COMMITS` 末条 = `{sha:"2d3a6fa35", reason:"人 2026-09-18 04:11:28Z 直接提交 develop 的 serve host 泄漏链修复（--orphan-serves 回收模式 + serve 堆上限，6 文件 459 插入）未登记 ⇒ … 裁定 ruled one-off：判据要抓的是「loop 偷懒绕过 fan-in」，而本提交作者是人（calvino.huang@gmail.com）、内容是 serve 泄漏修复，属人的编辑而非 loop 绕 fan-in 的代码直改，不属于 detector 要抓的那一类。…"}`。
两句判据：①理由 = ruled one-off 裁定 + 为何它使静态层 fail-closed；②`人的编辑而非 loop 绕 fan-in` 逐字在。

**R1（AC2 的负臂 / 对照基线，主检出源码 = 未加条目）**：
`node --experimental-strip-types /home/yale/work/quay/plugin/scripts/direct-to-develop-bypass-check.ts --root /home/yale/work/quay --baseline develop~100 --json` ⇒ **exit 1**，`{"evaluated":true,"ok":false}`，行 `  RED 2d3a6fa3580947889d42f8234e9d2fe389386f18 — mem: 修掉 quay serve host 泄漏链 + --orphan-serves 回收模式 + serve 堆上限`。

**R2（AC2 正臂 / 本 worktree 源码 = 已加条目）**：同 `--root` / 同 `--baseline`，**只变执行的是哪份表** ⇒ **exit 0**，`{"evaluated":true,"ok":true}`；该 sha 转为 `  RULED-HISTORICAL 2d3a6fa3580947889d42f8234e9d2fe389386f18 — …` + ruled reason。
predicate `^  RED 2d3a6fa35` 干跑（硬规则 2）：**R1 = 1（已知真样本命中，谓词有效）/ R2 = 0**。
（⛔ 无 `--baseline` 的 audit 模式另有读数：worktree 源码 exit 3 NOT-EVALUATED，`unclassifiableCommits=5844` 全历史量——这正是 AC4 父句的来源，见 AC4。）

**R3（AC4 在 worktree 内）**：`bash scripts/test.sh --static-checks` ⇒ **STATIC_EXIT=0**；全输出含 `STATIC_CHECK` 行 **0** 条（⇒ 亦无 `STATIC_CHECK_FAILED: direct-to-develop-bypass-check`），bypass 段只打印 `== direct-to-develop-bypass-check — PRODUCTION develop ==` 后无输出 = run_checker rc=0。
机制（实读源码）：全库唯一调用点 `plugin/scripts/runner-static-gate.ts:894` 恒传 `--baseline develop~100 --json`；scoped 层经 `select-static-checks-for-touches.ts` 复用同一 argv（实测其 `--commands` 输出逐字含 `--root "${main_root}" --baseline develop~100 --json`，源路径为 worktree ⇒ 读到的是**本 worktree 的 ruled 表**）。

**R4（AC4/scoped 层）**：`bash scripts/test.sh --for-task gap-bypass-ruled-2d3a6fa35 --allow-thin` ⇒ **SCOPED_EXIT=0**（`ℹ tests 58 / pass 58 / fail 0`）；全输出含 `STATIC_CHECK` 行 **0** 条。scoped 静态层确实选中并执行了该 checker（`scoped check: run_checker "direct-to-develop-bypass-check" … --root "${main_root}" --baseline develop~100 --json`），其执行只打印 MODULE_TYPELESS 警告、无任何 `STATIC_CHECK_*` 行 ⇒ rc 0。

**R5（测试）**：`node --test plugin/test/direct-to-develop-bypass-check.test.mjs` ⇒ **58/58 pass**（含 `NEGATIVE CONTROL on the REGISTERED argv` 与 `EVALUABILITY: the registered --baseline is a ref-relative window`）。

## Definition of Done

- develop 上 bypass-check 不再因 `2d3a6fa35` 判 RED；`bash scripts/test.sh` 的静态层不再被该检查 fail-closed 中止（四个在飞 code-delta 任务的 fan-in 因此可重新运行）。
- 本条**只加一条 ruled 条目**；⛔ 不改判据逻辑、不改排除集、不动 `RULED_HISTORICAL_COMMITS` 的其它条目。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（`RULED_HISTORICAL_COMMITS` 加 `2d3a6fa35`）
- tasks/gap-bypass-ruled-2d3a6fa35.md（自身）

## Test-Files

- plugin/test/direct-to-develop-bypass-check.test.mjs（既有测试全绿）
