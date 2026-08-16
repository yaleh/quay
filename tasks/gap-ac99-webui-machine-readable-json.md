---
id: gap-ac99-webui-machine-readable-json
title: "AC99: Manager/System 两屏的前置是机读接口不是 UI——每字段追到稳定 JSON 机件（顺序约束保留）"
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

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` AC99。

**为什么前置不能省**：审计 §2.4.2 实测——`pool`/`floor`/`deficit` 字段目前没有稳定 `--json` 输出接口；
这块工作大头在后端补机读输出，不在 Web UI。若先做 UI，唯一拿数办法 = 解析 manager 叙事日志，
**那必然违反 AC95②**（⛔ 不得解析 manager-tick-log / manager-phase-goal 取数）。顺序不是偏好。

**⊢ "排在最后"措辞作废**（人明令 15 视图全做），但前置约束不变且更要紧。

## Acceptance Criteria

- [ ] AC1: Manager/System 两屏消费的每一字段追到一个产出稳定 JSON 的机件（resource-gate.sh /
      process-budget.sh / slot-refill / loop-driver-check.sh / session-liveness.sh）。
- [ ] AC2: 至少一条 AC 级判据读其**生产载体**而非 fixture（硬规则④推论三）——关掉 fixture/注入 seam
      后判据仍能通过才算测量，否则是回声。
- [ ] AC3: `loadavg` 阈值必须读 `nproc` 计算，⛔ 不得写死本机算出的数字（硬规则④推论二：依赖宿主
      容量的字面值不是常量）。

## Definition of Done

- [ ] 机读 JSON 接口就位，Manager/System 两屏每字段有稳定 JSON 来源，判据读生产载体。

## Touches

- plugin/scripts/slot-refill.ts（若补 `--json` 稳定输出）
- plugin/scripts/loop-driver-check.sh / session-liveness.sh / resource-gate.sh / process-budget.sh（若补 JSON 面）
- packages/quay/src/serve-handlers.ts（Manager/System 路由消费 JSON）
- tasks/gap-ac99-webui-machine-readable-json.md（自身）
