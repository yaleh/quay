---
id: gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable
title: 跨机证据运行只产出 6 种记录里的 2 种：写 goal 的步骤排在读 web 的步骤之后 ⇒ AC-234 的 goals_rendered
  结构上恒 0；两个步骤 flag 未传 ⇒ AC-203/205 永不产出；远端 stdout 被丢弃 ⇒ fail-closed 的步骤无法诊断
status: done
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-234
depends_on:
  - gap-third-party-evidence-no-transport-to-driving-repo-carrier
  - gap-outer-retirement-test-pins-a-file-that-is-no-longer-orphaned
---
## Proposal

**前置成果（本条建立在它之上，非否定它）**：`gap-third-party-evidence-no-transport-to-driving-repo-carrier` 的回传机件已实现并**真的跑通**——2026-09-10T22:45Z 首次由机件把跨机记录送进驱动方载体，`GOAL-009-AC-204`（host=B）与 `GOAL-009-AC-206`（host=orangevps）两条判据干跑**双双 exit 0**（此前恒 1），并已由 goal-driver 翻成 achieved。远端项目经 ssh 外部核实真实存在，⛔ 非驱动方自述。

**但同一次运行只产出了 6 种所需记录里的 2 种。** 逐条查清成因（读远端 `verify-deliver-evidence.json` 与主流程位置，⛔ 非推测）：

### ① 步骤顺序把 AC-234 做成结构上不可满足（最要紧，已充分验证）

`plugin/scripts/verify-deliver-coldstart.sh` 主流程 `:2000-2010` 逐字顺序：

```
step2_init                     ← 建【空的】 goals/ 与 tasks/
step_ac204_forbidden_surface   ← 写 AC-204 ✓
step3_coldstart
step4_driver_liveness          ← AC-203
step5_dual_carrier             ← 写 AC-206 ✓
step_ac234_web_render   :2006  ← 读 web
step_ac232_goal_carrier_write  :2007  ← 【唯一往项目写 goal 的步骤】
```

⇒ **唯一写 goal 的步骤排在读 web 的步骤【后面】**。而回传机件每次按 develop tip 建**全新 `--root`**，项目在 `step_ac234_web_render` 执行那一刻必然是空的。远端证据逐字佐证：

```
ac234_evaluated = 1
ac234_tasks_rendered = 0
ac234_goals_rendered = 0
ac234_round_records_rendered = 0
```

而 `goals/AC-234-*.md` 的 criterion 要求三者全 > 0。⇒ **AC-234 经这条路永远不可能转绿**。写入点本身 fail-closed 是**对的**（硬规则 3b）；错的是它被喂了一个必然为 0 的输入。

### ② AC-205 未产出：`--ac205-session` 未传（已验证）

回传机件的远端调用（`develop-deliver-tgz.sh` verify_coldstart_mode 的 `remote_script`）传的是 `--tgz/--tgz-native/--build-sha/--build-date/--host/--ac89/--spec/--prefix/--project/--root/--worktree-root`，**不含任何步骤 flag**。`step_ac205_session_delivery` 在 `if [ "$AC205_SESSION" = "1" ]` 里被跳过 ⇒ AC-205 记录永不产出。

**前提已具备（实测，2026-09-10 23:1xZ）**：orangevps `~/.claude/sessions` 有 12 个注册项 + 2 个活 claude 进程；ad-arm1 2 个 + 2 个。⇒ AC-205 **不是结构上不可满足**，缺的就是这个 flag。

### ③ 远端 stdout 被丢弃 ⇒ fail-closed 的步骤无法诊断（已验证）

`remote_script` 的输出在本地只被 grep 了三个标记（`VERIFY-RC` / `EVIDENCE-PATH` / `EVIDENCE-LINES`），**其余全部丢弃**。后果实测：`step_ac232_goal_carrier_write` 在 `:2007` 是**无条件调用**的，所以它跑了，且按 `:1408` 会打印 `NOTE: AC-232 record NOT written (…)`——**但那行被丢掉了**。AC-234 之所以能诊断纯属侥幸：它恰好把 `ac234_*` 写进了 `verify-deliver-evidence.json`，AC-232 没有对应字段。

**并且**：一次只回传 2 种记录的运行，在驱动方报 `evidence_lines=4` **并被当作成功**——只对「零证据」报 NOT-EVALUATED，对「缺 4 种预期记录」不作声 ⇒ **部分产出与完全成功同形**（硬规则 3b 同族）。

### ④ ⚠️ 关于 AC-203 的成因：本任务立条时给的解释【已被证否】，现记为未知

**立条时（23:0xZ）我写的是**「`--cold-start-drive`/`--require-live` 未传 ⇒ `coldstart_live=no` ⇒ `step4_driver_liveness` 的 `driver_alive` 不达标」。**这条是错的，23:3xZ 实测推翻**（硬规则 4 推论四：一个能解释现象的说法不是一个被检验的结论——我当时给的正是前者）：

- `step4_driver_liveness` **自己就起 driver**：`node "$qrl" driver start --kind promotion --root "$root"`，然后轮询 `driver status --json` 至多 30s。⇒ 它**不依赖** `--cold-start-drive`。
- 远端该项目实测（23:3xZ）：无 `plugin/` ⇒ `has_plugin_dir=0` ✓；`driver status --kind promotion --root <项目> --json` 返回 `{"driver_alive":1,"carrier_records":92,…}` 且 **stdout 干净、可 JSON 解析** ✓。⇒ **AC-203 的三个条件此刻全部满足**。
- 时间线也不支持「来不及」：项目 22:48:01 建，driver 首轮 22:48:04 写入（3 秒），证据文件 22:48:53 收尾——30s 轮询窗口内绰绰有余。

