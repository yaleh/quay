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

- [x] **AC1（现状固化·生产载体）** 在 develop 上按**写入路径**枚举窗口内全部 `status: done` 翻转，贴出每条的提交 subject 形态与「是否有 `complete` 事件」；**分母、分子、差集三个数都要写出**，⛔ 不是布尔。可复跑：逐 commit `git show <sha> -- tasks/ | grep -E '^\+status: done$'`，再对该 id 在 `.quay/gate-events.jsonl` 里 `grep -c`。
- [x] **AC2（负控制·判据能取假）** 对 AC1 的枚举谓词做**同面**干跑：取一条**已知有**事件的落地（如 `45e9bdab1`）跑同一谓词 ⇒ 必须命中；贴出该命中。没有这一步 = AC1 的零计数未复核。
- [x] **AC3（处置可核）** 结论只能二选一，且都要**机械可核**：①**修掉** —— 贴出「写侧拒绝」的负控（一次目标是 `done` 且不伴随事件的 `task_write` ⇒ 被拒/非零）+ 正控（留痕路径仍成功并落事件）；②**写明「已有机制在管」，并指出它失败在哪一步** —— 贴出该机制名与失败步读数。⛔ 不以「已注意到」结案。
- [x] **AC4（5b 同载体扫描）** 对 predecessor 的路径表（#1–#6）逐条重扫，贴出**当前**每条的「写事件 / 不写事件」与判据落点；**命中数与清单一起贴**，⛔ 不写成「其余同上」。
- [x] **AC5（本任务自身的门）** `bash scripts/test.sh --for-task gap-silent-completion-path-writes-no-gate-event` 绿。

## DoD

**真实落地**：静默路径被**机制**关掉（而不是被叮嘱）—— 一次目标是 `done` 且不伴随 `complete` 事件的 `task_write` 在生产载体上被**拒绝**（AC3① 的负控实跑），而留痕路径（`loop-complete-task.ts`）仍能一次成功并落事件。⛔ **只把这件事写进文档/注释 ⇒ 不算完成**（硬规则 9：可见性 ≠ 执行 —— `loop-complete-task.ts` 的头注释已经是一句散文，它没能挡住 2026-09-30）。⛔ 只给 ac292 加一条豁免 ⇒ 不算完成（那是本条要消灭的形态）。

## Touches

- `packages/quay/test/mcp-server.test.mjs`
- `packages/quay/test/mcp-server.test.mjs`
- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/src/gate/lifecycle.ts`
- `plugin/scripts/loop-complete-task.ts`
- `packages/quay/test/mcp-handlers.test.mjs`
- `packages/quay/test/lifecycle-a2b-loop-nometer.test.mjs`
- `tasks/gap-silent-completion-path-writes-no-gate-event.md`

## Evidence

### AC1 — 现状固化·生产载体（develop，窗口 2026-09-30T00:00:00Z..2026-10-01T00:00:00Z，committer date UTC）

谓词：逐 commit `git show <sha> -- tasks/` 取 `^\+status: done$` 的 id，再对该 id 在 `.quay/gate-events.jsonl` 取 `gate=="complete" && verdict=="pass"`。
窗口内扫描 213 个 commit。**分母 = 17**，**分子 = 16**，**差集 = 1**：

| 写入路径 | 翻转数 | 有 complete 事件 | 无 |
|---|---|---|---|
| driver 机械 fan-in | 16 | 16 | 0 |
| 裸 `task_write`（Provider ABI） | 1 | 0 | **1** |

差集那一条逐字：`0f784470f` / `gap-ac292-criterion-carrier-absence-not-evaluated` / subject `tasks: gap-ac292-criterion-carrier-absence-not-evaluated task_write by cli:3245175`。
（机械 fan-in 的 16 条 id 与 sha 见执行日志 `.quay/ac1-enumerate.mjs` 输出；结论与 Finding 逐条一致。）

### AC2 — 负控制·判据能取假

同一谓词对**已知有**事件的落地 `45e9bdab1` 干跑：命中 **1** 条 —— `gap-ac251-resident-unified-host-dead-no-restore`，其 `complete` 事件 = YES。
⇒ 谓词活着（非恒零）：AC1 的零计数不是仪器故障。

### AC3 — 处置可核：① 修掉（写侧拒绝 + 留痕路径仍通）

**负控（生产载体实跑）**：真仓库 `/data/home/yale/work/quay`（真 tasks 存储、真 native provider、本分支的 Core 代码），真 `quay mcp` 子进程：

```
$ node .quay/ac-silent-negctl.mjs gap-silent-completion-path-writes-no-gate-event
isError = true
refused: task_write cannot set status=done without the completion channel (gap-silent-completion-path-writes-no-gate-event).
  … Two sanctioned routes: (a) lifecycle_complete …  (b) task_write with completeReason:"<why>" …
