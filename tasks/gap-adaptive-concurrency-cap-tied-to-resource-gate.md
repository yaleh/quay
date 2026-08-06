---
id: gap-adaptive-concurrency-cap-tied-to-resource-gate
title: "concurrency cap fixed 3 → adaptive (human: raise throughput; manager:
  don't swap fixed number for fixed number — laneCount=8 lesson); cap =
  f(resource-gate): GO=5/WAIT=2/extreme-WAIT=1, wire into fast-mode-loop-tick
  step 4 + ready-pool floor=cap×4; components exist (gate verified + scheduler),
  missing the junction"
status: done
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

- [x] AC1: 并发上限在**派发决策点**读取（tick 步骤 4，不新增轮询）——cap 由 avg300 决定
      —— 证据：`plugin/loop/fast-mode-loop-tick.md` 步骤 3.6 前置块 + 步骤 4 已接入
      `bash plugin/scripts/cap-from-gate.sh`（每 tick 只读一次 avg300，本步 floor 与步骤 4 派发上限共用；
      不再固定 cap=3，原「并发上限 3 个在飞」与 fail-safe 子句已改）。测试
      `plugin/test/cap-from-gate.test.mjs` AC1/AC7 断言 tick 调用 helper 且固定「并发上限 3」字样已消失。
- [x] AC2: 读 avg300（5分钟窗口）而非 avg10——与派发节奏同量级
      —— 证据：`plugin/scripts/resource-gate.sh` 新增 `read_cpu_avg300()`（解析 `/proc/pressure/cpu`
      `some avg300=` 字段）+ 独立 seam `RESOURCE_GATE_TEST_CPU_AVG300` + 输出行
      `cpu_stall(some avg300)=..`；`cap-from-gate.ts` 只消费 avg300 行。测试证明 avg10 高（84.77）+ avg300
      低（12）⇒ GO，avg10 低（10）+ avg300 高（84）⇒ EXTREME——信号是 avg300 非 avg10。
- [x] AC3: **滞回**——上次决策以来信号持续同向才调整（单次 avg300 采样不触发切换，负控制）
      —— 证据：`cap-from-gate.ts` `applyHysteresis`（`HYSTERESIS_SAMPLES_DEFAULT=2`，单次异向只递增
      consecutive、不切档；连续 2 次同向才切；回同向即清零）。测试「AC3 — hysteresis」单样本不切换 +
      2 样本切换 + 反向 blip 清零；「AC3 — avg10 贴门槛抖动」avg10 39→41 抖动而 avg300 稳定 ⇒ 档位不动。
- [x] AC4: **档位可配置**——GO/WAIT/极端 WAIT 数字由项目配置给出（quay 默认 5/2/1，下游可覆盖如 4/2/1），
      实测配置生效（机制共用、数字各项目定）
      —— 证据：`.quay/config.yml` `loop:concurrency_bands: {go: 5, wait: 2, extreme_wait: 1}`；
      `cap-from-gate.ts` `readBandsFromConfig` 用同一 `yaml` 解析器读该块，缺省/畸形回退 5/2/1。
      测试「AC4 — readBandsFromConfig」：无配置/缺块 → 5/2/1；4/2/1 覆盖生效；畸形 YAML → 回退；
      非法数字 → 回退。「AC4 — effective cap follows injected band config」GO=4 ⇒ cap 4。
- [x] AC5: 资源空时派发 ≥3（吞吐较 cap=3 提高，实测）
      —— 证据：实跑（本机 avg300=23.42，资源空）`bash plugin/scripts/cap-from-gate.sh` ⇒
      `effective_cap=5`（GO 档 ≥3，较固定 cap=3 提高）。测试「AC5 — resources empty」冷启动低 avg300 ⇒
      cap=5 且状态落盘。
- [x] AC6: 其它项目（archguard）高负载 ⇒ quay 自动回落 WAIT 档（不加重，实测）
      —— 证据：resource-gate 读**整机** `/proc/pressure/cpu`，archguard 负载抬升 quay 的 avg300 ⇒
      自动回落。实跑模拟（avg300=55，从 GO 态出发）：第 1 次采样 `band: GO desired=WAIT consecutive=1`，
      第 2 次 `band: WAIT switched=yes effective_cap=2`（滞回生效后回落 WAIT）。测试「AC6 — high avg300」
      同断言。EXTREME（avg300=84）⇒ cap=1。信号不可测 ⇒ fail-closed 到 EXTREME（cap=1，绝不高并发）。
- [x] AC7: **归属**——机制在 quay 实现 + 测试（下游 archguard/meta-cc 经升级通道采纳，不各自发明机制）
      —— 证据：机制本体 `plugin/scripts/cap-from-gate.ts` + 薄 bash wrapper
      `plugin/scripts/cap-from-gate.sh`（Contract 调用形态）+ 测试 `plugin/test/cap-from-gate.test.mjs`；
      头注释声明下游经升级通道（git pull）采纳、不各自发明。测试「AC1/AC7」断言文件在 plugin/scripts/
      下且 wrapper exec 模块。
