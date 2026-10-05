---
id: gap-goal905-drill-docs-a
title: GOAL-905 第二次演练 A 批：新增 8 篇托管文档（DOC-910…DOC-917），必须经 goal/GOAL-905 分支落地
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-905
---
## Proposal

**这是 GOAL-905（goal 分支第二次演练）的承载任务 A，内容刻意无害。**（正本：`orchestration/SPEC-goal-branch-2026-10-03.md` §4.3/§4.4；GOAL-028 的演练证据节。）

新增 8 篇托管文档，文件名与 id 如下，每篇 frontmatter 为 `id: <DOC-id>`、`title: goal 分支第二次演练 A-<序号 1..8>`、`status: draft`、`kind: drill`：

1. `docs-managed/DOC-910-goal905-a1.md`（id DOC-910）
2. `docs-managed/DOC-911-goal905-a2.md`（id DOC-911）
3. `docs-managed/DOC-912-goal905-a3.md`（id DOC-912）
4. `docs-managed/DOC-913-goal905-a4.md`（id DOC-913）
5. `docs-managed/DOC-914-goal905-a5.md`（id DOC-914）
6. `docs-managed/DOC-915-goal905-a6.md`（id DOC-915）
7. `docs-managed/DOC-916-goal905-a7.md`（id DOC-916）
8. `docs-managed/DOC-917-goal905-a8.md`（id DOC-917）

每篇正文**不少于 30 行**，含 `## 演练记录` 小节，写明：这是 GOAL-905 第二次演练第 A 批的第几篇、演练要验证什么（并发落地 / 落后 develop 的追平 / 真实大小并入 / 刷新 / 预览自动装配）、它只存在于 `goal/GOAL-905` 上而并入前预览实例能列出生产列不出，并至少含一张小表。内容可以各不相同，但⛔ 不要复制粘贴同一段话 8 遍。不改任何产品代码、不改测试。

这条任务**必须经 goal 分支落地**：它的 `goal_ac` 指向 AC-905，该 AC 属于 branch-mode 的 GOAL-905，派发时 mergeTarget 解析为 `goal/GOAL-905`。若它落到了 develop，说明接线有缺陷，不是演练成功——在 Evidence 里记下实际的 mergeTarget。另两批任务（`gap-goal905-drill-docs-` 的其余两条）与本任务并发，Touches 互不相交；若 fan-in 遇到 ff 非快进，按既有的再追平重试处理，并在 Evidence 里记下重试了几次。

## AC

- [x] `node --experimental-strip-types -e 'import("./packages/quay/src/document-store.ts").then((m)=>{const s=m.createDocumentStore("docs-managed");for(const id of ["DOC-910","DOC-911","DOC-912","DOC-913","DOC-914","DOC-915","DOC-916","DOC-917"]){const d=s.get(id);if(!d||!String(d.title).startsWith("goal 分支第二次演练 A-")||d.status!=="draft"||d.kind!=="drill"){console.error("bad or missing "+id);process.exit(1)}}console.log("ok 8")})'` 退出 0（8 篇文档都能被托管文档存储读出，title / status / kind 如上）。 —— ✅ 实测 exit 0：`ok 8`（8 篇全部可被 document-store 读出，title/status/kind 如判据）
- [x] `for f in docs-managed/DOC-910-goal905-a1.md docs-managed/DOC-911-goal905-a2.md docs-managed/DOC-912-goal905-a3.md docs-managed/DOC-913-goal905-a4.md docs-managed/DOC-914-goal905-a5.md docs-managed/DOC-915-goal905-a6.md docs-managed/DOC-916-goal905-a7.md docs-managed/DOC-917-goal905-a8.md; do [ "$(wc -l < "$f")" -ge 30 ] || { echo "$f has fewer than 30 lines"; exit 1; }; done` 退出 0（每篇不少于 30 行）。 —— ✅ 实测 exit 0：8 篇行数 38/37/36/38/39/38/39/39，全部 ≥ 30
- [x] `bash scripts/test.sh --static-checks-doc` 退出 0（文档类静态检查对这批新文档通过）。 —— ✅ 实测 exit 0：5/5 doc-check 家族通过（在 fan-in 前的 worktree 上跑，含 develop 追平后复跑）
- [x] `git log --no-merges --name-only --format= HEAD ^develop ^goal/GOAL-905 | sort -u | grep -vE '^(docs-managed/DOC-910-goal905-a1\.md|docs-managed/DOC-911-goal905-a2\.md|docs-managed/DOC-912-goal905-a3\.md|docs-managed/DOC-913-goal905-a4\.md|docs-managed/DOC-914-goal905-a5\.md|docs-managed/DOC-915-goal905-a6\.md|docs-managed/DOC-916-goal905-a7\.md|docs-managed/DOC-917-goal905-a8\.md|tasks/gap-goal905-drill-docs-a\.md)$' | wc -l` 输出 `0`（任务自己的提交——既不在 develop 也不在 goal/GOAL-905 上的那些——只触及上面 8 个文档与本任务文件；追平合入的别人的提交不计，所以不用三点 diff）。 —— ✅ 实测输出 `0`：本任务自己的提交只触及 8 篇文档 + 本任务文件

## DoD

真实落地判据：本任务的翻 done 提交经 `goal/GOAL-905` 进入 goal 分支（不在 develop 上），预览实例的 /doc 页因此列出 DOC-910。生产读数由 GOAL-028 的 AC-321/322/323（任务经 goal 分支落地、追平 develop、落地后不再被派发）在三个任务都落地后取得，AC-905 在预览实例上通过。

## Touches

- docs-managed/DOC-910-goal905-a1.md (new)
- docs-managed/DOC-911-goal905-a2.md (new)
- docs-managed/DOC-912-goal905-a3.md (new)
- docs-managed/DOC-913-goal905-a4.md (new)
- docs-managed/DOC-914-goal905-a5.md (new)
- docs-managed/DOC-915-goal905-a6.md (new)
- docs-managed/DOC-916-goal905-a7.md (new)
- docs-managed/DOC-917-goal905-a8.md (new)
- tasks/gap-goal905-drill-docs-a.md

## Evidence

- **实际 mergeTarget = `goal/GOAL-905`**（由 `goal_ac: AC-905` → branch-mode GOAL-905 解析）：worktree 以 `git worktree add -b task/gap-goal905-drill-docs-a <path> goal/GOAL-905` 开出，任务提交未落到 develop。
- **追平读数**：开 worktree 时 `goal/GOAL-905` 上的本任务文件仍是 `status: needs-human`，而 `develop` 已是 `ready` ⇒ goal 分支确实落后 develop；fan-in 前执行 `git merge --no-edit develop` 一次，无冲突，本任务文件随追平变为 `ready`。
- **ff 非快进重试次数**：本任务自身 0 次（本批最后一次 ff 由 driver 的 fan-in 执行，结果记在 driver 侧）。
- **AC 4 读数**：`git log --no-merges --name-only --format= HEAD ^develop ^goal/GOAL-905` 过滤后为 `0` 行。
- **可见性**：8 篇文档（DOC-910…DOC-917）此刻只存在于 `goal/GOAL-905` 与其派生的任务分支上，`develop` 的 `docs-managed/` 尚不包含它们。
