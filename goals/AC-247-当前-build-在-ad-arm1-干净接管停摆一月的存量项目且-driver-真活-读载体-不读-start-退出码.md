---
id: AC-247
title: 当前 build 在 ad-arm1 干净接管停摆一月的存量项目且 driver 真活（读载体，⛔ 不读 start 退出码）
status: active
kind: criterion
goal: GOAL-016
criterion: >-
  python3 - <<'P'

  import json,os,socket,sys

  p=".quay/productization-verification.jsonl"

  if not os.path.exists(p): sys.stderr.write("AC-247 NOT-EVALUATED: carrier .quay/productization-verification.jsonl absent — cannot read driver-liveness evidence\n"); sys.exit(3)

  me=socket.gethostname(); here=os.path.realpath(".")

  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      r=json.loads(l)
      if r.get("ac")!="GOAL-016-AC-247": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me: continue
      if pr==here or pr.startswith(here+os.sep): continue
      pre=r.get("pre_task_count"); post=r.get("post_task_count")
      if not isinstance(pre,int) or pre<=0: continue
      if not isinstance(post,int) or post!=pre: continue
      sd=r.get("stale_days")
      if not isinstance(sd,(int,float)) or sd<14: continue
      if not r.get("build_sha"): continue
      if int(r.get("driver_alive") or 0)!=1: continue
      if int(r.get("carrier_records") or 0)<=0: continue
      sys.exit(0)
  sys.stderr.write("AC-247: carrier holds no qualifying GOAL-016-AC-247 record (need host != local hostname, project_root outside this repo, pre_task_count greater than zero, post_task_count equal to pre_task_count, stale_days at least 14, non-empty build_sha, driver_alive==1, carrier_records greater than zero)\n"); sys.exit(1)

  P
expect: exit 0 = 载体中存在 ac=GOAL-016-AC-247 的记录，host≠本机 ∧ project_root ∉ 本仓库 ∧
  pre_task_count>0（证明是带真实存量的旧项目，非全新 quay-init）∧ post_task_count==pre（接管后存量不丢不增）∧
  stale_days≥14（证明确是停摆项目，⛔ 非当天现造）∧ build_sha 非空（可溯源到具体交付物）∧ driver_alive=1 ∧
  carrier_records>0（读载体判真活，⛔ 不读 quay driver start 的退出码——它今天就是 0 而系统是死的）。exit 1 =
  无合格记录（当前）。exit 3 = 载体缺失（NOT-EVALUATED，⛔ 不与合格同形）。
origin: 2026-09-12 实测：ad-arm1 的 /home/yale/work/archguard 是真 git repo（master @
  14ea9e63），已有 .quay/ 与 61 个存量 task，历史上被 quay 驱动到 TASK-87，最后活动停在
  2026-08-11/12（停摆约一月）；该主机 user-scope quay 安装已于本日卸载（npm 全局包 + Claude Code 插件注册 +
  marketplace + cache/data）⇒ driver_alive 今天结构上必为 0。
activatedAt: 2026-09-12T08:43:29.454Z
---
**判据（能取假）**：2026-09-12 干跑 exit 1（载体存在、82 条记录、无本 AC 记录）。**负控制**：ad-arm1 的 user-scope quay 已于本日卸载 ⇒ `driver_alive` 今天结构上必为 0，任何声称满足本 AC 的记录都必须是真装真跑出来的。**⛔ 不读退出码**：`quay driver start` 打印 `started: supervisor pid=… exit=0` 而 status 全 0 的形态已由 GOAL-009 AC-203 实证；本 AC 沿用「读载体」的判法，复用 `start-drivers.ts:54` 的 `parseDriverStatus`（它已把「读不出」与「不活」分成两个取值）。**与 GOAL-009 AC-238 的分工**：AC-238 验「带旧 vendored runtime 的项目升级后存量不丢」；本 AC 验「**user-scope 安装已被移除、从零装当前 build** + **停摆一月的 loop 重新起来**」——`stale_days` 是这两者的区分量。**顺带的价值**：GOAL-009 已 achieved、其 AC 离开 `check --achieved-failing` 作用域（风险 5），本 AC 这一跑等于替 AC-201/202/203 路径复验一次。