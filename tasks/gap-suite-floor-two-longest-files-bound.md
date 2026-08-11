---
id: gap-suite-floor-two-longest-files-bound
title: 套件地板由两个文件钉死——runner-grouping.test.mjs 204s（serial，nested-spawn，安装夹具救不了）+
  cap-from-gate.test.mjs 166s（main）⇒ 每一相墙钟 = max(sum÷并发, 最长单文件)，核数够多后第二项接管 ⇒ 48
  核相对 16 核在三条杠杆后买到 0（三相全撞各自最长文件地板）；处方=拆这两个文件各约 4
  份（16核顺序332s/三相并发229s/48核并发123s），优先级在杠杆 3
  之后、任何硬件讨论之前；内存任何配置非约束（47-88MB/进程，别为它付钱）
status: ready
labels:
  - gap
  - defect
  - performance
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**套件地板由两个文件钉死：`runner-grouping.test.mjs`（204s，serial 相，nested-spawn——安装夹具救不了它）与 `cap-from-gate.test.mjs`（166s，main 相）。每一相墙钟 = max(该相 sum÷并发, 该相最长单文件)；核数够多之后第二项接管 ⇒ 三条杠杆做完后 16 核约 493s、48 核【完全相同】的 493s——三相全部撞在各自最长文件的地板上，48 核相对 16 核买不到任何东西。把这两个最长文件各拆成约 4 份后，48 核才第一次产生回报。**

### 实证（manager 2026-08-11 05:0x，r266 实测逐文件计时 + outer 复核）

- **每一相墙钟 = max(sum÷并发, 最长单文件)**：核数够多后第二项接管。
- **三相最长文件（r266 实测）**：serial 的 runner-grouping.test.mjs **203.6s**（nested-spawn，安装夹具救不了）；lowconc 的 session-liveness-signals **216s**（拆 3 后 72s，杠杆 2 已覆盖）；main 的 cap-from-gate.test.mjs **166.3s**。
- **三条杠杆做完后估算**：16 核约 493s（serial 204 + lowconc 72 + main 166 + static 33 + 其它 18）；**48 核完全相同的 493s**——三相全撞在各自最长文件地板，48 核买不到任何东西。
- **三相并发跑（sum 变 max）**：16 核约 255s、48 核还是 255s——runner-grouping 一个文件就 204s。
- **核心结论**：整套套件地板由两个文件决定：runner-grouping（204s）+ cap-from-gate（166s）。**把这两个各拆成约 4 份**：16 核顺序 332s / 16 核三相并发 229s / 48 核三相并发 123s——**只有这时 48 核才第一次产生回报**。
- **正确顺序**：三条杠杆 → 拆这两个最长文件 → 才轮到加核数。
- **内存结论（实测，供采购）**：每测试进程 47-88MB，安装根仅 11MB 且落在 ext4 非 tmpfs ⇒ 16 核并发 16 约 1.4GB、48 核并发 48 约 4.2GB，16GB/48GB 都远超 —— **内存在任何配置下都不是约束，别为它付钱**。

### 选定机制方向（实现归 inner，判定归 outer）

**把 runner-grouping.test.mjs 与 cap-from-gate.test.mjs 各拆成约 4 份**（按测试关注面分组），每份墙钟降至 1/4：
1. **runner-grouping 拆 4**：serial 相地板 204→约 51s（nested-spawn 族——注意安装夹具救不了它，只能拆）。
2. **cap-from-gate 拆 4**：main 相地板 166→约 42s。
3. **优先级**：在杠杆 3（kind=heavy）之后、任何硬件讨论之前。
4. **纯拆分不改语义**：断言全保留、覆盖不缩水。

**验证锚**：修后 (a) 两文件各拆约 4 份、各自墙钟降至 1/4；(b) 相应相地板下降（serial 204→51、main 166→42）；(c) 断言全保留；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录两最长文件实测（runner-grouping 203.6s serial / cap-from-gate 166.3s main）+ 墙钟公式 max(sum÷并发, 最长单文件) + 48 核 0 回报估算（本任务 Proposal 已含）
- [ ] AC2: **runner-grouping 拆 4**——serial 相地板 204→约 51s
- [ ] AC3: **cap-from-gate 拆 4**——main 相地板 166→约 42s
- [ ] AC4: **语义不降**——断言全保留、覆盖不缩水；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：两文件各自墙钟实测贴出（对比 204/166）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/test/runner-grouping.test.mjs（拆 4 份）
- plugin/test/cap-from-gate.test.mjs（拆 4 份）
- plugin/scripts/known-load-sensitive.ts（runner-grouping nested-spawn 标注保持）
- tasks/gap-suite-floor-two-longest-files-bound.md（自身：勾 AC + 贴证据）


