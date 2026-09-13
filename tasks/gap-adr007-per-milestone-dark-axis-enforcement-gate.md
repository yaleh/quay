---
id: gap-adr007-per-milestone-dark-axis-enforcement-gate
title: 兑现 ADR-007 的 per-milestone 暗轴记录承诺——todo→ready/ready→done 门加机械检查
status: todo
labels:
  - gap
  - finding
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

`adr/ADR-007-instrument-the-dark-axes-lg-ld-ls.md` 的 enforcement 注释自 2026-07-20 起写明「per-milestone predicate」(检查里程碑/任务的 DoD 是否记录了一次 L_D/L_G 读数、或显式的"该轴仍暗"声明,三者皆缺则 fail-closed)仍是 **STILL FUTURE WORK**——两个月过去从未落地。

`experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` 自 2026-07-22 起未再被改动,它只验证"仪器自身没腐烂"(RED/GREEN fixture 回归),从未验证"某个具体任务真的看过它"。`exp5-M-CRYST-G1`(已 done)证明了三个探针脚本(`plugin/scripts/git-lens-l-d-code-doc-ratio.ts` / `git-lens-l-g-structural-drift.ts` / `git-lens-l-s-behavior-variance.ts`)本身可用、且已回收进 `plugin/scripts/`(`gap-experiment-legacy-reclaim-and-touches-heuristic`),`gap-archguard-zero-production-calls` 也证明了 archguard 现在能真实调用并产出结构信号——但**这两组已落地的工作只解决了"仪器能用",从未解决"todo→ready / ready→done 的门是否强制要求任务体记录过一次读数"**。立案前搜索(`task_list` 搜 "ADR-007"/"per-milestone"/"dark axes"/"per-milestone predicate")均未命中覆盖这个具体机制缺口的任务。

`docs/references/维度边界与结晶——从熔融实现中发现原则.md` §10.3/§10.4 进一步指出:量化读数如果不接进一个会 fail-closed 的判据,就永远停留在"仪器学论文"层面,不会真正影响任务能否落地。

## Acceptance Criteria

- [ ] AC1: 新增一个可独立调用的检查器(建议 `plugin/scripts/dark-axis-record-check.ts`,登记进 `plugin/scripts/capability-catalog.sh`),对给定任务 id 输出三态之一:`RECORDED`(任务体含可解析的 L_D/L_G 读数,须打印解析到的具体数值)、`DISCLAIMED`(任务体含显式"该轴仍暗,理由:..."声明)、`MISSING`(两者皆无)。命令:`node --experimental-strip-types plugin/scripts/dark-axis-record-check.ts <task-id>`;`RECORDED`/`DISCLAIMED` → exit 0,`MISSING` → exit 1。
- [ ] AC2(负控制): 该检查接入 ready→done 的落地路径(`packages/quay/src/gate/registry.ts` 新注册一个 named gate,或接入 `packages/quay/src/gate/lifecycle.ts` 的 `runComplete`/`runPromote` 路径)。造一个 `status: ready`、任务体既无暗轴读数也无"该轴仍暗"声明的任务,对它调用 `lifecycle_complete`(或等效 `quay complete <id>` / `gate_run --gate <新门名>`)必须返回 `ok:false`,且 `task_get` 读回其 `status` 仍是 `ready`(未被写成 `done`)。
- [ ] AC3(正控制): 同一任务补一条真实 L_D/L_G 读数(例如粘贴一次 `git-lens-l-g-structural-drift.ts` 或 archguard 的实际输出数值)或补一条显式"该轴仍暗,理由:..."声明后,同样的 gate 调用必须返回 `ok:true` 并成功写 `status: done`。
- [ ] AC4(生产载体读数,防 fixture-only 满足): 落地后,至少 1 个真实(非本任务自身、非测试 fixture)任务经由该 gate 完成过 ready→done 转换,且其记录的暗轴读数/声明产生时刻晚于本任务实现落地的 commit——验证:比较该任务体读数段落引用的 commit/时间戳与 `git log -1 --format=%H -- packages/quay/src/gate/registry.ts`(或实际改动的实现文件)的落地 SHA,且 `.quay/gate-events.jsonl` 中存在一条该任务的 complete/promote GateEvent,其时间戳晚于落地时刻。若把该 gate 检查关掉后同一 AC 仍能被满足(即读数是靠 fixture/注入数据单独撑起来的),则本 AC 判假(呼应 `gap-phase-boundary-differential-accounting` 的教训——不能只让 fixture 注入满足)。

## Definition of Done

- 一个真实机件(gate registry/lifecycle 路径)对 todo→ready 或 ready→done 强制要求暗轴读数或显式声明,fail-closed;AC1-4 全部勾选,AC4 的生产载体读数必须来自实现落地**之后**的真实调用,不能只由本任务自己的测试 fixture 满足;
- `adr/ADR-007-instrument-the-dark-axes-lg-ld-ls.md` 的 enforcement 注释从"STILL FUTURE WORK"改写为指向本任务落地的真实文件/函数;
- 涉及改动的测试套件(`scripts/test.sh`)在改动后至少连续 2 次绿。

## Touches

- adr/ADR-007-instrument-the-dark-axes-lg-ld-ls.md
- plugin/scripts/dark-axis-record-check.ts
- plugin/scripts/capability-catalog.sh
- packages/quay/src/gate/registry.ts
- packages/quay/src/gate/lifecycle.ts
- plugin/scripts/ready-pool-check.ts
- plugin/test/dark-axis-record-check.test.mjs
- tasks/gap-adr007-per-milestone-dark-axis-enforcement-gate.md
