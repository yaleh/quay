---
id: AC-251
title: web 与 control 合入同一进程 —— `quay server status --json` 报告二者 pid 相同（SPEC 阶段 A2）
status: active
kind: criterion
goal: GOAL-017
criterion: >-
  python3 - <<'P'

  import json,subprocess,sys

  try:
      r=subprocess.run(["node","packages/quay/bin/quay.js","server","status","--json"],
                       capture_output=True,text=True,timeout=60)
  except Exception as e:
      sys.stderr.write("AC-251: cannot invoke quay CLI (%s) => stage A2 not landed\n"%e); sys.exit(1)
  if r.returncode!=0:
      sys.stderr.write("AC-251: `quay server status --json` unavailable (exit %d) => stage A2 not landed\n"%r.returncode); sys.exit(1)
  try:
      d=json.loads(r.stdout)
  except Exception:
      sys.stderr.write("AC-251 NOT-EVALUATED: `quay server status --json` produced non-JSON output\n"); sys.exit(3)
  svcs={}

  for s in (d.get("services") or []):
      if isinstance(s,dict) and s.get("name"): svcs[s["name"]]=s
  web=svcs.get("web"); ctl=svcs.get("control")

  if not web or not ctl:
      sys.stderr.write("AC-251: status lists no web/control service (have: %s)\n"%sorted(svcs)); sys.exit(1)
  wp=web.get("pid"); cp=ctl.get("pid")

  if not isinstance(wp,int) or not isinstance(cp,int):
      sys.stderr.write("AC-251: web/control carry no integer pid\n"); sys.exit(1)
  if wp!=cp:
      sys.stderr.write("AC-251: web pid %d != control pid %d => still two processes\n"%(wp,cp)); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = `quay server status --json` 报告 web 与 control 两个服务且二者 pid 相同（=
  已合入同一进程，SPEC 阶段 A2）。exit 1 = 子命令不可用 / 无这两个服务 / pid 不同（当前：quay 无 server 子命令 ⇒
  结构上必然取假）。exit 3 = 输出非 JSON（读不懂，⛔ 不与未达成同形）。⊢ 本 AC 同时定义了 status 的最小契约：services[]
  各含 name 与整数 pid。
origin: SPEC §7 阶段 A2。当前 quay 无 `server` 子命令、web 与控制面是两个进程 ⇒ 本 AC 今天结构上必然取假。本 AC
  同时把 `status --json` 的最小契约钉死（services[] 含 name + 整数 pid），⛔ 使实现不能用一个自由格式敷衍。
activatedAt: 2026-09-13T14:40:08.438Z
---
