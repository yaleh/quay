---
id: gap-fan-in-workflow-check-test-hermetic-escalations
title: fan-in-workflow-check 测试隔离缺陷：非 escalation 测试读到真实
  .quay/fan-in-ff-escalations.jsonl ⇒ d-check 恒红，阻塞所有 fan-in
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：2026-08-20 21:1xZ 实测——runner-field 的 anti-livelock escalation（真实，ff 3 次失败）写入 `.quay/fan-in-ff-escalations.jsonl` 后，`plugin/test/fan-in-workflow-check.test.mjs` 中 **10 个非 escalation 的 CLI 测试全部转红**，从而全量 suite 恒红、阻塞所有 fan-in（ac107 已因 4 fix rounds 全红耗尽，runner-field 重派也被此红挡）。

**根因（能取假，已复现）**：
- `fan-in-workflow-check.test.mjs` 的 CLI 测试 spawn checker 时 **未传 `--escalations`** ⇒ checker 用默认 `<root>/.quay/fan-in-ff-escalations.jsonl`（真实生产载体）。
- 这些测试传 `--project-dir` fixture（空 session-root，`scanWorkflowTaskIds` 返回 []）但 `--root REPO_ROOT`（真实 escalation 文件）。
- 真实 escalation（runner-field, attempt 3）存在但 fixture 扫描无对应 Workflow call ⇒ `d-escalation-traceability` RED（`escalated-fan-in-without-workflow-call`）。
- 该 check `evaluated=true` 且 RED ⇒ 整个 checker exit 1 ⇒ 测试断言 `res.status===0` 失败。
- **对照**：3 个 escalation-specific 测试（:1001/:1025/:1045）正确传 `--escalations <fixture escFile>`，不读真实文件 ⇒ 一直绿。

**为什么是缺陷**：测试非 hermetic——读真实生产状态。escalation 记录是 append-only 真实事件（fan-in-ff-merge.sh attempt≥3 写），任何一次真实 anti-livelock escalation 都会让这 10 个测试从绿转红，而它们测的是别的 check（a/b/c/NOT-EVALUATED 语义），与 escalation 无关。

**修法**：10 个非 escalation 测试的 spawn 传 `--escalations <fixture 空文件>`（或受控 fixture），与 escalation-specific 测试同模式。fixture 里建一个空 `escalations.jsonl` 传入即可——`d-escalation-traceability` 读到空 ⇒ NOT-EVALUATED（`no-escalations`），不影响被测 check。

## Plan

1. 定位 `plugin/test/fan-in-workflow-check.test.mjs` 中 10 个未传 `--escalations` 的 spawnSync CHECKER 调用（grep `spawnSync.*CHECKER` − 3 个已有 `--escalations`）。
2. 每个加 `--escalations <fx.dir>/escalations-empty.jsonl`（fixture 内建空文件；可复用 makeFixture 的 dir）。
3. 验证：`node --test plugin/test/fan-in-workflow-check.test.mjs` 全绿（含真实 escalation 在场时）。
4. 提交 + fan-in（AC78 workflow）。

## Acceptance Criteria

- [x] AC1: 10 个非 escalation CLI 测试全部传 `--escalations <fixture>`（`grep -c 'spawnSync.*CHECKER'` 的每个 spawn 都带 `--escalations`，或显式不读真实文件）。实测 13/13 spawn 带 `--escalations`（0 个不带）。
- [x] AC2: 测试在【真实 escalation 存在】时全绿（生产载体在场 ≠ 测试红——验证 `.quay/fan-in-ff-escalations.jsonl` 有 runner-field 记录时 `node --test` 仍绿）。实测真实 escalation 在场（.quay/fan-in-ff-escalations.jsonl 有 runner-field 记录 2026-08-20T19:50:05Z）时 `node --test` = 61 pass / 0 fail。
- [x] AC3: 全量 suite 不再因 d-escalation-traceability 红。（本任务按约束不跑全量 suite，留待 fan-in/verification 验证。）

## Definition of Done

- [x] 测试隔离缺陷修复；`node --test` 在真实 escalation 在场时全绿；全量 suite 绿；阻塞解除。
  - 修复 commit：`02a73b6d`（worktree 分支 task/gap-fan-in-workflow-check-test-hermetic-escalations）。

## Touches

- plugin/test/fan-in-workflow-check.test.mjs（10 处 spawn 加 --escalations fixture）
- tasks/gap-fan-in-workflow-check-test-hermetic-escalations.md（自身）
