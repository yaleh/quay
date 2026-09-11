---
id: AC-239
title: 升级后闭环：driver 在已升级的旧痕迹项目上继续驱动出新任务到 done（不只是装得上，还能接着干）
status: active
kind: criterion
goal: GOAL-009
criterion: >-
  python3 - <<'P'

  import json,os,socket,sys

  p=".quay/productization-verification.jsonl"

  if not os.path.exists(p): sys.stderr.write("NOT-EVALUATED: carrier absent\n");
  sys.exit(3)

  me=socket.gethostname(); here=os.path.realpath(".")

  recs=[]

  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      try: recs.append(json.loads(l))
      except Exception: continue

  def external(r):
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      return bool(h) and h!=me and pr!=here and not pr.startswith(here+os.sep)

  # 只有 AC-238 已经真的证明"升级成功"的那个 project_root，才有资格作为 AC-239 的现场——

  # 防止绕过升级、另起一个全新项目冒充"升级后"。

  upgraded=set()

  for r in recs:
      if r.get("ac")!="GOAL-009-AC-238" or not external(r): continue
      pre=r.get("pre_upgrade_task_count"); post=r.get("post_upgrade_task_count")
      if not isinstance(pre,int) or pre<=0: continue
      if not isinstance(post,int) or post!=pre: continue
      age=r.get("pre_upgrade_runtime_age_days")
      if not isinstance(age,(int,float)) or age<1: continue
      if r.get("runtime_replaced") is not True: continue
      if r.get("task_list_ok") is not True: continue
      if not r.get("build_sha"): continue
      upgraded.add(os.path.realpath(str(r.get("project_root"))))

  if not upgraded: sys.exit(1)


  for r in recs:
      if r.get("ac")!="GOAL-009-AC-239" or not external(r): continue
      pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if pr not in upgraded: continue
      if not r.get("commit_sha") or not r.get("task_id"): continue
      if r.get("task_status")!="done": continue
      if int(r.get("gate_events") or 0)<=0: continue
      if r.get("produced_by_driver") is not True: continue
      sys.exit(0)
  sys.exit(1)

  P
expect: exit 0 = 载体中先存在至少一条 GOAL-009-AC-238 的通过型记录（标定出哪个 project_root
  是『真实完成升级』的现场），且在【同一个】 project_root 上存在 ac=GOAL-009-AC-239 的记录：host≠本机 ∧
  commit_sha/task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧
  produced_by_driver=true（提交出自任务 worktree，非人手敲）。⛔
  不接受另起一个全新项目冒充『升级后』——project_root 必须与已证明升级成功的那个一致，这条关联本身就是防自证的机制，不是自报字段（如
  post_upgrade:true）。exit 1 = 无（当前，从未发生——AC-238 尚未产出通过记录）。exit 3 = 载体缺失。
origin: 2026-09-11 人裁定：AC-238 范围要扩大到『升级后 driver 是否还能正常干活』，但拆成两条独立 AC，互不掩盖、可分别
  pass/fail（避免一条判据里混两类可能失败点，出问题时分不清是升级本身坏了还是driver 坏了）。AC-238 管『升级机制本身：数据不丢、CLI
  读得出、旧 runtime 被换掉』（静态维度）；本 AC-239 管『升级完之后，target 自己的 *-drivers 能不能像 AC-207
  那样继续驱动新任务到 done』（动态维度）。判据形状复用 AC-207
  的『端到端』检查项（commit_sha/task_id/task_status=done/gate_events>0/produced_by_driver=true），但加了一层
  AC-238 通过记录的 project_root 关联，确保被验证的确实是『刚被升级过的那个旧项目』，不是另建一个新项目蒙混过关。
activatedAt: 2026-09-11T03:22:39.016Z
statusLog:
  - at: 2026-09-11T03:22:39.016Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-09-11T03:22:39.015Z
---
