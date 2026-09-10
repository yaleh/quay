---
id: gap-ac156-spec-12e-dead-set-lines-writeback
title: AC156 判据仍红——死集已重算（116→112）但 SPEC §12e 未写回「扫描前/后死集」两个机读行
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-156
---
## Proposal

**问题（立案当轮实测）**：`goals/AC-156-bare-filename-scan.md`（status=active、goal=GOAL-003）的判据
`grep -qE '^- 扫描前死集: [0-9]+$' SPEC && grep -qE '^- 扫描后死集: [0-9]+$' SPEC`
现为 fail（exit 1）——`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §12e 没有这两行机读行（grep `扫描前死集`/`扫描后死集` 在该文件零命中，实测）。

**根因**：`gap-dead-set-registry-bare-filename-scan`（done）已按 §12d/§12f 重算死集（before=116 → after=112，摘出 4 个被裸文件名引用的脚本），结果落 `docs/analysis/dead-set-recomputed.json`（`before.deadCount=116`、`after.deadCount=112`），但从未把这两个数字写回 SPEC §12e。AC-156 正文明写「扫描后死集数写回 SPEC §12e」——这一步缺席 ⇒ 判据结构上无法取真。

**修法（最小面）**：在 SPEC §12e 补两行机读行 `- 扫描前死集: N` 与 `- 扫描后死集: M`，数字来自真实重算——重跑 `plugin/scripts/registry-bare-filename-scan.ts --dead-set` 取当前值，或沿用 `docs/analysis/dead-set-recomputed.json` 并在行旁注明来源与方法窗口；⛔ 不凭空造数。仅此一处 doc 改动：不改 goal AC 记录、不改扫描器本身。

## AC

- [x] AC-156 判据取真：`f=orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md; grep -qE '^- 扫描前死集: [0-9]+$' "$f" && grep -qE '^- 扫描后死集: [0-9]+$' "$f"` ⇒ exit 0（这正是 AC-156 自己的判据，goal-driver 下一轮将独立复核）
- [x] 数字可追溯：SPEC 里两行的 N/M 与 `docs/analysis/dead-set-recomputed.json` 的 before/after deadCount 一致，或与一次新跑的 `--dead-set` 输出一致，且行旁注明来源与方法窗口；⛔ 不凭空造数
- [x] 能取假：临时删掉其中一行 ⇒ 上一条判据 exit 非 0（证明判据测的是这两行机读行，不是恒真）
- [x] `node plugin/scripts/task-schema-check.ts tasks/gap-ac156-spec-12e-dead-set-lines-writeback.md` ⇒ exit 0

## DoD

SPEC §12e 出现两行独立机读行 `- 扫描前死集: N` 与 `- 扫描后死集: M`，两个数字来自真实重算（重跑 `--dead-set` 或引用 `docs/analysis/dead-set-recomputed.json` 并注明来源与方法窗口），且 AC-156 判据在 goal-driver 下一轮由 fail 转 pass（读 `.quay/goal-round.jsonl` 中该 AC 的 verdict）。⛔ 只把数字写进散文段落而不落独立的 `^- 扫描前死集:` 机读行，或数字凭空编造 ⇒ 不算达成。

## Touches

- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
- tasks/gap-ac156-spec-12e-dead-set-lines-writeback.md
