---
id: AC-158
title: 执行批次一 —— 扫描后死集 git mv + INDEX 同一提交
status: active
kind: criterion
goal: GOAL-003
criterion: |-
  python3 - <<'P'
  import os,re,sys
  rows=[l.rstrip('\n').split('\t') for l in open('archive/INDEX.tsv')][1:]
  rows=[r for r in rows if len(r)>=2 and r[0].strip()]
  if not rows: sys.exit(1)
  for r in rows:
      if os.path.exists(r[0]) or not os.path.exists(r[1]): sys.exit(1)
  spec=open('orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md').read()
  m=re.search(r'^- 扫描后死集: (\d+)$', spec, re.M)
  sys.exit(0 if m and int(m.group(1))==len(rows) else 1)
  P
expect: exit 0（INDEX 有数据行 ∧ 每条 original_path 已不存在、archive_path 存在 ∧ 行数 == SPEC
  记录的扫描后死集数）
origin: |
  人 2026-09-02 裁定④「对零调用的工具，先退役（archive），后续发现需要了再恢复」。
  正本 orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §12。
evidence:
  at: 2026-09-07T01:12:10.058Z
  verdict: fail
  reading: acceptance failed (exit 1)
---

**判据（能取假）**：扫描后死集全部 `git mv` 进 archive，**自带测试同批移动**，`git mv` 与 INDEX 行
**同一提交**（硬规则 7）。

**取假**：`plugin/scripts` 计数未下降 / INDEX 行数 ≠ 移动文件数 / suite 红。


