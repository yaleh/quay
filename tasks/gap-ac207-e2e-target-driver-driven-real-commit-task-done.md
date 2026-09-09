---
id: gap-ac207-e2e-target-driver-driven-real-commit-task-done
title: 端到端：目标项目自己的 *-drivers 驱动出真实开发提交且任务翻 done，落 ac=GOAL-009-AC-207 记录（AC-207）
status: ready
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
3. **载体落账**：经 `ac89_append_goal009()` 落账（`build_sha`/`ts` 由 helper 统一补——AC-214 新鲜度锚只认 top-level `build_sha`），追加 `{"ac":"GOAL-009-AC-207","host","project_root","commit_sha","task_id","task_status","gate_events","produced_by_driver"}`；⛔ `commit_sha` 是异仓库 sha，不作新鲜度锚。
4. **生产复跑**（host B/C + 第三方项目）使判据 exit 1 → exit 0。

## Acceptance Criteria

- [x] AC1 机制接线：`grep -c 'GOAL-009-AC-207' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1，且 `produced_by_driver`、`gate_events` 两字段名在脚本内各 ≥ 1 命中；贴前 3 条命中（硬规则②）。
- [ ] AC2 直接量：贴出读 commit_sha/task_id/task_status/gate_events/produced_by_driver 的命令与命中行——commit_sha 出自第三方 git log（非驱动方自述），gate_events 出自 .quay/gate-events.jsonl 计数。
- [ ] AC3 载体落账：生产载体出现 `ac="GOAL-009-AC-207"` 记录，host≠本机 ∧ project_root∉本仓库 ∧ commit_sha/task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧ produced_by_driver=true（逐字段满足 criterion 过滤）。
- [x] AC4 负控制（能取假）：注入一条 produced_by_driver=false 或 host=本机 或 gate_events=0 的记录 ⇒ criterion 仍 exit 1；验证后移除、不污染生产载体。
- [ ] AC5 判据翻转：AC-207 criterion 干跑从 exit 1 → exit 0（贴出干跑输出）。

## Definition of Done

AC1–AC5 全绿；`scripts/test.sh` 全量绿（含 `plugin/test/verify-deliver-coldstart.test.mjs`）。AC-207 criterion exit 0：宿主为 B/C 之一，project_root 为第三方项目（∉ 本仓库），commit_sha 外部可核（第三方 git 历史 / 共享裸仓库镜像），task_status=done、gate_events>0、produced_by_driver=true。⛔ 产品文档与 skill 文案不得因本任务声称 quay 会启动会话（SPEC-tmux-retirement-2026-09-03 原样保留）。

## Evidence

AC1 ✅ 机制接线（merge develop 后复验）：`grep -c 'GOAL-009-AC-207'`≥1、`produced_by_driver`/`gate_events` 两字段名各 ≥1 命中；`--selfcheck` exit 0 且含 ac207-record 正/负控制（valid wrote=1 fields_ok=1 / produced_by_driver=false refused=1 / gate_events=0 refused=1），与 develop 侧 AC-203/201/206/204/205 控制一并 PASS。`plugin/test/verify-deliver-coldstart.test.mjs` 11/11 绿。

AC4 ✅ 负控制：向生产载体注入 produced_by_driver=false 与 host=本机 各一条 ⇒ AC-207 criterion 仍 exit 1（判据能取假）；载体已字节级还原。selfcheck 内 hermetic 负控制（ac207-record produced_by_driver=false / gate_events=0 各 refused=1）已覆盖。

AC2/AC3/AC5 ⛔ 阻塞（生产复跑已跑，AC-203/206 已证实落地，⛔ 新缺陷现形）：2026-09-09 host B=orangevps 生产复跑（develop-tip 0.6.1 tgz 现 build，`--ac207-e2e`，第三方项目 /home/yale/work/ac207-third-party）。已证实：step① install quay 0.6.1 OK（NPM_BIN_DISPATCH=1）；step② quay-init L1 closed_set present=7/7 含 `goals/`（AC-206 落地）；step④ `driver_alive=1`、`has_plugin_dir=0`（AC-203 落地，driver 在无 plugin/ 第三方项目真活）；step⑤ 双载体 goals/tasks 均建且可读（AC-206 记录已写）。⛔ 新缺陷（已立 `gap-driver-resource-gate-path-anchored-at-root-third-party`）：promotion-driver 每轮 `error: ready-pool-check exited 1` + `gate:{go:false, reason:"resource-gate WAIT (exit 127)"}`、worker-driver 每轮 `stop_reason:"resource-gate-wait: resource-gate WAIT (exit 127)"`——`plugin/scripts/driver-shared.ts:212` `resourceGateCheck` 仍把 resource-gate.sh 锚在 `opts.root/plugin/scripts/`，第三方项目无 plugin/ ⇒ `bash <不存在>` exit 127 ⇒ 恒 WAIT ⇒ 任务 e2e-verify-207 永久 todo、永不派发 ⇒ 无真实开发提交 ⇒ AC-207 记录无法写（fail-closed）。AC-207 机制接线已就位并 fail-closed，待该缺陷落地后复跑 `--ac207-e2e` 即可使 criterion exit 0。

**RETREAT 说明（2026-09-09，quay-task 核实）**：阻塞方 `gap-driver-resource-gate-path-anchored-at-root-third-party` 已于 2026-09-09T20:41:18Z 翻 done 并落 develop（commit 6acf9e8a2），主检出已同步；人 2026-09-09 已核实并授权续验 AC2/AC3/AC5。本次核实时任务 frontmatter `status` 已为 `ready`（非请求方所设想的 `needs-human`——早于本次操作已恢复，未使用 lifecycle_retreat 动作；且合法 retreat 边不存在 needs-human→ready，仅 needs-human→todo），故未执行状态变更，仅在此记录阻塞解除与授权续验的说明。下一步：在 host B/C 复跑 `verify-deliver-coldstart.sh --ac207-e2e`（使用 resource-gate 修复后的 develop）以完成 AC2/AC3/AC5。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac207-e2e-target-driver-driven-real-commit-task-done.md

## Needs-Human

**执行 2026-09-09T20:12:48Z — 阻塞于未落地兄弟任务 + 跨主机生产复跑（CONTINUE 第 3 轮，⛔ 非实现缺陷）**

- 阻碍原因：AC2/AC3/AC5 依赖 host B/C 第三方项目生产 e2e 复跑，该复跑被 `gap-driver-resource-gate-path-anchored-at-root-third-party` 阻塞（resource-gate 锚 `opts.root` ⇒ 第三方无 `plugin/` ⇒ exit 127 ⇒ 永不派发）。
- 本轮实测：缺陷任务 status=ready，其 worktree 有未提交实现（`M plugin/scripts/driver-shared.ts` / `M plugin/scripts/cap-from-gate.ts` / `?? plugin/test/driver-shared.test.mjs`），develop 未落地——`develop:plugin/scripts/driver-shared.ts:212` 仍 `path.join(root, "plugin", "scripts", "resource-gate.sh")`。
- 本任务实现（AC1/AC4）已完成并验证（分支 5 提交、AC 勾 2/5）；AC2/AC3/AC5 为外部依赖等待，⛔ 未伪造勾选。
- 恢复路径：resource-gate 缺陷落地 develop 后，在 host B/C 复跑 `verify-deliver-coldstart.sh --ac207-e2e` 使 criterion exit 0，再 retreat 本任务回 ready 续验 AC2/AC3/AC5。
- **2026-09-09T20:41:18Z 更新**：阻塞方已 done 落 develop（6acf9e8a2）；本任务 frontmatter status 核实时已为 ready，无需 retreat 动作即可续验 AC2/AC3/AC5。