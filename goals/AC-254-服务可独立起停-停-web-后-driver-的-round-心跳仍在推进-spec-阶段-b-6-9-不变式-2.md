---
id: AC-254
title: 服务可独立起停 —— 停 web 后 driver 的 round 心跳仍在推进（SPEC 阶段 B / §6.9 不变式 2）
status: active
kind: criterion
goal: GOAL-017
criterion: >-
  python3 - <<'P'

  import json,os,sys

  p=".quay/unified-server-verification.jsonl"

  if not os.path.exists(p):
      sys.stderr.write("AC-254: carrier %s absent => the partial start/stop capability has never been exercised (stage B not landed)\n"%p); sys.exit(1)
  ok=False

  for ln in open(p,encoding="utf-8"):
      if not ln.strip(): continue
      try: r=json.loads(ln)
      except Exception: continue
      if r.get("ac")!="GOAL-017-AC-254": continue
      if r.get("stopped_service")!="web": continue
      b=r.get("driver_round_before"); a=r.get("driver_round_after")
      if not isinstance(b,int) or not isinstance(a,int): continue
      if a<=b: continue
      if r.get("web_reachable_after") is not False: continue
      kinds=r.get("driver_kinds_alive_after")
      if not isinstance(kinds,list) or len(kinds)<1: continue
      ok=True; break
  if ok: sys.exit(0)

  sys.stderr.write("AC-254: carrier holds no qualifying GOAL-017-AC-254 record
  (need stopped_service='web', integer driver_round_before/after with
  after>before, web_reachable_after=false, non-empty
  driver_kinds_alive_after)\n"); sys.exit(1)

  P
expect: exit 0 = 载体中存在一条实测记录：停掉 `web` 这一个服务后，**driver 的 round
  心跳仍在推进**（`driver_round_after > driver_round_before`）∧ web
  确实已不可达（`web_reachable_after=false`）∧ 至少一个 driver kind 仍存活 ⇒ 部分停止不波及其余（SPEC
  §6.9 不变式 2）。exit 1 = 载体缺失或无合格记录（**载体是本 AC 自己的产物，缺失即未达成，⛔ 不记 not-evaluated**）。⊢
  round 推进是直接量：它证明 driver 在停 web 之后仍在真正转，⛔ 不是「进程还在」这种代理量。
origin: 人 2026-09-13 裁定⑤原则②：「更灵活的启动和停止选项——仅启动部分服务、追加启动部分服务、关闭部分服务」。⊢ 现状 13 进程时
  `quay driver stop --kind X` 已可用，合并后若只能整体起停就是能力回退。
activatedAt: 2026-09-13T14:40:11.938Z
---
