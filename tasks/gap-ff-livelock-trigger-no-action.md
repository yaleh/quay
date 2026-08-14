---
id: gap-ff-livelock-trigger-no-action
title: SPEC §7 ff-livelock 触发器（≥3 ff 失败）首次真数据 fire 但「触发后该做什么」未定义——ac63 4 条 retry 竞速 develop 结构性撞（develop ~100s vs suite ~15min）
status: ready
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

- [ ] AC1 判据1：≥3 ff 失败 ⇒ 升级请求 quiet 窗口 + 停止竞速（机械动作）。
- [ ] AC2 判据2 能取假：ac63 4 条 retry（11:55/12:39/12:42/13:58）回放触发。
- [ ] AC3 判据3：与旧 integration livelock 任务区分（develop fan-in 面）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] ff-livelock 触发器有机械动作（≥3 ⇒ 请求 quiet 窗口 + 停止竞速）+ ac63 4 条真样本回放触发。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（≥3 ff 失败触发动作：升级 + 请求 quiet 窗口 + 停止自动重试）
- plugin/scripts/fan-in-workflow-check.ts 或相关（判据2 检查更新）
- plugin/test/（补测：4 条真样本回放触发）
- tasks/gap-ff-livelock-trigger-no-action.md（自身）

## Evidence

（落地后回填）
