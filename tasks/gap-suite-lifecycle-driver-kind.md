---
id: gap-suite-lifecycle-driver-kind
title: suite 生命周期收进一个常驻 driver kind——进程级父子 wait + 定时兜底静默检测，单飞锁回归纯资源限制器（SPEC §3，地基）
status: ready
labels:
  - gap
  - feature
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-suite-serial-lowconc-classification-recheck
---
**type:** execution

> **正本**：`orchestration/SPEC-suite-lifecycle-and-failure-semantics-2026-08-26.md` §3（人 2026-08-26 15:2xZ 划定范围，manager 落 SPEC，outer 立案）。**⛔ 边界**：lane 预算/S/oversub 一律不动（人逐字排除，SPEC §6）；凡出现 lane/S 是引用现状作约束。
> **前置**：`gap-suite-serial-lowconc-classification-recheck` 的 AC3（buckets 取锁）先落地——代码已写只差落地（worktree `scripts/test.sh:1414`），⛔ 不得重写。

## Proposal

**把 per-task suite 的「生命周期管理」收进一个常驻 driver（进程级父子关系 + 定时兜底），复用现成 `DRIVER_KINDS` 骨架（`driver-runtime.ts:108-174`），使单飞锁回归纯粹的资源限制器。**

**⊢ 为什么现有 detach 设计必须改**（SPEC §3.1，实测）：suite 必须 detach 于 subagent（Bash 600s 硬顶 + `run_in_background` 被 harness 连带杀），但**常驻 driver 不是 subagent**——可以直接 spawn 并 wait，拿回进程级父子关系。现有 per-task suite 由 `setsid + & + disown` 起在独立 session（`fan-in-execute.js:188-189`），**没有任何进程在 wait 它**，挂死检测只有辅、没有主。

**⊢ 实测代价（SPEC §1.1 泄漏③）**：ac143 挂死 33.7 分钟、lpt-lookback 挂死 199.5 分钟（3.32h），两次全靠人工发现 + 手动 kill；后者从 kill 到 worker 感知又隔 49 分钟。

**⊢ 建议形态（SPEC §3.3）**：
```
kind: "suite"（或并入既有 kind——落笔方据代码结构定）
职责：唯一 spawn per-task suite 的地方
  主（进程级，自动）：driver 直接 spawn suite 并 wait ⇒ 子进程退出立即得知，
                      三态可分：正常退出 / 非零退出 / 被信号杀
  辅（定时，兜底）：同循环顺带查「活着但无输出 ≥N 秒」⇒ 判静默挂死 ⇒ 杀 + 记可区分失败态
  资源集成：spawn 前取槽（经统一后的 full_suite_lock_acquire）、子进程终结后释放槽
           ⇒ 释放天然原子（SPEC §2(b)「让槽不让 lane」结构上不可能再发生）
carriers:    suite-round.jsonl（每轮一条，outcome 三态可分：done / red / hung）
```

**⊢ 四条结构性收益（非少写一个脚本）**：① 挂死检测从「没人做」变成「父进程本来就在 wait」；② 取/放槽同一执行点 ⇒ 半截动作结构上不可能；③ 复用五个运维动词 + supervisor respawn；④ 「谁保证看门狗活着」已有答案（`runSupervisor` respawn 循环已在监督 driver 自己）。

**⊢ 吸收 watchdog**：`gap-fan-in-per-task-suite-no-silence-timeout-watchdog` 的「静默超时看门狗」是本条「辅（定时兜底）」的结构性归宿——落笔方判断合并还是保留，⛔ 不要两条重复实现同一静默检测。

**⊢ 硬规则 3b**：`hung` 必须是与 `red`/`done` **可区分的独立取值**（挂死被杀后记成「红」或「没跑完」= 三成因压成一个值，正是 SPEC §1.1 泄漏②要修的病，不得在新机制里复发）。

## Plan

1. `DRIVER_KINDS` 加 kind（表加一行）+ 写该 driver 的 `.ts`——复用 `driver-runtime.ts` 的 respawn 循环与五个运维动词，⛔ 不新造接口。
2. driver 直接 spawn per-task suite + wait（进程级父子）；辅以定时兜底静默检测；spawn 前取槽、终结后释放槽。
3. carrier `suite-round.jsonl` 三态 outcome（done/red/hung）。

## Acceptance Criteria

- [ ] AC1（能取假，kind 落地复用骨架）：suite-driver kind 落地（DRIVER_KINDS 表加一行 + .ts），复用五个运维动词 + supervisor respawn，⛔ 不新造一套接口；（⛔ 另造接口/两份 respawn ⇒ 假）。
- [ ] AC2（能取假，进程级父子 + 三态）：driver 直接 spawn suite 并 wait，子进程退出立即得知；outcome 三态可分且 `hung` 是**可区分独立取值**（不与 red/done 同形）；（⛔ 仍 detach 无人 wait / hung 与红同形 ⇒ 假）。
- [ ] AC3（能取假，静默挂死自动检测）：活着但无输出 ≥N 秒 ⇒ 自动判挂死 → 杀 + 记 hung（不再 33.7min/199.5min 靠人工 kill）；（⛔ 仍靠人工发现 ⇒ 假）。
- [ ] AC4（能取假，取放槽同一执行点）：spawn 前取槽、终结后释放槽，取/放是**同一执行点**（释放原子，§2(b)「让槽不让 lane」结构上不可能再发生）；（⛔ 取放分离 ⇒ 假）。

## Definition of Done

suite-driver kind 落地；AC1-AC4 全勾；挂死自动检测、hung 三态可分、取放槽原子。

## Touches

- plugin/scripts/driver-runtime.ts（DRIVER_KINDS 加 suite kind）
- plugin/scripts/suite-driver.ts（新 driver：spawn suite + wait + 静默兜底 + 取放槽）
- .claude/workflows/fan-in-execute.js（per-task suite 生命周期改由 suite-driver 承接）
- plugin/workflows/fan-in-execute.js（dual-copy 同步）
- plugin/test/（suite-driver 三态 + 静默挂死 + 取放原子负控制）
- tasks/gap-suite-lifecycle-driver-kind.md（自身）
