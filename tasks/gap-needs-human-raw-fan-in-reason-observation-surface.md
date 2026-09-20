---
id: gap-needs-human-raw-fan-in-reason-observation-surface
title: 人类观测面读得到 fan-in 失败的原文——web(/needs-human、Runs 块)、CLI、MCP 共用 observation.ts
  单一读取器，原文只展示不解释
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref -->相关已完成任务（仅追溯）：gap-ac146-human-interface-explicit-owner（/needs-human 页）、gap-webui-task-runs-block（Runs 块）。

**问题（直接量）**：driver 每次尝试都把 `mechanical_fan_in {step, reason, ...}` 写进 `.quay/worker-outcome.jsonl`（2295 条、978 条带该结构），但人类观测面只有 web `/task/<id>` 的 Runs 块读它（`packages/quay/src/serve-task.ts:537`，经 `observation.ts`）。CLI、MCP 没有读 outcome 的入口；`/needs-human` 页只显示任务体里的「阻碍原因」。一个外部项目里 3 个任务因同一原因被打成 needs-human，人无法从 CLI/MCP/web 一处看到「每次尝试到底败在哪一步、原文是什么」。

**人的裁定（2026-09-20，逐字）**：「driver 当然应当记录相应的日志，人类观测面（如 quay cli/mcp/web）也应提供这些日志的访问。」及：needs-human 的原因是异常，枚举靠不住——所以本任务只**展示原文**，不做分类、不做解释。

**做法**：① `packages/quay/src/observation.ts` 增加**一个**读取器（如 `readFanInAttempts(root, {taskId?, limit?})`），返回每次尝试的 `{ts, task, run_id, final_state, step, reason(原文，未截断到 UI 之前), suiteLog, fanInLog}`；它是 web/CLI/MCP 的唯一数据来源，⛔ 三处不各写解析。② web：`/needs-human` 每行加「最近失败原文」（HTML 转义），Runs 块沿用同一读取器；文案走 `serve-i18n.ts` 的 zh/en。③ CLI：`quay driver log --kind worker [--task <id>] [--limit N] [--json]`（`packages/quay/src/cli/driver.ts` 增加 `log` verb）。④ MCP：`packages/quay/src/mcp-server.ts` 增加只读工具 `driver_log`，参数同 CLI。

## 实施记录（worker，2026-09-20）

- `readFanInAttempts` 落地为 `FanInAttempt extends WorkerOutcomeRecord` 的**超集**投影（+ 提升的 `outcome/step/reason/suiteLog/fanInLog`），所以 `/task/<id>` 的 Runs 块换用同一读取器后仍拿得到它原来渲染的每个字段（`renderFanInCell` 不变、serve-dashboard 不动）。`parseWorkerOutcomeRecordsDetailed` 补上行级计数，旧的 `parseWorkerOutcomeRecords` 改为委托它（⛔ 一个解析器两种视图）。
- 三态 `status`：`ok | carrier-absent | carrier-unreadable | malformed-lines`（硬规则 3b）。`carrier-unreadable` 带底层错误原因；**不是** fail-closed 到「空列表」。
- `MechanicalFanInRecord.suiteLog`：盘上一直有（driver-filters.test.mjs 的 fixture 就带它），此前无人解析——本次补上。
- `/needs-human` 的「最近失败原文」列**同时挂在 ledger 行**：该列真正要服务的正是「已被晋升、状态已流转走」的任务（活跃表已不再列它），而本仓库当下正是 0 个活跃 needs-human + 23 条真实 ledger 样本——只挂活跃行会**结构性地**看不见问题陈述点名的那个场景。
- CLI `log` 在委派 kernel **之前**截住（只读：不起 supervisor、不碰控制态）；`VERBS` 增加 `log` 因此落 `cli/driver-vocab.ts`（该文件的头注释规定它是 verb 词表的唯一真源），**故 Touches 补一条**。`quay driver --help` 由 `cli/help.ts` 的另一份副本渲染，其 usage 行经 `${VERBS.join("|")}` 自动带出 `log`；该文件的逐 verb 说明副本**已先于本任务漂移**（缺 `--reconcile-interval`），不在本任务范围内改。

## AC

- [x] 单一读取器：`grep -n "worker-outcome" packages/quay/src/*.ts packages/quay/src/cli/*.ts | grep -v "\.test\."` 只在 `observation.ts` 出现解析逻辑（打印前 3 条命中，确认不是注释误命中；谓词对已知为真样本干跑一次）。
- [x] `node --test packages/quay/test/observation.test.mjs` exit 0：读取器对含 `mechanical_fan_in` 的 fixture 返回 step 与 reason 原文；对**缺失/损坏行**返回可区分的「读不出」而不是伪装成空列表（硬规则 3b）。
- [x] `node --test packages/quay/test/serve-needs-human.test.mjs` exit 0：真实 workspace fixture 里一个 needs-human 任务对应的 outcome 原文出现在 `/needs-human` 页；负控制：reason 含 `<script>` 时页面输出为转义文本。
- [x] CLI 与 MCP：`node --experimental-strip-types packages/quay/bin/quay.ts driver log --kind worker --task <id> --json` 与 MCP `driver_log` 对同一 fixture 返回**逐字段相同**的记录（同一 deepEqual 断言，证明共用读取器）；`node --test packages/quay/test/mcp-server.test.mjs` exit 0。
- [x] `scripts/test.sh --for-task gap-needs-human-raw-fan-in-reason-observation-surface` exit 0。

## DoD

用本仓库真实的 `.quay/worker-outcome.jsonl`（2295 行）经 web `/needs-human`、CLI `driver log`、MCP `driver_log` 三条面各取同一个真实任务的失败记录，三处读数逐字相同（贴出三处输出）；展示的是原文，无任何分类标签。

**已达成（2026-09-20）**：真实任务 `gap-scoped-gate-lpt-order`、真实载体 2297 行（md5 `0e523b0c…`，与主检出逐字节相同）：

- CLI：`driver log --kind worker --task gap-scoped-gate-lpt-order --limit 1 --json` ⇒ `step="ac-gate"`，`reason="fan-in-ac-completion-gate: AC 未全勾（checked 0/3，剩余未勾 3 含非待外部项）——未翻 done\nfan-in-ac-completion-gate: FAIL (exit 1) — flip refused"`。
- MCP：`driver_log{kind:"worker", task:"gap-scoped-gate-lpt-order", limit:1}` ⇒ 与 CLI `--json` **逐字段相同**（逐字段 deepEqual 为 True，reason 逐字节相同）。
- web `/needs-human`（ledger 行）⇒ 同一 `reason` 原文（HTML 转义后）出现在该行。
- 展示的只有原文：无 cause 分类、无标签、无解释。

## Touches

- packages/quay/src/observation.ts
- packages/quay/src/serve-needs-human.ts
- packages/quay/src/serve-task.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/src/cli/driver.ts
- packages/quay/src/cli/driver-vocab.ts
- packages/quay/src/mcp-server.ts
- packages/quay/test/observation.test.mjs
- packages/quay/test/serve-needs-human.test.mjs
- packages/quay/test/mcp-server.test.mjs
- tasks/gap-needs-human-raw-fan-in-reason-observation-surface.md
