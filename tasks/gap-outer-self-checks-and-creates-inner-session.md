---
id: gap-outer-self-checks-and-creates-inner-session
title: "outer should self-check env and create tmux windows / start inner
  session (human product requirement — cold-start precondition 3 'inner
  reachable' drives but doesn't create; adopter must hand-build 3 windows;
  session-topology factory exists + cold-start references it, but outer doesn't
  auto-call; fix: outer cold-start step 3 self-checks inner (process +
  transcript) and calls quay-topology.sh when missing, idempotent)"
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
outer 要能识别并接受。**两窗口拓扑已落地（交叉标注：gap-manager-baked-into-project-topology-factory，
2026-08-05 已修正）**——`quay-topology.sh` ROLES="outer inner"、`topology-check.sh` 判据只查两窗口，
本任务 AC4 的「缺失 ⇒ 调 quay-topology.sh 创建两窗口（outer+inner）」即以该出厂定义为准，无 manager
窗口。

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

- [x] AC1: outer 冷启动第 3 步自检 inner（窗口存在 + 活 claude + transcript 有 user 消息）——三态判定（健康/空壳/缺失）
      落地：`plugin/loop/orchestrator-loop-tick.md` 冷启动第 3 步由「找到内层会话」改为「自检内层会话（三态处理）」——
      新增机械自检 `plugin/scripts/inner-session-check.sh`（`--json` 输出 `{state: healthy|empty-shell|missing, window, process, transcript, transcriptFresh}`）。
      验证：`node --test plugin/test/inner-session-check.test.mjs` → 10/10 通过（含 AC1 文档断言 + 三态状态机测试）
      `bash plugin/scripts/inner-session-check.sh --session measure-0 --transcript <fresh> --json` → `{"window":true,"process":true,"transcriptFresh":true,"state":"empty-shell"}`
- [x] AC2: **权限边界**——健康（窗口+进程+user 消息）⇒ 什么都不做，直接驱动流程，不重建/不重启/不改参数（负控制：健康 inner 不被动）
      落地：tick doc 第 3 步 `healthy` 行「什么都不做（权限边界——已存在的 inner 可能是 manager 建的，外层无权判断/重建/改参数），直接进入正常驱动流程」+ 分派节「不重建、不重启、不改启动参数（权限边界，负控制：健康 inner 不被动）」。
      验证：`node --test plugin/test/inner-session-check.test.mjs` → `AC2 — the tick doc treats a healthy inner as 'do nothing, proceed to drive' (permission boundary)` PASS；状态机 healthy 测试（窗口+进程+user 消息 ⇒ healthy，不动）PASS
- [x] AC3: **中间态驱动**——空壳（窗口+进程，无 user 消息）⇒ 驱动而非重建（负控制：11:40 watchdog 形态被接手驱动，不丢上下文）
      落地：tick doc 第 3 步 `empty-shell` 行「驱动而非重建——不丢可能已有的上下文，接手 manager 预建的会话」+ 分派节「send-keys-reliable 驱动（transcript 验证送达）」。
      验证：状态机 empty-shell 测试（窗口+进程，system-only transcript 或无 transcript ⇒ empty-shell）PASS
- [x] AC4: 缺失（无窗口或无进程）⇒ 调 quay-topology.sh 创建**两窗口**（outer+inner）+ 起 inner claude（checked-in 启动命令），无 manager 窗口
      落地：tick doc 第 3 步 `missing` 行「调 quay-topology.sh 创建两窗口拓扑 + 起 inner claude（checked-in launch 命令），然后驱动 inner」+ 分派节（quay-topology.sh + topology-check.sh 验证）。
      验证：`grep -n 'ROLES="outer inner"' plugin/scripts/quay-topology.sh plugin/scripts/topology-check.sh` 各 1 处、无 manager；hermetic 工厂建两窗口后
      `bash plugin/scripts/topology-check.sh --session measure-0 --json 2>&1 | grep -c '"ok": true'` → `1`（Contract measure 达标）；`node --test plugin/test/inner-session-check.test.mjs` 的 factory 测试（建 outer+inner、无 manager）PASS
