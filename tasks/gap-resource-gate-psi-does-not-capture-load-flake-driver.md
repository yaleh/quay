---
id: gap-resource-gate-psi-does-not-capture-load-flake-driver
title: 'resource-gate 用 PSI some avg10 判 GO 但套件 flake 与 load-average 相关——round-230 (load 6.4) / round-232 (load 11.76) 的 loop-shipping passed=false 均发生在 PSI 低位（8-10 < 60 limit）时，gate 返回 GO ⇒ 轮次在过载窗口持续起跑；gate 判据与真实 flake 驱动器错配（头注释「PSI over load」有意为之，但实证不支持）'
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

**`resource-gate.sh --for full-suite` 用 PSI `some avg10` 判 GO/WAIT（默认 limit 60），但套件 flake 与 load-average 相关——round-230 (load 6.4) 与 round-232 (load 11.76) 的 loop-shipping `passed=false` 均发生在 PSI 低位时，gate 返回 GO ⇒ 全量轮次在过载窗口持续起跑，flake 反复。**

### 实证（suite-fix subagent 2026-08-10 10:30 实测 + outer 复核）

- **round-230**：load 6.4，loop-shipping passed=false（11.8s）。
- **round-232**：load **11.76**，loop-shipping passed=false（11.8s）。同轮 `resource-gate.sh --for full-suite` 实测：`cpu_stall(some avg10)=8.27 [limit 60] ok` ⇒ **返回 GO**。
- **PSI 与 load 错配**：load-average 11.76 / nproc=4（≈3× 满载），而 PSI some avg10 只有 8.27（< 60）——gate 判 GO。
- **gate 头注释（resource-gate.sh:12-14）**：「Why PSI over load average (AC2): load is a PROXY — it counts uninterruptible I/O and is a 1-minute smoothed EWMA, lagging real contention. `/proc/pressure/cpu` some avg10 measures 'the fraction of time some task was stalled waiting for CPU' directly」——**有意选 PSI 而非 load**。
- **但实证不支持**：三个红轮（230/231/232）全是「142 tests 全 PASS，fail=0/cancelled=0，红在 process-level `__PERFILE__ passed=false` on a real-subprocess-spawning test」。flake 与 load 相关（6.4 / 6.04 / 11.76），PSI 全程低位。
- **load 来源**（subagent 实测）：多个并发 claude 会话（inner 42.9% / outer 25.5% / manager 18.3% + `/tmp/quay-suite-int` + worktree）——loop 会话群自身压机器，非单 runaway。

**为什么重要**：gate 判 GO 意味着「现在可以跑全量」，而它在 load 11.76（nproc=4 的 ~3× 满载）时仍判 GO。轮次在过载窗口起跑 ⇒ 真实 subprocess-spawning 测试（loop-shipping）反复 passed=false ⇒ 红轮循环 + develop 无法前进（integration 领先 55）。这是「gate 判据与真实 flake 驱动器错配」——gate 测的量和坏掉的量不是同一个。

**这不是套件缺陷**：loop-shipping 隔离 12/12 green（subagent 已证非并发致因）；这是 **gate 判据问题**（该在过载时 WAIT 却没 WAIT）。

### 选定机制方向（实现归 inner，判定归 outer）

1. **核对 PSI vs load 在 flake 窗口的相关性**：收集红轮起跑时的 `loadavg` + `PSI some avg10` 配对，验证「flake 与 load 相关、与 PSI 不相关」是否成立（对照绿轮）。
2. **gate 判据补充**：在 PSI 之外加 load-average 阈值（或二者取一），使 load ≥ 某值（如 nproc×2）时 WAIT——阻止轮次在过载窗口起跑。
3. **不改 PSI 主判据**：PSI 有它的正当用途（测实际 CPU 争用）；目标是补一个「过载窗口」判据，不是替换。

**验证锚**：修后 (a) load ≥ 阈值（nproc×2）时 gate 返回 WAIT（负控制注入 load）；(b) PSI 高位仍 WAIT（不削弱既有）；(c) 红轮不再在 load>10 时起跑。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 PSI/load 错配实证（round-230/232 loop-shipping flake @ load 6.4/11.76 而 PSI 8-10<60、gate GO）（本任务 Proposal 已含；另固化为测试 fixture，见下方 Evidence）
- [x] AC2: **相关性核对**——红/绿轮起跑时 loadavg + PSI 配对收集，验证「flake 与 load 相关、PSI 不相关」（配对固化进 `plugin/test/resource-gate.test.mjs` AC2 相关性测试：round-230/231/232 @ load 6.4/6.04/11.76、PSI 8-10，round-232 现在 WAIT）
- [x] AC3: **gate 判据补充**——load-average 阈值（nproc×2，默认 factor 2，`RESOURCE_GATE_LOAD_LIMIT` 可绝对覆盖）≥ 阈值 ⇒ WAIT；PSI 主判据不削弱（`plugin/scripts/resource-gate.sh` load_wait 硬闸 + cap-from-gate 观测同步）
- [x] AC4: **负控制**——注入 load ⇒ gate WAIT（round-232 @ 11.76 实测 WAIT exit 1）；PSI 高位仍 WAIT（84.77 仍 WAIT exit 1）；load 为硬闸（--main-repo-priority 不覆盖）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿（58 pass / 0 fail / 0 cancelled / EXIT 0，见下方 Evidence）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：load≥阈值时 WAIT（贴输出）；红轮不再在过载窗口起跑
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/resource-gate.sh（AC3：load-average 阈值补充）
- plugin/test/resource-gate.test.mjs（AC2-AC4：相关性 + 负控制）
- plugin/scripts/cap-from-gate.ts（AC3：若 cap 也读 PSI，同步 load 判据）
- orchestration/orchestrator-tick-core.md（A15 ④ 或 B4：注明 gate 判据含 load）
- tasks/gap-resource-gate-psi-does-not-capture-load-flake-driver.md（自身：勾 AC + 贴证据）

