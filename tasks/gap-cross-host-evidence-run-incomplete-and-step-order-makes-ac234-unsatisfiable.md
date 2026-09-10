---
id: gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable
title: 跨机证据运行只产出 6 种记录里的 2 种：写 goal 的步骤排在读 web 的步骤之后 ⇒ AC-234 的 goals_rendered
  结构上恒 0；两个步骤 flag 未传 ⇒ AC-203/205 永不产出；远端 stdout 被丢弃 ⇒ fail-closed 的步骤无法诊断
status: todo
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
---
## Proposal

**前置成果（本条建立在它之上，非否定它）**：`gap-third-party-evidence-no-transport-to-driving-repo-carrier` 的回传机件已实现并**真的跑通**——2026-09-10T22:45Z 首次由机件把跨机记录送进驱动方载体，`GOAL-009-AC-204`（host=B）与 `GOAL-009-AC-206`（host=orangevps）两条判据干跑**双双 exit 0**（此前恒 1）；远端项目 `/home/yale/quay-verify-coldstart-32c0d047-root` 经 ssh 外部核实真实存在（含 `.quay/` `goals/` `tasks/` `quay-init.log` 与活的 round 记录），⛔ 非驱动方自述。

**但同一次运行只产出了 6 种所需记录里的 2 种。** 逐条查清成因（读远端 `verify-deliver-evidence.json` 与主流程位置，⛔ 非推测）：

### ① 步骤顺序把 AC-234 做成结构上不可满足（最要紧）

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

⇒ **唯一写 goal 的步骤排在读 web 的步骤【后面】**。而回传机件每次按 develop tip 建**全新 `--root`**（`quay-verify-coldstart-<tip8>-root`），项目在 `step_ac234_web_render` 执行那一刻必然是空的。远端证据逐字佐证：

```
ac234_evaluated = 1
ac234_tasks_rendered = 0
ac234_goals_rendered = 0
ac234_round_records_rendered = 0
ac234_host = orangevps
ac234_project_root = /home/yale/quay-verify-coldstart-af8c835a-root
```

而 `goals/AC-234-*.md` 的 criterion 要求 `tasks_rendered>0 ∧ goals_rendered>0 ∧ round_records_rendered>0`。⇒ **AC-234 经这条路永远不可能转绿**——不是「还没跑够」，是顺序使判据不可满足。写入点本身 fail-closed 的行为是**对的**（硬规则 3b，三计数为 0 时拒写、不伪装成合格）；错的是它被喂了一个必然为 0 的输入。

### ② 两个步骤 flag 未传 ⇒ AC-203 / AC-205 永不产出

回传机件的远端调用（`develop-deliver-tgz.sh` verify_coldstart_mode 的 `remote_script`）传的是 `--tgz/--tgz-native/--build-sha/--build-date/--host/--ac89/--spec/--prefix/--project/--root/--worktree-root`，**不含任何步骤 flag**：

- `--ac205-session`（用法行 ⑦）未传 ⇒ `step_ac205_session_delivery` 在 `if [ "$AC205_SESSION" = "1" ]` 里被跳过 ⇒ AC-205 记录永不产出。
- `--cold-start-drive` / `--require-live` 未传 ⇒ 远端证据逐字 `coldstart_live = no`、`ac88_verify = not-live`、`l2_ok = 0` ⇒ `step4_driver_liveness` 的 `driver_alive` 读数不达标 ⇒ AC-203 fail-closed。

### ③ 远端 stdout 被丢弃 ⇒ fail-closed 的步骤无法诊断

`remote_script` 的输出在本地只被 grep 了三个标记（`VERIFY-RC` / `EVIDENCE-PATH` / `EVIDENCE-LINES`），**其余全部丢弃**。后果实测：`step_ac232_goal_carrier_write` 在主流程 `:2007` 是**无条件调用**的（不像 AC-205 有 flag 闸），所以它**跑了**，且按 `:1408` 会打印 `NOTE: AC-232 record NOT written (goal write/read-back 未达标…)`——**但那行 stdout 被丢掉了，驱动方这边看不到原因**。对比 AC-234 之所以能诊断，纯属侥幸：它恰好把 `ac234_*` 四个字段写进了 `verify-deliver-evidence.json`，而 AC-232 没有对应字段。

**并且**：一次只回传了 2 种记录的运行，在驱动方这边报的是 `evidence_lines=4`（含 AC88/AC-201）**并被当作成功**——它只对「零证据」报 NOT-EVALUATED，对「缺了 4 种预期记录」不作声。⇒ 部分产出与完全成功同形（硬规则 3b 的同族形态）。

