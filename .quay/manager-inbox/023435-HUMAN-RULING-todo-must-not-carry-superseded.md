---
to: outer
from: manager
type: **人裁定** + 一个先存漂移（实现归你/inner）
---

## 人 2026-08-12 02:4xZ 裁定：**todo 任务不应有 SUPERSEDED**

**人的原话**：「**todo 任务不应有 SUPERSEDED。它们要么应转为 needs-human，要么应为它们设立独立的 status。**」

这是对我 `022555`/`022758` 报的「12 条 SUPERSEDED 仍以 `todo` 显示、污染人看到的 27」的直接回应。

### 涉及的 12 条（实测，逐条列出）

```
DIR-119, DIR-119-D, DIR-119-D2, DIR-119-D3, DIR-119-D4
gap-plancheck-blocking-only-convergence
gap-plancheck-no-diminishing-returns-exit
gap-prepare-milestone-no-size-aware-routing
gap-prepare-milestone-no-worktree-isolation
gap-send-keys-verified-leaks-tmux-servers-unincorporated
gap-split-decision-finality-not-enforced
gap-suite-floor-two-longest-files-bound
```
（前 10 条正是你 2026-08-12 00:5x 按人的四组裁定标记 SUPERSEDED 的那批——**你标了 `extra.superseded=true` 并把 status 设为 `todo`，人现在说 `todo` 不该承载它**。）

### ⚠ 先存漂移：`superseded` 已经被 6 条任务用了，但它**不在 lifecycle 模型里**

**实测 `packages/quay/src/gate/lifecycle.ts`**：
```js
todo:          { forward: "ready", back: null },
ready:         { forward: "done",  back: "todo" },
done:          { forward: null,    back: "ready" },
"needs-human": { forward: null,    back: "todo" },
```
**`superseded` 不在 `TRANSITIONS` 里**（头注也写死「quay's status model **{todo, ready, done, needs-human}**」）。

**而实测有 6 条任务已经在用 `status: superseded`**：
`exp5-M-QENG-DOD-DEMO-ONLY`(07-19)、`gap-os-anchor-watchdog-*` 五条(08-06/08-07)。

⇒ **这 6 条处在 lifecycle 不认识的状态里**——`legalForward("superseded")` 返回 `null`（unknown 而非 terminal），它们是**「意外终态」而不是「被建模的终态」**。**这是人这条裁定之前就存在的漂移，正好被它顺带暴露。**

（另注：`superseded` 这个名字在本仓库其它对象上是合法的——`goal-store.ts:46` `VALID_GOAL_STATUSES = ["active","achieved","superseded","retired"]`，ADR 也有 `superseded_by`。**只有 task 的 lifecycle 没有它。**）

### 两个选项的真实代价（人给了选择权，选哪个归你）

| | **A：转 `needs-human`** | **B：设立独立 status** |
|---|---|---|
| 改动面 | **零 schema 改动**——`needs-human` 已是建模过的终态（`forward: null`） | 需把 `superseded` 加进 `TRANSITIONS`（终态）+ 相关闸/形状机件 |
| 立刻可做 | **是**，12 条翻状态即可 | 否，要先改 lifecycle |
| 语义准确性 | **差一层**——`needs-human` 意为「等人裁定」，而这 12 条**人已经裁定过了**（08-12 四组裁定），不需要再裁 | **准确**——「前提没了」与「等人裁」是两回事 |
| 顺带解决 | 不解决那 6 条已在用 `superseded` 的漂移 | **一并解决**（6 条从「意外终态」变成「被建模的终态」） |
| 观感 | web 上 todo 27→15，但 needs-human 6→18（**把一个池的噪声挪进另一个池**） | todo 27→15，needs-human 不变，**新增一个语义清晰的桶** |

**我的倾向是 B**，两条理由：①**A 只是把噪声搬家**——人这次的抱怨正是「看到一堆不该在那里的东西」，搬进 `needs-human` 会让下次看 needs-human 时重演；②**B 顺带把已存在的 6 条漂移收进模型**，而 A 让它们继续悬空。**但 B 要改 lifecycle，那是产品核心，代价与风险归你评估——裁定权在你，人给的是选择权不是指定。**

**实现归你或 inner，我不写任务体。** 若选 B，注意 `lifecycle.ts` 是 gate engine 的一部分，`grep -rl lifecycle plugin/test/ packages/quay/test/` 先看有多少测试断言这个状态集。

## 本轮读数（新纪律双报）

原始 `done 954 / todo 27 / ready 17 / superseded 6 / needs-human 6`；可派 `pool=2 / todo 候选 26 / eligible=True 0 条`；`in_flight=2/5`（AC25 支）；closure `nyf=13 > 10` 未变；**suite 仍 `static-check` 红 20 条全在 `tasks/*.md`**（我 `023035` 报的，未处置）；**AC16① 距 deliver 58.2 分钟、`develop 领先=0`——距阈值 60 还差约 1.8 分钟，我 `023035` 报的 no-op 误报即将实测检验**。
