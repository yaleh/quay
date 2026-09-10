---
id: gap-ac167-baime-iteration-executor-removal
title: AC167 判据仍红——baime-iteration-executor.md 从 plugin.json 摘除并 archive（agent +
  连带测试/文档/闭包基线）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac166-second-copy-retirement
goal_ac: AC-167
---
## Proposal

**问题（立案当轮实测）**：`goals/AC-167-baime-executor-removal.md`（status=active、goal=GOAL-003）判据现为 fail——`plugin/.claude-plugin/plugin.json` 的 `agents[]` 仍含 `./agents/baime-iteration-executor.md`（第 28 行）、`plugin/agents/baime-iteration-executor.md` 仍存在、`archive/INDEX.tsv` 无 `baime-iteration-executor` 归档记录。AC-167 的 expect 是「plugin.json 不再提及 baime-iteration-executor ∧ 该 agent 已移走 ∧ archive/INDEX.tsv 有其归档记录」。

**工作（人 2026-09-02 裁定④「对零调用的工具，先退役」落地）**：`baime-iteration-executor.md` 是零调用 agent（`quay:iteration-executor` 在 `plugin/workflows/*.js` 与 driver 无派发点，只在 plugin.json 声明 + 测试/文档提及），按 SPEC §12 archive（`git mv` + INDEX 同提交，不是 rm）。连带修三处会红的面：① `plugin/test/plugin-packaging.test.mjs` 断言 `agents[]` 含 baime 与 agent 文件存在；② `plugin/test/gate-scripts-retirement.test.mjs` + `test/cold-start-e2e.sh` 断言 quay-init 后 `.claude/agents/baime-iteration-executor.md` 存在；③ `docs/analysis/quay-init-closure-ratchet.baseline.json` 闭包基线含该 agent（shrink-only 判据允许实际 < 基线，但 freshness 门会因源树变化红 ⇒ 需 `--reanchor`）。

**依赖**：AC-167 criterion 第 3 行 `[ -e plugin/scripts/workflows-dual-copy-drift-check.ts ] && exit 1` 由 AC-166（`gap-ac166-second-copy-retirement`，status=ready，其 AC4 已覆盖 drift-checker + 测试 + checker-mutation-case 三件同批 archive）负责——本任务**不重 archive** drift-checker，只做 baime-iteration-executor 部分；`depends_on` AC-166，AC-166 落地后 AC-167 全判据才能 exit 0。

**正本**：`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §12。**前置已就绪**：archive 机制 AC157（`archive/INDEX.tsv` 七字段表头已存在）、`archive/**` 排除面已接线（`scripts/test.sh:872`）。

## Plan

1. **摘除 plugin.json**：删 `plugin/.claude-plugin/plugin.json` `agents[]` 里的 `"./agents/baime-iteration-executor.md",` 一行（`agents[]` 只留 `./agents/quay-task.md`）。
2. **archive agent**：`git mv plugin/agents/baime-iteration-executor.md archive/2026-09-07-baime-iteration-executor-removal/plugin/agents/baime-iteration-executor.md`（保持原始相对路径；执行日不同则 slug 日期用执行日）。
3. **写 INDEX**：`archive/INDEX.tsv` 追加一行七字段 `original_path · archive_path · date · reason_code · evidence · restore_cmd · commit`；`reason_code=zero-call`，evidence 取可复核读数（如 `dispatch_sites=0 callers=0`），restore_cmd=`git mv <archive_path> <original_path>`。
4. **修三个会红的面**：`plugin-packaging.test.mjs` 去掉 baime 断言（只留 quay-task）；`gate-scripts-retirement.test.mjs` + `test/cold-start-e2e.sh` 去掉 `.claude/agents/baime-iteration-executor.md` 存在性断言；`plugin/README.md` 去掉第 87 行 doc 行。
5. **闭包基线 re-anchor**：`node --no-warnings --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor --root .`，重测真实 laydown + 记录源树指纹（源树已无该 agent）。
6. **同一提交**：plugin.json 改动 + `git mv` + INDEX 行 + 测试/文档/基线改动在同一个 commit（硬规则 7）。
7. **验证**：AC-167 criterion 逐字 exit 0；全量 `scripts/test.sh` 绿（证明无悬空引用、闭包 ratchet shrink-only 绿）。

## AC

- [x] AC1（AC-167 criterion 逐字 exit 0）：`grep -q 'baime-iteration-executor' plugin/.claude-plugin/plugin.json && exit 1; [ -e plugin/agents/baime-iteration-executor.md ] && exit 1; [ -e plugin/scripts/workflows-dual-copy-drift-check.ts ] && exit 1; grep -q 'baime-iteration-executor' archive/INDEX.tsv || exit 1; exit 0`
- [x] AC2（plugin.json 收敛）：`grep -c 'baime-iteration-executor' plugin/.claude-plugin/plugin.json` == 0 ∧ `grep -c 'quay-task.md' plugin/.claude-plugin/plugin.json` == 1
- [x] AC3（agent 已 git mv）：`[ ! -e plugin/agents/baime-iteration-executor.md ] && [ -e archive/2026-09-08-baime-iteration-executor-removal/plugin/agents/baime-iteration-executor.md ]` exit 0
- [x] AC4（INDEX 七字段行）：`tail -n +2 archive/INDEX.tsv | grep 'baime-iteration-executor' | awk -F'\t' '{print NF}'` 输出 == 7
- [x] AC5（测试/文档面不红）：`grep -c 'baime-iteration-executor' plugin/test/plugin-packaging.test.mjs plugin/test/gate-scripts-retirement.test.mjs test/cold-start-e2e.sh plugin/README.md` 全为 0
- [x] AC6（闭包 ratchet 两模式绿）：`node --no-warnings --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --gate --root .` exit 0 ∧ 同脚本 `--check-stale --root .` exit 0 ∧ `grep -c 'baime-iteration-executor' docs/analysis/quay-init-closure-ratchet.baseline.json` == 0
- [x] AC7（全量 suite 绿）：`scripts/test.sh` exit 0
- [x] AC8（schema）：`node plugin/scripts/task-schema-check.ts tasks/gap-ac167-baime-iteration-executor-removal.md` exit 0

## DoD

`goals/AC-167-baime-executor-removal.md` criterion exit 0（plugin.json 无 baime ∧ agent 已 archive ∧ `archive/INDEX.tsv` 有其七字段记录 ∧ drift-checker 已由 AC-166 移走），goal-driver 下一轮 verdict 由 fail 转 pass（读 `.quay/goal-round.jsonl` 中 AC-167 的 verdict）；全量 suite 绿。⛔ 只删 plugin.json 不 archive / 只 archive 不写 INDEX / `git mv` 与 INDEX 分两次提交 / 留下会红的测试断言或闭包基线未 re-anchor ⇒ 不算达成。

## Touches

- plugin/.claude-plugin/plugin.json
- plugin/agents/baime-iteration-executor.md
- archive/INDEX.tsv
- archive/2026-09-08-baime-iteration-executor-removal/plugin/agents/baime-iteration-executor.md
- plugin/test/plugin-packaging.test.mjs
- plugin/test/gate-scripts-retirement.test.mjs
- test/cold-start-e2e.sh
- plugin/README.md
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-ac167-baime-iteration-executor-removal.md