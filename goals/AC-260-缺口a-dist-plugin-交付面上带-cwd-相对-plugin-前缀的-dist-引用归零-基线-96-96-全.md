---
id: AC-260
title: 缺口A：dist-plugin 交付面上带 cwd 相对 plugin/ 前缀的 dist 引用归零（基线 96/96 全是错形）
status: draft
kind: criterion
goal: GOAL-019
criterion: |-
  python3 - <<'P'
  import re, subprocess, sys
  BR = "dist-plugin"
  try:
      files = subprocess.run(["git","ls-tree","-r","--name-only",BR],capture_output=True,text=True,check=True).stdout.split()
  except Exception as e:
      sys.stderr.write("AC-260: cannot read branch %s (%s) => the marketplace delivery face is absent, so this AC has never been exercised\n" % (BR, e)); sys.exit(1)
  mds = [f for f in files if f.endswith(".md")]
  if not mds:
      sys.stderr.write("AC-260: branch %s carries no .md file => delivery face malformed, nothing to judge\n" % BR); sys.exit(1)
  ANY_RE = re.compile(r'[A-Za-z0-9_${}/.-]*scripts/dist/[A-Za-z0-9_.-]+\.js')
  BAD_RE = re.compile(r'(^|[^A-Za-z0-9_${}.-])(\.?/)?plugin/scripts/dist/[A-Za-z0-9_.-]+\.js')
  total = 0
  bad = []
  for f in mds:
      try:
          txt = subprocess.run(["git","show","%s:%s" % (BR, f)],capture_output=True,text=True,check=True).stdout
      except Exception:
          continue
      total += len(ANY_RE.findall(txt))
      for m in BAD_RE.finditer(txt): bad.append((f, m.group(0).strip()))
  if total == 0:
      sys.stderr.write("AC-260: zero scripts/dist/*.js references found across %d .md files on %s => the scan matched nothing, so a zero offender count would carry no information (hard rule 3b: a predicate that cannot hit must not report PASS)\n" % (len(mds), BR)); sys.exit(1)
  if bad:
      sys.stderr.write("AC-260: %d of %d dist references on %s still carry a cwd-relative plugin/ prefix (first 3: %r) => in a consuming project the plugin IS the tree root, so these resolve to a path that does not exist there\n" % (len(bad), total, BR, bad[:3])); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = dist-plugin 分支上 scripts/dist/*.js 引用总数 ≥1（证明谓词扫到了真对象）∧ 其中带 cwd
  相对 plugin/ 前缀的 = 0。exit 1 = 分支不可读（交付面缺失 ⇒ 本 AC 从未被行使）／分支无 .md／总数为 0（谓词什么都没命中 ⇒
  零 offender 不携带信息，硬规则 3b：读不懂输入不得与合格同形）／仍有 offender（打印前 3 条实际命中，硬规则 2）。基线读数
  2026-09-15：96 个引用全部是 offender，正确形式 0 个。⛔ 判据刻意不锁某一种前缀写法（不要求必须是
  ${CLAUDE_PLUGIN_ROOT}），只要求在消费项目里解析得到——实现可换任何等价自解析形式而无需改判据。⚠️ 实现落地后必须重跑
  publish-dist-branch.sh，否则本判据读到的是旧交付面。
origin: 2026-09-15 对 dist-plugin 分支的直接测量：96 个 scripts/dist 引用全部带 cwd 相对 plugin/
  前缀（跨 loop/ 与 8 个 skill），正确形式 0 个。根因 build-plugin-dist.mjs:445-459 的
  rewriteMarkdown 只改扩展名、不加任何 plugin-root 前缀（该文件内 CLAUDE_PLUGIN_ROOT grep 零命中）。这是
  SPEC-plugin-lifecycle:203-206 活着的那一半：引擎解析已由 plugin-root.ts 修好，skill 文档没修。
---
