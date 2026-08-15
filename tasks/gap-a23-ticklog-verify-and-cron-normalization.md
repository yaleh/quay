---
id: gap-a23-ticklog-verify-and-cron-normalization
title: 两处 A23/cron 面修复（① outer-tick-log-check 不识 A23 ⇒ B13 行无四判据输出无人可判；② outer-cron-registry cron `*/N`≡显式分钟被判漂移 ⇒ 每轮恒红训练跳过习惯）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（outer 已核实定案，两处都在 plugin/ 面，归 inner 实现。② 更要紧——恒红训练「已知跳过」习惯，真违规会淹没。）**

**① A23 无人识别**：`outer-tick-log-check.sh`（339 行）认识 B13 行（五条不等式，:11 注释），但**不认识 A23 四判据输出**。A23（orchestrator-tick-core.md:47）要求 AC81 四判据输出逐行进外层 tick-log（可 grep：判据号 + 状态）。现状：**0 文件识别 A23** ⇒ 「B13 行存在而同轮无 A23 四判据输出行」无人可判（manager 硬规则⑨：缺失则 tick-log 行不合法）。

**② cron `*/N` ≡ 显式分钟被判漂移**：`outer-cron-registry.ts:323` `expr === rec.cronExpr` 严格字符串比较。`*/20`（CronList 可能显示）≡ `0,20,40`（注册表记录）语义等价但字符串不同 ⇒ `cron-expr-mismatch` finding ⇒ code=1 VIOLATED，每轮恒红（训练跳过习惯）。修法：比较前把 `*/N` 展开成分钟集合、比集合。

**判据1（② 修复）**：cron 比较归一化——`*/N` 展开为分钟集合，与显式分钟集合比较；语义等价（`*/20` vs `0,20,40`）不再判漂移；真漂移（不同分钟集合）仍 VIOLATED。
**判据2（① 修复）**：`outer-tick-log-check.sh` 新增 A23 检查——某轮 tick 段含 B13 行而同段无 A23 四判据输出行 ⇒ RED（同解析面，它已认识 B13）。
**判据3（能取假）**：① 修复前样本（`*/20` vs `0,20,40`）从「VIOLATED」翻「PASS」；② 修复前「A23 缺失不可见」样本从「PASS/无判」翻「RED」。真漂移样本仍红。
**判据4**：既有测试全绿；`--for-task` scoped 门绿。

**不覆盖**：不改 A23 判据本身的执行（outer 每轮必跑是 outer 的接线）；不改 registry 结构。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 outer-tick-log-check.sh B13 解析面（:11 五条不等式 + 段行 epoch）+ outer-cron-registry.ts:315-333 cron 比较 + outer-cron-registry.test.mjs:320 cron-expr-mismatch 测试。
2. 判据2（② 优先）：cron 比较加 `*/N` → 分钟集合归一化；更新 cron-expr-mismatch 测试（真漂移仍红，语义等价绿）。
3. 判据1（①）：outer-tick-log-check.sh 加 A23 四判据输出行检查（同轮 B13 段须含 A23 判据行）。
4. 判据3 能取假：两修复样本回放（恒红翻绿 / 缺失翻红）+ 真漂移仍红。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据2（②）：cron `*/N` 归一化比较；`*/20` vs `0,20,40` 不再 VIOLATED；真漂移仍 VIOLATED。
- [ ] AC2 判据1（①）：outer-tick-log-check 报「B13 行无 A23 四判据输出」。
- [ ] AC3 判据3 能取假：两修复样本回放（恒红翻绿 / 缺失翻红）+ 真漂移仍红。
- [ ] AC4 判据4：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] A23 可判（B13 行须带 A23 四判据输出）+ cron 归一化比较（语义等价不漂移、真漂移仍红）+ 测试绿。

## Touches

- plugin/scripts/outer-cron-registry.ts（cron 比较归一化 `*/N` → 分钟集合）
- plugin/test/outer-cron-registry.test.mjs（cron-expr-mismatch 测试对齐：语义等价绿 + 真漂移红）
- plugin/scripts/outer-tick-log-check.sh（A23 四判据输出检查——既有文件加检查，非新建；注解不含嵌套全角括号，避免 touches-parser 的 stripTouchAnnotation 正则剥离失败）
- plugin/test/outer-tick-log-check.test.mjs（A23 检查用例 + 既有 B13 用例补 A23 行对齐）
- plugin/scripts/checker-mutation-cases/outer-tick-log-check.sh（mutation case 对齐 + A23 缺失 mutation）
- tasks/gap-a23-ticklog-verify-and-cron-normalization.md（自身）

## Evidence

（落地后回填——②：`*/20` vs `0,20,40` 恒红（每轮 code=1）；①：A23 连续 5 轮缺席（00:23-01:43）无人可判）
