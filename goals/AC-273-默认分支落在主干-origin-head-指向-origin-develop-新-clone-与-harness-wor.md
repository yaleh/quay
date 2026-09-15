---
id: AC-273
title: 默认分支落在主干：origin/HEAD 指向 origin/develop——新 clone 与 harness worktree 的基点不再是化石
status: active
kind: criterion
goal: GOAL-020
criterion: >-
  python3 - <<'P'

  import subprocess, sys

  r = subprocess.run(["git", "symbolic-ref", "refs/remotes/origin/HEAD"],
  capture_output=True, text=True)

  if r.returncode != 0 or not r.stdout.strip():
      sys.stderr.write("CAUSE=origin-head-unset — refs/remotes/origin/HEAD is not set in this checkout, so the base that `git clone` and harness worktree creation inherit cannot be read here; run `git remote set-head origin -a` once (this is an instrument gap in THIS checkout, not evidence about the remote)\n"); sys.exit(1)
  head = r.stdout.strip()

  if head != "refs/remotes/origin/develop":
      sys.stderr.write("CAUSE=default-branch-not-the-trunk — origin/HEAD points at %s, not refs/remotes/origin/develop => every fresh clone and every harness-created worktree starts from that ref instead of the trunk (measured 2026-09-15 while authoring the SPEC: a worktree created this way opened 19555 commits behind develop, on the 2026-08-03 fossil, and had to be re-based by hand)\n" % head); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = git symbolic-ref refs/remotes/origin/HEAD ==
  refs/remotes/origin/develop。exit 1 且 stderr 带
  CAUSE=default-branch-not-the-trunk（并打印它实际指向哪里）。CAUSE=origin-head-unset
  是仪器缺口（该检出没跑过 git remote set-head），不是关于远端的证据。⛔ 判据读本地 ref 而不是调 gh：criterion 只有
  pass/fail 两态、60s 预算，且 gh 不在 driver 的 PATH 上——网络/认证失败会与真红同形。⛔ 立案当轮已做负控制：把期望值换成
  origin/master ⇒ exit 1，CAUSE=default-branch-not-the-trunk
origin: SPEC §2.2 后果 1+2、§3.2.1，人 2026-09-15 裁定 1（『是，且与 master 改造无冲突』）。立案实测：撰写该
  SPEC 时 EnterWorktree 建出的 worktree 直接落在化石 master 上、落后 develop 19555 个提交，必须手工
  reset 才能工作——机制是 worktree 默认 baseRef = origin/<默认分支> 而 origin/HEAD ->
  origin/master。本判据落案当日已执行裁定 1：gh api repos/yaleh/quay -X PATCH -f
  default_branch=develop（已复核返回 develop），并在本检出跑了 git remote set-head origin
  -a（origin/HEAD 由 master 改为 develop）。⇒ 本判据此后守的是『它不要退回去』，以及其它检出补跑 set-head。
activatedAt: 2026-09-15T14:01:44.869Z
long-term: true
---
