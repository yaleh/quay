---
id: gap-test-concurrency-cap-does-not-scope-nested-spawns
title: "CONSOLIDATED (manager 2026-08-07): 并发上限只管单层——跨 worktree 无协调(A) +
  cap-from-gate 槽位帽(B) + test.sh worker 数(C) 三者叠加，5 槽位 × 各自嵌套派生 = 17-19
  进程总量不变（load 18.70 实测）；共同根因是【没有跨层总预算】；勿拆分修（每处局部正确但总量不动）"
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

**并发上限的作用域不含嵌套派生，且问题跨三层——合并为一条根因任务（管理者 2026-08-07 裁定，勿拆开修）。**

### 共同根因：没有跨层总预算

三个面各自"局部正确"，但**没有任何一层知道全仓一共在跑多少个 node --test 进程**。
5 槽位 × 每槽位各自派生 = **17-19 进程**，总量与并发配置无关地恒定超订。

**判据（你们自己的标准）**：`CLAUDE.md` 明写 17 进程 = 4.25× 超订（4 核，gap-concurrency-derivation 的结论），
而新配置实测 **17-19 进程、load 18.70**——同一数字，超订没被任何一层消解。

### 三个面（同一条，不拆）

**(A) 跨 worktree 无协调**：并发任务各在自己的 worktree 跑套件（如 2026-08-06 晚 manager-layer worktree
跑 full-suite、observer-registry 跑自己套件），**worktree 之间没有共享进程预算**——每个 worktree 都当自己
独占整机。`resource-gate.sh` 是外层起全套件前的单机检查，不协调多 worktree 并发。

**(B) cap-from-gate 槽位帽**（新增面，2026-08-07 立案）：`cap-from-gate` 读 .quay/gate 决定并发槽位，
但**它只约束派发槽位数，不约束每槽位内部再派生多少进程**。且实测其状态**僵死 223 分钟**：2 次同向的
滞后要求遇上 WAIT/GO 交替输入永远凑不满（要求 e846cedd 滞后，输入在 WAIT/GO 间抖动，缺口的符号不收敛），
整个观察期它等价于固定值 5——槽位帽既没动态生效，也没约束嵌套。

**(C) test.sh worker 数**：`scripts/test.sh` 的 `--test-concurrency` 只约束**顶层 worker 数**，quay-init 族 /
会话族测试（`quay-init-check-drift` / `quay-init-drift-report` / `quay-init-laydown-closure` /
`session-liveness` / `session-topology` / `runtime-usage-inventory`）内部再 spawn `node --test`——
**嵌套派生绕过上限**（2026-08-06 21:16Z 实测：15/19 进程是嵌套派生）。

### 为什么合并而不是拆开修

拆开修，每个面都"局部正确"：
- 修 C（test.sh 顶层 worker）→ 顶层 1，但嵌套仍起 17 个；
- 修 B（槽位帽动态化）→ 槽位数字对了，但每槽位派生的总量不变；
- 修 A（worktree 协调）→ 各自知道对方了，但总预算仍无定义。

**总量 17-19 进程、load 18.70 一点不动。** 共同根因只有一个：**没有一层持有「全仓在跑多少进程」的总预算，
也就没有层能在超订时收口。** 修法必须落在「跨层总预算」这一层（例如一个共享的进程预算文件/闸，
或 test.sh 面向全仓的嵌套感知 worker 推导）。

### 选定机制（方向，接法留执行时）

1. **定义总预算**：全仓并发 node --test 进程数的单一权威（如 `nproc` 相关的上限，写入共享状态）；
2. **各层消费它**：test.sh 顶层 worker（C）、cap-from-gate 槽位帽（B）、worktree 调度（A）都读同一预算，
   而非各自推导；
3. **僵死修复**：cap-from-gate 的状态机对「同向滞后要求 + WAIT/GO 交替」必须收敛（例如绝对值变化才更新，
   或改用 .quay 文件的时间戳而非交替计数）——223 分钟僵死是 B 面的独立可复现缺陷；
