---
id: gap-outer-self-checks-and-creates-inner-session
title: "outer should self-check env and create tmux windows / start inner
  session (human product requirement — cold-start precondition 3 'inner
  reachable' drives but doesn't create; adopter must hand-build 3 windows;
  session-topology factory exists + cold-start references it, but outer doesn't
  auto-call; fix: outer cold-start step 3 self-checks inner (process +
  transcript) and calls quay-topology.sh when missing, idempotent)"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**outer 自己检查环境并在必要时创建 tmux 窗口、启动 inner 会话——幂等是权限边界（人产品设计要求 + 管理者两轮转达 + 外层裁定）**：

**人的原话**：「实际上，我希望 outer 能检查环境，并在必要时创建对应的 tmux 窗口和启动 inner 会话。」
补充：「outer 应该足够灵活，如果已经可以观察到对应的窗口和 inner 会话，就不要动——那可能是 manager
创建的。」

**为什么重要——决定采用者流程能不能成立**：cold-start 前提第 3 条「inner session reachable」驱动 inner
但不创建。采用者必须自己建窗口、手工起 inner claude 才能用 cold-start。**人的要求消除这一步**。

**幂等 = 权限边界（管理者补充，人指出）**：不是防重复优化，是**权限边界**——已存在的 inner 可能是
manager 建的，outer **无权判断 manager 的安排对不对**。outer 职责是「确保 inner 存在」，不是「确保
inner 按我的方式存在」。

**具体行为**：
① 检测到 inner 窗口存在 **且** 有活 claude ⇒ **什么都不做**，直接进入正常驱动流程。不重建、不重启、
不改名、不调启动参数——即便参数与 outer 自己会用的不同（模型不同/环境变量不同），可能是 manager 有意。
② 只有【窗口不存在】或【窗口存在但无活会话】时才创建。
③ 判据用可信的：窗口存在用 tmux list-windows；会话活着用进程存在 + transcript 有真实 user 消息
（不用 pane 哈希 3 次假阳、不用 heartbeat 冻结 42 分钟假警）。
④ **中间态**（窗口在、进程在、transcript 无 user 消息 = 被拉起但未驱动的空壳，11:40 watchdog 形态）
⇒ **驱动而非重建**——重建丢可能已有上下文。

**与 manager 分工**：manager 可能出于跨项目需要预先建好会话（B 机 quay-b：outer/inner 两窗口但按协议
未驱动）。outer 上线看到「窗口在、会话未起或未驱动」⇒ **接手驱动**，不推倒重来。manager 与 outer 可
并行工作而不互相破坏。

**与 manager 移除出拓扑同一次改动的两面**：拓扑里不含 manager，但拓扑**可能由 manager 预先建好**，
outer 要能识别并接受。

**实测支撑（手工建会话不可靠）**：meta-cc-3/archguard-4 只有单 bash 窗口零 claude——每个建的人猜一种
结构，不一致不可复现。session-topology skill + quay-topology.sh 已是工厂（幂等、按名寻址、launch 从
checked-in 配置），cold-start 已引用。缺 outer 自己调用。

### 选定机制

1. orchestrator-loop-tick 冷启动第 3 步改为**自检**：inner 窗口 + claude 进程 + transcript user 消息？
2. 健康（窗口+进程+user 消息）⇒ 什么都不做，直接驱动流程
3. 空壳（窗口+进程，无 user 消息）⇒ **驱动**（接手 manager 预建，不重建）
4. 缺失（无窗口 或 无进程）⇒ 调 quay-topology.sh 创建（**两窗口 outer+inner**，manager 不属于项目拓扑）
5. 创建后 INNER-DRIVEN 验证送达（transcript user 消息，不假设成功）
6. 与 session-topology 分工：skill 提供工厂（quay-topology.sh），outer 调用它（冷启动自检）

## Acceptance Criteria

- [ ] AC1: outer 冷启动第 3 步自检 inner（窗口存在 + 活 claude + transcript 有 user 消息）——三态判定（健康/空壳/缺失）
- [ ] AC2: **权限边界**——健康（窗口+进程+user 消息）⇒ 什么都不做，直接驱动流程，不重建/不重启/不改参数（负控制：健康 inner 不被动）
- [ ] AC3: **中间态驱动**——空壳（窗口+进程，无 user 消息）⇒ 驱动而非重建（负控制：11:40 watchdog 形态被接手驱动，不丢上下文）
- [ ] AC4: 缺失（无窗口或无进程）⇒ 调 quay-topology.sh 创建**两窗口**（outer+inner）+ 起 inner claude（checked-in 启动命令），无 manager 窗口
- [ ] AC5: 创建后 INNER-DRIVEN 验证送达（transcript 出现 user 消息，不假设成功）
- [ ] AC6: **与 manager 分工**——manager 预建的会话被 outer 接手驱动（不推倒重来）；manager 与 outer 可并行不互相破坏
- [ ] AC7: 与 session-topology skill + cold-start + launch-config + manager-topology 任务交叉标注（同一次改动两面）

## Touches

- plugin/loop/orchestrator-loop-tick.md（冷启动第 3 步自检 + 三态处理）
- plugin/skills/cold-start/SKILL.md（如涉及）
- plugin/scripts/quay-topology.sh（工厂，已存在——outer 调用它；两窗口）
- plugin/scripts/topology-check.sh（自检，已存在）
- tasks/gap-manager-baked-into-project-topology-factory.md（AC7 交叉标注）
- tasks/gap-tmux-session-topology-no-factory-definition.md（AC7 交叉标注）
- tasks/gap-crystallize-launch-config-into-checked-in-settings-file.md（AC7 交叉标注）

## Contract

measure   outer_self_check = `bash plugin/scripts/topology-check.sh --session <s> --json 2>&1 | grep -c '"ok": true'` stdout 数字段（outer 冷启动后）
band      outer_self_check = 1（拓扑在合适位置）
invariant healthy_inner_untouched = 1（健康 inner 不被 outer 动——权限边界）
invoke    `grep -n 'topology\|inner\|自检' plugin/loop/orchestrator-loop-tick.md`
control   inner 健康 ⇒ 不动（AC2）；空壳 ⇒ 驱动不重建（AC3）；缺失 ⇒ 创建两窗口（AC4）
resume    自检接入 + 三态处理分步提交，任一步完成即写盘