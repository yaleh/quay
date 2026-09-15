---
id: AC-270
title: master 的值域不变式：要么停在首次 ff 前的化石值，要么等于一个 Release run 全绿的 tag——⛔ 没有第三种取值
status: active
kind: criterion
goal: GOAL-020
criterion: >-
  python3 - <<'P'

  import json, os, subprocess, sys

  FOSSIL = "9316b797dddc89d4b6168051b781e6d554fc70fa"

  CAR = ".quay/ci-runs.jsonl"

  def git(*a):
      r = subprocess.run(["git", *a], capture_output=True, text=True)
      return r.returncode, r.stdout.strip()
  rc, head = git("rev-parse", "master")

  if rc != 0 or not head:
      sys.stderr.write("CAUSE=no-master-ref — `git rev-parse master` failed => the ref this criterion judges is absent in this checkout; instrument problem, not a verdict\n"); sys.exit(1)
  if head == FOSSIL:
      sys.exit(0)
  rc, out = git("tag", "--points-at", "master")

  tags = [t for t in out.splitlines() if t.strip()]

  if not tags:
      sys.stderr.write("CAUSE=master-moved-to-a-non-tag-commit — master is at %s, which is neither the pre-first-ff fossil %s nor any tag => something committed or pushed directly to master, which SPEC-release-and-hotfix-branching §3.1 forbids (master's ONLY permitted movement is the advance-master job's ff to a fully green release tag)\n" % (head[:9], FOSSIL[:9])); sys.exit(1)
  if not os.path.exists(CAR):
      sys.stderr.write("CAUSE=carrier-absent — master advanced to %s but %s does not exist, so whether that tag's Release run was fully green cannot be read at all (the criterion reads a local carrier on purpose: gh is not on the driver's PATH, and a network/auth failure would be indistinguishable from a red release)\n" % (",".join(tags), CAR)); sys.exit(1)
  ok = False

  for ln in open(CAR, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      if r.get("workflow") != "Release": continue
      if r.get("conclusion") != "success": continue
      if str(r.get("branch") or "") in tags: ok = True; break
  if not ok:
      sys.stderr.write("CAUSE=advanced-to-a-tag-without-a-green-release-run — master points at %s but the carrier holds no Release run for it with conclusion=success => master advanced on a HALF-green release, which is the exact invisibility this line exists to remove (v0.6.3's Release object predated its own run by 12s while the run was red)\n" % ",".join(tags)); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = master 处于两个允许取值之一：①9316b797d（裁定4 允许的首次 ff 前状态）②某个 tag，且该 tag 在
  .quay/ci-runs.jsonl 里有 conclusion=success 的 Release run。exit 1 且 stderr 带
  CAUSE=master-moved-to-a-non-tag-commit（有东西直推了 master）/
  advanced-to-a-tag-without-a-green-release-run（在半绿发布上前进了）/ no-master-ref /
  carrier-absent（仪器）。⛔ 立案当轮已做负控制：把判据指向 develop（既非化石也非 tag）⇒ exit
  1，CAUSE=master-moved-to-a-non-tag-commit
origin: SPEC-release-and-hotfix-branching-2026-09-15 §3.1/§7 甲，人 2026-09-15 裁定
  3+4。立案实测：master 停在 2026-08-03 的 9316b797d（ADR-015 经典循环终点，ADR-022
  同日退役该循环后无人再碰），master..develop=19548、develop..master=0；它既不是任何 tag（git describe
  --exact-match 报 no tag exactly matches），也不代表任何已发布状态。本判据把「master
  只能有两个取值」变成每轮可查的不变式，首次 ff 之前它守的是「没有东西直推 master」，首次 ff 之后守的是「master
  没有在半绿发布上前进」——后者正是 v0.6.3 暴露的形态：Release 对象比它自己的 run 早 12 秒诞生，而那次 run 是红的。
activatedAt: 2026-09-15T14:01:41.510Z
long-term: true
---
