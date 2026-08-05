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

**并发上限从固定值改自适应——信号与执行器时间尺度匹配（人请求提高吞吐 + 管理者两轮更正 + 外层裁定）**：

**背景**：人请求提高 quay/archguard 开发吞吐率。实测资源「不算重」，但 nproc=4 是硬容量。

**为什么不改固定值**：laneCount 硬编码 8 在 4 核 PSI 94 + 三次 ABORT。把并发上限从 3 改成任何新固定
数字，都是同一模式换数字重演。

**核心设计约束（管理者更正，人指出）**：信号与执行器**时间尺度差 1-2 个数量级**——
① 信号侧：/proc/pressure/cpu avg10（10秒窗口）5-8 分钟内连续翻转（66→32→41→46→56→60→44）；
② 执行侧：outer cron 20 分钟、inner 派发决策在 subagent 完成时（非固定轮询）、subagent 典型 15-90+
分钟。⇒ **任何「实时响应 avg10」的设计，反应速度必然跟不上信号本身**。滞回只是让信号更平滑，不解决
「执行器是分钟到小时级采样，根本看不到 10 秒窗口抖动」——问题不在信号该不该平滑，在**两者的时间尺度
从设计上就不匹配**。

**正确方向（管理者）**：不要在 inner 派发链路新增「主动轮询资源状态」的动作（频率设多快都追不上
avg10，多慢又失去意义）。应**复用 inner 本来就有的决策点**（tick 步骤 4 派发时刻），在那个时刻读一次
**avg300**（5分钟窗口，与决策节奏同量级），保留**滞回**（上次决策以来信号持续同向才调整，防单次采样
误判）。**本质：降低采样频率匹配执行频率，而不是提高执行频率匹配采样频率**（后者做不到——Claude Code
一次决策有不可压缩的推理与工具调用耗时）。

**归属裁定（管理者）**：自适应并发是 quay 基础设施（fast-mode-loop-tick 模板 + resource-gate.sh +
concurrent-batch-scheduler.ts）——**设计实现在 quay 做一次**，走升级通道流向 archguard/meta-cc，
不各下游发明。

**裁定（外层）**：采纳。复用派发决策点 + 读 avg300 + 滞回。档位 GO=5 / WAIT=2 / 极端 WAIT=1。

### 选定机制

1. **复用 inner 派发决策点**（tick 步骤 4，不新增轮询）——在派发时刻读资源状态决定 cap
2. **读 avg300**（5分钟窗口，与决策节奏同量级）而非 avg10——resource-gate 增加 avg300 读取，或 cap-from-gate helper 读 avg300
3. **滞回**：上次决策以来信号持续同向才调整（防单次采样误判）
4. 档位 GO=5 / WAIT=2 / 极端 WAIT=1；ready-pool floor=cap×4 联动
5. **归属**：quay 实现 + 测试，产出经升级通道流向 archguard/meta-cc（git pull）
6. 验证：资源空派发 ≥3；archguard 高负载回落；avg10 抖动（66→32→41）不引起派发抖动

## Acceptance Criteria

- [ ] AC1: 并发上限在**派发决策点**读取（tick 步骤 4，不新增轮询）——cap 由 avg300 决定
- [ ] AC2: 读 avg300（5分钟窗口）而非 avg10（10秒窗口）——与派发节奏同量级
- [ ] AC3: **滞回**——上次决策以来信号持续同向才调整（单次 avg300 采样不触发切换，负控制）
- [ ] AC4: 档位生效——GO ⇒ 5 / WAIT ⇒ 2 / 极端 WAIT ⇒ 1（实测各档位）
- [ ] AC5: 资源空时派发 ≥3（吞吐较 cap=3 提高，实测）
- [ ] AC6: 其它项目（archguard）高负载 ⇒ quay 自动回落 WAIT 档（不加重，实测）
- [ ] AC7: **归属**——机制在 quay 实现 + 测试（下游 archguard/meta-cc 经升级通道采纳）
- [ ] AC8: 与 resource-gate + concurrent-batch-scheduler + SPEC-isolation 交叉标注

## Definition of Done

- [ ] AC1–AC8 全部勾上
- [ ] 资源空时实测派发 ≥3（吞吐提高，实跑输出贴任务体）
- [ ] archguard 高负载实测 quay 自动回落（实跑输出贴任务体）
- [ ] avg10 贴门槛抖动实测不引起派发抖动（avg300 + 滞回生效，实跑输出贴任务体）
- [ ] fast-mode-loop-tick.md 步骤 4 已更新（派发决策点读 avg300 + 滞回，替代固定 cap=3）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/loop/fast-mode-loop-tick.md（步骤 4：派发决策点读 avg300 + 滞回）
- plugin/scripts/resource-gate.sh（avg300 读取）或新 helper（cap-from-gate 读 avg300 带滞回）
- plugin/scripts/ready-pool-check.ts（floor 联动 cap）
- plugin/test/（对应测试）
- tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md（AC8 交叉标注）

## Contract

measure   effective_cap = `bash <cap-from-gate-helper> 2>&1 | grep -o '[0-9]'` stdout 数字段（派发决策点读取）
band      effective_cap = 5/2/1（GO/WAIT/极端 WAIT 三档，滞回死区内保持）
invariant cap_reads_avg300_at_dispatch = 1（并发上限在派发决策点读 avg300，不新增轮询）
invoke    `bash plugin/scripts/resource-gate.sh --for full-suite`
control   资源空 ⇒ cap 5（AC5）；archguard 高负载 ⇒ cap 2（AC6）；avg10 抖动 ⇒ 不切档（AC3 滞回）
resume    派发决策点接入 + avg300 + 滞回分步提交，任一步完成即写盘