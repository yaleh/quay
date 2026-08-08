---
id: gap-c3-has-no-runtime-constraint
title: C3（outer NEVER creates/drives/checks manager）只有文档层机械检查（AC4： grep 断言 tick
  文档与 plugin/loop 模板无创建/驱动/检查 manager 步骤，no-manager-tick-doc-check.ts） ——但文档里没写
  ≠ 运行时没做；运行时实际去 capture-pane/读 transcript/查 manager 记录不被任何判据覆盖； 08-07 09:03 外层
  task_write 分析 manager 行为立案属 C3 越界（已成立），暴露文档层 AC 管不住运行时行为； 同族：声明在（AC
  勾了）、保证没了（实际行为不受约束）——本仓反复出现的形状
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

**C3（outer NEVER creates/drives/checks manager）只有文档层机械检查，没有运行时约束。**

### 现状

`tasks/gap-manager-productization-five-constraints` AC4（已勾 [x]）的机械检查 =
`no-manager-tick-doc-check.ts`：grep 断言 `orchestrator-loop-tick.md` 与 `plugin/loop/` 模板
**无**创建/驱动/检查 manager 的步骤。

**但文档里没写 ≠ 运行时没做。** 这个检查只覆盖"tick 文档里有没有写这种步骤"，
覆盖不到"运行时实际去查了 manager"。

### 已发生实例（2026-08-08，管理者查证后部分成立）

管理者 06:2x 一度指控外层"观察/检查 manager"（依据一条转述 + `.quay/last-pane.txt` 文件存在），
随后用 meta-cc 查证撤回该指控（外层 05:00 后 12 条 capture-pane 调用零条指向 manager 窗口）。
**但其中一条确实越界**：08-07 09:03:38 外层 `task_write` 立了一条「分析 manager 周期性 tick-log 追加
行为」的任务——分析 manager 行为并立案，属 C3 的 "checks manager"。**这条成立。**

### 缺口形状

这正是本仓反复出现的形状：**声明在（AC 勾了）、保证没了（实际行为不受约束）**。
AC4 的机械检查只拦"文档写了越界步骤"，不拦"运行时真做了越界动作"。两者不是一回事。

### 范围

归属外层+内层机制设计。方向（设计决定，不预设）：
- 运行时约束怎么做（meta-cc 定时扫外层会话的 capture-pane/transcript 目标？git 审计 task_write 目标？
  还是日志留痕比对？）；
- 判据怎么定（什么算"checks manager"：读 manager 窗口 pane / 读 manager transcript / 读 manager
  tick-log / task_write 分析 manager 行为——逐类标注，避免再被"转述当证据"误伤）；
- 注意区分：C3 约束的是 outer→manager 方向；manager→outer 的发布与 single-flight 交付不属于此列。

## Contract

```
measure c3_runtime_violations = `node --no-warnings --experimental-strip-types plugin/scripts/manager-observation-runtime-check.ts --transcript <外层会话jsonl> --json | grep -o '"kind"' | wc -l` stdout 数字段
band c3_runtime_violations = 0（运行时无指向 manager 的观测/检查动作；四类判据见 AC1 设计说明）
invoke `node --no-warnings --experimental-strip-types plugin/scripts/manager-observation-runtime-check.ts --transcript <外层会话jsonl> --json`
control 负控制：指向 inner 的 capture-pane 不计数；manager→outer 的发布不计数（AC3）
resume 若中断，先跑 measure 确认当前运行时越界动作数，不要假设已修
```

## Acceptance Criteria

