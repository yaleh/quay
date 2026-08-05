---
id: gap-adaptive-concurrency-cap-tied-to-resource-gate
title: "concurrency cap fixed 3 → adaptive (human: raise throughput; manager:
  don't swap fixed number for fixed number — laneCount=8 lesson); cap =
  f(resource-gate): GO=5/WAIT=2/extreme-WAIT=1, wire into fast-mode-loop-tick
  step 4 + ready-pool floor=cap×4; components exist (gate verified + scheduler),
  missing the junction"
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

**并发上限从固定值改自适应 + 滞回区间——cap 跟资源门联动（人请求提高吞吐 + 管理者形态建议 + 滞回必要条件 + 归属裁定）**：

**背景**：人请求提高 quay/archguard 开发吞吐率。实测资源「不算重」（PSI GO），但 nproc=4 是硬容量。

**为什么不改固定值**：laneCount 硬编码 8 在 4 核 PSI 94 + 三次 ABORT。把并发上限从 3 改成任何新固定
数字，都是同一模式换数字重演。资源门已验证正确，concurrent-batch-scheduler 已有 disjointness 排序。
缺的是接线进 fast-mode-loop-tick.md 步骤 4。

**滞回必要条件（管理者 14:58 补充实测）**：资源门 GO→WAIT→GO→WAIT 连续翻转（PSI 66→32→41→46 全贴
门槛 40），resource-gate **无滞回区间**（CPU_LIMIT=40 单阈值，一次采样过线就翻转）。自适应若无滞回，
门槛抖动直接传导成派发抖动——inner 几分钟内反复调并发，是噪声不是响应。⇒ **进档/出档门槛不同**
（如 PSI<35 升档、PSI>45 降档，中间死区），或连续 N 次采样同向才切档。

**归属裁定（管理者 15:00 更正）**：自适应并发是 quay 两层循环基础设施本身（fast-mode-loop-tick 模板
+ resource-gate.sh + concurrent-batch-scheduler.ts）——**设计实现在 quay 做一次**，做好后走正常升级
通道（git pull）流向 archguard/meta-cc，**不是各下游各自发明**。产出是「所有下游都能用的机制」。

**裁定（外层）**：采纳。档位 GO=5 / WAIT=2 / 极端 WAIT=1 + **滞回区间**（进/出档门槛不同）。现在就做。

### 选定机制

1. 并发上限 = f(resource-gate) 带滞回：升档需 PSI<35、降档需 PSI>45（中间死区），或连续 N 采样同向切档
2. resource-gate 增加滞回（或 cap-from-gate helper 内部实现滞回，gate 本身保持单阈值）
3. 接线进 fast-mode-loop-tick.md 步骤 4（替代固定 cap=3），ready-pool floor=cap×4 联动
4. **归属**：quay 实现 + 测试，产出经升级通道流向 archguard/meta-cc（git pull），下游不各自发明
5. 验证：资源空派发 ≥3；archguard 高负载回落；门槛抖动（66→32→41）不引起派发抖动

## Acceptance Criteria

- [ ] AC1: 并发上限读 resource-gate——GO ⇒ 5 / WAIT ⇒ 2 / 极端 WAIT ⇒ 1（实测各档位生效）
- [ ] AC2: 资源空时派发 ≥3（吞吐较 cap=3 提高，实测）
- [ ] AC3: 其它项目（archguard）高负载 ⇒ quay 自动回落 WAIT 档（不加重，实测）
- [ ] AC4: **滞回区间**——PSI 贴门槛抖动（如 66→32→41→46）不引起派发抖动（负控制：死区内不切档）
- [ ] AC5: fast-mode-loop-tick.md 步骤 4 并发判据更新（自适应 + 滞回，替代固定 cap=3），floor 联动
- [ ] AC6: **归属**——机制在 quay 实现 + 测试（下游 archguard/meta-cc 经升级通道采纳，不各自发明）
- [ ] AC7: 与 resource-gate + concurrent-batch-scheduler + SPEC-isolation 交叉标注

## Definition of Done

- [ ] AC1–AC7 全部勾上
- [ ] 资源空时实测派发 ≥3（吞吐提高，实跑输出贴任务体）
- [ ] archguard 高负载实测 quay 自动回落（实跑输出贴任务体）
- [ ] PSI 贴门槛抖动实测不引起派发抖动（滞回生效，实跑输出贴任务体）
- [ ] fast-mode-loop-tick.md 步骤 4 已更新（自适应 + 滞回，替代固定 cap=3）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/loop/fast-mode-loop-tick.md（步骤 4 并发判据自适应 + 滞回）
- plugin/scripts/resource-gate.sh（滞回区间）或新 helper（cap-from-gate 带滞回）
- plugin/scripts/ready-pool-check.ts（floor 联动 cap）
- plugin/test/（对应测试）
- tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md（AC7 交叉标注）

## Contract

measure   effective_cap = `bash <cap-from-gate-helper> 2>&1 | grep -o '[0-9]'` stdout 数字段（资源门各态下）
band      effective_cap = 5/2/1（GO/WAIT/极端 WAIT 三档，滞回死区内保持）
invariant cap_follows_gate_with_hysteresis = 1（并发上限由资源门+滞回决定，门槛抖动不传导）
invoke    `bash plugin/scripts/resource-gate.sh --for full-suite`
control   资源空 ⇒ cap 5（AC2）；archguard 高负载 ⇒ cap 2（AC3）；PSI 贴门槛抖动 ⇒ 不切档（AC4 滞回）
resume    滞回实现 + 档位 + tick 接线分步提交，任一步完成即写盘