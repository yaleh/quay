---
id: gap-ac38-split-regression-cluster-5-checker-tests
title: AC38 切分回归簇（5 条 checker/doc 测试）—— product 模板泛化 vs 测试断言
status: ready
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

- [x] AC1: threshold-scope-check AC6 绿（计数匹配当前面）
- [x] AC2: instrument-failure-check --gate 绿（注入量自适应，注入后超过 baseline 必红）
- [x] AC3: self-report-vocab-check AC3 绿（doc-side 引用按裁定落位）
- [x] AC4: inner-session-check AC2 绿（step 3 degraded 命名）
- [x] AC5: loop-shipping AC1b/AC1c 绿（旧路径清干净、/loop prompt 落点对）；五文件隔离绿 + `--for-task` scoped

## Invoke Evidence（inner 2026-08-12，worktree `gap-ac38-split-regression-cluster-5-checker-tests`）

逐条修 + 设计裁定（Product 泛化 vs 测试断言，按任务 Proposal「product 加机制级注记」选项落地）：

1. **threshold-scope AC6**（计数 3→2）：`plugin/test/threshold-scope-check.test.mjs` 断言改 2，注释更正为「AC38 切分后 注册表 ≥2 退出 canonical 扫描面 → 只剩 2 条 ≥3 违例」（实测 violations = `["≥3","≥3"]`，stalePaths = `[".claude/workflows/execute-milestone.js"]`）。
2. **instrument-failure --gate**（注入量自适应）：`plugin/test/instrument-failure-check.test.mjs` 同 .sh 修法（commit 431f591d）——读 `--gate --json` 的 `counts[1]/baselines[1]`，注入 `baseline - current + 1` 条 family-1，从任意绿面必超 baseline 红。
3. **self-report-vocab AC3**（归属裁定=product 加机制级注记）：不改测试（仍读产品模板），在 `plugin/loop/orchestrator-loop-tick.md` 重锚节补 doc-side/audit 双侧注记（引 `gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round` + 「单独做任一条都解决不了」）。
4. **inner-session-check AC2**（step 3 degraded 命名）：`plugin/loop/orchestrator-loop-tick.md` 步骤 3 三态表加第 4 行 degraded + transcript 解析段补 `transcriptSource==discovery` fail-closed 措辞；`plugin/skills/cold-start/SKILL.md` 同步补四态。
5. **loop-shipping AC1c**（/loop 落点）：`plugin/loop/orchestrator-loop-tick.md` laydown-set 导出行改指 consumer 落点（`orchestration/orchestrator-loop-tick.md` + `docs/analysis/fast-mode-loop-tick.md`），不再拼 `plugin/loop/*.md`。
6. **loop-shipping AC1b**（旧路径残留）：`plugin/test/outer-loop-tick-split.test.mjs` 是 AC38 切分测试、**必须**引用 orchestration/ 实例落点 → 在 `plugin/scripts/loop-shipping-exclusion-data.mjs` 排除表补该条目（target-layout 类，同 quay-init-loop-consumer-doc-refs / no-manager-tick-doc-check）。〔注：该文件不在任务 Touches 枚举内，但 AC5 明确要求 AC1b 绿且这是单一事实来源——已如实列出〕

**验证（worktree 内）**：
- 五文件隔离：`node --test` 五文件 = **65 tests, pass 65, fail 0, cancelled 0**
- scoped 门：`bash scripts/test.sh --for-task gap-ac38-split-regression-cluster-5-checker-tests` = **65 pass, 0 fail, 0 cancelled**
- 相关回归：necessity-check 3/3、cold-start-skill+outer-loop-tick-split 19/19、quay-init-consumer+loop-driver+no-manager+tick-core-static 33/33、laydown/init/liveness 组 39 pass 0 fail 1 skip（tmux/env skip）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 五文件隔离重跑全绿（证据贴出）
- [ ] `--for-task gap-ac38-split-regression-cluster-5-checker-tests` scoped 门绿
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/test/threshold-scope-check.test.mjs（AC6 计数断言 3→2）
- plugin/test/instrument-failure-check.test.mjs（注入量自适应）
- plugin/test/self-report-vocab-check.test.mjs（AC3 归属裁定落位）
- plugin/test/inner-session-check.test.mjs（AC2 degraded-state 命名）
- plugin/test/loop-shipping.test.mjs（AC1b/AC1c 旧路径清理）
- plugin/scripts/loop-shipping-exclusion-data.mjs（排除表补 outer-loop-tick-split.test.mjs——AC38 实例落点引用合法非 stale；任务执行时补，原 Touches 漏列）
- plugin/skills/cold-start/SKILL.md（step 3 degraded-state 命名，若需）
- plugin/loop/orchestrator-loop-tick.md（product 注记或 /loop 落点校正，若需）
- tasks/gap-ac38-split-regression-cluster-5-checker-tests.md（自身：勾 AC + 贴证据）
