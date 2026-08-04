---
id: gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes
title: loop-driver-check reads a self-declared registry that the tick doc never
  writes — a correct cold start reports STALLED, and the doc's own remedy
  manufactures the double-trigger it exists to prevent
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**外层 2026-08-04 OOM 后冷启动时实测发现**——不是读代码推断，是照 tick 文档逐字做完之后看结果。

`plugin/scripts/loop-driver-check.sh` 判定「恰好一个循环驱动在跑」，读的是
**自述注册表 `<root>/.quay/loop-driver.jsonl`**（`:23`），**不观测任何真实驱动**。

### 缺陷一：照 tick 文档做，必然报 STALLED

写入注册表那一行**只存在于** `plugin/skills/cold-start/SKILL.md:117`：

```bash
printf '%s\n' '{"mechanism":"cron",...}' >> <root>/.quay/loop-driver.jsonl
```

**`plugin/loop/orchestrator-loop-tick.md` 的冷启动步骤 4 里没有这一步**，
它只说「`CronCreate` → `CronList` 确认 → 跑 `loop-driver-check.sh`，必须报 LIVE」。

**外层实测**：cron 建好、`CronList` 列出、`loop-driver-check.sh` 报
`STALLED (0) — no loop driver registered; the loop will never tick`，退出码 3。

### 缺陷二：文档对 STALLED 的处置会制造出它要防的那个双触发

tick 文档逐字写着：**「报 `STALLED` = 一个都没有——循环不会 tick，回步骤 4 重建 cron」**。

⇒ 照做的人会**再建一个 cron**，再查，**还是 STALLED**（注册表仍然空），**再建一个**……

**这个检查器存在的理由是抓 `DOUBLE-TRIGGER`，而文档给它配的补救动作是一台双触发生产机。**

### 缺陷三：注册表不在 `.gitignore` 里，提交后每个克隆都自称 LIVE

`.gitignore` 覆盖了它的所有同族运行时状态——`**/.quay/gate-events.jsonl`（:26）、
`**/.quay/prepare-leases/`（:27）、`**/.quay/inner-blocked.json`（:35）、
`**/.quay/prepare-checkpoints/`（:44）——**唯独没有 `loop-driver.jsonl`**。
外层本 tick 用 `git add orchestration/ .quay/loop-driver.jsonl` 时它被正常暂存（已撤回）。

**后果**：注册表一旦被提交，**每一个新克隆都带着一行「已注册 cron」**，
而那个 cron 是**上一台机器上、上一个会话里**的——早已不存在。
`loop-driver-check.sh` 会对一个**零驱动**的仓库报 **LIVE**。

**⇒ 这条把一个假阴性（真驱动被报成 STALLED）翻成假阳性（零驱动被报成 LIVE），
而假阳性正是这个检查器唯一不能出的错**：它的全部价值就是抓「从外面看装得好好的，实际不会 tick」。

### 一般形态

**自述注册表与被观测对象之间没有任何强制关系。** 它能抓的只有「照文档做的人装了两次」，
抓不到任何真实的驱动状态——**cron 死了、会话结束了、注册表还在**，反过来也一样。
`CronCreate` 的任务是**会话内的**（tick 文档自己写着「会话一结束就没了」），
而注册表是**文件系统上的**——**两者的生命周期根本不同**，用后者证明前者在结构上就不成立。

## Contract

```
measure doc_registers = `grep -c "loop-driver.jsonl" plugin/loop/orchestrator-loop-tick.md` 输出的计数字段
measure clean_start_exit = `cd <照 tick 文档冷启动完成的仓> && bash plugin/scripts/loop-driver-check.sh >/dev/null; echo $?` 输出的退出码字段
measure registry_ignored = `git check-ignore -v .quay/loop-driver.jsonl; echo $?` 输出的退出码字段
measure stale_registry_exit = `cd <零驱动但注册表有一行的仓> && bash plugin/scripts/loop-driver-check.sh >/dev/null; echo $?` 输出的退出码字段
band doc_registers >= 1
band clean_start_exit = 0
band registry_ignored = 0
band stale_registry_exit != 0
invariant 照 tick 文档逐字冷启动必须得到 LIVE；零驱动的仓库绝不得到 LIVE
invoke `bash scripts/test.sh plugin/test/loop-driver-check.test.mjs`
control 真的装了两个驱动仍必须报 DOUBLE-TRIGGER——修好假阴性不许把双触发检测一起弄丢
resume 先补文档与 gitignore（两处都是一行），再谈注册表要不要换成可观测判据
```

## Chosen mechanism

**分两层，不要混做一件事。**

