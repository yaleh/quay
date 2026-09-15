---
id: AC-260
title: 缺口A：dist-plugin 交付面上带 cwd 相对 plugin/ 前缀的 dist 引用归零（基线 96/96 全是错形）
status: achieved
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
  fileset = set(files)
  carriers = [f for f in files if f.rsplit(".",1)[-1] in ("md","sh","js")]
  if not carriers:
      sys.stderr.write("AC-260: branch %s carries no .md/.sh/.js file => delivery face malformed, nothing to judge\n" % BR); sys.exit(1)
  ANY_RE = re.compile(r'[A-Za-z0-9_${}/.-]*(scripts|gate-scripts)/dist/[A-Za-z0-9_.-]+\.js')
  BAD_RE = re.compile(r'(^|[^A-Za-z0-9_${}.-])(\.?/)?plugin/(scripts|gate-scripts)/dist/[A-Za-z0-9_.-]+\.js')
  TS_RE  = re.compile(r'\$\{CLAUDE_PLUGIN_ROOT\}/(scripts|gate-scripts)/([A-Za-z0-9_.-]+\.ts)')
  total = 0
  bad = []
  dangling = []
  for f in carriers:
      try:
          txt = subprocess.run(["git","show","%s:%s" % (BR, f)],capture_output=True,text=True,check=True).stdout
      except Exception:
          continue
      total += len(ANY_RE.findall(txt))
      for m in BAD_RE.finditer(txt): bad.append((f, m.group(0).strip()))
      for m in TS_RE.finditer(txt):
          tgt = "%s/%s" % (m.group(1), m.group(2))
          if tgt not in fileset: dangling.append((f, m.group(0), tgt))
  if total == 0:
      sys.stderr.write("AC-260: zero scripts/dist/*.js references across %d carriers on %s => the scan matched nothing, so a zero offender count would carry no information (hard rule 3b: a predicate that cannot hit must not report PASS)\n" % (len(carriers), BR)); sys.exit(1)
  if bad:
      sys.stderr.write("AC-260: %d of %d dist references on %s still carry a cwd-relative plugin/ prefix (first 3: %r) => in a consuming project the plugin IS the tree root, so these resolve to a path that does not exist there\n" % (len(bad), total, BR, bad[:3])); sys.exit(1)
  if dangling:
      sys.stderr.write("AC-260: %d plugin-root-anchored raw .ts references on %s point at files the publish strip step deleted (first 3: %r) => sibling instance of the same defect, invisible to the cwd-relative predicate alone (hard rule 5b)\n" % (len(dangling), BR, dangling[:3])); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = dist-plugin 分支上（.md/.sh/.js 三类载体）scripts|gate-scripts/dist/*.js
  引用总数 ≥1（零计数的配对，防谓词扫不到被伪装成修好）∧ 其中带 cwd 相对 plugin/ 前缀的 = 0 ∧ 以 plugin 根为锚但指向已被
  publish strip 步删除的 raw .ts 的引用 = 0。exit 1 = 分支不可读（交付面缺失 ⇒ 本 AC 从未被行使）／无载体／总数为
  0（硬规则 3b：谓词命不中时不得与合格同形）／仍有 cwd 相对 offender／仍有悬空 raw .ts；每支各自打印计数与前 3 条实际命中（硬规则
  2）。基线读数 2026-09-15：261 个引用中 260 个是 cwd 相对 offender（.md 96／.sh 134／.js 30），另有
  11 条 plugin-root 锚定的悬空 .ts（跨 5 个 SKILL.md，目标被 publish-dist-branch.sh:136 的
  strip 步删除）。⚠️ 第三支是硬规则 5b 的产物：那 11 条的锚是对的，cwd 相对谓词数不到它们——只修 .md 那 96 条会让本 AC
  变绿而交付面仍是半坏。⛔ 判据刻意不锁具体前缀写法（不要求必须是
  ${CLAUDE_PLUGIN_ROOT}），只要求在消费项目里解析得到。【取证义务，随并发撞车收尾并入】实现方必须【实测】${CLAUDE_PLUGIN_ROOT}
  在 SKILL.md 正文上下文中究竟可用与否、把读数入档，⛔ 不得只凭 plugin/skills/init/SKILL.md:41-44
  的既有用法推断可用——官方文档只确认 hooks 与 MCP command 两个上下文，SKILL
  正文未表态；可用则采用它，不可用则换等价自解析形式（两种都满足本判据）。⚠️ 实现落地后必须重跑
  publish-dist-branch.sh，否则读到的是旧交付面。
origin: 2026-09-15 对 dist-plugin 分支的直接测量：scripts/dist 引用带 cwd 相对 plugin/ 前缀，正确形式
  0 条。根因 build-plugin-dist.mjs 的 rewriteMarkdown(:445-459) 与
  rewriteShell(:466-501) 只换扩展名、不加任何 plugin-root 锚（该文件内 CLAUDE_PLUGIN_ROOT grep
  零命中）。这是 SPEC-plugin-lifecycle:203-206 活着的那一半：引擎解析已由 plugin-root.ts
  修好，产物里的路径没修。【判据拓宽记录】初版只扫 .md 且只查 cwd 相对前缀（96/96）；同日另一会话并发立案
  gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths
  报出两类兄弟实例，经本会话独立复量逐字吻合（全载体 260 条 = md 96 + sh 134 + js 30；plugin-root 锚定的悬空 raw
  .ts 11 条）⇒ 按硬规则 5b 拓宽为三支，否则只修被报出来的那一类会让本 AC 变绿而交付面半坏。
activatedAt: 2026-09-15T04:00:16.249Z
statusLog:
  - at: 2026-09-15T04:00:16.249Z
    from: draft
    to: active
    actor: manager
    reason: GOAL-019 已激活，本 AC 进入在评
  - at: 2026-09-15T04:42:23.035Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-15T04:00:16.249Z
---
