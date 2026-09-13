---
id: AC-255
title: 进程收敛且能力不丢 —— driver pid 文件 ≤2 且六个 kind 的 round 心跳都新鲜（SPEC 阶段 C + §6.10）
status: achieved
kind: criterion
goal: GOAL-017
criterion: |-
  python3 - <<'P'
  import calendar,glob,json,os,sys,time
  CAR={"promotion":"promotion-round.jsonl","worker":"worker-round.jsonl","outer":"outer-round.jsonl","goal":"goal-round.jsonl","quality":"quality-round.jsonl","meta":"meta-driver-round.jsonl"}
  alive=0; seen=set()
  for f in glob.glob(".quay/*-driver.pid")+glob.glob(".quay/*-driver-supervisor.pid"):
      try: pid=int(open(f).read().strip())
      except Exception: continue
      if pid in seen: continue
      seen.add(pid)
      try:
          os.kill(pid,0); alive+=1
      except Exception: pass
  if alive>2: sys.stderr.write("AC-255: %d LIVE driver process(es) still running => processes not converged (stage C not landed)\n"%alive); sys.exit(1)
  now=time.time(); FRESH=3600.0; stale=[]
  for k,c in CAR.items():
      f=".quay/"+c
      if not os.path.exists(f): sys.stderr.write("AC-255 NOT-EVALUATED: carrier %s missing — an instrument problem, NOT a verdict that the SPEC is unmet\n"%f); sys.exit(3)
      last=None
      try:
          for ln in open(f,encoding="utf-8"):
              if ln.strip():
                  try: last=json.loads(ln)
                  except Exception: pass
      except Exception as e: sys.stderr.write("AC-255 NOT-EVALUATED: cannot read %s (%s)\n"%(f,e)); sys.exit(3)
      if not isinstance(last,dict) or not last.get("ts"): sys.stderr.write("AC-255 NOT-EVALUATED: %s has no readable last record carrying a ts\n"%f); sys.exit(3)
      try: t=calendar.timegm(time.strptime(str(last["ts"])[:19],"%Y-%m-%dT%H:%M:%S"))
      except Exception: sys.stderr.write("AC-255 NOT-EVALUATED: %s last ts is not ISO-8601 (%r)\n"%(f,last.get("ts"))); sys.exit(3)
      if now-t>FRESH: stale.append("%s:%dmin"%(k,int((now-t)/60)))
  if stale: sys.stderr.write("AC-255: converged but these kinds have no fresh round heartbeat within 60min: %s => convergence lost capability (SPEC 6.10)\n"%",".join(stale)); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = **真实存活**的 driver 进程 ≤2（读 pid 文件内容后 `os.kill(pid,0)`）**且**六个
  kind 的 round 心跳都在 60 分钟内（读**最后一条记录的 `ts`**）。⊢ 2026-09-13 审计实测出原版三个失效：① 载体名用
  `"%s-round.jsonl"%kind`，而 **meta 的真实载体是 `meta-driver-round.jsonl`**（已由
  `driver-runtime.ts` 的 registry 核实）⇒ 该条**结构上永不可能取真、恒红** —— 恒红与恒绿同样是坏判据；② 数的是
  **pid 文件**而非存活进程，`rm .quay/*-driver*.pid` 即可判达成而 12 个进程照旧运行；③ 心跳用
  **mtime**，`touch` 即可伪造。exit 1 = 未收敛或某 kind 心跳停摆。exit 3 = 载体缺失/不可读/ts 非 ISO ——
  **仪器问题，⛔ 不报成「SPEC 未达成」**（原版把它写成 exit 1，正是硬规则 3b 禁止的折叠）。
origin: SPEC §7 阶段 C + §6.10。实测当前 12 个 driver pid 文件。⛔ 判据不只数进程：合并后若某 kind
  悄悄不转，`ps` 只剩一行看不出来——这正是合并【引入的】新风险，故要求六个 kind 的 round 心跳同时新鲜。
activatedAt: 2026-09-13T14:40:12.909Z
statusLog:
  - at: 2026-09-13T19:53:15.631Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