> **manager 2026-08-11 05:5x 重排（人要求的全面量化推翻原排序）**：套件耗时影响实测（48h：116 轮=98红/18绿 绿率16%，套件占空 54%，68% 墙钟花在最终变红的轮次，MTBG 中位 2.2h，绿轮出生时已落后 16 提交/陈旧 27min，提交→验证等待中位 3.9h/p90 15h，4% 提交从未验证）。因果链超线性：套件越长⇒累积提交越多⇒快照含缺陷概率越高⇒绿率越低⇒MTBG 越长。反解 p≈4.95%：d=27min⇒MTBG 2.2h/绿率17%/累积35提交；d=20min⇒0.5h/67%/8；d=16min⇒0.4h/75%/6；d=8min⇒0.2h/89%/2。**27→20 分钟时长只降 26%，MTBG 降 77%——系统停在拐点坏侧**。⇒ 三杠杆把验证滞后从 3.9h 压到约 0.5h 是 **9 倍不是 30%**。**本任务（拆 runner-grouping+cap-from-gate）从我原排的第 4 位提到与三条杠杆并列**——跨过拐点的价值是 9 倍，而这两个文件正是跨过之后立刻接管的新地板。16 核+三杠杆已跨拐点，48 核撞最长文件地板、拐点那侧收益早已吃完。**反直觉推论**：68% 产能花在红轮不是浪费，浪费的是它们信息量太低——嫌疑集 35 的红轮与嫌疑集 2 的成本相同（都 27min）但后者直接指认缺陷；缩短套件的真正回报是把每次红轮信息量提高约 17 倍。

## Finding：架构评估存档（manager 2026-08-11 05:4x——人正在考虑废除 integration 分支，改为 per-task 验证）

**这是人的裁定、尚未做出——存档只作量化结论记录，勿据此改任何执行路径。**（manager 明确指示：落点写 Proposal/Finding，不写 Contract。）

**核心发现**：真正需要过验证队列的**任务合并只有 1.4 条/小时**——integration 那 15.2 提交/小时里，9.2 是三层自己的立案/记账/文档提交。**这套架构的验证滞后（3.9h 中位）不是套件慢造成的，是「一次验证覆盖 35 个提交」的批量属性造成的。**

**per-task 验证（废除 integration、inner 任务 subagent 直接跑 suite 并合入 develop）的量化（M/D/1）**：

| 套件时长 | 队列利用率 | 排队等待 | 总验证滞后 | vs 现状 3.9h |
|---|---|---|---|---|
| 27min（现状） | 63% | 22.8min | **50min** | **4.7×** |
| 17min（三杠杆后） | 40% | 5.6min | **23min** | **10×** |
| 7min | 16% | 0.7min | 7.7min | 30× |
| 2min | 5% | 0min | 2min | 117× |

- **原因不在速度在绿率**：今天一次验证覆盖 35 提交、绿概率 (1−p)^35≈17%；per-task 覆盖 1 个任务、绿概率 (1−p)^1≈95%。**MTBG 的失控是批量架构的属性，不是套件的属性。** 此前「27min 卡在悬崖坏侧」的悬崖只存在于当前架构里——换成 per-task 验证，悬崖消失。
- **机器成本几乎不变**：1.4 合并/h × 27min = 63% 占空比，与今天实测 54% 同量级。同样的机器时间，信息量从「35 个里有一个坏的」变成「就是这一个」。
- **套件时长决定吞吐天花板**：队列稳定需 ρ<70% ⇒ λ_max=0.7/d。27min ⇒ **1.56 合并/h**（今天实测 1.40 已贴着上限）；17min ⇒ 2.5/h；7min ⇒ 6/h；2min ⇒ 21/h。**一旦流水线健康、inner 满负荷跑 5 槽，任务完成率远超 1.56/h、队列立即发散 ⇒ 套件优化不是可选项，它决定这套架构能承受多大的开发速度。**
- **三个必须一起做的前提**（否则方案坏）：① 合并队列必须串行且 rebase 后验证（覆盖今天 integration 承担的「组合验证」职责；ρ=63% 有足够余量吸收串行化）；② 记账类提交走单独廉价层（9.2/h 的立案/记账/文档不该占合并队列——但它们确实影响套件，刚才 14 秒红就是任务文件的 ## Contract 语法；修法=分层：静态检查 13.7s 对每个提交跑、全量套件只在合并队列跑，`--static-tier` 结构上已有）；③ 否则错误归因——记账提交破静态检查在下个任务合并时才暴露、被算到那个任务头上，正好抵消 per-task 验证的最大好处。
- **结论**：方向是对的，且比继续优化套件更值钱——验证滞后降 4.7×、嫌疑集 35→1、机器成本不变。**套件优化从「主要手段」变成「决定吞吐上限的参数」。**

