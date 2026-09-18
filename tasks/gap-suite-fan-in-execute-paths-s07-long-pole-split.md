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

- [x] **AC1（地板有改动前后各一次 CI 实测）**：任务分支上两次 `gh workflow run ci.yml --ref task/gap-suite-fan-in-execute-paths-s07-long-pole-split`，同一命令 `gh api repos/yaleh/quay/actions/jobs/<jobId>/logs` 解析 `__PERFILE__`/`__GROUP__`：
      改动前 run `35295064123`（`d0057085c`）地板 = `plugin/test/fan-in-execute-paths-s07.test.mjs` **32439ms**
      （`__GROUP__ concurrency=128 files=754 sum_ms=1524719 floor_ms=32439 capped=0`，`scheduler_ms=44391 main_phase_ms=41991`）；
      改动后 run `35295902178`（`1b56ed099`）地板 = `packages/quay/test/branch-model.test.mjs` **20371ms**
      （`__GROUP__ concurrency=128 files=755 sum_ms=1503860 floor_ms=20371 capped=0`，`scheduler_ms=38753 main_phase_ms=36361`）。
      **根因（改动前那 31.05s 是【一个 test】且不是"固有启动成本"）**：s07 文件内逐 test 实测
      `⑧ time-file guard 17.8ms / ⑧ time-file rm REAL 167.5ms / ⑧⑩ wait AC1 1153.3ms / ⑧⑩ 锁等待负控制 31053.3ms`；
      31053 ≈ 30000 + 1050（fake suite 自己的 `sleep 1`）⇒ 那 30.0s 是 **holder 的 `sleep 30` 没被释放**，
      ⛔ 不是 `ac281` 提交信息断言的「detached suite 固有启动成本」：同一 run 里跑**同一个** SUITE_LAUNCH 块、
      只是不持锁的兄弟 s11 `duration REAL` 全程仅 **8191ms**。
      机制：`flock` 属于**打开文件描述**，fd 被继承即描述存活 —— holder 是
      `bash -c "…; exec 8>lock.0; flock -n 8; exec 9>lock.1; flock -n 9; touch slots-held; sleep 30"`，
      bash **可能 fork** 末尾的 `sleep 30`（tokyo-alpha runner 上 fork 了；本机 bash 5.2 是 exec）⇒ 孤儿 `sleep`
      继续持有 fd 8/9 ⇒ `holder.kill("SIGKILL")` **不释放锁**，detached suite 卡在无界 `flock -w 1` 队列里直到
      holder_start+30s。CI 日志算术吻合：holder 起于 `01:23:35.8`，marker 落于 `01:24:06.7` = +30.0s + 1s。
      **修法**：holder 末句改 `exec sleep 30` ⇒ bash 进程**就是**持锁者，SIGKILL 必然关闭 fd 释放锁（任何 bash/任何宿主）。
      改动后同一 test 在 CI 上 **3225ms**（31053 → 3225，−89.6%），本地探针实测 kill 后 300ms 锁即 FREE、0 个孤儿 `sleep 30`。
- [x] **AC2（行为保持，逐分片自证）**：拆分为**逐 test 整体搬移**（唯一改动 = s12 里 holder 的 `exec`），
      标题集合机械对齐 `^test("…` **4 → 4 逐字相同**（无 test 被丢/跳/复制）。每个分片**单独**跑绿（改动后、merge develop 之后）：
      `node --test plugin/test/fan-in-execute-paths-s07.test.mjs` → tests 2 / pass 2 / fail 0（duration_ms 1457）；
      `node --test plugin/test/fan-in-execute-paths-s12.test.mjs` → tests 2 / pass 2 / fail 0（duration_ms 5502）；
      `node --test plugin/test/fan-in-execute-paths-s11.test.mjs` → tests 5 / pass 5 / fail 0（duration_ms 10404，本任务未动其内容）。
      改动后 CI 上三个分片均绿：s07 未进 top-14、s11 **9323ms**、s12 **4428ms**。
      `bash scripts/test.sh --for-task gap-suite-fan-in-execute-paths-s07-long-pole-split --allow-thin` → **exit 0**，`tests 9 / pass 9 / fail 0`。
