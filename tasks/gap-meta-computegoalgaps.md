---
id: gap-meta-computegoalgaps
title: AC-216 声明的复验域只有 I5 在读：gate 写侧与缺口立案侧都不认它，long-term AC 的台账尾事件永久定格为裸 fail
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
本轮 readings：criteria.AC-241.verdict = fail，reason 逐字「unattributable failing goal AC(s): AC-161: acceptance failed (exit 1)」，timeSeries goal:AC-241:verdict 已 unchanged 292 轮。代码解释该读数：goal-driver 每轮 pass 1 只遍历 activeGoals 的 AC（plugin/scripts/goal-driver.ts:1207-1210）⇒ 已 achieved 的 GOAL-003 名下的 AC-161 永远拿不到新的 gate=goal 事件，台账尾事件（旧 runner 写的裸 fail，无成因）被永久定格；而 AC-216 声明 long-term AC 跨 GOAL 关闭仍在复验域，goal-store.ts:610 的 I5 确实每轮跑它，但 achievedButFailing 只写进轮读数与一行日志、不进 computeGoalGaps（只数 active AC）⇒ 既无写入者、也无执行者。AC-242 的豁免（long-term 不在其冻结集）与 AC-241 的无豁免叠加，使 AC-241 结构上不可能转绿——即 AC-242 自己标题预言的「被误读成还有真缺陷」的同一形态，只是逃逸口在 long-term 上。修法不是改判据口径（那会让真实的常设不变式违规被静默），而是把 AC-216 已声明的复验域接到两处已有的机械路径上：每轮 gate 集合 ∪ 缺口立案集合。

本轮读数（criteria.AC-241.verdict）= `"fail"`，采于 2026-09-11T12:54:24Z，由 meta-driver 机械采集。
⚠️ 机制词 `computeGoalGaps` 命中【已完成】任务：gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics.md[done]、gap-goal-driver-draft-ac-triage.md[done]、gap-goal-driver-gap-semantic-filing-ring.md[done]、gap-goal-gap-done-task-not-traction-respawns-every-round.md[done]、gap-goal-gap-needs-human-invisible-burns-spawn-slot.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [x] `python3 - <<'P'
import glob,json,re,sys
def fm(p):
    L=open(p,encoding='utf-8').read().splitlines()
    if not L or L[0].strip()!='---': return None
    for i in range(1,len(L)):
        if L[i].strip()=='---': return L[1:i]
    return None
def fld(F,k):
    for ln in F:
        m=re.match(r'^%s:\s*(.*)$'%k,ln)
        if m: return m.group(1).strip()
    return None
active=set()
for p in glob.glob('goals/GOAL-*.md'):
    F=fm(p)
    if F and fld(F,'status')=='active': active.add(fld(F,'id'))
want=set()
for p in glob.glob('goals/AC-*.md'):
    F=fm(p)
    if not F: continue
    if fld(F,'status')!='achieved': continue
    if fld(F,'long-term')!='true': continue
    if fld(F,'goal') in active: continue
    want.add(fld(F,'id'))
if not want:
    sys.stderr.write('NOT-EVALUATED: no long-term achieved AC outside active goals\n'); sys.exit(3)
last=None
for l in open('.quay/goal-round.jsonl',encoding='utf-8'):
    if l.strip(): last=l
if not last:
    sys.stderr.write('NOT-EVALUATED: no goal-round record\n'); sys.exit(3)
ring=None
for f in json.loads(last).get('facts',[]):
    v=f.get('value')
    if isinstance(v,dict) and 'criteria' in v and 'gaps' in v: ring=v
if ring is None:
    sys.stderr.write('NOT-EVALUATED: goal-ring fact absent\n'); sys.exit(3)
gated={c.get('id') for c in ring.get('criteria',[])}
gap={g.get('ac') for g in ring.get('gaps',[])}
mg=sorted(want-gated); mp=sorted(want-gap)
if mg:
    sys.stderr.write('AC-216 reverify scope not wired to the gate: round gates %d ACs, missing %s\n'%(len(gated),','.join(mg))); sys.exit(1)
if mp:
    sys.stderr.write('gated but no work signal: %s absent from round gaps => achieved-but-failing has no work-filing executor\n'%','.join(mp)); sys.exit(1)
sys.exit(0)
P` ⇒ exit 0 = 最新一轮 .quay/goal-round.jsonl 的 facts[goal-ring] 里，AC-216 声明的复验域（achieved ∧ long-term ∧ GOAL 非 active，当前 = AC-161）同时出现在 criteria（gate 写侧已接）与 gaps（缺口立案侧已接）；exit 1 = 缺任一侧（缺 criteria = 台账尾事件仍被永久定格，缺 gaps = 违规仍无人执行）；exit 3 = 读不出（无轮记录 / 该域为空）。

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence

修法 = 把 AC-216 **已声明的复验域**接到**两处已有的机械路径**上（⛔ 不新建并行机制；判据口径一字未改）：

