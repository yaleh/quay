---
id: AC-251
title: web 与 control 合入同一进程 —— `quay server status --json` 报告二者 pid 相同（SPEC 阶段 A2）
status: active
kind: criterion
goal: GOAL-017
criterion: >-
  python3 - <<'P'

  import json,os,subprocess,sys

  def sh(a,t=60):
      try: return subprocess.run(a,capture_output=True,text=True,timeout=t)
      except Exception as e: return e
  r=sh(["node","packages/quay/bin/quay.js","server","status","--json"])

  if not hasattr(r,"returncode"): sys.stderr.write("AC-251 NOT-EVALUATED: cannot
  invoke the quay CLI at all (%s)\n"%r); sys.exit(3)

  if r.returncode!=0: sys.stderr.write("AC-251: `quay server status --json`
  unavailable (exit %d) => web and control are not behind one status
  surface\n"%r.returncode); sys.exit(1)

  try: d=json.loads(r.stdout)

  except Exception: sys.stderr.write("AC-251 NOT-EVALUATED: status output is not
  JSON (cannot judge)\n"); sys.exit(3)

  svcs={}

  for s in (d.get("services") or []):
      if isinstance(s,dict) and s.get("name"): svcs[s["name"]]=s
  web=svcs.get("web"); ctl=svcs.get("control")

  if not web or not ctl: sys.stderr.write("AC-251: status lists no web/control
  service (have: %s)\n"%sorted(svcs)); sys.exit(1)

  wp=web.get("pid"); cp=ctl.get("pid")

  if not isinstance(wp,int) or not isinstance(cp,int): sys.stderr.write("AC-251:
  web/control carry no integer pid\n"); sys.exit(1)

  if wp!=cp: sys.stderr.write("AC-251: web pid %d != control pid %d => still two
  processes\n"%(wp,cp)); sys.exit(1)

  try: os.kill(wp,0)

  except Exception as e: sys.stderr.write("AC-251: status reports pid %d but it
  is NOT alive (%s) => a self-reported integer, not a reading\n"%(wp,e));
  sys.exit(1)

  s=sh(["ss","-lptnH"])

  if not hasattr(s,"returncode") or s.returncode!=0: sys.stderr.write("AC-251
  NOT-EVALUATED: `ss -lptnH` unavailable; cannot cross-check that pid %d
  actually listens\n"%wp); sys.exit(3)

  if ("pid=%d,"%wp) not in s.stdout: sys.stderr.write("AC-251: pid %d holds NO
  listening socket => the reported service is not actually serving\n"%wp);
  sys.exit(1)

  sys.exit(0)

  P
expect: exit 0 = `quay server status --json` 报 web 与 control 且二者 pid 相同 **∧ 该
  pid 真实存活**（`os.kill(pid,0)`）**∧ 它真的持有监听 socket**（`ss -lptnH` 命中）。⊢ 后两项是
  2026-09-13 审计加的**交叉核验**：原版只比较两个自报整数，打印
  `{"services":[{"name":"web","pid":123},{"name":"control","pid":123}]}`
  就能骗过。exit 1 = 子命令不可用 / 无这两个服务 / pid 不同 / pid 已死 / 不在监听（当前：无 server 子命令 ⇒
  必然取假）。exit 3 = CLI 完全调不起 / 输出非 JSON / `ss` 不可用（**读不到，⛔ 不与未达成同形**）。⚠️ 本 AC 跨
  A2/B 边界：它判的是 A2 的结果，但经由阶段 B 的 `status` 面观测 —— 见 GOAL「已知覆盖缺口」。
origin: SPEC §7 阶段 A2。当前 quay 无 `server` 子命令、web 与控制面是两个进程 ⇒ 本 AC 今天结构上必然取假。本 AC
  同时把 `status --json` 的最小契约钉死（services[] 含 name + 整数 pid），⛔ 使实现不能用一个自由格式敷衍。
activatedAt: 2026-09-13T14:40:08.438Z
---
