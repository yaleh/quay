---
id: AC-255
title: 进程收敛且能力不丢 —— driver pid 文件 ≤2 且六个 kind 的 round 心跳都新鲜（SPEC 阶段 C + §6.10）
status: active
kind: criterion
goal: GOAL-017
criterion: >-
  python3 - <<'P'

  import glob,json,os,sys,time

  pids=[p for p in
  glob.glob(".quay/*-driver.pid")+glob.glob(".quay/*-driver-supervisor.pid")]

  n=len(pids)

  if n>2:
      sys.stderr.write("AC-255: %d driver pid file(s) still present (%s) => processes not converged (stage C not landed)\n"%(n,",".join(sorted(os.path.basename(x) for x in pids)[:8]))); sys.exit(1)
  kinds=["promotion","worker","outer","goal","quality","meta"]

  now=time.time(); FRESH=3600.0

  stale=[]

  for k in kinds:
      c=".quay/%s-round.jsonl"%k
      if not os.path.exists(c): stale.append(k+":no-carrier"); continue
      try: age=now-os.path.getmtime(c)
      except Exception: stale.append(k+":unstatable"); continue
      if age>FRESH: stale.append("%s:%dmin"%(k,int(age/60)))
  if stale:
      sys.stderr.write("AC-255: driver pid files converged but these kinds have no fresh round heartbeat within 60min: %s => convergence lost capability\n"%",".join(stale)); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = `.quay/` 下 driver 相关 pid 文件 ≤ 2 **且** 六个 kind 的
  `<kind>-round.jsonl` 都在 60 分钟内被写过（= 进程收敛了，而六个 kind 仍都在转）。exit 1 = pid
  文件仍多（当前实测 12 个 ⇒ 必然取假），或收敛了但某个 kind 心跳停摆（**这正是 §6.10 要防的形态：合并把停摆藏进了一个活进程**）。⊢
  两个条件必须同时成立，⛔ 只判进程数会把「合并后半数 driver 悄悄不转了」判成达成。
origin: SPEC §7 阶段 C + §6.10。实测当前 12 个 driver pid 文件。⛔ 判据不只数进程：合并后若某 kind
  悄悄不转，`ps` 只剩一行看不出来——这正是合并【引入的】新风险，故要求六个 kind 的 round 心跳同时新鲜。
activatedAt: 2026-09-13T14:40:12.909Z
---