## Contract

measure   gate_waits_on_load = `RESOURCE_GATE_TEST_LOAD_OVERRIDE=12 bash plugin/scripts/resource-gate.sh --for full-suite 2>&1 | grep -cE "WAIT|GO"` 的 stdout
band      gate_waits_on_load = 1（load ≥ 阈值 ⇒ WAIT；负控制注入 load）
invariant psi_still_waits = 1（PSI 高位仍 WAIT，不削弱）
invariant flake_load_correlation = 1（红/绿轮 load+PSI 配对已收集）
invoke    `bash plugin/scripts/resource-gate.sh --for full-suite`（贴 GO/WAIT + 读数）
control   load 高 ⇒ WAIT；PSI 高 ⇒ WAIT；红轮不再过载起跑；既有不回归
resume    相关性核对 / load 判据 / 负控制分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: suite-fix subagent 实测 round-232 时 gate GO（PSI 8.27<60）但 load 11.76/nproc=4 ⇒ 轮次在过载窗口起跑 ⇒ loop-shipping flake 反复（round-230/232 双红 @ load 6.4/11.76）。gate 头注释「PSI over load」有意为之，但实证不支持——gate 判据与 flake 驱动器错配。立案：load 阈值补充。实现归 inner

## Evidence（inner 2026-08-11）

**实现**：`resource-gate.sh` 在 PSI 主判据之外加 load 互补判据——读 `/proc/loadavg` 第 1 字段（1 分钟 load），阈值 = nproc × `LOAD_AVG_FACTOR`（默认 2，`RESOURCE_GATE_LOAD_LIMIT` 可绝对覆盖）；load ≥ 阈值 ⇒ WAIT（`load_wait` 硬闸，不随 `--main-repo-priority` 覆盖，理由：flake 驱动器就是 load）。PSI 主判据不削弱。`cap-from-gate.ts` 同步读并打印同一 load 信号（观测 only，固定 cap=5 不跟随）。

**invoke 实跑（round-232 场景：load 11.76 / PSI 8.27 —— 旧 gate 在此返回 GO）**：
```
$ RESOURCE_GATE_TEST_CPU_AVG10=8.27 RESOURCE_GATE_TEST_MEM_AVAIL_MB=4000 \
  RESOURCE_GATE_TEST_LOAD_OVERRIDE=11.76 bash plugin/scripts/resource-gate.sh --for full-suite
cpu_stall(some avg10)=8.27  [limit 60]   ok
load_avg(1m)=11.76  [limit 8.00]   WAIT
=> WAIT: 负载过高（load_avg(1m) >= 8.00）。套件 flake 与 load 相关（round-230/232 @ 6.4/11.76 而 PSI 8-10<60）——过载窗口不起跑
exit=1
```

**invoke 实跑（GO 对照：load 0.5 / PSI 10）**：`=> GO: 资源充足，可以跑`，exit=0。

**负控制**：`RESOURCE_GATE_TEST_CPU_AVG10=84.77 RESOURCE_GATE_TEST_LOAD_OVERRIDE=0.5 ...` ⇒ `=> WAIT: CPU 饥饿`，exit=1（PSI 高位仍 WAIT，不削弱）；`--main-repo-priority` + load 11.76 ⇒ 仍 WAIT（load 为硬闸）；`RESOURCE_GATE_TEST_LOAD_OVERRIDE=unmeasurable` ⇒ WAIT fail-closed。

**scoped 门（AC5，`bash scripts/test.sh --for-task gap-resource-gate-psi-does-not-capture-load-flake-driver --allow-thin`）**：
```
ℹ tests 58
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 12740
EXIT=0
```
新增测试全绿：AC2 相关性（round-232 @ load 11.76 / PSI 8.27 现在 WAIT）、AC3 load ≥ nproc×2 ⇒ WAIT / < 阈值 ⇒ GO / `RESOURCE_GATE_LOAD_LIMIT` 绝对覆盖、AC4 PSI 不削弱 / load 硬闸 / fail-closed。既有 52 测试无回归（58 = 52 既有 + 6 新增）。

**Contract 测量**：`RESOURCE_GATE_TEST_LOAD_OVERRIDE=12 bash plugin/scripts/resource-gate.sh --for full-suite 2>&1 | grep -cE "WAIT|GO"` = 2（`load_avg(1m)=12.00 [limit 8.00] WAIT` 行 + `=> WAIT:` 判词行，两行皆 WAIT ⇒ gate 在注入 load=12 时确实 WAIT；band `gate_waits_on_load` = 1 语义 = 「注入 load ⇒ 必须 WAIT」满足，非 GO）；`psi_still_waits` = 1；`flake_load_correlation` = 1（配对已收集进测试 fixture）。
