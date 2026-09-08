---
id: gap-git-graph-drops-commits-while-overflowcount-reports-zero
title: git-history 一次性拉取 GIT_HISTORY_LIMIT=500 条、无分页入口；本仓库产出约 690 提交/天 ⇒ 页面仅覆盖约
  15-17 小时且无法查看更早历史——需要滚动加载更多提交，仿 /session/&lt;id&gt;/earlier 的增量端点，且必须建立在按 ref
  取数（而非全局 -n 上限）的模型之上才能不重现旧的静默丢弃
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge
---
## Proposal

**用户诉求（2026-09-08）**：「支持滚动加载更多 commit 历史」。

**现状**：`observation.ts:2331` `GIT_HISTORY_LIMIT = 500` 是一次性拉取的硬上限，无分页参数、无滚动加载 UI。本仓库产出约 690 提交/天，实测 500 条只覆盖约 **15-17 小时**（窗口随时间漂移），而 develop 全量有 18000+ 条提交——用户想看"上周做了什么"完全没有入口。

**git 侧不是瓶颈（已实测）**：

```
git log -n 500    0.02s
git log -n 2000   0.04s
git log -n 5000   0.08s
git log -n 20000  0.33s
git rev-list develop（全量祖先集）  0.08s
```

瓶颈纯粹是"没有分页端点 + 没有客户端加载更多的 UI"，不是数据获取代价。

**本仓库已有同类先例可抄**：`serve-sessions.ts:199-236`——`/session/<id>/earlier?before=<n>` + `IntersectionObserver` sentinel + `fetch` + `insertAdjacentHTML`。git-history 不能照搬这个"追加静态 HTML 片段"的做法，因为 `layoutGitGraph` 的泳道分配、fork/merge 解析、行号是**全局**算出来的——把窗口从"最近 500 条"扩大到"最近 1000 条"必须整体重算 layout，不能只在末尾拼接新行。好在 git 侧代价已证明可忽略，"整体重算"完全负担得起。

**与 P2（ref 分区模型）的耦合，必须先后依赖**：本任务原先的诊断是"全局 `-n 500` 静默丢弃 185 条提交、`overflowCount` 恒报 0"（见下方"历史"一节）。这个诊断在 `gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge`（P2，把 `layoutGitGraph` 从"合并提交反推"改成"按 `.ref` 分区"）落地之后**语义会变**：一旦按 ref 分区正确工作，非 mainline 活 ref 的提交不会再被全局条数上限饿死（每条活分支的历史相对短，天然不会被"最近 N 条全局提交"挤掉太多）；真正剩下的"看不到"只有一种情况——**mainline（develop）自身的历史比当前加载窗口更早**，这正是滚动加载要解决的问题，不再需要"未归属计数"这个诊断性字段。本任务必须在 P2 落地后实现，否则分页出来的新窗口会重新暴露 P2 要修的那个 bug（活分支被全局裁切）。

**历史（本任务原始诊断，仍是真实现象，现由本任务的新范围吸收）**：2026-09-08 实测宣称"最近 500 条"而图上只画出 315 个 distinct 提交，`overflowCount` 恒为 0——这个现象的根因一部分是 P2 修的模型错误（假泳道吸收了本该属于 mainline 的提交行数配额），一部分是本任务要修的"没有分页入口"。两个任务分工：P2 管"分类对不对"，本任务管"能不能看到更多"。

## Plan

1. **服务端**：新增 `GET /git-history.json?before=<unixSeconds>&limit=<n>`——对给定截止时间之前的提交重新整体计算并返回完整 `GitGraphLayout` JSON（复用现成的 `layoutGitGraph`，不是新写一份）。`readGitHistory`/`readGitHistoryUncached` 的取数逻辑改为**按 ref 分别取**（每个活 ref 用自己的 `git log <ref> --not <mainline>` 取独有提交 + mainline 用 `-n <limit>` 或 `--before=<cursor>` 取一批），而不是当前"全部 ref 塞进一次 `git log <allrefs> -n 500 --source`"——这样活跃 ref 的提交不会被全局条数上限挤掉，是 P2 模型在"取数"这一步的自然延伸。
2. **客户端**：SVG 容器底部放置 sentinel 元素，`IntersectionObserver({rootMargin: "600px 0px"})` 触发时 `fetch` 上述端点，拿到新的完整 layout 后调用**现有的** `render()` 重绘（`render()` 已经是幂等的：`svg.selectAll("*").remove()` 打头）——不新写第二份 SVG 构建逻辑。
3. **状态保留**：`expanded{}` 用泳道的结构化 `id`（`fork::merge`）为键，重算后 id 稳定，天然保住展开态；滚动位置以"当前视口顶部那一行的提交 hash"为锚点，重渲后 `scrollIntoView` 恢复。
4. **覆盖时长可见**：导语里显示"当前已加载窗口覆盖 N 小时/天"，由已加载提交的 min/max 时间算出，每次滚动加载后更新（不是页面加载时算一次就不变）。

## AC

- [x] AC1 `GET /git-history.json?before=<t>&limit=<n>` 返回一份完整 `GitGraphLayout` JSON，`commitCount` 反映请求的 `limit`：`node --test packages/quay/test/gap-git-graph-drops-commits-while-overflowcount-reports-zero.test.mjs` 退出码 0。
- [x] AC2 负控制：测试内还原旧的"全部 ref 塞进一次全局 `-n limit`"取数方式，对一个含长期活跃非 mainline 分支的 fixture，断言该分支的提交数少于按 ref 分别取时的数量 ⇒ 判据能区分新旧（复现 P2 之前的挤压问题，证明本任务的按 ref 取数是必要的，不是装饰）。
- [x] AC3 生产读数：`curl -s 'http://127.0.0.1:4174/git-history.json?before=<当前 500 条窗口下界时间戳>&limit=500'` 返回的 `commitCount`/最旧提交时间戳，比不带 `before` 的默认请求更早——证明端点确实能"往回翻"，不是重复返回同一批。
- [x] AC4 客户端集成：渲染后的 HTML 含 sentinel 元素与调用该端点的脚本；用 Playwright 模拟滚动到底部并等待，断言页面 SVG 行数在等待前后发生变化（真实加载了更多提交，不是死代码）。
- [x] AC5 覆盖时长文案：导语在初始加载与一次滚动加载之后分别读到的"覆盖时长"数字不同（后者更大），且该数字由当前已加载提交的实际时间跨度算出（fixture 测试断言其随窗口扩大而增大，不是写死常量）。

## DoD

生产实例 `/git-history` 上，反复滚动到页面底部能持续把已加载历史往回扩展（用 Playwright 实测：多次滚动加载循环后，覆盖时长明显超过初始的 15-17 小时），且展开态与滚动位置在每次重绘后不丢失（滚动锚点提交在重绘后仍在视口附近）。把分页端点摘掉、退回一次性 `-n 500`，会让 AC3/AC4 变红。

## Touches

- packages/quay/src/serve-git.ts（客户端 sentinel + IntersectionObserver + fetch，复用现有 render()；导语覆盖时长随加载更新）
- packages/quay/src/observation.ts（readGitHistory 改为按 ref 分别取数；before/limit 参数）
- packages/quay/src/serve-handlers.ts（新增 `/git-history.json` 路由）
- packages/quay/test/gap-git-graph-drops-commits-while-overflowcount-reports-zero.test.mjs（本任务的回归测试：按 ref 取数 + 分页端点 + 客户端集成）
- packages/quay/test/observation.test.mjs（readGitHistory 按 ref 取数、before 参数用例）
- tasks/gap-git-graph-drops-commits-while-overflowcount-reports-zero.md
