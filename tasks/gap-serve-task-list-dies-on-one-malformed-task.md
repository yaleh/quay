---
id: gap-serve-task-list-dies-on-one-malformed-task
title: One task file without an id took down the entire web task list — serve
  must degrade, not 500
status: done
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
measure  http_status = `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/` 输出的 http_code 字段
measure  rendered_rows = `curl -s http://127.0.0.1:4173/` 输出中 href="/task/ 匹配数字段（去重）
band     ok_status = 200                                            # 即使存在畸形任务也必须是 200
invariant 畸形任务数在改前后一致（fixture 里固定 1 个），否则计数不可比
invoke   `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173`
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

- [x] AC1: 构造一个缺 `id` 的任务 fixture，`GET /` 返回 **200**（不是 500）
      —— 实跑见任务体 `## Execution record`（`PASS: AC1: GET / returns 200 with a missing-id task present (not 500)`）
- [x] AC2: 该畸形任务在页面上**可见**——渲染为占位行并标出「缺少 id」，不是静默消失
      —— `PASS: AC2: page visibly marks the malformed task '缺少 id'` / `renders as a visibly distinct placeholder row`
- [x] AC3: **负控制**——移除该 fixture 后渲染行数减少 1，证明 AC2 的占位行确实来自它
      —— `PASS: AC3: rendered rows drop by exactly 1 after removing the fixture (expected 3 rows, got 3)`
- [x] AC4: 前缀导航（`allPrefixes`）不因畸形任务崩溃，且不把 `undefined` 当作一个前缀
      —— `PASS: AC4: no 'undefined' string leaks into the page` / `prefix nav shows GOOD and MAL`
- [x] AC5: provider 层对缺 `id` 的任务用文件名兜底并标 `extra.malformed`，CLI `task list --json` 可查
      —— 单元（`createStore().list()`）与 CLI（`quay task list --json`）双层验证均 PASS，见 Execution record
- [x] AC6: 检查 `handleTaskList` 之外**同文件其它 handler** 是否有同类无防御的字段访问，
      逐个列出并说明处置（这是「修一个函数不等于修一个类」的落实）
      —— 全文件扫描结果贴进 `## Execution record`（AC6 同文件同类扫描）
- [x] AC7: 那 3 个文件缺 `id` **已 8–9 天**（外层实测 git 首次提交时刻）：
      `gap-handleTaskAction-null-crash` **2026-07-25 19:39**、
      `gap-gate-event-store-concurrency` **2026-07-25 19:55**、
      `gap-absorb-charter-audit-not-committed` **2026-07-26 11:57**。
      期间 `task-schema-check.ts` 一直在，只发 **INFO 非阻断**警告 ⇒
      **8 天无人处理。非阻断警告等于没有警告。**
- [x] AC8: 测试带 `// @test-group product` 声明——这是产品面（web UI）缺陷
      —— `serve.test.mjs` 第 1 行原本就是 `// @test-group product`（既有 legacy 文件，无需新增）

## Definition of Done

- [x] AC1–AC3 的实跑输出贴进任务体——见 `## Execution record`
- [x] AC6 的同文件同类扫描结果贴进任务体——见 `## Execution record`（AC6 同文件同类扫描）
- [ ] `scripts/test.sh` 连跑 2 次全绿——**留待 fan-in 全量套件**：本 gap 按 CPU 纪律（starvation 是单套件稳态）不自行跑全量，
      已跑 scoped 集（`packages/quay-native/test/*.test.mjs` + `packages/quay/test/serve.test.mjs`）全绿（0 fail），
      且 `scripts/test.sh --for-task gap-serve-task-list-dies-on-one-malformed-task --allow-thin` 选中的 `serve.test.mjs` 全绿。
- [x] 明确记录：**0.5% 的畸形数据让 100% 的界面不可用**，
      而这个界面是人观察整个项目的唯一图形入口。降级的目标不是「不崩」，
      是**让人看见是哪一条坏了**——`internal server error` 什么都没告诉他
      （记录在 `## Execution record` 末尾）

## Touches

- packages/quay/src/serve-handlers.ts
- packages/quay/test/serve.test.mjs
- packages/quay-native/src/store.ts（任务原文笔误写 `src/index.ts`——真实实现文件是 `store.ts`，`src/` 下没有 `index.ts`；已按 `gap-test-isolation-contract-is-unwritten` 的 Touches 笔误注释先例改正）

## Test-Files

