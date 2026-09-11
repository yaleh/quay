---
id: AC-242
title: 台账不得留下「已离开复验域却尾事件为 fail」的 AC —— 否则下游判据（AC-241）结构上永不通过，被误读成「还有真缺陷」
status: achieved
kind: criterion
goal: GOAL-009
criterion: >-
  python3 - <<'P'

  import glob,json,os,re,sys

  LED=".quay/gate-events.jsonl"; GD="goals"

  if not os.path.exists(LED): sys.stderr.write("NOT-EVALUATED: ledger
  absent\n"); sys.exit(3)

  acf=sorted(glob.glob(os.path.join(GD,"AC-*.md")));
  gof=sorted(glob.glob(os.path.join(GD,"GOAL-*.md")))

  if not acf or not gof: sys.stderr.write("NOT-EVALUATED: goals/ unreadable or
  empty\n"); sys.exit(3)

  def fm(p):
      s=open(p,encoding="utf-8").read()
      if not s.startswith("---"): return {}
      d={}
      for line in s.split("---",2)[1].splitlines():
          m=re.match(r"^([A-Za-z_-]+):\s*(.*)$",line)
          if m: d[m.group(1)]=m.group(2).strip()
      return d
  active=set()

  for p in gof:
      d=fm(p)
      if d.get("status")=="active" and d.get("id"): active.add(d["id"])
  acstat={}; acgoal={}; longterm=set()

  for p in acf:
      d=fm(p); i=d.get("id")
      if not i: continue
      acstat[i]=d.get("status"); acgoal[i]=d.get("goal")
      if d.get("long-term")=="true": longterm.add(i)
  last={}

  for line in open(LED,encoding="utf-8"):
      if not line.strip(): continue
      try: e=json.loads(line)
      except Exception: continue
      if e.get("gate")!="goal" or not e.get("item_id"): continue
      last[e["item_id"]]=e
  frozen=[]

  for iid,e in last.items():
      if e.get("verdict")!="fail": continue
      if acstat.get(iid)!="achieved": continue
      if acgoal.get(iid) in active or iid in longterm: continue
      frozen.append(iid)
  if frozen:
      sys.stderr.write("frozen achieved-but-failing, no mechanism re-runs them: %s\n" % ",".join(sorted(frozen))); sys.exit(1)
  sys.exit(0)

  P
expect: "exit 0 = 不存在「记录 achieved、台账尾事件 fail、且其 goal 已非 active 又未声明 long-term:
  true」的 AC（即没有任何失败被静默冻结在复验域之外）；今天 exit 1 点名 AC-161。该判据是纯读、零 criterion 执行开销，⛔
  不要求把 51 条 achieved AC 全部重跑（那是 AC-216 已裁定的成本边界），只要求「已知失败且已无人复验」这一类不许存在"
origin: "本轮 readings：criteria 里 AC-241 的 verdict=fail、reason 逐字为「unattributable
  failing goal AC(s): AC-161: acceptance failed (exit 1); AC-239: …」——即 AC-241
  点名的两个不可归因项之一。而 AC-161 不出现在本次给定的任何 criteria 条目里，按 readings 的构造（criteria = 各
  ACTIVE goal 名下全部 AC），它属于非 active goal ⇒ goal-driver 已不再跑它。旁证：`timeSeries` 键
  `goal:AC-241:verdict` mode=unchanged count=49 ⇒ AC-241 已连续 49
  轮为红；`.quay/gate-events.jsonl`（即 AC-241 判据自己读的台账）中 AC-161 的最后一条 goal 事件是
  2026-09-08T19:54:48.864Z verdict=fail，其后无新事件。⇒ 冻结的失败同时使 AC-241 结构上不可能转绿，与
  AC-216 的成本边界（未声明的 achieved AC 随 GOAL
  关闭离开复验域）叠加后无人拥有。旁证二：tasks/gap-goal-criteria-bare-failing-exit-unattributable.\
  md 正文第 32 行把 AC-161(3 处) 列为待修样例，但其 ## Touches 不含
  goals/AC-161-user-level-marketplace-only.md ⇒ 该 ready 任务在授权面内改不到这个文件，其 AC7（要求
  AC-241 干跑 exit 1→0）按现有计划不可满足。故本项不由任何既有任务覆盖。"
activatedAt: 2026-09-11T07:15:57.975Z
statusLog:
  - at: 2026-09-11T07:15:57.975Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-09-11T12:00:57.374Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-11T07:15:57.974Z
---
