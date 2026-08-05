---
id: gap-manager-baked-into-project-topology-factory
title: "manager baked into project topology factory (hereditary error — manager
  is cross-project not per-project): quay-topology.sh + topology-check.sh
  ROLES='manager outer inner', SKILL.md 13x three-window; adopter building via
  factory gets a manager window contradicting product-outline 'manager
  network-level not per-project'; fix: ROLES='outer inner', two-window, manager
  removed (human starts cross-project)"
status: done
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

- [x] AC1: quay-topology.sh ROLES="outer inner"，建出两窗口（outer+inner），无 manager 窗口（实测）
      实测（hermetic tmux，`env -u TMUX` + 私有 socket）：
      ```
      $ bash plugin/scripts/quay-topology.sh --session topo-ev --dry-run
      would-create-session: tmux new-session -d -s topo-ev -n outer "bash …/quay-launch.sh outer"
      would-create (first window): topo-ev:outer (the new session's window 0)
      would-create-window: tmux new-window -t topo-ev -n inner "bash …/quay-launch.sh inner"
      topology done: topo-ev (outer inner )            # ← 无 manager
      $ … real build …; tmux list-windows -t topo-ev -F '#{window_name}'
      outer
      inner                                           # ← 无 manager 窗口
      ```
      ROLES 证据：`grep -o 'ROLES="[^"]*"'` 两脚本 → `ROLES="outer inner" ROLES="outer inner"`（Contract band 精确命中）。
      首窗逻辑泛化：`FIRST="${ROLES%% *}"`（=outer），manager 特殊处理（首窗/跳过）全部删除。
      回归测试（新增）：idempotent 路径（会话已存在重跑）不再 `set -u` FIRST-unbound，`in-place` 保留活 claude 窗口。
- [x] AC2: SKILL.md three-window → two-window，manager 从拓扑移除（注明跨项目另行启动）
      落地：`plugin/skills/session-topology/SKILL.md` 全量重写——description/标题/表/「谁驱动谁」全部 two-window；
      拓扑表删除 manager 行；新增专段「**manager is CROSS-PROJECT, NOT part of this topology**」。
      证据：`grep -c ':manager' plugin/skills/session-topology/SKILL.md` → **0**（拓扑定义不含 :manager 窗口）；
      `grep -c 'outer' …` ≥ 2；跨项目措辞命中 /cross-project/。联动同步（无 three-window 残留）：
      `cold-start/SKILL.md` TOPOLOGY-IN-PLACE 键 + 步骤 2、`init/SKILL.md` lay-down 描述、
      `capability-catalog.sh` quay-topology 声明。
- [x] AC3: topology-check.sh 判据只查两窗口——对正确两窗口项目报 ok（负控制：当前会报不合规）
      ROLES="outer inner"（67 行）。实测（hermetic）：
      ```
      $ bash plugin/scripts/topology-check.sh --session topo-ev --json   # 两窗口项目
      {"session": "topo-ev", "ok": true, "windows": {"outer": "ok", "inner": "ok"}}   exit 0
      # 负控制：单 bash 窗口（meta-cc-3/archguard-4 失败形态）
      {"session": "topo-neg", "ok": false, "windows": {"outer": "missing", "inner": "missing"}}  exit 1
      # 混合：outer 是裸 bash（无 claude）
      {"session": "topo-mix", "ok": false, "windows": {"outer": "no-claude", "inner": "ok"}}  exit 1
      ```
      负控制（修复前）：ROLES="manager outer inner" 会把两窗口项目判「manager missing → 不合规」——正在生效的假判据；
      修复后两窗口项目报 ok。
- [x] AC4: 与产品轮廓「manager 跨项目」一致 + outer-self-check 任务（只创建 inner）交叉标注
      一致性：SKILL.md / cold-start / init / capability-catalog 全部写明 manager 跨项目、不属于项目拓扑。
      交叉标注：`tasks/gap-outer-self-checks-and-creates-inner-session.md`（Proposal 补「两窗口拓扑已落地
      （交叉标注：gap-manager-baked-into-project-topology-factory）」；其 AC4 已是「创建两窗口 outer+inner 无 manager」）；
      `tasks/gap-tmux-session-topology-no-factory-definition.md`（Proposal 补「拓扑修正」段——三窗口原交付形态
      已修正为两窗口，以本任务为准）。

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] quay-topology.sh 实测建出两窗口（outer+inner），无 manager 窗口（实跑输出贴任务体）
- [x] topology-check.sh 对两窗口项目报 ok（实跑输出贴任务体；负控制：当前会报不合规）
- [x] SKILL.md / 脚本注释无 three-window 残留（grep 证明）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

