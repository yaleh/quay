---
id: gap-retire-inner-hygiene-delete-session-face
title: inner 会话卫生退役 step2——删 inner-panel-stale-check --pane CLI +
  wakeup-heartbeat CLI（写方待核）+ inner-exec-mode-report 死壳 + AC149
  doc-marking（09-01 收窄：monitor-mount-check.sh/inner-blocked-signal.ts 移出 scope）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-retire-inner-hygiene-migrate-helper
---
**type:** execution

## ⛔ 范围收窄说明（2026-09-01 复核，纠正原 Proposal 两处误判——先读这段再读下面）

原 Proposal/Plan/Touches 把 `monitor-mount-check.sh` 和 `inner-blocked-signal.ts` 的 `--detect-stop`/落盘面也划进②类待删/待改名，逐条实测后确认是误判，**必须先移出 scope 再执行**，否则会破坏生产：

- **`monitor-mount-check.sh` 整体移出**：全文 0 处 tmux/pane/window 引用（连注释都写"tmux 命中 0"）。它测的是 harness `Monitor` 工具的挂载状态（`session-liveness.sh` 后台进程是否在跑、指向本仓根），被 `outer-driver.ts`（A1，`monitorMountRoutine`）和 `manager-start.sh`（`--check-idle-watch`）实调——是按名字联想（"monitor"听起来像监控 inner）错分类的，不是②类会话卫生面。
- **`inner-blocked-signal.ts` 的 `--detect-stop`/落盘面不删、不改**：`observePaneForRuling`/`capturePaneLive`/`resolveTmuxTarget` 等是**通用多目标观察原语**（`--target` 参数化，非 inner 专属）——outer 自己的 tick 文档 `orchestrator-loop-tick.md:750-751` 还在示范 `--target outer --pane`，`blocked-signal-parameterized.test.mjs` 的 `AC5 — manager watches outer` 这条测试标题直接钉住"manager 观察 outer 的 pane"这个仍活的能力；落盘面（`writeBlockedRecord`/`readBlockedRecord`/`escalateStaleBlock`）是 `blocked-signal-check.sh --timeout`、`restart-readiness-check.sh --read` 两个生产入口的底层实现，删除会直接断这两处。**真正死的只是"喂 inner 自己的 pane"这一个具体调用**（`--target inner --pane <capture>`），这是**文档层面**的死指令（下面 AC3 处理），不是代码需要删除的理由——直接测量证据：当前 tmux 无任何叫 `"inner"` 的窗口，`.quay/last-pane.txt` 停在 08-24（8 天无写入），`.quay/.ruling-observer-state.json` 停在 08-27（5 天无写入）。
- **`inner-session-check.sh` 移出"改名/改注释"范围**：复核后判定应整体退役（原保留理由"被 `inner-exec-mode-report.ts` 复用"已随后者判②而失效），且 `manager-adopt.sh` 现在调它三态检查是个**独立生产缺陷**（检查一个永不存在的 `"inner"` 窗口）——已拆两条独立任务处理：`gap-manager-adopt-outer-role-check-broken`（先修缺陷）→ `gap-retire-inner-session-check-script`（后删旧脚本+同步消费点）。本任务不再涉及它。

## Proposal

step1（`gap-retire-inner-hygiene-migrate-helper`，done）已把三个活 helper 迁出。本任务删真正②类的会话卫生面：`inner-panel-stale-check.ts` 的 `--pane` CLI 壳（零活代码消费者，纯函数部分迁到新文件）、`inner-wakeup-heartbeat.ts` 的 wakeup-heartbeat CLI（写方是否仍被调用需先核实，见 AC2）、`inner-exec-mode-report.ts` 迁移后留下的 re-export 死壳（+ 它遗留到 `main-thread-edit-check.ts` 里的 `resolveViaInnerSessionCheck` 死回退分支）+ AC149 doc-marking（`fast-mode-tick-core.md`/`orchestrator-tick-core.md`/`orchestrator-loop-tick.md` 里"outer 捕获 inner 自己 pane"这一具体指令的删除/标注，**只删 target=inner 的调用，保留 target=outer/manager 的示例**）。

## Plan

