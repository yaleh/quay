---
id: gap-silent-completion-path-writes-no-gate-event
title: 静默完成路径仍在——裸 `task_write` 把 status 改成 done 产出零 `complete`
  GateEvent；2026-09-30 那条唯一的漏记使次日全部 code delta 的 fan-in 在静态闸中止（套件根本没跑）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

**静默完成路径仍在，且 2026-09-30 已被实测为一次跨日、全循环代码面落地停摆的成因。**

### 证据（逐条可复跑）

develop 上 2026-09-30（UTC）共 **17 次落地**；按**写入路径**分组：

| 路径 | 条数 | 有 `complete` 事件？ |
|---|---|---|
| driver 机械 fan-in（subject 形如 `tasks: 翻 <id> done（driver 机械 fan-in）`） | 16 | **全部有** |
| 裸 `task_write`（subject 形如 `tasks: <id> task_write by cli:<pid>`） | 1 | **零** |

唯一那条是 `0f784470f`（`gap-ac292-criterion-carrier-absence-not-evaluated`，2026-09-30T16:55:57+0800）。
`grep -c 'gap-ac292-criterion-carrier-absence-not-evaluated' .quay/gate-events.jsonl` ⇒ **0**。

它使 `gate-event-coverage-check`（`runner-static-gate.ts:960` 以 `--root main_root --days 1 --gate` 接线，**fail-closed**）在 **2026-10-01 全天判红**（09-30 = 16/17 = 94% < 95%），而静态闸排在套件之前 fail-closed ⇒ **当天每一条 code delta 的 fan-in 在静态闸即中止，套件根本没跑**（`.quay/full-suite-state.json`：`state=red reason=static-check`；日志尾 `# tests 0 / # fail 46 / # suite red static-check`）。

**负控制（同日反例）**：`gap-ac251-resident-unified-host-dead-no-restore` 因 delta 为 doc-only ⇒ `delta → doc-only delta → skip suite` ⇒ 静态闸被跳过，正常落地（`append-complete-gate-event` 有记录）。⇒ 停的是 code 面，不是全部。

### 这不是新发现：它是 predecessor 列过的路径 #5，且当时被**有意**留作「检测不修」

<!-- dedup-ref --> `tasks/gap-complete-gateevent-coverage-has-a-residual-gap.md`（status: done）逐字枚举了 6 条落地路径，其中 **#5 = Provider-ABI 直写 `status: done`（MCP `task_write` / native `task edit`）**，判为「**否 —— ABI 层设计内旁路**」，并在 Finding 结论三写明 **「真缺口，检测不修」**；理由：Core 写的是 view-model，Provider ABI 必须 provider-agnostic，让 provider 感知 gate 会把 gate 语义漏进每个后端；缓解 = `stale-ready-audit.ts` 的 `bypassComplete`（实时 ≤6h）+ 本覆盖率判据（历史）。

**新增的事实只有一个，但它推翻了那个成本模型**：该任务的「## 一处我自己的判断」第 3 条写着「静默不是风险：漏记由**次日**的覆盖率判据报出 …… 告警 + 可检测 = 该失败不可能与「一切正常」同形」。**实测：这个「次日告警」被接线成 fail-closed ⇒ 它的代价不是「一条红色读数」，而是「全部 code delta 落地停摆一整天」。** 检测被当成了无害检测。

### 留痕路径一直存在，只是没被走

`plugin/scripts/loop-complete-task.ts` 的文件头逐字写着它存在的理由 —— 「the loop completed tasks by writing `status: ready → done` into `tasks/<id>.md` directly … **a loop-completed task produced ZERO GateEvents**」。它经 `runCompleteLoop`（`packages/quay/src/gate/lifecycle.ts:242`）落 `complete` pass 事件并带 `verifiedBy`。

之所以没走，是**两条完成路径的 acceptance 语义不同，而只试了其中一条**：
- `quay complete`（`runComplete`，`lifecycle.ts:207`）**无条件**跑 acceptance 闸 ⇒ 无 `extra.acceptance` 即 fail-closed（ac292 的 `extra` 只有 `schema: execution`）；
- `runCompleteLoop`（`lifecycle.ts:261-274`）有 `hasMeter` 分支：**无 meter ⇒ 跳过 acceptance**，改用 `--verified-by`；
- 两者共同的前置 dark-axis 排在 acceptance **之前**（本 workspace 的 `.quay/config.yml` 声明了 ADR-007）⇒ 既然读到的是 acceptance 的 fail，dark-axis 已过 ⇒ `runCompleteLoop` 同样会过；
- 第三层：`needs-human` 是终态，而 `runCompleteLoop` 要求 `ready` ⇒ 需 `retreat`(needs-human→todo) + `promote`(todo→ready) 两步 —— **一条三步、靠记的路径**。

