---
id: AC-271
title: release 分支合回后即删除，或其 tip 逐字停在同名 tag 上——⛔ 不得在 tag 之后继续生长
status: active
kind: criterion
goal: GOAL-020
criterion: >-
  python3 - <<'P'

  import subprocess, sys

  r = subprocess.run(["git", "for-each-ref", "--format=%(refname:short)",
                      "refs/heads/release-*", "refs/heads/release/*"],
                     capture_output=True, text=True)
  if r.returncode != 0:
      sys.stderr.write("CAUSE=for-each-ref-failed — `git for-each-ref refs/heads/release-*` exited %d: %s => the branch set this criterion judges could not be enumerated\n" % (r.returncode, r.stderr.strip()[:200])); sys.exit(1)
  branches = [b for b in r.stdout.split() if b.strip()]

  bad = []

  for b in branches:
      t = subprocess.run(["git", "tag", "--points-at", b], capture_output=True, text=True)
      if t.returncode != 0:
          sys.stderr.write("CAUSE=tag-points-at-failed — could not resolve tags at %s\n" % b); sys.exit(1)
      if not t.stdout.split():
          ahead = subprocess.run(["git", "rev-list", "--count", "%s" % b], capture_output=True, text=True).stdout.strip()
          bad.append((b, ahead))
  if bad:
      msg = "CAUSE=release-branch-not-parked-on-a-tag — %d of %d release branches have a tip that is not any tag: %s => a release branch that keeps growing after its tag stops representing what was released (baseline at filing: release-v063-build sat 15 commits past v0.6.3). nvie's model deletes the release branch after the merge; this line accepts either deletion or a tip parked exactly on its tag\n" % (len(bad), len(branches), ", ".join(b for b, _ in bad))
      sys.stderr.write(msg); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = 本地不存在 release-* / release/* 分支，或每一条的 tip 都 points-at 某个
  tag。exit 1 且 stderr 带 CAUSE=release-branch-not-parked-on-a-tag
  并列出违规分支名与总数。仪器失败走 CAUSE=for-each-ref-failed / tag-points-at-failed。⛔ 判据按 tip
  是否指向 tag 判定，不按分支名解析版本号——旧名 release-v062-build 与新规程 release/vX.Y.Z 都适用
origin: SPEC §4.1 + §7 乙。立案实测：release-v062-build 的 tip 正好是 v0.6.2（合规），而
  release-v063-build 的 tip 比 v0.6.3 多 15 个提交（含 d097f48c7『移除隐式触发』这条与该版本无关的 CI
  改动）⇒ 分支名说『v063 的构建』，内容已经不是。nvie 原文要求 release 分支合回后删除；本判据接受删除或 tip 停在 tag
  上两种合规形态。立案当轮实跑：exit 1，1 of 2 违规。
activatedAt: 2026-09-15T14:02:15.532Z
long-term: true
---