- [x] **AC3（AC121 登记未破）**：`node --experimental-strip-types plugin/scripts/suite-bucket-reattr-ratchet-check.ts --gate` →
      `PASS — reattribution ratchet: 0 pure-S un-attributed test(s) (layer 1, blocking); 0 zombie entr(y|ies) (layer 3, blocking); 48 S-signal-multi un-attributed (layer 2, report-only)`（exit 0，层 2 计数与改动前**同为 48**）。
      取值**实测**：`attributeBuckets("plugin/test/fan-in-execute-paths-s12.test.mjs")` = `S`，`bucketSetOf` = `{S}`（纯 S）⇒ 登记 `judgment:"S"`。
      **负控制（该闸确实在评估，不是恒绿）**：登记**之前**同一命令输出 `FAIL — 1 pure-S suite test(s) with no reattribution entry (layer 1, blocking …)` 并点名 `plugin/test/fan-in-execute-paths-s12.test.mjs`，exit 1。
- [x] **AC4（地板降进 band）**：`__GROUP__ concurrency=128 files=755 sum_ms=1503860 floor_ms=20371 capped=0` ⇒ **20371 ≤ 21000** ✓（改动前 32439，降 37.2%）。
      ⚠️ 如实补两条读数（⛔ 不写"继续优化"）：①新地板 `packages/quay/test/branch-model.test.mjs` 距 band 上沿仅 **3.0%** 余量（该文件另一 run 实测 19259ms ⇒ 逐 run 波动 ~1.1s）；
      ②`main_phase_ms=36361` vs `sum_ms/128 = 11749ms` ⇒ 该 run 的**有效并发只有 ~41**，即 main 已是 **sum-bound 而非 floor-bound**
      —— 继续拆单文件**不会再降 `scheduler_ms`**；AC-281 的 30s 若仍要达成，下一个杠杆在「减少 sum」而不在「拆分片」（本任务不再动，⛔ 不在 Touches 内）。
- [x] **AC5（不是靠少跑换来的）**：改动后同 run `testFiles = 755`（`__GROUP__ … files=755`）≥ 754 ✓。
      本任务**只增不减**：`bash scripts/test.sh --list-files` 842 → 843 条，新增的正是 `plugin/test/fan-in-execute-paths-s12.test.mjs`；
      ⛔ 无文件被合并、移走或跳过，s07 保留原 2 个 test 而非删除。
- [ ] **AC6（生产面兑现）**：落地并触发 develop CI 后，贴出 run id、该 run 的 `scheduler_ms` 与 `test` job `conclusion` ——属外层验证（待外部）
      ⛔ 本 worker 交付时刻该项**结构上取不到读数**（ff 落地与 develop CI 都在本 worker 之后，由 driver 的 fan-in 执行），
      故**保持未勾**（⛔ 不得记为通过——那正是本条禁止的）——外层 verification-round 验证。
      ⛔ 若 `conclusion != "success"`，**如实指向真正红的那个文件**（当前是
      `inner-wakeup-heartbeat-refusal.test.mjs`，归兄弟任务），⛔ 不得记成本任务自己的失败。

## DoD

**REAL LANDING**：不是"本地快了"，而是 **CI 上地板真的降进 band、且每个分片都能单独自证**：

1. **落地对象**：任务分支 CI run 的 `__GROUP__ … floor_ms=` 实测值（32439 → **20371**，≤ 21 000）+ develop run 的 `scheduler_ms`（待外层）。
2. **可被打红**：AC2 的逐分片自证 + AC3 的 ratchet 读数（登记前 FAIL / 登记后 PASS 的对照）。
3. **不许用「跑得更少」换**：AC5 的 `testFiles` 读数（754 → 755，只增不减）。
4. **收口顺序**：本任务先（地板 32439 → 20371），`gap-inner-wakeup-heartbeat-refusal-shard-ci-red` 修那条分片红；两者都绿后 AC-281 才可能收口。
   ⛔ 不得把「因为别处红所以 AC-281 不绿」写成自己的失败。

## Touches

- plugin/test/fan-in-execute-paths-s07.test.mjs
- plugin/test/fan-in-execute-paths-s11.test.mjs
- plugin/test/fan-in-execute-paths-s12.test.mjs
- .quay/suite-bucket-reattribution.jsonl
- tasks/gap-suite-fan-in-execute-paths-s07-long-pole-split.md
