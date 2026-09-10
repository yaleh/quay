---
id: gap-ac180-scope-empty-so-criterion-passes-vacuously
title: AC-180 判据空过：active AC 数=0 ⇒ 恒真；且翻 active 会自指后自我熄灭
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
goal_ac: AC-180
---
## Proposal

**实测（2026-09-09）**：AC-180「任何 active 的 AC 都必须有可运行判据」的 criterion 今天 **exit 0**，
但这是**空过**——它统计的是「active AC 里 criterion 为空的条数」，而实测

```
active AC 条数 = 0
其中 criterion 为空 = 0
```

⇒ 作用域为空，判据恒真。**它绿是因为没有任何 active AC 可管**，而这恰恰是它要治理的对象消失了。
AC-180 因此是「空作用域与合格同形」这一缺陷类的又一个实例（与 gap-goal-store-empty-scope 同族，
但落点不同：那条在 goal-store 的 I5/I3，这条在 AC-180 自己的 criterion 文本里）。

**次生问题**：即使把 AC-180 翻 active，它会把**自己**纳入作用域（自指），发现自己有判据 ⇒ pass ⇒
被 `goal-driver.ts:633` 翻成 achieved ⇒ 作用域再次变空。**它只能通过停止 active 来变绿。**

## Plan

1. 把 AC-180 的作用域从 `--status active` 改为**全部非 draft/retired/superseded 的 AC**
   （该集合恒非空，实测 58 条）⇒ 空过消失，自指消失。
2. 同时保留「作用域为空」的独立取值（若将来集合真的为空，报未评估而非通过）。
3. 把改写后的判据接成常驻 `plugin/test/*.test.mjs`（与 gap-standing-invariants-not-reevaluated
   同一形态：常设不变式下沉套件，⛔ 不留在只在 goal active 时才跑的层）。
4. AC-180 记录经 ABI 置 retired 或保留并标注职能移交，与上一步保持一致（二选一，在实现中定并记账）。

## Acceptance Criteria

- [x] AC1 改写后的判据在**当前仓库**上作用域 > 0（打印实际条数，⛔ 不接受空作用域下的绿）
- [x] AC2 负控制：造一条无 criterion 的非 draft AC ⇒ 判据必须红
- [x] AC3 负控制反向：移除该条 ⇒ 判据转绿（证明不是恒红）
- [x] AC4 判据在 `scripts/test.sh` 中被发现并执行（位置判定）
- [ ] AC5 `scripts/test.sh` 全量绿（待外部）

## Definition of Done

AC1–AC5 全绿；并在任务 Evidence 里写明改写前后作用域条数的对照（0 → 58 量级），
使「这次修的是空过而不是换了个写法」可被事后核对。

## Evidence

改写前后作用域对照（本任务修的是「空过」而非「换个写法」的可核对证据，实测 2026-09-09）：

- 改写前（`list --status active`）：active AC 条数 = **0**，其中 criterion 为空 = **0** ⇒ 判据恒真（空过）。
- 改写后（非 draft/retired/superseded）：作用域 = **51** 条 achieved AC（另有 12 draft + 2 retired 不在作用域），
  其中 criterion 为空 = **0** ⇒ 非空作用域上的真实绿（0 → 51，同「0 → 58 量级」）。

AC1：`plugin/test/active-ac-must-have-criterion.test.mjs` 的「当前仓库」断言作用域 > 0（51 条）且空 criterion = 0；
改写后的 criterion 真跑 `goal-store gate AC-180` ⇒ exit 0（非空作用域）。
AC2/AC3：纯函数 + 端到端负控制均绿——造一条无 criterion 的非 draft AC ⇒ empty 命中（红）；移除 ⇒ empty 空（绿）。
AC4：`scripts/test.sh --list-files` 命中本测试（568 个选定文件之一）；`scripts/test.sh plugin/test/active-ac-must-have-criterion.test.mjs` 7/7 pass。
AC5：（待外部）——`scripts/test.sh` 全量绿由 worker-driver 的 fan-in 机械跑，本 worker 不跑全量。

AC-180 记录经 goal-store ABI 置 `retired`（commit `dfecdb664`），origin 写明职能移交
`plugin/test/active-ac-must-have-criterion.test.mjs`（常设不变式下沉套件，同 gap-standing-invariants-not-reevaluated）。

## Touches

- goals/AC-180-active-ac.md
- plugin/test/active-ac-must-have-criterion.test.mjs
- tasks/gap-ac180-scope-empty-so-criterion-passes-vacuously.md