### 队列数学更正（manager 2026-08-11 06:3x——上表 ρ=63% 作废，以本节为准）

**更正**：上表 λ=1.40/h 是「提交信息以 `fan-in:` 开头」的**提交数**口径；**队列的单位是任务不是提交**——按不同任务数重算 λ=**1.81 任务/h**。⇒ d=27min ⇒ **ρ=81%、排队 58min、总滞后 85min，已在发散边缘**，不是 ρ=63% 成立。稳定门槛 λ_max=0.7/d ⇒ **d ≤ 23 分钟**。
**结论修正**：per-task 验证 + 合并队列这套架构**必须与三条杠杆（→17min，ρ=51%，总滞后 26min）一起上，不能先换架构再优化套件**。且 1.81/h 是被红轮压着的值，流水线健康后会更高、门槛更紧。**这对本任务（杠杆4 与杠杆1-3 并列）是支持而非推翻**——它把套件优化从「提速」升级为「架构可行性的前置条件」。

### 近 48h 全阶段吞吐实测（manager 2026-08-11 06:3x，全部按 git 持久证据算）

**弃用 fast-mode-telemetry --report**：它自报 tasks=7/tasksPerHour=0.146 但同时 reconciled=96/unreliable=6/orphaned=1——括号账本失真使任务计数不可用。

| 阶段 | 实测 | 速率 |
|---|---|---|
| ①开发 | 78 任务有实现提交（117 提交，1.5 条/任务） | 1.62 任务/h |
| ②fan-in | 87 不同任务（29 个实现早于窗口 ⇒ 本窗口在消化存量，故合并率>开发率） | 1.81 任务/h |
| ③验证 | 120 轮/绿 18；**跑满全量的仅 25 轮 ⇒ 79% 的轮次从未跑完全量** | 2.50 轮/h、绿 0.38/h |
| ④closure | 31 条 | 0.65/h |
| ⑤到达 develop（被验证） | 69 任务，滞留 9 | **1.44 任务/h = 34.5 任务/天** |

机时占用 25.3h/48h = 53%。

**两个读法**：
- **生产 1.44/h vs 验证绿 0.38/h ⇒ 生产比验证快约 4 倍**，差额全堆在 develop..integration（此刻 55 条）——这是「验证滞后中位 3.9h」的**产生机制**，不是它的后果。
- **79% 的轮次没跑完全量**比「68% 机时花在红轮」更刺眼：多数轮次连一次完整测量都没产出，而 per_test_ms、相位分解等读数都来自完整轮次——**样本量比我们以为的小得多**。

## Contract
measure   runner_grouping_ms = `grep -oE '__PERFILE__ duration_ms=[0-9.]+ [^ ]*runner-grouping' <serial相日志> | tail -1` 的 stdout 中 duration_ms 数字
band      runner_grouping_ms <= 60000（拆 4 后地板 ≤ 约 51s）
measure   cap_from_gate_ms = `grep -oE '__PERFILE__ duration_ms=[0-9.]+ [^ ]*cap-from-gate' <main相日志> | tail -1` 的 stdout 中 duration_ms 数字
band      cap_from_gate_ms <= 50000（拆 4 后地板 ≤ 约 42s）
invariant assertions_preserved = 1（断言全保留，覆盖不缩水）
invoke    `grep -oE '__PERFILE__ duration_ms=[0-9.]+ [^ ]*(runner-grouping|cap-from-gate)' <日志>`（贴拆后耗时）
control   两文件各拆 4 份；地板降 1/4；语义不降；既有不回归
resume    拆 runner-grouping / 拆 cap-from-gate / 验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 05:0x——人问 16/48 核估算，结果推翻【加机器】这条路：每相墙钟 = max(sum÷并发, 最长单文件)，核数够多后第二项接管 ⇒ 三条杠杆后 48 核 = 16 核（三相全撞各自最长文件地板）；拆 runner-grouping(204s)+cap-from-gate(166s) 各 4 份后 48 核才第一次有回报。优先级：三条杠杆 → 拆这两文件 → 才谈硬件。内存任何配置非约束。实现归 inner，判定归 outer
