---
id: AC-272
title: 滚动渠道（marketplace/dist-plugin）自证版本：要么带 -dev 后缀自证非发布版，要么确实等于同名 tag 的构建
status: achieved
kind: criterion
goal: GOAL-020
criterion: >-
  python3 - <<'P'

  import re, subprocess, sys

  def git(*a):
      r = subprocess.run(["git", *a], capture_output=True, text=True)
      return r.returncode, r.stdout.strip(), r.stderr.strip()
  rc, _, _ = git("rev-parse", "--verify", "-q", "dist-plugin^{commit}")

  if rc != 0:
      sys.stderr.write("CAUSE=dist-plugin-branch-absent — this checkout has no dist-plugin ref, so the rolling channel's shipped version cannot be read (fetch it, or run this where the branch exists)\n"); sys.exit(1)
  ver = None

  for path in ("VERSION", "plugin/VERSION"):
      rc, out, _ = git("show", "dist-plugin:%s" % path)
      if rc == 0 and out.strip():
          ver = out.strip().splitlines()[0].strip(); break
  if not ver:
      sys.stderr.write("CAUSE=dist-plugin-version-unreadable — neither dist-plugin:VERSION nor dist-plugin:plugin/VERSION holds a version string, so what the marketplace channel claims to ship cannot be determined\n"); sys.exit(1)
  if ver.endswith("-dev"):
      sys.exit(0)
  rc, tagsha, _ = git("rev-parse", "--verify", "-q", "v%s^{commit}" % ver)

  if rc != 0 or not tagsha:
      sys.stderr.write("CAUSE=claims-a-version-that-was-never-released — dist-plugin ships version %r but no tag v%s exists => whatever `/plugin install` pulls advertises a version number with no release behind it, and neither a user nor a checker can answer 'which version is this' (baseline at filing: dist-plugin claimed 0.7.0 while the newest tag was v0.6.3, built from a commit 548 past that tag and 155 behind develop). Ruling 2 (2026-09-15) resolves this by carrying -dev on develop; a bare version here means the -dev discipline is not in force\n" % (ver, ver)); sys.exit(1)
  rc, msg, _ = git("log", "-1", "--format=%s", "dist-plugin")

  m = re.search(r"build from ([0-9a-f]{7,40})", msg or "")

  if not m:
      sys.stderr.write("CAUSE=build-source-unrecorded — dist-plugin's tip subject %r carries no 'build from <sha>' marker, so the commit it was built from cannot be recovered\n" % (msg or "")[:120]); sys.exit(1)
  rc, srcsha, _ = git("rev-parse", "--verify", "-q", "%s^{commit}" % m.group(1))

  if rc != 0 or not srcsha:
      sys.stderr.write("CAUSE=build-source-unresolvable — dist-plugin says it was built from %s but that commit does not resolve in this repository\n" % m.group(1)); sys.exit(1)
  if srcsha != tagsha:
      sys.stderr.write("CAUSE=released-version-built-from-a-different-commit — dist-plugin claims released version %s (tag v%s = %s) but was built from %s => the channel advertises a release while shipping something else\n" % (ver, ver, tagsha[:9], srcsha[:9])); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = dist-plugin 声明的版本以 -dev 结尾（裁定2 的预发布标记，自证不是已发布版本），或该版本有同名 tag
  v<版本> 且 dist-plugin tip 的『build from <sha>』正是该 tag 的提交。exit 1 且 stderr 带
  CAUSE=claims-a-version-that-was-never-released /
  released-version-built-from-a-different-commit / build-source-unrecorded
  等。仪器失败走 CAUSE=dist-plugin-branch-absent / dist-plugin-version-unreadable
origin: SPEC §2.5 + §4.3（人 2026-09-15 裁定 2：版本 bump 落 develop 带 -dev 后缀）+ §7
  丙。立案实测：dist-plugin 的 VERSION=0.7.0，而最新 tag 是 v0.6.3、v0.7.0 不存在；其构建来源 2b47315d7
  在 v0.6.3 之后 548 个提交、在 develop tip 之前 155 个提交 ⇒ 用户 /plugin install 装到的东西自称
  0.7.0，既不等于任何 tag 也不等于 develop 当前状态，『装到的是哪个版本』没有可机械回答的形式。裁定 2 的 -dev
  后缀就是让这个问题从字面量即可回答。立案当轮实跑：exit
  1，CAUSE=claims-a-version-that-was-never-released。
activatedAt: 2026-09-15T14:01:43.417Z
statusLog:
  - at: 2026-09-15T15:09:42.589Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
---