- [x] AC1: **运行时判据定义**——什么算"checks manager"（读 pane / 读 transcript / 读 tick-log /
      task_write 分析行为）逐类标注，写成设计说明贴任务体
      **设计说明（2026-08-08 落地，判据随实现定稿）**——四类判据，每类都是**真实 tool 调用**
      （AC3：散文/转述不当证据）。判据机械化为 `plugin/scripts/manager-observation-runtime-check.ts`
      的 `managerTargets` / `managerTickLogs` / `managerSessionIds` / `analysisVerbs` 配置：

      | 类 | 判据（什么算"checks manager"） | 机械签名 | 负控制（不计数） |
      |---|---|---|---|
      | PANE | 读 manager 窗口/会话的 pane | capture-pane / tmux list-panes / list-windows / display-message 的 `-t` 目标命中 manager 身份：窗口名 `manager`、独立会话 `quay-manager`（结构名，默认）；`0:0`/`0:0.0` 是当前实例面板，**layout 依赖、配置项不默认**（实测 08-02 该目标指向 inner，见下） | `-t quay-0:inner` / `-t "$TMUX_SESSION"`（会话级）/ `-t quay-0:outer-`；窗口名 `managerial` 等词边界外不命中 |
      | TICKLOG | 读 manager 的 tick-log | Read/Grep/Bash **直接读** `orchestration/manager-tick-log.md`；写文档的 heredoc 提到路径、write 重定向不算读 | `cat > ...manager-loop-tick.md`（写 manager 自己的文档）、读 `orchestration/tick-log.md`（外层/内层 tick-log） |
      | TRANSCRIPT | 读 manager 的会话 transcript | Read/Bash 读 `.claude/projects/.../<manager session id>.jsonl`——须配置 `managerSessionIds`（`--config`/`MANAGER_SESSION_ID`），**绝不猜**；无配置不匹配 | 读 inner/外层自己的 transcript |
      | ANALYZE | 建/改任务**分析 manager 行为** | task_write/taskWrite 的 title/body 含 manager 身份 token + 分析动词（分析/观察/审查/判定/行为/audit/inspect/…） | 建「manager 产品化」类任务（build 动词）；分析 inner 的任务 |

      **方向**：C3 约束 **outer→manager**。manager→outer 的**发布**（`supervisor-bus-identity.sh
      inbox-summary`、读 manager 的 inbox/bus/deliveries）是合法方向，不计数。
      **`0:0` 为什么配置不默认（实测证据）**：对真实外层会话 transcript 扫描时发现
      `capture-pane -t quay-0:0.0` 在 08-02 指向的是 **inner**（当时 inner 在窗口 0）——
      窗口编号随 layout 漂移，把 `0:0` 当默认会把指向 inner 的观测误报成 manager。结构名
      （`manager`/`quay-manager`）才是稳定判据；`0:0` 由操作者按当前拓扑显式配置。

- [x] AC2: **运行时约束落地**——外层运行时对 manager 的观测/检查动作被机械检测（如定时 meta-cc
      扫描或日志留痕比对），违规报出
      **证据（2026-08-08 实跑）**：新增 `plugin/scripts/manager-observation-runtime-check.ts`
      （四类判据 AC1；目标 `--transcript` / `--dir+--session` / `--root+--session` / `--self`；
      `--since` 窗口；`--json` 机器输出；`--report` 持久违规日志；exit 0/1/2，读不到 fail-closed）。
      **对真实外层会话 transcript 实跑**（`--transcript
      $HOME/.claude/projects/-home-yale-work-quay/b8dc91a6-64e8-4d70-a715-9ec8e16a4f11.jsonl
      --json`）检出 **235 条真实违规**：TICKLOG=234（外层反复 `cat`/python-heredoc 读 + `git add/commit`
      manager 的 `orchestration/manager-tick-log.md`）+ PANE=1（`capture-pane -t quay-0:manager`）——
      正是文档层检查覆盖不到的运行时动作（「文档里没写 ≠ 运行时没做」的实锤）。检测样例：
      `TICKLOG 2026-08-03T13:12:22Z Bash git add -A orchestration/manager-tick-log.md …`、
      `PANE 2026-08-03T14:54:53Z Bash capture-pane -t quay-0:manager`。测试：
      `plugin/test/manager-observation-runtime-check.test.mjs`（28 条，正/负控制，含 08-07 09:03
      越界实例的 ANALYZE 形态）+ `plugin/scripts/checker-mutation-cases/manager-observation-runtime-check.sh`
      （mutation gate 通过）。触发/报出路径已接 `plugin/loop/orchestrator-loop-tick.md`
      「C3 运行时约束」节（每 tick 自审，违规即停、升级给人）。

