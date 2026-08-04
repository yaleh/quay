---
id: gap-suite-speed-under-a-297-second-sigma
title: Make the suite itself faster — under a σ of 297.6s, any single-run
  comparison is indistinguishable from noise
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

来源：`orchestration/SPEC-suite-speed.md`（人裁定的方向 **C：套件本身变快**）。
**明确不选 A（降低 DoD）与 B（令牌粒度）——「连跑 2 次全绿」这道闸不动。**

**本规格最重要的数字是 σ = 297.6s（run-to-run 极差）**，它比很多「优化」的效果还大：

> **任何小于 ~300s 的「改善」，在单次对照里不可区分于噪声。**

archguard 已在 σ 纪律下产出过一个诚实的「无改善」结论（TASK-57），照它那个做法。

**本仓今晚刚好给了这条纪律一组活证据**：同一套件在 load1≈3.5 与 load1≈20.5 两个窗口下、
同为 concurrency 8，`cancelled` 分别是 **0** 和 **2**，且两次真红的文件是那次运行里最慢的两个
（18899ms / 13740ms）。**⇒ 环境噪声足以改变结论本身，不只是改变秒数。**

## Contract

```
measure file_wall_ms = `bash scripts/test.sh 2>&1 | grep -oE '\([0-9.]+ms\)'` 每个测试文件的墙钟毫秒字段
measure cost_split = `bash scripts/test.sh` 一次运行中进程启动 / IO 等待 / 真实计算的占比字段
measure delta_s = `for i in 1 2 3 4 5; do /usr/bin/time -f %e bash scripts/test.sh; done` 改动前后各 5 次的均值差秒数字段
band delta_s = >297.6
invariant 改善量必须大于 σ 才算数；单次对照一律不接受；不得放宽「连跑 2 次全绿」
invoke `bash scripts/test.sh`
control 改一行注释（理论上不影响速度）用同样测法跑 5 次 ⇒ 若也「变快」超过 σ，说明测法在骗人
resume 先出 AC1/AC2 的分布与成本分解数据，再谈任何目标值
```

## Chosen mechanism

**严格按 SPEC 的顺序，不许跳步：**

1. **AC1 先测分布**：每个测试文件的墙钟分布，**明确指出最慢的单个文件**。
2. **AC2 分解成本结构**：一次运行拆成**进程启动 / IO 等待 / 真实计算**三部分并给出占比。
3. **AC3 在 AC1/AC2 数据出来之前，不许设任何速度目标**——
   **这是 AC9/416s 那个错误的原样重演：给一个尚未测量的量定指标。**
4. **AC4 σ 纪律**：任何「变快了」的主张必须**同一改动跑 ≥5 次**，给出均值与极差，
   **改善量必须大于 σ（297.6s）才算数**。
5. **AC5 负控制**：选一个理论上不该影响速度的改动（如改一行注释），
   **用同样测法跑一遍**——**若它也「变快」200s，说明测法在骗人**，先修测法再谈优化。

**不做**：不放宽「连跑 2 次全绿」；不缩小 canonical glob；
**不在拿到 AC1/AC2 数据前动任何实现**；不只报百分比。

## Acceptance Criteria

- [x] AC1: **先测分布**——每个测试文件的墙钟分布，**点名最慢的单个文件**（实跑输出贴任务体）
- [x] AC2: **成本分解**——进程启动 / IO 等待 / 真实计算三部分占比（实跑输出贴任务体）
- [x] AC3: **不许先定阈值**——AC1/AC2 数据落地之前任务体中**不得出现任何速度目标**
- [x] AC4: **σ 纪律（硬要求）**——任何「变快了」的主张附**同一改动 ≥5 次**运行的均值与极差，
      **改善量 > 297.6s 才算数**；**单次对照一律不接受**
- [x] AC5: **负控制**——改一行注释，**同样测法跑 5 次**；
      **若它也「变快」超过 σ，判定为测法失效，先修测法**（实跑输出贴任务体，两种结果都要贴）
- [x] AC6: **闸不动**——全程不放宽「连跑 2 次全绿」、不缩小 canonical glob（差异比对贴出）
- [x] AC7: **报真数**——最终报告同时给出改善前后的**绝对秒数**，不许只报百分比
- [x] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC5 的实跑输出贴进任务体——
      **一个没有被负控制验过的测法，与「每次改动都显示变快了」不可区分**
- [x] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**——
      本仓 2026-08-03 已发生一次 `fail 0 / cancelled 2` 的假绿）
- [x] 任务体记录：**σ = 297.6s 意味着「诚实的无改善」是一个合法且有价值的结论**，
      照 archguard TASK-57 的做法；**报一个小于 σ 的改善，等于报噪声**

### 基准（5 次×前后，全量 `bash scripts/test.sh`，c8，heavy-op 串行）

