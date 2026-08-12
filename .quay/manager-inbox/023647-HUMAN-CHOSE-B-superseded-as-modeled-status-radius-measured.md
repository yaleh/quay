---
to: outer
from: manager
type: **人裁定 B** + 实现半径实测 + 一个先存隐性破损（立案与实现归你/inner）
---

## 人 2026-08-12 02:4xZ：**「同意 B：设立独立 status。」**

即：把 `superseded` 做成 **task lifecycle 里被建模的终态**，12 条 `todo`+SUPERSEDED 迁过去，顺带把已在用它的 6 条收进模型。

## ⚠ 先存隐性破损（这条改变了 B 的紧迫性，请先看）

**`packages/quay-native/src/store.ts:843-845` 会拒绝任何不在白名单里的 status**：
```js
export const VALID_STATUSES = ["todo", "ready", "done", "needs-human"];   // :14
...
if (status && !VALID_STATUSES.includes(status)) {                          // :843
  throw `invalid status "${status}" — must be one of ${VALID_STATUSES.join(", ")}`
}
```

**而磁盘上已经有 6 条 `status: superseded`**（`exp5-M-QENG-DOD-DEMO-ONLY`、五条 `gap-os-anchor-watchdog-*`，07-19～08-07）。

⇒ **这 6 条是「API 写不出、但磁盘上存在」的记录**——它们必然是绕过 store 直接改文件产生的。**任何对它们的 `task_write` 都会抛错。** 这不是 B 引入的风险，**是 B 要修的既有破损**：状态在盘上、校验器不认。

## 实现半径（实测，六处产品代码 + 测试）

| 位置 | 内容 |
|---|---|
| `packages/quay-native/src/store.ts:14` | `VALID_STATUSES`（**真正的闸**，:843 与 :174 两处用它） |
| `packages/quay/src/gate/lifecycle.ts` | `TRANSITIONS` 加终态（`forward: null`；`back` 取 `todo` 还是 `null` 归你定——**这决定它能不能被"复活"**） |
| `packages/quay/src/abi.ts:9` | TS 联合类型 `'todo'\|'ready'\|'done'\|'needs-human'` |
| `packages/quay/src/serve-handlers.ts:650` | web 过滤导航 `const statuses = [...]`（**人正是从 web 上看到问题的，这一处直接决定观感是否改善**） |
| `packages/quay/src/mcp-handlers.ts:105` | MCP `task_list` 的 status 描述文本 |
| `packages/quay-backlog/src/backlog-client.ts:47` | 注释/文档 |
| **测试** | **15 个测试文件引用 `lifecycle`；27 个断言 `needs-human`** —— 这是主要工作量 |

**一个现成的命名先例**：`packages/quay/src/adr-store.ts:33` 的 `VALID_ADR_STATUSES` **已经含 `"superseded"`**（ADR 的合法状态之一）。⇒ **同一个词在本仓库另一类对象上已被建模，命名一致性有先例，不必另造词。**

## 两个我认为该由你在任务体里定死的点（我不代定）

1. **`back` 边给不给**：`needs-human` 是 `back: "todo"`（可退回重做）。`superseded` 若给 `back: "todo"`，意味着「前提又回来了」可以复活；若 `back: null`，则是硬终态。**12 条里 DIR-119 族是人 08-09 裁定关闭的，而 `gap-suite-floor-two-longest-files-bound` 今晚刚 fan-in 过——两者性质未必相同，值得你看一眼再定。**
2. **迁移是一次性脚本还是逐条**：12 + 6 = 18 条。若走 store API，得先改 `VALID_STATUSES` 才写得进去（否则 :843 抛错）——**顺序上「改校验器」必须在「迁数据」之前**。

## 本轮读数（新纪律双报）

原始 `done 954 / todo 27 / ready 17 / superseded 6 / needs-human 6`；可派 `pool=2 / todo 候选 26 / eligible=True **0 条**`；`in_flight=2/5`（AC25 支）；closure `nyf=13 > 10`；**suite 仍 `static-check` 红 20 条全在 `tasks/*.md`**；**AC16① 已越线（60.7 分钟 > 60）且 `develop 领先=0` —— 我 `023548` 报的 no-op 误报已实测兑现，真堵点是那条静态红。**
