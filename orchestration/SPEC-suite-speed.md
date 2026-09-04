# 规格:让套件本身变快(人 2026-08-03 裁定的方向 C)

> **RETIRED (2026-08-06)**：本规格中依赖 `heavy-op-token.sh`（跨项目「一次只跑一个重测试」令牌）的
> 机制已整体删除——人裁定「彻底删掉 heavy-op-token.sh 及其调用/相关逻辑，不再处理一次只跑一个重测试
> 逻辑」（gap-session-liveness-remove-shared-events-and-lock）。套件提速的其余内容（并发/负载闸
> `resource-gate.sh`/成本计量）不受影响。本文件保留为历史记录。

**人的裁定**:测试瓶颈的三个方向里选 **C——套件本身变快**。
明确**不选** A(降低 DoD)和 B(令牌粒度细化)。
⇒ **「连跑 2 次全绿」这道闸不动**。C 是唯一不牺牲判据的路,代价是见效慢。

## 0. 已有的实测(不要重测,要用)

| 量 | 值 | 含义 |
|---|---|---|
| 单次全量套件 | **402.9–896.6s**(7–15 分钟) | |
| run-to-run 极差 σ | **297.6s** | **比很多「优化」的效果还大** |
| Σ(各文件耗时) / wall | **7.1**(4 核) | **不是 CPU 瓶颈**——是启动/等待 |
| 每任务 DoD | 连跑 2 次 | 6 次串行套件 = 42–90 分钟 |

**σ = 297.6s 是本规格最重要的数字。** 它意味着:
**任何小于 ~300s 的「改善」在单次对照里不可区分于噪声。**
archguard 已经在 σ 纪律下产出过一个诚实的「无改善」结论(TASK-57),照它那个做法。

## AC

- **AC1(先测分布,不先优化)**:产出每个测试文件的墙钟分布,并明确指出**最慢的单个文件**。
  当前并发下 **wall 的下界就是那个文件**——在它之上做任何并发优化都买不到东西。
- **AC2(分解成本结构)**:把一次运行拆成**进程启动 / IO 等待 / 真实计算**三部分并给出占比。
  Σ/wall = 7.1 已经说明不是 CPU;**要拿到的是「那 7.1 倍到底耗在哪」**。
- **AC3(不许先定阈值)**:**在 AC1/AC2 的数据出来之前,不许设任何速度目标**。
  这是 AC9/416s 那个错误的原样重演:**给一个尚未测量的量定指标**。
- **AC4(σ 纪律,硬要求)**:任何「变快了」的主张必须**同一改动跑 ≥5 次**,
  并给出改动前后的**均值与极差**;**改善量必须大于 σ 才算数**。
  单次对照一律不接受,不论看起来多显著。
- **AC5(负控制)**:选一个**理论上不该影响速度**的改动(如改一行注释),
  用同样的测法跑一遍——**若它也「变快了 200s」,说明测法本身在骗人**,先修测法。
- **AC6(闸不动)**:全程不得放宽「连跑 2 次全绿」,不得缩小 canonical glob,
  不得把慢文件移出套件充数。**把测试删掉不叫变快。**
  > **Cross-annotation (2026-08-07, `gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge`)**:本 AC6 的「闸不动」
  > **继续有效**。闸是**批量合边界的全量套件绿**（`fast-mode-loop-tick.md` 红窗规则:red 阻 `$MERGE_TARGET`→
  > `$FORK_BASELINE`），那条闸**原封不动**。移除的是**任务级 DoD 的重复**（「完整套件连跑 2 次全绿」——
  > 825 任务中 92 条），不是放宽闸。**保护总量不变，耦合消失。**
- **AC7(报真数)**:最终报告必须同时给出**改善前后的绝对秒数**,不许只报百分比——
  百分比会把「896.6→402.9 其实是同一分布的两端」说成 55% 的改善。

## 明确不做

- 不动令牌粒度(方向 B,人已排除)
- 不降低任何 DoD 判据(方向 A,人已排除)
- 不在拿到 AC1/AC2 数据前动任何实现

