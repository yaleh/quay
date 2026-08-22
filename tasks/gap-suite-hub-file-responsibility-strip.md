---
id: gap-suite-hub-file-responsibility-strip
title: 剥离 full-suite-runner.ts 的 accounting + test.sh 的 overhead 计时/分组逻辑到独立文件——非 harness 职责改动不再强制全量
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：人令「把『剥离 full-suite-runner.ts 的 accounting + test.sh 的 overhead 计时/分组逻辑』整理成一条带 ## Touches 的立案草稿」+ manager 投草稿。

分桶执行上线后（AC120-127），full suite 仍由 4 个 hub 条目决定（`plugin/scripts/suite-bucket-hub-list.ts` HUB_FILES）。其中两个是巨型单体，30 天内吞 252 次提交——`scripts/test.sh`（2149 行/147 次）、`plugin/scripts/full-suite-runner.ts`（4369 行/105 次），每次改动都强制全量 suite（~13 分钟）。但这两文件里并非每块职责都是 harness-critical：**accounting（cgroup/systemd 记账）与 overhead 计时是纯遥测——改变它们永不翻转 pass/fail，却同样触发全量**。剥离这些非 harness 职责到独立非-hub 文件，使它们的变更不再强制全量，从源头减少 full-suite 触发频次。附带：`runner-grouping*` 是 HUB_FILES 里一条当前匹配零文件的死 glob，抽出分组逻辑可使其落地、test.sh 缩水。

**为什么 inner 执行**：改产品代码（scripts/test.sh + full-suite-runner.ts 两个 hub 文件）→ inner 域。

## Plan

1. **抽 accounting**（非 hub）：`full-suite-runner.ts` 的 cgroup/systemd 记账族（`resolveCgroupV2Dir`/`parseCpuStatUsageUsec`/`parsePressureSomeTotal`/`readPhaseCounters`/`parseSystemd*`/`readScopeConsumedLoad`，约 795–1300 行）→ 新文件 `plugin/scripts/suite-accounting.ts`。full-suite-runner.ts 只留 import + 调用。
2. **抽 overhead 计时**（非 hub）：`test.sh` 的 `_oh_mark/_oh_emit/_oh_emit_p/_oh_emit_partial/_oh_install_partial_trap`（1515–1565，~50 行）→ 新文件 `plugin/scripts/overhead-instrument.sh`。
3. **抽分组逻辑**（仍是 hub）：`test.sh` 的 `group_of/check_group_declarations/build_deduped_files/effective_groups/in_group/is_default_set/select_files/list_groups`（1305–1443，~140 行）→ 新文件 `plugin/scripts/runner-grouping.ts`，命中现 HUB_FILES 的死 glob `runner-grouping*`（分组决定「跑哪些测试」，harness-critical，应留在 hub）。
4. **hub 清单核验**：`suite-bucket-hub-list.ts` 确认 `runner-grouping*` 现命中真文件；`suite-accounting.ts`/`overhead-instrument.sh` **不加入** hub 清单。
5. **行为保真**：抽离后全量 suite 仍绿；被移函数的测试同步迁移/更新。

## Acceptance Criteria

- [ ] AC1：accounting 族函数已移出（grep 确认 `resolveCgroupV2Dir` 等仅在 `suite-accounting.ts` 定义），full suite 绿 + 带桶轮次仍写 cpu/psi 字段不变。
- [ ] AC2：`test.sh` 中 `_oh_*` 计时族移出至 `overhead-instrument.sh`，suite 的 `__OVERHEAD__` 输出不变。
- [ ] AC3：分组函数移出至 `runner-grouping.ts`，`runner-grouping*` glob 命中该文件（死 glob 落地），分桶/分组选择行为不变。
- [ ] AC4（可机械取假）：触碰 `suite-accounting.ts` 或 `overhead-instrument.sh` 的变更【不再】触发全量（走桶子集）；触碰 `runner-grouping.ts` 仍触发全量（hub 规则保持）。取假：改一个 accounting 常量 ⇒ 桶路径；改一个 grouping 常量 ⇒ 全量。

## Definition of Done

- [ ] 全量 suite 绿（`scripts/test.sh`）；被移函数无孤儿引用；hub 清单与实测触发行为一致；相关测试同步通过；AC1-4 全勾；land 到 develop。

## Touches

- scripts/test.sh
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/suite-accounting.ts (new)
- plugin/scripts/overhead-instrument.sh (new)
- plugin/scripts/runner-grouping.ts (new)
- plugin/scripts/suite-bucket-hub-list.ts
- plugin/scripts/capability-catalog.sh（新脚本注册：3 条 × 5 表）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照再生成）
- plugin/test/select-tests-for-touches.test.mjs（源断言迁移到 runner-grouping.ts）
- plugin/test/runner-grouping-serial-anti-stomp.test.mjs（源断言迁移到 runner-grouping.ts）
- tasks/gap-suite-hub-file-responsibility-strip.md（自身）
