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

## Acceptance Criteria

- [ ] AC1: `RULED_HISTORICAL_COMMITS` 含 `2d3a6fa35`，reason 含【理由 + 它是人的编辑而非 loop 绕 fan-in】两句。
- [ ] AC2: bypass-check 对该 sha 不再判 RED（`--root <worktree>` 读数：无 `RED 2d3a6fa35…` 行）。贴读数。
- [ ] AC3: 本任务的提交**经 fan-in 正规 land**（reflog 中为 fan-in 落地形，⛔ 非 `commit:` 直投）；`git log develop -1` 可见本任务落地。
- [ ] AC4: 静态层在本任务 worktree 内**不再 fail-closed**（读数含 `STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check`，⛔ 不含 `STATIC_CHECK_FAILED: direct-to-develop-bypass-check`）。贴读数。

## Definition of Done

- develop 上 bypass-check 不再因 `2d3a6fa35` 判 RED；`bash scripts/test.sh` 的静态层不再被该检查 fail-closed 中止（四个在飞 code-delta 任务的 fan-in 因此可重新运行）。
- 本条**只加一条 ruled 条目**；⛔ 不改判据逻辑、不改排除集、不动 `RULED_HISTORICAL_COMMITS` 的其它条目。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（`RULED_HISTORICAL_COMMITS` 加 `2d3a6fa35`）
- tasks/gap-bypass-ruled-2d3a6fa35.md（自身）

## Test-Files

- plugin/test/direct-to-develop-bypass-check.test.mjs（既有测试全绿）