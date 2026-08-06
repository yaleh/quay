---
id: gap-os-anchor-watchdog-launch-missing-prompt-suggestions
title: os-anchor-watchdog launch-cmd lacks --prompt-suggestions false (ghost
  suggestions pollute capture-pane; RUNBOOK §2 requires it) — align launch-cmd
  with RUNBOOK + single-source the launch string to kill double-drift
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
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

- [ ] AC1: watchdog launch-cmd 含 `--prompt-suggestions false`（grep 命中 ≥1），重启的会话无 ghost 占位符
- [ ] AC2: launch-cmd 与 RUNBOOK §2 对齐（diff 无实质差异），消除二次漂移
- [ ] AC3: 与 gap-crystallize-launch-config 交叉标注（启动配置结晶同源）

## Touches

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