1. `inner-panel-stale-check.ts`：1-191 行纯函数（模块自带边界注释）搬到新文件 `agent-panel-classify.ts`；删 CLI 壳（`readPane` 的 tmux 分支 + `--target`/`--after-target` flags + `main()`）。
2. `inner-wakeup-heartbeat.ts`/`-check.ts`：核实写方（`buildHeartbeat`/`writeHeartbeat`/`--write` 调用点）是否仍被任何机制每轮调用（`capability-catalog.sh` 自己的"失效前提"写着"inner 自排程仍写心跳文件；若改由 harness 直接上报，本条退休"——需要实测确认前提是否已失效）。若确认无活调用点 ⇒ 删 CLI 面；若仍有活调用点 ⇒ 本任务只记录该发现（写入任务体），不删代码，另立观测任务处理。
3. 删 `inner-exec-mode-report.ts`（现为 23 行 re-export 死壳） + `inner-exec-mode-report.test.mjs`（消费点已在 step1 全部指向 `main-thread-edit-check.ts`）；清 `main-thread-edit-check.ts` 里继承来的 `resolveViaInnerSessionCheck`/`heuristicWarning` 的 pane-pid 回退分支（约 231-289 行附近，调用即将被 `gap-retire-inner-session-check-script` 删除的 `inner-session-check.sh`）；`repo-root-unification.test.mjs` 的 `FORMER_DEFINERS` ratchet 若列了这两个待删文件，一并从名单移除。
4. AC149 doc-marking：全量 grep `plugin/loop/fast-mode-tick-core.md` + `orchestration/fast-mode-tick-core.md`（双副本）里 A7/A8 两行；`plugin/loop/orchestrator-tick-core.md` + `orchestration/orchestrator-tick-core.md`（双副本）里 A7 一行；`plugin/loop/orchestrator-loop-tick.md` + `orchestration/orchestrator-loop-tick.md`（双副本）里"外层按分钟轮询内层 pane"那一段（`tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt` + 紧邻的 `--target inner --pane` 调用）——**每处只删/标注 target=inner 的具体指令，`--target outer`（如 orchestrator-loop-tick.md:750-751）保持不动**；`red-on-omission-audit.ts:427` 的 A7 条目（`redReading` 提到"pane 快照陈旧改读活 capture-pane"，随 A7 指令删除而同步标注废弃）。

## Acceptance Criteria

- [ ] AC1（能取假，真正②类面清）：`inner-panel-stale-check.ts` 的 CLI 壳与 `inner-exec-mode-report.ts` 死壳均已删除；纯函数在 `agent-panel-classify.ts` 里可直接 import 且行为不变（迁移测试绿）；`main-thread-edit-check.ts` 里的 `resolveViaInnerSessionCheck` 死回退已删除。⛔ 任一仍在原文件/原路径可 import ⇒ 假。
- [ ] AC2（能取假，wakeup-heartbeat 写方核实后处置，二选一记录）：若核实写方无活调用者 ⇒ CLI 面已删；若核实仍有活调用者 ⇒ 任务体记录该发现、代码不改、注明后续观测任务 id。⛔ 未做核实直接删或直接跳过不判定 ⇒ 假。
- [ ] AC3（能取假，doc-marking 完整且不误伤）：上述 6 份文档（含双副本）里"捕获/喂 inner 自己 pane"的具体调用行均已删除或标注退役；`red-on-omission-audit.ts:427` A7 条目同步。⛔ 任一份文档仍原样引用该具体调用且未标注 ⇒ 假；⛔ 误删了 `--target outer`/`--target manager` 部分 ⇒ 假（`orchestrator-loop-tick.md:751` 一行必须原样保留，作为负控制核对点）。
- [ ] AC4（能取假，未越界）：`git diff` 对 `plugin/scripts/monitor-mount-check.sh` 与 `plugin/scripts/inner-blocked-signal.ts` 均为空——本任务未改动这两个文件。⛔ 任一文件有 diff ⇒ 假。
- [ ] AC5（能取假，无回归）：typecheck + 相关测试绿。

## Definition of Done

真正②类会话卫生面（`inner-panel-stale-check.ts` CLI、`inner-wakeup-heartbeat.ts` CLI 视写方活性、`inner-exec-mode-report.ts` 死壳）删除或按核实结果处置、AC149 doc-marking 落地且不误伤 outer/manager 用例、`monitor-mount-check.sh`/`inner-blocked-signal.ts` 未被触碰、typecheck 与相关测试绿。

## Touches

- plugin/scripts/inner-panel-stale-check.ts（删 CLI 壳）
- plugin/scripts/agent-panel-classify.ts（新：纯函数分类器）
- plugin/test/inner-panel-stale-check.test.mjs（拆：纯函数测试随新文件改名，CLI 测试删）
- plugin/scripts/inner-wakeup-heartbeat.ts（写方活性核实后处置）
- plugin/scripts/inner-wakeup-heartbeat-check.ts（随上者联动）
- plugin/scripts/inner-exec-mode-report.ts（删死壳）
- plugin/test/inner-exec-mode-report.test.mjs（删）
- plugin/scripts/main-thread-edit-check.ts（删继承来的 resolveViaInnerSessionCheck 死回退）
- plugin/test/repo-root-unification.test.mjs（FORMER_DEFINERS 名单同步，若列了待删文件）
- plugin/scripts/capability-catalog.sh（新文件六表注册；退役条目标记）
- plugin/loop/fast-mode-tick-core.md（A7/A8 doc-marking）
- orchestration/fast-mode-tick-core.md（A7/A8 doc-marking）
- plugin/loop/orchestrator-tick-core.md（A7 行 doc-marking，只删 target=inner 部分）
- orchestration/orchestrator-tick-core.md（同上）
- plugin/loop/orchestrator-loop-tick.md（捕获 inner pane 指令段 doc-marking，保留 target=outer 示例）
- orchestration/orchestrator-loop-tick.md（同上）
- plugin/scripts/red-on-omission-audit.ts（A7 条目同步）
- tasks/gap-retire-inner-hygiene-delete-session-face.md（自身）