⇒ **AC-203 在那次运行中未产出记录的真实原因【未知】。** ⛔ 本任务不再携带一个未经检验的成因；实现者的第一步应是**先取到那一步的实际 stdout**（正是本任务 ③ 要做的持久化），再据实定位，**不要照着一个被证否的假设去改**。

### ⑤ 顺带发现：`driver status` 的 `carrier_path` 与 `carrier_records` 指向不同文件

实测（同一次远端调用）：`carrier_path` 报 `<项目>/.quay/promotion-outcome.jsonl`，而**该文件不存在**（shell 逐字 `No such file or directory`）；同一份 JSON 里 `carrier_records: 92`，与 `promotion-round.jsonl` 的行数吻合。⇒ **计数的载体与自报的来源不是同一个文件**——照 `carrier_path` 去核的人会看到一个不存在的文件并得出「零记录」，而计数说 92。这是一个诊断字段在谎报自己的来源（硬规则 4b 同族：代理量与直接量脱节）。发生率目前 1，记为**观察项**，⛔ 不作为本任务的阻塞；若实现 ③ 之后发现它误导了定位，再单独立案。

## Plan

1. **改顺序**：把 `step_ac232_goal_carrier_write` 移到 `step_ac234_web_render` **之前**，使 web 渲染时项目里至少有一条 goal。⛔ 不要靠在 AC-234 步骤里自己塞数据来凑数（自证，硬规则 4）——要让它渲染的是**别的步骤真实写进去的**载体内容。
2. **补 task 与 round 记录来源**：`tasks_rendered>0` 需要项目里有 task。二选一并写明理由：(a) 让 AC-232 的同族步骤同时经 Provider ABI 写一条 task；(b) 依赖 `--ac207-e2e` 的 `task create e2e-verify-207`（见 `gap-ac207-e2e-producer-section-never-landed-on-develop`）。
3. **回传机件传步骤 flag**：至少传 `--ac205-session`；其余按宿主能力传入，不具备条件的宿主要给**可区分取值**，⛔ 不静默跳过。
4. **持久化远端 stdout**（**优先做这条**）：把 `out` 落成本地日志（如 `.quay/verify-coldstart-remote-<host>-<tip8>.log`）并在结果里打印路径。④ 的 AC-203 真因必须靠它来定。
5. **按 ac 种类核对回传完整性**：声明该次运行**预期**产出的 ac 集合，与实际回传的集合求差，缺失项逐条打印；全缺 ⇒ NOT-EVALUATED 不变，部分缺 ⇒ 明确报 PARTIAL。

## Acceptance Criteria

- [x] AC1 顺序缺陷存证（改前读数）：贴改前 `:2006/:2007` 两行原文，与远端 `verify-deliver-evidence.json` 的 `ac234_evaluated=1` + 三个计数为 0 的四行。
- [x] AC2 顺序已改（能取假）：改后 `grep -n 'step_ac232_goal_carrier_write\|step_ac234_web_render' plugin/scripts/verify-deliver-coldstart.sh` 显示 ac232 的行号**小于** ac234；贴两行。
- [x] AC3 AC-234 三计数真转正（⛔ 生产载体，非夹具，硬规则 4 推论三）：一次真实跨机运行后，本机载体出现 `ac="GOAL-015-AC-234"` 且三计数全 >0 且 `host≠本机 ∧ project_root∉本仓库` 的记录；贴该记录全文与 AC-234 criterion 干跑 exit 0。
- [x] AC4 远端 stdout 已持久化（**先做**）：跑一次后本地存在该次运行的远端输出日志，且其中含 `step_ac232_goal_carrier_write` 与 `step4_driver_liveness` 两步的实际打印行；贴日志路径与这两行。
- [x] AC5 AC-203 真因据实定位：**基于 AC4 拿到的实际 stdout**，写出该步未写记录的真实原因（或证明它现在能写），并贴支撑读数。⛔ 不得沿用本任务 ④ 已证否的那个假设；若实测发现它现在就能产出记录，如实写「原因已消失」并贴记录。
- [x] AC6 AC-205 记录产出：传入 `--ac205-session` 后，本机载体出现满足其 criterion 全部字段条件的 `GOAL-009-AC-205` 记录，criterion 干跑 exit 0；贴记录与输出。若某宿主结构上不具备条件，**照实报告并说明它给出的可区分取值**，⛔ 不得为凑绿而伪造。
- [x] AC7 部分产出不再与成功同形（能取假）：构造一次「预期 6 种、实际回传 2 种」的运行 ⇒ 驱动方输出逐条列出缺失的 ac 种类且退出码非 0（PARTIAL）；再构造一次全产出 ⇒ exit 0。贴两次输出与退出码。
- [x] AC8 单测：扩 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`（或新增同族测试），覆盖 AC7 的两个方向；`node --test` exit 0。
- [ ] AC9 全量绿：`scripts/test.sh` 全量绿（待外部）

## Definition of Done

一次跨机运行能产出 AC-204/205/206/232 与 GOAL-015-AC-234 的记录（AC-203 至少要有**基于实际 stdout 的**真因结论；宿主结构上不具备的项须给出可区分取值并照实报告），`step_ac232` 在 `step_ac234` 之前执行，远端 stdout 可在驱动方读到，且「部分产出」与「完全成功」在退出码与输出上可区分。⛔ 在 AC-234 步骤内自造渲染内容来凑三个计数 ⇒ 不算达成（自证不是测量，硬规则 4）；⛔ 把 fail-closed 改成放行 ⇒ 不算达成（硬规则 3b）；⛔ 照本任务 ④ 那个已证否的假设去改 AC-203 ⇒ 不算达成。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- packages/quay/plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/develop-deliver-tgz.sh
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable.md