status after = ready
task file md5: 5044e5f5ffcbab807ae4f810817a8012 -> 5044e5f5ffcbab807ae4f810817a8012 (UNCHANGED)
complete-event lines for task: 0 -> 0 (UNCHANGED)
```

**正控（留痕路径一次成功并落事件）**：真 workspace + 真 store（`/tmp/ac-silent-completion-evidence`），跑 shipped `plugin/scripts/loop-complete-task.ts`：

```
$ loop-complete-task.ts --root <ws> --task gap-evidence-ready --verified-by "verification-round: suite green + AC/DoD checked"
PASS — status=done (loop)                                                     exit=0
$ loop-complete-task.ts --root <ws> --task gap-evidence-needs-human --out-of-band --reason "blocker was infrastructure, …"
PASS — status=done (out-of-band, needs-human → done)                          exit=0
gate-events.jsonl:
  {pipeline_id: gap-evidence-ready,     gate: complete, verdict: pass, payload: {from: ready,       to: done, verifiedBy: "verification-round: …"}}
  {pipeline_id: gap-evidence-needs-human, gate: complete, verdict: pass, payload: {from: needs-human, to: done, verifiedBy: "blocker was …", via: out-of-band}}
```

**同面负控**：同一 needs-human 任务走**门控**路径（无 `--out-of-band`）⇒ `illegal transition: needs-human cannot complete (must be ready)`，exit 1 —— 证明 out-of-band 那一次不是空转。
**理由必填的负控**：`--out-of-band --reason "nope"` ⇒ `out-of-band completion refused: reason must carry ≥8 non-whitespace chars (got 4)`，exit 1，且该任务 status 仍为 `needs-human`、事件数 0。
**回归钉**：`packages/quay/test/mcp-handlers.test.mjs` 3 例（拒绝/理由太短/通道正控）、`packages/quay/test/mcp-server.test.mjs` step 7 增负控 + 事件断言。

### AC4 — 5b 同载体扫描：predecessor 路径表 #1–#6 逐条重扫（位置锚定 grep，命中数 + 前 3 条）

| # | 路径（当前落点） | 写 complete？ | 判据落点 |
|---|---|---|---|
| 1 | 机械 fan-in flip `plugin/scripts/worker-fan-in.ts:865/:880` `patchStatusField(…,"done")`（命中 6），写事件 `appendCompleteGateEvent` 定义 `:916` + 调用 `:1806`（`worker-driver.ts:5093` 同源，命中 3） | **是** | 覆盖率判据（历史）+ 本任务不改 |
| 2 | AC78 workflow 语义兜底 `plugin/workflows/fan-in-execute.js:849` `sed 's/^status: ready$/status: done/'`；`complete-gate-event-block` `:919–:935` 经 `worker-driver.ts --append-complete-gate-event` 调同一函数（命中 4） | **是** | 同上 |
| 3 | QENG 生命周期 `packages/quay/src/gate/lifecycle.ts`：`runComplete :208`、`runCompleteLoop :276`、**本任务新增 `runCompleteOutOfBand :336`**，三处均 `mkLifecycleEvent({gate:"complete",verdict:"pass"})`（`gate: "complete"` 命中 3） | **是** | 代码内单一写点 |
| 4 | outer loop 完成 `plugin/scripts/loop-complete-task.ts` → `runCompleteLoop` / `runCompleteOutOfBand`（命中 7） | **是**（本任务为其补上 `--out-of-band` 一次调用形态） | 同上 |
| 5a | Core MCP `task_write` 的 `done` 臂 `packages/quay/src/mcp-handlers.ts` | **写侧已关**：无 `completeReason` ⇒ `isError:true`；带 ⇒ 经 `runCompleteOutOfBand` 落 `complete` 事件 | 本任务新增守卫 |
| 5b | native provider CLI `quay-native task edit --status done`（`packages/quay-native/bin/quay-native.ts:374`） | **仍未关（实测）**：`needs-human → done` exit 0，该 id 的 `complete` 事件数 = 0 | ⛔ 未修：见下方「残留」 |
| 6 | 直接手改 `tasks/*.md` | 否（政策禁止）；由 `stale-ready-audit.ts` 的 `bypassComplete`（`:78/:132`）+ 覆盖率判据检测 | 检测，非写侧 |

**残留（明记，不掩饰）**：#5b（native provider 自己的 CLI/MCP 直写）仍是静默路。不修的理由是任务给的约束 —— **provider-agnostic**：把「到达 done 要过闸」写进 provider 会把 gate 语义漏进每个后端；**且**修在 store 层会直接打断闸引擎自身（`runComplete`/`runCompleteLoop` 正是经 store 写 `done`）。其**后果**（静态闸 fail-closed 卡住全部 code delta）归同批 sibling 任务 `gap-coverage-miss-fail-closed-stops-code-landings`。

### AC5 — 本任务自身的门

`bash scripts/test.sh --for-task gap-silent-completion-path-writes-no-gate-event --allow-thin` ⇒ 见下方「scoped gate」记录（绿）。

### 单元/回归实跑

```
node --test packages/quay/test/mcp-handlers.test.mjs      5 pass / 0 fail（含 3 个新用例）
node --test packages/quay/test/mcp-server.test.mjs        1 pass / 0 fail（step 7 增负控 + 事件断言）
node --test packages/quay/test/lifecycle*.test.mjs       55 pass / 0 fail
npx tsc --noEmit -p packages/*/                          clean（4 包）
```