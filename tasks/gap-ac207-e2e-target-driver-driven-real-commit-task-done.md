---
id: gap-ac207-e2e-target-driver-driven-real-commit-task-done
title: 端到端：目标项目自己的 *-drivers 驱动出真实开发提交且任务翻 done，落 ac=GOAL-009-AC-207 记录（AC-207）
status: todo
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

正本判据 `goals/AC-207-端到端-目标项目自己的-drivers-驱动出真实开发提交且任务翻-done.md`（goal=GOAL-009，2026-09-09 人裁定）：exit 0 = 载体 `.quay/productization-verification.jsonl` 存在 `ac="GOAL-009-AC-207"` 记录，且 host≠本机 ∧ project_root ∉ 本仓库 ∧ commit_sha/task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧ produced_by_driver=true。exit 1 = 无（当前，从未发生）；exit 3 = 载体缺失。

**现状（实测，位置判定）**：2026-09-09 干跑 exit 1。载体无 AC-207 记录；字段 `produced_by_driver` / `gate_events` 全仓库零命中——无人写这条记录。

**修法**：把「端到端自证」接成 verify-deliver-coldstart.sh 的一段验证步骤 + 一条载体记录。硬顺序（GOAL-009 风险 1）：AC-202（done，机件进包）→ AC-203（ready，driver 真活）→ AC-207（本任务端到端组装）；AC-204/205/206 覆盖 init 只写启用、会话投递、goals+tasks 双载体，本任务在其上做端到端驱动。

**边界（照实说明，不假装机械）**：produced_by_driver 的最强可得直接量只到「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」，不能完全排除人在会话手敲——该半判据属人裁定口证，不冒充测量（AC-207 正文逐字）。证据必须外部可核：commit_sha 取第三方项目自身 git 历史（经共享裸仓库镜像可核），⛔ 不采信驱动方自述（硬规则 4b）。产品/夹具边界：允许 claude --bg / -p 作验证手段，但产品文档与 skill 文案不得因此声称 quay 会启动会话。

## Plan

1. **接线验证步骤**：`plugin/scripts/verify-deliver-coldstart.sh` 新增 AC-207 端到端段——在 host B/C 的第三方项目里，用已 shipped 的 `quay-init.sh` + goals+tasks 双载体创建一条真实任务，由其自身 promotion-driver → worker-driver 驱动：建任务 worktree → 产生实现提交（⛔ 排除 `chore(quay-init):` auto-commit，硬规则 4b）→ 记 gate 事件 → 翻 done。
2. **直接量读取**：`commit_sha` = 第三方项目 `git log`（任务 worktree 提交）；`task_id`/`task_status` = 目标项目 task store；`gate_events` = `.quay/gate-events.jsonl` 计数；`produced_by_driver` = 「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」；缺任一读数不写（fail-closed，硬规则 3b）。
3. **载体落账**：追加 `{"ts","ac":"GOAL-009-AC-207","host","project_root","commit_sha","task_id","task_status","gate_events","produced_by_driver"}`。
4. **生产复跑**（host B/C + 第三方项目）使判据 exit 1 → exit 0。

## Acceptance Criteria

- [ ] AC1 机制接线：`grep -c 'GOAL-009-AC-207' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1，且 `produced_by_driver`、`gate_events` 两字段名在脚本内各 ≥ 1 命中；贴前 3 条命中（硬规则②）。
- [ ] AC2 直接量：贴出读 commit_sha/task_id/task_status/gate_events/produced_by_driver 的命令与命中行——commit_sha 出自第三方 git log（非驱动方自述），gate_events 出自 .quay/gate-events.jsonl 计数。
- [ ] AC3 载体落账：生产载体出现 `ac="GOAL-009-AC-207"` 记录，host≠本机 ∧ project_root∉本仓库 ∧ commit_sha/task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧ produced_by_driver=true（逐字段满足 criterion 过滤）。
- [ ] AC4 负控制（能取假）：注入一条 produced_by_driver=false 或 host=本机 或 gate_events=0 的记录 ⇒ criterion 仍 exit 1；验证后移除、不污染生产载体。
- [ ] AC5 判据翻转：AC-207 criterion 干跑从 exit 1 → exit 0（贴出干跑输出）。

## Definition of Done

AC1–AC5 全绿；`scripts/test.sh` 全量绿（含 `plugin/test/verify-deliver-coldstart.test.mjs`）。AC-207 criterion exit 0：宿主为 B/C 之一，project_root 为第三方项目（∉ 本仓库），commit_sha 外部可核（第三方 git 历史 / 共享裸仓库镜像），task_status=done、gate_events>0、produced_by_driver=true。⛔ 产品文档与 skill 文案不得因本任务声称 quay 会启动会话（SPEC-tmux-retirement-2026-09-03 原样保留）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac207-e2e-target-driver-driven-real-commit-task-done.md