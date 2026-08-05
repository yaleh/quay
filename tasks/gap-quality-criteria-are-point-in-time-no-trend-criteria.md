---
id: gap-quality-criteria-are-point-in-time-no-trend-criteria
title: "all quality criteria are point-in-time (was it green this time / does this contract conform) — none is a trend criterion (is it more expensive than last time / closer to the goal); the per-test-cost trend 0.251→0.464→0.321 (net +28%) worsened a whole day before anyone asked; add a per-run metrics recording + trend-flag category as the manager layer's quality function"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`SYNTHESIS-four-gaps-2026-08-05.md` 缺口 3：**多维度质量——只覆盖了「正确性」，没覆盖「趋势」**。

**已有的质量维度**（都在工作，不是问题）：正确性（2298 测试）、契约合规（7 个静态检查 + mutation
check）、架构（ADR/archguard）、对抗审查（2 轮上限）、DoD 闸门。

**今晚暴露的未覆盖维度**：
| 维度 | 证据 | 谁在看 |
|---|---|---|
| **成本趋势** | 每测试成本 0.251→0.464→0.321 秒（净 +28%），恶化了一整天才被人问出来 | **无人** |
| **方法论漂移** | inner 串行执行、batch 语义渗透、措辞改了行为没改 | 靠人观察 |
| **战略对齐** | 路线图过期 3 天 | **无人** |
| **机制自身健康** | closure-async 落地不完整、ready-pool-check overshoot | 撞上了才发现 |

**共同形态**：现有质量体系全部是**点状判据**（这次跑绿了吗、这条契约合规吗），**没有一条是趋势判据**
（比上次更贵了吗、离目标更近了吗）。**趋势判据是个新品类。**

**归属**：看趋势是 manager 层的职能（`gap-productize-the-manager-layer` umbrella 的职能之一）；
本条实现该职能，归属该层。

### 选定机制（外层裁定）

**加「趋势判据」品类**——记录每次运行的指标 + 对窗口内的回归打标：

1. **每运行指标记录**：全量套件每次跑记录 `{at, durationMs, tests, fail, cancelled, per_test_ms}` 到
   一个运行时文件（复用 `.quay/full-suite-state.json` 或 verification-round 记录，扩 schema）；
   **runner 已写 suite-state，趋势是读它历史**。
2. **趋势打标**：对最近窗口（如 N 次全量或 24h）算 per-test 成本斜率；**恶化超阈值（如 +10%/窗口）
   打标报出**——「比上次更贵了吗」有机械答案。
3. **首个实例 = 成本趋势**：以 0.251→0.464→0.321（净 +28%）为回归控制——该序列必须能被趋势判据
   捕获（恶化已被人肉发现，机制要能复现它）。
4. **归入 manager 层复盘**：趋势打标进每日复盘（REVIEW-cadence）的检查项——复盘不只是「这次绿了吗」，
   还看「比上次更贵了吗 / 离目标更近了吗」。

**不引入新调度**：趋势是**读已有记录**的被动判据（suite-state / verification-round 历史），不是新的
运行触发；外层 cron 或复盘时跑。

## Acceptance Criteria

- [ ] AC1: 全量套件每次跑记录指标到运行时文件（`{at, durationMs, tests, fail, cancelled, per_test_ms}`，
      复用 suite-state/verification-round，扩 schema 不新建）
- [ ] AC2: **趋势打标**——最近窗口 per-test 成本斜率；恶化超阈值打标报出（「比上次更贵了吗」有机械
      答案）；阈值可配
- [ ] AC3: **回归控制**——0.251→0.464→0.321（净 +28%）序列必须能被趋势判据捕获（实跑输出贴任务体）
- [ ] AC4: 趋势判据**归入每日复盘**——REVIEW-cadence 检查项加「比上次更贵了吗 / 离目标更近了吗」
      （点状之外的趋势检查）
- [ ] AC5: **不引入新调度**——趋势是读已有记录（suite-state/verification-round 历史）的被动判据，
      非新运行触发
- [ ] AC6: 归属 manager 层——与 `gap-productize-the-manager-layer` 交叉标注
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC3 实跑输出贴任务体
- [ ] 「比上次更贵了吗」有机械答案（非人肉问出来）；趋势判据是复盘常项
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/（趋势判据：读 suite-state/verification-round 历史 + 打标；或扩 runner 记录 schema）
- plugin/test/（AC3 回归控制 + AC2 断言）
- orchestration/REVIEW-cadence.md（AC4：复盘加趋势检查项）
- tasks/gap-productize-the-manager-layer.md（AC6 交叉标注）

## Contract

measure   trend_flags = `node --experimental-strip-types plugin/scripts/trend-check.ts`（或等价）stdout 的打标数组
band      trend_flags = 0（窗口内恶化必打标，无漏报）
invariant trend_is_passive = 1（读已有记录，非新运行触发）
invoke    `node --experimental-strip-types plugin/scripts/trend-check.ts --window <N>`
control   0.251→0.464→0.321 序列 ⇒ 必被捕获（AC3）；平坦序列 ⇒ 不打标（负控制）
resume    指标记录与趋势打标分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T03:3xZ
changed: 外层读 SYNTHESIS 缺口 3 裁定立案。四处收紧：
(1) **趋势判据是新品类**——现有全是点状（这次绿了吗），趋势（比上次更贵了吗）是缺口，归属 manager 层；
(2) **被动判据**——读已有 suite-state/verification-round 历史，不引入新调度；
(3) **回归控制**——0.251→0.464→0.321 必须能被机械捕获（人肉发现的实例要能被机制复现）；
(4) **入复盘常项**——每日复盘加趋势检查，不是一次性。
status: todo——排 manager 层 umbrella + 价值排序之后；战略层职能机制。
