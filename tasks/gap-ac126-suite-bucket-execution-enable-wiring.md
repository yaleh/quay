---
id: gap-ac126-suite-bucket-execution-enable-wiring
title: AC126 分桶执行的【生产启用】——fan-in suite 路径真正传 --buckets 且带桶轮次落 verification-round
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac124-suite-bucket-production-carrier-benefit
---

**type:** execution

## Proposal

**来源**：人 2026-08-22 00:2xZ 明令「更新阶段目标补此要求，继续推动落地」+ manager AC126（commit c1c5524d）。manager 实测核实的范围缺口：AC124 只把 `--buckets` 开关装在 `scripts/test.sh`/`full-suite-runner.ts` 两层（机制层），**没装到「谁按下开关」这一层**。

**证据（能取假，manager 实测我复验一致）**：`.claude/workflows/fan-in-execute.js` **零处引用 buckets**，其 `SUITE_LAUNCH`（:176）仍 `setsid bash scripts/test.sh`（全量、无 `--buckets`）⇒ 生产 suite 路径从不传 `--buckets`，AC124 的「生产载体 ≥10 轮带桶字段」在启用接线前**结构上不可满足**（不是「等数据」能等出来的）。

**判据**：分桶执行的「启用」= 生产 suite 路径真正传 `--buckets <task-id>`（fan-in 的 SUITE_LAUNCH/ISOLATE_LAUNCH，或其路由到的 full-suite-runner 入口），任务触及单桶按桶跑子集，且带桶轮次写入 `.quay/verification-round.jsonl`（AC124 判据载体）。

**取假（可机械核）**：(a) `fan-in-execute.js` 存在 `--buckets` 引用且 suite 启动命令串含 `--buckets`；(b) 回放一个 M-only 任务走 fan-in，其 verification-round 记录带 `buckets=M`；一个触枢纽任务带 `buckets=full`。任一不符 ⇒ 未达成。

**⛔ 连带缺口（inner 接线时一并处理，不得只跑子集不落账）**：fan-in 的 suite 直跑 `test.sh`、不经 `full-suite-runner.ts`，而 `verification-round.jsonl` **仅由 full-suite-runner.ts 写**（既有 gap-preverified-suite-bypasses-verification-round-ledger / gap-fan-in-realsuite-bypasses-verification-round-ledger）。启用接线须让带桶轮次真正落到 verification-round 载体，否则子集跑了账不进，AC124 仍不满足。

**为什么 inner 执行**：改 fan-in 工作流 + full-suite-runner 路由属产品/工作流代码 → inner 域。

## Plan

1. 把 `--buckets <task-id>` 接进 `.claude/workflows/fan-in-execute.js` 的 SUITE_LAUNCH/ISOLATE_LAUNCH（或路由到 full-suite-runner 入口），使任务触及单桶时按桶跑子集。
2. 让带桶轮次真正落到 `.quay/verification-round.jsonl`（经 full-suite-runner 路由，或补 fan-in 侧写 bucket 字段）——⛔ 不得只跑子集不落账。
3. 回放 M-only 任务 → verification-round 记录带 `buckets=M`；触枢纽任务 → `buckets=full`。
4. fan-in（AC78 workflow）land。

## Acceptance Criteria

- [ ] AC1: `fan-in-execute.js` 存在 `--buckets` 引用且 suite 启动命令串含 `--buckets <task-id>`（生产 suite 路径真正传）。
- [ ] AC2: M-only 任务回放 → verification-round 记录带 `buckets=M`；触枢纽任务 → `buckets=full`（带桶轮次落 verification-round 载体）。
- [ ] AC3: 连带缺口闭合——带桶轮次不因「直跑 test.sh 不经 full-suite-runner」而账不进 verification-round。

## Definition of Done

- [ ] 生产启用接线完成（fan-in 传 --buckets）+ 带桶轮次落 verification-round + 回放 M/full 通过；AC1-3 全勾；land 到 develop。

## Touches

- .claude/workflows/fan-in-execute.js（启用接线点：SUITE_LAUNCH/ISOLATE_LAUNCH 传 --buckets）
- plugin/scripts/full-suite-runner.ts（若涉路由/verification-round 写入）
- tasks/gap-ac126-suite-bucket-execution-enable-wiring.md（自身）
