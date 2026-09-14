---
id: AC-158
title: 执行批次一 —— 扫描后死集 git mv + INDEX 同一提交
status: achieved
kind: criterion
goal: GOAL-003
criterion: >-
  python3 - <<'P'

  import os,sys

  rows=[l.rstrip('\n').split('\t') for l in open('archive/INDEX.tsv')][1:]

  rows=[r for r in rows if len(r)>=7 and r[0].strip()]

  batch=[r for r in rows if r[3].strip()=='zero-call' and
  r[0].startswith('plugin/scripts/')]

  if not batch: sys.stderr.write("AC-158 fail - archive/INDEX.tsv has no
  reason_code=zero-call row whose original_path is under plugin/scripts/\n");
  sys.exit(1)

  for r in batch:
      if os.path.exists(r[0]) or not os.path.exists(r[1]): sys.stderr.write("AC-158 fail - original_path=%s exists=%s, archive_path=%s exists=%s\n"%(r[0],os.path.exists(r[0]),r[1],os.path.exists(r[1]))); sys.exit(1)
      if not (r[4].strip() and r[5].strip() and r[6].strip()): sys.stderr.write("AC-158 fail - INDEX.tsv row original_path=%s has an empty evidence/restore_cmd/commit field\n"%r[0]); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0（archive/INDEX.tsv 中至少 1 条 reason_code=zero-call ∧ original_path 在
  plugin/scripts/ 下的行；每条这样的行 original_path 已不存在、archive_path
  存在、evidence/restore_cmd/commit 非空。⛔ 不校验条数——人 2026-09-08 裁定「多处理几个文件少处理几个文件不应阻碍
  goal 落地」）
origin: 人 2026-09-02 裁定④「对零调用的工具，先退役（archive），后续发现需要了再恢复」。正本
  orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §12。人
  2026-09-08 裁定：优先保障 AC-168 落地，简化 AC-158——归档条数不得成为 goal 的闸。
---
**判据（能取假）**：零调用死集脚本 `git mv` 进 `archive/`，**自带测试同批移动**，`git mv` 与 INDEX 行
**同一提交**（硬规则 7），INDEX 七字段齐全且 `restore_cmd` 可机械恢复（SPEC §12a/§12b）。

**⊕ 2026-09-08 人裁定简化（发现：原判据结构上不可满足，硬规则 4c 同形）**：原判据要求
`archive/INDEX.tsv 数据行数 == SPEC §12e「扫描后死集: N」`。写下时 INDEX 为空、等式成立；此后
**AC-166 追加 13 行、AC-167 追加 1 行**——`INDEX.tsv` 是全仓库共享的追加式台账，不是本 AC 专属。
⇒ 本批次移动 M 个，判据读到 `14+M`，而任务定义的 N=M ⇒ **任意 M 都 FAIL**（已实测模拟
M=31/82/112 全 FAIL）。判据点名的量没能穿过中间层（被兄弟任务写入的共享台账）。

**人 2026-09-08 逐字裁定**：「优先保障 AC-168 落地，简化 AC-158。AC-158 多处理几个文件少处理
几个文件不应阻碍 goal 落地。」⇒ **条数不再是闸**。新判据改为按 `reason_code=zero-call` ∧
`original_path` 在 `plugin/scripts/` 下**筛出本 AC 的行**（与 AC-166 的 `second-copy`、AC-167 的
`plugin/agents/` 天然区分），只判**纪律**不判**数量**：至少 1 条 ∧ 每条 original 已不存在、
archive 存在 ∧ evidence/restore_cmd/commit 三字段非空。⛔ 不再与 SPEC 的死集种群数做等式——
那是两个不同的量（种群规模 vs 归档件数）。

**四向控制（2026-09-08 实测，非 fixture 自证）**：①当前仓库（未归档）⇒ exit 1（能取假）；
②归档 1 / 3 / 40 个 ⇒ 全 exit 0（**多几个少几个都过，裁定落地**）；③台账说移了但 original 还在
⇒ exit 1；④evidence 字段空 ⇒ exit 1（SPEC §12a「缺一不可」保住）。