---
id: gap-os-anchor-watchdog-launch-missing-prompt-suggestions
title: os-anchor-watchdog launch-cmd lacks --prompt-suggestions false (ghost
  suggestions pollute capture-pane; RUNBOOK §2 requires it) — align launch-cmd
  with RUNBOOK + single-source the launch string to kill double-drift
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---

> **【作废 — 2026-08-06 人裁定，两条独立理由，任一条即足以作废】**
>
> 1. **「不得重启 watchdog。请专注于以产品化方法改进」** ⇒ 本条要修的装置**不得再运行**。
> 2. **「会话真死不要管。我明确这不在本项目需要监控和恢复的范围内」** ⇒ 本条要修的装置的
>    **目的本身**（探测会话死亡并拉回）**已被移出项目范围**。
>
> ⇒ 修好它也不会被使用。**实测佐证（2026-08-06 17:5xZ）**：os-anchor watchdog 当前
> **0 个 systemd unit、0 条 os crontab 条目、0 个进程**——装置已完全停摆。
>
> **不删除本文件**：保留缺陷描述，因为若将来范围重新放开，这些实测缺陷仍然成立、
> 不必重新发现。**但不得派发**（`status: superseded`）。
>
> 完整裁定记录见 `tasks/gap-manager-productization-five-constraints.md` 的 AC5/AC5b/AC5c。
**type:** execution

## Proposal

**watchdog launch-cmd 缺 --prompt-suggestions false（AC13 真实场景验证发现）**：
`os-anchor-watchdog.sh` 重拉会话用的 launch-cmd（projects.conf 里）只有
`claude-deepseek --model deepseek-v4-flash --permission-mode bypassPermissions`，
**缺 `--prompt-suggestions false`**（grep 0 命中）。

**后果（实测）**：archguard outer 重启后显示 ghost 占位符（`Try "write a test for generator.ts"`）——
灰色 ghost 建议污染 `capture-pane` 判读（RUNBOOK §2 明列该参数是「可被远程驱动的会话」必要项）。

**根因**：watchdog 的 launch-cmd 与 RUNBOOK §2 的启动命令**各自维护**——launch 字符串二次漂移
（RUNBOOK 是文档、projects.conf 是配置，两处定义）。

### 选定机制

1. watchdog 的 launch-cmd 与 RUNBOOK §2 对齐——加 `--prompt-suggestions false`
2. **消除二次漂移**：launch-cmd 引用单一定义（如 RUNBOOK 或一个共享常量），不各自维护
   （与 gap-crystallize-launch-config-into-checked-in-settings-file 的启动配置结晶同源）

## Acceptance Criteria

- [x] AC1: watchdog launch-cmd 含 `--prompt-suggestions false`（grep 命中 ≥1），重启的会话无 ghost 占位符
      invoke（contract）：`grep -c 'prompt-suggestions' ~/.config/quay/os-anchor/os-anchor-projects.conf` → `1`；
      `grep -n 'launch-cmd\|prompt-suggestions' ~/.config/quay/os-anchor/os-anchor-projects.conf` → 第 3 行
      launch-cmd = `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false claude-deepseek --model deepseek-v4-flash
      --permission-mode bypassPermissions --prompt-suggestions false`（flag + env 双 REQUIRED 参数，restart-plan §8）。
      重启的会话无 ghost 占位符由「watchdog 用该 launch-cmd 重拉会话」保证——flag 在源头关掉 ghost-suggestion
      （gap-ghost-suggestion-eliminated-at-source AC1/AC2 已实测双向对照）。
- [x] AC2: launch-cmd 与 RUNBOOK §2 对齐（diff 无实质差异），消除二次漂移
      二次漂移消除：`plugin/scripts/os-anchor-install.sh` 原有**两处** launch 字符串
      （`default_projects()` 与 `--add-project`）现单源化为一个共享常量 `LAUNCH_CMD`
      （gap-crystallize-launch-config 任务 AC 里明确记过「os-anchor-install.sh（两处 launch 字符串）」），
      两处都引用 `$LAUNCH_CMD`，不再各自维护；该常量携带 RUNBOOK/restart-plan §8 的 REQUIRED 参数
      （`--prompt-suggestions false` + `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`），与 RUNBOOK §2 无实质差异。
      机械防回归：`plugin/test/os-anchor-watchdog.test.mjs` 新增断言生成 config 的 launch-cmd 必带这两个参数
      （`node --test plugin/test/os-anchor-watchdog.test.mjs` → pass 2 / fail 0）。
- [x] AC3: 与 gap-crystallize-launch-config 交叉标注（启动配置结晶同源）
      `tasks/gap-crystallize-launch-config-into-checked-in-settings-file.md` 的「与既有任务的关系」段
      新增交叉标注：os-anchor watchdog 的 launch-cmd 消费同一启动配置，`os-anchor-install.sh` 的
      `LAUNCH_CMD` 与 settings 文件/`quay-launch.sh` 同源（AC1/AC2 落地于 `os-anchor-watchdog.test.mjs` 机械断言）。

## Touches

- tasks/gap-os-anchor-watchdog-launch-missing-prompt-suggestions.md
- ~/.config/quay/os-anchor/os-anchor-projects.conf（launch-cmd 加参数）
- plugin/scripts/os-anchor-install.sh（projects.conf 生成模板）
- tasks/gap-crystallize-launch-config-into-checked-in-settings-file.md（AC3 交叉标注）

## Contract

measure   launch_prompt_suggestions = `grep -c 'prompt-suggestions' ~/.config/quay/os-anchor/os-anchor-projects.conf` stdout 数字段
band      launch_prompt_suggestions >= 1（launch-cmd 含参数）
invoke    `grep -n 'launch-cmd\|prompt-suggestions' ~/.config/quay/os-anchor/os-anchor-projects.conf`
control   当前形态（无参数）⇒ 0 命中；修后 ⇒ ≥1（AC1）
resume    参数对齐与单一定义分步提交，任一步完成即写盘
## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