- [x] AC8: 与 resource-gate + concurrent-batch-scheduler + SPEC-isolation 交叉标注
      —— 证据：`cap-from-gate.ts` 头注释交叉标注三者；`fast-mode-loop-tick.md` 步骤 3.6 前置块新增
      「交叉标注（AC8）」句；`tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md` 补 Dispatch review
      记录本任务引用（cgroup 硬限额上位解对照）。测试「AC8」断言三者名字出现在机制源码。

> **AC8 交叉标注（2026-08-06，来自 `tasks/gap-two-machine-collaboration-git-branch-claiming.md`）**：
> 自适应并发上限（cap = f(resource-gate)，读 avg300 + 滞回 + 档位配置）管**单机**同时派发几个在飞
> subagent；认领协议（`claim-task.sh`，`task/*` 分支推共享裸仓库 = 认领）管**跨机**哪些任务不撞——
> 两者是**不同作用域的并发限制器**，认领检查在**同一派发决策点**（`fast-mode-loop-tick.md` 步骤 4）
> 复用同一 `checkTouchesPair`。跨主机时 `QUAY_GLOBAL_DIR` 单飞锁失效的根因是状态放在「共享文件系统」
> 假设上；认领建在 git 上（唯一真跨主机状态存储）——机制一次下游复用（`claim-task.ts` 的
> `decideClaim` + 共享 `checkTouchesPair`）。

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

## 实跑证据（任务内 scoped 验证，2026-08-05）

```bash
# 实跑：本机资源空（avg300=23.42）⇒ GO 档 cap=5（AC5）
$ bash plugin/scripts/cap-from-gate.sh
signal: cpu_stall(some avg300)=23.42  bands(go<40, wait<70, extreme>=70)
band: GO  desired=GO  consecutive=0/2  switched=no
effective_cap=5

# 实跑（seam 模拟 archguard 高负载，从 GO 态出发）：第 1 次采样滞回保持 GO，第 2 次切 WAIT cap=2（AC6 + AC3）
$ RESOURCE_GATE_TEST_CPU_AVG300=55 bash plugin/scripts/cap-from-gate.sh
signal: cpu_stall(some avg300)=55.00  bands(go<40, wait<70, extreme>=70)
band: GO  desired=WAIT  consecutive=1/2  switched=no
effective_cap=5
$ RESOURCE_GATE_TEST_CPU_AVG300=55 bash plugin/scripts/cap-from-gate.sh
signal: cpu_stall(some avg300)=55.00  bands(go<40, wait<70, extreme>=70)
band: WAIT  desired=WAIT  consecutive=0/2  switched=yes
effective_cap=2

# 实跑（seam）：avg300=84 ⇒ EXTREME cap=1；信号不可测 ⇒ fail-closed cap=1（绝不静默高并发）
$ RESOURCE_GATE_TEST_CPU_AVG300=unmeasurable node --experimental-strip-types plugin/scripts/cap-from-gate.ts --root "$(pwd)"
signal: cpu_stall(some avg300)=UNMEASURABLE  bands(go<40, wait<70, extreme>=70)
band: EXTREME  desired=EXTREME  consecutive=0/2  switched=no
effective_cap=1

# scoped 测试（任务选中集）：35 pass / 0 fail / 0 cancelled / EXIT=0
#   bash scripts/test.sh --for-task gap-adaptive-concurrency-cap-tied-to-resource-gate --allow-thin
#   ⇒ ℹ tests 35  ℹ pass 35  ℹ fail 0  ℹ cancelled 0  + task-contract-check no violations
# 覆盖：AC1/AC2/AC3/AC4/AC5/AC6/AC7/AC8 断言 + 档位配置 4/2/1 生效（AC4）+ avg10 贴门槛抖动不切档（AC3 负控制）
```

## Contract

measure   effective_cap = `bash plugin/scripts/cap-from-gate.sh 2>&1 | grep -o '[0-9]'` stdout 数字段（派发决策点读取）
band      effective_cap = 5/2/1 或配置值（GO/WAIT/极端 WAIT，滞回死区内保持）
invariant cap_reads_avg300_at_dispatch = 1（并发上限在派发决策点读 avg300，不新增轮询）
invariant cap_bands_configurable = 1（档位数字由项目配置给出，机制统一）
invoke    `bash plugin/scripts/cap-from-gate.sh`
control   资源空 ⇒ cap 5（AC5）；archguard 高负载 ⇒ cap 2（AC6）；avg10 抖动 ⇒ 不切档（AC3 滞回）；改 config 档位 ⇒ 机制跟随（AC4）
resume    派发决策点接入 + avg300 + 滞回 + 档位配置分步提交，任一步完成即写盘

## Dispatch review

reviewer: inner
at: 2026-08-05
changed: 实现 cap-from-gate.ts/.sh（avg300 + 滞回 + 档位配置）；resource-gate.sh 增 avg300 读取/输出/seam；tick 文档步骤 3.6/4 改自适应 cap；ready-pool-check --cap 联动；config.yml 增 concurrency_bands；修正本任务 Contract control 行折行违规
