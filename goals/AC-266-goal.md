---
id: AC-266
title: release 的 Run tests 不再因 tokenless 测试泄漏子进程而退化成 hang（静态臂剥注释判定 + 载体臂无超时
  release run）
status: active
kind: criterion
goal: GOAL-020
criterion: |-
  python3 - <<'P'
  import json, os, re, sys
  WF = ".github/workflows/release.yml"
  TEST = "packages/quay/test/mcp-server.test.mjs"
  if not os.path.exists(WF):
      sys.stderr.write("CAUSE=workflow-absent — %s does not exist => the release surface moved and this criterion can no longer judge it\n" % WF); sys.exit(1)
  wf = open(WF, encoding="utf-8").read()
  # Arm (a): the release job delegates to the single test entrypoint, which owns process reaping.
  # POSITION-BASED (hard rule 2): YAML comments are stripped first. A bare substring test passes on
  # this very file today — `scripts/test.sh` appears 3x in it, all inside comments, and those comments
  # say it does NOT delegate. Keyword-matching would read "declares it does not use it" as "uses it",
  # i.e. an always-true arm (verified 2026-09-15 by printing the 3 matches before trusting the count).
  unified = any("scripts/test.sh" in ln.split("#", 1)[0] for ln in wf.splitlines())
  # Arm (b): the tokenless test self-skips. Position-based: a guard line must both name a token env
  # var and reach a skip/return, on the same logical line — a prose mention never counts.
  guarded = False
  if os.path.exists(TEST):
      for ln in open(TEST, encoding="utf-8"):
          code = ln.split("//", 1)[0]
          if not re.search(r"(GH_TOKEN|GITHUB_TOKEN|QUAY_TEST_LIVE_GITHUB)", code): continue
          if re.search(r"(skip|return|t\.skip|it\.skip|describe\.skip)", code): guarded = True; break
  if not (unified or guarded):
      sys.stderr.write("CAUSE=hang-root-unfixed — release.yml still does not route through scripts/test.sh AND %s carries no token-gated skip guard => a tokenless run still fails and leaks MCP-server children, so `node --test` never exits (measured: 30m21s and 30m17s timeouts on v0.6.2/v0.6.3, 26 minutes of zero output, 7 orphan processes reaped)\n" % TEST); sys.exit(1)
  # Carrier arm: once a release run exists after the fix landed, it must not have been killed by the
  # job timeout. Absence of such a run is NOT a pass — AC-268 is what forces one to exist.
  CAR = ".quay/ci-runs.jsonl"
  import subprocess
  land = subprocess.run(["git","log","-1","--format=%cI","--",WF,TEST],capture_output=True,text=True).stdout.strip()
  if not land:
      sys.stderr.write("CAUSE=no-landing-commit — neither %s nor %s has any commit, so no post-fix window exists\n" % (WF, TEST)); sys.exit(1)
  if not os.path.exists(CAR):
      sys.stderr.write("CAUSE=carrier-absent — %s does not exist => the static arm holds but no release run has ever been recorded, so the fix has never been exercised in production\n" % CAR); sys.exit(1)
  rel = []
  for ln in open(CAR, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      if r.get("workflow") not in ("release.yml", "Release"): continue
      ts = str(r.get("ts") or "")
      if ts and ts > land: rel.append(r)
  if not rel:
      sys.stderr.write("CAUSE=no-release-run-after-fix — carrier holds no release run with ts > %s => the static arm holds but production has never exercised it\n" % land); sys.exit(1)
  timed_out = [r for r in rel if r.get("timedOut") is True or (isinstance(r.get("durationSec"), int) and r["durationSec"] >= 1800)]
  if timed_out:
      sys.stderr.write("CAUSE=still-hanging — %d of %d post-fix release runs still hit the job timeout (first: %s) => the leak path is not actually closed\n" % (len(timed_out), len(rel), timed_out[0].get("runId"))); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = ①静态臂（按位置判定，先剥 YAML 注释）：release.yml 的实际 run 命令走
  scripts/test.sh，或 mcp-server.test.mjs 带 token-gated skip 守卫 ∧ ②载体臂：存在 ts
  晚于修复落地的 release run 且未因 job 超时被杀。exit 1 且 stderr 带 CAUSE=hang-root-unfixed /
  no-release-run-after-fix / still-hanging 等。⛔
  静态臂必须剥注释：裸子串检查在本文件上恒真（scripts/test.sh 出现 3 次全在注释里，且注释说的是「不委托给它」）。
origin: 立案实测：v0.6.2/v0.6.3 的 release job 各撞 30m 超时（30m21s/30m17s），hang 在 Run
  tests——mcp-server.test.mjs 无 self-skip 守卫，无 GH_TOKEN 跑挂后泄漏 MCP server 子进程，node
  --test 永不退出，清理时终结 7 个孤儿进程。该 job 按设计绕过 scripts/test.sh，故 runner 的进程回收不适用。
activatedAt: 2026-09-15T11:32:19.813Z
statusLog:
  - at: 2026-09-15T11:32:19.813Z
    from: draft
    to: active
    actor: manager
    reason: 激活：判据已当轮干跑验证能取假（AC-266 另做了双向控制）
long-term: true
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-15T11:32:19.812Z
---
