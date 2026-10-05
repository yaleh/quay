---
id: gap-goal905-drill-docs-b
title: GOAL-905 第二次演练 B 批：新增 8 篇托管文档（DOC-920…DOC-927），必须经 goal/GOAL-905 分支落地
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-906
---
## Proposal

**这是 GOAL-905（goal 分支第二次演练）的承载任务 B，内容刻意无害。**（正本：`orchestration/SPEC-goal-branch-2026-10-03.md` §4.3/§4.4；GOAL-028 的演练证据节。）

新增 8 篇托管文档，文件名与 id 如下，每篇 frontmatter 为 `id: <DOC-id>`、`title: goal 分支第二次演练 B-<序号 1..8>`、`status: draft`、`kind: drill`：

1. `docs-managed/DOC-920-goal905-b1.md`（id DOC-920）
2. `docs-managed/DOC-921-goal905-b2.md`（id DOC-921）
3. `docs-managed/DOC-922-goal905-b3.md`（id DOC-922）
4. `docs-managed/DOC-923-goal905-b4.md`（id DOC-923）
5. `docs-managed/DOC-924-goal905-b5.md`（id DOC-924）
6. `docs-managed/DOC-925-goal905-b6.md`（id DOC-925）
7. `docs-managed/DOC-926-goal905-b7.md`（id DOC-926）
8. `docs-managed/DOC-927-goal905-b8.md`（id DOC-927）

每篇正文**不少于 30 行**，含 `## 演练记录` 小节，写明：这是 GOAL-905 第二次演练第 B 批的第几篇、演练要验证什么（并发落地 / 落后 develop 的追平 / 真实大小并入 / 刷新 / 预览自动装配）、它只存在于 `goal/GOAL-905` 上而并入前预览实例能列出生产列不出，并至少含一张小表。内容可以各不相同，但⛔ 不要复制粘贴同一段话 8 遍。不改任何产品代码、不改测试。

这条任务**必须经 goal 分支落地**：它的 `goal_ac` 指向 AC-906，该 AC 属于 branch-mode 的 GOAL-905，派发时 mergeTarget 解析为 `goal/GOAL-905`。若它落到了 develop，说明接线有缺陷，不是演练成功——在 Evidence 里记下实际的 mergeTarget。另两批任务（`gap-goal905-drill-docs-` 的其余两条）与本任务并发，Touches 互不相交；若 fan-in 遇到 ff 非快进，按既有的再追平重试处理，并在 Evidence 里记下重试了几次。

## AC

- [ ] `node --experimental-strip-types -e 'import("./packages/quay/src/document-store.ts").then((m)=>{const s=m.createDocumentStore("docs-managed");for(const id of ["DOC-920","DOC-921","DOC-922","DOC-923","DOC-924","DOC-925","DOC-926","DOC-927"]){const d=s.get(id);if(!d||!String(d.title).startsWith("goal 分支第二次演练 B-")||d.status!=="draft"||d.kind!=="drill"){console.error("bad or missing "+id);process.exit(1)}}console.log("ok 8")})'` 退出 0（8 篇文档都能被托管文档存储读出，title / status / kind 如上）。
- [ ] `for f in docs-managed/DOC-920-goal905-b1.md docs-managed/DOC-921-goal905-b2.md docs-managed/DOC-922-goal905-b3.md docs-managed/DOC-923-goal905-b4.md docs-managed/DOC-924-goal905-b5.md docs-managed/DOC-925-goal905-b6.md docs-managed/DOC-926-goal905-b7.md docs-managed/DOC-927-goal905-b8.md; do [ "$(wc -l < "$f")" -ge 30 ] || { echo "$f has fewer than 30 lines"; exit 1; }; done` 退出 0（每篇不少于 30 行）。
- [ ] `bash scripts/test.sh --static-checks-doc` 退出 0（文档类静态检查对这批新文档通过）。
- [ ] `git log --no-merges --name-only --format= HEAD ^develop ^goal/GOAL-905 | sort -u | grep -vE '^(docs-managed/DOC-920-goal905-b1\.md|docs-managed/DOC-921-goal905-b2\.md|docs-managed/DOC-922-goal905-b3\.md|docs-managed/DOC-923-goal905-b4\.md|docs-managed/DOC-924-goal905-b5\.md|docs-managed/DOC-925-goal905-b6\.md|docs-managed/DOC-926-goal905-b7\.md|docs-managed/DOC-927-goal905-b8\.md|tasks/gap-goal905-drill-docs-b\.md)$' | wc -l` 输出 `0`（任务自己的提交——既不在 develop 也不在 goal/GOAL-905 上的那些——只触及上面 8 个文档与本任务文件；追平合入的别人的提交不计，所以不用三点 diff）。

## DoD

真实落地判据：本任务的翻 done 提交经 `goal/GOAL-905` 进入 goal 分支（不在 develop 上），预览实例的 /doc 页因此列出 DOC-920。生产读数由 GOAL-028 的 AC-321/322/323（任务经 goal 分支落地、追平 develop、落地后不再被派发）在三个任务都落地后取得，AC-906 在预览实例上通过。

## Touches

- docs-managed/DOC-920-goal905-b1.md (new)
- docs-managed/DOC-921-goal905-b2.md (new)
- docs-managed/DOC-922-goal905-b3.md (new)
- docs-managed/DOC-923-goal905-b4.md (new)
- docs-managed/DOC-924-goal905-b5.md (new)
- docs-managed/DOC-925-goal905-b6.md (new)
- docs-managed/DOC-926-goal905-b7.md (new)
- docs-managed/DOC-927-goal905-b8.md (new)
- tasks/gap-goal905-drill-docs-b.md
