---
id: gap-ff-livelock-trigger-no-action
title: SPEC §7 ff-livelock 触发器（≥3 ff 失败）首次真数据 fire 但「触发后该做什么」未定义——ac63 4 条 retry 竞速 develop 结构性撞（develop ~100s vs suite ~15min）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（ff-livelock 触发器真数据 fire 但无动作定义——2026-08-14 14:0xZ ac63 fan-in 实证）**。

**现象（SPEC §7 触发器首次真数据触发）**：ac63 4 条 ff 失败记录，各 vs 不同 develop head：
```
11:55:47 · 12:39:39 · 12:42:50 · 13:58:15  （acquire+release 各 4 对，锁协议本身工作）
```
**根因（结构性，非任务缺陷）**：develop 提交 cadence ~100s vs 全量 suite ~15min ⇒ **ff 几乎必然失败**（merge 时 develop 已前进）。任务门全绿（scoped 43/43 + ts-typecheck + doc）、全量 suite 在 settle develop 上 exit 0——**差的就是一次 quiet 窗口的 ff**。merge3 的红是确认的 load-dependent flake（select-preflight 60s 超时，isolated 5/5 过）。

**缺口**：SPEC §7 触发器（≥3 ff 失败 ⇒ 升级防活锁）**真数据 fire 了，但「触发后该做什么」未定义**——inner 升级上来，外层没有可执行的下一步（除手工协调 quiet 窗口外）。

**判据1**：**≥3 ff 失败 ⇒ 升级请求 quiet 窗口 + 停止竞速**——触发后动作机械定义（如：触发即请求 owner 层 hold develop N 分钟 / 标记该任务「等待 quiet 窗口」不再自动重试）。

**⭐ 解法样本（2026-08-14 首次实证，全有今天实测支撑非设计）**——ac63 的 quiet 窗口就是「触发后该做什么」的答案雏形：
```
SPEC §7 触发（≥3 ff 失败）⇒ 请求一个 quiet 窗口
  · 谁 hold：除 fan-in 执行者外的所有层
  · 判据：git log develop --since=<窗口起点> 为空（开窗即跑，非事后补——14:15 事后补的教训）
  · 结束条件：ff 成功即提前结束，不空耗（ac63 窗口 ~6min < 预定 20min）
  · 破窗处置：当场点名 + 告知 fan-in 执行者当前 head，由它决定 re-merge 还是等
    （ac63 实证：窗口被破一次，靠「外部观测 + 及时告知」救回来——inner 重新 re-merge f1795d2d→c8a9f9cc 后 ff 成功）
```
**判据2（能取假·真样本不构造）**：**ac63 的 4 条 retry（11:55/12:39/12:42/13:58）就是现成真样本**——回放它，判据1 必须触发「请求 quiet 窗口」动作；现状（只升级无动作）⇒ 红。
**判据3**：与既有 `gap-merge-green-snapshot-verified-commit-livelock`（integration 批量合时代）**区分**——本任务是 develop fan-in（AC78 workflow）面，不是旧 integration 面；若机制可复用绿快照思路（「ff 到绿快照验证过的 commit」）则引用，不重复造。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改 ff 协议本身（AC62 已定）；不解决 develop cadence（那是多层活跃度的正常形态，不是缺陷）；不引入锁超时（锁已正常）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 SPEC §7 ff-livelock 触发条款 + ac63 4 条 ff 失败记录（lock-events）。
2. 判据1：≥3 触发 ⇒ 请求 quiet 窗口 + 停止竞速（机械动作定义）。
3. 判据2 能取假：ac63 4 条 retry 回放触发动作；现状红。
4. 判据3：与旧 integration livelock 任务区分/复用。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：≥3 ff 失败 ⇒ 升级请求 quiet 窗口 + 停止竞速（机械动作）。
- [x] AC2 判据2 能取假：ac63 4 条 retry（11:55/12:39/12:42/13:58）回放触发。
- [x] AC3 判据3：与旧 integration livelock 任务区分（develop fan-in 面）。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] ff-livelock 触发器有机械动作（≥3 ⇒ 请求 quiet 窗口 + 停止竞速）+ ac63 4 条真样本回放触发。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（≥3 ff 失败触发动作：升级 + 请求 quiet 窗口 + 停止自动重试）
- plugin/scripts/fan-in-workflow-check.ts（判据2 检查更新：d-escalation-traceability）
- plugin/test/fan-in-ff-merge.test.mjs（补测：4 条真样本回放触发 + 触发动作）
- plugin/test/fan-in-workflow-check.test.mjs（补测：escalation traceability）
- tasks/gap-ff-livelock-trigger-no-action.md（自身）