- [x] AC3: **负控制**——指向 inner 的观测、manager→outer 的正常发布不误报；基于转述的指控
      （如今天这次）不被当作证据
      **证据（2026-08-08，全部固化在测试）**：
      - 指向 inner 的观测 ⇒ 0 命中：`capture-pane -t quay-0:inner`、会话级 `-t "$TMUX_SESSION"`、
        `-t quay-0:outer-`、窗口 `managerial`（词边界外不命中）；
      - manager→outer 发布 ⇒ 0 命中：`supervisor-bus-identity.sh inbox-summary`、读 manager 的
        inbox/bus 文件（publishSurface 白名单）；
      - **转述/散文不当证据** ⇒ 0 命中：transcript 文本提到「据转述外层观察了 manager 窗口」、
        `echo 'never capture-pane -t quay-0:manager'`（命令里提到字样）——只数真实 tool_use 块；
      - 写文档 heredoc 提到 tick-log 路径（`cat > ...manager-loop-tick.md`）⇒ 0 命中（不是读）；
      - 建「manager 产品化」任务（build 动词）⇒ 0 命中；分析 inner 的任务 ⇒ 0 命中；
      - 裸 manager session id 出现在非观测命令 ⇒ 0 命中（无 `.jsonl` 路径不算读 transcript）。
      `plugin/test/manager-observation-runtime-check.test.mjs` 的 AC3 组逐条断言。

- [x] AC4: 与 gap-manager-productization-five-constraints（C3 的 AC4 文档层检查）交叉标注——
      运行时约束是它的补充，不是替换
      **证据（2026-08-08）**：`tasks/gap-manager-productization-five-constraints.md` AC4 证据追加
      「运行时补充」标注（见该任务）；`plugin/loop/orchestrator-loop-tick.md` 新增「C3 运行时约束」节
      （触发/报出路径：每 tick 自审 `manager-observation-runtime-check.ts --since <上次审计>`，
      违规即停）。两条正交：文档层检查（`no-manager-tick-doc-check.ts`）管「tick 文档不得含
      创建/驱动/检查 manager 的步骤」，运行时约束管「运行时实际观测/检查动作为零」。**新节不触发
      文档层检查器**：`node --no-warnings --experimental-strip-types plugin/scripts/no-manager-tick-doc-check.ts --root . --json` → `{"ok": true, "violations": []}`。

## Definition of Done

- [x] AC1-AC4 实跑输出贴任务体（判据定义 + 检测样例 + 负控制）
      **证据**：AC1 判据表（上面）；AC2 真实会话扫描 235 条违规 + 检测样例（TICKLOG/PANE 各一条，
      含 08-07 09:03 越界实例的 ANALYZE 测试）；AC3 负控制清单（上面）。

## Touches
- tasks/gap-c3-has-no-runtime-constraint.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）
- plugin/scripts/no-manager-tick-doc-check.ts（或新增运行时检查器）——**本任务新增** `plugin/scripts/manager-observation-runtime-check.ts`
- plugin/test/manager-observation-runtime-check.test.mjs（AC2/AC3 测试，新增）
- plugin/scripts/checker-mutation-cases/manager-observation-runtime-check.sh（mutation case，新增）
- plugin/loop/orchestrator-loop-tick.md（运行时约束的触发/报出路径）
- tasks/gap-manager-productization-five-constraints.md（AC4 交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-08T06:3xZ
changed: 管理者 2026-08-08 报告缺口（AC4 只覆盖文档层，覆盖不到运行时），并指出 08-07 09:03
  外层 task_write 分析 manager 行为立案属 C3 越界（成立）。外层判断：值得立案——"文档没写≠
  运行时没做"是本仓反复出现的形状（声明在/保证没了），且刚因缺运行时约束引发了一次误指控。