### 请求动作（二选一或都做，⛔ 不含「加豁免」）

1. **关掉静默路**：让「到达 `done` 必有一条 `complete` GateEvent」这条**已被覆盖率判据断言**的不变量下沉到**写侧**。落点由实现者定，约束是 **provider-agnostic**（predecessor 的顾虑成立）：Core 的 `task_write` 处理层（`packages/quay/src/mcp-handlers.ts`）在目标状态为 `done` 且本次不伴随 `complete` 事件时**拒绝**，并给一个显式的带外通道（理由必填，且该通道自己写事件）。
2. **把留痕路变成一条命令**：`loop-complete-task.ts` 增一个能直接处理 `needs-human` 的模式（内部自带 retreat→promote），使逃生门一次调用即可。

⛔ **明确不做**：把 `gap-ac292-criterion-carrier-absence-not-evaluated` 的 id 加进任何豁免表 —— predecessor 建的判据头注释（`gate-event-coverage-check.ts:20`）逐字禁止手维护白名单（「白名单可以被加 id 静默放大，推导式不能」）。与 AC-194 用**谓词**而非 sha 表是同一条规矩。

## AC

- [ ] **AC1（现状固化·生产载体）** 在 develop 上按**写入路径**枚举窗口内全部 `status: done` 翻转，贴出每条的提交 subject 形态与「是否有 `complete` 事件」；**分母、分子、差集三个数都要写出**，⛔ 不是布尔。可复跑：逐 commit `git show <sha> -- tasks/ | grep -E '^\+status: done$'`，再对该 id 在 `.quay/gate-events.jsonl` 里 `grep -c`。
- [ ] **AC2（负控制·判据能取假）** 对 AC1 的枚举谓词做**同面**干跑：取一条**已知有**事件的落地（如 `45e9bdab1`）跑同一谓词 ⇒ 必须命中；贴出该命中。没有这一步 = AC1 的零计数未复核。
- [ ] **AC3（处置可核）** 结论只能二选一，且都要**机械可核**：①**修掉** —— 贴出「写侧拒绝」的负控（一次目标是 `done` 且不伴随事件的 `task_write` ⇒ 被拒/非零）+ 正控（留痕路径仍成功并落事件）；②**写明「已有机制在管」，并指出它失败在哪一步** —— 贴出该机制名与失败步读数。⛔ 不以「已注意到」结案。
- [ ] **AC4（5b 同载体扫描）** 对 predecessor 的路径表（#1–#6）逐条重扫，贴出**当前**每条的「写事件 / 不写事件」与判据落点；**命中数与清单一起贴**，⛔ 不写成「其余同上」。
- [ ] **AC5（本任务自身的门）** `bash scripts/test.sh --for-task gap-silent-completion-path-writes-no-gate-event` 绿。

## DoD

**真实落地**：静默路径被**机制**关掉（而不是被叮嘱）—— 一次目标是 `done` 且不伴随 `complete` 事件的 `task_write` 在生产载体上被**拒绝**（AC3① 的负控实跑），而留痕路径（`loop-complete-task.ts`）仍能一次成功并落事件。⛔ **只把这件事写进文档/注释 ⇒ 不算完成**（硬规则 9：可见性 ≠ 执行 —— `loop-complete-task.ts` 的头注释已经是一句散文，它没能挡住 2026-09-30）。⛔ 只给 ac292 加一条豁免 ⇒ 不算完成（那是本条要消灭的形态）。

## Touches

- `packages/quay/test/mcp-server.test.mjs`
- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/src/gate/lifecycle.ts`
- `plugin/scripts/loop-complete-task.ts`
- `packages/quay/test/mcp-handlers.test.mjs`
- `packages/quay/test/lifecycle-a2b-loop-nometer.test.mjs`
- `tasks/gap-silent-completion-path-writes-no-gate-event.md`