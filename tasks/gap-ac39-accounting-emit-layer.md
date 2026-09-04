---
id: gap-ac39-accounting-emit-layer
title: "AC39: 三层 accounting-emit 按层定制（layer→mechanisms 映射表，occupancy.in_flight 跨层共性）"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**AC39（manager 034125 实测）**：三层 accounting-emit 全 `complete=False`，manager 侧是 2026-08-10 就发现的老缺陷。

**三层缺项**：
```
manager: complete=False  missing=[mechanism:cap-from-gate.last_run_epoch,
                                  mechanism:slot-refill.last_run_epoch,
                                  occupancy.in_flight]
outer:   complete=False  missing=[mechanism:closure-lag-check.judgement, occupancy.in_flight]
inner:   complete=False  missing=[ready-pool-check --apply, slot-refill,
                                  fast-mode-telemetry --task-start, exec_time_unreadable,
                                  occupancy.in_flight]
```

**根因**：默认装的 mechanisms 是 `cap-from-gate`/`slot-refill`，**那是 inner 的机制**——layer→mechanisms 映射没定制。

**三层共同缺 `occupancy.in_flight`** ⇒ 跨层共性缺口，不是三个独立问题。

**修法（outer 裁定）**：layer→mechanisms 映射表（每层 emit 自己的机制读数），occupancy.in_flight 三层统一补。AC39 一修 AC40② 转正。

**实现归 inner。**

**验证锚**：修后 (a) 三层 accounting-emit 全 complete=True；(b) occupancy.in_flight 三层在场；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录三层缺项（manager cap-from-gate/slot-refill 是 inner 的机制 + occupancy.in_flight 跨层缺）（本任务 Proposal 已含；修前实测复现：manager `missing=[cap-from-gate.last_run_epoch, slot-refill.last_run_epoch]`，内层 4 机制 never-run，occupancy.in_flight 在无 config 工作区缺）
- [x] AC2: **layer→mechanisms 映射表**——每层 emit 自己的机制读数（cap-from-gate/slot-refill 归 inner，closure-lag-check 归 outer）
- [x] AC3: **occupancy.in_flight 三层统一**——三层 accounting-emit 都含 in_flight
- [x] AC4: **AC40② 转正**——AC40② 随 AC39 修复转正（manager/outer 裸跑 complete=True，inner 以其真实调用 complete=True；AC40② 的转正记录在 manager-phase-goal.md，不在 Touches，留外层）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿（初跑被 inventory drift gate 阻断，inner 重生成 DELIVERY-INVENTORY 后 **91/91 绿**，见 Evidence）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：三层 accounting-emit complete=True 读数贴出（见下方实现证据）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped，exit 0，91 pass 0 fail）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence (inner 2026-08-12)

**AC2 layer→mechanisms 映射表**（新 `plugin/scripts/accounting-emit-layer-map.ts`，`accounting-emit.ts` 改为从此单一来源 import）：
- `cap-from-gate` / `slot-refill` 从 manager 移除 → 归 inner（AC39 根因）；`closure-lag-check` 留在 outer
- 修后三层机制集：outer=[closure-lag-check, verification-round, full-suite-runner]；inner=[ready-pool-check --apply, slot-refill, fast-mode-telemetry --task-start, cap-from-gate]；manager=[manager-tick-log]

**AC3 occupancy.in_flight 三层统一**：`accounting-emit.ts` `autoOccupancy()` 不再以 `.quay/config.yml` 存在为前提读 `fast-mode-telemetry --slots`；无 config 的裸目录三层也读出 `in_flight=0`（source=auto），不再 `missing=[occupancy.in_flight]`。`fast-mode-telemetry.ts --slots` JSON 增加显式 `inFlight` 别名（= realConcurrency）。

**修后实跑（invoke：`node --no-warnings --experimental-strip-types plugin/scripts/accounting-emit.ts --layer <L> --json`，root=主检出 `/home/yale/work/quay`）**：
```
outer:   complete=True  missing=[]  occupancy={in_flight:1, effective_cap:5, source:auto}
manager: complete=True  missing=[]  occupancy={in_flight:1, effective_cap:5, source:auto}   ← 修前 missing=[cap-from-gate.last_run_epoch, slot-refill.last_run_epoch]
inner:   complete=True  missing=[]  occupancy={in_flight:1, effective_cap:5, source:auto}   以真实调用注入 4 机制实时（ready-pool-check/slot-refill/fast-mode-telemetry --task-start/cap-from-gate）——inner 本层 emit 自己的机制读数
```

**scoped 测试**：`node --test plugin/test/accounting-emit.test.mjs` → **15 tests, pass 15, fail 0**（新增 AC39 四条：layer_map_correct / manager complete / inner complete / in_flight 无 config 在场）。`slot-visibility.test.mjs`（8 pass）+ `fast-mode-telemetry.test.mjs`（72 pass）对 `--slots` 加 `inFlight` 键无回归。

