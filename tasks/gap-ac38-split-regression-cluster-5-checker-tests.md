---
id: gap-ac38-split-regression-cluster-5-checker-tests
title: AC38 切分回归簇（5 条 checker/doc 测试）—— product 模板泛化 vs 测试断言
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（outer 2026-08-12，round-13 确认套件 + 隔离重跑）**：AC38 切分把 `plugin/loop/orchestrator-loop-tick.md` 重写为通用模板（产品行为进 plugin / 实例状态留 orchestration），引入一组 checker/doc 测试回归。已修 5 条（threshold-scope ratchet 5969b096 / session-liveness+loop-driver e49df061 / suite-state-trigger 不待轮 53e4d694 / self-report-vocab-audit reanchor 5fc13f9a）。**剩 5 条**：

| # | 失败 | 断言 | 性质 |
|---|---|---|---|
| 1 | `threshold-scope-check.test.mjs` AC6 | "expected 3 unscoped count-threshold violations, got 2" | **测试过期计数**——re-baseline 后当前面只有 2 条 `≥` 违例，测试硬编码 3 |
| 2 | `instrument-failure-check.test.mjs` --gate | "expected RED after injecting 1 family-1... detected=2 baseline=2 ok" | **同一单注入 bug**——与已修的 .sh mutation case 同根（硬编码注入 1，当前 family-1=1 ⇒ 2≤baseline 不超） |
| 3 | `self-report-vocab-check.test.mjs` AC3 | tick 须引用 `gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round` + `单独做任一条都解决不了` | **generification 张力**——短语在两份文档都不存在（pre-split 也无），测试读 product 模板而内容是实例级 |
| 4 | `inner-session-check.test.mjs` AC2 | "step 3 must name the degraded state (discovery fallback is fail-closed)" | cold-start skill step 3 缺 degraded-state 命名（plugin/skills） |
| 5 | `loop-shipping.test.mjs` AC1b/AC1c | "no live reference to the moved files' old paths may remain" / "/loop prompts reference CONSUMER landing not bundle source" | AC38 move 一致性——旧路径残留 / /loop prompt 落点 |

**选定机制**：逐条修。1/2 = 测试断言更新（自适应注入量 / 当前计数）；3 = 设计裁定（product 泛化 vs 测试读实例）——建议：实例级内容（特定任务引用）测试改读 `orchestration/orchestrator-loop-tick.md`，或 product 加机制级注记；4 = cold-start SKILL step 3 补 degraded 命名；5 = AC38 move 后清理旧路径引用 / 校正 /loop prompt 落点。

**验证锚**：五条各自隔离绿 + `--for-task` scoped 门绿 + 全量静态过。

## Plan

1. 逐条跑 `node --test plugin/test/<file>.test.mjs` 读断言原文。
2. 1：threshold-scope 断言 3→2（或改读当前面计数）。
3. 2：instrument-failure 测试注入量改自适应（`baseline - current + 1`，同 .sh 修法）。
4. 3：裁定 product vs instance 归属 → 改测试读 instance 或 product 补注记。
5. 4：cold-start SKILL step 3 补 degraded-state 命名。
6. 5：loop-shipping AC1b 清旧路径引用、AC1c 校正 /loop prompt 落点。
7. 回归：五文件隔离绿 + `--for-task` scoped + checker-mutation 全绿。

## AC

- [ ] AC1: threshold-scope-check AC6 绿（计数匹配当前面）
- [ ] AC2: instrument-failure-check --gate 绿（注入量自适应，注入后超过 baseline 必红）
- [ ] AC3: self-report-vocab-check AC3 绿（doc-side 引用按裁定落位）
- [ ] AC4: inner-session-check AC2 绿（step 3 degraded 命名）
- [ ] AC5: loop-shipping AC1b/AC1c 绿（旧路径清干净、/loop prompt 落点对）；五文件隔离绿 + `--for-task` scoped

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 五文件隔离重跑全绿（证据贴出）
- [ ] `--for-task gap-ac38-split-regression-cluster-5-checker-tests` scoped 门绿
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证
