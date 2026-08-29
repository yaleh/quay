---
id: gap-mech-fan-in-log-webui-visible-clickable
title: 机械 fan-in 过程日志持久化 + web 详情页可点击访问：步骤 trace 落 .quay/fan-in-*.log + Runs 区块渲染 mechanical_fan_in + view/download 端点（带路径穿越防护）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

人指出：机械 fan-in 过程没有可访问的日志，应该要有，且要能在 web 任务详情页看到、像开发过程 Claude transcript 一样可点击访问。

**现状核实（manager 逐载体实测，2026-08-28）**：
① 机械 fan-in 的**终态**已落盘：`.quay/worker-outcome.jsonl` 每条 outcome 内嵌 `mechanical_fan_in` 字段（53/407 条真产生，分布 {red/suite:26, red/acquire-workflow-lock:14, red/scoped-gate:4, landed:4, red/ff:2, red/flip-done:2, red/merge-develop:1}），字段 = {outcome: landed|red, step, reason, lockHoldSecs, lockAcquireEpoch, lockReleaseEpoch, suiteFinishedEpoch, suiteOutcome, suitePid, landedSha}。
② **没有逐步骤 trace**：机械 fan-in 的各机械动作（acquire-lock → merge → anti-drift → delta 判定 → typecheck → scoped → doc → suite → anti-drift-land → ac-gate → flip → ff → cleanup）经 mechSh 机械执行，只记终态（首个失败 step + reason），各步的 exit / wall_ms / 时序不落任何载体。
③ 唯一富日志是套件日志 `/tmp/fan-in-suite-<task>-<runId>.log`（实测 329 个，最新 2026-08-28）——在 `/tmp`，会被系统清理、web 不可达、不可点击；且只覆盖 suite 一步（doc-only delta 跳过 suite 时连它也没有）。
④ web 详情页 Runs 区块（`serve-task.ts` `taskRunsBlock`）渲染 started_at / state / exit / wall / pid / run_id / transcript 列，**不渲染 mechanical_fan_in**；`observation.ts` `parseWorkerOutcomeRecords` 的 `WorkerOutcomeRecord` 接口**根本没有该字段**（显式字段解析，未知字段被丢弃）⇒ 结构上读不到。
⑤ 对比：开发过程有 Claude transcript，详情页可点 view/download（`/session/<id>` + `/session/<id>/download`，UUID 严格校验 + 路径穿越防护）——机械 fan-in 无对应物。

**要求（人）**：①机械 fan-in 产生持久化的过程日志；②web 详情页可见；③像 transcript 一样可点击 view/download。

## Plan

两部分（一条任务，与先例 `gap-worker-task-transcript-access-webui` 同粒度）：

**A. 持久化 fan-in 过程日志**（`worker-driver.ts`）：
- A1 步骤 trace：`runMechanicalFanIn` 每步（含锁 acquire/release、merge、anti-drift、delta 判定、typecheck、scoped、doc、suite 起止、flip、ff、cleanup）追加一行到 `.quay/fan-in-<task>-<runId>.log`（gitignored 运行时日志，worker-outcome.jsonl 同族），字段 {ts, step, exit, wall_ms, ok}，失败步附 reason。runId 唯一后缀 ⇒ 跨 relaunch 不复用（`gap-fan-in-suite-log-cross-relaunch-reuse` 同型防护）。
- A2 套件日志落点从 `/tmp/fan-in-suite-<task>-<runId>.log` 改为 `.quay/fan-in-suite-<task>-<runId>.log`（durable；`/tmp` 系统清理实证见 memory「3389 个测试遗留目录」）。
- A3 outcome 的 `mechanical_fan_in` 增 `fanInLog` 字段 = fan-in 日志文件名（单一真相源，web 链接据此构造，不重算 sanitize）。

