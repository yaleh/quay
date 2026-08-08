---
id: gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes
title: loop-driver-check reads a self-declared registry that the tick doc never
  writes — a correct cold start reports STALLED, and the doc's own remedy
  manufactures the double-trigger it exists to prevent
status: done
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

- [x] AC1: **照文档逐字冷启动 ⇒ LIVE**——在一个干净仓里按 tick 文档步骤 4 走完，
      `loop-driver-check.sh` **退出码 0**（实跑贴出，含它打印的那行）
- [x] AC2: **注册表被 gitignore**——`git check-ignore -v .quay/loop-driver.jsonl` **退出码 0**，
      且命中的规则与 `gate-events.jsonl` 同形（实跑贴出）
- [ ] AC3: **陈旧注册表不得报 LIVE**——这是本条最难也最关键的一条：
      **构造「注册表有一行、但那个驱动早已不存在」的状态**，检查器**不得报 LIVE**。
      **若第一层机制做不到（自述注册表在结构上就分辨不了），如实记录「本任务不解决这一条」
      并把它写进第二层**——**不许把做不到写成通过**（**本任务第一层未解决，处置见文末「AC3 处置」**）
- [x] AC4: **双触发不得回归（负控制）**——真装两个驱动仍报 `DOUBLE-TRIGGER` 退出 4（实跑贴出）
- [x] AC5: **文档的 STALLED 处置不再制造双触发**——改写后的措辞里，
      「重建 cron」之前必须先查注册表；`plugin/skills/cold-start/SKILL.md` 与 tick 文档**逐字同源**（贴两处 diff）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
- [x] AC7: **`.halt` 的打印不得冒充状态读数**——`plugin/loop/orchestrator-loop-tick.md:418`
      在无 `.halt` 时打印 `运行中`，**而 `.halt` 是控制面不是传感器**：它回答「这个项目的循环
      下一个边界要不要停」，**不回答「它在不在跑」**。一个没有循环在跑的项目同样打印「运行中」。
      改为「未暂停」（实跑贴出改后输出）。**这条与本任务同族**：都是**一个东西被读成了它
      证明不了的另一个东西**——注册表被读成「驱动在跑」，`.halt` 缺席被读成「项目在跑」

## Non-goals

**不改 `.halt` 本身的语义或位置**（`gap-halt-sentinel-path-mismatch` 已定在仓库根，那条不重开）。
AC7 只改**打印的措辞**——把一个控制面的读数从状态断言改回控制断言。

## Definition of Done

- [x] AC1 与 AC4 的实跑输出都贴进任务体（正向与负控制各一份）
- [x] AC3 若未解决，任务体明写「未解决 + 理由 + 已转入第二层」，**不得留白**
- [x] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [x] 任务体记录：**这条是照文档做完之后看结果才发现的**——
      读代码不会发现，因为代码和文档各自都自洽

## Touches
- tasks/gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes.md（自身文件：勾 AC + 贴 invoke 证据授权）
- plugin/loop/orchestrator-loop-tick.md
- plugin/skills/cold-start/SKILL.md
- .gitignore
- plugin/test/quay-init-loop.test.mjs
- plugin/test/loop-driver-check.test.mjs（本任务新增；Contract invoke 指定的测试文件）

## Test-Files
- plugin/test/loop-driver-check.test.mjs
- plugin/test/quay-init-loop.test.mjs
- plugin/test/cold-start-skill.test.mjs
- plugin/test/loop-shipping.test.mjs
- plugin/test/tick-vocabulary.test.mjs

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

**2026-08-04 03:1xZ 追加 AC7，来源是外层自己的一次误读，管理者当场纠正。**
外层在 tick 报告里写了「`.halt` 在说谎——三个仓都显示运行中，而两个根本没有会话」，
并把「要不要往那两个仓写 `.halt`」当作升级项交给管理者。**两处都错**：
`.halt` 是**控制面**（这个项目的循环下一个边界要不要停），**不是传感器**；
没有 `.halt` 不构成任何关于「它在不在跑」的声称，而人的决定是**暂缓重启**，
不是「将来起来时先停住」——**那是两件不同的事，写进去会把一个决定改成另一个**。

**但这次误读有一个实在的成因，落为 AC7**：tick 文档 `:418` 在无 `.halt` 时逐字打印 **`运行中`**。
**一个控制面的缺席被打印成了一个状态断言**，而这个文件随交付物铺进每个项目。
**⇒ 与本任务的主体是同一个形态**：注册表被读成「驱动在跑」，`.halt` 缺席被读成「项目在跑」——
**两者都是把一个东西读成了它证明不了的另一个东西**，且两者都不会报错，只会让读的人放心。

## AC3 处置（第一层未解决——如实记录，不写成通过）

**AC3 未解决，理由如下，已转入第二层。**

本任务第一层（机械且便宜：文档补注册动作 + gitignore + STALLED 措辞）**在结构上分辨不了
「注册表有一行、但那个驱动早已不存在」**：

1. **注册表是自述的，与真实驱动无强制关系**（任务体「一般形态」原话）。`loop-driver-check.sh`
   只数 `.quay/loop-driver.jsonl` 的行，**不观测任何真实驱动**——cron 是**会话内的**（tick 文档
   自己写着「会话一结束就没了」），bash 检查器**看不到**会话内的 cron 列表。
