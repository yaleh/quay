---
id: gap-ac200-clear-frozen-goal-evidence-blocks
title: goal 文件里的存储 evidence 块残留清零（AC-200）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-200
---
## Proposal

正本：`orchestration/SPEC-store-commit-unification-2026-09-08.md` §8 残留清理段（"59 个 goal 文件中 19 个仍带冻结的 evidence.at 块……应随阶段 1 清掉"）+ 判据 `goals/AC-200-goal-文件里的存储-evidence-块残留清零-spec-8-要求-原五条-ac-未覆盖.md`（goal=GOAL-008）。今天读数（已实测，位置判定）：`grep -l '^evidence:' goals/*.md` 命中 18 个文件 ⇒ 红。

根因：`gap-goal-evidence-cache-should-not-enter-git`（done）已把 evidence 改为 ledger-DERIVED（从 gitignored 的 `.quay/gate-events.jsonl` 末行派生），goal 文件里的 `evidence:` 块从此**不再被写、也不再被读**——但该任务只落地了「不再写入」，没清掉切换前已写进 git 的陈旧快照。18 个块的 `at` 值冻结在 09-07 06:28 前后，是死数据；一个不再更新的字段与「一切正常」在记录上同形（硬规则 4b），读者会拿它当现况。

**为什么清完不会复发**（负控制）：`gap-goal-evidence-cache-should-not-enter-git` 落地后新写的 goal 文件（GOAL-008 / AC-195 / AC-167）`evidence` 计数均为 0；18 个残留者最后写入时间均 ≤ 09-07 09:05。故修法是一次性重写扫过，不改写路径。

**落点**：对 18 个文件各删其 frontmatter 里的 `evidence:` 块（4 行：`evidence:`、`  at:`、`  verdict:`、`  reading:`，位于 `origin` 字段之后、`---` 闭合分隔线之前），其余 frontmatter 与正文逐字节不动。

## AC

- [x] `test "$(grep -l '^evidence:' goals/*.md 2>/dev/null | wc -l)" -eq 0` —— 立条时读数 18（能取假），清理后 0。

## DoD

- [x] 上述判据实跑并贴出输出：`grep -l '^evidence:' goals/*.md` 为空、`wc -l` = 0。
- [x] 18 个文件除 `evidence:` 块外逐字节不变：每个文件的 `git diff` 只含 4 行删除（`evidence:` / `at:` / `verdict:` / `reading:`），无其它改动。
- [x] 负控制：`goals/*.md` 文件总数不变（66），未误删、未误改任何 goal 文件。
- [ ] 改动提交并落到 develop，全量 suite 绿（fan-in）。（待外部）

## Touches

- goals/AC-179-web-card-and-cli.md
- goals/AC-174-hard-cap-replaces-singleton.md
- goals/AC-180-active-ac.md
- goals/AC-186-goal-driver-goal-store-kind-goal.md
- goals/AC-159-linked-doc-references-sync.md
- goals/AC-171-migrate-live-phases-into-store.md
- goals/AC-170-goal-id-vocabulary-migration.md
- goals/AC-183-sync-fresh-window-not-ff-benign.md
- goals/AC-164-plugin-namespace-takes-traffic.md
- goals/AC-172-draft-status-real-carrier.md
- goals/AC-173-revoke-prose-authority.md
- goals/AC-176-abi-encapsulation.md
- goals/AC-175-staleness-three-state-and-divergence.md
- goals/AC-182-goal-goals-md-develop-doc-ff-only.md
- goals/AC-184-driver-driver.md
- goals/AC-178-task-goal-linkage.md
- goals/AC-177-goal-driver-production-records.md
- goals/AC-181-meta-driver.md
- tasks/gap-ac200-clear-frozen-goal-evidence-blocks.md