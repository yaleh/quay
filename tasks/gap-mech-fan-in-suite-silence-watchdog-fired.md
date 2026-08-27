---
id: gap-mech-fan-in-suite-silence-watchdog-fired
title: 机械 fan-in suite 步 15min 静默看门狗触发——suite 真挂死 vs 看门狗对正常静默误杀未分（web-session
  生产任务 15:15 suite 步 red；旧看门狗任务方向相反已作废）
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

机械 fan-in step 7（suite）跑 `scripts/test.sh --buckets <task>`（全量 suite，实测 19+ min），由 `suite-driver.ts` 的静默看门狗兜底（`SILENCE_MS_DEFAULT = 15 * 60_000`，即 15min 无输出 ⇒ 判挂死 ⇒ SIGKILL）。首个机械 fan-in 生产任务 `gap-web-session-drops-queue-operation-records`（15:15）在 suite 步 red：`worker-outcome.jsonl` 记 `mechanical_fan_in:{outcome:red,step:suite,reason:"suite hung: silence watchdog killed the suite (no output ≥ silence timeout)"}`。

**两个可能方向（未分，须先分再修，硬规则 3b：不得与「真挂死」同形）**：
- **A. suite 真挂死**（看门狗正确兜住）→ 有底层挂死根因待查。前身任务 `gap-fan-in-per-task-suite-no-silence-timeout-watchdog` 已诊断出同类根因（`--test-timeout=0` + 某 `waitFor()` 只保护一种 await 写法），但那是 ac143 的；web-session 是不同任务，未必同根。
- **B. 看门狗误杀**（suite 在跑但 ≥15min 输出不可见）→ 阈值/观测面对全量 suite 的正常静默段不适用。对照：已退役 `full-suite-runner.ts` 用 `SUITE_SILENCE_MS=15min` + `SUITE_MAX_RUNTIME_MS=45min`，即「15min 静默判挂」本就是给「最长可跑 45min」的外层全量套件设计的；把它平移到 per-task `--buckets` 套件，静默段语义未必成立。

**⊢ 无人覆盖（立案前按机制词 dedup 核实）**：`gap-fan-in-per-task-suite-no-silence-timeout-watchdog` 已 `superseded`（`superseded_by: gap-fan-in-driver-mechanical-orchestration`），且方向相反——旧 bug = detached suite 完全没看门狗 → 无限等；新 bug = 有看门狗之后仍 15min 触发。`gap-suite-lifecycle-driver-kind`（引入 suite-driver 的 feature 任务）已 done，非 bug 任务。

## Plan

1. **先分方向**：取 15:15 那次 suite 的日志/进程态（`suite-driver.ts` 的 `logFile` / `--buckets` 输出），判定是「进程真的卡住零输出」还是「进程活着但输出没被看门狗看到」。
2. **按方向修**：A → 查底层挂死根因（复用前身 ①② 诊断，⛔ 不假设与 ac143 同根）；B → 修阈值/观测面（⛔ 不盲设数值——硬规则 4 推论：成本结构未知前不设阈值；对齐 `full-suite-runner.ts` 的静默/最大时长双阈值语义，或让静默检测读「本轮 suite 是否仍在推进」的直接量）。
3. 修完给负控制：一个「真挂死」样本仍被看门狗杀（A 方向）或一个「长静默但正常」样本不被杀（B 方向）。

## Acceptance Criteria

- [ ] AC1（能取假，方向已分）：A/B 由一条可区分的读数判定（读日志/进程态，⛔ 非「看门狗触发了」这一同形结论）；（⛔ 仍只有「看门狗 fired」而无 A/B 证据 ⇒ 假）。
- [ ] AC2（能取假，修对方向）：修后 mechanical fan-in suite 步对「非挂死」suite 不再 red at suite（若 B），或「真挂死」不再无限等（若 A）；含负控制（修的方向正确，另一方向不误伤）；（⛔ 仍 red at suite 且无方向证据 ⇒ 假）。

## Definition of Done

A/B 方向已分；根因已修；机械 fan-in suite 步不再因静默看门狗误杀/漏杀而 red（负控制通过）。

## Touches

- plugin/scripts/suite-driver.ts（静默看门狗阈值/观测面，B 方向；或挂死根因侧，A 方向）
- plugin/scripts/worker-driver.ts（suite 步 silenceMs 透传，如涉）
- plugin/test/suite-driver.test.mjs（静默看门狗 + 长静默负控制）
- tasks/gap-mech-fan-in-suite-silence-watchdog-fired.md（自身）
