---
id: AC-240
title: 端到端闭环必须由【同一次验证运行】自证——AC-203 的 driver 存活证据与 AC-207 的 driver 产出提交证据须共享同一
  (host, project_root)
status: active
kind: criterion
goal: GOAL-009
criterion: >-
  python3 - <<'P'

  import json,os,socket,sys

  p='.quay/productization-verification.jsonl'

  if not os.path.exists(p):
      sys.stderr.write('NOT-EVALUATED: carrier absent\n'); sys.exit(3)
  me=socket.gethostname(); here=os.path.realpath('.')

  def k(r):
      h=str(r.get('host') or ''); pr=os.path.realpath(str(r.get('project_root') or '/nonexistent'))
      if not h or h==me: return None
      if pr==here or pr.startswith(here+os.sep): return None
      return (h,pr)
  runs={}; e2e={}

  for l in open(p,encoding='utf-8'):
      if not l.strip(): continue
      r=json.loads(l); kk=k(r)
      if kk is None: continue
      if r.get('ac')=='GOAL-009-AC-203' and r.get('has_plugin_dir') is False and int(r.get('driver_alive') or 0)==1 and int(r.get('carrier_records') or 0)>0: runs[kk]=1
      if r.get('ac')=='GOAL-009-AC-207' and r.get('task_status')=='done' and int(r.get('gate_events') or 0)>0 and r.get('produced_by_driver') is True and r.get('commit_sha') and r.get('task_id'): e2e[kk]=1
  if not runs: sys.stderr.write('no AC-203 liveness evidence (any run)\n');
  sys.exit(1)

  if not e2e: sys.stderr.write('no AC-207 e2e evidence (any run)\n');
  sys.exit(1)

  both=[x for x in e2e if x in runs]

  if not both:
      sys.stderr.write('AC-203 runs=%s ; AC-207 runs=%s ; intersection empty\n' % (sorted(runs),sorted(e2e))); sys.exit(1)
  for x in both: print('ok:',x)

  sys.exit(0)

  P
expect: exit 0 仅当载体里存在一对记录：同一 host+project_root 下既有 AC-203 的
  driver_alive=1/carrier_records>0/has_plugin_dir=false，又有 AC-207 的
  task_status=done/gate_events>0/produced_by_driver=true——即「第三方项目里 driver
  真活」与「该项目的 driver 驱动出真实提交」是同一次运行观测到的，闭环不是由互不相交的两批见证拼合而成。
origin: readings.criteria 中 AC-203（verdict pass）与 AC-207（verdict
  pass）各自成立；但两者的证据载体 .quay/productization-verification.jsonl 显示 per-run 的
  project_root 互不相交——只读 jq 该载体（2026-09-11）得：AC-203 记录仅出现在
  quay-verify-coldstart-63ee9681-root / -b95bd6f1-root，AC-207 记录只出现在
  quay-verify-coldstart-a2a5aac0-root，交集为空（AC-203 在 6 次运行中只产出 2 次）。读
  plugin/scripts/verify-deliver-coldstart.sh（step4_driver_liveness 与 ⑤ e2e
  共用同一次运行的 $root，:1136 / :574-651）确认单次运行【能】同时产出两者 ⇒ 该合取可满足、⛔ 非恒假判据，只是从来没有被判据要求过。
activatedAt: 2026-09-11T03:28:27.435Z
statusLog:
  - at: 2026-09-11T03:28:27.435Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-11T03:28:27.429Z
---
