---
id: AC-268
title: release 渠道经 workflow_dispatch 真发出一个版本（conclusion=success）
status: superseded
kind: criterion
goal: GOAL-020
criterion: |-
  python3 - <<'P'
  import json, os, subprocess, sys
  WF = ".github/workflows/release.yml"
  CAR = ".quay/ci-runs.jsonl"
  if not os.path.exists(WF):
      sys.stderr.write("CAUSE=workflow-absent — %s does not exist => there is no release channel left to judge\n" % WF); sys.exit(1)
  wf = open(WF, encoding="utf-8").read()
  if "workflow_dispatch" not in wf:
      sys.stderr.write("CAUSE=dispatch-trigger-gone — %s no longer declares workflow_dispatch; since 2026-09-14 13:19 tag pushes do NOT trigger a release (gap-github-actions-no-implicit-triggers), so without dispatch there is no reachable way to cut one\n" % WF); sys.exit(1)
  land = subprocess.run(["git","log","-1","--format=%cI","--",WF],capture_output=True,text=True).stdout.strip()
  if not land:
      sys.stderr.write("CAUSE=no-landing-commit — %s has no commit, so no post-change window exists\n" % WF); sys.exit(1)
  if not os.path.exists(CAR):
      sys.stderr.write("CAUSE=carrier-absent — %s does not exist => no release run has ever been recorded (last observed release success was v0.3.13 on 2026-07-24, six versions ago)\n" % CAR); sys.exit(1)
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
      sys.stderr.write("CAUSE=no-release-run-after-change — carrier holds no release run with ts > %s => the release channel has not been exercised since it became dispatch-only\n" % land); sys.exit(1)
  ok = [r for r in rel if r.get("conclusion") == "success"]
  if not ok:
      sys.stderr.write("CAUSE=release-still-failing — %d release runs after %s, none with conclusion=success (streak at filing: v0.4.0/v0.5.0/v0.6.0/v0.6.2/v0.6.3 all failed, last success v0.3.13 on 2026-07-24)\n" % (len(rel), land)); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = release.yml 仍声明 workflow_dispatch（否则无可达触发路径）∧ 载体中存在 ts 晚于
  release.yml 落地提交、conclusion=success 的 release run。exit 1 且 stderr 带
  CAUSE=dispatch-trigger-gone / no-release-run-after-change /
  release-still-failing 等。⛔ 本 AC 不带 long-term：发版是一次性动作，不是需要每轮复验的活性状态。
origin: "人 2026-09-15 拍板 (b)：接受在本 GOAL 期内经 workflow_dispatch 真发一次版本。⚠️
  release.yml 已于 2026-09-14 13:19 改为 on: workflow_dispatch only（带必填 tag 输入），tag
  push 不再自动触发，故任何期待 git push --tags 产生 release run 的判据结构上不可满足。最后一次 release 成功是
  2026-07-24 的 v0.3.13。"
activatedAt: 2026-09-15T11:42:04.934Z
statusLog:
  - at: 2026-09-15T11:42:04.934Z
    from: draft
    to: active
    actor: manager
    reason: 激活：判据当轮干跑取假；已按 release.yml 现为 dispatch-only 的事实写判据
  - at: 2026-09-15T17:50:42.112Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
  - at: 2026-09-16T09:37:42.749Z
    from: achieved
    to: superseded
    actor: manager
    reason: 人 2026-09-16 裁定取消 SEA/npm 产物发布渠道（release.yml 的
      release/sea-release/sea-verify-node-free(-cross-platform) 等 job），改为让
      advance-master 消费 Claude Code plugin
      渠道自己的发布+安装验证——判据主体所依赖的产物线本身被取消，非缺陷已修。见
      orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md §11。
long-term: false
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-15T11:42:04.933Z
---