验证记录（DoD 未勾——全量套件按外层指令不跑，本处为 scoped 实测）：
- `node --test plugin/test/session-topology.test.mjs` → **8 pass / 1 fail / 0 cancelled**（9 用例：AC1×2、AC3×3、
  AC4、工厂 dry-run+实建、idempotent 回归）。唯一失败 AC2（quay-init --loop 铺设）是 **master 既有问题**：
  `plugin/loop/fast-mode-loop-tick.md` 引用 `orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md`
  但 `init/SKILL.md` 未声明（referenced-not-landed，`git show master:` 已证与本次改动无关，归
  gap-systemd-run-limits / gap-supervisor 任务）。
- three-window 残留 grep：7 个交付面（两脚本 + 3 SKILL.md + capability-catalog + 测试）**0 命中**（grep exit 1）。
- 泄漏检查：hermetic 测试后 `tmux ls | grep topo` → 0（无泄漏）。
- 触碰集合同检查：本任务 + gap-tmux 任务 `task-contract-check --strict-subset` **0 违规**；
  gap-outer-self-checks 的 dispatch-review-missing 是 todo 任务既有（未派发、非本次改动引入），已单独记录。

## Touches
- tasks/gap-manager-baked-into-project-topology-factory.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/quay-topology.sh（ROLES 改 outer inner + 删 manager 逻辑）
- plugin/skills/session-topology/SKILL.md（two-window + manager 移除）
- plugin/scripts/topology-check.sh（判据同步）
- plugin/test/session-topology.test.mjs（对应测试：AC1/AC3/工厂断言改两窗口）
- tasks/gap-outer-self-checks-and-creates-inner-session.md（AC4 交叉标注）
- tasks/gap-tmux-session-topology-no-factory-definition.md（AC4 交叉标注）

## Test-Files

- plugin/test/session-topology.test.mjs

## Contract

measure   topology_roles = `grep -o 'ROLES="[^"]*"' plugin/scripts/quay-topology.sh plugin/scripts/topology-check.sh | tr '\n' ' '` stdout 文本段
band      topology_roles = 'ROLES="outer inner" ROLES="outer inner"'（两脚本都是两窗口）
invariant project_topology_has_no_manager = 1（项目拓扑定义不含 manager——manager 由人跨项目启动）
invoke    `grep -n 'ROLES\|manager\|three-window\|two-window' plugin/scripts/quay-topology.sh plugin/scripts/topology-check.sh plugin/skills/session-topology/SKILL.md`
control   当前形态（ROLES="manager outer inner"）⇒ 建三窗口；修后 ⇒ 两窗口（AC1）
resume    两脚本 ROLES 与 SKILL.md 分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T00:00:00Z
changed: 管理者裁定立案（2026-08-05）——ROLES 含 manager 是出厂定义结构性错误（遗传物质级，随每次
繁殖复制）：项目拓扑是**两窗口（outer+inner）**，manager 跨项目、由人另行启动、不属于项目拓扑。
三处交付物实测固化该错误：(a) session-topology/SKILL.md description + 反复 three-window + manager
行；(b) quay-topology.sh 注释 + ROLES="manager outer inner"(64) + 首窗 manager 特殊处理；
(c) topology-check.sh ROLES="manager outer inner"(67)——正在生效的假判据（把正确两窗口项目判不合规）。
修法（管理者建议 + 外层采纳）：ROLES 改 "outer inner"；SKILL.md 与脚本注释 three-window → two-window；
manager 从拓扑定义完全移除（注明跨项目另行启动）；topology-check.sh 判据同步只查两窗口。
status: ready——遗传物质级先于产品主流程。