- packages/quay/test/serve.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T03:35:00Z
changed: 初稿只写「不要崩」；加 AC2/AC3 要求畸形任务**可见**且有负控制——静默跳过会让「3 个坏任务」与「只有 585 个任务」不可区分，那是把一个响亮的失败换成一个安静的谎；并加 AC6 要求扫同文件其它 handler，因为同类空引用崩溃在 `serve-handlers.ts` 已是第二次（上次是 `gap-handleTaskAction-null-crash`，且那个任务本身正是缺 `id` 的三个之一）

## Execution record

实现 agent：fast-mode gap 派发（worktree `/tmp/quay-wt-servetask`，branch
`task/gap-serve-task-list-dies-on-one-malformed-task`，只提交未合并）
时间：2026-08-03

### 改动文件

- `packages/quay-native/src/store.ts` — `toViewModel()` 接受 `fallbackId`（文件名）：frontmatter 缺 `id:` 时用文件名兜底，
  并在 `extra.malformed` 记 `["missing-id"]`（合并进既有 extra，保留既有键）。`get()` 传入 `id` 作为兜底。
  「兜底不等于修好」——标记保留，CLI/UI 都能看到这是畸形数据。
- `packages/quay/src/serve-handlers.ts` — 四个点：
  1. 新增 `isMissingIdTask()`（模块级，导出）——`id` 缺失/非串，或 `extra.malformed` 含 `missing-id` 即命中；
  2. `handleTaskList` 的 prefix filter 加 `typeof t.id === "string"` 守卫（原 `.toUpperCase()` 是同类第二个崩溃点）；
  3. `handleTaskList` 的 rows 渲染：`isMissingIdTask(t)` 时渲染**可见占位行**
     `<tr class="malformed-row"><td colspan="7">⚠ <a href="/task/<文件名>"><文件名></a> — 缺少 id 字段</td></tr>`
     —— 不 500、不静默丢，占位行带链接可点进去查文件；
  4. `allPrefixes` 计算跳过无 `id` 的任务（原 `.indexOf()` 是 500 的原始崩溃点），不把 `undefined` 当前缀；
  5. sort 比较器对 `id`/`status` 做 `String(x ?? "")` 归一（undefined 参与排序不再不确定）；
  6. `pageStyles()` 加 `.malformed-row` 高亮。
- `packages/quay/test/serve.test.mjs` — 新增回归测试块（AC1–AC5 全部断言），fixture 直接用 `fs.writeFileSync` 种一个
  frontmatter 缺 `id:` 的任务文件（绕过 `store.write()` 的 id 必填校验，还原真实手工编辑场景）。

### AC1–AC3 实跑输出（scoped，`packages/quay/test/serve.test.mjs`）

```
PASS: AC5: provider list() falls back to the filename for a missing-id task
PASS: AC5: provider list() marks extra.malformed=['missing-id'] for a missing-id task
PASS: AC5: a good task is NOT marked malformed (only genuinely missing-id tasks are)
PASS: AC5: `quay task list --json` exposes extra.malformed=['missing-id'] for a missing-id task
PASS: AC1: GET / returns 200 with a missing-id task present (not 500)
PASS: AC2: page visibly marks the malformed task '缺少 id'
PASS: AC2: page shows the malformed task's filename fallback
PASS: AC2: the malformed task renders as a visibly distinct placeholder row
PASS: AC2: the malformed task renders as a real row (expected 4 rows, got 4)
PASS: AC4: no 'undefined' string leaks into the page (prefix calc skips missing ids)
PASS: AC4: prefix nav still renders with a missing-id task present
PASS: AC4: prefix nav shows GOOD and MAL (never an 'undefined' pseudo-prefix)
PASS: AC3: GET / still returns 200 after removing the malformed fixture
PASS: AC3: '缺少 id' marker is gone after removing the fixture
PASS: AC3: rendered rows drop by exactly 1 after removing the fixture (expected 3 rows, got 3)
All QN-031 serve/action regression tests passed.
```

`tsc --noEmit` 全仓 0 error。

### AC6 同文件同类扫描（serve-handlers.ts 全部 6 个 handler）

扫描信号：**对可能为 `undefined` 的任务/ADR 字段做方法调用**（`.indexOf`/`.toUpperCase` 等）——这一类是 500 的根因。
逐 handler 结论：

