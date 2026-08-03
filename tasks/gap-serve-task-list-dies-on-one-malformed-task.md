---
id: gap-serve-task-list-dies-on-one-malformed-task
title: "One task file without an id took down the entire web task list — serve
  must degrade, not 500"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

2026-08-03 03:3xZ 人要求在 tailscale IP 上起 web server 持续观察任务。起来了，
**首页 `GET /` 直接 500**：

```
[quay serve] request handler error (GET /): TypeError: Cannot read properties of undefined (reading 'indexOf')
    at serve-handlers.ts:607:23
    at Array.map (<anonymous>)
    at handleTaskList (serve-handlers.ts:606:44)
```

`serve-handlers.ts:606-609`：

```js
const allPrefixes = [...new Set(allTasks.map((t) => {
  const dash = t.id.indexOf("-");        // ← t.id 可能是 undefined
  return dash > 0 ? t.id.slice(0, dash) : t.id;
}))].sort();
```

**原因**：588 个任务文件里有 **3 个** frontmatter 缺 `id:` 字段
（`gap-absorb-charter-audit-not-committed`、`gap-gate-event-store-concurrency`、
`gap-handleTaskAction-null-crash`）。provider 照常返回它们（588 条，其中 3 条 `id` 为 undefined），
渲染时崩在第一个 `.indexOf`。

**后果不成比例**：**3/588 = 0.5% 的畸形数据，让 100% 的任务列表不可用**。
而这个页面是人观察整个项目的**唯一图形界面**——它挂掉时，人得到的信息是
`internal server error`，**看不出是哪个任务、哪个字段的问题**。

### 同类缺陷第二次出现在同一个文件

三个缺 `id` 的文件里，有一个是 **`gap-handleTaskAction-null-crash`**，
状态 `done`，标题是「serve: handleTaskAction crashes on nonexistent task (null dereference)」。

**同一个 `serve-handlers.ts`、同一类空引用崩溃**，上一次修的是 `handleTaskAction`，
这一次是 `handleTaskList`。修一个函数不等于修一个类——
这正是 [[gap-audit-findings-not-backpropagated-to-earlier-detectors]] 说的那件事。

### 数据已修，缺陷未修

外层已给那 3 个文件补上 `id:`（取自文件名，与其余 585 个一致），页面恢复 200。
**但下一个畸形文件会再放倒它一次**——本任务修的是那个。

## Contract

```
measure  http_status = `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/` 输出的状态码
measure  rendered_rows = `curl -s http://127.0.0.1:<port>/` 输出中 `href="/task/` 的去重计数
band     http_status 必须是 200，即使存在畸形任务
invariant 畸形任务数在改前后一致（fixture 里固定 1 个），否则计数不可比
invoke   `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port <port>`
control  移除畸形任务 fixture ⇒ 渲染行数应增加 1，证明它确实被跳过而非被静默吞掉
resume   n/a: 单次请求，无中途产物
```

## Chosen mechanism

**畸形任务降级为可见的占位行，不中断整页渲染。**

1. **`handleTaskList` 对每条任务做防御**：`t.id` 缺失时不参与前缀计算，
   并在列表里渲染一行**可见的**占位（如 `⚠ <title 或文件名> — 缺少 id 字段`）。
   **不静默丢弃**——静默丢弃会让「有 3 个坏任务」和「只有 585 个任务」不可区分。
2. **provider 层给出诊断**：`quay-native` 返回任务时，若 `id` 缺失，
   用**文件名**兜底并在 `extra` 里标记 `malformed: ["missing-id"]`，
   让 UI 有东西可显示、也让 CLI 能查。**兜底不等于修好**——标记必须保留。
3. **整页 500 只保留给真正的服务端错误**：单条任务的数据问题不得升级为整页失败。

**不做**：不在 serve 里自动写回 `id` 到磁盘（读路径不写数据）；
不改 `task-schema-check` 的强度（那是另一件事，见下）。

**顺带**：`task-schema-check.ts` 目前对缺字段只发 **INFO 非阻断**警告
（见 `docs/analysis/normative-prose-audit.md` #46）。
本任务**不改它**，但要在任务体记录：**3 个缺 `id` 的文件存在了多久没被发现**，
作为「非阻断警告等于没有警告」的证据。

## Acceptance Criteria

- [ ] AC1: 构造一个缺 `id` 的任务 fixture，`GET /` 返回 **200**（不是 500）
- [ ] AC2: 该畸形任务在页面上**可见**——渲染为占位行并标出「缺少 id」，不是静默消失
- [ ] AC3: **负控制**——移除该 fixture 后渲染行数减少 1，证明 AC2 的占位行确实来自它
- [ ] AC4: 前缀导航（`allPrefixes`）不因畸形任务崩溃，且不把 `undefined` 当作一个前缀
- [ ] AC5: provider 层对缺 `id` 的任务用文件名兜底并标 `extra.malformed`，CLI `task list --json` 可查
- [ ] AC6: 检查 `handleTaskList` 之外**同文件其它 handler** 是否有同类无防御的字段访问，
      逐个列出并说明处置（这是「修一个函数不等于修一个类」的落实）
- [ ] AC7: 任务体记录那 3 个缺 `id` 的文件**存在了多久**（git log 首次提交时刻），
      作为 `task-schema-check` 非阻断警告无效的证据
- [ ] AC8: 测试带 `// @test-group product` 声明——这是产品面（web UI）缺陷

## Definition of Done

- [ ] AC1–AC3 的实跑输出贴进任务体
- [ ] AC6 的同文件同类扫描结果贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**0.5% 的畸形数据让 100% 的界面不可用**，
      而这个界面是人观察整个项目的唯一图形入口。降级的目标不是「不崩」，
      是**让人看见是哪一条坏了**——`internal server error` 什么都没告诉他

## Touches

- packages/quay/src/serve-handlers.ts
- packages/quay/test/serve.test.mjs
- packages/quay-native/src/index.ts

## Dispatch review

reviewer: outer
at: 2026-08-03T03:35:00Z
changed: 初稿只写「不要崩」；加 AC2/AC3 要求畸形任务**可见**且有负控制——静默跳过会让「3 个坏任务」与「只有 585 个任务」不可区分，那是把一个响亮的失败换成一个安静的谎；并加 AC6 要求扫同文件其它 handler，因为同类空引用崩溃在 `serve-handlers.ts` 已是第二次（上次是 `gap-handleTaskAction-null-crash`，且那个任务本身正是缺 `id` 的三个之一）
