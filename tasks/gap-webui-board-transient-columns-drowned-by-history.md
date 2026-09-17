---
id: gap-webui-board-transient-columns-drowned-by-history
title: /board 的"执行/落地"列是瞬时信号，默认视图混排 2243 条历史任务后几乎永远清一色"—"，NEW 标签名不副实
status: todo
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

**背景**：`/board`（导航栏标 NEW）近 7 天访问日志只有 2 次命中，而同期 `/dashboard` 360 次、`/tasks` 31 次。chrome-devtools 实测生产实例 `100.78.206.100:4173` 的 `/board` 页面，前 20 行（page 1/113）"执行"列、"落地"列全部是 `—`。

**⚠️ 先纠正一个容易得出的错误诊断**：第一反应会怀疑"执行/落地两列没接真实数据"，但读了 `packages/quay/src/serve-board.ts` 之后确认不是——页面顶部自己写着"执行: `.workflow-events/` · 0 实现中 · 0 待落地"，这两个数字是真实读数，不是恒零占位。`board.execution`/`board.landing` 的判断逻辑（`gap-web-board-needs-an-inconsistency-verdict-it-does-not-have` 已 done 落地）确实在读 `.workflow-events/` 目录和 `task-status-drift-check.ts` 的落地判定——**只是这两个维度本质是"瞬时"信号：只有一个任务正处在 in-flight worktree 或排队等 fan-in 时，它这一行才会非空**。同一时刻 Dashboard 页面显示"在飞 0 / 上限 5"——系统级 in-flight 数就是 0，所以 `.workflow-events/` 自然对全部 2243 行都给不出匹配，每一行"—"都是如实反映"当前没有在飞"，不是 bug。

**真正的问题**：`/board` 默认视图是把这两个"仅在极短时间窗口内非空"的列，铺在一张默认显示全部 2243 条（其中 2171 done、多数 57+ 天前更新）任务的表格里分页浏览。这两列在几乎任何一次打开页面的瞬间，对几乎任何一行都会是"—"——不是这次抽样运气不好，是这个默认视图的构造方式决定了它几乎必然如此。一个"意图/执行/落地" join 页面如果每次打开都是一堵空横杠，无法体现它的设计意图（用户也确实没在用它——2 次/周）。

**不是要重新做 join 逻辑**（那部分已经在生产上正确工作），**是默认呈现方式没有过滤到"当前值得看"的那个子集**。

## AC

- [ ] `/board` 默认视图（无 status/label 筛选参数时）只展示"执行"或"落地"列非空的行，或在两列全空时页面给出明确的空态提示（如"当前没有在飞/待落地的任务"），而不是渲染一整页历史任务配一堵横杠
- [ ] 保留现有的手工 status/label 筛选能力，可让用户主动切回"看全部 2243 条"的视图（不是彻底删除该能力，只改默认）
- [ ] `node --experimental-strip-types --test packages/quay/test/gap-webui-board-transient-columns-drowned-by-history.test.mjs` 覆盖：默认视图在 0 个任务命中执行/落地时的空态渲染 + 至少 1 个任务命中时默认视图只显示该任务（不显示其余 2242 条纯历史行）
- [ ] `scripts/test.sh` 全绿

## DoD

在真实运行的 `quay serve` 实例上用浏览器复核：系统 0 在飞时 `/board` 默认视图显示明确的空态说明（而非空表格/空横杠墙）；人为让至少一个任务进入 in-flight 或 awaiting-land 状态时，`/board` 默认视图能直接看到这一行，不需要翻页。是否保留"NEW"导航标签，视这次改动后的实际可用性由实现者一并判断并在 PR/commit 里说明理由。

## Touches

- packages/quay/src/serve-board.ts
- packages/quay/test/gap-webui-board-transient-columns-drowned-by-history.test.mjs
- tasks/gap-webui-board-transient-columns-drowned-by-history.md