**B. web 详情页可见可点**（packages/quay）：
- B1 `observation.ts` `WorkerOutcomeRecord` + parser 增 `mechanical_fan_in`（含 `fanInLog`）字段透传解析。
- B2 `serve-task.ts` Runs 区块按任务逐行渲染 mechanical_fan_in 结果（landed/red + 失败 step + 锁持有时长 + suite outcome + landed sha）；`fanInLog` 非空时给 view/download 链接。
- B3 新端点（如 `/fan-in-log/<task>/<file>`）：**复用 session download 的路径穿越防护模式**——task 严格 slug 校验 + 文件名严格白名单字符校验（`[A-Za-z0-9_.-]+`）+ 解析后必须位于 `.quay/` 内，非白名单 / `../` / 绝对路径 ⇒ 400；view 走 inline 读尾，download 走 Content-Disposition: attachment。
- B4 `.gitignore` 增 `.quay/fan-in-*.log`。

**范围约束（沿先例）**：不把日志内容复制进 task 文件；worker-outcome.jsonl 的 `run_id` 已能定位日志文件（真实记录 `run_id: wk-prod-1787919642` 与套件日志名同后缀已验证）。

## Acceptance Criteria

- [ ] AC1（能取假，trace 落盘）：实跑一条真任务机械 fan-in（含 suite 或 doc-only 皆可）后，`.quay/fan-in-<task>-<runId>.log` 存在且非空，每行含 {step, exit, wall_ms}，步序列覆盖 merge-develop → ff（或覆盖首个失败步前的全部步）；同任务新 runId 重跑 ⇒ 新文件、旧文件不被覆盖（⛔ 无文件 / 行缺 step/exit/wall_ms / 旧轮被覆盖 ⇒ 假）。
- [ ] AC2（能取假，web 渲染）：task 详情页 Runs 区块对该任务显示 mechanical_fan_in 结果（landed/red + 失败 step）；`fanInLog` 非空的行显示 view/download 链接，点击可访问（⛔ 不显示结果 / 链接 404 ⇒ 假）。
- [ ] AC3（能取假，路径穿越防护）：非白名单文件名 / `../` / 绝对路径的任务名或文件名被拒（400），不可读取 `.quay/` 之外的任意文件（⛔ 任意路径可读 ⇒ 假）。
- [ ] AC4（能取假，生产载体，硬规则 4 推论三）：实现落地后，production `.quay/worker-outcome.jsonl` 中带 `mechanical_fan_in` 且 `fanInLog` 非空的记录 ≥ 1，且其对应 `.quay/fan-in-<task>-<runId>.log` 存在非空（⛔ 只被 fixture/测试缝满足、production 零记录 ⇒ 假）。

## Definition of Done

机械 fan-in 每一步的 trace 持久化到 `.quay/fan-in-*.log`（gitignored）；套件日志脱离 `/tmp`；web 详情页 Runs 区块显示 fan-in 结果 + 可点击 view/download（路径穿越防护测试绿）；一条真任务 fan-in 后从详情页可点开该日志。AC1-4 全勾。

## Touches

- plugin/scripts/worker-driver.ts（runMechanicalFanIn 步骤 trace 写入 + suite 日志落点 `.quay/` + outcome `mechanical_fan_in.fanInLog` 字段）
- plugin/test/worker-driver.test.mjs（AC1 trace 行 / 跨 relaunch 不覆盖测试）
- packages/quay/src/observation.ts（`WorkerOutcomeRecord` + parser 增 `mechanical_fan_in` / `fanInLog` 透传）
- packages/quay/src/serve-task.ts（Runs 区块渲染 mechanical_fan_in + view/download 链接）
- packages/quay/src/serve-sessions.ts（fan-in log view/download handler + 路径穿越防护，复用 handleSessionDownload 同款 UUID/白名单校验）
- packages/quay/src/serve-handlers.ts（/fan-in-log/<task>/<file> 路由分发接线）
- packages/quay/test/serve-handlers.test.mjs（AC2 渲染 + AC3 穿越防护测试）
- .gitignore（`.quay/fan-in-*.log`）
- tasks/gap-mech-fan-in-log-webui-visible-clickable.md（自身）

## Needs-Human

**执行 2026-08-29T01:48:39.196Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
