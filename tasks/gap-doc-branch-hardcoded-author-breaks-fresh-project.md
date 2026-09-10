---
id: gap-doc-branch-hardcoded-author-breaks-fresh-project
title: doc→develop 同步硬编码 DOC_BRANCH="author"，fresh 项目工作分支是 main ⇒ 双向同步
  no-op、promotion 翻转到不了 develop、worker 永不派发
status: needs-human
needs_human_cause: human-adjudication
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal

doc→develop 同步（`syncDocDevelopBidirectional` / `syncDevelopToDoc`，`plugin/scripts/driver-filters.ts`）硬编码 `DOC_BRANCH = "author"`（:438），而 fresh quay-init 项目的 doc 工作分支是 git 默认 `main`（`verify-deliver-coldstart.sh` step2_init 的 `git init -b main`；quay-init 不创建 author 分支）。`author` 只存在于本仓库（`gap-branch-rename-manager-doc-to-author` 把 main/manager-doc 改名而来）。第三方项目无 author 分支 ⇒ 双向同步永久 no-op，promotion 翻转提交只落 main、到不了 develop（权威基线）⇒ worker-driver 读 develop 恒 pool=0 永不派发 ⇒ AC-207 e2e 端到端被卡死（第 4 个阻塞，同族于前三个 shipped 代码假设主仓库结构的缺陷）。

`propagateDocBranchToDevelop` 已经动态取当前分支（`currentBranchName`），只有 `syncDevelopToDoc`/`syncDocDevelopBidirectional` 硬编码。`gap-branch-rename-manager-doc-to-author` 立案时「机制层零代码硬编码分支名」的断言，被后加的 `DOC_BRANCH` 常量回退。

## Plan

1. `syncDocDevelopBidirectional`（:557）与 `syncDevelopToDoc`（:475）的 doc 分支改从 `currentBranchName(root)` 动态取（与 `propagateDocBranchToDevelop` 已有的动态取法一致），删除/降级 `DOC_BRANCH = "author"` 硬编码（生产读动态分支；常量仅作测试或主仓库缺省）。
2. `docBranchForkedFromDevelop` 的默认参数同改（docBranch 缺省 = 当前分支）。
3. 负控制：fresh 项目（`git init -b main`，无 author 分支）里 `syncDocDevelopBidirectional` 不再 return "no-refs"；promotion 翻转提交后 `git show develop:tasks/<id>.md` 可见新 status。

## Acceptance Criteria

- [ ] AC1 位置判定：`grep -n 'DOC_BRANCH' plugin/scripts/driver-filters.ts` 不再出现在 syncDocDevelopBidirectional/syncDevelopToDoc/docBranchForkedFromDevelop 的 doc 分支取值路径（或该常量只用于测试/缺省；贴命中前 3 条，硬规则②）。
- [ ] AC2 负控制（能取假）：fresh 项目（无 author 分支、工作分支 main）里 syncDocDevelopBidirectional 返回非 "no-refs"，promotion 翻转提交后 `git show develop:tasks/<id>.md` 可见新 status（贴命中行）。
- [ ] AC3 全量 suite 绿（含 plugin/test/driver-filters.test.mjs）。

## Definition of Done

AC1–AC3 全绿；`scripts/test.sh` 全量绿。fresh/第三方项目 doc→develop 同步恢复（promotion 翻转到达 develop），AC-207 e2e 不再被此缺陷卡死。

## Touches

- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs
- tasks/gap-doc-branch-hardcoded-author-breaks-fresh-project.md
## Needs-Human

**执行 2026-09-10T01:44:33.136Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
- 成因类：human-adjudication
