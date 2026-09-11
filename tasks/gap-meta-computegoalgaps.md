---
id: gap-meta-computegoalgaps
title: AC-216 声明的复验域只有 I5 在读：gate 写侧与缺口立案侧都不认它，long-term AC 的台账尾事件永久定格为裸 fail
status: ready
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
- [ ] `python3 - <<'P'
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
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/goal-driver.ts`
- `packages/quay/src/goal-store.ts`
- `tasks/gap-meta-computegoalgaps.md`