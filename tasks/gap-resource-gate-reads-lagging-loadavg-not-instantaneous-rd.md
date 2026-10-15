---
id: gap-resource-gate-reads-lagging-loadavg-not-instantaneous-rd
title: 资源闸用带 1 分钟记忆的 loadavg 当「当前过载」判据 —— 实测 load1=209 而瞬时 R+D 仅 39；先把 R/D
  分量记进载体再判该换哪个量
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/resource-gate.sh` 的过载窗口判据读的是 **1-min loadavg**（`/proc/loadavg` 字段 1），阈值 `load >= nproc × RESOURCE_GATE_LOAD_OVER_FACTOR`（默认 2 ⇒ 本机 128 核 ⇒ 256）。

**本任务立案的直接量（2026-10-16 实测，本机 = tokyo-alpha = CI runner 宿主）**

**① 历史回归：load 确实预测红。** 数据源 `.quay/verification-round.jsonl`，2748 条同时带 `load` 与 `state` 的套件轮（剔除 6 条 `reason=aborted`，那是闸拒跑本身，纳入即循环论证）：

| load 区间 | n | red 率 |
|---|---|---|
| 0–25 | 1426 | 30.2% |
| 25–50 | 1124 | 34.7% |
| 50–75 | 138 | 55.8% |
| 75–100 | 27 | 88.9% |
| 100–150 | 26 | 96.2% |
| 150–200 | 4 | 100% |
| 200–256 | 2 | 50% |
| 256–∞ | 1 | 0% |

对照：`load>=50` 红率 66.2% vs `load<50` 32.2%；`load>=100` 红率 90.9% vs `load<100` 33.9%。
⇒ **闸的前提有实据，且危险区从 load≈50 就开始；阈值 256 偏松，不是偏紧。⛔ 不得以「放宽」为方向。**

**② 但判据读的量是【滞后】的。** 本机连续 20 次采样（`procs_running`/`procs_blocked` 取自 `/proc/stat`，内核权威计数）：

```
t         load1     R     D    R+D
02:04:26  208.7    24    15    39     <- load1 是瞬时 R+D 的 5 倍
02:04:31  195.9    23    15    38
02:04:41  174.9    29    18    47
02:04:56  143.3    26    12    38
02:05:16  106.8     7     0     7
02:06:01   87.4     7    88    95     <- D 主导
```

loadavg 是 1 分钟指数滑动平均 ⇒ **它记得刚才那阵子，不是现在**。⇒ **闸可能在机器已经空下来时仍判 WAIT**（这正是「load 237 而 CPU 79% idle」的来源）。

⚠️ **成分是变化的**：同一段采样里 D 占比从 0% 跳到 92%，⛔ 不得概括成「这里是 D 主导」或「这里是 R 主导」——那正是本任务要测的东西。

**③ 结构性限制（⛔ 不得绕过、不得用 fixture 假装）**
- `procs_running` / `procs_blocked` 在**整个仓库从未被读过**（已 grep `plugin/scripts/`、`packages/quay/src/`、`scripts/`、以及全部 `.quay/` 载体）⇒ **R/D 分量的历史回归在数据上不存在**，只能从本任务落地后开始攒。
- 数据是**截尾**的：高于阈值的轮次被闸拒跑、**根本不产生记录** ⇒ 观测不到 load>256 的行为；上表 150 以上各桶 n=4/2/1，**不足以下结论**。

## Plan

1. 把瞬时分量记进载体：在套件轮记录与 load sampler 里，与既有 `load` **并列**新增 `procs_running` / `procs_blocked` / 瞬时 `R+D`（读 `/proc/stat`）。⛔ 本步**不改判据**。
2. 取负控证明闸行为**逐字未变**（注入式对照，见 AC2）。
3. 攒够样本后做**分量回归**：红率分别按 R 分量、D 分量分桶（⛔ 不是按合并后的 loadavg 分桶——那一步已经做过，见 Proposal ①）。
4. 出**判别性结论**：判据该换成瞬时 R+D、保留 loadavg、还是两者并用；写明支持/排除了哪个假说。
5. 若结论是改判据，改的时候必须保负控（AC5）。

## AC

- [ ] AC1: `procs_running` / `procs_blocked` / 瞬时 `R+D` 已与 `load` 并列写入套件轮记录与 load sampler；贴**一条真实新记录**的原文（注明它来自哪次真实运行）。
- [ ] AC2: **闸行为未变**的负控：用 `RESOURCE_GATE_TEST_LOAD_OVERRIDE` 注入同一组值，贴改动**前后**的资源闸输出对比，证明每条 WAIT/GO 判定逐字相同（⛔ 本步只许加字段，不许动判据）。
- [ ] AC3: **分量回归**：把红率分别按 `R` 分量、按 `D` 分量分桶各算一次；贴 n 与红率表，并写明样本来源（真实载体）与时间窗。
- [ ] AC4: **判别性结论**：给出「换判据 / 保留 loadavg / 并用」的结论，并写明它**支持或排除了**哪个假说。⛔ 不得只写「差别不大」——若结论是「保留 loadavg」，必须给出**证伪性对照**（即：若换成瞬时 R+D，读数会怎样不同）。
- [ ] AC5: 若 AC4 的结论是改判据，则必须保负控：注入**瞬时 R+D ≥ 阈值** ⇒ 仍必须 WAIT；并贴「loadavg 高但瞬时 R+D 低」那一刻的实际判定（必须与 AC4 的结论一致）。
- [ ] AC6: 改动只落在声明的 `## Touches` 内（贴 `git diff --name-only`）。

## DoD

- AC3 的回归表必须来自**真实生产载体**（`.quay/verification-round.jsonl`、load sampler、资源闸输出），⛔ fixture / 注入 / mkdtemp 自检**不算**；并写明样本的**时间窗与 n**。
- ⛔ 达成方式不得是：手工调 `RESOURCE_GATE_LOAD_OVER_FACTOR`、放宽阈值、删除或弱化 WAIT 分支、或把判据改成恒 GO。
- ⛔ 不得在**没有分量回归读数**的情况下就改判据；改造必须由 AC3 的数据推动。
- 若加了字段 ⇒ 贴一条**实现落地之后**产生的真实记录（硬规则 4 推论三：只证明「能产出」不算，要证明「已产出」）。

## Touches

- plugin/scripts/suite-load-sampler.ts
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/full-suite-runner-types.ts
- plugin/scripts/resource-gate.sh
- plugin/scripts/pre-verified-round-record.ts
- tasks/gap-resource-gate-reads-lagging-loadavg-not-instantaneous-rd.md