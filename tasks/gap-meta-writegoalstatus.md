---
id: gap-meta-writegoalstatus
title: goal-driver 的 activate 判决被能力闸拒绝时必须落一个具名阻塞读数——否则同一条 draft AC
  每轮重判、永不进入缺口环，其缺失载体也永不被委托
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
AC-920/AC-922 已连续 10/9 轮停在 draft+cause=capability（判据的被执行载体 plugin/test/unencapsulated-state-admission.test.mjs 不存在）；goal-driver 第⑧步每轮对它们调 writeGoalStatus(…, active) 被能力闸拒绝后只留 flips{ok:false, reason:<散文>}，没有任何消费者读 ok:false、载体路径埋在自由文本里 ⇒ 这两条 AC 既不进 computeGoalGaps（只数 active）、也永远不会被委托造载体，而 GOAL-911 的退出条件④要求 AC-920 achieved ⇒ 该 goal 结构上不可达；已 done 的 gap-goal-triage-activate-executed 只断言 flips 含 to==active，对被拒的 ok:false 同样成立

本轮读数（criteria.AC-920.cause）= `"capability"`，采于 2026-10-22T11:44:13Z，由 meta-driver 机械采集。
⚠️ 机制词 `writeGoalStatus` 命中【已完成】任务：gap-cross-project-replay-verify-goal-timeout-and-anti-drift-fixes-on-claudecodeui-and-quay-fleet.md[done]、gap-fidelity-judge-unwired-in-production-and-verdict-stubbed-in-tests.md[done]、gap-goal-branch-goal-flips-achieved-before-its-branch-merges.md[done]、gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics.md[done]、gap-goal-driver-draft-ac-invisible-yet-blocking.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --test plugin/test/goal-driver-activation-blocked.test.mjs` ⇒ 新测试驱动一轮 goal-driver（夹具，非自述）：一条 draft AC 的激活被能力闸拒绝时，轮记录的 goal-ring fact 必须带具名 activationBlocked 条目（ac 名 + cause=criterion-capability-unevaluated + 缺失载体路径）；负控制——同一 AC 的判据变为可认证并激活成功后，该条目消失

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-driver-activation-blocked.test.mjs`
- `tasks/gap-meta-writegoalstatus.md`