---
id: gap-precommit-guard-blocks-commits-not-working-tree-edits
title: 守卫威胁模型只覆盖一半——拦提交不拦工作树编辑（污染源是编辑；首条 jsonl 记录同时证明机制会写 + 覆盖缺口）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12，round 84 责任链）**：守卫拦的是【提交】，而污染源是【工作树编辑】。
它在提交时刻开火，那时轮子已经吃到脏树了。时序：
```
23:13:30  提交 46c6309a
23:13:34  round 84 起跑（+4s）
~23:13:4x  编辑落到工作树（manager 以为在绿窗口）
23:13:50  git commit → 守卫正确地拒绝（state=red, finishedAt=null, 早红判据生效）
23:13:59  该轮静态红（那段时间未提交的文本被轮子吃到）
```
**守卫拒绝成功的那一刻，损害已经发生。** `.quay/precommit-guard-rejections.jsonl` 首条真实记录：
`{"at":"2026-08-12T23:13:50.706Z","runId":"d0ece41e-…","startedAt":"23:13:34.218Z","files":["CLAUDE.md"],"verdict":"reject"}`
——**同时是「机制真的会写」的证据，和「它防不住真正的污染路径」的证据。**

**窗口模型修正（manager 撤回 2026-08-12）**：窗口长度不是时间的函数，是【有没有新提交落地】的函数——
round 84 起跑于提交后 4s；rounds 82/83/84 全尾随提交。断言面文件事实上不存在空闲窗口
（「先清 diverge 再动手」只防 IDLE-GREEN，不防 MERGE-LANDING——新提交立即起轮）。

## Plan

1. **轮起跑时对断言面文件取快照**——轮终态比对，检测「轮中被编辑过的断言面文件」⇒ 标 reason=infra-error 或作废。
2. **或断言面文件在 worktree 隔离里跑**——轮子在隔离副本上读断言面，主树编辑不污染。
3. 与守卫（拦提交）互补：守卫防「提交脏轮」，本条防「工作树编辑脏轮」。

## AC

- [ ] AC1: 轮起跑时断言面快照（或 worktree 隔离）——轮中被编辑的断言面文件可检测
- [ ] AC2: 检测到 ⇒ 该轮标 reason=infra-error 或作废（不判绿不判红误导）
- [ ] AC3: 负控——重现 round 84（轮中 uncommitted 编辑断言面）被检测/隔离
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 负控样例贴出（见 Evidence：round 84 形态被检测）
- [ ] 全量套件绿

## Touches

- plugin/scripts/full-suite-runner.ts（快照/隔离）
- plugin/scripts/suite-state-trigger.ts（如需）
- tasks/gap-precommit-guard-blocks-commits-not-working-tree-edits.md（自身）
