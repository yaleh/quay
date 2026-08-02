---
id: gap-telemetry-report-writes-and-deadlocks-readiness
title: "--report rewrites a tracked file, so any telemetry polling keeps the
  tree dirty and readiness can never pass"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`restart-readiness-check.sh` 的第一条硬检查是**工作树干净**——它是「master 是否可以交回给循环」
的机械判据，`.halt` 的解除以它为前提（CLAUDE.md 明确要求解除前先跑它）。

2026-08-02 实测，`NOT READY` 的**唯一**失败项就是它，而成因是一个闭环：

| 步骤 | 事实 |
|---|---|
| 1 | `restart-readiness-check.sh` 要求 `git status` 干净 |
| 2 | `milestones/fast-mode-telemetry/<date>.json` **被 git 跟踪** |
| 3 | `fast-mode-telemetry.ts --report` **每次调用都改写它**（实测：调用前 md5 `f177326fc890` → 调用后 `34b6854e76b1`） |
| 4 | 外层的 `orchestration/watch/inner-state.sh` Monitor **每 60 秒**调一次 `--report` |
| 5 | ⇒ 任何一次提交后 60 秒内工作树必然变脏 ⇒ **readiness 永远通不过** ⇒ `.halt` 永远解不开 |

第 4 步是外层 2026-08-02 晚上引入的，此前只有人工 tick 每约 20 分钟调一次，提交还能挤在间隙里落地。
**现在这是一个稳定的死锁，不是偶发。**

### 为什么这不该靠「记得提交」解决

内层已经出现过 `chore: refresh telemetry aggregate` 这类提交——那是在给一个**每 60 秒重新生成的
派生文件**做人工同步，噪声提交会持续产生，而且永远追不上。

### 根因是职责错位，不是 gitignore 的问题

`--report` 是**读操作**，它不该写。同一个命令既报告又落盘，导致「看一眼状态」这个动作产生副作用——
外层每次 tick 观察内层，都在改变被观察的仓库状态。

注意 `.workflow-events/`（原始事件存储）**已经在 `.gitignore` 里**（第 29 行），
而由它派生的日聚合却被跟踪。但**不建议直接 gitignore 掉聚合**：原始事件是 gitignore 的，
聚合是唯一持久的任务耗时记录，删掉跟踪等于丢历史。

## Chosen mechanism

**把写从 `--report` 里拆出去。**

1. `--report` 变成**纯读**：从 `.workflow-events/*.jsonl` 计算并输出，**不写任何文件**。
2. 落盘改为显式子命令（`--snapshot` 或 `--flush`），由**需要留存的时刻**调用——
   任务收尾、Land、日终，而不是每次观察。
3. 聚合文件保持被跟踪（它是唯一持久的耗时历史），但只在显式落盘时变化，因此可以被正常提交。
4. 外层的 Monitor 与 tick 观察一律走纯读路径。

**不做**：不 gitignore 聚合文件（会丢历史）。不放宽 readiness 的干净树检查——那条检查是对的，
错的是有东西在持续弄脏树。

## Acceptance Criteria

- [ ] AC1: `--report` 调用前后聚合文件的 md5 不变（实测复现当前缺陷再验证修复）
- [ ] AC2: 新增显式落盘子命令；只有它会改写聚合文件
- [ ] AC3: 连续调用 `--report` 20 次后 `git status --porcelain` 为空
- [ ] AC4: 显式落盘后聚合文件内容与同一时刻 `--report` 的输出一致（两条路径不得分叉）
- [ ] AC5: `orchestration/watch/inner-state.sh` 与外层 tick 的观察命令确认走纯读路径
- [ ] AC6: 在干净树上跑 `restart-readiness-check.sh`，第一条硬检查通过（当前是唯一失败项）
- [ ] AC7: 现存的 `chore: refresh telemetry aggregate` 类噪声提交不再需要——在任务体记录
      修复前后一段时间内该类提交的数量
- [ ] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC1/AC3 的实测输出贴进任务体
- [ ] `scripts/test.sh` 绿
- [ ] 明确记录：**观察不得改变被观察对象**——这是本任务的一般性结论，
      外层每 20 分钟观察一次内层，任何带副作用的观察命令都会以同样方式反噬

## Touches

- plugin/scripts/fast-mode-telemetry.ts
- experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts
- plugin/test/fast-mode-telemetry.test.mjs
- orchestration/watch/inner-state.sh