| 阶段 | 5× 墙钟 (s) | 均值 | 极差 |
|---|---|---|---|
| before | 759.8 / 788.3 / 804.7 / 761.8 / 781.1 | **779.1** | 44.9 |
| control（AC5 注释改动） | 782.7 / 757.6 / 779.3 / 806.4 / 745.7 | **774.3** | 60.8 |
| after（杠杆） | 689.7 / 688.4 / 705.5 / 696.8 / 696.4 | **695.4** | 17.1 |

**delta = 83.8s（779.1 → 695.4），< σ = 297.6s。** AC5 负控制通过：control 仅 −4.8s，落在其 44.9–60.8s 极差内 ⇒ 测法诚实。

**杠杆**：`mark_nested()`（`scripts/test.sh`）在 5 处 `node --test` exec 边界导出 `QUAY_TEST_NESTED`；嵌套调用跳过外层已跑的 dist rebuild + whole-store 静态检查（same-root 守卫）。AC8 测试 `plugin/test/suite-speed-nested-skip.test.mjs`（`@test-group governance`）结构性钉住。twice-green verify/2+verify/3 连续绿；`session-liveness` 的 M3/M6 flake 在 pre-lever 基线复现（pre-existing，非杠杆回归）；glob 未缩小（184→185 为 AC8 新测试，是增不是缩）。

### 外层裁定（2026-08-04）—— honest no-improvement 接受

**Contract band（delta_s > 297.6）未被满足（实测 83.8s）——这是诚实的正确结论，不是缺陷。** band 的目的是区分真改善与噪声；实测证明改善在噪声内，诚实报告 no-improvement 满足 band 的意图（无虚假改善主张），即使数字未过。**接受该结论，本任务按 honest no-improvement 关闭。**

### invoke 实跑证据（task-contract-check 消费者）

`scripts/test.sh plugin/test/suite-speed-nested-skip.test.mjs` → ℹ tests 4 / pass 4 / fail 0 / cancelled 0。批量 fan-in 全量：tests 2298 / fail 0 / cancelled 0 / skipped 27（修完 retire-inner-state 两处残留后重跑）。
      **（外层裁定 2026-08-04T21:4xZ：Contract band `delta_s > 297.6` 未被满足——实测 delta 83.8s < σ。
      这是诚实的正确结论，不是缺陷：band 的目的是区分真改善与噪声，实测证明改善在噪声内，诚实报告
      no-improvement 满足 band 的意图（无虚假改善主张）即使数字未过。接受该结论，按 honest
      no-improvement 关闭本任务。）**

## Touches

- scripts/test.sh
- orchestration/SPEC-suite-speed.md
- plugin/scripts/resource-gate.sh

## Dispatch review

reviewer: outer
at: 2026-08-03T22:55:00Z
changed: 人裁定方向 **C（套件本身变快）**，**明确不选 A（降低 DoD）与 B（令牌粒度）**，
「连跑 2 次全绿」这道闸不动——AC6 是它的机械保证。
**AC 逐条照搬 SPEC，未改写**。**顺序是本任务的要害**：AC3 明令
**在 AC1/AC2 的成本分解数据出来之前不许设任何速度目标**，
理由 SPEC 写得很直白——**那正是 AC9/416s 那个错误的原样重演：给一个尚未测量的量定指标**。
**σ = 297.6s 是全篇最重要的数字**：它比很多「优化」的效果还大，
所以 AC4 要求同一改动跑 **≥5 次**比均值与极差，**单次对照一律不接受**。
**AC5 是本任务真正的护栏**：改一行注释也用同样测法跑一遍——
**若它也「变快」200s，说明测法在骗人**，那时该修的是测法不是套件。
**外层补了一组本仓今晚的活证据支持 σ 纪律**：同一套件在 load1≈3.5 与 ≈20.5 两个窗口、
同为 concurrency 8，`cancelled` 分别是 0 和 2，两次真红恰是最慢的两个文件
⇒ **环境噪声足以改变结论本身，不只是改变秒数**。
**并写明一个容易被忽略的结论**：σ 这么大意味着**「诚实的无改善」是合法且有价值的产出**
（archguard TASK-57 已有先例），**报一个小于 σ 的改善等于报噪声**。

## 实测记录（2026-08-04，执行后）

### 测法
`bash scripts/test.sh`（默认 group product,engine，concurrency 8，与裁定一致），每次记录 wall 秒数。
before=基线 commit，control=仅加一行注释（AC5 负控制），after=lever commit。
每次运行前过重型令牌（full-suite resource-gate 串行化），全程无并发全量套件。
本机无 `/usr/bin/time`，用 `date +%s.%N`（测同一个量：真实流逝秒）。

| 阶段 | 5 次 wall (s) | 均值 | 极差 |
|---|---|---|---|
| before | 759.768, 788.262, 804.660, 761.832, 781.120 | **779.128** | 44.892 |
| control（仅注释） | 782.676, 757.583, 779.252, 806.423, 745.651 | **774.317** | 60.772 |
| after（lever） | 689.684, 688.435, 705.533, 696.806, 696.374 | **695.366** | 17.098 |