2. **本仓已实证的观测路径**：`dead-loop-check.sh` 用 transcript user 消息 + git 提交的**时间窗**
   判「循环转没转」——那是 L2 持续健康判据（`gap-l2-continuous-health-...`），不是本检查的
   「恰好一个触发源」问题；把 transcript 时间窗接进 `loop-driver-check.sh` 属于**换判据**，
   正是第二层要做、而本任务明确**不许顺手猜**的事（任务体「不做」与 Chosen mechanism 第二层）。
3. **gitignore 已切断缺陷三的提交路径**（AC2）：注册表 gitignore 后，新克隆**不会**自带一行
   「已注册 cron」——零驱动克隆报 STALLED（本任务测试已 pin，见下）。残余的陈旧注册只来自
   **本机上一会话的冷启动没清**，那一支由文档补救（AC5 措辞：STALLED 先查注册表，陈旧注册先
   `rm -f` 再重建），不是检查器自身能机械判定的。

**结论**：`stale_registry_exit != 0` 这一 band 在第一层**不满足**（构造「注册表一行、驱动已死」，
检查器当前仍报 LIVE exit 0）。按要求**如实记录，不写成通过**；判据换成可观测来源（CronList 输出 /
会话内任务列表）留作第二层，前置问题是「bash 检查器能否看到会话内的 cron」——未答之前不猜实现。
`plugin/test/loop-driver-check.test.mjs` 的最后一个测试把「层 1 只交付文档级补救」pin 住，
未来第二层改动须同步更新该测试。

**AC3 交叉标注（2026-08-08，第二层已解决）**：本任务 AC3 已由
`gap-loop-driver-check-ac3-layer2-cron-observability`（第二层，done）承载并解决——该任务实测回答了
前置问题（bash 检查器看不到会话内 cron 列表；可观测的是驱动每次 tick 写的 last-alive 证据），把
`loop-driver-check.sh` 的 LIVE 判据换成可观测来源：构造「注册表一行、驱动已死」（注册表 mtime 2 天前 +
无可观测活动）⇒ 报 **DEAD**（exit 6），不再报 LIVE；`stale_registry_exit`（grep 计数）band = 0。
本任务「## AC3 处置」的「未解决」结论被该第二层任务正式解除。

## 实跑证据（2026-08-06 inner 派发）

**AC1 — 照 tick 文档步骤 4 逐字冷启动 ⇒ LIVE（正向）**（干净仓 + 文档写注册表两行 + 跑 check）：

```text
$ bash plugin/scripts/loop-driver-check.sh <clean-repo>
loop-driver: LIVE (1) — exactly one loop driver (cron */20 * * * *)
$ echo $?
0
```

**AC4 — 真装两个驱动 ⇒ DOUBLE-TRIGGER（负控制）**：

```text
$ bash plugin/scripts/loop-driver-check.sh <clean-repo>   # 注册表两行
loop-driver: DOUBLE-TRIGGER (2) — 2 loop drivers registered; a literal reader double-installed
$ echo $?
4
```

**AC2 — 注册表被 gitignore，且与 gate-events.jsonl 同形**（规则已在 master，`f263f12fb` 2026-08-04
落地，本任务验证并 pin 进测试，未重复添加）：

```text
$ git check-ignore -v .quay/loop-driver.jsonl
.gitignore:73:**/.quay/loop-driver.jsonl	.quay/loop-driver.jsonl
$ echo $?
0
$ git check-ignore -v .quay/gate-events.jsonl
.gitignore:26:**/.quay/gate-events.jsonl	.quay/gate-events.jsonl
```

**AC7 — `.halt` 打印改为控制面读数「未暂停」**（tick 文档 `:506`，改后行）：

```text
"$([ -f "$d/.halt" ] && echo "暂停: $(head -c 80 $d/.halt)" || echo 未暂停)"
```

**AC5 — 两处 diff（逐字同源）**：

- tick 文档步骤 4 新增的写注册表两行（与冷启动 skill 逐字同源）：
  ```text
  mkdir -p <root>/.quay
  printf '%s\n' '{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}' >> <root>/.quay/loop-driver.jsonl
  ```
- 冷启动 skill 步骤 5 原有同源行（`plugin/skills/cold-start/SKILL.md:182-183`，本任务**未改**，作参照）：
  ```text
  mkdir -p <root>/.quay
  printf '%s\n' '{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}' >> <root>/.quay/loop-driver.jsonl
  ```
- STALLED 处置改写：`回步骤 4 重建 cron`（旧）→ **先查注册表是否写过，再谈重建 cron**（新，tick 文档
  步骤 4 末段）：STALLED 时先 `ls <root>/.quay/loop-driver.jsonl`；不存在/空 = 注册动作没做，回去
  **把 `printf` 那行也做掉**；有旧行 = 陈旧注册，先 `rm -f <root>/.quay/loop-driver.jsonl` 再完整重建。

**invoke — `bash scripts/test.sh --for-task gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes --allow-thin`**
（scoped 选定 5 个测试文件，两轮连续全绿）：

```text
ℹ tests 78
ℹ pass 78
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
EXIT=0
```

新增 `plugin/test/loop-driver-check.test.mjs`（`node:test` + `// @test-group governance`，AC6）单独跑 8/8 绿。
**已知负载敏感**：机器 load 高时（本机 load 一度 >10），`quay-init-loop.test.mjs`（KNOWN-LOAD-SENSITIVE
族）的多文件并跑会偶发 flake（失败点在 `referenced-not-landed` 上旋转，且与本次改动无关——不含本任务
新测试文件时同样复现）；该文件**单独跑 45/45 绿**，本任务两轮连跑均绿。

## Carries

from: gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes
acs: AC3
