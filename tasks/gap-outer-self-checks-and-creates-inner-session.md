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

**outer 自己检查环境并在必要时创建 tmux 窗口、启动 inner 会话（人产品设计要求 + 管理者转达 + 外层裁定）**：

**人的原话**：「实际上，我希望 outer 能检查环境，并在必要时创建对应的 tmux 窗口和启动 inner 会话。」

**为什么重要——决定采用者流程能不能成立**：人的理想使用场景：①装 plugin ②项目里跑 tmux+claude、输 skill 初始化 + 启动 outer ③跟 outer 讨论目标。**漏一步**：cold-start 前提第 3 条是 inner session reachable——它驱动 inner 但**不创建**。按现状采用者必须自己建三窗口、手工起 inner claude 才能用 cold-start。**人的要求消除这一步**。

**实测支撑（手工建会话不可靠）**：人手工建的 meta-cc-3/archguard-4 只有单个 bash 窗口、零 claude 进程——每个建的人猜一种结构，不一致不可复现。session-topology skill 已把三窗口做成 checked-in 工厂（quay-topology.sh，幂等、按名寻址、launch 从 checked-in 配置），cold-start 已引用它（TOPOLOGY-IN-PLACE 检查 + build）。**但缺 outer 自己调用它**——现在靠人/管理者手动跑 cold-start skill。

**现状差距**：orchestrator-loop-tick 冷启动第 3 步「找到内层会话」假设 inner 已存在（找人）；cold-start skill 有 quay-topology 调用但那是人/管理者调的 skill，不是 outer 自动。

**设计要点（管理者 + 外层采纳）**：
① outer 启动后先环境自检：inner 窗口存在？窗口有活 claude？（判据：进程存在 + transcript 有真实 user 消息，不用 pane 哈希/heartbeat）
② 缺失 ⇒ 调 quay-topology.sh 工厂建窗口 + 用 checked-in 启动命令（launch-config 已落地 .claude/launch.settings.json + quay-launch.sh）
③ 创建后走 cold-start INNER-DRIVEN 判据验证送达（transcript user message），不假设成功
④ 幂等：已存在且健康不重复创建（单飞——loop-driver 双触发教训）

**与生命视角**：quay 从「需要外部助产」变成「能自己长出器官」——outer 已存在，inner 是它该自己分化的。当前 inner 靠外部（人或管理者）植入，繁殖到新主机时最脆弱（B 机就停在这一步）。

### 选定机制

1. orchestrator-loop-tick 冷启动第 3 步改为**自检**：inner 窗口 + claude 进程存在？缺失 ⇒ 调 quay-topology.sh 创建
2. 自检判据：进程存在 + transcript 有真实 user 消息（不用 pane 哈希/heartbeat）
3. 创建后 INNER-DRIVEN 验证送达（transcript user message）
4. 幂等：已存在且健康不重复创建
5. 与 session-topology skill 分工：skill 提供工厂（quay-topology.sh），outer 调用它（冷启动自检）

## Acceptance Criteria

- [ ] AC1: outer 冷启动第 3 步自检 inner（窗口存在 + 活 claude + transcript 有 user 消息）——缺失则判「需创建」
- [ ] AC2: 缺失时调 quay-topology.sh 创建三窗口 + 起 inner claude（checked-in 启动命令）
- [ ] AC3: 创建后 INNER-DRIVEN 验证送达（transcript 出现 user 消息，不假设成功）
- [ ] AC4: 幂等——已存在且健康不重复创建（负控制：健康 inner 不重建）
- [ ] AC5: 与 session-topology skill + cold-start + launch-config 交叉标注（分工）

## Touches

- plugin/loop/orchestrator-loop-tick.md（冷启动第 3 步自检 + 创建）
- plugin/skills/cold-start/SKILL.md（如涉及）
- plugin/scripts/quay-topology.sh（工厂，已存在——outer 调用它）
- plugin/scripts/topology-check.sh（自检，已存在）
- tasks/gap-tmux-session-topology-no-factory-definition.md（AC5 交叉标注）
- tasks/gap-crystallize-launch-config-into-checked-in-settings-file.md（AC5 交叉标注）

## Contract

measure   outer_self_check = `bash plugin/scripts/topology-check.sh --session <s> --json 2>&1 | grep -c '"ok": true'` stdout 数字段（outer 冷启动后）
band      outer_self_check = 1（拓扑在合适位置）
invoke    `grep -n 'topology\|inner\|自检' plugin/loop/orchestrator-loop-tick.md`
control   inner 缺失 ⇒ outer 自检创建（AC2）；inner 健康 ⇒ 不重建（AC4 幂等）
resume    自检接入与创建流程分步提交，任一步完成即写盘