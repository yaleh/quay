---
id: gap-meta-declaresunsatisfiablebyexecutor
title: 修 UNSATISFIABLE_AC 判据的误报：证据指令从句里的『落地后』被当成『执行者不可满足』的声明，把合法 ready 任务拦成
  needs-human
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
judgeUnsatisfiableUnannotatedAc（plugin/scripts/ready-pool-check.ts）对整条未勾 AC 文本做子串匹配，封闭枚举 UNSATISFIABLE_AC_DECLARATION_PHRASES 里的裸词『落地后』在【证据指令从句】里也命中：承载 GOAL-911 AC-919 的那条任务（frontmatter goal_ac: AC-919，现 needs-human；文件 tasks/gap-semantic-admission-contract-module.md）的 AC1 写着『贴出立案基线（exit 2）与落地后绿灯两份输出』，于是该任务被判 status=hit ⇒ eligible=false（unsatisfiableAc.hits.length===0 是 eligible 的合取项之一）⇒ 从未进入派发；promotion-driver 对结构性拦截按设计不 spawn fix worker，直接翻 needs-human。后果：AC-919 的 verdict 连续 18 轮不变（读数 criteria.AC-919.verdict=fail），GOAL-911 的第一段交付无人推进。同一误报家族此前已被逐字记录过一次（tasks/gap-ac355-postmerge-reverify-stale-acceptance-runner-pin.md 的 Needs-Human 注记：命中词同为『落地后』，出现在 fallback 从句『若 peer 落地后仍命中』里），当时用『作者侧改写』绕开、判据本身没修 ⇒ 第二次咬到另一个任务。本条只修判据（窄化触发面或改为按声明位置判定皆可）；被误拦的既有任务仍需作者侧改写 + needs-human→todo，不在本条范围。

本轮读数（criteria.AC-919.verdict）= `"fail"`，采于 2026-10-22T12:41:06Z，由 meta-driver 机械采集。
⚠️ 机制词 `declaresUnsatisfiableByExecutor` 命中【已完成】任务：gap-executor-unsatisfiable-ac-unannotated-burns-rounds.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --no-warnings --experimental-strip-types --input-type=module -e 'import { judgeUnsatisfiableUnannotatedAc as j } from "./plugin/scripts/ready-pool-check.ts"; const L=String.fromCharCode(0x843d,0x5730,0x540e), O=String.fromCharCode(0x53ea,0x80fd,0x7531,0x4eba); const b=t=>"## Acceptance Criteria\n\n- [ ] "+t+"\n\n## Definition of Done\n\n- [ ] done\n"; const ev=j(b("AC1 正向：跑判据 ⇒ exit 0。贴出立案基线（exit 2）与"+L+"绿灯两份输出，以及 git rev-parse HEAD。")); const dc=j(b("AC6 "+L+"实测复查：sqlite3 里 agent 档不再增长")); const hg=j(b("AC9 人评审门：该行"+O+" yale 写入")); const bad=[]; if(!(ev.evaluated&&ev.status==="clean")) bad.push("evidence-clause="+JSON.stringify(ev)); if(!(dc.evaluated&&dc.status==="hit")) bad.push("declaration="+JSON.stringify(dc)); if(!(hg.evaluated&&hg.status==="hit")) bad.push("human-gate="+JSON.stringify(hg)); if(bad.length){console.error("CAUSE=unsatisfiable-AC judge wrong: "+bad.join(" | "));process.exit(1)}; console.log("OK: evidence-clause clean; declaration+human-gate still hit")'` ⇒ 证据指令从句（要求执行者贴出或说明证据的从句）不再判 hit，而两类真声明（实测复查类、人工关卡类）仍判 hit ⇒ 误报消除且不回归真阳性；今天在真实树上实跑时该证据从句同样被判 hit（criterion exit 1），因此这条判据能取假。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/ready-pool-check.ts`
- `plugin/test/ready-pool-check-s22.test.mjs`
- `tasks/gap-meta-declaresunsatisfiablebyexecutor.md`