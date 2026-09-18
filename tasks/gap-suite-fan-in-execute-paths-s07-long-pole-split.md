---
id: gap-suite-fan-in-execute-paths-s07-long-pole-split
title: 测试套件剩余地板 fan-in-execute-paths-s07 32.4s（AC-281 落地后实测 scheduler
  44.4s）——按功能边界拆到 ~21s 以下
status: ready
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-281
---
**type:** execution

## Proposal

**缺口（落地后实测，⛔ 非估算）**：`gap-ac281-develop-ci-test-job-wallclock-under-30s` 已落地
（fan-in 于 2026-09-18T01:07:31Z，`cf06fcf8c`），套件 scheduler 从 **54.2s 降到 44.4s**，
但**离 AC-281 的 30s 还差 14.4s**。

落地后第一条 develop run **35294113108** 的日志自身读数：
```
__OVERHEAD__ run_static_checks_ms=2923  main_phase_ms=41945  serial_phase_ms=19003
             lowconc_phase_ms=18517  scheduler_ms=44356
__GROUP__ concurrency=128 files=754 sum_ms=1509264 floor_ms=32421
```
`__PERFILE__` 前 12 名（全量排序，⛔ 非抽样）：

| 耗时 | 文件 |
|---|---|
| **32.4s** | `plugin/test/fan-in-execute-paths-s07.test.mjs` |
| 19.3s | `packages/quay/test/branch-model.test.mjs` |
| 19.1s | `plugin/test/supervisor-deliver-crosshost.test.mjs` |
| 19.0s | `plugin/test/full-suite-runner-phases.test.mjs` |
| 18.6s | `plugin/test/closure-lag-check.test.mjs` |
| 18.4s | `packages/quay/test/observation.test.mjs` |
| 16.6s | `plugin/test/driver-cli.test.mjs` |
| 16.1s | `plugin/test/worker-driver.test.mjs` |

⇒ **当前唯一地板 = `fan-in-execute-paths-s07` 的 32.4s**（`floor_ms=32421` 就是它）。
sum 1 509 264 / 128 并发 = **11.8s** 的理想 makespan，实测 main 41.9s —— 差额全被这一个文件吃掉。
⇒ 达标条件：`scheduler ≈ run_static_checks_ms(2.9) + main`，要 ≤30s ⇒ `main ≤ 27.1s`；
按同一次 run 实测的 `main/floor = 41945/32421 = 1.29` 外推 ⇒ **要把最长单文件压到 ~21s 以下**。
⛔ **抬并发无效**（已在两轮里各实测一次：LPT 模拟下并发 64/128/256/512 的 makespan 恒等于最长单文件）。

⚠️ 上表的 1.29 外推是**推断**，不是直接量；本任务 Plan 第 1/4 步要用**任务分支自己的 CI run** 实测取代它。

### 与既有任务的关系（机制去重）

- `gap-ac281-develop-ci-test-job-wallclock-under-30s`（**done**）：它已拆掉 6 个长杆
  （`driver-anchor`、`fan-in-execute-paths-s07` 的一半、`supervisor-deliver` 等），
  本任务接手**剩余的那个地板**。⛔ 不要重做已拆的那 6 个。
- **兄弟任务（并行，Touches 不相交）**：`gap-inner-wakeup-heartbeat-refusal-shard-ci-red`
  —— 它修的是**本任务收口的前提**：AC-281 判据要求「最新一条 post-filing develop run 的 test job = success」，
  而当前最新那条因那个分片是红的。两者要**都绿**，AC-281 才可能收口（⛔ 本任务不背它的锅，见 AC6）。

## Plan

1. **先重取一次 CI 剖面（⛔ 不照抄上表，且必须用 CI 自己的读数）**：
   在**任务分支上**触发一次真实 CI（`gh workflow run ci.yml --ref task/<本任务 id>`），
   用 `gh run view <runId> --json jobs -q '.jobs[]|select(.name=="test")|.databaseId'` +
   `gh api repos/yaleh/quay/actions/jobs/<jobId>/logs --allow-escape-sequences` 取日志，
   全量解析 `__PERFILE__ duration_ms=` 行并降序排序。
   ⛔ **本地 16 核的 perFile 是代理量**（实测同一文件两地偏差最高 2.55×，方向不定）——用它会把地板认错。
