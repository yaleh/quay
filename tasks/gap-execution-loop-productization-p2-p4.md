---
id: gap-execution-loop-productization-p2-p4
title: 执行环产品化 P2–P4——runMechanicalFanIn→quay task fan-in + workflow 兜底降级 + suite/dispatch 产品化
status: todo
labels:
  - gap
  - productization
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-adr034-fan-in-lock-holder-supervised
---
**type:** execution

## Proposal

落实 `orchestration/SPEC-execution-loop-productization-2026-08-28.md`（人 2026-08-28 裁定，142201b0e 已入 develop）的 P2–P4。P1 = ADR-034（锁收进 driver），已立案 `gap-adr034-fan-in-lock-holder-supervised`。

**背景（SPEC §2 实测）**：fan-in 同一业务 3 套实现（机械 worker-driver / workflow 兜底 fan-in-execute.js 1072×2 双副本 / bash fan-in-ff-merge.sh 721 行），9 次 shell-out、6+ 文件、~5,150 行；锁协议分裂 4 文件；quay CLI/MCP 对执行环零参与（mcp-server 仅 373 行、quay run 只跑 gate）。目标：**一个业务过程一套实现**，落 packages/quay。

## ✅ 立案前提（SPEC §8）——已满足

`packages/quay` 是 **provider 无关的产品**，而 worker 派发（spawn Claude subagent、worktree 管理、套件）目前是实验层方法论。产品化执行环的前提是先把 **driver/fan-in 裁定为产品能力**（现有 `quay driver` + DRIVER_KINDS registry 已站产品位置），而非实验特有逻辑。

**⛔ 此前提已由人裁定满足（2026-08-28，逐字）**：「driver/fan-in 是产品能力」「*-driver 均属于产品交付范围」——P2–P4 不再被「产品能力未裁定」阻塞。P1（ADR-034）不依赖此裁定（纯锁机制，已在 driver 内）。

## Plan

| 阶段 | 内容 | 判据（能取假） |
|---|---|---|
| **P2** | `runMechanicalFanIn` 产品化为 `quay task fan-in` CLI verb + MCP 工具，吸收 fan-in-ff-merge.sh 的锁/clean-tree/escalation/ff 业务，删 fan-in-ff-merge.sh | 一次真实 fan-in 经新 verb 落地；旧 .sh 删除后无引用 |
| **P3** | workflow 兜底降级为 `--semantic-fallback` 纯调用；删 fan-in-execute.js 双副本 | 机械失败时语义兜底仍生效；双副本删净 |
| **P4** | suite 入口收进 TS（full-suite-runner.ts 已是 TS）；dispatch 侧（ready-pool-check/slot-refill）产品化 | 全量 suite 不回归；派发计算单一真相源 |

**贯穿判据**：每阶段业务行为不变（全量 suite 绿 + 一次真实 fan-in 落地）+ 执行环文件净减少（SPEC §1 净减少判据延伸）。

## Acceptance Criteria

- [ ] AC1（P2 能取假）：一次真实 fan-in 经 `quay task fan-in` verb 落地，fan-in-ff-merge.sh 删除后零引用；**吸收含 L1 token 闸语义**（`--workflow-lock-token` 校验随 ff-merge.sh 一并产品化，非机械路径仍 fail-closed；⛔ 仍经旧 .sh / 有引用 ⇒ 假；⛔ token 闸语义随 .sh 删除丢失 ⇒ 假）。
- [ ] AC2（P3 能取假）：机械失败时语义兜底仍生效，fan-in-execute.js 双副本删净（⛔ 兜底断 / 副本残留 ⇒ 假）。
- [ ] AC3（P4 能取假）：全量 suite 不回归，派发计算单一真相源（⛔ 回归 / 多真相源 ⇒ 假）。
- [ ] AC4（贯穿，能取假）：执行环文件净减少，3 实现 → 1（⛔ 仍 3 套实现 ⇒ 假）。
- [ ] AC5（SPEC §5 量化，能取假）：一次真实 fan-in 从 9 次 shell-out → ≤1 次 verb 调用（⛔ 仍多次 mechSh ⇒ 假）；执行核 bash 业务面从 ~2,550 行 → 近 0（仅薄转发；⛔ 业务面仍存 ⇒ 假）；capability-catalog 注册数随删减下降（⛔ 不降反升 ⇒ 假）。

## Definition of Done

P2–P4 落地；AC1-AC5 全勾；执行环 3 实现 → 1、bash 业务面 ~2,550 行 → 近 0、一次 fan-in 9 次 shell-out → 1 verb、锁逻辑单点。（SPEC §8 产品能力前提已由人 2026-08-28 裁定满足。）

## Touches

- packages/quay/src/（runMechanicalFanIn 产品化为 quay task fan-in verb + MCP 工具）
- packages/quay/bin/quay.ts（task fan-in verb 注册）
- plugin/scripts/worker-driver.ts（P2 调用新 verb；P4 dispatch 侧产品化衔接）
- plugin/scripts/fan-in-ff-merge.sh（P2 删除）
- plugin/workflows/fan-in-execute.js（P3 删除双副本之一）
- .claude/workflows/fan-in-execute.js（P3 删除双副本之二）
- plugin/scripts/ready-pool-check.ts（P4 产品化）
- plugin/scripts/slot-refill.ts（P4 产品化）
- tasks/gap-execution-loop-productization-p2-p4.md（自身）
