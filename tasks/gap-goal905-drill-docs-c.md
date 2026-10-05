---
id: gap-goal905-drill-docs-c
title: GOAL-905 第二次演练 C 批：新增 8 篇托管文档（DOC-930…DOC-937），必须经 goal/GOAL-905 分支落地
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-907
---
## Proposal

**这是 GOAL-905（goal 分支第二次演练）的承载任务 C，内容刻意无害。**（正本：`orchestration/SPEC-goal-branch-2026-10-03.md` §4.3/§4.4；GOAL-028 的演练证据节。）

新增 8 篇托管文档，文件名与 id 如下，每篇 frontmatter 为 `id: <DOC-id>`、`title: goal 分支第二次演练 C-<序号 1..8>`、`status: draft`、`kind: drill`：

1. `docs-managed/DOC-930-goal905-c1.md`（id DOC-930）
2. `docs-managed/DOC-931-goal905-c2.md`（id DOC-931）
3. `docs-managed/DOC-932-goal905-c3.md`（id DOC-932）
4. `docs-managed/DOC-933-goal905-c4.md`（id DOC-933）
5. `docs-managed/DOC-934-goal905-c5.md`（id DOC-934）
6. `docs-managed/DOC-935-goal905-c6.md`（id DOC-935）
7. `docs-managed/DOC-936-goal905-c7.md`（id DOC-936）
8. `docs-managed/DOC-937-goal905-c8.md`（id DOC-937）

每篇正文**不少于 30 行**，含 `## 演练记录` 小节，写明：这是 GOAL-905 第二次演练第 C 批的第几篇、演练要验证什么（并发落地 / 落后 develop 的追平 / 真实大小并入 / 刷新 / 预览自动装配）、它只存在于 `goal/GOAL-905` 上而并入前预览实例能列出生产列不出，并至少含一张小表。内容可以各不相同，但⛔ 不要复制粘贴同一段话 8 遍。不改任何产品代码、不改测试。

这条任务**必须经 goal 分支落地**：它的 `goal_ac` 指向 AC-907，该 AC 属于 branch-mode 的 GOAL-905，派发时 mergeTarget 解析为 `goal/GOAL-905`。若它落到了 develop，说明接线有缺陷，不是演练成功——在 Evidence 里记下实际的 mergeTarget。另两批任务（`gap-goal905-drill-docs-` 的其余两条）与本任务并发，Touches 互不相交；若 fan-in 遇到 ff 非快进，按既有的再追平重试处理，并在 Evidence 里记下重试了几次。

## AC

- [x] `node --experimental-strip-types -e 'import("./packages/quay/src/document-store.ts").then((m)=>{const s=m.createDocumentStore("docs-managed");for(const id of ["DOC-930","DOC-931","DOC-932","DOC-933","DOC-934","DOC-935","DOC-936","DOC-937"]){const d=s.get(id);if(!d||!String(d.title).startsWith("goal 分支第二次演练 C-")||d.status!=="draft"||d.kind!=="drill"){console.error("bad or missing "+id);process.exit(1)}}console.log("ok 8")})'` 退出 0（8 篇文档都能被托管文档存储读出，title / status / kind 如上）。
- [x] `for f in docs-managed/DOC-930-goal905-c1.md docs-managed/DOC-931-goal905-c2.md docs-managed/DOC-932-goal905-c3.md docs-managed/DOC-933-goal905-c4.md docs-managed/DOC-934-goal905-c5.md docs-managed/DOC-935-goal905-c6.md docs-managed/DOC-936-goal905-c7.md docs-managed/DOC-937-goal905-c8.md; do [ "$(wc -l < "$f")" -ge 30 ] || { echo "$f has fewer than 30 lines"; exit 1; }; done` 退出 0（每篇不少于 30 行）。
- [x] `bash scripts/test.sh --static-checks-doc` 退出 0（文档类静态检查对这批新文档通过）。
- [x] `git log --no-merges --name-only --format= HEAD ^develop ^goal/GOAL-905 | sort -u | grep -vE '^(docs-managed/DOC-930-goal905-c1\.md|docs-managed/DOC-931-goal905-c2\.md|docs-managed/DOC-932-goal905-c3\.md|docs-managed/DOC-933-goal905-c4\.md|docs-managed/DOC-934-goal905-c5\.md|docs-managed/DOC-935-goal905-c6\.md|docs-managed/DOC-936-goal905-c7\.md|docs-managed/DOC-937-goal905-c8\.md|tasks/gap-goal905-drill-docs-c\.md)$' | wc -l` 输出 `0`（任务自己的提交——既不在 develop 也不在 goal/GOAL-905 上的那些——只触及上面 8 个文档与本任务文件；追平合入的别人的提交不计，所以不用三点 diff）。

## DoD

真实落地判据：本任务的翻 done 提交经 `goal/GOAL-905` 进入 goal 分支（不在 develop 上），预览实例的 /doc 页因此列出 DOC-930。生产读数由 GOAL-028 的 AC-321/322/323（任务经 goal 分支落地、追平 develop、落地后不再被派发）在三个任务都落地后取得，AC-907 在预览实例上通过。

## Touches

- docs-managed/DOC-930-goal905-c1.md (new)
- docs-managed/DOC-931-goal905-c2.md (new)
- docs-managed/DOC-932-goal905-c3.md (new)
- docs-managed/DOC-933-goal905-c4.md (new)
- docs-managed/DOC-934-goal905-c5.md (new)
- docs-managed/DOC-935-goal905-c6.md (new)
- docs-managed/DOC-936-goal905-c7.md (new)
- docs-managed/DOC-937-goal905-c8.md (new)
- tasks/gap-goal905-drill-docs-c.md

## Evidence

实现载体：worktree `/data/home/yale/work/quay-worktrees/gap-goal905-drill-docs-c`（分支 `task/gap-goal905-drill-docs-c`），基点 `goal/GOAL-905` @ `0e46d640a`；一条实现提交，只新增 8 个 `docs-managed/DOC-93*.md`。不改产品代码、不改测试。

逐条 AC 读数（全部在上述 worktree 内跑出）：

| AC | 命令 | 读数 |
|---|---|---|
| 1 | `document-store` 按 id 读取 8 篇 | `ok 8`，exit 0 |
| 2 | `wc -l` 逐篇比对 30 行下界 | exit 0；实测行数 40 / 38 / 39 / 37 / 37 / 38 / 37 / 39 |
| 3 | `bash scripts/test.sh --static-checks-doc` | exit 0（8 条 doc-class checker 全过；其中 tick-core-drift 4 对一致） |
| 4 | 两点排除（`^develop ^goal/GOAL-905`）后的越界文件计数 | `0` |

mergeTarget：`goal_ac: AC-907` 属 branch-mode GOAL-905 ⇒ 期望 `goal/GOAL-905`；worktree 即从该分支开出（fork-point PASS）。**实际值由 fan-in 落定**——若最终落到 develop，按 Proposal 记为接线缺陷，不是演练成功。

ff 重试次数：交接时 0 次（尚未发生非快进）。