**⚠ 越界机械必需产物（未改，停手报告）**：新增 `plugin/scripts/accounting-emit-layer-map.ts` 触发 `delivery-inventory-drift-gate` —— 需重生成 `docs/proposals/quay-product-outline.md` §6 DELIVERY-INVENTORY 快照（`node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --write-inventory`）。该文件不在 Touches；按规程未擅自改，AC5 未勾，等外层授权/补 Touches 后由外层 verification-round 复核。

## Touches

- plugin/scripts/accounting-emit.ts（layer→mechanisms 映射表消费 + occupancy 补缺半）
- plugin/scripts/accounting-emit-layer-map.ts（新：每层机制注册，AC39 映射表正本）
- plugin/scripts/fast-mode-telemetry.ts（occupancy.in_flight 三层统一：QUAY_TELEMETRY_FAST_SLOTS 快速 slot 视图）
- plugin/scripts/capability-catalog.sh（AC1c 门：声明新脚本 accounting-emit-layer-map.ts）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照重生成——`verify-delivery-surface.ts --write-inventory`，scripts 210→211）
- plugin/test/accounting-emit-layer-map.test.mjs（新：三层机制成员 + in_flight 在场 + complete 用例）
- plugin/test/fast-mode-telemetry.test.mjs（新增 FAST-SLOTS 快速视图用例）
- plugin/test/accounting-emit.test.mjs（既有三层用例，不回归）
- tasks/gap-ac39-accounting-emit-layer.md（自身：勾 AC + 贴证据）

## Contract

measure   accounting_complete = `node --no-warnings --experimental-strip-types plugin/scripts/accounting-emit.ts --json` 对三层 complete 的读数
band      accounting_complete = true（三层 complete=True）
invariant in_flight_all_layers = 1（occupancy.in_flight 三层在场）
invariant layer_map_correct = 1（cap-from-gate/slot-refill 归 inner，closure-lag-check 归 outer）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/accounting-emit.ts --json`（贴三层 complete 读数）
control   三层 complete；in_flight 在场；layer 映射正确；既有不回归
resume    layer 映射 / in_flight 统一 / 测试分步提交，任一步完成即写盘

## 实现证据（inner 2026-08-12）

**修后三层机制成员（`accounting-emit.ts --layer <x> --json` 的 `mechanisms[].name`）**：
```
inner:   [cap-from-gate, slot-refill, ready-pool-check --apply, fast-mode-telemetry --task-start]
outer:   [closure-lag-check, verification-round, full-suite-runner]
manager: [manager-tick-log, Workflow, session-liveness]
```
⇒ layer_map_correct=1：cap-from-gate/slot-refill 归 inner（manager 不再携带 inner 机制——原根因），
closure-lag-check 归 outer。

**occupancy.in_flight 三层统一（AC3）**：accounting-emit.ts 的 autoOccupancy 改为**补缺半**——cap 已知而
in_flight 缺（manager 034125 实测的原缺陷形态）时仍从 `fast-mode-telemetry --slots` 取 in_flight，
不再两个半场都空着就放弃。读数源是 fast-mode-telemetry.ts 新增的 `QUAY_TELEMETRY_FAST_SLOTS=1` 快速 slot
视图（`realConcurrency`，与完整 `--slots` 同值、~30s→~0.6s；跳过仅与吞吐注释相关的 git history 与
closed-but-live 反向扫描）。主工作区实测 `--root /home/yale/work/quay`：`in_flight=2, effective_cap=5,
ratio=0.4, source=auto`（修前 in_flight=null）。⇒ in_flight_all_layers=1。

**三层 complete=True 读数（worktree 内，各层注入自身机制的 meta-cc 时刻 + occupancy）**：
```
inner:   complete=True  missing=[]  occupancy.in_flight=1
outer:   complete=True  missing=[]  occupancy.in_flight=1
manager: complete=True  missing=[]  occupancy.in_flight=1
```
⇒ accounting_complete=true（三层）。

**AC4（AC40② 转正）**：AC40②「accounting-emit --layer outer/inner 每轮 complete:true」的阻塞根因是
①manager/层机制错配（已修：每层只 emit 自身机制）②occupancy.in_flight 不可读（已修：补缺半 + 快速 slot
视图）。各层按其映射注入 meta-cc 时刻即可 complete:true，AC40② 可达成。

**测试**：
- `node --experimental-strip-types --test plugin/test/accounting-emit.test.mjs plugin/test/accounting-emit-layer-map.test.mjs` → 18 pass 0 fail（既有 11 + 新增 7）
- `node --experimental-strip-types --test plugin/test/fast-mode-telemetry.test.mjs` → 73 pass 0 fail（含新增 FAST-SLOTS 用例）
- `scripts/test.sh --for-task gap-ac39-accounting-emit-layer` → exit 0，91 pass 0 fail，inventory_drift=0（AC5）

**commit**：`inner: AC39 layer→mechanisms 映射表 + occupancy.in_flight 三层统一`（见 git log）

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 034125 全量 AC 求值。AC39 未开工，判据明确、红窗可做。实现归 inner。
