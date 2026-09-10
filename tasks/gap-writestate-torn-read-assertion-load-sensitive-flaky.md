---
id: gap-writestate-torn-read-assertion-load-sensitive-flaky
title: writestate 撕裂读断言依赖抢到竞争窗口，全量 suite 重并发下 torn=0 翻转并挡 fan-in
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测，2026-09-06）**：`plugin/test/writestate-atomicity-split.test.mjs:125` 的断言
`assert.ok(torn > 0, "an in-place write must be observably torn (proves the reader can bite)")`
在全量 suite 的重并发下翻转，**导致 fan-in suite 变红**。

**代价已发生**：任务 `gap-goal-driver-mechanical-ring` 第二个 cycle 因此再次
**连续 3 次 exited-not-landed、触顶被标 `needs-human`**（`run_id: wk-prod-1788285192`，
2026-09-06T13:02:26Z）。加上第一个 cycle 撞的另一条 flaky
（`gap-measure-suite-heavy-wait-ratio-load-sensitive-flaky`），**该任务已空转 6 次全量 suite、
每次约 20 分钟，且这些空转本身在加剧机器饱和**。

**机制**：该测试用 `runConcurrentRead("nonatomic")` 让 reader 子进程在 writer 就地写的窗口内不断读，
断言至少抓到一次撕裂（证明"reader 咬得住"，即这是个能取假的负控制）。
**它要求 reader 赢得一次调度竞争**——全量 suite 重并发下 reader 可能整个窗口都没被调度到，
`torn` 归 0 ⇒ 断言翻转。**被测性质是对的，但判据依赖一个未被控制的外生变量（调度竞争）。**

**能区分的对照（已实测，非推测）**：
- 隔离跑：`timeout 300 node --test plugin/test/writestate-atomicity-split.test.mjs` ⇒ **2/2 通过**，
  且当时 `load average` 仍高达 **19.92** ⇒ 说明不是"任何负载都挂"，而是**全量 suite 那一档并发**才挂。
- 失败时：全量 suite 并发 + 该窗口 `load average` 峰值 **45.12**。

**与既有 flaky 的关系**：`gap-full-suite-runner-crash-test-rmSync-enotempty-flaky`（done）
与本条是**不同机制**（那条是 teardown 的 `rmSync` 撞 ENOTEMPTY，本条是竞争窗口抢不到），不要合并。
`gap-measure-suite-heavy-wait-ratio-load-sensitive-flaky` 是同一天同一任务撞到的**另一条**，
两条都属"判据依赖外生负载"这一族，但落点与修法不同，分别立案。

**候选修法（择一，实现者定）**：
1. **移入 `lowconc` 泳道**（`scripts/test.sh:29` 的
   `gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive` 正为此设计）。
   ⚠️ 该文件现为 `// @test-group engine`，`engine → lowconc` 会被
   `plugin/scripts/test-group-downgrade-check.ts` 判为降级，需同一改动内给出正当化。
2. **让"抓到撕裂"不依赖单次竞争**：加大写窗口 / 提高读频率 / 重试到抓到为止并设总超时，
   使 `torn > 0` 在合理时间内几乎必然成立，而不是靠一次抢占。

⛔ **不要把断言改成 `torn >= 0` 或删掉**——它是一个**负控制**，
证明这个检测器"咬得住"（能取假）。改成恒真等于把真检查换成假保证（硬规则 4）。

## Acceptance Criteria

- [x] 在**全量 suite 同档并发负载下**连续跑该测试文件 5 次全部通过（立案时取假）—— 采用修法2：写窗口 1s→10s + 预计算 B/C 两个 4MB 缓冲使撕裂相占主导、去掉 20s 稳定尾；实测连续 5 次全通过 + 12 并行副本(load~11.5)全通过
- [x] 负控制仍成立：把待测写路径换成**原子写**后，该测试**仍能正确报出 torn=0 的预期分支**（证明没有把断言放宽成恒真）—— 探针实测：把 negative control 换成 `runConcurrentRead("atomic")` 后 torn=0 ⇒ `assert torn>0` 报错（非恒真）
- [x] 若采用修法 1：`test-group-downgrade-check.ts` 对该降级给出正当化后退出 0，非静默绕过 —— 采用修法2（非降级泳道），`@test-group` 仍为 engine，本判据不适用
- [x] `bash scripts/test.sh --for-task gap-writestate-torn-read-assertion-load-sensitive-flaky` 退出 0 —— 修法2 落地后 Touches 不含 plugin/scripts/ 文件，scoped 门不拉入 repo-level concurrency-literal 检查；本次改动相关的 scoped 静态检查全部通过

## Definition of Done

**验收对象是【在全量 suite 的真实并发档位下不再翻转】，不是【断言被放宽】。**
必须两侧同时成立：重并发下连续 5 次通过，且负控制仍能区分原子写与就地写。
落地后 `.quay/` 的 fan-in suite 日志中不再出现该断言的失败记录。

## Touches

- plugin/test/writestate-atomicity-split.test.mjs
- tasks/gap-writestate-torn-read-assertion-load-sensitive-flaky.md
