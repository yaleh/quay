---
id: AC-200
title: goal 文件里的存储 evidence 块残留清零（SPEC §8 要求、原五条 AC 未覆盖）
status: achieved
kind: criterion
goal: GOAL-008
criterion: >-
  ls goals/*.md >/dev/null 2>&1 || { echo "AC-200 fail - goals/ 为空或不存在 —— 无法评估（≠
  合格）" >&2; exit 1; }

  test "$(grep -l '^evidence:' goals/*.md 2>/dev/null | wc -l)" -eq 0 || { echo
  "AC-200 fail: goals/*.md still carry a stored evidence block" >&2; exit 1; }
expect: 今天读数 18 个文件仍带存储 evidence 块 ⇒ 红。清理后 0。新写入的 goal 文件天然不带该块，故清完不会复发。
origin: >-
  SPEC-store-commit-unification-2026-09-08 §8 末段逐字要求「19 个 goal 文件仍带冻结的
  evidence.at ⋯ 应随阶段 1 清掉」，而阶段 1（gap-store-commit-unification-stage1）已
  done、GOAL-008 已 achieved，该项**未做**。根因是立 GOAL-008 时把它写进了 SPEC 却没写成 AC ⇒ 五条 AC
  全绿不覆盖它（管理者 2026-09-08 记账：这是立 goal 时的漏，不是实现者的）。


  实测（2026-09-08）：18/65 个 goal 文件仍带存储的 `evidence:` 块（`at` / `verdict` /
  `reading`），值冻结在 09-07 01:21–07:51；两个谓词（行首 `^evidence:` 与缩进 `at:`）给出同一集合、差集为空。


  **这不是持续泄漏，是切换前的陈旧快照。** 负控制：`gap-goal-evidence-cache-should-not-enter-git`
  之后新写的 goal 文件（GOAL-008 / AC-195 / AC-167）`evidence` 块计数均为 0 ⇒ 每个文件下次被写时自愈；18
  个残留者最后写入时间均 ≤ 09-07 09:05。⇒ 修法是一次性重写扫过，不是改写路径。


  **为什么必须清**：evidence 已改为 ledger-DERIVED（从 gitignored 的 .quay/gate-events.jsonl
  末行派生），文件里这个块**不再被写、也不再被读**——一个不再更新的字段和「一切正常」在记录上同形（硬规则 4b），读者会拿它当现况。


  判据取假的负控制：今天读数 18 ⇒ 判据 exit 1。判据首行对空/缺失 goals/ 给「无法评估」独立取值（exit 1），⛔
  不与「合格」同形（硬规则 3b）。
---
