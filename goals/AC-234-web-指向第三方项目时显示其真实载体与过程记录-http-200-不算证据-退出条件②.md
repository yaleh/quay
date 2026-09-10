---
id: AC-234
title: web 指向第三方项目时显示其真实载体与过程记录——⛔ HTTP 200 不算证据（退出条件②）
status: draft
kind: criterion
goal: GOAL-015
criterion: >-
  python3 - <<'P'

  import json,os,socket,sys

  p=".quay/productization-verification.jsonl"

  if not os.path.exists(p): sys.stderr.write("NOT-EVALUATED: carrier absent\n");
  sys.exit(3)

  me=socket.gethostname(); here=os.path.realpath(".")

  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      r=json.loads(l)
      if r.get("ac")!="GOAL-015-AC-234": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me: continue
      if pr==here or pr.startswith(here+os.sep): continue
      if int(r.get("tasks_rendered") or 0)<=0: continue
      if int(r.get("goals_rendered") or 0)<=0: continue
      if int(r.get("round_records_rendered") or 0)<=0: continue
      sys.exit(0)
  sys.exit(1)

  P
expect: 读真实第三方项目取得的记录： 且 host≠本机 ∧ project_root∉本仓库 ∧ **tasks_rendered>0 ∧
  goals_rendered>0 ∧
  round_records_rendered>0**。三个计数缺一不可——只断言服务起得来会与「渲染出空壳页面」同形（硬规则
  4：结构上不可能取假的量不是测量；GOAL-015 风险 2 逐字点名「HTTP 200 不算证据」）。立条时载体无该记录 ⇒ exit 1。
origin: >-
  GOAL-015 的机器判据之一。立条依据见 GOAL-015 的 origin（人 2026-09-10 令「应当优先更新 goal；必要时可创建新
  goal」后设立；实测缺口：orangevps Node 18.19.1 上 shipped CLI 拒跑而同机 driver dist
  照跑；`merge_target` 全仓零消费者而 `fork_baseline` 有）。


  本条判据在立条当轮已从仓库根干跑取真实读数：exit 1（可评估、非 spawn 失败），符合硬规则
  4c。判据只引用不会自行回退的量——代码状态、append-only 载体的历史事实、机械枚举计数；⛔ 不含进程存活与远程主机当前可达性。
---
