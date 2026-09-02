---
id: gap-continue-prompt-delta-relatedness-note
title: 续做 prompt 缺"这次 suite 失败与本任务改动是否相关"的机械信号——加两条结构性提示（delta 相关性 + 既有
  load-sensitive 注册表），不做自动跳过判断
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`worker-driver.ts` 的续做 prompt（`buildContinueWorkerPrompt`，`:1187`）已经给下一个 worker 会话带了不少上下文——前 N 次尝试的 `(ts, step, reason)` 清单（`continueAttemptsNote`，`:1155`）、最近一次 suite 红的日志绝对路径（`continueSuiteLogNote`，`:1172`）、以及一条硬编码规则（ff-not-fast-forward 时告诉 worker "这是分支落后不是代码缺陷，不要重新实现"）。**唯独缺"这次 suite 失败的测试，和本任务的改动到底有没有关系"这一条信号**——目前 worker 每次续做都要从零开始判断"这次红是不是我的问题"，实测（过去24h活跃期分析）这类会话的墙钟（10-13分钟）远超 suite 步骤本身（~5分钟），多出的部分主要花在这个诊断上。

**⛔ 边界（不做什么）**：不做"自动判定为噪声并跳过诊断/自动重跑"。`gap-load-sensitive-requires-predeclared-marker`（done，人 2026-08-08 裁定）明确禁止"用一次隔离/重跑结果反推这是环境噪声"——因为这种事后证据分不清"环境噪声"和"只在并发下才暴露的真 bug"。本任务只产出**结构性提示（context）**，不产出"跳过"这类判断动作；下一个 worker 仍要自己验证，提示只是让它从一个有依据的假设出发，而不是从零开始读 diff/查依赖。

**也不复活 `gap-fan-in-failure-semantic-subagent`**（superseded，2026-08-27）那套"每次失败唤起语义 agent 判断 outcome_class"的设计——同一批 SPEC 里 `ff-race-loss` 分类就是"为0发生率保留昂贵语义判断路径"的反面教材，被明确砍掉。本任务的两条信号都是**纯结构性计算，不调 LLM**，成本接近零，不重蹈覆辙。

## Plan

新增两条机械信号，拼进续做 prompt 一个新的 `continueRelatednessNote()` 函数（放在 `continueSuiteLogNote` 旁边，同样只在 suite 红时触发）：

1. **信号1：delta 相关性**（结构性、复用既有基础设施）——失败测试文件本身是否在本任务的 `## Touches`/实际 diff 里；不在的话，再查一跳导入关系（失败测试直接 import 的源文件）是否与本任务改动文件相交。复用 `select-static-checks-for-touches.ts` 已有的 delta-classify 逻辑或 archguard MCP 的 `get_dependents`/`get_dependencies`，不新造依赖图分析。
2. **信号2：既有 load-sensitive 注册表命中**（复用既有裁决，不新造分类）——失败测试文件是否已经被 `@load-sensitive` 标注 / 落在 `scripts/test.sh` 的 lowconc/serial 分道注册表里（`gap-load-sensitive-requires-predeclared-marker` 建立的机制）。这是一条**事前就存在、独立于本次失败**的证据，不违反"不能事后反推"的裁定。
3. 两条信号的输出措辞明确标注"这不是结论，是提示，请重跑验证"（措辞需体现，不是自动跳过），格式类似：
   ```
   delta-relatedness check (mechanical, not a verdict): the failing test
   (<path>) is NOT in this task's Touches/diff, and does not import any
   file this task's delta touches (one-hop check). It IS registered as
   @load-sensitive. This does not prove the failure is unrelated — verify
   by re-running the suite once before assuming it is; if it reproduces,
   treat it as a real finding regardless of this note.
   ```
4. 两条信号任一"读不懂"（Touches 解析失败、依赖图查询失败、注册表读取失败）⇒ 该条信号在提示里显式标"unknown/unable to determine"，不得与"无关"同形（硬规则 3b）。

**依赖标注（信号3，本任务不做）**：`gap-fan-in-suite-log-same-runid-overwrite`（todo/ready）落地后，同一 runId 内每次 attempt 的 suite 日志不再互相覆盖，届时可以低成本追加"同一 runId 连续几次失败的是不是同一个测试"这条第三信号（同一测试反复出现 → 更像真缺陷/稳定复现的 flaky；每次不同 → 更像负载噪声）。本任务的两条信号函数应预留可扩展的输出结构（如返回一个信号列表而非单一字符串），避免信号3落地时需要重写整个 note 函数。

## Acceptance Criteria

- [ ] AC1（能取假，信号1 命中判断可区分）：对一个"失败测试文件在本任务 Touches 内"的样本，信号1 判定为"相关"；对一个"失败测试文件不在 Touches 且一跳导入不相交"的样本（如 `gap-dashboard-taskcard-multistatus-minitable` 撞见的 `observation.test.mjs` 案例），信号1 判定为"无关"；两个判断能互相区分（⛔ 恒定输出同一结论 ⇒ 假）。
- [ ] AC2（能取假，信号2 命中真实注册表）：对一个已 `@load-sensitive` 标注的测试文件，信号2 命中；对一个未标注的测试文件，信号2 不命中（⛔ 恒真或恒假 ⇒ 假）。
- [ ] AC3（能取假，读不懂有独立取值）：Touches 解析失败 / 依赖查询失败 / 注册表读取失败时，对应信号输出 "unknown"，不与"无关"或"相关"的正常结论共用同一措辞（⛔ 读不懂时输出与"无关"外观相同的文本 ⇒ 假）。
- [ ] AC4（能取假，措辞不构成自动放行）：两条信号的输出文本明确包含"这不是结论/请重跑验证"一类表述，⛔ 不得出现"可以跳过""无需检查"这类会被误读为自动放行的措辞（人工读文本核对）。
- [ ] AC5（能取假，接入续做 prompt）：`buildContinueWorkerPrompt` 在 suite 红时实际拼入 `continueRelatednessNote()` 的输出（⛔ 函数写了但没接入调用点 ⇒ 假）。
- [ ] AC6（能取假，真实回放）：用一个真实发生过的案例（`gap-dashboard-taskcard-multistatus-minitable` 的 `wk-prod-1788275557`/`wk-prod-1788280091`，失败测试 `observation.test.mjs` AC1 性能断言）回放，验证信号1 正确判定为"无关"、信号2 正确命中 `@load-sensitive`（若该测试确已标注；若未标注则验证信号2 正确输出"未标注"而非误判）；（⛔ 只在合成 fixture 上验证 ⇒ 假，同硬规则3b）。

## Definition of Done

`continueRelatednessNote()` 落地并接入 `buildContinueWorkerPrompt`；AC1-AC6 全勾；两条信号均为纯结构性计算（无 LLM 调用）；读不懂有独立于"无关"的取值；用真实发生过的案例回放验证过。

## Touches

- plugin/scripts/worker-driver.ts（新增 `continueRelatednessNote()`，接入 `buildContinueWorkerPrompt` 调用点，`:1172` `continueSuiteLogNote` 附近）
- plugin/scripts/select-static-checks-for-touches.ts（复用其 delta-classify / 依赖判定逻辑，若需要导出新接口）
- plugin/test/worker-driver.test.mjs（信号1/信号2 命中与不命中、读不懂独立取值、真实案例回放测试）
- tasks/gap-continue-prompt-delta-relatedness-note.md（自身）
