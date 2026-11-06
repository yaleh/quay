---
id: gap-meta-classifyrecoveryround
title: 恢复阶梯把 SUITE-NOT-RUN 轮折成 complete-red：被拒轮从未跑过任何测试，却判「baseline-equivalence
  not evaluable — needs a code fix」
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
worker-fan-in.ts 的主路径已按 SUITE-NOT-RUN 标记区分「没跑」与「跑了且红」，但恢复阶梯的 classifyRecoveryRound 只看 watchdog/spawnFailed/空日志三态，把资源闸 WAIT 的恢复轮判成 complete-red，进而在 A/B 里得到 not-evaluated；判词因此指向受害任务自己的代码（实测：gap-goal-driver-filing-ledger 的 recovery-16 日志整份只有一行 SUITE-NOT-RUN branch=resource-gate-wait，3.4 秒内被判红），而该任务正是 GOAL-914 整条依赖链的链头

本轮读数（criteria.AC-937.verdict）= `"fail"`，采于 2026-11-06T10:08:02Z，由 meta-driver 机械采集。
⚠️ 机制词 `classifyRecoveryRound` 命中【已完成】任务：gap-routine-semantic-dedup-scan-defaultroot-byte-identical-quad.md[done]、gap-routine-semantic-dedup-scan-list-script-basenames-diverged-under-one-name.md[done]、gap-routine-semantic-dedup-scan-print-json-three-behaviours.md[done]、gap-suite-recovery-ladder-log-wiring-reads-wrong-file-always-log-unreadable.md[done]、gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --experimental-strip-types --input-type=module -e "import {classifyRecoveryRound} from './plugin/scripts/worker-fan-in.ts'; const log='[full-suite-runner] SUITE-NOT-RUN branch=resource-gate-wait ts=x reason=overloaded - no test was executed by this round\n'; const run={outcome:'done',exitCode:1,signalCode:null,hungByWatchdog:false,startedAt:'x',finishedAt:'x',durationMs:3400,error:null,pid:1}; const r=classifyRecoveryRound(run,log,16,process.cwd()); console.log(r.kind); if(r.kind==='complete-red'||r.kind==='certified') process.exit(1);"` ⇒ 一行只含 SUITE-NOT-RUN 的恢复轮日志既不得被判成 complete-red（会进入 A/B 并误指代码缺陷），也不得被判成 certified（更坏：没跑当绿）；分类须落到一个具名的「本轮未运行」取值并带出拒绝分支名，与主路径 failSuite('suite NOT run (refused) …') 同形

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/worker-fan-in.ts`
- `plugin/test/full-suite-runner-oom-policy.test.mjs`
- `tasks/gap-meta-classifyrecoveryround.md`