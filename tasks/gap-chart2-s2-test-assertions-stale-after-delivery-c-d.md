---
id: gap-chart2-s2-test-assertions-stale-after-delivery-c-d
title: chart2-s2 delivery-completeness test asserts stale evidence (both
  false/cov 0.0) since DELIVERY-C/D flipped it to both true — 12-day RED masked
  by 'modulo load-flake' phrasing; update 3 assertions to match real evidence +
  keep fail-closed negative control
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

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

- [ ] AC1: 3 处失败断言更新为匹配 evidence 真实状态（both true / cov 真实值），单独跑该测试全绿
- [ ] AC2: 负控制保留——临时 evidence both false 时 cov 仍为 0.0（fail-closed 语义不丢）
- [ ] AC3: 与 DELIVERY-C/D 交叉标注（交付翻 evidence 时须同步断言）

## Touches

- experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs
- tasks/exp5-M-PRODUCTIZED-DELIVERY-C.md（AC3 交叉标注）
- tasks/exp5-M-PRODUCTIZED-DELIVERY-D.md（AC3 交叉标注）

## Contract

measure   s2_fail = `node --test experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs 2>&1 | grep -c '✖'` stdout 数字段
band      s2_fail = 0（修后单独跑无失败）
invoke    `node --test experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs`
control   evidence 临时改 false ⇒ cov 0.0 断言仍抓（AC2）
resume    断言更新与负控制分两步提交，任一步完成即写盘