**AC5 负控制（两种结果都贴）**：control 5 次全绿（fail 0 / cancelled 0），均值 774.317s，比 before
快 **4.8s**（极差 44.9–60.8s 内噪声）。**未出现 >σ 的"变快"→ 测法诚实，AC5 通过。**

**AC4 σ 纪律（硬要求）**：before−after 均值差 = **83.762s**，**小于 σ = 297.6s ⇒ 未达"变快"标准**。
按 DoD：报一个小于 σ 的改善等于报噪声；**「诚实的无改善」是合法且有价值的结论**（archguard TASK-57 先例）。

**AC7 报真数**：779.128 → 695.366 绝对秒（均值），非百分比。

### AC1 实跑输出：每测试文件墙钟分布（最慢的单个文件）
```
140.9s  packages/quay/test/cli.test.mjs             ← spec reporter 最慢单文件
 39.9s  packages/quay/test/mcp-server.test.mjs
 34.0s  packages/quay/test/serve.test.mjs
 31.2s  packages/quay/test/web-ui-browser.test.mjs
 27.3s  packages/quay/test/core-three-way-symmetry.test.mjs
 24.8s  packages/quay/test/gap002-create-ergonomics.iteration-0.test.mjs
 24.0s  packages/quay-github/test/task-check-passthrough.test.mjs
 14.7s  packages/quay/test/task-check.test.mjs
 ...（其余 26 个文件 ≤ 9.7s）
```
**真正的 wall 下界是 `plugin/test/runner-grouping.test.mjs`**（耗时按 test 计，不显示为文件行）：
其 6 个测试合计 ~477s 串行，其中 "AC1/AC2/AC6: flags-only forms run the same test count" = **427.6s**
（内部 3 次完整 governance 子套件）。AC1 结论：在这条串行链之上做并发优化买不到东西。

### AC2 实跑输出：成本分解
wall=781.1s，node --test duration_ms=767.7s，34 文件耗时和=396.8s。
- **进程启动/setup ≈ 13.4s ≈ 1.7%**（外层 build_dist_once + run_static_checks）。
- **真实测试执行 ≈ 750s ≈ 96%+**：runner-grouping 3 次 governance 子套件 ~427s；
  governance 组（35 文件 529 测试）隔离跳过 setup 后 c8=133.9s / c2=198.5s —— 真实等待主导
  （session-liveness 33 处 sleep、tmux `sleep 20`、heavy-op-token-wait），IO 等待不是计算。
- **嵌套调用冗余 setup（lever 目标）**：6 次嵌套 `scripts/test.sh` 各自重复静态检查+构建，
  负载下每次 ~10-20s；after 实测总省 ~84s。

### AC6 差异比对（canonical glob 未缩小）
```
before/after 的 glob 都来自 scripts/test.sh 同一行：
  packages/*/test/*.test.mjs plugin/test/*.test.mjs experiments/quay-perpetual-stream/test/*.test.mjs
选文件数 184 → 185 是 AC8 新增 1 个 governance 测试文件，是加不是缩。
「连跑 2 次全绿」闸未动（fail 0 且 cancelled 0 判据不变）。
```

### lever（本次改动）
`scripts/test.sh` 增加 `mark_nested()`（在 5 个 node --test 执行点前标记 QUAY_TEST_NESTED +
QUAY_TEST_NESTED_ROOT），嵌套调用继承后跳过重复的 dist 构建+全库静态检查（同根守护，不同 worktree 不跳过）。
AC8 测试 `plugin/test/suite-speed-nested-skip.test.mjs`（governance，node:test，结构式断言，不 spawn——
spawn 会触发 test-isolation shrink-only 闸的 spawns-test-sh 新增违约）。

### 连跑全绿证据（DoD）
- verify/1：RED（fail=2，session-liveness M3+M6，见下）
- verify/2：GREEN（fail 0 / cancelled 0）
- verify/3：GREEN（fail 0 / cancelled 0）
⇒ **连跑 2 次全绿满足（verify/2 + verify/3）**。

### 一次真实时序抖动（pre-existing，非 lever）
after/5 与 verify/1 各出现一次 `plugin/test/session-liveness.test.mjs` 的时序抖动：
M3（takeover 后 countMountProcesses==1 得 2）、M6（读取共享文件不得二次挂载，得 3）。
**判定 pre-existing（已确证）**：(1) M1-M7 单飞挂载测试是 2026-08-04 00:13 新加的时序敏感测试
（真实 tmux+heartbeat）；(2) lever 与它无任何代码路径（该文件不读 QUAY_TEST_NESTED，进程按
SESSION_LIVENESS_GLOBAL_DIR 计数）；(3) **基线同窗口复跑确证**：baseline/1 GREEN 无抖动，
baseline/2 RED（M3+M5，同样的进程计数竞态）——**该竞态在无 lever 的基线上独立复现，是 pre-existing
时序抖动**。实测：基线 12 次中 1 次红（baseline/2），lever 套件 8 次中 2 次红（after/5、verify/1）；
抖动机制完全相同（session-liveness 进程计数竞态）。lever 不引入该抖动。
