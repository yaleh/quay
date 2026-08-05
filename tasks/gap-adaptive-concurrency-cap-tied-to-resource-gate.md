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

**并发上限从固定值改自适应——信号与执行器时间尺度匹配 + 机制/策略分离（人请求提高吞吐 + 管理者三轮更正 + 外层裁定）**：

**背景**：人请求提高 quay/archguard 开发吞吐率。实测资源「不算重」，但 nproc=4 是硬容量。

**为什么不改固定值**：laneCount 硬编码 8 在 4 核 PSI 94 + 三次 ABORT。把并发上限从 3 改成任何新固定
数字，都是同一模式换数字重演。

**核心设计约束（管理者更正，人指出）**：信号与执行器**时间尺度差 1-2 个数量级**——
① 信号侧：/proc/pressure/cpu avg10（10秒窗口）5-8 分钟内连续翻转；② 执行侧：inner 派发决策在 subagent
完成时（15-90+ 分钟）。⇒ 任何「实时响应 avg10」的设计反应速度跟不上信号。**正确方向：降低采样频率匹配
执行频率**——复用 inner 派发决策点（tick 步骤 4，不新增轮询），读 avg300（5分钟窗口），保留滞回。

**机制/策略分离（管理者 15:08 纠正）**：并发档位的**具体数字**是策略（各项目按自身负载特征定——
archguard vitest 打包态重已裁定 GO=4/WAIT=2，quay 可不同）；**联动机制本身**（读哪个信号、什么时机读、
滞回逻辑）是机制，quay 提供统一实现。**之前把两者混说成一件事**。⇒ 机制部分做成**可配置**（档位数字
由项目配置给出），archguard 的 4/2 与 quay 的可能数字共用同一套机制，不产生分叉。

**归属裁定（管理者）**：自适应并发是 quay 基础设施（fast-mode-loop-tick 模板 + resource-gate.sh +
concurrent-batch-scheduler.ts）——设计实现在 quay 做一次，走升级通道流向 archguard/meta-cc。

**archguard 独立裁定参考**（15:08）：GO=4/WAIT=2，判定时机「每次派发前」——正复用已有决策点（不新增
轮询），独立选对了正确形态。

**裁定（外层）**：采纳。复用派发决策点 + 读 avg300 + 滞回 + **档位可配置**。

### 选定机制

1. **复用 inner 派发决策点**（tick 步骤 4，不新增轮询）——在派发时刻读资源状态决定 cap
2. **读 avg300**（5分钟窗口）而非 avg10——resource-gate 增加 avg300 读取，或 cap-from-gate helper
3. **滞回**：上次决策以来信号持续同向才调整（防单次采样误判）
4. **档位可配置**：机制统一实现，档位数字（GO/WAIT/极端 WAIT）由项目 .quay/config.yml 给出（quay 默认
   5/2/1，archguard 可配 4/2/1）
5. **归属**：quay 实现 + 测试，产出经升级通道流向 archguard/meta-cc（git pull）
6. 验证：资源空派发 ≥3；archguard 高负载回落；avg10 抖动不引起派发抖动；档位配置生效

## Acceptance Criteria

- [ ] AC1: 并发上限在**派发决策点**读取（tick 步骤 4，不新增轮询）——cap 由 avg300 决定
- [ ] AC2: 读 avg300（5分钟窗口）而非 avg10——与派发节奏同量级
- [ ] AC3: **滞回**——上次决策以来信号持续同向才调整（单次 avg300 采样不触发切换，负控制）
- [ ] AC4: **档位可配置**——GO/WAIT/极端 WAIT 数字由项目配置给出（quay 默认 5/2/1，下游可覆盖如 4/2/1），
      实测配置生效（机制共用、数字各项目定）
- [ ] AC5: 资源空时派发 ≥3（吞吐较 cap=3 提高，实测）
- [ ] AC6: 其它项目（archguard）高负载 ⇒ quay 自动回落 WAIT 档（不加重，实测）
- [ ] AC7: **归属**——机制在 quay 实现 + 测试（下游 archguard/meta-cc 经升级通道采纳，不各自发明机制）
- [ ] AC8: 与 resource-gate + concurrent-batch-scheduler + SPEC-isolation 交叉标注

## Definition of Done

- [ ] AC1–AC8 全部勾上
- [ ] 资源空时实测派发 ≥3（吞吐提高，实跑输出贴任务体）
- [ ] archguard 高负载实测 quay 自动回落（实跑输出贴任务体）
- [ ] avg10 贴门槛抖动实测不引起派发抖动（avg300 + 滞回生效，实跑输出贴任务体）
- [ ] 档位配置实测生效（改 config 档位 ⇒ 机制跟随，实跑输出贴任务体）
- [ ] fast-mode-loop-tick.md 步骤 4 已更新（派发决策点读 avg300 + 滞回 + 档位配置，替代固定 cap=3）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-adaptive-concurrency-cap-tied-to-resource-gate.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/loop/fast-mode-loop-tick.md（步骤 4：派发决策点读 avg300 + 滞回 + 档位配置）
- plugin/scripts/resource-gate.sh（avg300 读取）或新 helper（cap-from-gate 读 avg300 带滞回，档位读 config）
- plugin/scripts/ready-pool-check.ts（floor 联动 cap）
- .quay/config.yml（档位配置示例）
- plugin/test/（对应测试）
- tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md（AC8 交叉标注）

## Contract

measure   effective_cap = `bash <cap-from-gate-helper> 2>&1 | grep -o '[0-9]'` stdout 数字段（派发决策点读取）
band      effective_cap = 5/2/1 或配置值（GO/WAIT/极端 WAIT，滞回死区内保持）
invariant cap_reads_avg300_at_dispatch = 1（并发上限在派发决策点读 avg300，不新增轮询）
invariant cap_bands_configurable = 1（档位数字由项目配置给出，机制统一）
invoke    `bash plugin/scripts/resource-gate.sh --for full-suite`
control   资源空 ⇒ cap 5（AC5）；archguard 高负载 ⇒ cap 2（AC6）；avg10 抖动 ⇒ 不切档（AC3 滞回）；
         改 config 档位 ⇒ 机制跟随（AC4）
resume    派发决策点接入 + avg300 + 滞回 + 档位配置分步提交，任一步完成即写盘