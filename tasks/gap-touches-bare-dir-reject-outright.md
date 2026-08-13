---
id: gap-touches-bare-dir-reject-outright
title: 封存：bare-dir 判据判错对象——伤害是裸目录本身，规则却 gate 在 uncertain 标注（人 2026-08-13 裁定暂缓，证据保留）
status: needs-human
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

> **⚠️ 人 2026-08-13 裁定暂缓，证据保留，重启需人重新裁定。** 关闭方向：①（裸目录一律拒）与 ③（区域级正交）都不立 AC、不派任务。理由：① 的唯一可观测危害就是池阻塞，而人已裁定「一个在飞任务能挡住 16/20 现在可以接受」⇒ 它没有独立成立的理由。若将来以别的理由重新成立（如裸目录声明导致误合并），再重启。证据如下，直接取用，不要重测。

## Proposal

**manager 2026-08-13 逐条枚举 16 条被挡任务，真因是四类，这是其中「裸目录」一类**：
- **真·同文件**（full-suite-runner.ts ×6 + session-liveness-helpers ×1）= 7 条
- **裸目录 `plugin/scripts/`** = ≥3 条（ts-touching-fan-in / tests-assert-live-repo-state / two-peer-bidirectional-merge）
- **无 `## Touches` 段** = ≥2 条（已另退 todo 补 Touches）
- **空条目 `['']`** = 1 条

**判错对象（判准 ②i 家族）**：`touches-parser.ts` 的 bare-dir 检测
（`UNCERTAIN_TOUCH_ANNOTATION_RE`，`gap-touches-bare-dir-uncertain-declaration-drags-the-pool`，status=done）
只拒「裸目录 + **不确定**标注」。但实测 3 条全是**裸目录 + 确定标注**：
```
- plugin/scripts/（fan-in 准入检查，ts-typecheck 前置）
- plugin/scripts/（新增静态检查：REPO_ROOT + git + 字面断言）
- plugin/scripts/（双向合并同步，扩展 claim-task / integration）
```
**模块自己的注释已写明伤害来自裸目录**（touches-parser.ts:105-113）：「A bare directory expands to
EVERYTHING under it (a SPECULATIVE broad declaration that collides with every other task touching that
dir — measured: …expanded to 100+ files and sank 5/6 pool candidates)」——**它知道伤害是裸目录，
ship 出来的规则却 gate 在标注上**，因为当时观察到的样本恰好带 `若成脚本`。
**伤害由 X 造成，判据却卡在与 X 共现的 Y 上。** 这不是新功能，是把已经付过钱的机制修对。

## Plan（暂缓——重启时按此）

1. `touches-parser.ts` bare-dir 检测去掉 uncertain 那一半——**裸目录一律拒**。
2. 消费者（task-contract-check.ts `bare-dir-uncertain-touch`）同步。
3. 3 条裸目录任务把 Touches 改成具体文件。

## AC（暂缓——不进入验收面）

- [ ] AC1: bare-dir 检测改为裸目录一律拒（去 uncertain 条件）
- [ ] AC2: 3 条裸目录任务 Touches 改具体文件
- [ ] AC3: 负控制——裸目录+确定标注被拒
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 负控制样例贴出
- [ ] 全量套件绿

## Touches

- plugin/scripts/touches-parser.ts（bare-dir 检测条件）
- plugin/scripts/task-contract-check.ts（消费者同步）
- tasks/gap-touches-bare-dir-reject-outright.md（自身）
