---
id: gap-quay-init-loop-tick-doc-paths-reference-unlanded-plugin-loop
title: quay-init --loop 铺下的 tick 文档引用 plugin/loop/* 路径但该目录未铺下（docs/analysis/fast-mode-loop-tick.md 引 5 处全指向不存在路径）——AC37「referenced⊆landed 门自动生效」实测未拦住（ad-arm1 archguard 实测 F3）
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实测（manager 2026-08-11 15:2x，ad-arm1 真实消费方 archguard，ssh 实测非猜测）——F3**：

`plugin/loop/` **整个目录没铺下来**。而铺下的 tick 文档 `docs/analysis/fast-mode-loop-tick.md` 里引用 `plugin/loop/orchestrator-loop-tick.md`（2 次）/`plugin/loop/orchestrator-tick-core.md`/`plugin/loop/fast-mode-loop-tick.md`/`orchestration/fast-mode-tick-core.md`（2 次）等 **全部指向不存在的路径**——inner 自己报了「The tick references an execution core that isn't at the expected path」。

**AC37 判据说「referenced ⊆ landed 门自动生效」，实测该门没拦住**。⚠️ manager 15:2x 曾把 AC37 判为「达成」，依据是「三份 tick-core 在 plugin/loop/ 下」——**那是在 quay 自己仓库里查的**。phase-goal 原文早就写着「在亲代环境里验交付完整性，会得到一个结构上不可能为假的绿」，manager 犯的正是这条，已自我更正。

**实证核对（outer）**：`plugin/loop/` 模板源存在（6 个 .md），`orchestration/` 源存在；但 `quay-init.sh:929` 注释明确 c3 exec-core 文档落点 = `orchestration/`（非 `plugin/loop/`）——消费方 tick 文档引用 `plugin/loop/...` 路径与真实落点不匹配。`verify_referenced_landed`（:1011）检查的是 `$PLUGIN_ROOT/skills/*/SKILL.md` + `$PLUGIN_ROOT/loop/*.md` 的引用，但**没验证消费方铺下文档（docs/analysis/）的路径引用与真实落点一致**——盲区确认。

### 验证锚

修后 (a) 铺下的消费方 tick 文档引用的每个路径在目标 workspace 真实存在（`referenced ⊆ landed` 对消费方铺下文档同样成立）；(b) `derive_loop_scripts` 派生集 + `verify_referenced_landed` 覆盖消费方 docs/analysis/ 引用的路径映射（plugin/loop/ → orchestration/ 或真实落点）；(c) 消费方 inner 冷启动不再报「tick references an execution core that isn't at the expected path」；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 ad-arm1 archguard 实测（docs/analysis/fast-mode-loop-tick.md 引 5 处全不存在 + inner 自报）+ AC37 判据盲区（消费方铺下文档的引用 vs 真实落点未验证）
- [ ] AC2: **门覆盖消费方文档**——verify_referenced_landed / 等价门验证消费方铺下文档（docs/analysis/）的路径引用 ⊆ 真实落点集
- [ ] AC3: **路径映射修正**——消费方 tick 文档引用与真实落点一致（plugin/loop/ 铺下 或 引用改 orchestration/）
- [ ] AC4: **消费方复测**——ad-arm1 冷启动 inner 不再报「tick references an execution core that isn't at the expected path」
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：ad-arm1 冷启动 inner 无路径错误证据
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/quay-init.sh（derive_loop_scripts / verify_referenced_landed 覆盖消费方 docs/analysis/ 引用）
- plugin/loop/*.md（若消费方文档路径映射需改）
- packages/quay/src/init.ts（若铺下文档生成逻辑需改）
- tasks/gap-quay-init-loop-tick-doc-paths-reference-unlanded-plugin-loop.md（自身：勾 AC + 贴证据）

## Contract

measure   consumer_refs_landed = `grep -ohE '(plugin/loop|orchestration|docs/analysis)/[a-zA-Z0-9._-]+' <冷启动铺下 docs/analysis/*.md> | sort -u | while read p; do [ -e "<目标根>/$p" ] || echo "MISSING $p"; done | wc -l` stdout 数字
band      consumer_refs_landed = 0（消费方 tick 文档引用全部落点存在）
invariant ac37_gate_covers_consumer_docs = 1（referenced⊆landed 对消费方铺下文档生效）
invoke    `quay-init --loop` 到临时目标后跑该 grep（贴 MISSING 计数）
control   消费方引用全落点；AC37 判据修正；既有不回归
resume    门覆盖消费方文档 / 路径映射 / 复测分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: ad-arm1 archguard 真实消费方 Level3 首跑实测 F3——plugin/loop/ 目录未铺下但消费方 tick 文档引用其路径（5 处全不存在），AC37「referenced⊆landed 门自动生效」实测未拦住；manager 自我更正（在 quay 仓库查而非亲代环境）。实现归 inner，判定归 outer
