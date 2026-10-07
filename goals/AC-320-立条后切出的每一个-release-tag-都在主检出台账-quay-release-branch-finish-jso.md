---
id: AC-320
title: 立条后切出的每一个 release tag 都在主检出台账 .quay/release-branch-finish.jsonl 有
  form=tagged exit=0 记录——切版走可重复载体且留痕可读回
status: superseded
kind: criterion
goal: GOAL-020
criterion: >-
  python3 - <<'P'

  import glob, json, os, re, subprocess, sys

  LEDGER = ".quay/release-branch-finish.jsonl"

  def git(*a):
      r = subprocess.run(["git"] + list(a), capture_output=True, text=True)
      return r.stdout.strip() if r.returncode == 0 else None
  common = git("rev-parse", "--path-format=absolute", "--git-common-dir")

  top = git("rev-parse", "--show-toplevel")

  if not common or not top: sys.stderr.write("NOT-EVALUATED:
  CAUSE=not-a-git-repo — git rev-parse failed at the criterion cwd, so neither
  the tags nor the main ledger were read\n"); sys.exit(3)

  main_root = os.path.dirname(common)

  me = sorted(glob.glob(os.path.join(top, "goals", "AC-320-*.md")))

  if not me: sys.stderr.write("NOT-EVALUATED: CAUSE=own-record-absent —
  goals/AC-320-*.md not found under %s, so the post-filing window has no
  start\n" % top); sys.exit(3)

  anchor = git("log", "--diff-filter=A", "-1", "--format=%ct", "--",
  os.path.relpath(me[0], top))

  if not anchor: sys.stderr.write("NOT-EVALUATED: CAUSE=own-record-uncommitted —
  %s has no add commit yet, so the post-filing window has no start (a window
  with no start is not an empty window)\n" % me[0]); sys.exit(3)

  anchor = int(anchor)

  refs = git("for-each-ref", "--format=%(refname:short) %(creatordate:unix)",
  "refs/tags/v*")

  if refs is None: sys.stderr.write("NOT-EVALUATED: CAUSE=tag-scan-failed — git
  for-each-ref refs/tags/v* failed, which is not the same as 'no release was
  cut'\n"); sys.exit(3)

  cut = []

  for ln in refs.splitlines():
      p = ln.split()
      if len(p) == 2 and re.match(r"^v\d+\.\d+\.\d+$", p[0]) and int(p[1]) > anchor: cut.append(p[0])
  if not cut: sys.stderr.write("NOT-EVALUATED: CAUSE=no-release-cut-since-filing
  — no vX.Y.Z tag was created after this record's filing commit (%d), so the
  one-carrier guarantee has no post-landing sample yet (tags cut before filing,
  e.g. v0.12.0 by hand from a scratch clone, are excluded on purpose)\n" %
  anchor); sys.exit(3)

  path = os.path.join(main_root, LEDGER)

  if not os.path.exists(path): sys.stderr.write("CAUSE=main-ledger-absent — %d
  release tag(s) cut since filing (%s) but the MAIN checkout ledger %s does not
  exist => the cuts left no record where a reader of the main ledger looks\n" %
  (len(cut), ", ".join(cut), path)); sys.exit(1)

  seen = set()

  for ln in open(path, encoding="utf-8"):
      try: r = json.loads(ln)
      except Exception: continue
      if r.get("form") == "tagged" and r.get("exit") == 0 and r.get("tag"): seen.add(r["tag"])
  missing = [t for t in cut if t not in seen]

  if missing: sys.stderr.write("CAUSE=cut-without-main-ledger-record — %d of %d
  release tag(s) cut since filing have no form=tagged exit=0 record in the MAIN
  ledger %s: %s (measured 2026-09-24: v0.12.0 was cut by hand and its record
  landed in a scratch clone's .quay/, invisible from the main ledger)\n" %
  (len(missing), len(cut), path, ", ".join(missing))); sys.exit(1)

  print("ok: all %d release tag(s) cut since filing have a tagged exit=0 record
  in the main ledger %s: %s" % (len(cut), path, ", ".join(cut))); sys.exit(0)

  P
expect: exit 0 = 本记录 add 提交之后创建的每个 vX.Y.Z tag，在【主检出】（git common dir 的父目录，⛔ 不是
  criterion cwd 或 worktree）的 .quay/release-branch-finish.jsonl 里都有 form=tagged ∧
  exit=0 ∧ tag 相同的记录。exit 1：CAUSE=main-ledger-absent /
  cut-without-main-ledger-record（列出缺记录的 tag）。exit 3 NOT-EVALUATED：本记录未提交（窗口无起点）/
  立条后尚无 tag（无落地后样本——⛔ 立条前的 v0.12.0 手工切版刻意排除）/ tag 扫描失败。⛔ 立条当轮控制（/tmp 仓库）：有 tag
  无台账 ⇒ 1；台账只有别的 tag ⇒ 1；补齐 ⇒ 0；从 linked worktree 跑仍读主检出台账 ⇒ 0。
origin: 人 2026-09-24 裁定重开 GOAL-020。直接量：v0.12.0 手工 12 步切版，release-branch-finish
  记录落在 /data/scratch/yale/quay-release-cut-v0120/.quay/，主检出台账末行仍是 2026-09-20；脚本
  repo_root 默认取脚本自身所在检出（release-branch-finish.sh:87），从 worktree/副本跑即落错台账。
activatedAt: 2026-09-24T08:20:49.887Z
statusLog:
  - at: 2026-09-24T08:20:49.887Z
    from: draft
    to: active
    actor: human
    reason: 人 2026-09-24 裁定重开 GOAL-020：按裁定激活
  - at: 2026-10-07T08:20:11.373Z
    from: active
    to: superseded
    actor: human
    reason: 人 2026-10-07 裁定取消（判据陈旧，非未达成）：判据要求 form=tagged 记录，而 2026-09-19
      起的规范切版路径（release-cut.sh → release-branch-finish.sh
      --cut，release-branch-finish.sh:377 cut_form="cut"）落台账的是 form=cut ⇒
      取值词表对不上，判据结构上不可能绿。台账里 v0.13.0/v0.14.0/v0.15.0/v0.16.0 四条 form=cut exit=0
      记录都带 tag、都落在主检出，判据要的「切版留痕可读回」本身已满足。goal-driver 本轮把该 AC 判为 world-gated。
long-term: true
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-24T08:20:49.886Z
---
