---
id: gap-fan-in-ff-retry-reruns-suite-on-inert-increment
title: "ff 失败重试恒跑全量 suite——触发失败的 develop 增量是纯任务体（doc）时也应跳过重跑（增量可证惰性，上一轮绿仍认证新树）"
status: todo
labels:
  - gap
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`fan-in-execute.js:277-278`：`fork=merge-base(develop,HEAD); delta=git diff --name-only $fork HEAD` —— 看**分支整体**相对 develop 的变更。这个设计**是对的**（AC97 理由：只看单轮 develop-side delta 会让更早进分支的代码被静默跳过）。但它与 ff-only 交互出昂贵后果：任何碰代码的任务（几乎全部）`code_delta` **恒非空** ⇒ **每次 ff 失败重试都跑完整 suite，无论触发失败的 develop 增量多微不足道**。

**实证**：suite-fix-relaunch 跑了 3 轮完整 suite（r248/249/250 各约 700s），其中 2 轮的触发原因是纯 `tasks/*.md` 提交；6h 窗口此类浪费 ≈1400s ≈ suite 忙时 11%。**λ 的 70% 是台账提交**（6h 内 develop 37 次前进：台账类 26=4.33/h 占 70%、任务落地类 4=0.67/h、实现提交 7=1.17/h），而 `tasks/*.md` 在本项目 `--classify-delta` 定义里不被任何检查器读取 ⇒ 对 suite 结果零影响、却 100% 杀 ff（manager 自己两条缺陷报告 bf19a64c+9762b1d0 烧掉一整轮 700s suite）。

**⊢ 保持两不变式的修法**：ff 失败重试时**只对【本次 develop 增量】分类**——若该增量 doc/任务体-only（可证惰性），上一轮 suite 的绿**依然认证新树**，直接 re-merge + re-ff 不重跑。
- ff-only 不变式（suite 跑在恰好落地的树上）：保持（增量可证惰性）
- 分支整体 delta 不变式（早期代码不被跳过）：不受影响（首轮已验）

**这不是推翻任一现有设计，是补上两者交互处的缺口**。

## Acceptance Criteria

- [ ] AC1: ff 失败重试时，若本次 develop 增量 doc/task-body-only，跳过全量 suite 直接 re-merge + re-ff（增量可证惰性）。
- [ ] AC2: 负控制——增量含代码文件（plugin/packages/scripts）时仍重跑全量 suite，不跳过。
- [ ] AC3: 两不变式各一条取假测试——ff-only（suite 在落地树上）+ 分支整体 delta（早期代码不被跳过）保持。

## Definition of Done

- [ ] 一个 `tasks/*.md`-only 的 develop 增量触发 ff 失败，重试跳过全量 suite 直接 re-merge（真实输出）；代码增量仍重跑；两不变式取假测试绿。

## Touches

- tasks/gap-fan-in-ff-retry-reruns-suite-on-inert-increment.md（自身）
- .claude/workflows/fan-in-execute.js（ff 重试增量分类）
- plugin/workflows/fan-in-execute.js（与 .claude/workflows 同步）
- plugin/test/fan-in-execute-paths.test.mjs（增量分类 + 两不变式）
