---
id: gap-npm-pack-ac3-gate-counter-example-refs
title: npm-pack-e2e 红 — package.sh AC3 gate 把反例引用当活引用（4 反例 + 2 真引用需声明）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Finding

`packages/quay/test/npm-pack-e2e.test.mjs` 全量红（0 pass / 9 fail，连续多轮）。**实测根因（inner 2026-08-12 逐层定位）**：不是 AC3 gate 的反例引用（原任务体归因经实测不成立），而是 **#61 fan-in 引入 `plugin/scripts/orphan-session-check.ts` 但未在 capability-catalog.sh 声明** → AC1c entry-point gate（unclassified=1）⇒ capability-catalog.sh exit 1 ⇒ package.sh 的 `--entry-surface` 前置检查失败 ⇒ npm-pack-e2e 全部 9 测试失败。

## 实测（2026-08-12，npm-pack-e2e 失败输出 + bash -x 定位）

**npm-pack-e2e 失败输出**：package.sh 打印「AC3 gate → PASS」却 exit 1——矛盾。`bash -x capability-catalog.sh --entry-surface` 定位到 `+ exit 1`（VIOLATION_COUNT=0、AC3 PASS 之后），源头是 AC1c gate（`:1523` `if [ "$UNCLASSIFIED" -gt 0 ]; then exit 1`）。

**逐文件确认**：`orphan-session-check.ts` 在 capability-catalog.sh 五表（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）均无声明 → `210 scripts | 209 declared | 1 unclassified`。

**原任务体的 6 个 .sh 归因实测不成立**（逐文件验证）：
- 4 个「反例」heavy-op-token.sh / idle-watch.sh / inner-state.sh / outer-liveness.sh：**全库不存在**（`find` 0 命中），gate 从未把它们当活引用
- 2 个「真引用」restart-readiness-check.sh（在 `experiments/quay-perpetual-stream/scripts/`）/ worktree-include.sh（在仓库根 `scripts/`）：**都不在 `plugin/scripts/`**，AC3 gate 的 PUBLIC_ENTRYPOINTS 只覆盖 plugin/scripts/ 交付物，管不到它们
- AC3 gate 的 grep pattern `plugin/scripts/[a-z]+\.sh` 在 consumer docs 里匹配到的 31 个 distinct .sh **不含这 6 个**（文档以裸名引用，pattern 匹配不到）——所以 AC3 gate 从未失败在这 6 个上

**修复后验证**：声明 orphan-session-check.ts 五表后 `--entry-surface` exit 0（0 unclassified），npm-pack-e2e **9/9 绿**。

## 修复方向（inner 实测后裁定，替代原 outer 裁定）

1. **声明 `orphan-session-check.ts`** 到 capability-catalog.sh 五表（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）——这是 npm-pack-e2e 红的直接修复
2. **原任务体的 6 个 .sh 议题不执行**——实测证明它们不在 plugin/scripts/、gate 未当活引用；AC3 gate 对裸名引用是设计盲区（那些脚本本就不在交付物里），无需为不存在的违规修 gate

## AC

- [x] 复现固化——任务体记录真实根因（orphan-session-check.ts 未声明触发 AC1c）+ 原归因的实测推翻
- [x] orphan-session-check.ts 声明到 capability-catalog.sh 五表（0 unclassified）
- [x] 修后 `bash packages/quay/scripts/package.sh` 通过（npm-pack-e2e 9/9 绿）
- [x] 既有 capability-catalog 测试不回归（15/15 绿）
- [x] 原任务体 6 个 .sh 归因实测推翻并记录（不执行无效修法）

## DoD

- [ ] 修后全量套件 npm-pack-e2e 绿（外层 verification-round 验证）
- [ ] `capability-catalog.sh --entry-surface` 报 0 违规（exit 0）
- [ ] 全量套件绿（fail 0 且 cancelled 0）（外层 verification-round 验证）

## Evidence（inner 2026-08-12）

**commit**：capability-catalog.sh 五表声明 orphan-session-check.ts（QUESTION 每轮 / CADENCE 每轮 / INVALIDATION 无可测前提 / LAST_REAFFIRMED 2026-08-12 / MATCHING position）。

**验证读数**：
1. `capability-catalog.sh --entry-surface`：exit 0（修复前 exit 1），`210 scripts | 210 declared | 0 unclassified`
2. `npm-pack-e2e.test.mjs`：**9/9 绿**（修复前 0/9）
3. `capability-catalog.test.mjs`：15/15 绿（不回归）

**根因链条**：#61（c6d24bab）引入 orphan-session-check.ts → 未在 capability-catalog 五表声明 → AC1c unclassified=1 → capability-catalog exit 1 → package.sh --entry-surface 前置失败 → npm-pack-e2e 全红。