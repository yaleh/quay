---
id: AC-241
title: 生产台账上失败判据必须可归因：任何 goal-gate verdict=fail 的 reason 不得是「判据没写任何输出」的空因模板
status: draft
kind: criterion
goal: GOAL-009
criterion: >-
  python3 - <<'P'

  import json,os,sys

  p=".quay/gate-events.jsonl"

  if not os.path.exists(p):
      sys.stderr.write("NOT-EVALUATED: gate ledger absent\n"); sys.exit(3)
  last={}

  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      try: e=json.loads(l)
      except Exception: continue
      if e.get("gate")!="goal": continue
      iid=e.get("item_id")
      if iid: last[iid]=e
  if not last:
      sys.stderr.write("NOT-EVALUATED: no goal gate events in ledger\n"); sys.exit(3)
  bad=[]

  for iid in sorted(last):
      e=last[iid]
      if e.get("verdict")!="fail": continue
      r=str((e.get("payload") or {}).get("reason") or "")
      if "criterion wrote no output" in r or len(r.strip())<24:
          bad.append("%s: %s"%(iid,r or "<empty>"))
  if bad:
      sys.stderr.write("unattributable failing goal AC(s): %s\n"%("; ".join(bad))); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = 台账里每条 AC 的最近一次 goal-gate fail 记录，其 payload.reason
  都携带判据自己写出的成因（非 acceptance-runner 的『criterion wrote no output to
  stderr/stdout』空因模板、且非空）；exit 1 = 至少一条失败 AC 不可归因（当前 AC-239 即此形态）；exit 3 =
  台账缺失或无 goal 事件（未评估，不算通过）。⚠️ 与 runner 的模板措辞有耦合：acceptance-runner
  若改这句文案，须同步改本判据，否则会退化为恒绿。
origin: 本轮 readings：criteria[AC-239].verdict="fail"，reason="acceptance failed
  (exit 1) — criterion wrote no output to stderr/stdout"（同批另外 16 条 AC 全为
  pass）。同一形态在生产载体可复现：.quay/gate-events.jsonl 中 item_id=AC-239 的最后一条 gate=goal
  事件，payload.reason 逐字相同。GOAL-009 自己的已 achieved AC-237 明文要求『失败 reason
  必须携带判据自身写出的成因，⛔ 不得只留 exit 1』，但 AC-237 的判据只跑一个【必然写 CAUSE-TOKEN 的
  fixture】（readings 中可见其命令 `echo CAUSE-TOKEN >&2; exit 1`）——它证明『runner
  能把成因带出来』，结构上无法观察到『真判据什么都没写』（硬规则4推论三：fixture
  只证明能产出，不证明已产出）。AC-239（2026-09-11T03:22Z
  激活，goals/AC-239-升级后闭环-driver-在已升级的旧痕迹项目上继续驱动出新任务到-done-不只是装得上-还能接着干.md）的两条失败出口都是裸
  sys.exit(1)（该文件 :48 与 :60），因此它每一轮都在台账里写一条不可归因的 fail。本判据把 AC-237 的同一条义务从
  fixture 挪到【生产台账】上，是其补面而非重复。
---