| handler | 字段访问形态 | 同类崩溃风险 | 处置 |
|---|---|---|---|
| `handleTaskList`（本次修） | `t.id.toUpperCase()`（prefix filter）、`t.id.indexOf("-")`（prefix nav） | **是——两个都是方法调用** | 已修：两个调用点都加了 `typeof t.id === "string"` 守卫；rows 渲染对畸形任务出占位行 |
| `handleAdrList` | `a.id` 只进 `encodeURIComponent`/`escapeHtml`；`a.title` 带 `\|\| ""`；`a.date` 带 `as string \|\| ""` | 否——`encodeURIComponent(undefined)` 安全返回 `"undefined"`，`escapeHtml(undefined)` 返回 `""`，无方法调用 | 可接受，不修 |
| `handleAdrDetail` | 先 null-check → 404；`a.id/a.title/a.status` 只进 `escapeHtml`；`a.body` 经 `renderMarkdown`（内部 `String(text ?? "")`）；`supersedes/supersededBy` 有 `&&` 守卫 | 否 | 可接受，不修 |
| `handleTaskDetail` | 先 null-check → 404；`t.id` 只进 `encodeURIComponent`/`escapeHtml`；`t.labels` 带 `\|\| []`；`t.body` 经 `renderMarkdown`（undefined 安全）；`t.status` 只进 `includes()`/`nextStatusMap` 查找（无方法调用） | 否——缺 `id` 只会渲染出空 id 单元格，不会 500。且本修复后列表占位行以文件名兜底 + 链接到达详情页，实践中 `t.id` 必有值 | 可接受，不修（已在记录中注明） |
| `handleTaskAction` | 先 null-check → 404（gap-handleTaskAction-null-crash 已修）；`t.id` 只进模板串（`channel: \`task-${t.id}\``）与 `composePayload` | 否——模板串 `task-undefined` 不抛 | 可接受，不修 |

结论：**「类」在 `serve-handlers.ts` 里只存在于 `handleTaskList` 内部**（两个方法调用点：prefix filter 与 prefix nav），
本次已把两个点都修掉；其它 handler 全部是 coercion-safe 形态。这与 `gap-handleTaskAction-null-crash`
（修 `handleTaskAction` 的 null deref）是同一个文件的两个不同缺陷——本次落的是「同类扫描」这一步。

### 明确记录（DoD 最后一条）

**0.5% 的畸形数据（3/588 个任务缺 `id`）让 100% 的界面不可用**——首页 `GET /` 直接 `internal server error`，
人得到的信息只有一行报错，看不出是哪个任务、哪个字段坏了；而这个页面是人观察整个项目的**唯一图形入口**。
本次降级的目标不是「不崩」，是**让人看见是哪一条坏了**：畸形任务渲染成高亮占位行
「⚠ `<文件名>` — 缺少 id 字段」，点进去能看文件，移除 fixture 后占位行消失（负控制差 1 行）。

### 偏离任务字面处

1. **Touches 的 `packages/quay-native/src/index.ts` 笔误**——真实实现文件是 `src/store.ts`（`src/` 下无 `index.ts`）；
   已在 Touches 注释并按先例改正。
2. **Contract 的 `control` 方向与 AC3 相反**：Contract 写「移除畸形任务 fixture ⇒ 渲染行数应**增加** 1」，
   AC3 写「渲染行数**减少** 1」。两者互相矛盾，AC3（验收标准）为权威——实现按 AC3：移除 fixture 后行数**减少** 1
   （占位行消失）。Contract 若按字面跑 `href="/task/` 计数：占位行带 `href="/task/<文件名>"`，故移除后该计数也减 1，
   仍是差 1 可测，只是方向与 Contract 字面相反。
3. **DoD「`scripts/test.sh` 连跑 2 次全绿」留待 fan-in**——CPU 纪律（starvation 是单套件稳态），本 gap 不自行跑全量套件；
   已跑 scoped 集（quay-native 全部测试 + serve.test.mjs）全绿。
4. **`--for-task` 需 `--allow-thin`**：`serve-handlers.ts` → `serve.test.mjs` 的 basename 映射（`serve-handlers.test.mjs` 不存在）
   与 `store.ts`（无 `store.test.mjs`）均无法被 select-tests-for-touches 解析，Touches 3 条只直接命中 1 条
   （`serve.test.mjs`），覆盖 1/3 < 0.5 → thin。`scripts/test.sh --for-task <id> --allow-thin` 已实测选中并全绿
   `serve.test.mjs`。这与 `gap-handleTaskAction-null-crash`（Touches 只有 `serve-handlers.ts`）的既有 thin 失败同源。

## Contract invoke 证据（2026-08-08 内层补）

invoke 实跑入口：`packages/quay/bin/quay.ts`（task-contract-check invoke-evidence 判据——done 任务须在 Contract 外展示所执行入口路径）