**第一层（本任务范围，机械且便宜）**：
1. `plugin/loop/orchestrator-loop-tick.md` 步骤 4 补上写注册表那一行，**与 cold-start skill 逐字同源**；
2. `.gitignore` 补 `**/.quay/loop-driver.jsonl`，**与它的四个同族运行时状态一致**；
3. 文档对 `STALLED` 的处置改写：**先查注册表是否写过，再谈重建 cron**——
   现行措辞会让照做的人不断加装驱动。

**第二层（本任务只记录，不实施）**：注册表是自述的，**与真实驱动无强制关系**。
要真正判定「恰好一个触发源在跑」，判据得来自能观测的东西（`CronList` 的输出、会话内任务列表），
**而这需要先回答一个尚未回答的问题：一个 bash 检查器能不能看到会话内的 cron。**
**不要在本任务里顺手猜一个实现**——本仓已经因为「代理信号迟早会误报」付过五次学费。

**不做**：不删掉这个检查器（**它抓的双触发是真问题**）；不把 STALLED 降级成警告
（**警告会被读成「装好了」**）。

## Acceptance Criteria

- [ ] AC1: **照文档逐字冷启动 ⇒ LIVE**——在一个干净仓里按 tick 文档步骤 4 走完，
      `loop-driver-check.sh` **退出码 0**（实跑贴出，含它打印的那行）
- [ ] AC2: **注册表被 gitignore**——`git check-ignore -v .quay/loop-driver.jsonl` **退出码 0**，
      且命中的规则与 `gate-events.jsonl` 同形（实跑贴出）
- [ ] AC3: **陈旧注册表不得报 LIVE**——这是本条最难也最关键的一条：
      **构造「注册表有一行、但那个驱动早已不存在」的状态**，检查器**不得报 LIVE**。
      **若第一层机制做不到（自述注册表在结构上就分辨不了），如实记录「本任务不解决这一条」
      并把它写进第二层**——**不许把做不到写成通过**
- [ ] AC4: **双触发不得回归（负控制）**——真装两个驱动仍报 `DOUBLE-TRIGGER` 退出 4（实跑贴出）
- [ ] AC5: **文档的 STALLED 处置不再制造双触发**——改写后的措辞里，
      「重建 cron」之前必须先查注册表；`plugin/skills/cold-start/SKILL.md` 与 tick 文档**逐字同源**（贴两处 diff）
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1 与 AC4 的实跑输出都贴进任务体（正向与负控制各一份）
- [ ] AC3 若未解决，任务体明写「未解决 + 理由 + 已转入第二层」，**不得留白**
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录：**这条是照文档做完之后看结果才发现的**——
      读代码不会发现，因为代码和文档各自都自洽

## Touches

- plugin/loop/orchestrator-loop-tick.md
- plugin/skills/cold-start/SKILL.md
- .gitignore
- plugin/test/quay-init-loop.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T03:00:00Z
changed: **外层自己在 OOM 后冷启动时踩出来的，不是读代码推断的。** 这一点写进 DoD——
**读代码不会发现它，因为代码和文档各自都自洽**：检查器正确地读它的注册表，
tick 文档正确地建 cron，**缺的是没有人把两者接起来**，而这个缺口只在真做一遍之后才可见。

**外层把它按三条分开写，因为它们的失效方向相反**：一二是**假阴性**
（真驱动被报成 STALLED，且文档的补救会不断加装驱动 ⇒ 制造出它要防的双触发）；
第三条是**假阳性**（注册表被提交后，零驱动的克隆自称 LIVE）。
**假阳性那条更重**——这个检查器的全部价值就是抓「从外面看装得好好的，实际不会 tick」，
**它一旦会对空仓报 LIVE，就与不存在等价**。

**AC3 是外层刻意留的硬判据，并预先允许它不通过**：自述注册表在结构上可能就分辨不了陈旧，
所以 AC3 写明「做不到就如实记录并转第二层，**不许把做不到写成通过**」。
**这不是宽容，是防止把一个结构性限制混进一次机械修复里当作已解决。**

**外层同时预先堵死两条错误修法**：不许删掉检查器（**它抓的双触发是真问题**）；
不许把 STALLED 降级成警告（**警告会被读成「装好了」**）。
**并明确不在本任务里换判据**——「代理信号迟早会误报，能换结构信号就换」这条本仓已实证五次，
但换成什么需要先回答「bash 检查器能否看到会话内的 cron」，**没答之前顺手猜一个实现只会再来一次**。

**外层本 tick 已临时补写了一行注册记录使检查器转 LIVE(1)**——
**那是临时处置，不是修复**，且**该行未提交**（正因为缺陷三）。
**排期**：与在飞的三条互不相交（不动 `quay-init.sh`、不动 `store.ts`），可独立派发。
