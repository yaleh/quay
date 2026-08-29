---
id: gap-mechanical-fan-in-result-single-authoritative-structured
title: 机械 fan-in 结果单一权威结构化——final_state 从 ff 结果派生（不重读主检出陈旧 status）、reason 结构化
  verdict（不裸流）、suite 状态单一真源（D5/D6/D7 同根）
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

## Proposal

`runMechanicalFanIn`（`plugin/scripts/worker-driver.ts`）内部已产出丰富、分步、结构化的结果（outcome / step / 每步 verdict / suiteOutcome / landedSha）。但落盘时这个富结构被投影到三个 ad-hoc、有损或陈旧的载体上，丢掉结构。2026-08-28/29 的 14h fan-in 停摆暴露了三个同根缺陷：

1. **D5 — 「landed 却记成 exited-not-landed」**（`worker-driver.ts:702` `computeLandingState` + `:1883` `syncDocBranchToDevelop`）：落地判定用 `readTaskStatus(主检出)` 验证 `status=done`，但主检出停在 `main/manager-doc`（doc-only 工作分支、合法滞后 develop），flip-done + ff 推进的是 develop。`syncDocBranchToDevelop` 是 best-effort + 静默 `catch {}` 的补丁，冲突即假 exited-not-landed。实证 2 条：retire 04:26、archguard 05:10 均 `mfi.outcome=landed` 却 `final_state=exited-not-landed` + `failure_reason="task status=ready (not done)"`。

2. **D6 — reason 字段 lossy**（`worker-driver.ts:1759` `fail()`）：`reason = (a.stderr || a.stdout).trim()` 只取单流（stderr 优先，丢弃含真正测试结果的 stdout）+ 裸流 dump（MODULE_TYPELESS 警告占满）+ 不指日志文件。实测 12/18 scoped-gate、5/5 anti-drift 失败从记录无法定位真实原因——判「fix 是否完整」这件事本身不可靠（硬规则 3b：有损投影）。

3. **D7 — suite 状态两投影不对账**（`worker-driver.ts:1830` suite 步只写 `mfi.suiteOutcome` + `writeSuiteCapture`，不写 `.quay/full-suite-state.json`）：规范状态文件停在 28h 前，「退休已修 suite 绿」读的是 mfi 而非规范文件。**nuance**：`mirror-full-suite-state.ts`（`gap-full-suite-state-stale-no-writer`）已处理旧 workflow 路径，但机械 fan-in 路径未接；且 bucket-green ≠ full-green，收敛时须保留这个语义区分（不能简单让 bucket 跑写覆盖 full-suite-state.json）。

**正确机制（单一正解，不是三个 patch）**：`runMechanicalFanIn` 的结果应成为「这次 fan-in 发生了什么」的**单一权威结构化记录**，下游信号全部从它**派生**——`final_state` 从 ff 结果（landedSha 是 develop tip/祖先）派生、`reason` 是结构化 per-step verdict、suite 状态只有一个权威源。三者共享一次对 `MechanicalFanInResult` shape 的重构。

## Plan

1. 定义 `MechanicalFanInResult` 的结构化 shape：每 step 一个 verdict 对象 `{ step, verdict, exitCode, summary, logFile }`；`fail()` 产出该 verdict，不再 `(a.stderr || a.stdout).trim()` 裸流。裸流 dump 进 `logFile`，记录里留指针。
2. D5：`computeLandingState` 的落地验证改从 ff 结果派生——「landedSha 是 develop tip/祖先 ∧ 无残留 worktree」，不再读主检出工作分支的 `readTaskStatus`。`syncDocBranchToDevelop` 补丁随之退役或降级为无关紧要。保留「不信 exitCode、读独立量」原则（硬规则 4b），只是换成读**正确的**独立量（git develop 状态，非主检出分支上的 `tasks/*.md`）。
3. D7：先枚举 mechanical fan-in 路径的 suite 状态写者/读者（`spawnSuiteAndWait` → `--buckets` → suite-bucket-select vs full-suite-runner vs `mirror-full-suite-state.ts`），确认精确缺口，再收敛到单一真源（保留 bucket-vs-full 语义）。⛔ 不预判是「机械 fan-in 写规范文件」还是「消费者改读 mfi/派生 ledger」——枚举完再定。
4. `worker-driver.test.mjs` 覆盖三处新 shape（含 D5 的「主检出停 doc-only 分支仍判 landed」负例、D6 的「reason 无 MODULE_TYPELESS 噪声」、D7 的「落地后权威 suite 载体非陈旧」）。

## Acceptance Criteria

- [ ] AC1（D5，能取假，读生产载体）：在一条 `mfi.outcome=landed` 且 `landedSha` 是 develop tip/祖先的落地记录上，`final_state` = `completed`（不是 `exited-not-landed`）。构造「主检出停 doc-only 分支、不 sync」的负例仍判 landed（验证不再依赖主检出分支）。
- [ ] AC2（D6，能取假，读生产载体）：`worker-outcome.jsonl` 中 `mechanical_fan_in.step` ∈ {scoped-gate, anti-drift} 的失败记录，其 reason 含结构化 verdict（step/verdict/exitCode/summary/logFile），且不含 MODULE_TYPELESS 噪声；能从记录定位「哪个测试失败」。
- [ ] AC3（D7，能取假，读生产载体）：机械 fan-in 的 suite 运行后，权威 suite 状态载体的 finishedAt 与 `mfi.suiteFinishedEpoch` 一致（不再 28h 陈旧）；且 bucket-run 与 full-run 的结果在载体上可区分（不把 bucket-green 伪造成 full-green）。

## Definition of Done

`runMechanicalFanIn` 结果成为单一权威结构化记录，final_state / reason / suite 状态三处下游全部从它派生；`worker-driver.test.mjs` 覆盖新 shape 且全量 suite 绿；一条真实落地记录上 `final_state=completed`（D5 的假 exited-not-landed 负例消失）。

## Touches

- plugin/scripts/worker-driver.ts（runMechanicalFanIn / fail / computeLandingState / computeOutcome / MechanicalFanInResult）
- plugin/test/worker-driver.test.mjs
- tasks/gap-mechanical-fan-in-result-single-authoritative-structured.md（自身）
