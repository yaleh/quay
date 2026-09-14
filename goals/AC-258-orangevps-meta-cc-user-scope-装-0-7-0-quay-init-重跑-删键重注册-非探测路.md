---
id: AC-258
title: orangevps/meta-cc：user scope 装 0.7.0 + quay-init 重跑（删键重注册，非探测路径）+ 真实 todo→done
status: active
kind: criterion
goal: GOAL-018
criterion: >-
  python3 - <<'P'

  import json, os, re, sys

  p = ".quay/productization-verification.jsonl"

  if not os.path.exists(p):
      sys.stderr.write("AC-258: carrier %s absent => this AC has never been exercised\n" % p); sys.exit(1)
  best = None

  for ln in open(p, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      if r.get("ac") != "GOAL-018-AC-258": continue
      if r.get("host") != "orangevps": continue
      if r.get("project_root") != "/home/yale/work/meta-cc": continue
      if r.get("install_scope") != "user": continue
      if r.get("quay_version") != "0.7.0": continue
      if r.get("quay_init_rerun") is not True: continue
      if r.get("merge_preserved") is not True: continue
      mp = str(r.get("marketplace_path") or r.get("provider_path") or "")
      if not mp or re.search(r"verify-|probe|/tmp/", mp): continue
      if r.get("task_status") != "done": continue
      if not r.get("commit_sha"): continue
      if r.get("produced_by_driver") is not True: continue
      best = r; break
  if best is None: sys.stderr.write("AC-258: no qualifying record (need
  host=orangevps, project_root=/home/yale/work/meta-cc, " "install_scope=user,
  quay_version=0.7.0, quay_init_rerun=true, merge_preserved=true, " "a non-probe
  marketplace/provider path, task_status=done, commit_sha set,
  produced_by_driver=true)\n"); sys.exit(1)

  sys.exit(0)

  P
expect: exit 0 = 载体中存在一条 ac=GOAL-018-AC-258 的记录：host=orangevps ∧
  project_root=/home/yale/work/meta-cc（真实项目本体，不是隔离副本，与 GOAL-009 AC-238/239
  用的隔离副本区分开）∧ install_scope=user ∧ quay_version=0.7.0 ∧ quay_init_rerun=true ∧
  merge_preserved=true（该机 ~/.claude/settings.json 里
  baime/manda/meta-cc-marketplace 等既有 enabledPlugins/extraKnownMarketplaces
  条目在替换 quay 那条注册后逐字保留）∧ marketplace_path/provider_path 不匹配探测路径字面模式 ∧
  task_status=done ∧ commit_sha 非空 ∧ produced_by_driver=true。exit 1 =
  载体缺失或无合格记录。⛔ 不接受引用 08-20 AC118 或 09-11 AC-238/239 的历史记录充数：那些记录的 project_root
  都是隔离副本，且不含 install_scope 字段。
origin: 人 2026-09-14 裁定：orangevps/meta-cc 扛 user scope（该机已有 baime/manda/meta-cc
  等其它 user-scope 插件注册，是验证"替换 quay 一条、不动其它"语义的真实场景）。
activatedAt: 2026-09-14T04:03:21.195Z
---
