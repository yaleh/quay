---
id: gap-tmp-dir-leak-unpaired-mkdtemp-cleanup
title: /tmp 测试临时目录泄漏（mkdtempSync 不成对清理）——1.1GB/3389 目录
status: done
labels:
  - gap
  - defect
  - test
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 只读实测）**：`/tmp` 遗留目录 **3389 个 / 1.1GB**。**修正后的严重度**（manager 复核：`/tmp` 是普通 ext4 磁盘目录，非 tmpfs/内存——`lsblk` vda1 ext4 99.9G，11G 已用 87G 空闲）⇒ **非「占内存/要爆盘」，是「卫生 + 正确性」**：①3389 目录让 /tmp 目录操作变慢 ②掩盖真实状态（排查时翻不动）③**测试之间可能撞名——真正的正确性风险**。优先级低于 port-fix 与 round 绿；机械闸（mkdtemp 不成对即报错）仍值得做——防复发，与当前严重程度无关。源头按位置定位：

| 遗留数 | 前缀 | 来源测试 |
|---|---|---|
| 243 | quay-migrate-* | cli-migrate.test.mjs |
| 182 | frontmatter-store-base-* | frontmatter-store-base.test.mjs / goal-store.test.mjs |
| 162 | cli-entry-test-* | cli-entry.test.mjs（mkdtempSync×1 / rmSync×0，零清理） |
| 135 | quay-backlog-fixture-* | backlog-client.test.mjs |
| 120 | rtv-* | real-target-verify.test.mjs |

**全仓库比例**：`mkdtempSync` 693 处 vs `rmSync` 1302 处 ⇒ 多数测试清理，泄漏集中在少数从不清理的文件。

**选定机制**：①修泄漏文件（补清理）②**加可机械判定的闸**——`mkdtempSync` 与对应清理不成对 ⇒ 报错（修完不复发，否则新测试又漏）。

**验证锚（机制性，不绑磁盘量）**：(a) **闸落地**——新增测试若 `mkdtempSync` 无配对清理则 CI/静态检查失败（机械判据，负控制可抓）；(b) 泄漏文件补清理后不再增长（现有 3389 个遗留目录可清，但不作为 AC 判据）；(c) 既有测试全绿；(d) `--for-task` scoped 门绿。

## Plan

1. 逐个读泄漏文件，补 mkdtemp 配对清理（after()/rmSync/fixture 清理）。
2. 建闸脚本/测试：扫描 mkdtempSync 调用点与清理配对。
3. 实跑验证 + 清理现存 3389 个遗留目录。
4. 回归。

## AC

- [ ] AC1: 5-6 个泄漏文件补清理（cli-migrate/frontmatter-store-base/goal-store/cli-entry/backlog-client/real-target-verify）
- [ ] AC2: mkdtemp 配对闸落地（新建 mkdtemp 不清理 ⇒ 报错，负控制可抓）
- [ ] AC3: 闸为机制性判据（新建 mkdtemp 不清理 ⇒ CI/静态检查失败），不绑磁盘量
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿
- [ ] AC5: 无回归

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后 /tmp 遗留数实测对比贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿——外层 verification-round 验证

## Touches

- packages/quay/test/cli-migrate.test.mjs、frontmatter-store-base.test.mjs、goal-store.test.mjs、cli-entry.test.mjs、backlog-client.test.mjs
- plugin/test/real-target-verify.test.mjs（补清理）
- 闸脚本/测试（新增，mkdtemp 配对检查）
- tasks/gap-tmp-dir-leak-unpaired-mkdtemp-cleanup.md（自身）
