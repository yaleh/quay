---
id: AC-207
title: 端到端：目标项目自己的 *-drivers 驱动出真实开发提交且任务翻 done
status: draft
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
      if r.get("ac")!="GOAL-009-AC-207": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me or pr==here or pr.startswith(here+os.sep): continue
      if not r.get("commit_sha") or not r.get("task_id"): continue
      if r.get("task_status")!="done": continue
      if int(r.get("gate_events") or 0)<=0: continue
      if r.get("produced_by_driver") is not True: continue   # 提交出自任务 worktree，非人手敲
      sys.exit(0)
  sys.exit(1)

  P
expect: exit 0 = 载体中存在 ac=GOAL-009-AC-207 的记录，host≠本机 ∧ project_root ∉ 本仓库 ∧
  commit_sha 与 task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧
  produced_by_driver=true。exit 1 = 无（当前，从未发生）。exit 3 = 载体缺失。
origin: 人 2026-09-09 要求①③：点火依靠会话投递，后续驱动依靠 *-drivers；目标项目中的实际开发活动应使用 goals 和
  tasks 等载体。人 2026-09-09 裁定②：退役 2026-08-16「必须真实交互式 tmux、claude -p
  不算」的裁定；裁定③：claude --bg 仅作本次验证手段，不作为产品能力交付。
---
**判据（能取假）**：2026-09-09 干跑 exit 1（从未发生过）。**证据必须外部可核**：commit_sha 取自第三方项目自身 git 历史（经共享裸仓库镜像可核），⛔ 不采信驱动方自述（硬规则 4b）。**produced_by_driver 的边界（照实说明，不假装机械）**：最强的可得直接量只到「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」，**这不能完全排除人在会话里手敲**；该半判据属人裁定的口证，不冒充测量。**产品/夹具边界**：本 AC 允许 claude --bg / -p 作为验证手段，但产品文档与 skill 文案不得因此声称 quay 会启动会话——SPEC-tmux-retirement-2026-09-03「quay 不管会话生命周期」的产品判断原样保留。