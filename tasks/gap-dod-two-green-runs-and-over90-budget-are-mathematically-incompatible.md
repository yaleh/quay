---
id: gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible
title: "RETRACTED (manager 2026-08-07, 59404ee6): 83% math premise was wrong —
  the full suite is the OUTER's async closure gate, NOT inside the inner's
  OVER90 bracket (bracket runs --for-task scoped); surviving + more valuable
  finding: concurrency trade-off never measured (8→1 = definite ~7×, cancel-risk
  unproven, test.sh:342-347, AC5 experiment never run); direction shifted: move
  the same CPU budget from slot layer → concurrency layer (same solution two
  faces as gap-test-concurrency-cap cross-layer budget);
  observer-registry(106m)/manager-layer(102m) overrun cause UNKNOWN, needs
  separate investigation"
status: todo
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

**83% 算式前提撤回（管理者 2026-08-07，责任在管理者，commit 59404ee6）——但幸存发现更有价值。**

### 撤回：为什么 83% 是错的

原算式：2×37.5min 套件 = 74.9min = OVER90 90min 预算的 83%。**前提错误**：

`docs/analysis/fast-mode-loop-tick.md` §DoD 明写——**全量套件「连跑 2 次全量全绿」是外层异步收尾的闸**，
inner 不跑全量（默认无参路径只读 `.quay/full-suite-state.json` 的 state），inner 括号里跑的是 `--for-task`
选中集（秒级 scoped，不触资源闸）。⇒ **74.9 分钟的全量根本不发生在 inner 的 OVER90 括号内**——83% 对不上
任何真实存在的预算。管理者 2026-08-07 撤回（原文：「错误是我供的，不是你的」），任务标题与论证据此修正。

### 幸存且更有价值的一条（本次新发现）

`scripts/test.sh:342-347` 的 REVERT HISTORY 注释（单源真相）记录了一个**从未被验证的权衡**：

| 并发 | 全量套件墙钟 | 来源 |
|---|---|---|
| 8 | **~8 分钟**（460-570s wall） | test.sh:342-347 注释 |
| 1 | **~55 分钟**（Σ≈3300s） | 同注释 |
| sigma | ≈ **7.1** @ 8 lanes（"saturated, not overloaded"） | 同注释 |

**三个未决点**：
1. **代价侧从未实测**：`"lower concurrency to avoid cancel"` 是 **unproven**——没有任何实验证明并发 8 会
   cancel；而降并发的代价是 **definite ~7×**（55min vs 8min）。
2. **AC5 权衡实验从未跑**：只测了放大侧（17/8 = 2.125，进程放大），**没测代价侧**（cancelled 是否真出现）。
3. **pin 是 EXPLICITLY temporary**：2026-08-03 的 8-pin 明写「REVERT this override once AC5's tradeoff
   experiment is run」——2026-08-06 已 revert 回派生公式，但实验始终没跑。

### 人的推论（2026-08-07，管理者判断成立）

**历史数据在更高并发下显著更低 ⇒ 更高测试并发是【曾经的常态，不是推断】。** 若提高测试并发需要降低
inner subagent 并发，可接受——只要任务真能完成、有吞吐率。数学上划算，因为两层对关键路径作用不对称：
**槽位只是把慢任务复制多份，并发直接缩短单任务墙钟，而 OVER90 恰恰是单任务墙钟问题。**

- `cap=5 × 并发1`（≈10 进程，单任务 37.5-55min） vs `cap=2 × 并发4`（≈17 进程，单任务 ~8-15min）：
  **后者吞吐更高且不踩线。**

### 方向转移

从「三选二松哪条判据」改为 **「把同一份 CPU 预算从槽位层挪到并发层」**——与
`gap-test-concurrency-cap-does-not-scope-nested-spawns`（跨层总预算）**同一解法的两面**。
本任务与它交叉标注，不重复立机制。

### 唯一仍需实测

**AC5 代价侧**：并发 4/8 时 cancelled 是否真会出现。**在证明之前，用「确定的 7× 代价」换「未被证明的
收益」，方向是反的。** 实验设计（代价侧）：同一选中集分别在并发 1/4/8 下连跑，贴出 cancelled 计数与
墙钟——若并发 4/8 零 cancelled，则「避免 cancel」的理由不成立，降并发是纯损失。

### 越线根因另查（不归因 DoD）

observer-registry(106m)/manager-layer(102m) 越线是**实测事实**（都经进程血统核实为真在跑），
但**归因于 DoD 是错的**。原因【尚未查明】——AC0 单独查（与并发预算方向分开）。

## Contract

```
measure suite_wall_8 = 并发 8 下全量套件墙钟（秒）——基线 460-570（test.sh:342-347 注释记录）
measure suite_wall_1 = 并发 1 下全量套件墙钟（秒）——基线 ~3300（同注释）
measure cancel_count = `grep -c 'cancelled [1-9]' .quay/full-suite.log` stdout 数字段（并发 4/8 实跑时）
invariant 降并发（1）的代价是确定的 ~7×；「避免 cancel」的收益是 unproven——在代价侧实验前，不得把并发 1 当最优
invoke `grep -n 'REVERT HISTORY' scripts/test.sh | head -2`
control 同一选中集在并发 1/4/8 各跑一次 ⇒ 并发 8 若零 cancelled，则「avoid cancel」理由不成立；若 cancelled>0，贴出是哪条
resume 若中断，先跑 measure 读当前并发默认与套件墙钟，再读 test.sh:342-347 的 REVERT HISTORY 原文
```

## Acceptance Criteria

- [ ] AC0: **越线根因另查**——observer-registry(106m)/manager-layer(102m) 各查清为什么真在跑却超 90min
      （进程血统 + 各阶段耗时分解），**不预设归因于 DoD**（该归因已被撤回）
- [ ] AC1: **代价侧实验（本任务最关键）**——同一选中集在并发 1/4/8 各跑一次，贴出 cancelled 计数 + 墙钟
      （验证 test.sh:342-347 的 unproven 声明）
- [ ] AC2: **方向落地**——把同一份 CPU 预算从槽位层挪到并发层（与 concurrency-cap 跨层总预算同一解法），
      贴出 cap/并发配置前后对比（吞吐 + 单任务墙钟）
- [ ] AC3: **负控制**——若并发 4/8 出现 cancelled，必须点名文件与计数；若零 cancelled，记录「avoid cancel
      理由不成立」，作为恢复并发 8 的依据
- [ ] AC4: 与 `gap-test-concurrency-cap-does-not-scope-nested-spawns` 交叉标注（同一解法两面）

## Definition of Done

- [ ] AC0-AC4 实跑输出贴进任务体（含并发 1/4/8 三档 cancelled 与墙钟对照表）
- [ ] 并发配置按实验结论落地，单任务墙钟回到 ~8-15min 档（不踩 OVER90）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——按最终并发配置

## Touches
- scripts/test.sh（并发推导：实验结论后不再 pin 1；REVERT HISTORY 注释更新）
- plugin/scripts/cap-from-gate.sh（若并发档位与槽位联动）
- docs/analysis/fast-mode-loop-tick.md / orchestration/orchestrator-loop-tick.md（并发/预算判据段）
- tasks/gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible.md（自身文件）
- tasks/gap-test-concurrency-cap-does-not-scope-nested-spawns.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T02:3xZ
changed: 管理者 2026-08-07 撤回 83% 前提（commit 59404ee6，责任在管理者），任务据此重写：保留
  concurrency 权衡幸存发现（test.sh:342-347）、方向转移为「预算从槽位层挪到并发层」、越线根因 AC0 另查。
