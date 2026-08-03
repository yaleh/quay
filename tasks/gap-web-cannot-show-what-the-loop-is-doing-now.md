---
id: gap-web-cannot-show-what-the-loop-is-doing-now
title: "The web UI shows the task store and nothing else — the human cannot see
  what is running right now without asking in chat"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

2026-08-03 03:3xZ 人要求在 tailscale IP 上起 web server「持续观察本项目的任务」。
起来了，但它**只能显示任务库**——`/`、`/task/<id>`、`/adr`。

**人看不到的**：现在有几个任务在飞、各跑了多久、当前负载、最近落地了什么、有哪些升级项在等他。
这些信息今晚**全部存在**，但只存在于外层会话的对话里——**人必须反复在 Claude Code 里问才能拿到**，
而这正是 `docs/proposals/quay-web-observation-surface.md` 要解决的问题。

**本任务只做提案第一步中不需要新判断的两条路由**，`/board` 单独一个任务
（[[gap-web-board-needs-an-inconsistency-verdict-it-does-not-have]]），因为它要引入判据。

### 数据全部现成，零推理成本

| 路由 | 内容 | 数据源 |
|---|---|---|
| `/live` | 在飞任务、各自已运行时长、并发数、当前 CPU 压力 | `.quay/fast-mode-telemetry.jsonl` 的 start/end 配对 + `/proc/pressure/cpu` |
| `/journal` | 升级项、tick 记录、最近落地的提交 | `orchestration/escalations.md`、`orchestration/tick-log.md`、`git log` |

### 架构约束（提案 §3）：Core 不该知道工作区细节

Core 是 provider-agnostic 的。`.quay/fast-mode-telemetry.jsonl`、`orchestration/*.md`、`git`
都是**这个工作区的细节**，不属于 Provider ABI。

因此新增 **`packages/quay/src/observation.ts`** 作为**唯一**知道这些的地方，
且**每一个数据源都必须可降级为空**——在一个没有这些文件的普通 quay 工作区里，
`/live` 与 `/journal` 必须正常渲染成「无数据」，**不是 500**。

这条不是洁癖：`gap-serve-task-list-dies-on-one-malformed-task` 刚证明
**0.5% 的畸形数据能让 100% 的界面不可用**。新路由不许重复它。

## Contract

```
measure  live_inflight = `curl -s http://127.0.0.1:4173/live` 输出中 data-task-id 属性的计数字段
measure  http_status = `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/live` 输出的 http_code 字段
band     ok_status = 200                                          # 数据源全缺时也必须 200
invariant 渲染不写任何文件——读路径零副作用                          # 与 --report 纯读同一条原则
invoke   `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173`
control  把 .quay/fast-mode-telemetry.jsonl 改名 ⇒ /live 仍 200 且显示「无数据」，不是 500
resume   n/a: 单次请求，无中途产物
```

## Chosen mechanism

**在现有 `serve-handlers.ts` 上增量，不重写。**

1. **新建 `packages/quay/src/observation.ts`**——唯一知道 `.quay/`、`orchestration/`、`git` 的模块。
   每个读取函数**独立 try/catch，失败返回空**，并在返回值里带 `available: false` 与原因。
   **不静默返回空**——「没有数据」和「读失败」必须可区分（今晚 `test-coverage-check` 的教训）。
2. **`/live`**：读遥测 jsonl 的 start/end 配对，列出在飞任务 + 已运行分钟数 + 并发数；
   加一行当前 `/proc/pressure/cpu` 的 `some avg10`（Linux 以外读不到就不显示该行）。
3. **`/journal`**：渲染 `escalations.md` 与 `tick-log.md` 的最近 N 条 + `git log --oneline -20`。
   **markdown 复用现有渲染器**，不新写。
4. **导航**：在现有页面顶部加 `/live`、`/journal` 链接。

**不做**：不做提案第二步（当前 agent 输出的动态信息）——它需要一个尚不存在的契约，提案 §4 已明写推迟；
不做 `/board`（另一个任务）；不加任何写操作；不引入前端框架或轮询以外的机制。

## Acceptance Criteria

- [ ] AC1: `packages/quay/src/observation.ts` 是**唯一**引用 `.quay/`、`orchestration/`、`git` 的模块；
      `serve-handlers.ts` 不直接读它们（用 grep 证明）
- [ ] AC2: `/live` 显示在飞任务 id + 已运行分钟数 + 并发数，与
      `fast-mode-telemetry.ts --report --json` 的 `inProgress` **逐条一致**（实跑对照贴进任务体）
- [ ] AC3: `/journal` 显示 `escalations.md` 与 `tick-log.md` 最近条目 + 最近 20 条提交
- [ ] AC4: **降级负控制**——把 `.quay/fast-mode-telemetry.jsonl` 改名后 `/live` 仍返回 **200**
      并显示「无数据」；改回后恢复。**两个方向都要有实跑输出**
- [ ] AC5: 「无数据」与「读失败」在页面上**可区分**（后者显示原因），不是同一句话
- [ ] AC6: 读路径零副作用——渲染前后 `git status --porcelain` 无变化
- [ ] AC7: 现有路由（`/`、`/task/<id>`、`/adr`）行为不变，既有测试全绿
- [ ] AC8: 测试带 `// @test-group product` 声明

## Definition of Done

- [ ] AC2 的逐条对照与 AC4 的双向降级输出贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**这些信息今晚全部存在，只是只存在于对话里**。
      观察面的价值不是新数据，是**让人不必反复提问就能看到已有的数据**

## Touches

- packages/quay/src/observation.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/test/serve.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T03:45:00Z
changed: 从提案第一步里**只取 `/live` 与 `/journal`**，把 `/board` 拆出去——`/board` 要引入四条不一致判据，那是判断不是渲染，捆在一起会让整个任务因为判据争议而卡住；并加 AC5 要求「无数据」与「读失败」可区分，因为今晚 `test-coverage-check` 正是靠静默返回空集而失效了两周
