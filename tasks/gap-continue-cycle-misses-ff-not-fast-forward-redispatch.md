---
id: gap-continue-cycle-misses-ff-not-fast-forward-redispatch
title: continue-cycle 漏 ff-not-fast-forward 续做识别——RECOMMENDED 的 ff-failed 任务 2h 不重派
status: needs-human
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

`gap-retire-governance-group-merge-into-bucket` 现 slot-refill **RECOMMENDED**（非 deferred、非 backoff-持有），但 last outcome 13:33 step=ff「FF FAILED — not a fast-forward」后 **~2h 不重派**。CONTINUE note（continueConflictResolutionNote）已教 ff-not-fast-forward 的消解（merge develop 再 ff 再 exit），但 driver 的 continue-cycle **未把 ff-failed 任务识别为续做状态** → 静置 RECOMMENDED 不派。

**根因方向**（需 inner 核）：continue-cycle 的 exited-not-landed 续做识别只覆盖部分 step（如 merge-develop 冲突 / suite red），未覆盖 `step=ff: not a fast-forward`——该 step 的 worker 退出被记为 exited-not-landed，但续做判定漏了它，任务回到 ready 池却不再被派。

## Plan

核 `worker-driver.ts` continue-cycle 的 exited-not-landed 识别清单，确认 `step=ff: not a fast-forward` 是否在续做触发集内；若漏，补上（ff-failed → CONTINUE 重派，merge develop 再 ff）。

## Acceptance Criteria

- [ ] AC1（能取假）：ff-not-fast-forward 失败的任务被 continue-cycle 重派（RECOMMENDED 后不再静置，worker 收到 merge develop 再 ff 的续做 prompt）；（⛔ 仍静置 RECOMMENDED 不派 ⇒ 假）。
- [ ] AC2（能取假，单测）：worker-driver.test.mjs 断言「step=ff: not a fast-forward 的 exited-not-landed 记录触发续做识别」，改掉任一 ⇒ 红。

## Definition of Done

continue-cycle 覆盖 ff-not-fast-forward 续做识别；AC1-AC2 全勾；全量 suite 绿；ff-failed 任务不再静置。

## Touches

- plugin/scripts/worker-driver.ts（continue-cycle 续做识别补 ff-not-fast-forward）
- plugin/test/worker-driver.test.mjs（AC2 单测）
- tasks/gap-continue-cycle-misses-ff-not-fast-forward-redispatch.md（自身）

## Needs-Human

**执行 2026-08-30T17:31:22.265Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=scoped-gate: test-isolation-check — 552 glob file(s), 26 current violation(s) [fixed-path-write=12 shared-build-artifact-write=1 spawns-test-sh=7 process-exit-1=6 mkdtemp-no-cleanup=0 live-data-dir-write=0 shared-root-mkdtemp=0]
  packages/quay-native/test/gate-checked-state.test.mjs:fixed-path-write  (line 26) const tasksDir = path.join(__dirname, ".tmp-gate-checked-state-test");
PASS: all 26 violation(s) are baselined in plugin/test-isolation-violations.txt; the list can only get SHORTER (no additions, no growth, no stale entries).
test-impl-census: checked 552 test files · clean 552 · impl-deleted 0
TOUCHES-DIR-GLOB-HINT: 1 directory-level tasks/*.md glob(s) — enumerate concrete files or add（已知全局锁）(hint only, not a violation)
✔ computeOutcome — exit 0 + landed=true ⇒ completed; landed=false ⇒ exited-not-landed; landed=null ⇒ fail-closed (gap-worker-driver-fake-completion-exit-0) (0.675355ms)
✔ D6 — fail 产出结构化 verdict（step/verdict/exitCode/summary/logFile），⛔ 不再 (stderr||stdout).trim() 裸流 (2.945793ms)
✔ AC1 (gap-scoped-gate-reason-stderr-drops-stdout) — scoped-gate red reason 含 stdout 失败签名（Could not resolve / not ok），⛔ 只剩 stderr 良性 preamble (1.101937ms)
✔ AC1 (gap-step-trace-reason-captures-gate-stdout) — ac-gate/anti-drift 失败时 step-trace reason 含 stdout 判词（checked/violation），⛔ 纯 MODULE 警告 (0.554867ms)
✔ control state — default / merge / halt / preference / forceDispatch / fail-closed read (4.051441ms)
✔ AC129 pure — resourceGateCheck: exit 0 ⇒ GO; exit 1 ⇒ WAIT (fail-closed) (231.681965ms)
✔ runLivenessCheck — checked/deaths/running semantics (checked=false = NOT evaluated, ⛔ not healthy) (208.246095ms)
✖ liveness wiring — resident loop calls the liveness checker each round (Finding AC2 no-caller fix) (26472.237923ms)
✔ enumerateLiveWorkerCmdlines — real /proc scan finds a spawned fake worker (fail-soft otherwise) (105.316467ms)
✔ AC1/AC2 (gap-archguard-metrics-mirror-non-blocking) — 源面：镜像写失败 fail-open（⛔ 不再 return failClean('archguard-metrics')），结构判定仍 fail('archguard-structure') 挡 (5.997512ms)
✔ parseIntervalMs — default 30000; small value; invalid ⇒ default (fail-closed to the default cadence) (1.191888ms)
✔ parse helpers — quick-death-ms/backoff-base-ms/backoff-max-ms/backoff-threshold fail-to-default (0.529788ms)
✔ AC3 (gap-fan-in-ac-precheck-before-suite) — AC 未全勾 ⇒ suite 前 fail-fast 拒翻（step=ac-precheck，无 suite 运行记录） (984.848049ms)
worker-driver: writeSuiteCapture failed (fail-open — fan-in continues, ff gate falls back to the authoritative source): EEXIST: file already exists, mkdir '/tmp/mechfanin-capfail-V4xwNr/capture-blocker'
✔ AC1 (gap-write-suite-capture-non-blocking) — capture 写失败（父目录是文件）⇒ fan-in fail-open 落地（⛔ 不因观测写失败弄红） (1487.67951ms)
ℹ fail 1
✖ failing tests:
✖ liveness wiring — resident loop calls the liveness checker each round (Finding AC2 no-caller fix) (26472.237923ms)
