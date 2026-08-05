---
id: gap-manager-baked-into-project-topology-factory
title: "manager baked into project topology factory (hereditary error — manager
  is cross-project not per-project): quay-topology.sh + topology-check.sh
  ROLES='manager outer inner', SKILL.md 13x three-window; adopter building via
  factory gets a manager window contradicting product-outline 'manager
  network-level not per-project'; fix: ROLES='outer inner', two-window, manager
  removed (human starts cross-project)"
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

**manager 固化进项目拓扑——出厂定义的结构性错误（管理者紧急更正 + 外层核实）**：

**人的更正**：manager 是**跨项目**的，outer 不该管。上一条设计要求「三窗口」措辞错误——outer 自举只
关心 **outer + inner 两窗口**，manager 不属于项目拓扑，由人跨项目另行启动。

**错误已固化进交付物（实测三处）**：
(a) plugin/skills/session-topology/SKILL.md：description「three-window」+ 9/15/20/26 行反复 three-window
+ manager 列一行；
(b) plugin/scripts/quay-topology.sh：第 4 行注释、ROLES="manager outer inner"（64）、97-101「会话不存在
⇒ 从零建：第一个窗口（manager）即会话首窗」、115 行 manager 特殊处理；
(c) plugin/scripts/topology-check.sh：ROLES="manager outer inner"（67）。

**矛盾**：任何采用者跑工厂会被建出 manager 窗口，而 manager 是 network 级非 per-project——与产品轮廓
文档「manager 跨项目，network 级，非 per-project——不随项目冷启动」直接矛盾。

**严重性（生命视角）**：进入遗传物质的错误——不是运行时故障，是出厂定义结构性错误，随每次繁殖完整
复制到下一项目/主机。B 机手工建 quay-b 恰好两窗口（对），交付物却是错的——「亲代环境掩盖亲代缺陷」。

**优先级（管理者裁定）**：**遗传物质级先于产品主流程**——每繁殖一次复制一次，topology-check 是正在
生效的假判据（把正确两窗口项目判不合规）。修复成本小（ROLES 一行 + 文档措辞），但放着不修每个新采用者
都拿错的出厂定义。outer 自举（gap-outer-self-checks）随后（新增能力，不修不污染既有交付物）。

**修法（管理者建议 + 外层采纳）**：
1. ROLES 改为 "outer inner"；SKILL.md 与脚本注释所有 three-window 改 two-window
2. manager 从拓扑定义**完全移除**——若需说明，单独写「manager 由人跨项目另行启动，不属于项目拓扑」
3. topology-check.sh 判据同步改（否则把正确两窗口项目判为不合规——正在生效的假判据）

### 选定机制

1. quay-topology.sh：ROLES="outer inner"，删 manager 特殊处理（首窗/跳过逻辑），注释 two-window
2. SKILL.md：three-window → two-window，manager 从拓扑表移除（注明跨项目另行启动）
3. topology-check.sh：ROLES="outer inner"，判据只查两窗口
4. 验证：工厂建出两窗口（outer+inner），无 manager；topology-check 对两窗口项目报 ok

## Acceptance Criteria

- [ ] AC1: quay-topology.sh ROLES="outer inner"，建出两窗口（outer+inner），无 manager 窗口（实测）
- [ ] AC2: SKILL.md three-window → two-window，manager 从拓扑移除（注明跨项目另行启动）
- [ ] AC3: topology-check.sh 判据只查两窗口——对正确两窗口项目报 ok（负控制：当前会报不合规）
- [ ] AC4: 与产品轮廓「manager 跨项目」一致 + outer-self-check 任务（只创建 inner）交叉标注

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] quay-topology.sh 实测建出两窗口（outer+inner），无 manager 窗口（实跑输出贴任务体）
- [ ] topology-check.sh 对两窗口项目报 ok（实跑输出贴任务体；负控制：当前会报不合规）
- [ ] SKILL.md / 脚本注释无 three-window 残留（grep 证明）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-manager-baked-into-project-topology-factory.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/quay-topology.sh（ROLES 改 outer inner + 删 manager 逻辑）
- plugin/skills/session-topology/SKILL.md（two-window + manager 移除）
- plugin/scripts/topology-check.sh（判据同步）
- plugin/test/（对应测试）
- tasks/gap-outer-self-checks-and-creates-inner-session.md（AC4 交叉标注）
- tasks/gap-tmux-session-topology-no-factory-definition.md（AC4 交叉标注）

## Contract

measure   topology_roles = `grep -o 'ROLES="[^"]*"' plugin/scripts/quay-topology.sh plugin/scripts/topology-check.sh | tr '\n' ' '` stdout 文本段
band      topology_roles = 'ROLES="outer inner" ROLES="outer inner"'（两脚本都是两窗口）
invariant project_topology_has_no_manager = 1（项目拓扑定义不含 manager——manager 由人跨项目启动）
invoke    `grep -n 'ROLES\|manager\|three-window\|two-window' plugin/scripts/quay-topology.sh plugin/scripts/topology-check.sh plugin/skills/session-topology/SKILL.md`
control   当前形态（ROLES="manager outer inner"）⇒ 建三窗口；修后 ⇒ 两窗口（AC1）
resume    两脚本 ROLES 与 SKILL.md 分步提交，任一步完成即写盘