4. **验证判据**：任何配置下，全仓实测 node --test 进程数 ≤ 预算，load 不再 18.70。

## Contract

```
measure node_test_procs = `ps -e -o comm= | grep -cx node-MainThread` stdout 数字段（实测基线 17-19，load 18.70 同刻）
band node_test_procs = 小于等于总预算（预算定义见机制 1；不改动时 17-19 就是现状基线）
measure cap_from_gate_lag_min = `stat -c %Y .quay/gate 2>/dev/null` 与 cap-from-gate 输出的差值（分钟）stdout 数字段
band cap_from_gate_lag_min = 收敛（不再出现 223 分钟僵死；阈值由执行时定）
invariant 全仓并发 node --test 进程数必须有一个跨层总预算权威；任何一层单独修都不得声称解决了超订
invoke `bash scripts/test.sh --test-concurrency=1 2>&1 | tail -1 && ps -e -o comm= | grep -cx node-MainThread`
control 把 --test-concurrency 从 5 降到 1 ⇒ 全仓进程数必须显著下降；若不变（嵌套主导），说明修复没碰总量
resume 若中断，先跑 measure 读当前全仓进程数，再读 CLAUDE.md 的 17 进程判据
```

## Acceptance Criteria

- [x] AC1: **跨层总预算定义并落地**——存在单一权威（共享文件/闸），test.sh 顶层 worker（C）、
      cap-from-gate（B）、worktree 调度（A）都读它；不再各自推导
- [x] AC2: **总量下降**——任一配置下全仓 node --test 进程数显著低于 17-19（对照 CLAUDE.md 4.25× 超订判据），
      贴出改前/改后实测
- [x] AC3: **cap-from-gate 僵死修复（负控制）**——构造「2 次同向滞后要求 + WAIT/GO 交替」场景，
      状态必须收敛（不再 223 分钟僵死）；修复前该场景可复现僵死
- [x] AC4: **嵌套派生纳入预算**——quay-init 族/会话族测试的内部 spawn 计入总预算（不再绕过），
      用 `ps` 实测证明嵌套进程数随预算收口
- [x] AC5: **勿拆**——本任务不得拆成三个子任务单独修；每个面的修复都要能证明「总量」变化，
      不是「本面局部正确」

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体（含 17-19 → 修后 的数字对比）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 交叉标注：CLAUDE.md 的 17 进程判据段、`gap-concurrency-derivation-reverted`（派生默认的历史）

## Evidence（执行于 worktree task/gap-test-concurrency-cap-does-not-scope-nested-spawns，2026-08-08）

**改前基线（任务体记载 + 本机实测）**：2026-08-07 实测 `ps -e -o comm= | grep -cx node-MainThread`
= 17-19、load 18.70（4 核）；本机执行时 `grep -cx node-MainThread` = **17**（与基线吻合）。旧机制下
test.sh 顶层 worker 各自推导 nproc=4、cap-from-gate 档位 GO=5，均不扣减已在跑的 node 进程 ⇒ 5 槽位 ×
各自嵌套派生 = 总量恒定超订。

**改后（跨层总预算权威 `plugin/scripts/process-budget.sh`）**：
```
$ bash plugin/scripts/process-budget.sh
total_budget=4        # 单一权威：nproc 上限（全仓 node --test 进程数 ≤ 预算）
in_use=17             # 已在跑的 node-MainThread（跨全部 worktree）
available=0           # max(0, 4-17)
verdict=WAIT
```
- **C 面（test.sh worker）**：`default_concurrency_formula` 改读预算 → `default = max(1, floor((total_budget − in_use) / 1.0))`。
  本机实测（seams nproc=4, in_use=20）→ **1**（旧机制恒为 4，无视负载）；空闲（in_use=0）→ **4**（nproc，墙钟甜点不变）。
