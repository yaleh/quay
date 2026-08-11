---
id: gap-quay-init-launch-settings-template-missing-permissions-and-exclude-dynamic
title: quay-init 铺下的 launch.settings.json 缺 permissions.defaultMode=bypassPermissions 整块 + excludeDynamicSystemPromptSections 缺（true）——消费方 inner 冷启动在自家 loop 脚本上撞 permission prompt（ad-arm1 archguard 实测 F1/F2）
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

**实测（manager 2026-08-11 15:2x，ad-arm1 真实消费方 archguard，ssh 实测非猜测）——AC16③ Level3 第一次真的在跑**：

**F1（此刻正在阻塞 inner，根因级）**：`quay-init` 铺下的 `.claude/launch.settings.json` **缺 `permissions.defaultMode: bypassPermissions` 整块**（quay 本机那份有）。⇒ inner 即使带 `--settings` 也会在**自己的 loop 脚本**上撞 permission prompt（实测卡在 `monitor-mount-check.sh` 的批准框）。铺设模板不完整，每次冷启动必复现。

**F2**：同一文件 `excludeDynamicSystemPromptSections: false`（quay 本机是 true）⇒ outer/inner 行为不一致。

**实证核对（outer）**：quay 本机 `.claude/launch.settings.json` 有 `permissions.defaultMode: bypassPermissions`（L3-4）+ `excludeDynamicSystemPromptSections`（1 处）；`packages/quay/src/init.ts` 模板 **0 处**（permissions 只在注释里提及）——模板缺陷确认。

### 验证锚

修后 (a) `quay init` 铺出的 `.claude/launch.settings.json` 含 `permissions.defaultMode: bypassPermissions` + `excludeDynamicSystemPromptSections: true`，与本机一致；(b) 消费方冷启动 inner 不再在自家 loop 脚本上撞 permission prompt（ad-arm1 复测）；(c) `--for-task` scoped 门绿；(d) 不回归。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 ad-arm1 archguard 实测（monitor-mount-check.sh 批准框卡死）+ init.ts 模板缺 permissions/excludeDynamic 的 grep 证据
- [ ] AC2: **修复模板**——init.ts 铺出与 quay 本机一致的 launch.settings.json（含 bypassPermissions 块 + excludeDynamicSystemPromptSections: true）
- [ ] AC3: **消费方复测**——ad-arm1 冷启动 inner 不再撞 permission prompt
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：ad-arm1 冷启动 inner 无 permission prompt 证据
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/src/init.ts（launch.settings.json 模板补 permissions + excludeDynamic）
- packages/quay/test/init.test.mjs（新增 launch.settings.json 模板断言）
- tasks/gap-quay-init-launch-settings-template-missing-permissions-and-exclude-dynamic.md（自身：勾 AC + 贴证据）

## Contract

measure   laid_permissions_block = `grep -c 'bypassPermissions' <冷启动铺出的 launch.settings.json>` stdout 数字
band      laid_permissions_block = 1（铺出含 bypassPermissions）
invariant consumer_inner_no_prompt = 1（ad-arm1 冷启动 inner 不撞 permission prompt）
invoke    `bash packages/quay/scripts/package.sh` 后冷启动铺出 + grep 验证（贴证据）
control   模板与本机一致；消费方复测无 prompt；既有不回归
resume    init.ts 模板修复 / 消费方复测 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: ad-arm1 archguard 真实消费方 Level3 首跑实测 F1/F2——init.ts 铺下 launch.settings.json 缺 permissions.defaultMode=bypassPermissions 整块 + excludeDynamicSystemPromptSections（本机有、模板无）⇒ 消费方 inner 冷启动撞 permission prompt。实现归 inner，判定归 outer
