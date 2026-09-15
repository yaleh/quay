---
id: AC-264
title: 收口：quay-fleet 以 project scope + marketplace 渠道真实部署，driver 驱一条真任务到 done，免
  npm 与免 QUAY_PLUGIN_ROOT 由文件系统直接量确认
status: draft
kind: criterion
goal: GOAL-019
criterion: >-
  python3 - <<'P'

  import json, os, re, sys

  CAR = ".quay/productization-verification.jsonl"

  FLEET = "/home/yale/work/quay-fleet"

  if not os.path.exists(CAR):
      sys.stderr.write("AC-264: carrier %s absent => this AC has never been exercised\n" % CAR); sys.exit(1)
  best = None

  for ln in open(CAR, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      if r.get("ac") != "GOAL-019-AC-264": continue
      if r.get("project_root") != FLEET: continue
      if r.get("install_scope") != "project": continue
      if r.get("install_channel") != "marketplace": continue
      if r.get("npm_global_used") is not False: continue
      if r.get("quay_plugin_root_unset") is not True: continue
      if r.get("goal_ring_ok") is not True: continue
      if r.get("task_status") != "done": continue
      if not r.get("commit_sha"): continue
      if r.get("produced_by_driver") is not True: continue
      mp = str(r.get("plugin_cache_path") or "")
      if not mp or re.search(r"verify-|probe|/tmp/", mp): continue
      best = r; break
  if best is None:
      sys.stderr.write("AC-264: no qualifying record in %s (need ac=GOAL-019-AC-264, project_root=%s, install_scope=project, install_channel=marketplace, npm_global_used=false, quay_plugin_root_unset=true, goal_ring_ok=true, task_status=done, commit_sha set, produced_by_driver=true, non-probe plugin_cache_path)\n" % (CAR, FLEET)); sys.exit(1)
  ST = os.path.join(FLEET, ".claude", "settings.json")

  if not os.path.exists(ST):
      sys.stderr.write("AC-264: %s absent => project-scope enablement cannot be confirmed from the filesystem, so install_scope=project would be self-report only (hard rule 4b)\n" % ST); sys.exit(1)
  try:
      sj = json.load(open(ST, encoding="utf-8"))
  except Exception as e:
      sys.stderr.write("AC-264: %s is not parseable JSON (%s) => cannot confirm enabledPlugins\n" % (ST, e)); sys.exit(1)
  ep = sj.get("enabledPlugins") or {}

  if not any(str(k).startswith("quay@") for k in ep):
      sys.stderr.write("AC-264: %s enabledPlugins carries no quay@* key (keys=%r) => the record's install_scope=project is not corroborated by the project's own settings\n" % (ST, list(ep)[:5])); sys.exit(1)
  CFG = os.path.join(FLEET, ".quay", "config.yml")

  if not os.path.exists(CFG):
      sys.stderr.write("AC-264: %s absent => cannot confirm which quay code the project actually binds to\n" % CFG); sys.exit(1)
  cfg = open(CFG, encoding="utf-8").read()

  bind = [l.strip() for l in cfg.splitlines() if ("path:" in l or "quay-native"
  in l or "quay.js" in l) and not l.strip().startswith("#")]

  if not any(".claude/plugins/cache/" in l for l in bind):
      sys.stderr.write("AC-264: %s binds to no .claude/plugins/cache/ path (binding lines: %r) => the project is not consuming the marketplace-installed plugin, so install_channel=marketplace is self-report only\n" % (CFG, bind[:6])); sys.exit(1)
  devbind = [l for l in bind if "/home/yale/work/quay/plugin" in l or
  "/home/yale/work/quay/packages" in l]

  if devbind:
      sys.stderr.write("AC-264: %s still binds to the quay development checkout (%r) => the deployment is not self-contained and would break the moment that checkout moves\n" % (CFG, devbind[:3])); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = 载体 .quay/productization-verification.jsonl 中存在一条
  ac=GOAL-019-AC-264 的记录，满足 project_root=/home/yale/work/quay-fleet ∧
  install_scope=project ∧ install_channel=marketplace ∧ npm_global_used=false ∧
  quay_plugin_root_unset=true ∧ goal_ring_ok=true ∧ task_status=done ∧
  commit_sha 非空 ∧ produced_by_driver=true ∧ plugin_cache_path
  非空且不匹配探测路径模式（verify-、probe、/tmp/）；并且判据自己再核两个文件系统直接量：quay-fleet/.claude/settings.json
  的 enabledPlugins 含 quay@* 键（否则 install_scope=project 只是自报）∧
  quay-fleet/.quay/config.yml 的绑定行含 .claude/plugins/cache/ 路径且不再指向 quay
  开发检出（/home/yale/work/quay/plugin 或 /home/yale/work/quay/packages）。exit 1 =
  无合格记录，或任一直接量核不过。⛔ 不接受只有自报字段（硬规则 4b：被测对象自己产生的量不能用来判断它自己是否在工作）；⛔ 判据不当场跑 npm ls
  -g（那会把「别人为别的目的装过 quay」误判成本 AC 失败），真正的机制证据是 config.yml 的绑定落点。
origin: "人 2026-09-15 指定本 GOAL 的目标包含「在 quay-fleet project scope
  实际部署和验证」。现状实测（2026-09-15）：quay-fleet 的 .claude/settings.json 已有 enabledPlugins
  {quay@quay: true}，但 .quay/config.yml 的 providers.native.path 与 mcp_entry 仍直接指向
  /home/yale/work/quay/plugin/vendor/… 开发检出 ⇒ 声明了 project scope 而实际消费的是 dev 树，不是
  marketplace 产物。AC-203 的教训（driver_alive=1 ∧ carrier_records>0 两个代理量在 goal-ring
  state=failed 时照样绿，goal-driver.ts:2179 注释自述该形态）决定了本 AC 必须交叉核文件系统直接量而不能只信记录字段。"
---
