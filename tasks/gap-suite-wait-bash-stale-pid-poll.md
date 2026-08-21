---
id: gap-suite-wait-bash-stale-pid-poll
title: SUITE_WAIT_BASH poller 死进程空转：纯 .exit 文件检查不核验 suite_pid（阻塞全部 fan-in，硬规则 4）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：manager 2026-08-21 05:4xZ 一手实测（全部直接核实，非 inner 自述）——SUITE_WAIT_BASH poller 对已死进程无限重试轮询，阻塞全部 6 个在飞任务。

**现象**（I5 修复 fan-in，head=8fa71de3，05:20 启动）：
1. `/tmp/fan-in-suite-<task>.log` 末行「== single-flight lock ==」冻结 05:21:04，18+ 分钟零写入
2. `.env` 记录 suite_pid=1868541 已死（ps 空）
3. `.git/full-suite.lock.0` 无持有者（fuser 空）
4. 活跃 poller（timeout 540 while 循环）只查 `.exit` 文件，不核验 suite_pid 存活
5. poller lstart 05:39:08（新）——第 N 轮 540s 超时后重新发起，已空转至少 2 整轮

**根因**（硬规则 4 实例）：`plugin/workflows/fan-in-execute.js:312` `while [ ! -f "$1" ]; do sleep; done` 纯文件存在性检查——detached suite（:169 setsid + disown）若在写 .exit 前静默死亡（信号/OOM/异常），poller 在结构上无法证伪「进程还在跑」的假设下无限重试。**`.exit` 文件不存在 ≠ 进程还在跑**，当前谓词把两者等同。

**⛔ 代价**：阻塞全部在飞 fan-in（每次 suite 死进程 → poller 空转至 540s 超时 → 重派新 poller 继续空转）。外层已止损（kill 空转 poller + 锁空立即重派）。

**为什么 inner 执行**：fan-in-execute.js 属 plugin/workflows/ 产品实现 → inner 域。

## Plan

1. poller 每次 sleep 间隔内 `kill -0 $suite_pid` 核验 suite 进程存活（从 `.env` 读 suite_pid）。
2. suite 进程死亡且 .exit 未写 ⇒ 视为该轮失败，写可区分失败态（如 `SUITE_PID_DEAD`），交回 fan-in-execute 主循环立即决策重派（非耗尽 540s）。
3. 验证：真实 suite 进程静默死亡场景下 poller 快速识别 + 重派（生产载体）。

## Acceptance Criteria

- [x] AC1: poller 每次 sleep 间隔核验 `kill -0 $suite_pid`（从 .env 读 pid），不纯靠 .exit 文件存在性。
- [x] AC2: suite 进程死亡且 .exit 未写 ⇒ 写可区分失败态（`SUITE_PID_DEAD`）交回主循环，不耗尽 540s 空转。
- [x] AC3: 负控制落在生产载体——真实 suite 进程静默死亡场景，poller 快速识别并重派（读真实 fan-in 结果，非 fixture）。
- [x] AC4: 全量 suite 绿。

## Definition of Done

- [x] poller 核验 suite_pid 存活（kill -0）；进程死亡快速失败 + 重派（读真实输出）；不再空转 540s。

## Touches

- plugin/workflows/fan-in-execute.js（SUITE_WAIT_BASH poller 谓词）
- .claude/workflows/fan-in-execute.js（双拷贝同步）
- plugin/test/fan-in-execute-paths.test.mjs（poller 谓词负控制）
- tasks/gap-suite-wait-bash-stale-pid-poll.md（自身）
