---
id: gap-session-liveness-single-flight-lock-cross-project-blind
title: "session-liveness multi-target coverage gap on ad-arm1 (quay-C): delivered=false because the new machine is NOT in the manager's multi-target config — a CONFIG-GAP not a lock bug (premise of the original lock-scope task withdrawn 2026-08-06: archguard IS monitored, 105 shared-file events latest 4min ago; single-holder+shared-file design is correct per fast-mode-loop-tick.md:176-180; multi-target config working for archguard/meta-cc)"
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

**session-liveness 多目标覆盖盲区 = ad-arm1（quay-C）delivered=false——新机器未进 manager 多目标配置，配置缺失非锁 bug。**

**【管理者自我更正，2026-08-06——原「锁分域」前提撤回】**：
- 原任务标题假设「单飞锁按机器不分项目 ⇒ archguard 无监视器」。**证据核实推翻此假设**：
  archguard **被实时监视**——共享事件文件 **105 条 archguard 事件，最新 4 分钟前**。
- `mounted=false / delivered=true` 是**单持有者 + 共享文件设计**的正确状态（fast-mode-loop-tick.md:176-180
  明写「共享事件文件，任何挂载点都写同一个文件」）——不是锁 bug。
- **多目标配置在生效**：REPO-STALL / SESSION-OVERDUE 对 archguard 正常产出，就是配置生效的证明。
- **唯一真盲区 = ad-arm1（quay-C）`delivered=false`**：新机器未进 manager 多目标配置（`orchestration/
  session-liveness.env` 的 SESSION_TARGETS），**配置缺失**，非锁实现问题。
- **结论**：锁分域是修不存在的问题（原 premise 撤回），任务缩窄为 ad-arm1 配置缺失。

## Acceptance Criteria

- [ ] AC1: 核实 ad-arm1（quay-C）未在 manager 多目标配置中——确认为配置缺失（非锁 bug）
- [ ] AC2: ad-arm1 加入 `orchestration/session-liveness.env` 的 SESSION_TARGETS 后，`delivered=true` 且事件真实产生
- [ ] AC3: 记录锁分域前提撤回的证据链（archguard 105 事件 + 共享文件设计正确性 + fast-mode-loop-tick.md:176-180）
- [ ] AC4: monitor-mount-check 若可答「指定项目有没有监视器」则一并核对 ad-arm1；不强行扩展
- [ ] AC5: 测试 `node:test` + `// @test-group governance`（如涉及机制改动；纯配置则记录验证输出）

## Touches

- orchestration/session-liveness.env（manager 多目标配置：ad-arm1 加入 SESSION_TARGETS）
- tasks/gap-session-liveness-single-flight-lock-cross-project-blind.md（自身文件：勾 AC + 贴撤回证据）
- plugin/scripts/session-liveness.sh（只读核实；锁代码**不修改**——前提撤回）

## Contract

measure   ad_arm1_delivered = `bash plugin/scripts/monitor-mount-check.sh` 对 ad-arm1 的 delivered 布尔字段（或等价：事件文件含 ad-arm1 目标事件的计数）
band      ad_arm1_delivered = 1（ad-arm1 进入配置后 delivered=true）
invoke    `grep -n "ad-arm1\|quay-C" orchestration/session-liveness.env`（配置含 ad-arm1 目标）
control   配置加入前 ad-arm1 delivered=false（记录现状）；加入后 true（AC2 实跑）
resume    先核实配置现状（ad-arm1 是否已在 SESSION_TARGETS），再决定是加配置还是纯记录

## Dispatch review

reviewer: outer
at: 2026-08-06T19:5xZ
changed: 管理者自我更正撤回锁分域 premise（archguard 105 事件已监视，单持有者+共享文件设计正确），
任务从「锁分域修复」缩窄为「ad-arm1 配置缺失」；锁代码不修改。原派发的 agent 已停（worktree 零改动）。
