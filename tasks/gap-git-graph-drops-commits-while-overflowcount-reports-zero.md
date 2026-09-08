---
id: gap-git-graph-drops-commits-while-overflowcount-reports-zero
title: git-history 导语宣称「最近 500 条提交」而图上实绘 315 条 distinct、静默丢 185 条，overflowCount
  恒报 0 把「未归属」与「无溢出」写成同一个值；且 500 是条数上限，本仓库只覆盖 17.4 小时而页面不说
status: ready
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-git-graph-omits-inflight-branches-and-summary-table-disjoint
---
## Proposal

**现象（2026-09-08 用 Playwright MCP 对生产实例 `/git-history` 实测，两次独立加载复算，数字随新提交略有漂移但结论一致）**：

- 页面导语写「当前窗口：最近 **500** 条提交」，而图上实际渲染的 distinct 提交 hash 只有 **315**（trunk 110 + 各泳道 207，去重后）⇒ **静默丢弃 185 条**。
- 同一份 JSON 里 `overflowCount` = **0**，`serve-git.ts:691` 的「+N more lanes 收窄」提示因此从不显示。
- 丢失分解（实测）：**38 条**属于 5 条在飞 worktree 分支（完全不画，正本 `gap-git-graph-omits-inflight-branches-and-summary-table-disjoint`）；**147 条** develop 提交未被 `layoutGitGraph` 的任何泳道认领。
- 这正是 CLAUDE.md 硬规则 3b 的形态：**「未归属」没有独立取值，与「无溢出」共用 `0`** ⇒ 一个结构上不可能报非零的读数，与「一切正常」同形。

**另一半（窗口的量纲）**：`packages/quay/src/observation.ts:2331` `GIT_HISTORY_LIMIT = 500` 是**提交条数**上限。本仓库产出约 690 提交/天，实测 500 条只覆盖 **17.4 小时**（窗口 2026-09-07T20:09Z → 2026-09-08T13:34Z），而 develop 共 18026 条提交。**条数在本仓库不携带时间信息**——用户看到「500 条」无从知道那是大半天还是半年，也没有任何入口把窗口调宽。

**期望**：① `overflowCount` 之外增加 `unclaimedCount`，真实计入「窗口内但未被任何泳道认领的提交数」，与「无溢出」区分取值；② 导语显式打印三元组「窗口 N 条 / 已绘 M 条 / 未归属 K 条」以及**实际覆盖时长**；③ `/git-history?limit=` 支持调窗口（默认仍 500）。

**相关（旋钮不同，不重复）**：`gap-git-history-clickable-branches-window`（done）调的是 `GIT_HISTORY_ACTIVE_WINDOW_SEC`（泳道按 tip 年龄保留的窗口），与本条的 `GIT_HISTORY_LIMIT`（提交条数上限）不是同一个量。

## AC

- [ ] AC1 `layoutGitGraph` 的返回值含 `unclaimedCount`，其值 = 输入 commits 去重数 − (trunk ∪ 各泳道 commits) 去重数：用一个已知会丢弃提交的 fixture 断言 `unclaimedCount > 0`，`node --test packages/quay/test/gap-git-graph-drops-commits-while-overflowcount-reports-zero.test.mjs` 退出码 0。
- [ ] AC2 负控制：测试内显式跑一份把 `unclaimedCount` 恒定为 0 的实现，断言它在同一 fixture 上被判不合格 ⇒ 判据能取假，不是恒真。
- [ ] AC3 生产读数对账：`curl -s http://127.0.0.1:4174/git-history` 得到的 HTML 中，导语同时含「已绘」与「未归属」两个词；用 node 解析 `#git-graph-data`，断言 `commitCount - (trunk ∪ branches 去重数) === unclaimedCount`（差为 0）。
- [ ] AC4 `curl -s 'http://127.0.0.1:4174/git-history?limit=120'` 的 `#git-graph-data` 的 `commitCount` = 120，而不传 limit 时 = 500。
- [ ] AC5 导语含实际覆盖时长（形如「覆盖 N.N 小时」或「覆盖 N 天」），且该数字由窗口内 min/max 提交时间算出——测试断言其与 fixture 的时间跨度一致（不是写死的常量）。

## DoD

生产实例 `/git-history` 上，「宣称条数」与「实绘条数」不再互相矛盾：要么把未归属的提交画出来，要么在页面上**把它们的条数显式说出来**。以一次真实浏览器读数为证——Playwright 取 `#git-graph-data` 与导语文本做对账，差为 0。`unclaimedCount` 在**生产数据**上取到过非零值（不是只在 fixture 里非零，硬规则 4 推论三），并且把该字段改回恒零会让 AC1/AC3 变红。

## Touches

- packages/quay/src/serve-git.ts（layoutGitGraph 计入未归属提交；导语打印三元组与覆盖时长）
- packages/quay/src/observation.ts（readGitHistory 的 limit 参数对外透传）
- packages/quay/src/serve-handlers.ts（`/git-history?limit=` query 透传给 handleGitHistory）
- packages/quay/test/gap-git-graph-drops-commits-while-overflowcount-reports-zero.test.mjs（本任务的回归测试）
- packages/quay/test/serve-handlers.test.mjs（limit query 与导语三元组用例）
- tasks/gap-git-graph-drops-commits-while-overflowcount-reports-zero.md
