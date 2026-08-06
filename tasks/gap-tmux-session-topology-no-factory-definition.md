---
id: gap-tmux-session-topology-no-factory-definition
title: the tmux session/window topology (<project>-N:outer / :inner / :manager
  three-window structure) has NO factory definition in plugin/loop or
  plugin/skills — the human-built meta-cc-3 / archguard-4 sessions measured to
  have ONLY a single bash window, no claude process; ship the three-window
  convention (each layer's launch command, who drives whom) as a checked-in
  deliverable + quay-init lays it down
status: done
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

**拓扑修正（交叉标注：gap-manager-baked-into-project-topology-factory，2026-08-05 已落地）**：本条
原定的三窗口（manager/outer/inner）拓扑中，**manager 不属于项目拓扑**——它是跨项目的、由人另行启动。
出厂定义已修正为**两窗口（outer+inner）**：`quay-topology.sh` ROLES="outer inner"、`topology-check.sh`
判据只查两窗口、`session-topology/SKILL.md` 从拓扑表移除 manager（注明跨项目另行启动）。本条的 AC 记录
三窗口为原始交付形态，修正以 gap-manager-baked 任务为准。

**消费方交叉标注（gap-outer-self-checks-and-creates-inner-session，2026-08-05）**：外层冷启动第 3 步
自检 inner 三态（健康/空壳/缺失），缺失时调用本条的工厂 `quay-topology.sh` 创建**两窗口**拓扑
（outer+inner，无 manager 窗口）——即「会话拓扑」的消费者已从 cold-start skill 延伸到外层 tick 文档，
同一次改动两面。

## Acceptance Criteria

- [x] AC1: 三窗口拓扑出厂定义在交付物里（`<project>-N:outer/:inner/:manager`：每层命令、谁驱动谁、
      每层挂什么）——plugin/skills 或 plugin/loop 下可读
      落地：`plugin/skills/session-topology/SKILL.md`（new）——三窗口拓扑的出厂定义。顶层表定义
      每层：launch command（`quay-launch.sh <role>`，从检查进仓库的 `.claude/launch.settings.json`
      读启动参数）、Drives / Is driven by（outer 经 send-keys 驱动 inner；manager 观察 + 转达）、
      Mounts（outer: session-liveness 监视器 + 20-min cron + 重锚；manager: 多目标 observer +
      `.halt` 仲裁；inner: `.workflow-events/` 工作产物）。窗口按名字寻址（session-launch-recipes §3），
      顺序 manager=0 / outer=1 / inner=2（与 quay-0 实测布局一致）。
      Contract 证据：`grep -c 'outer\|inner\|manager' plugin/skills/session-topology/SKILL.md` → **12** ≥ 3；
      `grep -rn ':outer\|:inner\|:manager' plugin/skills/` → 命中 session-topology（3 行）+ cold-start（1 行）。
- [x] AC2: quay-init 铺三窗口拓扑（冷启动按定义建，不再手工拼）
      落地：`plugin/scripts/quay-topology.sh`（new，三窗口工厂——按定义建/补/重拉窗口，幂等，`--dry-run`
      校验）+ `plugin/scripts/topology-check.sh`（new，在位校验）。两者被 cold-start / session-topology
      skill 引用，quay-init `--loop` 的 DERIVED_SCRIPTS 机制自动铺进目标项目（referenced ⊆ landed，
      init/SKILL.md 已记录该铺设）。冷启动按定义建三窗口，不再手工拼。
      实测：temp 项目 `quay-init --loop` 后
      `plugin/scripts/{quay-topology.sh, topology-check.sh, quay-launch.sh}` 均落地且与 plugin 源**逐字节一致**。
- [x] AC3: 校验——「三窗口在位」检查（每层有对应 claude 进程，非单 bash 窗口；meta-cc-3/archguard-4
      场景不再出现）
      落地：`plugin/scripts/topology-check.sh` —— 每窗口存在 **且** 有 claude 进程才算 ok；缺窗口报
      `missing`，窗口在但无 claude 报 `no-claude`。正/负/混合三控制（hermetic tmux，`exec -a claude-probe`
      造 claude 子进程）：
      ```
      $ bash plugin/scripts/topology-check.sh --session quay-0 --json     # 真实三窗口全在
      {"session": "quay-0", "ok": true, "windows": {"manager": "ok", "outer": "ok", "inner": "ok"}}   exit 0
      # 负控制：单 bash 窗口（meta-cc-3/archguard-4 失败形态）
      {"session": "topo-neg", "ok": false, "windows": {"manager": "missing", "outer": "missing", "inner": "missing"}}   exit 1
      # 混合控制：三窗口但 outer 是裸 bash（无 claude）
      {"session": "topo-mix", "ok": false, "windows": {"manager": "ok", "outer": "no-claude", "inner": "ok"}}   exit 1
      ```
      （quay-0 实测为真会话真 claude；负/混合为 hermetic 私有 socket 上构造，kill-session 清理，无泄漏。）
- [x] AC4: 与 cold-start 交叉标注（SKILL 教循环启动，本条教会话拓扑，一起才是装得上）
      落地：`plugin/skills/cold-start/SKILL.md` —— AC8c 六键清单加第 7 键 `TOPOLOGY-IN-PLACE`（
      `topology-check.sh --json` 报 `ok: true` 才算过；单 bash 窗口必须报 `ok: false`）；新步骤 2「Build
      and verify the three-window session topology」——`quay-topology.sh` 建 + `topology-check.sh` 验，
      显式引用 `session-topology` skill（会话拓扑是「装得上」的另一半）。
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`
      落地：`plugin/test/session-topology.test.mjs`（`// @test-group governance`，8 用例）——AC1 定义
      shipped + measure/invoke、AC2 铺设逐字节、AC3 正/负/混合三控制、AC4 cold-start 交叉标注、工厂
      dry-run + 实建。
      `node --test plugin/test/session-topology.test.mjs` → `pass 8 / fail 0 / cancelled 0`。

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC3 实测输出贴任务体
- [ ] 三窗口拓扑出厂定义 + 铺设 + 校验；冷启动不靠手工拼
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-tmux-session-topology-no-factory-definition.md（自身文件：勾 AC + 贴 invoke 证据授权）
- plugin/skills/session-topology/SKILL.md（new：三窗口拓扑出厂定义）
- plugin/scripts/quay-topology.sh（new：三窗口工厂）
- plugin/scripts/topology-check.sh（new：三窗口在位校验）
- plugin/scripts/capability-catalog.sh（新增 5 条声明：quay-topology / topology-check / quay-launch / tmux-leak-scan / loop-shipping-exclusion-data）
- plugin/skills/cold-start/SKILL.md（AC4 交叉标注 + 步骤 2 拓扑建/验接线）
- plugin/skills/init/SKILL.md（铺设说明：拓扑机件随 --loop 落地）
- plugin/test/session-topology.test.mjs（new：AC3/AC5 断言）
- plugin/test/cold-start-skill.test.mjs（AC8c 六键 → 七键断言更新）
- plugin/test/plugin-packaging.test.mjs（bundled skills 11 → 12 断言更新）
- plugin/.claude-plugin/plugin.json（注册 session-topology skill）

## Test-Files

- plugin/test/session-topology.test.mjs

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
