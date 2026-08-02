---
id: gap-reverse-drift-check-buries-true-positives-in-noise
title: "reverse-drift check flags fast-mode tasks as suspects — the noise will
  bury the one real case it found"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`task-status-drift-check.ts` 的 `reverse-drift-suspect`（`status: done` 但代码从未落地）在
2026-08-02 外层 tick 中报了 5 个：`DIR-075`、`DIR-087`、`DIR-124-A2`、`DIR-124-A5`、`DIR-124-B1`。

逐个查证后，**这 5 个里至少 1 个真、至少 1 个假**：

| 任务 | 判定 | 证据 |
|---|---|---|
| `DIR-124-A2` | **真阳性** | `status: done` 但 AC **全部未勾**；全仓 `find -iname '*replay*'` 无任何 `*workflow*replay*` fixture/script/test。`golden-replay-dir044.ts` 是 DIR-044 的产物，不是它 |
| `DIR-124-B1` | **假阳性** | 代码**确实落地了**：`experiments/quay-perpetual-stream/scripts/*run-identity*`、`plugin/scripts/*run-identity*`、两侧 test、`docs/plans/M253-dir-124-b1.md` 全部存在。缺的只有 `milestones/M253/{preparation,proposal-ledger,stage-journal}.json`、`receipts/*.json` —— **这些是 prepare/execute-milestone 流水线的簿记产物，快速模式根本不产生** |

### 两个具体成因

**1. `touchesAllExist` 用 `.every()`**（`plugin/scripts/task-status-drift-check.ts:126`）。
只要 Touches 里有一条不存在，整条信号就翻成 false。而任务的 Touches 普遍**同时列了实现文件和
milestone 簿记文件**——快速模式下后者永远不存在。随着快速模式成为默认，**每一个快速模式任务都会
变成假阳性**。

**2. 实现的判据与它自己的注释不符。** 行 151-153 的注释写着反向漂移要求
「the task DECLARES distinctive AC symbols and **NONE** of them resolve in code」，但 `DIR-124-B1`
是以 `1/4 symbols resolved` 被报出来的——1 ≠ 0。要么注释错，要么实现错，两者必须对齐。

### 为什么这件事值得单独修

本仓库已经反复出现同一个模式（`orchestration/orchestrator-loop-tick.md` 步骤 6 列举过四次）：
**造了一个检测器 → 它正确地报警了 → 报警没人处理**。一个混着假阳性的检测器会更快走到这一步——
`DIR-124-A2` 这个真阳性此刻正埋在 4 条噪声里。修准确率不是锦上添花，是让这个检测器还能被相信。

**不做**：不改任何被报任务的 `status`。`DIR-124-A2` 该重建还是该降范围是范围决定，已升级给人
（`orchestration/escalations.md`），不在本任务内决定。

## Chosen mechanism

**把「实现落地」与「流水线簿记落地」分成两个独立信号，只用前者判反向漂移。**

1. **Touches 分类**：判定实现是否落地时，只看**代码根**下的条目（`packages/`、`plugin/scripts/`、
   `plugin/test/`、`experiments/**/scripts/`、`experiments/**/test/`、`scripts/`）。
   `milestones/**`、`docs/plans/**`、`.quay/**` 是流水线簿记，**不参与反向漂移判定**——它们的缺席
   只说明这个任务走的是快速模式，不说明代码没落地。
2. **`.every()` → 代码根条目上的 `.some()`**：一个 `done` 任务只要有**任一**代码根 Touches 条目
   存在，就不算「代码从未落地」。反向漂移要抓的是**零落地**，不是「落地得不完整」。
3. **对齐判据与注释**：确定 AC 符号解析的阈值到底是 `0` 还是某个比例，改代码或改注释使两者一致，
   并在测试里 pin 住这个阈值。

**保持 fail-closed 的地方不变**：没有 `## Touches` 段落、或段落解析出零条目的任务，仍然按
「证明不了任何事」处理。放宽的只是「有 Touches 但其中簿记文件缺失」这一种情况。

## Acceptance Criteria

- [ ] AC1: `DIR-124-B1` 不再被报为 `reverse-drift-suspect`（真实仓库上实跑，不是 fixture）
- [ ] AC2: `DIR-124-A2` **仍然**被报为 `reverse-drift-suspect` —— 放宽不得放过真阳性
- [ ] AC3: 代码根 / 簿记根的划分写成一个具名常量或函数，不散在判定逻辑里
- [ ] AC4: 反向漂移判定改为「代码根条目全不存在」而非「全部 Touches 条目全存在的否定」
- [ ] AC5: AC 符号解析阈值与其注释一致；测试 pin 住该阈值（给一个 1/4 解析的 fixture，断言判定结果）
- [ ] AC6: 无 `## Touches` 段 / 零条目仍判为 not-all-exist（fail-closed 未被放宽）—— 回归测试
- [ ] AC7: 改前/改后在真实仓库上的 suspect 列表都记进任务体，逐个标注真/假阳性及理由
- [ ] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] 改前 5 个 suspect、改后 N 个 suspect 都列在任务体，每个有真/假阳性判定与证据
- [ ] `scripts/test.sh` 绿
- [ ] 若改后仍有未判定的 suspect，逐个写明为什么无法判定 —— 不允许「剩下的默认是假阳性」

## Touches

- plugin/scripts/task-status-drift-check.ts
- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts
- plugin/test/task-status-drift-check.test.mjs
