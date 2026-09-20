---
id: AC-261
title: 缺口C：plugin/bin/quay shim 让 CLI 免 npm 上 PATH（PATH 已含该目录而目录不存在）
status: achieved
kind: criterion
goal: GOAL-019
criterion: >-
  python3 - <<'P'

  import os, re, subprocess, sys

  SH = "plugin/bin/quay"

  if not os.path.exists(SH):
      sys.stderr.write("AC-261: %s absent => the npm-free CLI route (PATH already carries <plugin-root>/bin per SPEC-plugin-lifecycle:41,:307) is still unbuilt\n" % SH); sys.exit(1)
  if not os.access(SH, os.X_OK):
      sys.stderr.write("AC-261: %s exists but is not executable => a PATH lookup would skip it\n" % SH); sys.exit(1)
  CHAN = None

  for _cand in ("refs/remotes/origin/dist-plugin", "refs/heads/dist-plugin"):
      _r = subprocess.run(["git","rev-parse","--verify","-q","%s^{commit}" % _cand],capture_output=True,text=True)
      if _r.returncode == 0:
          CHAN = _cand; break
  if CHAN is None:
      sys.stderr.write("AC-261: no dist-plugin ref resolves on the candidate list ('refs/remotes/origin/dist-plugin', 'refs/heads/dist-plugin') => INSTRUMENT STATE, not a delivery-face verdict: the shim's delivery could not be read, so this AC has NOT been evaluated\n"); sys.exit(1)
  try:
      ls = subprocess.run(["git","ls-tree","-r",CHAN,"bin/"],capture_output=True,text=True,check=True).stdout
  except Exception as e:
      sys.stderr.write("AC-261: cannot read %s bin/ (%s) => cannot confirm the shim reaches the marketplace face\n" % (CHAN, e)); sys.exit(1)
  rows = [l for l in ls.splitlines() if l.strip()]

  ship = [l for l in rows if l.split()[0] == "100755" and l.split("\t")[-1] ==
  "bin/quay"]

  if not ship:
      sys.stderr.write("AC-261: dist-plugin carries no executable bin/quay (rows=%r) => the shim never reaches the plugin cache, where it is the only npm-free PATH entry\n" % rows[:3]); sys.exit(1)
  env = {k: v for k, v in os.environ.items() if k not in ("QUAY_PLUGIN_ROOT",
  "CLAUDE_PLUGIN_ROOT")}

  env["PATH"] = os.path.join(os.getcwd(), "plugin", "bin") + ":/usr/bin:/bin"

  try:
      r = subprocess.run(["quay","--version"],capture_output=True,text=True,env=env,timeout=180)
  except Exception as e:
      sys.stderr.write("AC-261: the shim did not run on a minimal PATH with QUAY_PLUGIN_ROOT and CLAUDE_PLUGIN_ROOT both unset (%s)\n" % e); sys.exit(1)
  if r.returncode != 0:
      sys.stderr.write("AC-261: `quay --version` through the shim exited %d (stderr=%r) => the CLI is not reachable without an npm global install\n" % (r.returncode, r.stderr[-200:])); sys.exit(1)
  if not re.search(r"\d+\.\d+\.\d+", (r.stdout or "") + (r.stderr or "")):
      sys.stderr.write("AC-261: `quay --version` printed no semver (stdout=%r) => cannot confirm quay itself answered\n" % (r.stdout or "")[:200]); sys.exit(1)
  w = subprocess.run(["sh","-c","command -v
  quay"],capture_output=True,text=True,env=env).stdout.strip()

  if "/plugin/bin/" not in w:
      sys.stderr.write("AC-261: PATH resolved quay to %r rather than the plugin bin shim => the reading would not prove the npm-free route\n" % w); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = plugin/bin/quay 存在且可执行 ∧ 随渠道
  ref（CHAN：refs/remotes/origin/dist-plugin 优先，回退 refs/heads/dist-plugin）以 mode
  100755 交付 ∧ 在最小 PATH（仅 <repo>/plugin/bin:/usr/bin:/bin）且 QUAY_PLUGIN_ROOT 与
  CLAUDE_PLUGIN_ROOT 均 unset 下 quay --version rc=0 并打出 semver ∧ command -v quay
  解析到该 shim。exit 1 = 任一环节不成立，各自给出原因。第四步是负控制：若 PATH 解析到的不是 plugin bin 下那个（例如
  npm-global 的），即判失败——否则这个读数根本不能证明「免 npm」。基线 2026-09-15：plugin/bin 目录不存在，而 PATH
  里已经有它。
origin: SPEC-plugin-lifecycle:41 与 :307 自己的 T4 实测记录「PATH 中已存在
  <plugin-root>/bin（该目录尚不存在也照样在）⇒ 建目录即可让 CLI 免 npm 全局安装」；本会话 PATH 复核确认含
  /home/yale/work/quay/plugin/bin 而该目录不存在；官方文档确认 plugin 根的 bin/ 自动进 Bash tool 的
  PATH。即「已设计、已验证可用、就是没建」。人 2026-09-15 裁定优先遵循 plugin 分发实践、在此实现前不考虑 npm。
activatedAt: 2026-09-15T04:00:59.057Z
statusLog:
  - at: 2026-09-15T04:00:59.057Z
    from: draft
    to: active
    actor: manager
    reason: GOAL-019 已激活，本 AC 进入在评
  - at: 2026-09-16T04:33:59.234Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-15T04:00:59.057Z
---
