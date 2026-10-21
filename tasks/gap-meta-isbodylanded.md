---
id: gap-meta-isbodylanded
title: slot-refill 的 landed-implementation 闸把「完成框全勾」自报当落地证据 ⇒ 未删除的 ready 任务永久不可派
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
GOAL-907 唯一的推进任务 gap-ac911-src-root-forwarding-shim-deletion 处于 ready，但 slot-refill 以 reason=landed-implementation 永久排除它：landed = hasLandedImplementation(git 侧=false，命名该 id 的提交全是 task_write/merge 簿记) || isBodyLanded(任务体完成框 10/10 全勾=true)。isBodyLanded 是纯自报、无任何树侧证据，而该任务声明的 10 个 shim 一个都没删（AC-911 判据 fail，读数 12）⇒ 唯一能推进该 goal 的任务永不派发，readings 的 timeSeries 显示同一 verdict 已连续 20 轮未变（crossed，阈值 8）。

本轮读数（timeSeries.0.crossed）= `true`，采于 2026-10-21T05:09:26Z，由 meta-driver 机械采集。
⚠️ 机制词 `isBodyLanded` 命中【已完成】任务：gap-ac47-completion-predicate-consumer-fail-closed.md[done]、gap-fanin-suite-gate-no-baseline-equivalent-exception.md[done]、gap-phantom-killer-false-negative-id-not-in-commits.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j;try{j=JSON.parse(d)}catch(e){console.error("unreadable slot-refill output");process.exit(2)}const hit=(j.deferred||[]).find(x=>x&&x.id==="gap-ac911-src-root-forwarding-shim-deletion"&&x.reason==="landed-implementation");if(hit){console.error("still deferred as landed-implementation while its 10 shims are undeleted");process.exit(1)}console.log("OK: not swallowed by the body-side landed gate")})'` ⇒ 红→绿：今天 exit 1（该任务仍被 landed-implementation 吞掉）；修好后 exit 0——「完成框全勾」不再单独构成落地证据，该任务回到候选（或已如实落地）。判据读 slot-refill 的生产输出，不看源码拼写，重排源码不影响结论。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/slot-refill.ts`
- `plugin/test/slot-refill-s16.test.mjs`
- `plugin/test/helpers/slot-refill-harness.mjs`
- `tasks/gap-meta-isbodylanded.md`