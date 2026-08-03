---
id: gap-cold-start-needs-a-human-to-dictate-eight-steps
title: "Cold start takes 8 dictated steps across two repos — every one needs knowledge that lives in someone's head, not on disk"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

规格：`orchestration/SPEC-cold-start-one-liner.md`（7 条 AC，管理者定义）。
人的目标：**安装 1–2 行命令、outer 初始化 1 行 skill/MCP、冷启动 1 行 skill/MCP、inner 零操作**。

**现状（管理者从 archguard 冷启动的 git 历史还原）：8 步、跨两个仓、全部由它逐条口述。**
**关键不在步数**：每一步需要的外部知识都在口述者脑子里——产物在哪个分支、残留是哪三个文件、
测试命令是什么、要挂哪两个监视器、cron 周期多少。
**⇒ 那次冷启动跑通了但不可复现。**

> **「我口述一遍它就能跑」与「它自己能跑」在结果上同形，在可交付性上是天壤之别。**

这是本仓今天数了 7 次的那一族的又一个变体：**可用 ≠ 可交付**。
**外层今天亲手做过其中的步骤 0–3**（build 产物 → `git archive` → 从产物装进 scratch 项目），
所以这份「知识在谁脑子里」的清单不是转述——**那几条我当时也是靠自己记着的**。

## 外层实测：两条会让实现走偏的事实

### 一、AC4 的坑：`ps` 分不出「进程在跑」与「事件送得到人」

外层此刻挂着的两个监视器：

```
inner-state.sh       pid=1277284  ppid=1277252   ← Monitor 工具生成的包装进程
session-liveness.sh  pid=1802943  ppid=1802895   ← 同上
```

它们的 stdout **每一行都变成会话通知**。而一个 `nohup bash …inner-state.sh > log &` 起出来的进程，
**`ps` 看上去一模一样**（同 argv），但**输出进了文件、没有任何人被通知**。

**⇒ AC4 的判据不能只查「两个进程都在」**——那正是**从外面看同形**的那一类。
**冷启动 skill 必须是 agent 执行的 skill**（`SKILL.md` 指示 agent 调用 Monitor 工具），
**不能是一个纯 shell 脚本**；若由脚本起进程，事件送不到任何人，
**这会变成一个「装好了但静默失效」的冷启动**——比没装更糟，因为它看起来装好了。

### 二、AC2 的检测阶梯在三个真实项目上各走一条不同的路（实测）

| 项目 | `package.json` 的 test | `go.mod` | `scripts/test.sh` | 可检测到的命令 |
|---|---|---|---|---|
| quay | 无 test 脚本 | 无 | **有** | `bash scripts/test.sh` |
| archguard | **`vitest run`** | 无 | 无 | `npm test` |
| meta-cc | 无 `package.json` | **有** | 无 | `go test ./...` |

**三个项目、三条不同的路，全部可检测。** ⇒ AC2 不是设想，是可落地的；
**并且它必须保留「检测不出就失败关闭」**——今天 `--test-command` 失败关闭是对的，
要改的只是**「先检测、检测到就显示给人确认」**，不是**猜默认值**。

## Contract

```
measure input_commands = `bash test/cold-start-oneliner-e2e.sh --count-inputs` 输出的人类输入命令条数字段
measure detected_test_cmd = `bash plugin/scripts/quay-init.sh --loop --dry-run --root <proj>` 输出中检测到的测试命令字段
measure monitors_delivering = 冷启动后能收到事件的监视器数（不是进程数）字段，由 `bash test/cold-start-oneliner-e2e.sh --report-monitors` 输出
band input_commands = <=4
invariant 可推导的参数不得要求输入；检测不出时失败关闭，不猜默认值；监视器判据是「事件送得到」不是「进程在跑」
invoke `bash test/cold-start-oneliner-e2e.sh`
control 把 quay 开发树改名后重跑那 ≤4 条命令 ⇒ 仍走通；把检测源（package.json/go.mod/scripts/test.sh）全部移除 ⇒ 必须失败关闭而不是用默认值
resume 三个阶段各自可独立验证：检测与残留 → 冷启动 skill → 端到端计数与改名负控制
```

## Chosen mechanism

**分三阶段落地，阶段之间可停可报。**

**阶段一（AC2 + AC3）——安装与初始化自己知道该问什么：**
1. `quay-init --loop` 增加测试命令**检测阶梯**（`scripts/test.sh` → `package.json` 的 `test` →
   `go.mod` → `Cargo.toml`），**检测到就打印出来请人确认**，`--test-command` 显式给出时优先；
   **全部检测不到 ⇒ 保持失败关闭，不许猜默认值**。
