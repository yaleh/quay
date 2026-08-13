---
id: gap-quay-init-loop-tests-not-wired-to-shared-fixture
title: quay-init-loop-core/runtime 两个相的地板未接共享 prebuilt fixture（机制在消费者无，今晚第 6 同族；接上则 serial/lowconc 地板同降，方案 A/B 天花板打开）——等人裁定
status: todo
labels:
  - gap
  - exploration
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实测（manager 2026-08-13）**：真跑 npm install/ci 的测试文件 6 个、合计 340s（占全部文件耗时 5.0%）：
```
quay-init-loop-core.test.mjs     168.1s  @test-group serial   ← serial 相的地板
quay-init-loop-runtime.test.mjs  127.5s  @test-group lowconc  ← lowconc 相的地板
npm-pack-e2e 20.6s / sea-artifact-consumer-e2e 17.3s / manager-install-vector 5.7s / sync-vendor 0.8s
```
**5% 文件耗时看着不多，但这两个文件【就是两个相的地板】**——方案 A/B 的收益上限都被它们卡死
（serial 地板 128s / lowconc 90s 正是它们）。

**关键（第 6 次同族：机制在、消费者无）**：`gap-serial-install-family-shared-prebuilt-fixture`（status=done）
已造「ONE real install per SERIAL PHASE，全族共享，内容寻址，跨 run 可复用」的 fixture
（`quay-init-loop-helpers.mjs:103-125`）。**但这两个文件对 `laydownTemplate|sharedFixture|prebuilt` 命中数 = 0**，
它们自己的注释写「one real quay-init --loop per FILE process」。
⇒ **per-test → per-file 优化做了；per-file → per-phase 共享 fixture 这一步没接**。

**⚠️ 等人裁定**：人 2026-08-13 08:5x 说吞吐只探索方案 A；这条是新信息（若接上，serial/lowconc 地板同时降，
方案 A/B 的天花板才打开），**需人重新裁定**。**先不派。**

## Plan

1. 把 `quay-init-loop-core.test.mjs` + `quay-init-loop-runtime.test.mjs` 接到既有共享 fixture
   （quay-init-loop-helpers.mjs:103-125 的内容寻址 prebuilt）。
2. 两个相的地板同时下降 → 方案 A/B 天花板打开。

## AC

- [ ] AC1: 两文件（core/runtime）接到共享 prebuilt fixture（命中 sharedFixture/laydownTemplate）
- [ ] AC2: serial/lowconc 相地板下降（对照前后相耗时，basename 归一）
- [ ] AC3: 测试结果不变（无回归）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 前后相耗时对照样例贴出
- [ ] 全量套件绿

## Touches

- plugin/test/quay-init-loop-core.test.mjs
- plugin/test/quay-init-loop-runtime.test.mjs
- plugin/test/quay-init-loop-helpers.mjs（既有 fixture）
- tasks/gap-quay-init-loop-tests-not-wired-to-shared-fixture.md（自身）
