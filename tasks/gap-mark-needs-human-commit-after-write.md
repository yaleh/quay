---
id: gap-mark-needs-human-commit-after-write
title: markNeedsHuman 写盘不提交 git——needs-human 翻转缺 commit-after-write（硬规则 5b 只落到 todo→ready 兄弟）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/driver-filters.ts:171` `markNeedsHuman` 把 `status: todo|ready → needs-human` 写到主检出 `tasks/<id>.md`（`fs.writeFileSync` + 追加 `## Needs-Human` 段），但**零 git 操作**（driver-filters.ts 全文无 git/exec 依赖，仅 `.exec(raw)` 是 frontmatter 正则）。两个调用点 `worker-driver.ts:2085` 与 `promotion-driver.ts:703` 均裸调、丢弃返回的 `{ok,reason}`。

**现况（实证）**：主检出 4 个 task 文件已 `M`（ready→needs-human）未提交 ~9–13h：`gap-abi-status-lifecycle-vocab-scattered-no-named-type` / `gap-fan-in-ff-ref-update-detach-develop` / `gap-fan-in-red-bucket-run-not-recorded` / `gap-verification-round-static-fail-no-record`。盘上翻转已立即改变派发计算（notNeedsHuman 过滤器读盘上 status ⇒ 停重派），但对读 git 的人不可见、无守卫拦，一次 checkout 即静默回退（硬规则 11b）。

**根因**：硬规则 5b 经典形态——commit-after-write 纪律只落到 todo→ready 兄弟翻转（`gap-apply-promotions-commit-status-writes`：`setTaskStatus` + `commitTaskStatus` ready-pool-check.ts:2349，含 pathspec 限定 commit + `propagateDocBranchToDevelop`），**未 port 到同族的 needs-human 翻转**。仓库现有三份发散提交实现，markNeedsHuman 是唯一主检出翻转且无提交的那份。

**同族**：与 manager 已立 D5（写盘状态与 git 记录不同步）同族；与 `uncommitted-promotion-blocks-fan-in-clean-tree`（3× 实证脏树挡 fan-in）同根因第二次出现。脏树同样会挡 fan-in-ff-merge.sh。

## Plan

1. 提交点放 `markNeedsHuman` 内部（或紧邻 `markNeedsHumanAndCommit`），⛔ 非调用点——否则重回「调用点必须记得」的失败形态。
2. 复用主检出路径 `commitTaskStatus` + `isInsideGitWorkTree` + `propagateDocBranchToDevelop`，不写第四份：pathspec 限定 `-- <rel>`（禁裸 commit 扫共享索引）、`--no-verify`（机械翻转内容中立）、repo-less 单测临时目录 no-op。
3. 必跑 `propagateDocBranchToDevelop`：主检出在 main/manager-doc，翻转不 ff 到 develop ⇒ task worktree 仍读旧 status。
4. 落 `committed` 到 outcome/round 记录（同 applyPromotions 的 committed），调用点不再丢弃 `{ok,reason}`。
5. 顺带收敛三份 helper（commitTaskStatus / commitTaskStatusChange / 新 needs-human）为一个 `commitTaskFile(root, rel, message)`。

## Acceptance Criteria

- [x] AC1（能取假，写盘即提交）：markNeedsHuman 翻转 needs-human 后，`tasks/<id>.md` 已 commit（⛔ 翻转后 git status 仍 M ⇒ 假）。
- [x] AC2（能取假，pathspec 限定）：commit 用 `-- <rel>` 单文件，不扫共享索引（⛔ 裸 commit ⇒ 假）。
- [x] AC3（能取假，ff 到 develop）：翻转 commit 后 `propagateDocBranchToDevelop` 执行，develop 读到新 status（⛔ 只提交 doc 分支不 ff ⇒ 假）。
- [x] AC4（不误伤）：repo-less 单测临时目录 no-op，不抛错。

## Definition of Done

markNeedsHuman 写盘即提交（复用 commitTaskStatus 族）；AC1-AC4 全勾；needs-human 翻转不再留脏树。

## Touches

- plugin/scripts/driver-filters.ts（markNeedsHuman 加 commit-after-write / markNeedsHumanAndCommit + commitTaskFile 族上收）
- plugin/scripts/ready-pool-check.ts（commitTaskStatus 收敛为 driver-filters 的 commitTaskFile + propagateDocBranchToDevelop，删本地重复）
- plugin/scripts/worker-driver.ts（调用点传 committed / 不丢 {ok,reason}）
- plugin/scripts/promotion-driver.ts（同上）
- plugin/test/driver-filters.test.mjs（needs-human commit-after-write + repo-less no-op）
- tasks/gap-mark-needs-human-commit-after-write.md（自身）
