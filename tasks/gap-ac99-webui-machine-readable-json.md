---
id: gap-ac99-webui-machine-readable-json
title: "AC99: Manager/System 两屏的前置是机读接口不是 UI——每字段追到稳定 JSON 机件（顺序约束保留）"
status: ready
labels:
  - gap
  - mechanism
  - priority:p1
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

- [x] AC1: Manager/System 两屏消费的每一字段追到一个产出稳定 JSON 的机件（resource-gate.sh --json /
      process-budget.sh --json / slot-refill --json（pool/floor/deficit/cap，新增 deficit 透出）/
      loop-driver-check.sh --json / session-liveness.sh --once --json）。`packages/quay/src/observation.ts`
      的 readSystem/readManager 已全部改为消费这些 JSON；`serve-handlers.ts` 的 /system /manager 渲染
      数据源标注更新为 `--json`。
- [x] AC2: 至少一条 AC 级判据读其**生产载体**而非 fixture（硬规则④推论三）——
      `plugin/test/resource-gate.test.mjs` 的 AC99 用例直接运行真实 `resource-gate.sh --json` /
      `process-budget.sh --json`（断言 load_threshold == nproc×load_over_factor 与 WAIT 退出码）；
      `plugin/test/loop-driver-check.test.mjs` 与 `serve-ac95-views.test.mjs` 同样跑真实脚本。
- [x] AC3: `loadavg` 阈值由 `resource-gate.sh` 内部按 `nproc × load_over_factor` 计算并以
      `load_threshold`/`load_over_factor` 字段输出；`serve-handlers.ts` /system 渲染读该字段
      （`rg.loadThreshold`），不再在 UI 侧写死 nproc×2。

## Definition of Done

- [x] 机读 JSON 接口就位，Manager/System 两屏每字段有稳定 JSON 来源，判据读生产载体。
      取假：`--json` 输出为合法 JSON；无 `--json` 时文本输出字节级不变（cap-from-gate.ts 等旧消费者不受影响）。

## Touches

- plugin/scripts/slot-refill.ts（`--json` 已存在，补 `deficit` 透出）
- plugin/scripts/loop-driver-check.sh（补 `--json` 面）
- plugin/scripts/session-liveness.sh（补 `--once --json` 面）
- plugin/scripts/resource-gate.sh（补 `--json` 面）
- plugin/scripts/process-budget.sh（补 `--json` 面）
- packages/quay/src/serve-handlers.ts（Manager/System 路由消费 JSON）
- packages/quay/src/observation.ts（readSystem/readManager 消费 JSON；parse 函数改 JSON 解析）
- packages/quay/test/serve-ac95-views.test.mjs（parse 函数单测改 JSON + AC99 生产载体用例）
- plugin/test/resource-gate.test.mjs（AC99 --json 生产载体用例）
- plugin/test/loop-driver-check.test.mjs（AC99 --json 用例）
- tasks/gap-ac99-webui-machine-readable-json.md（自身）