## 实测结果(2026-08-04,gap-suite-speed-under-a-297-second-sigma)

**测法**:`bash scripts/test.sh`(默认 group product,engine,concurrency 8,与裁定一致),每次记录 wall 秒数。
before 用基线 commit,control 用仅加一行注释的 commit(AC5 负控制),after 用 lever commit(嵌套调用跳过冗余 setup)。
每次运行前过重型令牌(resource-gate full-suite),全程无并发全量套件。本机无 `/usr/bin/time`,用 `date +%s.%N`
(测的是同一个量:真实流逝秒)。

| 阶段 | 5 次 wall (s) | 均值 | 极差 |
|---|---|---|---|
| before | 759.768, 788.262, 804.660, 761.832, 781.120 | **779.128** | 44.892 |
| control(仅注释) | 782.676, 757.583, 779.252, 806.423, 745.651 | **774.317** | 60.772 |
| after(lever) | 689.684, 688.435, 705.533, 696.806, 696.374 | **695.366** | 17.098 |

- **AC5 负控制通过**:control 均值比 before 快 **4.8s**(极差 44.9-60.8s 内噪声),未出现 >σ 的"变快" → 测法诚实。
- **AC4 结论**:before−after 均值差 = **83.762s**,远小于 σ = 297.6s ⇒ **诚实判定:未达 σ 纪律的"变快";
  报一个小于 σ 的改善等于报噪声**。按任务 DoD(archguard TASK-57 先例),"诚实的无改善"是合法且有价值的结论。
- **AC7 报真数**:改善前后绝对秒数为 779.128 → 695.366(均值),非百分比。

### AC1:最慢的单个文件
spec reporter 给出最慢单文件:**`packages/quay/test/cli.test.mjs` = 140.9s**。
但真正的 wall 下界是 **`plugin/test/runner-grouping.test.mjs`**(其耗时按 test 计,不显示为文件行):
它的 6 个测试合计 ~477s 串行,其中单个测试 "AC1/AC2/AC6: flags-only forms run the same test count as
the group default" = **427.6s**(内部 3 次完整 governance 子套件)。AC1 的"在它之上做并发优化买不到东西"
正是指这条串行链。

### AC2:成本分解(进程启动 / IO 等待 / 真实计算)
wall=781.1s,node --test duration_ms=767.7s,34 个文件耗时和=396.8s。
- **setup(构建+全库静态检查)= ~13.4s = 1.7%**(外层调用自己的 build_dist_once + run_static_checks)。
- **真实测试执行 ≈ 750s = 96%+**:runner-grouping 的 3 次 governance 子套件 ~427s(cli.test.mjs 141s 之外
  的最大单项);governance 组(35 文件 529 测试)在跳过 setup 的隔离运行下 c8=133.9s / c2=198.5s——
  被真实等待主导(session-liveness 33 处 sleep、tmux `sleep 20`、heavy-op-token-wait),是 IO 等待不是计算。
- **嵌套调用冗余 setup(lever 目标)**:runner-grouping 内 6 次嵌套 `scripts/test.sh` 各自重复静态检查+构建,
  负载下每次 ~10-20s;after 实测总省 ~84s。
- Σ/wall 高 + c8/c2=1.48 ⇒ 套件是"启动/等待"为主(本规格 §0 已断言),不是 CPU 瓶颈。

### lever(本次改动)
`scripts/test.sh` 增加 `mark_nested()`(在 5 个 node --test 执行点前标记 QUAY_TEST_NESTED +
QUAY_TEST_NESTED_ROOT),嵌套调用继承后跳过重复的 dist 构建+全库静态检查(同根守护,不同 worktree 不跳过)。
AC8 测试 `plugin/test/suite-speed-nested-skip.test.mjs`(governance,node:test,结构式断言,不 spawn)。
Touches 内唯一可减成本;AC6 闸未动(glob 184→185 是 AC8 加测试,不是缩小;全程 fail 0 / cancelled 0,
除 session-liveness M6 一次真实时序抖动,见任务体)。