- [x] AC5: 创建后 INNER-DRIVEN 验证送达（transcript 出现 user 消息，不假设成功）
      落地：tick doc 第 3 步分派节「创建后 INNER-DRIVEN 验证送达：transcript 出现真实 user 消息（send-keys-reliable 的 transcript-delivery-check.ts 判据），不假设成功」。
      验证：`node --test plugin/test/inner-session-check.test.mjs` → `AC5 — the tick doc verifies the inner drive via the transcript (never assumed success)` PASS
- [x] AC6: **与 manager 分工**——manager 预建的会话被 outer 接手驱动（不推倒重来）；manager 与 outer 可并行不互相破坏
      落地：tick doc 第 3 步健康/空壳两行分别覆盖「manager 建好且已驱动 ⇒ 不动（权限边界）」与「manager 预建未驱动 ⇒ 接手驱动不重建」。
      验证：状态机 healthy 测试（manager 建好+驱动过 ⇒ healthy 不动）+ empty-shell 测试（manager 预建未驱动 ⇒ empty-shell 驱动不重建）PASS
- [x] AC7: 与 session-topology skill + cold-start + launch-config + manager-topology 任务交叉标注（同一次改动两面）
      落地：`plugin/skills/session-topology/SKILL.md` 既有「A pre-existing manager-built session is accepted by the outer without being rebuilt; see gap-outer-self-checks-and-creates-inner-session」；
      `plugin/skills/cold-start/SKILL.md` 步骤 2 新增三态自检交叉标注；`tasks/gap-manager-baked-into-project-topology-factory.md` AC4 已交叉标注本任务；
      `tasks/gap-tmux-session-topology-no-factory-definition.md` 与 `tasks/gap-crystallize-launch-config-into-checked-in-settings-file.md` 新增本任务交叉引用。
      验证：`grep -rn 'gap-outer-self-checks-and-creates-inner-session' plugin/skills/ tasks/` 命中 session-topology SKILL + cold-start SKILL + manager-baked + topology-no-factory + launch-config

## Touches
- tasks/gap-outer-self-checks-and-creates-inner-session.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/loop/orchestrator-loop-tick.md（冷启动第 3 步自检 + 三态处理）
- plugin/skills/cold-start/SKILL.md（AC7 交叉标注：三态自检与 build-by-definition 同面）
- plugin/scripts/quay-topology.sh（工厂，已存在——outer 调用它；两窗口）
- plugin/scripts/topology-check.sh（自检，已存在）
- plugin/scripts/inner-session-check.sh（新增：三态自检机制）
- plugin/test/inner-session-check.test.mjs（新增：三态状态机 + 文档断言测试）
- tasks/gap-manager-baked-into-project-topology-factory.md（AC7 交叉标注）
- tasks/gap-tmux-session-topology-no-factory-definition.md（AC7 交叉标注）
- tasks/gap-crystallize-launch-config-into-checked-in-settings-file.md（AC7 交叉标注）

## Test-Files
- plugin/test/inner-session-check.test.mjs（三态自检机制 + 文档 AC1-AC6 断言）
- plugin/test/session-topology.test.mjs（两窗口拓扑工厂/检查回归，AC4 同面）

## Contract

measure   outer_self_check = `bash plugin/scripts/topology-check.sh --session <s> --json 2>&1 | grep -c '"ok": true'` stdout 数字段（outer 冷启动后）
band      outer_self_check = 1（拓扑在合适位置）
invariant healthy_inner_untouched = 1（健康 inner 不被 outer 动——权限边界）
invoke    `grep -n 'topology\|inner\|自检' plugin/loop/orchestrator-loop-tick.md`
control   inner 健康 ⇒ 不动（AC2）；空壳 ⇒ 驱动不重建（AC3）；缺失 ⇒ 创建两窗口（AC4）
resume    自检接入 + 三态处理分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T16:3xZ
changed: 管理者优先级裁定（遗传物质级拓扑修复的后续）：manager-baked（two-window 拓扑修复）落地后用
新拓扑定义实现本任务——outer 自检 + 按三态（健康/空壳/缺失）处理 inner 会话。与
gap-manager-baked-into-project-topology-factory 交叉标注（新拓扑 ROLES='outer inner'）。
status: todo——排在 manager-baked 落地后。