---
id: AC-238
title: 升级路径：带旧版 vendored runtime 的真实第三方项目（meta-cc 副本）被当前 develop tip 干净接管，任务存量不丢失
status: achieved
kind: criterion
goal: GOAL-009
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
      if r.get("ac")!="GOAL-009-AC-238": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me or pr==here or pr.startswith(here+os.sep): continue
      pre=r.get("pre_upgrade_task_count"); post=r.get("post_upgrade_task_count")
      if not isinstance(pre,int) or pre<=0: continue
      if not isinstance(post,int) or post!=pre: continue
      age=r.get("pre_upgrade_runtime_age_days")
      if not isinstance(age,(int,float)) or age<1: continue
      if r.get("runtime_replaced") is not True: continue
      if r.get("task_list_ok") is not True: continue
      if not r.get("build_sha"): continue
      sys.exit(0)
  sys.exit(1)

  P
expect: exit 0 = 载体中存在 ac=GOAL-009-AC-238 的记录，host≠本机 ∧ project_root ∉ 本仓库 ∧
  pre_upgrade_task_count>0（证明目标是带真实存量数据的旧项目，非全新 quay-init）∧
  post_upgrade_task_count 与之相等（升级后任务文件数不丢不增）∧
  pre_upgrade_runtime_age_days≥1（证明确有旧版本痕迹——.quay/runtime/bin 早于本次交付物生成，⛔
  非当天现造的假老化）∧ runtime_replaced=true（旧 vendored bundle 被换成本次真实交付物，非旁路绕过）∧
  task_list_ok=true（换装后新 CLI 能正确读出旧存量库，非文件还在但读不出）∧ build_sha 非空（可溯源到具体 develop
  提交）。exit 1 = 无（当前，从未发生）。exit 3 = 载体缺失。
origin: "2026-09-11 会话实测（orangevps ssh 外部可核）：meta-cc 是一个真实跑过 quay-native 一个月的第三方
  Go 项目（102 个真实任务/32KB gate-events.jsonl/loop-state 停在 iteration 21），其
  .quay/runtime/bin/*是 2026-08-20 23:00 打的旧 vendored bundle 形态——早于 09-02 落地的
  SPEC-plugin-lifecycle-single-bundle-2026-09-02.md，从未经过 single-bundle
  交付路径。GOAL-009 现有 9 条 AC（201/202/203/204/205/206/207/232/234）的证据全部来自全新
  quay-init 的一次性项目（如 a2a5aac0-root），没有一条覆盖『升级一个带旧痕迹、有真实存量数据的项目』这个场景——而 GOAL-009
  自己的背景就是拿 meta-cc 当第三方验证靶子。同时实测 GOAL-009 已第二次被 goal-driver 机械 flip 回
  achieved（03:04:50Z，reason: all ACs achieved + sufficiency
  covered），印证其自身文档写的风险5『达成即停止复验』——本 AC 必须在窗口重新打开（已手工 reactivate）时立即挂上，不能等它『跑完』。"
activatedAt: 2026-09-11T03:11:42.252Z
statusLog:
  - at: 2026-09-11T03:11:42.253Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-11T04:00:52.975Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-09-11T03:11:42.252Z
---
