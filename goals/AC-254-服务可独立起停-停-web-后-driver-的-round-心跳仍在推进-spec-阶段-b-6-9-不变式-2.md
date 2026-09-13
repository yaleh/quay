---
id: AC-254
title: 服务可独立起停 —— 停 web 后 driver 的 round 心跳仍在推进（SPEC 阶段 B / §6.9 不变式 2）
status: achieved
kind: criterion
goal: GOAL-017
criterion: |-
  python3 - <<'P'
  import calendar,json,os,sys,time
  CAR={"promotion":"promotion-round.jsonl","worker":"worker-round.jsonl","outer":"outer-round.jsonl","goal":"goal-round.jsonl","quality":"quality-round.jsonl","meta":"meta-driver-round.jsonl"}
  p=".quay/unified-server-verification.jsonl"
  if not os.path.exists(p): sys.stderr.write("AC-254: carrier %s absent => the partial start/stop capability has never been exercised (stage B not landed)\n"%p); sys.exit(1)
  best=None
  for ln in open(p,encoding="utf-8"):
      if not ln.strip(): continue
      try: r=json.loads(ln)
      except Exception: continue
      if r.get("ac")!="GOAL-017-AC-254": continue
      if r.get("stopped_service")!="web": continue
      if r.get("web_reachable_after") is not False: continue
      at=r.get("at")
      if not isinstance(at,str) or not at: continue
      rb=r.get("driver_round_before_by_kind"); ra=r.get("driver_round_after_by_kind")
      if not isinstance(rb,dict) or not isinstance(ra,dict): continue
      if set(rb)!=set(CAR) or set(ra)!=set(CAR): continue
      bad=False
      for k in CAR:
          if not isinstance(rb[k],int) or not isinstance(ra[k],int) or ra[k]<=rb[k]: bad=True; break
      if bad: continue
      best=r; break
  if best is None: sys.stderr.write("AC-254: no qualifying record (need stopped_service='web', web_reachable_after=false, ISO 'at', and driver_round_{before,after}_by_kind covering ALL SIX kinds with after>before)\n"); sys.exit(1)
  try: t=calendar.timegm(time.strptime(str(best["at"])[:19],"%Y-%m-%dT%H:%M:%S"))
  except Exception: sys.stderr.write("AC-254 NOT-EVALUATED: record 'at' is not ISO-8601 (%r)\n"%best.get("at")); sys.exit(3)
  for k,c in CAR.items():
      f=".quay/"+c
      if not os.path.exists(f): sys.stderr.write("AC-254 NOT-EVALUATED: carrier %s missing; cannot cross-check the self-reported rounds\n"%f); sys.exit(3)
      if os.path.getmtime(f)<t: sys.stderr.write("AC-254: kind %s carrier has not been written since the claimed 'at' (%s) => the self-reported round advance is uncorroborated\n"%(k,best["at"])); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = 载体中存在一条记录：停掉 `web` 后**六个 kind**（⛔ 不是「≥1 个」）的 round 各自推进 ∧ web
  确实不可达 ∧ 带 ISO `at` ∧ **每个 kind 的载体在该时刻之后确实被写过**（交叉核验）。⊢ 2026-09-13
  审计实测出原版两个失效：① 只要 `driver_kinds_alive_after` 长度 ≥1 —— **停 web 顺带打死五个 driver
  也能绿**，而 SPEC §6.9 说的是六个；② 记录是**纯自报**，两个整数 + 一个字面 false 即可通过，无任何与外部可核量的交叉校验（连
  `at` 都不要求，一条 2020 年伪造的记录也算数）。exit 1 = 载体缺失或无合格记录（**载体是本 AC
  自己的产物，缺失即未达成**）。exit 3 = `at` 非 ISO / 载体缺失致无法交叉核验。
origin: 人 2026-09-13 裁定⑤原则②：「更灵活的启动和停止选项——仅启动部分服务、追加启动部分服务、关闭部分服务」。⊢ 现状 13 进程时
  `quay driver stop --kind X` 已可用，合并后若只能整体起停就是能力回退。
activatedAt: 2026-09-13T14:40:11.938Z
statusLog:
  - at: 2026-09-13T16:34:16.196Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
