---
id: gap-precommit-guard-wire-into-quay-init-and-cold-start
title: pre-commit 守卫接进 quay-init --loop 铺设集 + cold-start 步骤（新目标自动带上 + 冷启动自动装，建成≠生效）
status: todo
labels:
  - gap
  - mechanism
parent: gap-precommit-guard-running-round-rejects-assertion-surface-commits
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12，建成≠生效缺口）**：守卫实现合入前，主检出 `.git/hooks/pre-commit` 不存在、
仓库里自动调 `--install-hook` 处 = 0、接进 quay-init/cold-start 处 = 0——**合入后守卫从不运行**（除非有人手工装）。
「建成≠生效」——今天已数过多例（message-bus 零流量 / accounting-emit 零调用 / AC36 轴零行使），守卫不能成为下一个。
代码合入 + 测试全绿 + fan-in 成功从记录上看完全是「已交付」，但钩子没装 = 一次也不运行。

## Plan

1. **接进 `quay-init --loop` 的铺设集**：新目标项目自动带上守卫脚本 + 自动 `--install-hook`（铺设即生效）。
2. **接进 cold-start skill 的步骤**：冷启动自动装钩子（恢复会话后钩子仍在，不需重装——`.git/hooks` 是克隆本地）。
3. **DoD 补「真实运行产物」**：在主检出【真 running 轮】期间尝试提交断言面文件 ⇒ 被拒 ⇒ 留拒绝记录
   （subagent worktree 的实 commit 验证只证「能工作」，不证「在此仓库正在工作」——两者差别正是所有建成零触发的差别）。

## AC

- [ ] AC1: quay-init --loop 铺设守卫脚本 + 自动 `--install-hook`（新目标项目自带）
- [ ] AC2: cold-start skill 步骤装钩子
- [ ] AC3: 主检出钩子已装（`ls -l .git/hooks/pre-commit` 可核）
- [ ] AC4: 真实运行记录——主检出真 running 轮期间提交断言面文件被拒（见 Evidence）
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 真实拒绝记录贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- plugin/scripts/quay-init.sh（铺设集）
- plugin/skills/cold-start/SKILL.md（冷启动步骤）
- plugin/scripts/precommit-guard.ts（--install-hook 若需补）
- tasks/gap-precommit-guard-wire-into-quay-init-and-cold-start.md（自身）
