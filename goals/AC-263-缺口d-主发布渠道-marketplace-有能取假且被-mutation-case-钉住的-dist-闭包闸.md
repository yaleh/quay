---
id: AC-263
title: 缺口D：主发布渠道（marketplace）有能取假且被 mutation case 钉住的 dist 闭包闸
status: draft
kind: criterion
goal: GOAL-019
criterion: >-
  python3 - <<'P'

  import os, re, sys

  PUB = "plugin/scripts/publish-dist-branch.sh"

  if not os.path.exists(PUB):
      sys.stderr.write("AC-263: %s absent => the marketplace publish path moved and this criterion can no longer judge it\n" % PUB); sys.exit(1)
  lines = open(PUB, encoding="utf-8").read().splitlines()

  calls = []

  for i, ln in enumerate(lines, 1):
      code = ln.split("#", 1)[0]
      if re.search(r'closure', code, re.I): calls.append((i, code.strip()[:110]))
  if not calls:
      sys.stderr.write("AC-263: %s asserts no dist closure => the marketplace channel, which SPEC-plugin-lifecycle:139 names the primary release channel, publishes with no self-containment check at all (only the npm tarball has one, package.sh:193-206)\n" % PUB); sys.exit(1)
  guarded = [c for c in calls if "||" in c[1] or "exit" in c[1]]

  has_errexit = any(re.search(r'set\s+-[a-z]*e', l.split("#", 1)[0]) for l in
  lines)

  if not guarded and not has_errexit:
      sys.stderr.write("AC-263: the closure assertion in %s is neither guarded (|| exit) nor covered by set -e (calls=%r) => a failing check would not abort the publish, so the gate could never take false\n" % (PUB, calls)); sys.exit(1)
  TDIR = "plugin/test"

  if not os.path.isdir(TDIR):
      sys.stderr.write("AC-263: %s absent => cannot confirm a mutation case pins the new gate\n" % TDIR); sys.exit(1)
  tests = []

  for fn in sorted(os.listdir(TDIR)):
      if not fn.endswith(".mjs"): continue
      try: txt = open(os.path.join(TDIR, fn), encoding="utf-8").read()
      except Exception: continue
      if "publish-dist-branch" in txt and re.search(r'closure', txt, re.I): tests.append(fn)
  if not tests:
      sys.stderr.write("AC-263: no plugin/test/*.mjs pins both publish-dist-branch and its closure assertion => the new gate ships with no mutation case, so silently deleting it would stay green (repo discipline: a new checker ships a mutation case)\n"); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = publish-dist-branch.sh 剥掉行注释后存在 closure（不分大小写）断言 ∧ 该断言被 || exit
  守卫或被 set -e 覆盖（否则闸失败也不中止发布 ⇒ 结构上不可能取假，硬规则 4）∧ plugin/test/*.mjs 中存在同时钉住
  publish-dist-branch 与 closure 的测试（mutation case，仓库既有纪律：新 checker 必带）。exit 1 =
  任一项缺失。基线 2026-09-15：该脚本内 closure 零命中——即 SPEC-plugin-lifecycle:139
  所称的主发布渠道完全没有自包含断言，而唯一有闸的 --verify-closure 只覆盖 npm
  tarball（package.sh:193-206）。⛔ 判据用 closure 宽匹配而非某个具体 flag
  名，以免锁死实现命名；若实现采用完全不含该词的命名，同步 update 本 AC 是契约的一部分，不是判据缺陷。
origin: 2026-09-15 实测对照：npm tarball 侧有 --verify-closure
  闭包断言（package.sh:193-206，且自带负控制——移除一个被引用的 bundle 即 exit 1），而 marketplace 侧的
  publish-dist-branch.sh 无任何等价断言。⇒ 被 SPEC-plugin-lifecycle:139
  声明为主发布渠道的那一条，恰恰是没有自包含校验的那一条。
---
