---
id: gap-chart2-s2-test-assertions-stale-after-delivery-c-d
title: chart2-s2 delivery-completeness test asserts stale evidence (both
  false/cov 0.0) since DELIVERY-C/D flipped it to both true — 12-day RED masked
  by 'modulo load-flake' phrasing; update 3 assertions to match real evidence +
  keep fail-closed negative control
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

> **翻 done（人 2026-08-12 00:4x 裁定，A 组）**：代码已合入 integration 且被 r308-green 覆盖，AC18 复核 measure 通过。

## Proposal

**既有 RED（持续 12 天，被「modulo documented load-flake」措辞掩盖）**：
`experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs` 的 3 个测试断言
evidence 文件为「both false / cov 0.0」，但 `chart2-s2-delivery.json` 已于 2026-07-24 由
DELIVERY-C/D 翻为 **both true**（S2 cov 0.667→1.00，3/3 FULL）。

**失败形态（2026-08-05 实测，scoped-full 早期 RED）**：
```
✖ loadS2Evidence: the checked-in real evidence file → both false
✖ CLI: against THIS repo (default root) → cov 0.0, version-consistent=false, exit 0
✖ CLI: explicit repoRoot arg → cov 0.0 against the real repo
```

**根因**：DELIVERY-C (ea3a33a9) / DELIVERY-D (1b1c81ab) 翻 evidence 为 true 时**没有同步更新测试断言**。
测试断言「both false / cov 0.0」写死于 07-23 DIR-064-A，DELIVERY 流程遗漏了断言同步。

**关键点**：这是**测试与 evidence 文件脱节**，不是逻辑缺陷。evidence 说「已交付」（true），
测试却断言「未交付」。修复 = 更新断言匹配真实状态。

### 选定机制

1. **更新 3 处断言**：`both false` → `both true`；CLI cov `0.0` → 真实值（version-consistent=true，cov = 3/3 或按 computeS2Cov 实际计算）
2. **添加负控制**：构造 evidence both false 的临时文件，断言 cov 0.0（保留原 fail-closed 语义覆盖）
3. **验证**：`scripts/test.sh experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs` 全绿

## Acceptance Criteria

- [x] AC1: 3 处失败断言更新为匹配 evidence 真实状态（both true / cov 真实值），单独跑该测试全绿
- [x] AC2: 负控制保留——临时 evidence both false 时 cov 仍为 0.0（fail-closed 语义不丢）
- [x] AC3: 与 DELIVERY-C/D 交叉标注（交付翻 evidence 时须同步断言）

## Evidence (2026-08-06, execution agent)

Invoke: `node --test experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs` (scoped)

```
ℹ tests 22
ℹ pass 22
ℹ fail 0
```

Scoped entrypoint: `scripts/test.sh --for-task gap-chart2-s2-test-assertions-stale-after-delivery-c-d --allow-thin` → EXIT 0 (22 pass / 0 fail). Contract measure (`grep -c '✖'`) = 0.

Changed in `experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs`:
- `loadS2Evidence: the checked-in real evidence file → both false` → **both true (DELIVERY-C/D)** — evidence file flips fullManifestPublished/foreignInstallE2eGreen to true.
- `CLI: against THIS repo (default root)` → asserts `cov = 0.6666666666666666 (2/3: version-consistent=false, manifest-published=true, foreign-install-green=true)`.
- `CLI: explicit repoRoot arg` → asserts `cov = 0.6666666666666666 (2/3)`.
- Added **AC2 negative control** `CLI: negative control — temp repo with both-false evidence → cov 0.0 (fail-closed)` (drifted versions + both-false evidence file ⇒ cov 0/3, flags all false) — preserves fail-closed semantics.
- AC3 cross-annotation comment above the evidence assertion naming DELIVERY-C (ea3a33a9) / DELIVERY-D (1b1c81ab) and the sync rule.

## Touches

- experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs
- tasks/exp5-M-PRODUCTIZED-DELIVERY-C.md（AC3 交叉标注）
- tasks/exp5-M-PRODUCTIZED-DELIVERY-D.md（AC3 交叉标注）
- tasks/gap-chart2-s2-test-assertions-stale-after-delivery-c-d.md

## Contract

measure   s2_fail = `node --test experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs 2>&1 | grep -c '✖'` stdout 数字段
band      s2_fail = 0（修后单独跑无失败）
invoke    `node --test experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs`
control   evidence 临时改 false ⇒ cov 0.0 断言仍抓（AC2）
resume    断言更新与负控制分两步提交，任一步完成即写盘
## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
