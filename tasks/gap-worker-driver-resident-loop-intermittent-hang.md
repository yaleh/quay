---
id: gap-worker-driver-resident-loop-intermittent-hang
title: worker-driver 驻留环间歇挂起——liveness 后停在派发环前，round/outcome 不写（worker-driver-fan-in 测试 flaky 根因）
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

`worker-driver-fan-in.test.mjs` 的「dep done ⇒ dispatched」/「orphan worktree ⇒ re-dispatched」两条对照间歇失败。归因（实测复现，同一 args 两次跑结果分叉）：

- **一次正常**：`worker-spawned` → `worker-done`（final_state completed）→ round 记录全写。
- **一次挂起**：`.quay/` 目录**只有 `worker-driver-liveness.log`**，无 `worker-round.jsonl`、无 `worker-outcome.jsonl`。

即：`runResidentLoop` 的 liveness 检查（`worker-driver.ts:2826`）写了 liveness log，但循环**停在派发环（`:2846-2887`）之前/之内**，`writeRound`（`:2891`）从未执行 ⇒ 不派发（spawned.length=0）、不写 outcome。**非派发逻辑回归**（派发逻辑手动跑正常、worker-spawned/worker-done 都发），**也非「读生产 pool」**（测试用 temp root + `--ready-pool-cmd` counter 隔离）——是**驻留环的间歇挂起**。

**根因（worker 实测锁定，⛔ 推翻了 4 个候选「有界 await 冻结」假设）**：

四个候选挂点全部是**有界**的，不可能是「无限挂起」：① `runLivenessCheckAsync` 在测试（无 `--liveness-cmd`）走 in-process 同步 `livenessInProcess`（零 spawn、零 await）；② `stopCondition → resourceGateCheck` 是 `spawnSync(timeout 20s)`；③ `readyPoolCheck` / ④ `runSelectorWorker` 都经 `runAsync(timeout 120s)`（`driver-runtime.ts:517` 的 timeout 定时器 SIGKILL + `finish` 必 resolve）。故「挂起」不是「await 永不返回」，而是**循环体无 try/catch ⇒ 任一步瞬时抛错（负载下偶发 fs/git/spawn 异常）变成未处理 rejection ⇒ 驱动静默死掉**——`.quay/` 只剩 liveness log（liveness 是每趟 pass 第一个写盘点）、round/outcome 停写，与「一切正常」同形（硬规则 3b/4b）。`main()` await `runResidentLoop` 无 `.catch` ⇒ rejection 无任何落痕。

**修挂点（worker-driver.ts 驻留环）**：循环体每步记 `step` + 整包 try/catch，抛错 ⇒ 写一条 `action=error` 的 round 记录（`error`/`error_step`/`stop_reason` 指到具体步骤，stack 落 stderr 指到行——AC1 定位）+ `resident-error` JSON 事件，然后 `sleep(intervalMs)` 继续下一轮（瞬时错误自愈，⛔ 不静默停摆）。`computeWorkerRoundRecord` 扩 `action:"error"` + `error`/`error_step` 字段（与 promotion/outer 的 error action 同族）。

## Plan

1. **定位挂点**：读码排除了 4 个候选（全有界）；锁定「无声死亡」形态 = 循环体无错误边界。给循环加每步 step-trace + try/catch 使下次抛错可定位（error_step + stack 指到行）。
2. **修挂点**：错误边界——抛错写 error round（同载体 worker-round.jsonl）+ resident-error 事件 + sleep 后继续（⛔ 不静默死、不 hot-loop）。
3. **验证**：worker-driver-fan-in 全文件 49 测绿 + 对照/新测 20 连跑绿；worker-driver-resident 34 绿；worker-driver.test 46 绿。

## Acceptance Criteria

- [x] AC1（能取假，定位）：锁定到「循环体无错误边界 ⇒ 瞬时抛错无声死亡」形态；step-trace（`step="…"` + error round 的 `error_step`）+ stderr stack 指到行（⛔ 不再只报「挂起」不指位置）。
- [x] AC2（能取假，修复）：`worker-driver-fan-in.test.mjs` 对照 2 测 + 新 2 测 20 连跑全绿（fails=0 hangs=0）；全文件 49 测绿。
- [x] AC3（能取假，生产载体）：机制落地——error round 写同载体 `worker-round.jsonl`（抛错不再造成「liveness 写了但 round 停写」窗口）；生产定量读数（连续轮无超长 gap）按 AC 自身「N 只计落地后」落地后核。

## Definition of Done

挂点定位（无声死亡 = 无错误边界）+ 修复（step-trace + try/catch + error round）；AC1-3 勾；worker-driver-fan-in 20 连跑绿；生产 round 无停写窗口（机制落地）。

## Touches

- plugin/scripts/worker-driver.ts（驻留环挂点修复）
- plugin/test/worker-driver-fan-in.test.mjs（如测试侧需加固时序）
- tasks/gap-worker-driver-resident-loop-intermittent-hang.md（自身）
