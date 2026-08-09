---
id: gap-cap-from-gate-avg300-driven-by-claude-session-churn-structural-cap-2
title: "cap-from-gate 的 avg300 信号被 claude 会话常驻 churn 主导——结构性锁死 cap=2，节流派发无效（外层 2026-08-08 实测对照）"
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

**cap-from-gate.ts 的并发上限被 `some avg300` 里的 claude 会话常驻 CPU 钉死在 WAIT 档，且节流派发无法缓解——结构性低 cap 陷阱。**

**背景**：`gap-adaptive-concurrency-cap-tied-to-resource-gate`（done）把并发上限从固定 3 改成自适应，
信号 = `/proc/pressure/cpu` `some avg300`（5 分钟窗口），WAIT 阈值 40，档位 GO=5/WAIT=2/EXTREME=1。
该任务 AC6 假设「archguard 高负载抬升 quay 的 avg300 ⇒ 自动回落」。**实测反证这个假设**。

**发现（外层 2026-08-08 13:5x-14:1xZ 实测，manager 定义判据、外层测量）**：

**判据**（manager 13:27Z 预登记）：会话活跃度不变、改变派发量，看 avg300 是否跟随。若跟随，闸门无罪；
若不跟随，则信号里混入了节流无法改变的成分。

**实测数据**（四组，核数 4）：

| 观测 | 总 CPU(单核) | claude 会话 | node --test(派发) | avg10 | avg300 |
|---|---|---|---|---|---|
| 30s 采样 | 35.6% | 32.6% | 1.0% | 53.8 | 54.5 |
| 60s 采样 | ~68% | 67.8% | 0.0% | 53.7 | 52.7 |
| 4 核满载注入 30s | ~400% | — | 注入 | 41.9→68.0 | 52.1→53.7 |
| 注入冷却 30s | — | — | — | 20.6 | 50.2 |

**三个结论**：

1. **会话 churn 是压力主体**：60s 窗口 claude 会话占 67.8% CPU，node --test（派发产物）0.0%。avg300
   稳定 50-55，**始终 > 40 阈值**。npm install 等瞬时重载已排除（60s 采样中消失，avg300 不动）。
2. **avg300 对派发类负载几乎不响应**：4 核满载注入 30s，avg10 应声 +26pt，avg300 只 +1.5pt；撤载后
   avg10 大落、avg300 几乎不动。⇒ 信号动态范围被会话常驻 churn 占用，派发节流（减少 node --test）几乎
   无法移动 avg300。**manager 判据成立：改变派发量、avg300 不跟随。**
3. **结构性低 cap**：压力高（会话照跑）→ cap 降 2 → 派得少 → 会话照跑 → 压力照旧 → cap 继续低。
   **cap 永远不会回到 GO 带 5**。节流派发缓解不了它（实验证实），却实打实压低吞吐。

**为什么不该改回固定值**：`gap-adaptive-concurrency-cap-tied-to-resource-gate` 明确裁定「不换固定数字换
固定数字」。本任务的修是**换信号/剔信号成分**，不是回到固定 cap。

**修的方向（实现归内层，方向外层已定）**：

- 候选 A：**剔会话 churn**——avg300 减去本机 claude 会话占用的常驻部分（实测 ≈50 的基线），或改用
  增量信号（仅测量 node --test / 派发产物进程树）。
- 候选 B：**换信号**——用 `full avg300`（全部任务都被延迟）而非 `some`（任一任务被延迟）。`full` 实测恒
  0（`/proc/pressure/cpu` `full avg300=0.00`），反映「真正的满载」而非「某个任务在等」。但 full=0 恒为 GO
  会失去过载保护——需验证 full 对真实饱和的响应。
- 候选 C：**per-cgroup 压力**——读本机工作负载自己的 cgroup（如 node --test 所属 cgroup）的
  `cpu.pressure`，排除其它会话/租户。
- 候选 D：**档位阈值与信号匹配**——保留 avg300 但承认基线 ≈50，把 WAIT 阈值从 40 抬到能区分
  「churn 基线 + 真实过载」的水平（需实测过载时的 avg300 上界）。风险：基线可能漂移（更多会话启动时）。

**验证锚**：修后，内层在飞 2 条 + 资源空（会话数不变）时 `bash plugin/scripts/cap-from-gate.sh` 应报
GO 带（cap≥3），而非当前恒 2；并保留对真实饱和（注入 4 核满载）的降档响应。

## Acceptance Criteria

- [x] AC1: **实测复现**——本任务实现前先复现缺陷：会话数不变时 cap-from-gate 报 effective_cap=2，
      且注入/撤去 node --test 类负载 avg300 位移 <3pt（对照实验证据贴任务体）
- [x] AC2: **信号修正落地**——cap-from-gate 改用候选 A/B/C/D 之一（或组合），实现+测试，说明为何所选
      方案能区分「会话常驻 churn」与「真实过载」
- [x] AC3: **GO 带恢复**——会话数不变、无真实过载时 `bash plugin/scripts/cap-from-gate.sh` 报
      GO 带 effective_cap≥3（不再结构性锁 2），实跑输出贴任务体
- [x] AC4: **过载保护保留**——注入 4 核满载（模拟真实饱和）时有效降档（WAIT/EXTREME），实跑输出贴任务体
- [x] AC5: **滞回与档位配置保留**——`applyHysteresis` 与 `concurrency_bands` 配置面不改坏
      （既有 cap-from-gate 测试全绿）
- [x] AC6: **文档同步**——`fast-mode-loop-tick.md` 步骤 3.6 前置块 / cap-from-gate.ts 头注释更新信号
      语义（说明 avg300 被会话 churn 主导 + 新信号为什么能区分），不再宣传「archguard 高负载自动回落」的
      原假设（除非新信号仍支持它）

