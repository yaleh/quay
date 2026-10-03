---
id: gap-goal904-merge-drill-record-doc
title: GOAL-904 合并演练：新增托管文档 DOC-904（演练记录），必须经 goal/GOAL-904 分支落地
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-904
---
## Proposal

**这是 GOAL-904（goal 分支合并演练）的承载任务，内容刻意无害。**（正本：`orchestration/SPEC-goal-branch-2026-10-03.md` §4.7、§4.10；GOAL-028 的 AC-321…325/327/328 靠这次演练取真实读数。）

新增一份托管文档 `docs-managed/DOC-904-goal-branch-merge-drill-record.md`：frontmatter `id: DOC-904`、`title: goal 分支合并演练记录`、`status: draft`、`kind: drill`，正文用一小段话写明这是 GOAL-904 的演练产物（演练的目的、它只在 goal/GOAL-904 上、并入 develop 之前预览实例的 /doc 页能列出而生产列不出、并入之后可由人另行清理）。不改任何产品代码、不改测试。

这条任务**必须经 goal 分支落地**：它的 `goal_ac` 指向 AC-904，该 AC 属于 branch-mode 的 GOAL-904，派发时 mergeTarget 解析为 `goal/GOAL-904`。若它落到了 develop，说明派发接线有缺陷，不是演练成功——在 Evidence 里记下实际的 mergeTarget。

## AC

- [x] `node --experimental-strip-types -e 'import("./packages/quay/src/document-store.ts").then((m)=>{const d=m.createDocumentStore("docs-managed").get("DOC-904");if(!d||d.title!=="goal 分支合并演练记录"||d.status!=="draft"){console.error("DOC-904 unreadable or wrong frontmatter");process.exit(1)}console.log("ok",d.id)})'` 退出 0（文档能被托管文档存储读出，且 title 与 status 如上）。
- [x] `bash scripts/test.sh --static-checks-doc` 退出 0（文档类静态检查对这份新文档通过）。
- [x] `git diff --name-only develop...HEAD` 只列出 `docs-managed/DOC-904-goal-branch-merge-drill-record.md` 与 `tasks/gap-goal904-merge-drill-record-doc.md` 两个文件（演练不得夹带别的改动）。

## DoD

真实落地判据：本任务的翻 done 提交经 `goal/GOAL-904` 进入 goal 分支（不在 develop 上），预览实例的 /doc 页因此能列出 DOC-904。生产读数由 GOAL-028 的 AC-321/322/323（任务经 goal 分支落地、追平 develop、落地后不再被派发）在本任务落地后取得，AC-904 在预览实例上通过。

## Evidence

**派发时实际解析的 mergeTarget = `goal/GOAL-904`**（`reason: "goal-branch"`，`goalId: "GOAL-904"`）。读数来自 `plugin/scripts/worker-driver.ts` 导出的单一解析函数，在主检出上求值：`resolveTaskMergeTargetDetail("gap-goal904-merge-drill-record-doc", <main checkout>)` ⇒ `{"mergeTarget":"goal/GOAL-904","goalId":"GOAL-904","reason":"goal-branch"}`——证实本任务经 goal 分支落地，不是 develop，派发接线生效。

AC1：`node --experimental-strip-types -e '...createDocumentStore("docs-managed").get("DOC-904")...'` ⇒ `ok DOC-904`，exit 0。
AC2：`bash scripts/test.sh --static-checks-doc` ⇒ exit 0。
AC3：`git diff --name-only develop...HEAD` 在 merge develop 后只列出 `docs-managed/DOC-904-goal-branch-merge-drill-record.md` 与 `tasks/gap-goal904-merge-drill-record-doc.md` 两个文件。

## Touches

- docs-managed/DOC-904-goal-branch-merge-drill-record.md
- tasks/gap-goal904-merge-drill-record-doc.md