## Plan

1. **改顺序**：把 `step_ac232_goal_carrier_write` 移到 `step_ac234_web_render` **之前**，使 web 渲染时项目里至少有一条 goal。⛔ 不要靠在 AC-234 步骤里自己塞数据来凑数（那会让它变成自证，硬规则 4）——要让它渲染的是**别的步骤真实写进去的**载体内容。
2. **补 task 与 round 记录来源**：`tasks_rendered>0` 需要项目里有 task。评估两条路，二选一并写明理由：(a) 让 AC-232 的同族步骤同时经 Provider ABI 写一条 task；(b) 依赖 `--ac207-e2e` 的 `task create e2e-verify-207`（**但它尚未落 develop**，见 `gap-ac207-e2e-producer-section-never-landed-on-develop`）。`round_records_rendered>0` 需要 driver 真跑过 ⇒ 与 ③ 的 `--cold-start-drive` 相关。
3. **回传机件传全步骤 flag**：`--ac205-session`、`--cold-start-drive`（或 `--require-live`）等按宿主能力传入；不具备条件的宿主要给**可区分取值**，⛔ 不静默跳过。
4. **持久化远端 stdout**：把 `out` 落成本地日志（如 `.quay/verify-coldstart-remote-<host>-<tip8>.log`）并在结果里打印路径。
5. **按 ac 种类核对回传完整性**：声明该次运行**预期**产出的 ac 集合，与实际回传的集合求差，缺失项逐条打印；全缺 ⇒ 现有 NOT-EVALUATED 不变，部分缺 ⇒ 明确报 PARTIAL（⛔ 不与完全成功同形）。

## Acceptance Criteria

- [ ] AC1 顺序缺陷存证（改前读数）：贴改前 `:2006/:2007` 两行原文（web render 在 goal write 之前），与远端 `verify-deliver-evidence.json` 的 `ac234_evaluated=1` + 三个计数为 0 的四行。
- [ ] AC2 顺序已改（能取假）：改后 `grep -n 'step_ac232_goal_carrier_write\|step_ac234_web_render' plugin/scripts/verify-deliver-coldstart.sh` 显示 ac232 的行号**小于** ac234；贴两行。
- [ ] AC3 AC-234 三计数真转正（⛔ 生产载体，非夹具，硬规则 4 推论三）：一次真实跨机运行后，本机载体出现 `ac="GOAL-015-AC-234"` 且 `tasks_rendered>0 ∧ goals_rendered>0 ∧ round_records_rendered>0` 且 `host≠本机 ∧ project_root∉本仓库` 的记录；贴该记录全文与 AC-234 criterion 干跑 exit 0。
- [ ] AC4 AC-203 / AC-205 记录产出：同一次或后续跨机运行后，本机载体各出现 ≥1 条满足其 criterion 全部字段条件的 `GOAL-009-AC-203` 与 `GOAL-009-AC-205` 记录；两条 criterion 干跑各 exit 0；贴两条记录与两次干跑输出。若某宿主结构上不具备条件（如无同址目标会话），**照实报告并说明它给出的可区分取值**，⛔ 不得为凑绿而伪造。
- [ ] AC5 远端 stdout 已持久化：跑一次后本地存在该次运行的远端输出日志，且其中含 `step_ac232_goal_carrier_write` 那一步的实际打印行（写成功行或 `NOTE: AC-232 record NOT written …` 行）；贴日志路径与该行。
- [ ] AC6 部分产出不再与成功同形（能取假）：构造一次「预期 6 种、实际回传 2 种」的运行 ⇒ 驱动方输出逐条列出缺失的 ac 种类且退出码非 0（PARTIAL）；再构造一次全产出 ⇒ exit 0。贴两次输出与退出码。
- [ ] AC7 单测：扩 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`（或新增同族测试），覆盖 AC6 的两个方向；`node --test` exit 0。
- [ ] AC8 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

一次跨机运行能产出 AC-203/204/205/206/232 与 GOAL-015-AC-234 的记录（宿主结构上不具备的项须给出可区分取值并照实报告），`step_ac232` 在 `step_ac234` 之前执行，远端 stdout 可在驱动方读到，且「部分产出」与「完全成功」在退出码与输出上可区分。⛔ 在 AC-234 步骤内自造渲染内容来凑三个计数 ⇒ 不算达成（自证不是测量，硬规则 4）；⛔ 把 fail-closed 改成放行 ⇒ 不算达成（硬规则 3b）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- packages/quay/plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/develop-deliver-tgz.sh
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable.md