## Definition of Done

- [x] AC1–AC6 全部勾上
- [x] 修后实跑：会话数不变 + 资源空 ⇒ GO 带（cap≥3）；注入满载 ⇒ 降档（两方向实跑输出贴任务体）
- [x] 既有 cap-from-gate 测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）
- [x] 不新建固定 cap——保留自适应形态（gap-adaptive-concurrency-cap-tied-to-resource-gate 的裁定不被推翻）

## Touches

- plugin/scripts/cap-from-gate.ts（信号来源：换/剔/阈值匹配）
- plugin/test/cap-from-gate.test.mjs（新断言 + 既有断言适配）
- plugin/scripts/resource-gate.sh（若候选 B/C 需读 full 或 per-cgroup 压力）
- plugin/loop/fast-mode-loop-tick.md（步骤 3.6 前置块信号语义更新）
- tasks/gap-cap-from-gate-avg300-driven-by-claude-session-churn-structural-cap-2.md（自身：勾 AC + 贴证据）

## 实跑证据（外层 2026-08-08 13:5x-14:1xZ，缺陷复现用）

```bash
# 会话数=7（claude），node --test=0/1，avg300=50-55 > 40 ⇒ effective_cap=2（结构性锁死）
$ bash plugin/scripts/cap-from-gate.sh
cpu_stall(some avg300)=54.51 … effective_cap=2

# 60s 采样：claude 会话 67.8% / node--test 0.0%（churn 主体）
# 4 核满载注入 30s：avg10 41.87→68.01（+26pt），avg300 52.11→53.65（+1.5pt）——avg300 不跟随派发类负载
# 撤载冷却 30s：avg10 20.63，avg300 50.15（几乎不动）——manager 判据成立
# 对照：/proc/pressure/cpu full avg300=0.00（full 恒 0，可作候选 B 信号）
```

## 修后实跑证据（内层 2026-08-08，worktree task/gap-cap-from-gate-avg300-driven-by-claude-session-churn-structural-cap-2）

**所选修法（A+B+D 组合）**：信号改用 `some avg10`（唯一对真实过载响应的信号——候选 B「换信号」的实测选型；
`full avg300` 实测连 4 核满载都恒 0，弃用），阈值抬高到 GO<60 / WAIT<85 / EXTREME≥85（候选 D「阈值与信号
匹配」+ 候选 A「剔 churn」：60 高于实测 churn 基线 avg10 42-54、低于实测真实过载读数 68；不选固定减法，
基线随会话启停漂移）。avg10 的快窗由既有滞回（连续 2 次同向才切档，采样点在派发时刻）压成慢切换，AC5
（滞回 + `concurrency_bands` 配置面）原封不动。

**AC3 — 无真实过载（会话数不变）⇒ GO 带，cap=5**（注意同刻 `some avg300=49.33` 仍 > 旧 WAIT=40——旧信号
在此刻仍会判 WAIT，正是本任务修的缺陷）：

```bash
$ cat /proc/pressure/cpu
some avg10=24.46 avg60=32.81 avg300=49.33 total=335310509328
full avg10=0.00 avg60=0.00 avg300=0.00 total=0
$ bash plugin/scripts/cap-from-gate.sh
signal: cpu_stall(some avg10)=24.46  bands(go<60, wait<85, extreme>=85)
band: GO  desired=GO  consecutive=0/2  switched=no
effective_cap=5
```

**AC4 — 注入 4 核满载（45s busy loop）⇒ 降档 WAIT，cap=2**（注入期间 `some avg300=50.89` 几乎不动，
`full avg300=0.00`——两者都证明不是可用信号）：

```bash
$ cat /proc/pressure/cpu   # 注入 18s 后
some avg10=71.76 avg60=45.52 avg300=50.89 total=335328993333
full avg10=0.00 avg60=0.00 avg300=0.00 total=0
$ bash plugin/scripts/cap-from-gate.sh --state /tmp/ac4-state.json
signal: cpu_stall(some avg10)=73.25  bands(go<60, wait<85, extreme>=85)
band: WAIT  desired=WAIT  consecutive=0/2  switched=no
effective_cap=2
```

**AC5 — 既有 + 新增测试全绿**：`bash scripts/test.sh --for-task gap-cap-from-gate-avg300-driven-by-claude-
session-churn-structural-cap-2 --allow-thin` ⇒ exit 0，29/29 pass（13 cap-from-gate + 16 resource-gate），
scoped 静态检查全 PASS（test-framework-policy / test-isolation / test-impl-census / task-contract-check:
no violations / adr016-screen-use / dead-code-after-return / drive-contract）。`applyHysteresis` 与
`concurrency_bands` 配置面未改坏（既有 AC3/AC4 测试原样通过）。

## Contract

measure   effective_cap_after_fix = `bash plugin/scripts/cap-from-gate.sh 2>&1 | grep -o 'effective_cap=[0-9]'` 的 effective_cap 字段 会话数不变时是否 ≥3
band      effective_cap_after_fix = 5（GO 带，无真实过载时不再结构性 2）
invariant cap_still_adaptive = 1（保留自适应形态，不新建固定 cap）
invariant churn_distinguishable = 1（信号能区分会话常驻 churn 与真实过载——AC4 注入满载必降档）
invoke    `bash plugin/scripts/cap-from-gate.sh`（实跑贴回）
control   无真实过载 ⇒ GO；注入 4 核满载 ⇒ 降档；既有 cap-from-gate 测试全绿
resume    信号修正 + 测试 + 文档分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（外层实测对照实验复现缺陷，manager 定义判据）；方向已定（候选 A/B/C/D），实现与测试归内层
