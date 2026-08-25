---
id: gap-worker-prompt-fan-in-call-signature-placeholder
title: worker prompt 给 fan-in 调用签名是字面占位词（scriptPath/runId）⇒ 每个 worker 反向工程一遍（n=12 全命中）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`buildWorkerPrompt`（`plugin/scripts/worker-driver.ts:781`）给 worker 的 fan-in 调用签名是：
```
(4) ff-merge to develop via the fan-in-execute workflow
    (scriptPath, args={task,worktree,root,runId,mergeTarget}).
```
`${task}`/`${root}` 插值了，**但 `scriptPath` 是字面占位词、不是真实路径**；`runId` 也只给键名、没给取法（`generateRunId` 在 `plugin/scripts/fast-mode-telemetry.ts:628`）。`buildContinueWorkerPrompt`（续做路径）同样没有。⇒ 每个 worker 从源码反向工程一遍完整调用签名，零判断成分。

**实测（12 个有 session_id 的 worker session、853 工具调用，逐条分类+打印命中样本核谓词）**：
```
签名                            命中 session   总调用数
读 fan-in-execute.js                12/12          113
找 workflow 路径                    11/12           98
重新发现 generateRunId              12/12           26
—— 对照（上一条已立案的 provisioning）——
ln -s node_modules                   4/12            5
cp .quay/config.yml                  1/12            1
```
原始命令抽样：`find . -name 'fan-in-execute*'` / `grep -n 'args\.' .claude/workflows/fan-in-execute.js` / `diff -q .claude/workflows/fan-in-execute.js plugin/workflows/fan-in-execute.js` / `node -e 'import { generateRunId } from "./plugin/scripts/fast-mode-telemetry.ts"...'`。

**`diff` 那条尤其说明问题**：`.claude/workflows/fan-in-execute.js` 与 `plugin/workflows/fan-in-execute.js` 两份拷贝（现逐字节一致，另有 `workflows-dual-copy-drift-check.test.mjs` 守漂移），prompt 不说该调哪份 ⇒ worker 自己 diff 确认。**重派会重复支付**：split-long 派发 3 次全 exited-not-landed，每次从零反向工程一遍。

## Plan

`buildWorkerPrompt` + `buildContinueWorkerPrompt` 的 fan-in 段改写为**真实绝对路径 + runId 取法 + 正本拷贝**：
- `scriptPath` 占位词 → 真实绝对路径（`<root>/.claude/workflows/fan-in-execute.js`，与 Workflow 调用的 scriptPath 约定一致——实现时先核 `.claude/workflows/` vs `plugin/workflows/` 哪份是正本，manager 未判定、`diff` 现逐字节一致）；
- `runId` 键名 → 取法（`generateRunId` 从 `plugin/scripts/fast-mode-telemetry.ts` 导入，或调用方生成传入）；
- 明确该调哪一份拷贝（消除 `diff` 那步的成因）。
⛔ 实现时一并检查 prompt 里是否还有别的字段同样是占位词（manager 未穷举）。

## Acceptance Criteria

- [x] AC1（能取假，签名完整）：`buildWorkerPrompt` 与 `buildContinueWorkerPrompt` 的 prompt 文本含 fan-in workflow 的**真实绝对路径**（⛔ 非 `scriptPath` 字面词）+ `runId` 取法（哪个模块导出 `generateRunId`）；（⛔ 仍是占位词 ⇒ 假）。
- [ ] AC2（能取假，负控制）：新派发 worker 的 transcript 不再出现 `find . -name 'fan-in-execute*'`、`grep generateRunId`、`diff .claude/workflows/... plugin/workflows/...` 这三类调用（现在 12/12 必然出现）；（⛔ 仍出现 ⇒ 假）。（待外部）
- [x] AC3（能取假，正本明确）：prompt 明确该调哪一份拷贝（`.claude/workflows/` vs `plugin/workflows/`）；（⛔ 仍含糊 ⇒ 假）。

## Definition of Done

`buildWorkerPrompt` + `buildContinueWorkerPrompt` 的 fan-in 段落地真实签名（绝对路径 + runId 取法 + 正本拷贝）；AC1/AC2/AC3 全勾；真机派发一个任务，worker transcript 无 `find . -name 'fan-in-execute*'`/`grep generateRunId`/`diff .claude/workflows...` 三类反向工程调用。

## Touches

- plugin/scripts/worker-driver.ts（buildWorkerPrompt / buildContinueWorkerPrompt 签名改写）
- plugin/test/worker-driver.test.mjs（prompt 文本断言：含绝对路径、不含 scriptPath 字面词）
- tasks/gap-worker-prompt-fan-in-call-signature-placeholder.md（自身）
