---
id: gap-manager-productization-five-constraints
title: "manager productization (C1-C5, SPEC-manager-productization-2026-08-05):
  C1 plugin/ + npm pack must contain manager; C2 manager's home/state/identity
  must NOT belong to any single project (current instance lives in quay-0:manager
  cwd=/home/yale/work/quay — violates C2/C3); C3 outer NEVER creates/drives/
  checks manager (mechanical grep check, currently 0 mentions in tick doc);
  C4 independent cold start (quay manager start, accepts NO project args);
  C5 two commands separated (manager start ≠ manager adopt; AC12b testability:
  'adopt 之后 manager 对该项目动作次数=0'); SHARPEST GAP: manager not in
  os-anchor-projects.conf + */17 heartbeat is session-only CronList = the
  watchdog has NO ONE watching it, 4 crashes tonight needed human restart
  (direct manifestation); RULED: dual-creator conflict = option ① whoever
  finds missing inner creates via SAME idempotent entry (quay-topology.sh +
  single-flight lock), NOT centralized to manager — shipped quay = outer+inner,
  manager optional, centralizing kills single-project self-healing (contradicts
  'manager for cross-project'); split: manager-phase-goal.md product-behavior
  (axis-open/verification-first/boundary) → plugin/loop/manager-loop-tick.md,
  experiment state stays orchestration/"
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**manager 产品化——人给五条约束，管理者写成规格（SPEC-manager-productization-2026-08-05），外层裁定立案。**

**当前实例违反四条（实测，非设计讨论）**：tmux 位置 quay-0:manager（在 quay 会话里）、cwd=/home/yale/
work/quay、transcript 在 quay 目录、目标文档签入 quay 仓库、plugin/loop/ 无 manager 文档——C1/C2/C3
各违反。唯一没违反的是 C3 一半（quay-topology.sh 已改 ROLES="outer inner"）。

**最尖锐缺口（§2.1，外层实测确认）**：`os-anchor-projects.conf` 只看护 quay/meta-cc/archguard 的 outer，
**manager 不在名单**；其 */17 心跳 CronList 显示 [session-only]。**看门人自己无人看门**——会话一死心跳
无声消失，今晚四次全灭都靠人重启 manager，是这条缺口的直接表现。

**外层已裁定（§7 双创建者冲突）**：选 **选项①**——谁发现缺失谁创建，但走**同一幂等入口 + 锁**
（quay-topology.sh 加单飞锁）。不选②（创建权收归 manager）：shipped quay = outer+inner、manager 可选，
收归后不装 manager 的单项目用户失去自愈能力，与「manager 通常用于跨项目」矛盾。

**外层已裁定（§6 切分）**：manager-phase-goal.md 混装——产品侧 manager 行为（AC10 开轴 / AC11 验证先被
验证 / 边界纪律）按「动词留文本」进 `plugin/loop/manager-loop-tick.md`；本实验阶段状态（测什么/B 机怎么用/
archguard 排位）留 `orchestration/`。

**外层已裁定（§3 归属）**：建造 = quay outer/inner（manager 是 quay 产品组件）；运行 = 人或 OS 锚，
**绝不是 outer**。`orchestrator-loop-tick.md` 不得出现创建/驱动/检查 manager 的步骤——**机械检查**（当前
0 提及，自然通过；做 checker 防回归）。

**manager 越界机械信号（§5）**：manager 需要新观测/判定能力 ⇒ 产出应是转给外层的需求，不是自己写脚本；
manager 手里出现 .sh/.ts 实现即越界信号。

### 选定机制

1. `quay manager start`（无项目参数）：独立 session（quay-manager）+ $QUAY_GLOBAL_DIR/manager/ 家 +
   自己的 systemd unit（与项目 watchdog 分开）+ 观测器由 start 挂 + 心跳非会话作用域
2. `quay manager adopt <root>`：三态复用 inner-session-check.sh 判定（healthy/empty-shell/missing，
   **不写第二份**）——已活 noop / 空壳驱动 / 缺失调 quay-topology.sh 建两窗口 + 登记 OS 锚看护名单
3. 双创建者：谁发现缺失谁创建，quay-topology.sh 加单飞锁（原子创建）
4. 机械检查：grep 断言 orchestrator-loop-tick.md + plugin/loop 模板无创建/驱动/检查 manager 步骤
5. 验证：离乳判据——只有 git+claude 的机器，manager start + adopt 两项目，杀 manager 会话 ⇒ OS 锚
   拉回，两项目不受影响

## Acceptance Criteria

- [ ] AC1 (C4/C5): `quay manager start`（无项目参数）独立拉起 manager + `quay manager adopt <root>`
      三态复用 inner-session-check.sh（不写第二份判定）
- [ ] AC2 (C2): manager 家/身份迁出 quay 项目——独立 session + $QUAY_GLOBAL_DIR/manager/ +
      自己的 systemd unit（与项目 watchdog 分开）
- [ ] AC3 (C1): plugin/ + npm pack 产物含 manager（build 归属 outer/inner）
- [ ] AC4 (C3): 机械检查——orchestrator-loop-tick.md 与 plugin/loop 模板无创建/驱动/检查 manager 步骤
      （grep checker 接 static checks）
- [ ] AC5 (§2.1): manager 有持久锚——OS 锚看护名单含 manager 或独立 unit；manager 会话死 ⇒ 自动恢复，
      **不靠人重启**（对照今晚四次全灭）
- [ ] AC6 (裁定①): quay-topology.sh 单飞锁——双创建者竞态不会双重创建（原子创建实测）
- [ ] AC7 (C5 可测性): `manager adopt` 之后 manager 对该项目动作次数 = 0（AC12b 操作定义）
- [ ] AC8 (离乳判据): 裸机 manager start + adopt 两项目 + 杀 manager 会话 ⇒ OS 锚恢复，两项目不受影响
- [ ] AC9 (§6 切分): manager-phase-goal.md 拆开——产品行为进 plugin/loop/manager-loop-tick.md，
      实验状态留 orchestration/

## Touches

- plugin/scripts/（manager start/adopt 命令、quay-topology.sh 单飞锁、无-manager-tick-doc checker）
- plugin/loop/manager-loop-tick.md（新建，产品侧 manager 行为）
- orchestration/manager-phase-goal.md（切分）
- packages/quay/bin/（若 manager 命令走 quay CLI 入口）
- orchestration/SPEC-manager-productization-2026-08-05.md（规格引用）

## Contract

measure   manager_start = `quay manager start 2>&1 | grep -c 'quay-manager\|started'` stdout 数字段
band      manager_start >= 1（独立 session 可起）
invoke    `grep -n 'manager' orchestration/orchestrator-loop-tick.md`（期望 0 命中，AC4）
control   双创建者并发调 quay-topology.sh ⇒ 恰一次创建（AC6）；adopt 后动作次数=0（AC7）
resume    命令/锚/检查分步提交：start 可起 → adopt 三态 → 锚落位 → 机械检查接线，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T16:5xZ
changed: 外层按 SPEC 裁定立案——三裁定（①谁发现谁创建+锁 / manager-phase-goal 切分 / 建造=outer+inner
运行=人或OS锚）写入本任务；os-anchor 缺口外层独立核实（os-anchor-projects.conf 无 manager、watchdog unit
仅 quay-os-anchor）确认成立；tick 文档 manager 提及当前 0（manager-topology 修复已清，机械检查自然通过）。
