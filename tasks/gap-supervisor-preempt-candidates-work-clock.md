---
id: gap-supervisor-preempt-candidates-work-clock
title: supervisor-preempt-candidates.listPreemptible 仍读 startedAtMs（排队时钟）判 >90m
  preemptible——与 over90 work-clock 修复同口径不一致
status: done
labels:
  - gap
  - defect
  - follow-up
parent: null
children: []
extra: {}
---

## Finding

`gap-over90-clock-measures-queue-time-not-work-time`（已 done，84b1dc1f）把 OVER90 判定从排队时钟（`startedAtMs`，含 defer/排队段）迁移到工作时钟（`workStartedAtMs`），但**同口径兄弟站点 `plugin/scripts/supervisor-preempt-candidates.ts` 的 `listPreemptible` 仍读 `p.startedAtMs`**（line 83 `nowMs - p.startedAtMs > TASK_OVER_90M_MS`、line 87-88 同样），判 >90m preemptible 时排队段被计入——与 over90 修复前的错误同源。

**为什么同源**：preempt 判据与 OVER90 判据是同一类「这个任务是否真实超时/无进展」的时钟口径问题。over90 已实证：`startedAtMs` 是 bracket 开括号时刻（可能先于实际工作），defer/排队段混入后会把「排队久」误判成「工作超时」。preempt 同样会因排队时间误杀一个刚开跑的任务。

## 修复方向（接法留执行时）

`listPreemptible` 的 filter 与输出改读工作时钟：`(p.workStartedAtMs ?? p.startedAtMs)`——`kept`/`closed` 记录经 fast-mode-telemetry reconcile 已携带 `workStartedAtMs`（over90 修复的透传），未 defer 的任务回退 `startedAtMs` 字节不变。一行迁移 + 一个负控制测试。

## AC（draft）

- [x] `listPreemptible` 判 >90m 只计工作时钟（`workStartedAtMs ?? startedAtMs`），排队/defer 段不计入
- [x] 负控制：构造「defer 久 + 工作短」的 ledger 记录 ⇒ 不判 preemptible（与 over90 负控制同构）
- [x] 未 defer 记录回退 `startedAtMs` 行为不变（无回归）
- [x] 测试用 `node:test` 且带 `// @test-group governance`

## DoD（draft）

- [x] scoped 测试绿（`bash scripts/test.sh --for-task gap-supervisor-preempt-candidates-work-clock --allow-thin`）——outer 独立复核 13/13 @ 22:0xZ + B15 judge 独立复核 13/13
- [x] 完整套件绿（回归无破坏）——r41 green（round 41, 3244 pass / 0 fail, commit ed0308be = fan-in 树, 22:00:12Z 终）
- [x] over90 交叉标注：`gap-over90-clock-measures-queue-time-not-work-time` 的 AC3 follow-up note 指向本任务——:60 已追加「已落地」标注

## Evidence

- over90 AC3 note（`tasks/gap-over90-clock-measures-queue-time-not-work-time.md:60`）：`listPreemptible` 仍读 `p.startedAtMs`，`kept` 已携带 `workStartedAtMs`（reconcile 透传），一行迁移即可；列为 follow-up
- `plugin/scripts/supervisor-preempt-candidates.ts:83`：`.filter((p) => nowMs - p.startedAtMs > TASK_OVER_90M_MS && ...)` 排队时钟
- `plugin/scripts/supervisor-preempt-candidates.ts:87-88`：输出 `startedAtMs: p.startedAtMs`、`minutes: (nowMs - p.startedAtMs)` 排队时钟
- **实现（2026-08-11，inner 执行）**：`listPreemptible` 的 filter 与输出改读工作时钟 `(p.workStartedAtMs ?? p.startedAtMs)`（同 over90 口径）。`kept` 记录经 reconcileInFlight 已携带 `workStartedAtMs`（fast-mode-telemetry 透传）；未 defer 记录回退 bracket `startedAtMs`，行为字节不变。输出 `startedAtMs`/`minutes` 亦按工作时钟计算。
- **负控制实测（scoped run）**：`WORK-CLOCK — negative control: defer 80min + work 20min (100min bracket, 20min work) is NOT preemptible` ⇒ `listPreemptible` 返回 count=0（排队段不计入 90m，不判 preemptible）。正回归 `WORK-CLOCK — never-deferred 91min bracket is still preemptible` ⇒ count=1、minutes=91（未 defer 字节不变）。
- **scoped 测试结果**：`bash scripts/test.sh --for-task gap-supervisor-preempt-candidates-work-clock --allow-thin` ⇒ **PASS / EXIT 0**，`13 tests / 13 pass / 0 fail / 0 cancelled`（supervisor-preempt-candidates 全 13 例含 2 个新增 WORK-CLOCK 用例）。
- **over90 交叉标注已落地**：`gap-over90-clock-measures-queue-time-not-work-time` 的 AC3 follow-up note 已追加「已落地」标注（本任务即该 follow-up）。
- **closure（2026-08-11 外层）**：B15 judge（wf_2bc25014-cee，trigger=every-10-rounds，roundsSinceLastJudge=41）判 **ready**（premiseSound=true, all-checked, recommendation=promote to done）；r41 green（round 41, 3244 pass / 0 fail, commit ed0308be = 本任务 fan-in 树, 22:00:12Z 终）；scoped 13/13（外层独立复核 21:5xZ + judge 独立复核双证）；DoD 3/3 全勾；bracket 已 `--task-end outcome=done`。

## Touches

- plugin/scripts/supervisor-preempt-candidates.ts（`listPreemptible` 读 `workStartedAtMs ?? startedAtMs`）
- plugin/test/supervisor-preempt-candidates.test.mjs（负控制：defer 久 + 工作短不判 preemptible；未 defer 无回归）
- tasks/gap-over90-clock-measures-queue-time-not-work-time.md（AC3 follow-up note 勾为已落地）
- tasks/gap-supervisor-preempt-candidates-work-clock.md（自身：勾 AC + 贴证据）