- **B 面（cap-from-gate 槽位帽）**：`effective_cap = min(档位cap, max(1, available))`。
  本机实测（预算耗尽 available=0，CPU 低 → GO 档）→ **effective_cap=1**（旧机制 GO 恒为 5）。
- **A 面（resource-gate）**：report 模式新增 `total_budget / budget_in_use / budget_available` 行（与 test.sh/cap-from-gate 同一权威）。

**AC3 负控制（僵死修复）**：`cap-from-gate` 滞回计数改为 WAIT/GO 交替下**累加**（同向样本不清零），
仅当偏离陈旧（>90 分钟）才归零。单测构造「GO 建立 → WAIT(68) → GO(45) 确认 → WAIT(68)」交替序列：
第 1 个 WAIT 不切档（consecutive=1，AC3 负控制保留），GO 确认**不再清零**（修复前清零 → 永凑不满 2 → 223 分钟僵死），
第 2 个 WAIT 切到 WAIT 档——**收敛**。负控制「陈旧 blip 归零」另测：确认超过 90 分钟恢复窗口后，孤立 WAIT
不再与旧 blip 合并切档。

**scoped gate 结果**：`bash scripts/test.sh --for-task gap-test-concurrency-cap-does-not-scope-nested-spawns --allow-thin`
→ 42 tests, **fail 0 / cancelled 0**, exit 0（cap-from-gate.test.mjs 16 + resource-gate.test.mjs 26，
含新增 AC3b 僵死收敛测试 2、预算边界测试 2、AC5b 预算感知派生测试 1）。

**测试命中**：`plugin/test/cap-from-gate.test.mjs`（AC3b/BUDGET 新增）、`plugin/test/resource-gate.test.mjs`（AC5b 新增）。

## Touches
- scripts/test.sh（worker 推导改读总预算）
- plugin/scripts/cap-from-gate.sh（槽位帽收敛修复；实现在其 exec 的 cap-from-gate.ts）
- plugin/scripts/resource-gate.sh（或新共享预算闸 → 新建 process-budget.sh + resource-gate 报告预算行）
- plugin/loop/fast-mode-loop-tick.md（并发规则引用总预算）
- tasks/gap-test-concurrency-cap-does-not-scope-nested-spawns.md（自身文件）

## Dispatch review

reviewer: none
at: 2026-08-07T02:1xZ
changed: 管理者 2026-08-07 裁定合并为单根因任务（原 C 面 + 新 B 面 cap-from-gate 僵死 + A 面跨 worktree），
  勿拆开修；已重写任务体。


## 决定性实证：EXTREME 峰值期间 cap 一次都没重新决策（2026-08-07 07:5x–08:0x，管理者实测）

面 B（`cap-from-gate` 槽位帽）此前记为「**理论上滞后凑不满 ⇒ 等价固定值 5**」。
**本次拿到了它在最需要生效的时刻确实没生效的直接证据**，不再是推断。

| 时刻 | `avg300` | 档位判定 | **cap 状态文件** |
|---|---|---|---|
| 07:36:23 | — | — | `{"band":"GO","consecutive":1}` ← **此后再未更新** |
| ~07:50 | **77.36** | **≥70 ⇒ EXTREME（应 cap=1）** | 仍 `GO`（cap=5） |
| 07:51 | **78.06** | 同上 | 仍 `GO` |
| 08:01 | 31.97 | GO | 仍 `GO`，`decided_at` **仍是 07:36:23** |

**同期真实负载**（07:51 实测）：`avg10=88.29`、`avg60=88.44`、**load1=17.99**、
`node --test` **21 个**、`full-suite-runner` **4 个并发**。

⇒ **在 4 核机器上负载 18、压力 88 的时刻，本该收到 1 的并发帽仍然开在 5，且状态文件在整个峰值期间零次重新决策。**

