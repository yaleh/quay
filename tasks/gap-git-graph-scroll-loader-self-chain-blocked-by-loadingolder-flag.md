---
id: gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag
title: git-history 滚动加载的自链调用写在 .then() 里而 loadingOlder 复位在 .finally()，.then 先执行
  ⇒ 自链必被 if(loadingOlder) return 挡掉、成死代码；实测停在底部连滚 4 次行数不变，滚离再滚回才各翻一页
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**实测（2026-09-08，干净实例 `127.0.0.1:4180`）**：`gap-git-graph-drops-commits-while-overflowcount-reports-zero`（done）建的滚动加载**只能翻一页就卡住**。

- 首次滚到底部触发一次加载：行数 525→1049、页高 13550→26524、导语「覆盖 15 小时」→「覆盖 1.3 天」。✅
- 之后**停在底部连续滚动 4 次（每次等 5s），行数纹丝不动**（恒为 1049），sentinel 一直停在「加载更早提交…」。网络面板显示**总共只发出 1 次** `/git-history.json` 请求。
- **负控制**：滚回页首再滚到底部，每个来回**各翻一页**——行数 1049→1573→2097→2621，游标 `before=` 依次 1788854579→1788793643→1788749434→1788742737（确实在往回走），导语「1.3 天→1.9 天」。⇒ **端点、游标、去重、坐标补偿都是好的，坏的只是「连续加载」这一条。**

**根因（`serve-git.ts:1128` 附近）**：

```js
.then(function (res) { /* ...合并数据、render()、scrollBy... */
    // If the grown graph still leaves the sentinel in view, chain the next page.
    if (sentinel && sentinel.getBoundingClientRect().top < window.innerHeight + 600) { loadOlder(); }
})
.finally(function () { loadingOlder = false; });
```

Promise 的 `.then()` 早于 `.finally()` 执行 ⇒ 自链调用发生时 `loadingOlder` 仍为 `true` ⇒ 被函数开头的 `if (loadingOlder || olderDone) { return; }` 直接挡掉。**这句「chain the next page」是死代码，从未生效过。**

叠加第二个因素：`IntersectionObserver` 只在**进入**跃迁时回调；停在底部时 sentinel 持续可见、不产生新跃迁 ⇒ 也不会再次触发 `loadOlder()`。两者叠加 = **用户停在底部就永远等不到第二页**，只有「滚离再滚回」才有效，而没有人会这样操作。

**期望**：`loadingOlder` 的复位早于自链调用（或把自链移出 `.then()`），使一次滚到底部能连续把后续页拉完；同时保留 `olderDone` 的终止条件，不产生无限请求。

## AC

- [x] AC1 自链生效：单测中 mock `fetch` 并让 sentinel 持续处于可见区，断言一次 `loadOlder()` 触发后连续发起 **≥2 次**请求（当前 = 1）：`node --test packages/quay/test/gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag.test.mjs` 退出码 0。
- [x] AC2 负控制：测试内把复位顺序改回旧写法（`loadingOlder = false` 仍在 `.finally()`、自链仍在 `.then()`），断言请求数回落到 1 ⇒ 判据能区分新旧。
- [x] AC3 结构判据（一条命令可查）：`grep -n "loadingOlder = false" packages/quay/src/serve-git.ts` 的行号 **小于**自链 `loadOlder()` 调用点的行号。
- [x] AC4 终止条件未被破坏：mock 一个返回空 `branches`（或 `added === 0`）的响应，断言 `finishOlder()` 被调用、sentinel 文案变为「已加载到仓库最早提交」、且不再发起后续请求（不产生无限循环）。
- [ ] AC5 生产实测：Playwright 把页面滚到底部后**保持不动**等待 15s，断言 SVG 行数**至少增长两次**（当前只增长一次后停住）。（待外部）

> **AC5 阻塞注（2026-09-09，实测复核）**：生产实测无法通过——`layoutGitGraph` 的脊柱从 `heads[develop]`（tip）起走首父链，而 `before` 分页结果不含 tip ⇒ 分页页 `branches[0].commits`（mainline 泳道）恒空（实测 page1 `mainline:develop:70` → page2 `mainline:develop:0`）⇒ 客户端 `older.length === 0` ⇒ `finishOlder()`，滚动加载第一页即停。此回归由 `gap-git-graph-ref-partition-collapses-all-topology-to-one-lane` 引入（修法需把 observation.ts 主链取数改为 `--first-parent` 并分离侧枝），是独立服务端分页缺陷，已另立任务 `gap-git-graph-pagination-mainline-lane-empty-before-page`。AC1–AC4 已由单测验证自链修复本身。

## DoD

生产 `/git-history` 上，把页面滚到底部后**不再做任何操作**，历史能连续自动往回加载至少 3 页——导语的覆盖时长与 SVG 行数单调增长，无需「滚离再滚回」。以一次 Playwright 实测读数（行数序列 + 网络请求条数）为证。把复位顺序改回去会让 AC1/AC5 变红。

## Touches

- packages/quay/src/serve-git.ts（loadOlder 的 loadingOlder 复位时机与自链调用位置）
- packages/quay/test/gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag.test.mjs（本任务的回归测试）
- tasks/gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag.md