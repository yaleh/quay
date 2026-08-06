---
id: gap-cold-start-outer-validation-runs
title: "cold-start 三条验证 AC 待外层实跑：meta-cc 真实写入、inner 零操作记录、多模型同后果清单"
status: ready
labels:
  - gap
extra:
  schema: v1
---

**type:** execution

## Proposal

承载 `gap-cold-start-needs-a-human-to-dictate-eight-steps`（已 done）未勾的三条验证 AC。
机制已由该任务交付（三阶段 + scoped 39/39 + 批 7 全量 2148/0/0 绿），但三条验证需要外层环境
（跨项目写权限 / 真实多模型运行），超出 worktree 授权。三条各自独立、按序可跑：

1. **AC1b — meta-cc 真实写入 run**：对 `/home/yale/work/meta-cc`（已有 `.quay`/`.claude/workflows`/
   `scripts/gates`）实跑 `quay-init --loop` 的升级路径，证明「已有资产不破坏 + Go 项目不挑语言 +
   不依赖开发树」。**需跨项目写权限**（外层执行）。
2. **AC6 — inner 零操作实跑记录**：冷启动 skill 驱动内层开始第一个任务，全程不向内层会话输入任何
   东西；给出实跑记录为证。
3. **AC8c — 多模型（opus/flash/qwen）同后果清单实跑**：同一冷启动 skill 命令在三个模型上各自跑，
   可观测后果清单（worktree 建了、`--task-start` 写了一条、首任务分支出现）逐模型一致。

## Carries

from: gap-cold-start-needs-a-human-to-dictate-eight-steps
acs: AC1b, AC6, AC8c

## Acceptance Criteria

- [ ] AC1: meta-cc 升级路径实跑完成，输出贴进本任务体（覆盖 AC1b）
- [ ] AC2: inner 零操作实跑记录贴进本任务体（覆盖 AC6）
- [ ] AC3: 三模型同后果清单实跑输出贴进本任务体（覆盖 AC8c）
- [ ] AC4: 三条验证完成后，`task-ac-carryover-check` 对 `gap-cold-start-needs-a-human-to-dictate-eight-steps` 放行

## Touches

- tasks/gap-cold-start-outer-validation-runs.md
- （验证类，无代码改动；实跑产出贴本任务体）
