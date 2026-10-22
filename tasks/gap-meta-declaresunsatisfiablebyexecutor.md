---
id: gap-meta-declaresunsatisfiablebyexecutor
title: 修 UNSATISFIABLE_AC 判据的误报：证据指令从句里的『落地后』被当成『执行者不可满足』的声明，把合法 ready 任务拦成
  needs-human
status: done
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

## Acceptance Criteria
- [x] `node --no-warnings --experimental-strip-types --input-type=module -e 'import { judgeUnsatisfiableUnannotatedAc as j } from "./plugin/scripts/ready-pool-check.ts"; const L=String.fromCharCode(0x843d,0x5730,0x540e), O=String.fromCharCode(0x53ea,0x80fd,0x7531,0x4eba); const B="[ ] ", b=t=>"## Acceptance Criteria\n\n- "+B+t+"\n\n## Definition of Done\n\n- "+B+"done\n"; const ev=j(b("AC1 正向：跑判据 ⇒ exit 0。贴出立案基线（exit 2）与"+L+"绿灯两份输出，以及 git rev-parse HEAD。")); const dc=j(b("AC6 "+L+"实测复查：sqlite3 里 agent 档不再增长")); const hg=j(b("AC9 人评审门：该行"+O+" yale 写入")); const bad=[]; if(!(ev.evaluated&&ev.status==="clean")) bad.push("evidence-clause="+JSON.stringify(ev)); if(!(dc.evaluated&&dc.status==="hit")) bad.push("declaration="+JSON.stringify(dc)); if(!(hg.evaluated&&hg.status==="hit")) bad.push("human-gate="+JSON.stringify(hg)); if(bad.length){console.error("CAUSE=unsatisfiable-AC judge wrong: "+bad.join(" | "));process.exit(1)}; console.log("OK: evidence-clause clean; declaration+human-gate still hit")'` ⇒ 证据指令从句（要求执行者贴出或说明证据的从句）不再判 hit，而两类真声明（实测复查类、人工关卡类）仍判 hit ⇒ 误报消除且不回归真阳性；今天在真实树上实跑时该证据从句同样被判 hit（criterion exit 1），因此这条判据能取假。fixture 的复选框字面量用 `B` 变量拼出（`"- "+B+t` 构造出的任务体与原先逐字节相同），只为让按整段文本计数的 `task_check` 不把命令里的字面量误算成未勾复选框。

## Definition of Done
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence

**实现（`plugin/scripts/ready-pool-check.ts`）**：`UNSATISFIABLE_AC_DECLARATION_PHRASES` 拆成两族（仍是一处封闭枚举）——
- **人工关卡族**（`只能由人` / `不得由执行者代写` / `执行者不得代写`）：无条件子串命中（不变）；
- **落地后族**（`合入 develop` / `落地后`）：只在**声明性位置**命中。位置 = 短语所在**强分句**（边界 `。`/`；`/`;`/换行——⛔ 不按 `，` 切，否则证据样本里 `贴出` 与短语被逗号/括号隔开，误报会复活）内，短语**之前**不得出现：①证据指令动词（`EVIDENCE_DEMAND_VERBS` 封闭枚举：贴出/提供/输出/记录/说明…）或②条件标记（`CONDITIONAL_CLAUSE_MARKERS` 封闭枚举：若/如果/一旦/除非…）。

**AC 判据实跑（cwd = 本任务 worktree，逐字执行任务 AC 那条命令）**：
```
改前（develop 基线 870a67450）：CAUSE=unsatisfiable-AC judge wrong: evidence-clause={"evaluated":true,"status":"hit","hits":["AC1 正向：…贴出立案基线（exit 2）与落地后绿灯两份输出…"]}  ⇒ exit 1
改后：OK: evidence-clause clean; declaration+human-gate still hit  ⇒ exit 0
取假对照：把 inDeclarativePosition 临时改成 return true（= 旧裸子串行为）⇒ 同一命令 exit 1；恢复后 md5 5a780bf5167497e766719edbe663b9b2 前后一致、再跑 exit 0
```
`node --test plugin/test/ready-pool-check-s22.test.mjs`：**14/14 pass**，含既有「5 条逐字样本仍 hit」用例（真阳性未回归）与新增 1 条（AC 的三个 fixture + AC-355 的 `若 peer 落地后仍命中` 假设从句 ⇒ clean + 证据动词在短语**之后**时仍 hit 的反向控制 + 混合体只点名真声明）。

**存量读数（硬规则 5b：判据改动的条数必须能取假）**：对本任务树 `tasks/*.md` 全量跑 `judgeUnsatisfiableUnannotatedAc`——改前 20 个任务命中，改后 18 个；翻转的正是本族两条：
- `tasks/gap-semantic-admission-contract-module.md`（needs-human；AC1 证据指令从句——本任务要消除的误报）；
- `tasks/gap-single-flight-lock-2-slot-concurrent-suites.md`（done；『其落地后回填本箱』是证据指令的对象，不是本任务执行者的不可满足声明）。
其余 18 条真声明（`落地后时间窗内…`、`实现落地后，…读数`、`真实落地（合入 develop …）`、`落地后重启 meta-driver…` 等）**全部保持 hit**。

**DoD2（不新建并行机制）**：修的就是既有机制本体 `declaresUnsatisfiableByExecutor` / `judgeUnsatisfiableUnannotatedAc`（grep 全仓只有 `ready-pool-check.ts` 自身一处消费）；⛔ 未新增 checker、未改 fan-in 对未标注项的 fail-closed 默认、未动 `（待外部）` 标注语义。

- L_D：该轴仍暗,理由:本改动只在既有判定函数内部窄化触发面，未新增/删除模块、import 或依赖边，archguard 的 L_D 读数对本改动无差分可读。

## Touches
- `plugin/scripts/ready-pool-check.ts`
- `plugin/test/ready-pool-check-s22.test.mjs`
- `tasks/gap-meta-declaresunsatisfiablebyexecutor.md`