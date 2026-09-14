---
id: AC-257
title: ad-arm1/archguard：project scope 装 0.7.0 + quay-init 重跑（非空 settings.json
  合并）+ 真实 todo→done
status: active
kind: criterion
goal: GOAL-018
criterion: >-
  python3 - <<'P'

  import json, os, re, sys

  p = ".quay/productization-verification.jsonl"

  if not os.path.exists(p):
      sys.stderr.write("AC-257: carrier %s absent => this AC has never been exercised\n" % p); sys.exit(1)
  best = None

  for ln in open(p, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      if r.get("ac") != "GOAL-018-AC-257": continue
      if r.get("host") != "ad-arm1": continue
      if r.get("project_root") != "/home/yale/work/archguard": continue
      if r.get("install_scope") != "project": continue
      if r.get("quay_version") != "0.7.0": continue
      if r.get("quay_init_rerun") is not True: continue
      if r.get("merge_preserved") is not True: continue
      mp = str(r.get("marketplace_path") or r.get("provider_path") or "")
      if not mp or re.search(r"verify-|probe|/tmp/", mp): continue
      if r.get("task_status") != "done": continue
      if not r.get("commit_sha"): continue
      if r.get("produced_by_driver") is not True: continue
      best = r; break
  if best is None: sys.stderr.write("AC-257: no qualifying record (need
  host=ad-arm1, project_root=/home/yale/work/archguard, "
  "install_scope=project, quay_version=0.7.0, quay_init_rerun=true,
  merge_preserved=true, " "a non-probe marketplace/provider path,
  task_status=done, commit_sha set, produced_by_driver=true)\n"); sys.exit(1)

  sys.exit(0)

  P
expect: exit 0 = 载体中存在一条 ac=GOAL-018-AC-257 的记录：host=ad-arm1 ∧
  project_root=/home/yale/work/archguard（真实项目本体，不是隔离副本）∧ install_scope=project ∧
  quay_version=0.7.0 ∧ quay_init_rerun=true ∧ merge_preserved=true（archguard 既有的
  .claude/settings.json Stop hook 在 quay-init 重跑后逐字保留，不是被覆盖）∧
  marketplace_path/provider_path 不匹配探测路径字面模式（verify-/probe//tmp/）∧
  task_status=done ∧ commit_sha 非空 ∧ produced_by_driver=true。exit 1 =
  载体缺失或无合格记录——载体是本 AC 自己的产物，缺失即未达成。⛔ 不接受引用 GOAL-016/AC-247..250 的历史记录充数：本 AC 要求
  install_scope=project 且 merge_preserved=true，那两条字段在既往记录里从未出现过。
origin: 人 2026-09-14 裁定：ad-arm1/archguard 扛 project scope（archguard 已有非空、带无关
  Stop hook 的 .claude/settings.json，是验证"合并而非覆盖"语义的真实场景）。
activatedAt: 2026-09-14T04:03:19.975Z
---