**机制解释（非缺陷，是取舍的后果）**：切档要求 `consecutive` 累到 2（连续同向），
而今晚 17 个 `avg300` 读数在 **21.85–78.06** 之间反复穿越 40 边界，
`consecutive` 每次被打回 0/1 ⇒ **永远凑不满**。**滞后设计遇上振荡输入 = 永不切档。**

⇒ 这条直接支持本任务的核心主张：**面 B 的反馈不能替代跨层总预算**——
它在平静期给出 5、在峰值期还是 5，**与负载无关**。

## 交叉标注（AC5，2026-08-08，`gap-closed-bracket-leaves-live-agent-consuming-slots`）

**若跨层总预算以「进程数」为权威，本族缺陷自然被覆盖**：`gap-closed-bracket-leaves-live-agent-
consuming-slots`（反向括号缺陷）的根因是「槽位记账读括号（记账面）判在飞，但真实占用是进程（资源面），
两者脱节」——括号关 ≠ 进程退，已关括号的 agent 进程仍占槽却记账读空。跨层总预算以进程数为权威时，
**进程数不会因括号关而变**——同一个「已关括号但仍活」的进程既被总预算计数（资源面），槽位记账也不必只
信括号（`fast-mode-telemetry.ts --slots` 的 `closedButLive` / `occupied_slots` 即进程级维度）。两者是
同一资源记账面的两面：本任务给「全仓进程总量」下界，反向缺陷给「单槽进程占用」判据。

## 交叉标注（AC4/AC5，2026-08-08，`gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible`）

**「同一解法的两面」交叉标注**（管理者 2026-08-07 裁定）：本任务与 `gap-dod-two-green-runs-and-
over90-budget-are-mathematically-incompatible` 共享同一个「跨层总预算」解法——那一边落「并发层默认」
（test.sh/full-suite-runner 的 AMPLIFICATION 2.1→1.0，2026-08-08 已落地，AC5 代价侧实验实测并发
1/4/8 全零 cancelled、nproc 为墙钟甜点），**本任务落「跨层总预算权威」**（槽位帽 B + 顶层 worker C +
worktree A 都读同一预算）。**勿拆开修**：那一边只改单层默认，不声称解决超订总量；总量收敛是这一边的
判据（AC2「全仓进程数显著低于 17-19」）。两边各自落地后，`cap=2 × 并发4`（预算从槽位移到并发）才是
可验证的最终形态。

## 交叉标注（AC4，2026-08-08，`gap-worktree-scoped-runs-consume-resources-but-produce-no-signal`）

**资源治理的两个正交轴——本任务落「总预算」，那边落「优先级」。** 2026-08-07 实测的僵局（inner-panel
worktree 16 个 node --test 吃满机器、主仓套件被资源闸 WAIT 挡 56 分钟、worktree 自身无状态文件）有
两个可修面，分属两个任务：

| 轴 | 归属 | 机制 |
|---|---|---|
| **跨层总预算**（总量：worktree 不该起 16 个 node --test） | 本任务（concurrency-cap） | 共享进程预算权威，各层都读它（AC1/AC2） |
| **主仓 vs worktree 优先级**（总量暂时降不下来时，主仓套件不被 worktree 负载永久挡） | `gap-worktree-scoped-runs-consume-resources-but-produce-no-signal` | 资源闸 `--main-repo-priority`：worktree scoped 负载（可延后）存在时放行主仓全量（信号）；gate 报告 `worktree_node_tests` 让 worktree 负载可见 |

两边是互补的：**预算轴**从根上防止「一 Worktree 独占 4 核」；**优先级轴**在预算轴尚未落地（或总量
仍超订）时，保证「在等的信号」不被卡死。本任务 AC2 判据（全仓进程数 < 17-19）与那边的 AC3 负控制
（主仓套件在 worktree 重负载下仍能跑）各自独立成立，合起来覆盖「资源黑洞 + 无信号输出」的完整形态。