## Evidence

**（2026-08-14 落地回填，runId fm-gap-ff-livelock-trigger-no-action-1786732967945-niq06e）**

**判据1 机械动作（AC1 / DoD）——`plugin/scripts/fan-in-ff-merge.sh` 触发后动作三件套**：
- **升级（escalate）**：attempt ≥ 3（同任务第 3 次及以后 ff 失败）时，写一条**独立升级记录**到 `.quay/fan-in-ff-escalations.jsonl`（`event:"ff-escalation"` + taskId/attempt/developHead/ts/runId/agentId/mergeTarget），并打印 `ANTI-LIVELOCK` 到 stderr。
- **请求 quiet 窗口（request quiet window）**：升级记录携带 SPEC §7 的 quiet-window 请求字段（`action:"request-quiet-window-and-stop-retry"` + `quietWindow:{requested:true, holder:"all-layers-except-fan-in-executor", criterion:"git log <mergeTarget> --since=<ts> empty", windowMinutes:20, endsEarly:"ff-success"}`）——ac63 窗口模式的机械化。其他层读该记录即可协调 develop-hold。
- **停止自动重试（stop automatic retry）**：**exit code 3**——与 exit 1（develop 前进可重试）和 exit 2（用法/环境）明确区分；守卫是 attempt 计数本身：一旦 ≥3，本次及之后每次调用都升级（exit 3），**永不回到 exit 1**（`no-auto-retry guard`，测试 `llock-b` 验证 attempt 4 仍 exit 3）。

**判据2 能取假（AC2）——ac63 4 条真样本回放触发**：
- `plugin/test/fan-in-ff-merge.test.mjs` 新增 `anti-livelock — ac63 4 real retry samples replay`：把 4 条真样本（11:55/12:39/12:42/13:58，verbatim from `.quay/fan-in-retries.jsonl`）作种子 retry 记录，再跑一次 ff 失败 ⇒ **exit 3 + 升级记录 attempt 5**。现状（只升级无动作）⇒ 红，已改。
- `anti-livelock — ac80 2 real retry samples replay`：AC80 缺口（2 次失败 + 4 次 develop 前进）——回放 2 条真样本再跑一次 ⇒ **第 3 次失败即升级（exit 3，attempt 3）**。
- attempt 1/2 保持 exit 1（≤2 失败路径不变，现有测试 `ff failure attempt increments` 与新增 `llock-a` 均断言 exit 1 + 无升级记录）。

**判据3 区分（AC3）**——机制全部落在 **develop fan-in 面**（`fan-in-ff-merge.sh` / AC78 fan-in-execute workflow），**未触碰旧 integration 批量合路径**（`integration-batch-merge.sh`，`gap-merge-green-snapshot-verified-commit-livelock` 的面）。不改 ff 协议本身（AC62 已定）、不解决 develop cadence、不引入锁超时。

**判据4 / 判据2 traceability（AC4）**：
- `plugin/scripts/fan-in-workflow-check.ts` 新增 `d-escalation-traceability`：升级路径也必须满足判据2 traceability——每个升级的任务必须有 Workflow(fan-in-execute) 调用（升级 = 未落地的 fan-in 尝试；无 workflow 调用的升级 = AC72/AC73 主线程直调缺陷）。`--escalations <file>`（默认 `.quay/fan-in-ff-escalations.jsonl`）。
- `--for-task` scoped 门：**exit 0**，72 tests / 0 fail（含新增 4+7=11 条）。ts-typecheck 门：**ADMITTED (exit 0)**（无新增/移动 .ts，Touches 收窄为具体文件）。

**既有测试全绿**：`fan-in-ff-merge.test.mjs` 16/16、`fan-in-workflow-check.test.mjs` 56/56 全绿，无回归（现有 exit 1/2 语义、lock-events 配对被保留）。
