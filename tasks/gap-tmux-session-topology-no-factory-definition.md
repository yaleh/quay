---
id: gap-tmux-session-topology-no-factory-definition
title: the tmux session/window topology (<project>-N:outer / :inner / :manager
  three-window structure) has NO factory definition in plugin/loop or
  plugin/skills — the human-built meta-cc-3 / archguard-4 sessions measured to
  have ONLY a single bash window, no claude process; ship the three-window
  convention (each layer's launch command, who drives whom) as a checked-in
  deliverable + quay-init lays it down
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`SPEC-complete-delivery-surface-2026-08-05.md` 四类交付面第 4 类——**会话拓扑全缺**。实测：`plugin/loop/`、
`plugin/skills/` 无 `:outer`/`:inner`/`:manager` 命名约定；人手工建的 `meta-cc-3`/`archguard-4`
实测**只有单个 bash 窗口、无 claude 进程**。

**后果**：三窗口结构（每层起什么命令、谁驱动谁、如何挂监视器/cron）没有出厂定义——冷启动得靠人手工
拼（今晚 meta-cc-3/archguard-4 就是手工建的，结构不一致）。

### 选定机制

**把三窗口会话拓扑写出厂定义 + 随交付铺**：

1. **拓扑文档**：在交付物里定义 `<project>-N:outer` / `:inner` / `:manager` 三窗口结构——每层起什么
   命令（outer = claude-deepseek + 三件套 + cron 挂载；inner = 等驱动的 claude 会话；manager = 观察者）、
   谁驱动谁（outer 驱动 inner 经 send-keys；manager 观察 + 转达）、每层挂什么（监视器/cron/重锚）。
2. **quay-init 铺拓扑**：冷启动时按定义建三窗口（不再是手工拼、结构不一致）。
3. **校验**：AC8c 六键的 MONITORS-MOUNTED 之外，加「三窗口拓扑在位」检查（每层有对应 claude 进程，
   不是单 bash 窗口）。

**与 cold-start 的关系**：cold-start SKILL.md 教的是「循环启动」；本条补「会话拓扑」——两者一起才是
「装得上」。

## Acceptance Criteria

- [ ] AC1: 三窗口拓扑出厂定义在交付物里（`<project>-N:outer/:inner/:manager`：每层命令、谁驱动谁、
      每层挂什么）——plugin/skills 或 plugin/loop 下可读
- [ ] AC2: quay-init 铺三窗口拓扑（冷启动按定义建，不再手工拼）
- [ ] AC3: 校验——「三窗口在位」检查（每层有对应 claude 进程，非单 bash 窗口；meta-cc-3/archguard-4
      场景不再出现）
- [ ] AC4: 与 cold-start 交叉标注（SKILL 教循环启动，本条教会话拓扑，一起才是装得上）
- [ ] AC5: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC3 实测输出贴任务体
- [ ] 三窗口拓扑出厂定义 + 铺设 + 校验；冷启动不靠手工拼
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/skills/（或 plugin/loop/）：三窗口拓扑定义（new 或并入 cold-start/init skill）
- plugin/skills/cold-start/SKILL.md（AC4 交叉标注 + 铺设接线）
- plugin/test/（AC3 校验断言）

## Contract

measure   topology_windows = `grep -c 'outer\|inner\|manager' <拓扑定义文件>` stdout 数字段
band      topology_windows >= 3（三窗口都定义）
invariant three_window_shipped = 1（拓扑定义在 plugin/ 随交付，非 quay 本地）
invoke    `grep -rn ':outer\|:inner\|:manager' plugin/skills/`
control   单 bash 窗口（无 claude）⇒ 校验必报缺；三窗口在位 ⇒ 通过（AC3）
resume    拓扑定义与铺设分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T06:1xZ
changed: 外层读 SPEC 四类交付面第 4 类裁定立案。四处收紧：
(1) **出厂定义**——三窗口结构写进交付物（每层命令/谁驱动谁/每层挂什么），不靠人手工拼；
(2) **铺设**——quay-init 按定义建三窗口；
(3) **校验**——「三窗口在位」检查（每层有 claude 进程，非单 bash；meta-cc-3/archguard-4 场景消除）；
(4) **与 cold-start 一起才是装得上**——SKILL 教循环启动，本条教会话拓扑。
status: todo——四类交付面第 4 类；排 delivery-surface umbrella 后。
