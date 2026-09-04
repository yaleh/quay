---
id: gap-retire-outer-tmux-window-logic
title: 删除 outer 相关 tmux 依赖（quay-topology.sh outer
  窗口/outer-session-check.sh/topology-check.sh/manager-adopt.sh）——不迁移，直接删除
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

人 2026-09-04 裁定（`orchestration/SPEC-tmux-retirement-2026-09-03.md` §1.4/Layer 3a）：outer
作为一个需要独立生命周期的会话角色被撤销——其职能已经并入 manager 的直接 subagent 派发
（AC145-149），人描述的 quay 实际启用流程（手动开会话 → 会话内调用 skill 初始化 → 启动
drivers+webserver → 启动 manager）里不存在"启动 outer"这一步。这撤销了本 SPEC 更早版本
"outer 也要 `claude --bg` 迁移"的技术路径——outer 相关 tmux 依赖**直接删除，不迁移**。

**关联但已过期的旧提案**：`tasks/gap-outer-bg-job-migration-proposal.md`（`status:
needs-human`，`role: compound` 无 children，当前因 DIR-026/`it0-split-or-commit-check`
被挡）——其内容假设 outer 迁移到 background job session，与本任务方向（直接删除，不迁移）
相反，已经过期。本任务**不修改**那份旧提案（属另一层面的任务体编辑，不在本任务范围内），
只记录关联供后续处置参考；是否退役/改判该旧提案由人另行决定。

**要删除的对象（agent 逐行核实定位，见 SPEC §2.2/Layer 3a）**：
- `plugin/scripts/quay-topology.sh` 里 outer 窗口建立逻辑（`ROLES="outer"` 单窗口拓扑及
  相关 `tmux new-session`/`new-window` 分支）
- `plugin/scripts/session-bootstrap.sh` 里驱动 outer 冷启动的部分
- `plugin/scripts/outer-session-check.sh`（含测试 `plugin/test/outer-session-check.test.mjs`）
- `plugin/scripts/topology-check.sh`

**本任务起草时新发现、比 SPEC 原描述更大的一块范围（必须一并处理，不能只删被依赖方留断链）**：
`plugin/scripts/manager-adopt.sh`（`quay manager adopt <root>` 的实现，`packages/quay/src/cli/
manager.ts` 里的正式 CLI 子命令）**不是"顺手检查一下的调用方"，是硬依赖**——它的 `CHECKER`/
`TOPOLOGY` 变量直接指向 `outer-session-check.sh`/`quay-topology.sh`，整个脚本的存在理由就是
"三态处置一个项目的 outer 会话"（healthy/empty-shell/missing）。这两个依赖被删除后，
`manager-adopt.sh`（以及它背后的 `quay manager adopt` CLI 子命令）**不再有可执行的语义**——
不是"改一下调用点"就能解决,而是这个命令本身的存在理由随 outer 独立会话被撤销而消失。

**⚠️ 额外发现：`manager-adopt.sh` 是一个被正式列入 npm 包契约的交付物**——
`plugin/test/manager-install-vector.test.mjs` 的 `MANAGER_ARTIFACTS`（"六个 manager
deliverables 之一"，task Contract invariant）把它列为 npm pack 必须携带的文件之一。**本任务
不擅自决定"是否连带撤销 `quay manager adopt` 这个 CLI 面 + 该契约清单"**——这更接近一个产品面
决策，AC 只要求"一致性"：要么完整退役（`manager-adopt.sh` + CLI 子命令 + 契约清单 + 相关
测试同步更新，不留半退役状态），要么显式记录一个保留理由（例如降级为一个总是 no-op 的兼容
桩，并说明为什么保留）——两种处置都可以通过 AC，唯独不能是"删了依赖但留着引用它们的死代码"
这种中间态。

## AC

- [ ] `grep -n "ROLES.*outer\|tmux new-session\|tmux new-window" plugin/scripts/quay-topology.sh`
      对 outer 分支的命中数为 0（分支已删除），或该脚本文件本身已被删除（若核实后确认无
      其它非 outer 用途——用真实 grep 全仓调用者核实，不凭 SPEC 文档记忆判断）
- [ ] `test -f plugin/scripts/outer-session-check.sh` 与
      `test -f plugin/scripts/topology-check.sh` 均为假（已删除），或若核实后发现存在与
      outer 无关的独立消费者需要保留，AC 完成时的说明写明具体消费者名称（不能是空泛的
      "可能还有用"）
- [ ] `manager-adopt.sh` 与 `quay manager adopt` CLI 子命令的处置结果自洽——要么两者
      （连同 `manager-install-vector.test.mjs` 的 `MANAGER_ARTIFACTS` 清单、
      `manager-productization.test.mjs` 相关断言）一并退役，要么显式保留并写明理由；
      `grep -rn "outer-session-check\|quay-topology" plugin/scripts/manager-adopt.sh`
      不再指向任何已删除的文件路径
- [ ] `node scripts/test.sh`（或该脚本头注释指定的等价 scoped 调用，覆盖本任务改动范围）
      全绿，无新增红
- [ ] `git show HEAD:tasks/gap-retire-outer-tmux-window-logic.md` 的 Touches 与本次实际
      改动的文件集合一致（无遗漏、无 Touches 之外的越界改动）

## DoD

删除落地后，仓库里不再有任何生产代码路径尝试为 outer 创建/检查一个独立的 tmux 会话/窗口；
`quay manager adopt` 这个 CLI 子命令的语义（若保留）不再依赖任何已删除的脚本，或该子命令
本身已随同步退役、包括 npm-pack 契约清单更新。真正的落地标准是"outer 需要独立会话生命周期"
这个假设在生产代码里已经不存在，不是"改了几个文件、测试还绿"——留有半退役的死代码（引用
已删除文件的活代码路径）不算完成，即便它当前不会被触发。`manager-tick-readings.ts` 等下游
对 outer tmux 观测量的重新评估不在本任务范围内（属另一任务，见 SPEC §7 任务 4），本任务只
要求不留断链引用，不要求一并完成该重新评估。

## Touches

- plugin/scripts/quay-topology.sh
- plugin/scripts/session-bootstrap.sh
- plugin/scripts/outer-session-check.sh
- plugin/scripts/topology-check.sh
- plugin/scripts/manager-adopt.sh
- plugin/test/outer-session-check.test.mjs
- plugin/test/manager-install-vector.test.mjs
- plugin/test/manager-productization.test.mjs
- packages/quay/src/cli/manager.ts
- tasks/gap-retire-outer-tmux-window-logic.md
## Needs-Human

**执行 2026-09-04T13:31:14.993Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: AC1: warmed request 950ms < 500ms (⛔ ≥500ms ⇒ 假)
- run_id：wk-prod-1788285192
- session_id：5488ad7c-dffe-49a8-90b8-eca9936a4562
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-retire-outer-tmux-window-logic~wk-prod-1788285192~1788528228791-32b70f.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-retire-outer-tmux-window-logic-wk-prod-1788285192.log
