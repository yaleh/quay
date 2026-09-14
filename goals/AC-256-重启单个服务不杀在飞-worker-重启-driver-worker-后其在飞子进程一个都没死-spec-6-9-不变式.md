---
id: AC-256
title: 重启单个服务不杀在飞 worker —— 重启 driver:worker 后其在飞子进程一个都没死（SPEC §6.9 不变式 3）
status: achieved
kind: criterion
goal: GOAL-017
criterion: >-
  python3 - <<'P'

  import calendar,json,os,sys,time

  p=".quay/unified-server-verification.jsonl"

  if not os.path.exists(p): sys.stderr.write("AC-256: carrier %s absent =>
  restarting one service while in-flight workers run has never been exercised
  (stage B not landed)\n"%p); sys.exit(1)

  best=None

  for ln in open(p,encoding="utf-8"):
      if not ln.strip(): continue
      try: r=json.loads(ln)
      except Exception: continue
      if r.get("ac")!="GOAL-017-AC-256": continue
      if r.get("restarted_service")!="driver:worker": continue
      at=r.get("at")
      if not isinstance(at,str) or not at: continue
      dpb=r.get("driver_pid_before"); dpa=r.get("driver_pid_after")
      if not isinstance(dpb,int) or not isinstance(dpa,int): continue
      if dpb==dpa: continue
      before=r.get("inflight_worker_pids_before"); after=r.get("inflight_worker_pids_alive_after")
      if not isinstance(before,list) or not isinstance(after,list): continue
      if len(before)<1: continue
      if not all(isinstance(x,int) for x in before+after): continue
      if set(after)!=set(before): continue
      best=r; break
  if best is None: sys.stderr.write("AC-256: no qualifying record (need
  restarted_service='driver:worker', ISO 'at', driver_pid_before !=
  driver_pid_after (proving a REAL restart), non-empty
  inflight_worker_pids_before, and inflight_worker_pids_alive_after equal to it
  as a set (proving none was killed))\n"); sys.exit(1)

  try:
  t=calendar.timegm(time.strptime(str(best["at"])[:19],"%Y-%m-%dT%H:%M:%S"))

  except Exception: sys.stderr.write("AC-256 NOT-EVALUATED: record 'at' is not
  ISO-8601 (%r)\n"%best.get("at")); sys.exit(3)

  f=".quay/worker-round.jsonl"

  if not os.path.exists(f): sys.stderr.write("AC-256 NOT-EVALUATED: %s missing;
  cannot cross-check that the worker driver resumed after the restart\n"%f);
  sys.exit(3)

  if os.path.getmtime(f)<t: sys.stderr.write("AC-256: worker-round.jsonl has not
  been written since the claimed restart at %s => the driver did not actually
  resume; a restart that stops the loop is not the invariant SPEC 6.9 asks
  for\n"%best["at"]); sys.exit(1)

  sys.exit(0)

  P
expect: exit 0 = 载体中存在一条实测记录：重启 `driver:worker` 这一个服务时，**driver 自身 pid
  确实变了**（`driver_pid_before != driver_pid_after`，证明是真重启而非 no-op）**∧ 重启前在飞的
  worker 子进程 pid 非空∧ 重启后它们【一个都没死】**（两个集合相等）∧ 重启后 `worker-round.jsonl` 确实又被写过（证明
  driver 真的恢复运转，⛔ 不是「停了所以没杀人」）。exit 1 = 载体缺失 / 无合格记录 / 重启后 driver 未恢复。exit 3 =
  `at` 非 ISO 或载体不可读（仪器问题）。⊢ 这是 SPEC §6.9 不变式 3，也是 §8-7 的后半。**现状 `quay driver
  stop --kind X` 已经是「不杀在飞子进程」的语义**（CLAUDE.md「driver
  进程管理」节），合并后丢掉它就是一次**静默的能力回退**，而丢掉的是真实在跑的工作。⊢ 2026-09-13
  独立审计指出：这条是「合并最可能造成的实质能力回退」，而原本的五条 AC 与 GOAL 风险节**都只字未提**。
origin: 2026-09-13 独立对照审计发现的最大单点缺口：SPEC §6.9 不变式 3 与 §8-7 后半点名「重启 driver:worker
  ⛔ 不得杀它在飞的 worker 子进程」，而原本五条 AC 与 GOAL 风险节都只字未提。现状该语义已存在（CLAUDE.md「driver
  进程管理」节：stop/restart 只杀 supervisor+driver 自身，不碰在飞子进程），合并后丢掉它 =
  静默回退，且丢掉的是真实在跑的工作。
activatedAt: 2026-09-13T15:38:17.524Z
statusLog:
  - at: 2026-09-14T05:18:44.370Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