2. **拆 `fan-in-execute-paths-s07`（32.4s）**：按**功能边界**拆成 2–3 个分片，使每个 ≲ 15s。
   ⛔ **拆分必须行为保持**，且本轮已有一个**反例**：`gap-ac281-…` 拆出的新分片
   `inner-wakeup-heartbeat-refusal.test.mjs` 在 CI 上红（母文件同 run 绿、helper 逐字相同）⇒
   **拆完必须【逐个分片单独跑】**（`node --test <shard>`）确认与母文件同绿，⛔ 不能只跑套件整体。
3. **新分片要登记 AC121 reattribution**：跑
   `node --experimental-strip-types plugin/scripts/suite-bucket-reattr-ratchet-check.ts --gate`
   必须 `pass`（层 1 是 blocking：未登记的纯 S 新分片直接打红）。取值用 `attributeBuckets(...)` **实测**，⛔ 不猜。
4. **在任务分支上再触发一次 CI，读改动后的 `__GROUP__ … floor_ms=`**：确认 ≤ **21 000**。
   不足 ⇒ 按新剖面继续拆下一个长杆（那 19s 簇：`branch-model` / `supervisor-deliver-crosshost` /
   `full-suite-runner-phases` / `closure-lag-check` / `observation`）。
5. **落地并触发 develop CI**，贴出新地板的 `__GROUP__` 行与 `scheduler_ms`。
6. **收口前提（如实记录，⛔ 不要替它背锅）**：AC-281 判据要的是「**最新一条** post-filing develop run 的
   test job = success」。若那条 run 红在**别的文件**（当前是 `inner-wakeup-heartbeat-refusal.test.mjs`，
   由兄弟任务负责），本任务**如实指向真凶**，⛔ 不写成"本任务失败"。

## AC

- [ ] **AC1（地板有改动前后各一次 CI 实测）**：贴出**任务分支上**两次 CI run 的 `__PERFILE__` 剖面（同一命令），
      指出改动前的**地板文件与其耗时**、改动后的**新地板与其耗时**。⛔ 无前后对照的项如实记为**未处置**，
      ⛔ 不得以本地读数冒充 CI。
- [ ] **AC2（行为保持，逐分片自证）**：每个新分片都**单独**跑过 `node --test <shard>` 且绿（贴命令与结果）；
      ⛔ 只跑套件整体不算——本轮已有「整体绿而分片红」的反例。
- [ ] **AC3（AC121 登记未破）**：`suite-bucket-reattr-ratchet-check.ts --gate` 在改动后仍 `pass`，
      贴出它打印的 `PASS — reattribution ratchet: …` 行原文。
- [ ] **AC4（地板降进 band）**：改动后**任务分支 CI** 的 `floor_ms ≤ 21 000`（贴 `__GROUP__` 行原文）；
      未达到 ⇒ 给出下一次要拆的文件与它在同一 run 里的**实测耗时**（⛔ 不写"继续优化"这类无读数的句子）。
- [ ] **AC5（不是靠少跑换来的）**：改动后同一 run 的 `testFiles` ≥ **754**（= 落地后读数）；
      若下降，给出被合并/移走文件的完整映射与理由，并说明为什么套件覆盖没有下降。
- [ ] **AC6（生产面兑现，外层验证）**：落地并触发 develop CI 后，贴出 run id、该 run 的 `scheduler_ms`
      与 `test` job `conclusion` ——属外层验证（待外部）
      ⛔ 若 `conclusion != "success"`，**如实指向真正红的那个文件**（当前是
      `inner-wakeup-heartbeat-refusal.test.mjs`，归兄弟任务），⛔ 不得记成本任务自己的失败。

## DoD

**REAL LANDING**：不是"本地快了"，而是 **CI 上地板真的降进 band、且每个分片都能单独自证**：

1. **落地对象**：任务分支 CI run 的 `__GROUP__ … floor_ms=` 实测值（≤ 21 000）+ develop run 的 `scheduler_ms`。
2. **可被打红**：AC2 的逐分片自证 + AC3 的 ratchet 读数。
3. **不许用「跑得更少」换**：AC5 的 `testFiles` 读数。
4. **收口顺序**：明确记录本任务与 `gap-inner-wakeup-heartbeat-refusal-shard-ci-red` 的先后；
   ⛔ 不得把「因为别处红所以 AC-281 不绿」写成自己的失败。

## Touches

- plugin/test/fan-in-execute-paths-s07.test.mjs
- plugin/test/fan-in-execute-paths-s11.test.mjs
- plugin/test/fan-in-execute-paths-s12.test.mjs
- .quay/suite-bucket-reattribution.jsonl
- tasks/gap-suite-fan-in-execute-paths-s07-long-pole-split.md
