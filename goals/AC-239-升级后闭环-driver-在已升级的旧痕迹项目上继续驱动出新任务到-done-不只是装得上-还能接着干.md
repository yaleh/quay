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

  if not upgraded:
      sys.stderr.write("CAUSE=no-upgraded-site \u2014 \u8f7d\u4f53\u4e2d\u6ca1\u6709\u4efb\u4f55\u4e00\u6761\u5916\u90e8 AC-238 \u901a\u8fc7\u578b\u8bb0\u5f55\uff08\u9700 host\u2260\u672c\u673a \u2227 project_root \u5728\u672c\u4ed3\u5916 \u2227 pre>0 \u2227 post==pre \u2227 age\u22651 \u2227 runtime_replaced \u2227 task_list_ok \u2227 build_sha\uff09\uff0c\u56e0\u6b64\u65e0\u6cd5\u6807\u5b9a\u201c\u5347\u7ea7\u540e\u201d\u73b0\u573a\uff1bAC-238 \u8bb0\u5f55\u603b\u6570=%d\n" % sum(1 for r in recs if r.get("ac")=="GOAL-009-AC-238"))
      sys.exit(1)

  rej=[]

  for r in recs:
      if r.get("ac")!="GOAL-009-AC-239": continue
      if not external(r): rej.append("not-external(host=%r,root=%r)" % (r.get("host"), r.get("project_root"))); continue
      pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if pr not in upgraded: rej.append("root-not-upgraded(%s)" % pr); continue
      if not r.get("commit_sha") or not r.get("task_id"): rej.append("missing-commit_sha-or-task_id"); continue
      if r.get("task_status")!="done": rej.append("task_status=%r" % r.get("task_status")); continue
      if int(r.get("gate_events") or 0)<=0: rej.append("gate_events=%r" % r.get("gate_events")); continue
      if r.get("produced_by_driver") is not True: rej.append("produced_by_driver=%r" % r.get("produced_by_driver")); continue
      sys.exit(0)
  sys.stderr.write("CAUSE=no-qualifying-ac239-record \u2014
  \u5df2\u6807\u5b9a\u5347\u7ea7\u73b0\u573a %d
  \u4e2a\uff0c\u4f46\u65e0\u4e00\u6761 ac=GOAL-009-AC-239
  \u8bb0\u5f55\u5168\u90e8\u6ee1\u8db3\uff1bAC-239 \u5019\u9009\u8bb0\u5f55 %d
  \u6761\uff0c\u9010\u6761\u88ab\u62d2\u539f\u56e0\uff1a%s\n" % (len(upgraded),
  len(rej), "; ".join(rej[:12]) if rej else
  "(\u4e00\u6761\u5019\u9009\u8bb0\u5f55\u90fd\u6ca1\u6709)"))

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