2. **残留清理并入安装**：检测「与产物同名但内容不同」的文件，**报告清了哪些、备份在哪**，
   不静默覆盖。

**阶段二（AC4 + AC5）——一行冷启动 skill：**
3. 新增一个 **agent 执行的 skill**（不是 shell 脚本，理由见上），一条命令完成：
   挂两个监视器（**经 Monitor 工具**）、建 cron、驱动内层开始第一个任务。
4. **inner 零操作**：内层要么被这条 skill 驱动、要么读装好的文件自行开始。

**阶段三（AC1 + AC6 + AC7）——端到端与负控制：**
5. `test/cold-start-oneliner-e2e.sh` 在全新项目上实跑并**逐条记录人类输入**（可数）。
6. **改名负控制**：把 quay 开发树改名后重跑那 ≤4 条命令仍走通。**这条不过前面全不算数。**
7. README 的命令序列与实跑一致。

**不做**（规格已列，此处重申两条最要紧的）：**不追求一键**——
把四条压成一条会把可诊断性一起压掉；**不猜测试命令的默认值**——检测不到就失败关闭。

## Acceptance Criteria

- [ ] AC1: 全新项目上实跑，**人类输入命令 ≤ 4 条**，每条逐字记录（实跑输出贴任务体）
- [ ] AC2: 测试命令**检测阶梯**落地，三个真实项目各自检测正确
      （quay ⇒ `scripts/test.sh`、archguard ⇒ `npm test`、meta-cc ⇒ `go test`，见上表）；
      **检测结果显示给人确认**，`--test-command` 显式优先
- [ ] AC3: **负控制**——移除全部检测源 ⇒ **失败关闭**，且错误信息说明它找过哪些位置；**不得猜默认值**
- [ ] AC4: 残留清理并入安装，**处置可见**（清了哪些、备份在哪），不静默覆盖
- [ ] AC5: 冷启动 skill 一条命令挂上两个监视器，**判据是「事件送得到」不是「进程在跑」**——
      给出收到事件的实跑证据（`nohup` 起的进程不算通过）
- [ ] AC6: **inner 零操作**——全程不向内层会话输入任何东西（实跑记录为证）
- [ ] AC7: **改名负控制**——`/home/yale/work/quay` 改名后那 ≤4 条命令仍走通（实跑输出贴任务体）。
      **这条不过，AC1–AC6 都不算数**
- [ ] AC8: README 的命令序列与实跑逐字一致（负控制：照 README 抄一遍能跑通）
- [ ] AC9: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC3、AC5、AC7 三条负控制的实跑输出都贴进任务体——
      **一个「装好了但事件送不到」的冷启动，从 `ps` 看与装好的一模一样**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录：这次的问题不是步数多，是**每一步的知识都在口述者脑子里**；
      判据是「下一个项目不需要任何人再口述一遍」

## Touches

- plugin/scripts/quay-init.sh
- plugin/skills/init/SKILL.md
- test/cold-start-oneliner-e2e.sh
- plugin/test/quay-init-loop.test.mjs
- README.md

## Dispatch review

reviewer: outer
at: 2026-08-03T15:45:00Z
changed: 管理者定义规格并把实现交给本项目。**外层加了两条实测，都指向实现最容易走偏的地方**。
**一、AC4 的判据必须从「进程在跑」改成「事件送得到」**：外层此刻的两个监视器是 Monitor 工具
起的（ppid 是工具的包装进程），stdout 每行变成会话通知；而 `nohup` 起的同一条命令
**`ps` 看上去一模一样、输出进文件、没有人被通知**。⇒ 冷启动 skill **必须是 agent 执行的 skill**，
不能是纯 shell 脚本；否则会交付一个「看起来装好了、事件送不到任何人」的冷启动——
**比没装更糟**，且正是本仓今天反复抓的「从外面看同形」那一族。已写成 AC5 并禁止 `nohup` 通过。
**二、AC2 的检测阶梯在三个真实项目上各走一条不同的路，全部可检测**（quay ⇒ `scripts/test.sh`、
archguard ⇒ `package.json` 的 `vitest run`、meta-cc ⇒ `go.mod`）——**所以它不是设想**；
同时把「检测不到 ⇒ 失败关闭、不猜默认值」写成 AC3 的负控制。
**范围判断**：9 条 AC 按本仓政策（>2 机制就拆）本该拆，**外层判不拆**——
AC1/AC7 是端到端计数与改名负控制，**按构造无法分给任何一个子任务**，
拆开会让最决定性的那条 AC 无处安放。**改为分三阶段落地、阶段间可停可报**，
与 `gap-session-liveness-…` 同样的处理，**若阶段二比预想大就停下来让外层拆**。
**派发时机**：在飞已满 3，等槽位。
