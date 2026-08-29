---
id: gap-writestate-atomicity-split
title: write*State 原子性分裂——6 处 state 写两派并存（2 原子 + 4 非原子），不一致本身无人知晓
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

6 处 state 写实现分裂成两派，且不一致本身无人知晓：
- **原子（tmp + renameSync）**：`driver-shared.ts writeControlState`、`inner-blocked-signal.ts writeRulerObserverState`
- **非原子（直接 writeFileSync）**：`mirror-full-suite-state.ts writeMirrorState`、`red-window-triage.ts writeState`、`runner-state-write.ts writeState`、`suite-state-trigger.ts writeSuiteState`

6 个里只有 `writeMirrorState` 注释解释了为何非原子安全（"消费者只读终态，不读写中态"），**另外 3 个非原子写没有任何理由说明**——可能是疏忽而非设计决定。且已存在一份私有实现 `proposal-convergence.ts:1614` 的 `_atomicWriteJson`（下划线前缀、未导出）。

## Plan

抽 `writeJsonAtomic<T>(path, value)` 公共实现（tmp + renameSync，收编 `_atomicWriteJson`，放 `plugin/scripts/write-json-atomic.ts`），6 处全迁（driver-shared / inner-blocked-signal / mirror-full-suite-state / red-window-triage / runner-state-write / suite-state-trigger）；对那 3 处无理由的非原子写，实现时逐处追调用方读时序，判断「并发读者能否观察到半写态」——若能，迁移是正确性修复；若不能，注释写明为何非原子安全（同 `writeMirrorState` 先例）。负控制测试放 `plugin/test/writestate-atomicity-split.test.mjs`。⛔ 新建文件按上述命名落地，不另取名。

## Acceptance Criteria

- [x] AC1（能取假，公共实现）：一个导出的 `writeJsonAtomic` 存在，6 处 state 写全部改用它（grep 无裸 `writeFileSync` 写 state 文件）；（⛔ 仍有非原子写 ⇒ 假）。
      **证据**：`plugin/scripts/write-json-atomic.ts` 导出 `writeJsonAtomic<T>`；state 写全迁到它——任务列 6 处外，实现时按 AC1 的 grep 判据又抓到第 7 处（`suite-state-trigger.ts writeCrashState` 也写同一个 `full-suite-state.json`，任务「不一致本身无人知晓」正是这个形态）。grep 实测剩 2 处 `writeFileSync`，均非 state 文件：`inner-blocked-signal.ts:473`（`writeBlockedRecord` 阻塞信号，一次写不覆盖）与 `suite-state-trigger.ts:1173`（`memoPath` 备忘）；state 写零裸 `writeFileSync`。
- [x] AC2（能取假，负控制）：对迁移前非原子的 3 处之一构造并发读，迁移前能读到半写文件、迁移后读不到（tmp+rename 原子性保证）；（⛔ 迁移后仍能读到半写态 ⇒ 假）。
      **证据**：`plugin/test/writestate-atomicity-split.test.mjs` 两条——①原子：并发读 `writeJsonAtomic` 反复覆盖 4MB state 文件，torn=0（rename 原子性硬保证，非计时赌）；②负控制：同一并发读对 in-place `fs.writeFileSync` 读到半写态（torn>0），证明读器「咬得住」。实跑 `node --test` 2/2 pass。
- [x] AC3（能取假，理由完备）：那 3 处非原子写若判定安全，注释写明理由（同 writeMirrorState 先例）；若判定不安全，迁移为原子；（⛔ 无理由的非原子写仍存在 ⇒ 假）。
      **证据**：那 3 处无理由的非原子写（`red-window-triage.writeState` / `runner-state-write.writeState` / `suite-state-trigger.writeSuiteState`）逐处追读者，均判定不安全——三者的读者（`/tests` currentState、`collectFailureFiles`、`suite-state-trigger` 自身、代际守卫 `readStateRunId`）都能与写者并发读同一个 `full-suite-state.json`，故全部迁移为原子；已无「无理由的非原子写」。

## Definition of Done

`writeJsonAtomic` 公共实现落地；state 写统一（任务列 6 处 + 追加第 7 处 `writeCrashState`）；AC1/AC2/AC3 全勾；相关 state 写的测试绿（driver-shared / inner-blocked-signal 等原子写不回归）。

## Touches

- plugin/scripts/write-json-atomic.ts (new)（writeJsonAtomic 公共实现，收编 proposal-convergence 的 _atomicWriteJson）
- experiments/quay-perpetual-stream/scripts/write-json-atomic.ts (new)（SOURCE 副本，与 plugin/scripts 镜像字节一致）
- plugin/scripts/driver-shared.ts（writeControlState 迁移）
- plugin/scripts/inner-blocked-signal.ts（writeRulingObserverState 迁移）
- plugin/scripts/mirror-full-suite-state.ts（writeMirrorState 迁移）
- plugin/scripts/red-window-triage.ts（writeState 迁移）
- plugin/scripts/runner-state-write.ts（writeState 迁移）
- plugin/scripts/suite-state-trigger.ts（writeSuiteState + writeCrashState 迁移）
- plugin/scripts/proposal-convergence.ts（收编私有 _atomicWriteJson）
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts（SOURCE 副本，收编私有 _atomicWriteJson，与镜像字节一致）
- plugin/scripts/sync-vendor.sh（SYNC_SCRIPTS 增 write-json-atomic）
- plugin/test/driver-cli.test.mjs（KERNEL_DEPS 增 write-json-atomic.ts）
- plugin/scripts/capability-catalog.sh（write-json-atomic.ts 六表注册）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY scripts 296→297）
- plugin/test/writestate-atomicity-split.test.mjs (new)（原子写并发读负控制测试）
- experiments/quay-perpetual-stream/test/write-json-atomic.test.mjs (new)（SOURCE 副本 write-json-atomic.ts 的 loadbearing-test-gate 兄弟单测，ADR-001 clause 2）
- tasks/gap-writestate-atomicity-split.md（自身）

## Needs-Human

**执行 2026-08-28T17:03:02.959Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