- **判据定义只有一处**：`inAchievedReverifyScope(ac, activeGoalIds)` 从 Core 导出（`packages/quay/src/goal-store.ts`），I5 的 `checkAchievedFailing` 与 driver 的 `standingReverifyAcs` 都读它——⛔ 不再各自重推一遍「achieved ∧ long-term ∧ GOAL 非 active」。这正是本缺陷的形态：域声明在 Core，却只有 I5 接了线。
- **gate 写侧**（`runGoalRound` pass 1b）：每轮对域内每条 AC 跑 `goalStoreArgv(["gate", id])`，verdict 落进本轮 `criteria`。台账尾事件随之刷新 ⇒ reason 携带判据自己写出的成因。⛔ 不翻任何状态（域内已 achieved；achieved→active 归人，沿用既有裁定）。
- **缺口立案侧**（`computeGoalGaps` 第 4 参 `standings` = I5 读数）：域内每条 AC 出**恰好一条**读数——`standing-ok`（此刻成立）/ `standing-violated`（此刻违反且无在飞任务 ⇒ 进 `isFilingGapState` 的 spawn 选取面）/ `not-evaluated`（读不到 I5 读数或 taskFacts，⛔ 不与 `standing-ok` 同形）。⛔ 与 `done-unresolved` **不同判**：曾经 done 的关联任务**不覆盖回归**（那正是「回归后再无人立案」的成因），只有在飞任务才压下新一轮立案。违反但已有在飞任务 ⇒ 复用 `in-progress` / `stalled`。
- **prompt 口径分叉**（`buildGapWorkerPrompt`）：`standing-violated` 时去重规则改为「只有在飞任务算重复；done/superseded 是**回归的证据**，须新立一条 re-establish 的任务」——否则 agent 每轮都拒立案，缺口永无执行者。

**判据实跑（生产载体，⛔ 非 fixture）**

| 读数 | BEFORE（生产台账 + 改动前实现） | AFTER（同台账 + 本实现跑一轮） |
|---|---|---|
| `goal-store gate AC-241 --dry-run` | `verdict=fail` — reason 逐字 `acceptance failed (exit 1) — unattributable failing goal AC(s): AC-161: acceptance failed (exit 1)`（与 Finding 的读数逐字相同） | `verdict=pass` — `acceptance passed (exit 0)` |

- AC-161 的台账尾事件实测 = `{"verdict":"fail","reason":"acceptance failed (exit 1)","ts":"2026-09-08T19:54:48.864Z"}`：**裸 fail、无成因、自 09-08 定格**——「GOAL-003 关闭后再没被 gate 过」的直接证据。
- AFTER 轮（`.quay/goal-round.jsonl` 末轮）：`criteria` 含域内 4 条（AC-161/188/189/190），AC-161 的 reason 变成 `acceptance failed (exit 1) — CAUSE=user-enabled-plugins — user-level enabledPlugins still enables quay plugin(s): quay@quay`（**可归因**）；`gaps` 含 `AC-161 standing-violated` 与 `AC-188/189/190 standing-ok`；`spawned=1`（仅 AC-161；`--gap-worker-cmd /bin/true` 使本轮零 LLM）。
- **本任务 AC 判据**原样跑 ⇒ `exit 0`。取假三控制（改坏最后一轮记录后**原样**重跑同一判据）：撤 `criteria` 里的 AC-161 ⇒ `exit 1`「AC-216 reverify scope not wired to the gate: round gates 20 ACs, missing AC-161」；撤 `gaps` 里的 AC-161 ⇒ `exit 1`「gated but no work signal: AC-161 absent from round gaps => achieved-but-failing has no work-filing executor」。
- **实现取假**：把两个源文件换回改动前版本（worktree 内 `git stash`）⇒ 4 条新回归测试**全红**；换回 ⇒ `plugin/test/goal-driver.test.mjs` **41/41 绿**。
- **DoD②**：结论是「机制存在、但只在 I5 接了一半线」⇒ 修的是**那两处已有路径**（pass 1 的 gate 循环 + `computeGoalGaps`），⛔ 未新增 driver kind / 周期检查器 / 并行读数载体。
- **5b 枚举（修一处 ≠ 只有一处）**：全仓 `longTerm|long-term` 判定点 grep（源码，排除测试）⇒ 3 处：`goal-store.ts`（I5 作用域 + 投影/写面）、`goal-driver.ts:469 goalCloseBlockFromRecords`（问的是**另一个问题**——该 GOAL 能不能关闭，方向相反）、`long-term-guarantee-goal-backed-check.ts`（task→goal 的 `goal_ac` 声明面）。⇒ AC-216 复验域的**成员判定现在只有一处**。

## Touches
- `plugin/scripts/goal-driver.ts`
- `packages/quay/src/goal-store.ts`
- `plugin/test/goal-driver.test.mjs`
- `tasks/gap-meta-computegoalgaps.md`