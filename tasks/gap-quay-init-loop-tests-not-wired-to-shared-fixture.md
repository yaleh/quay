---
id: gap-quay-init-loop-tests-not-wired-to-shared-fixture
title: quay-init-loop-core/runtime 两个相的地板未接共享 prebuilt fixture（机制在消费者无，今晚第 6 同族；接上则 serial/lowconc 地板同降，方案 A/B 天花板打开）——等人裁定
status: ready
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

**降为记录量（人 2026-08-13 裁定「可以放松。suite 耗时的改进我已认可」，覆盖 manager 上一条建议）。**历史说明**：曾要求差值可判（先例 gap-suite-concurrency-4-vs-8-measurement：20–63s 噪声带内 34s 判不可判定；叠加全局轮争抢分辨力更低）——当时为拿可判结论有「排静默窗口 / 明写不可判定」二选一；人认可改进后不再需要可判结论，降为记录量**：贴读数即可，**不要求差值可判**；**不得因「差值落在噪声带内」而判任务不成立**（改进已被人认可，不需测量证明）；**不为此追加轮次**（「各 ≥5 轮」采样量可放宽）。**不删测量**——读数仍贴，只是不再决定任务成败（删掉会让后来的人以为从未测过；降为记录量留下「测过、当时不可判」的痕迹）。**后果（记一次）**：相级耗时回归（某一相变慢）不再有判据能抓到——全轮墙钟仍逐轮记在 verification-round.jsonl，粗粒度回归还看得见，丢的是「哪一相变慢」的归因；人已认可当前改进，这是接受的代价，不需要补偿机制。- [ ] AC3: 测试结果不变（无回归）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 前后相耗时对照样例贴出（shared-fixture 接线前后，同窗基线）
- [ ] 全量套件绿（per-task 验证模式）
- [ ] shared-fixture 接线后 quay-init-loop 族测试无回归（连接真实 fixture 而非重复构造）

## Touches

- plugin/test/quay-init-loop-core.test.mjs
- plugin/test/quay-init-loop-runtime.test.mjs
- plugin/test/quay-init-loop-helpers.mjs（既有 fixture）
- tasks/gap-quay-init-loop-tests-not-wired-to-shared-fixture.md（自身）
