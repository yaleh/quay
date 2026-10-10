---
id: gap-cli-lanes-json-verb-for-gantt-consumers
title: 新增只读 CLI 动词 `quay lanes --json`：复用 dashboard-kernel 直接输出 merged+packed
  lanes（交付机制 A），供 claudecodeui 甘特图消费
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**裁定（由协调会话转达的人裁定，2026-10-10）：交付机制取 A** —— quay 侧提供一条**只读 CLI 动词**，直接输出 merged+packed lanes 的 JSON，消费方 shell 出去取，与既有 `quay driver live --json` 同模式。**B（按路径 import 插件镜像）与 C（GitHub Release tarball）不采用。**

**为什么是 A**：Quay 走 Claude Code plugin 渠道（`dist-plugin` 孤儿分支），消费方 claudecodeui 是**独立项目**、有自己的打包图，从带版本号的插件缓存目录里 import 不是一条稳定路径；而 CLI 子进程正是它**现有的**消费方式（它已经在调 `quay driver live --json`）。选 A 既满足"不 vendor 源码 / 不用 `file:` / 不恢复公共 npm"，也不引入任何新的分发包。

**实现要点（⛔ 复用，不写第二份）**：
- 数据必须复用**同一条** live 调用链与**同一个** kernel：`packages/quay/src/dashboard-kernel.ts` 的 `mergeLiveAndHistoryIntervals` / `packLen (`packLanes`) / `FIXED_GANTT_LANES`。今天它们唯一的消费者是 Web 卡片 `packages/quay/src/serve-dashboard.ts`（取组在 `:121`，装箱在 `:380`）。
- 新增一个 CLI 动词（建议 `quay lanes --json [--window-hours N]`，`--json` 恒开，与 `driver live` 同约定）。⛔ 0.18.0 里**没有**这条动词：`quay driver live` 只报 in-flight worker 集合（`packages/quay/src/cli/driver.ts:136`），不含 packed lanes。
- 输出形状必须与消费方 `src/shared/types.ts` 的 `QuayGanttLanes` **逐字段一致**：`{windowHours, nowMs, lanes[], overflow}`，区间字段 `taskId/runId/startMs/endMs/phase/finalState/fanInOutcome`。
- **车道数恒为 `FIXED_GANTT_LANES`(5)** —— 那是**视觉契约**（窗口为空时也要画 5 条参考线），⛔ 不是"占用了几条"。超出 5 条并发的部分照旧计入 `overflow`，⛔ 不得丢弃。

## Contract

```
invariant `quay lanes --json` 的车道分配与 Web 卡片（serve-dashboard）对**同一 workspace、同一时刻**的读数逐值相等——两者必须走同一条 live 调用链与同一个 kernel，⛔ 不得出现第二份装箱实现
measure lanes_parity_mismatches: `node --experimental-strip-types -e "…同时取 quay lanes --json 与 serve-dashboard 的同源读数并逐值比较…"` → mismatches
band   lanes_parity_mismatches: 0 —— 同源确定性对读，不设噪声带
invoke `node packages/quay/bin/quay.js lanes --json --root <workspace>`
control 故意改动 kernel 一处（例如 `packLanes` 的车道复用条件）后，同一条比较必须报出 mismatches > 0；⛔ 若改动后仍为 0，说明比较没有真的读到 kernel，判据作废
resume 载体＝新增的 CLI 动词文件（实现载体）+ `packages/quay/src/dashboard-kernel.ts`（复用，语义不变）；落地经 task → 门 → fan-in，随后随下一版 plugin 渠道发布
```

**不变式**：`lanes.length` 恒为 5、`overflow` 只计不丢、"窗口内无记录"与"读不到 carrier"必须是**两个不同取值**（硬规则 3b）。

## AC

- [ ] AC1 `quay lanes --json --root <ws>` 退出 0，stdout 是合法 JSON，形状为 `{windowHours, nowMs, lanes[], overflow}`，区间字段与消费方 `QuayGanttLanes` **逐字段一致**（多一个或少一个都算不合格）。
- [ ] AC2 `lanes.length === FIXED_GANTT_LANES`（恒 5），且这 5 条是**参考线**语义：窗口内无记录时仍返回 5 条空车道，⛔ 不是返回 0 条或"实际占用数"。
- [ ] AC3 超并发：构造 >5 条并发区间时，5 条进车道、其余计入 `overflow`，且 `sum(lanes)+overflow === 输入区间数`（一条都不丢）。
- [ ] AC4 **同源对读**（这是本任务的核心判据，⛔ 不得用 fixture 顶替）：同一 workspace、同一时刻，`quay lanes --json` 与 Web 卡片路径的车道分配逐值相等，`lanes_parity_mismatches === 0`。
- [ ] AC5 负控制（取证假）：按 Contract 的 `control` 改动 kernel 一处后，AC4 的比较必须报出 `> 0`；⛔ 改回后重新为 0。⛔ 若改不动也报 0，说明 AC4 没有真正读取 kernel。
- [ ] AC6 `--window-hours N` 真正改变时间窗口（重新过滤两类记录源），⛔ 不是前端式视觉缩放；默认值与 Web 卡片一致（3）。

## DoD

- 消费方 claudecodeui 能以**子进程**方式取得该 JSON 并渲染 5 车道甘特图，无需任何 quay npm 依赖、无需 import 插件镜像路径。
- 该动词随**下一版 plugin 渠道**发布（`dist-plugin`），消费方在已发布插件里可用；claudecodeui 的 `gap-quay-tab-loop-pulse-gantt-integration`（现为 `needs-human`）据此解除。
- 生产载体读数：在**已发布插件**的 CLI 上实跑一次 `quay lanes --json` 并留下输出，⛔ 不以源码树里的等价物冒充。

## Touches

- packages/quay/src/cli/lanes.ts (new)
- packages/quay/bin/quay.ts
- packages/quay/test/lanes-cli.test.mjs (new)
- packages/quay/src/dashboard-kernel.ts
- packages/quay/src/cli/help.ts
- packages/quay/test/cli.test.mjs
- delivery-manifest.json
- tasks/gap-cli-lanes-json-verb-for-gantt-consumers.md

## Notes

**背景（已实测，2026-10-10）**：`v0.18.0` 已把 `vendor/quay/dist/dashboard-kernel.js` + `dashboard-kernel-vectors.json` 打进发布产物（`gap-dashboard-kernel-not-packaged-in-plugin-artifact` 的缺口已修）；但那条路径（B）已被人裁定**不采用**，故本任务的存在理由是 A，不是继续推广 B。kernel 三件套目前唯一消费者是 Web 卡片，消费方要的正是它算出来的东西——所以本任务本质是"给已有的唯一实现开一个只读出口"，⛔ 不是新写一个算法。消费方前端已在 claudecodeui `7fe72e71` 交付（纯渲染组件 + 契约向量 fixture，39/39 vitest 绿、真实浏览器验收过），只差这条动词。

**Touches 加宽说明（2026-10-10）**：原单只列了实现载体。落地时 `quay` 的**动词表层是四个互相钉住的点**，新增一条 verb 必然同时动它们：`src/cli/help.ts`（`--help` Usage 总纲里必须出现 `quay lanes` 一行）、`test/cli.test.mjs` 的 block14（它把「总纲动词集」与一份**硬编码的 dispatch 表**做集合相等断言，新动词不加进那份清单即 `extra` 报红）、`bin/quay.ts` 的兜底 usage 行（block28 从 dispatch 表机械推导期望集，加路由不加 token 即 `missing` 报红）、以及 `delivery-manifest.json`（`capability-manifest-check` 枚举 dispatch 表与 manifest 的 `capabilities` 双向差集——实测：加路由不加注册 ⇒ `UNREGISTERED: lanes (in source, not in manifest)` / `[cli-command] DRIFT: source=22 manifest=21`，scoped 门 fail-closed 红）。四者都在本任务自身 delta 内，按 `anti-drift-touches-check` 的「声明太窄」臂加宽，而非回退其中任何一个。