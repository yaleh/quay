---
id: AC-274
title: 首次真实全绿发布，且 master 已 ff 到它——⛔ 时间窗限定在本条立案之后，不得被历史绿run满足
status: active
kind: criterion
goal: GOAL-020
criterion: >-
  python3 - <<'P'

  import json, os, subprocess, sys

  CAR = ".quay/ci-runs.jsonl"

  SINCE = "2026-09-15T14:00:00Z"

  if not os.path.exists(CAR):
      sys.stderr.write("CAUSE=carrier-absent — %s does not exist, so no release outcome can be read at all\n" % CAR); sys.exit(1)
  rows = []

  for ln in open(CAR, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      if r.get("workflow") != "Release": continue
      rows.append(r)
  greens = [r for r in rows if r.get("conclusion") == "success" and
  str(r.get("ts") or "") > SINCE]

  if not greens:
      decisive = [r for r in rows if r.get("conclusion") in ("success", "failure")]
      sys.stderr.write("CAUSE=no-green-release-in-the-post-filing-window — carrier holds %d Release runs (%d decisive), none with conclusion=success and ts > %s => the release channel has not yet produced one fully green run since this line was filed. ⛔ The window is deliberate: a green run that predates the filing would satisfy this line without the mechanism ever having run (硬规则 4 推论三). Baseline at filing: last fully green Release run was v0.3.13 on 2026-07-24, and v0.6.2/v0.6.3 both failed\n" % (len(rows), len(decisive), SINCE)); sys.exit(1)
  tags = [str(r.get("branch") or "") for r in greens]

  mh = subprocess.run(["git", "rev-parse", "master"], capture_output=True,
  text=True)

  if mh.returncode != 0 or not mh.stdout.strip():
      sys.stderr.write("CAUSE=no-master-ref — a green release exists (%s) but `git rev-parse master` failed, so the ff cannot be checked\n" % ",".join(tags)); sys.exit(1)
  master = mh.stdout.strip()

  for t in tags:
      rc = subprocess.run(["git", "rev-parse", "--verify", "-q", "%s^{commit}" % t], capture_output=True, text=True)
      if rc.returncode == 0 and rc.stdout.strip() == master:
          sys.exit(0)
  tail = "CAUSE=green-release-not-reflected-on-master — %d fully green Release
  run(s) since %s (%s) but master is at %s, which is none of their tags => the
  advance-master job did not run, did not have the whole job set in its needs:,
  or its ff was rejected\n" % (len(greens), SINCE, ",".join(tags), master[:9])

  sys.stderr.write(tail); sys.exit(1)

  P
expect: "exit 0 = .quay/ci-runs.jsonl 里存在 workflow=Release ∧ conclusion=success
  ∧ ts > 2026-09-15T14:00:00Z 的 run，且 master 的提交正是其中某个 tag 的提交。exit 1 且 stderr 带
  CAUSE=no-green-release-in-the-post-filing-window（发布链还没全绿过）/
  green-release-not-reflected-on-master（绿了但 master 没跟上 ⇒ advance-master job
  没跑、或它的 needs: 不是全集、或 ff 被拒）。⛔ 时间窗是硬规则 4
  推论三的要求：一条能被实现落地【之前】的记录满足的判据，证明的是『能产出』不是『已产出』"
origin: SPEC §6/§9 第 5 步 + §7 戊，人 2026-09-15 裁定 4（首次 ff 等 v0.7.0 全绿，⛔ 不接受 ff
  到红着的 v0.6.3——那会让 master 从第一天起就说谎）。立案实测：载体里 2 条 Release run（v0.6.2/v0.6.3）全是
  failure；最后一次全绿 Release run 是 2026-07-24 的 v0.3.13，其后连续 6 个版本失败，跨度 7 周；npm .tgz
  在 v0.4.0..v0.6.3 六个版本里只在 v0.5.0 出现过一次，而 README 与 release note 模板都在教用户装
  tgz。本条是一次性判据：它依赖 AC-268（release 渠道真发出一个版本），并在其之上多要一步——那次绿必须反映到 master 上。
activatedAt: 2026-09-15T14:02:16.910Z
long-term: false
---
