---
id: gap-suite-wallclock-budgets-literals-depend-on-host-capacity
title: 负载敏感测试钉死墙钟预算——字面阈值只在「当前机器产能」下成立，满载必红（3 本：observation AC1 /
  worker-driver-resident AC1·AC3 / ts-typecheck-gate 接线）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：`gap-load-sensitive-tests-read-live-host-class-level-seam` 的 AC5 五本处置表——那本收口的是「测试读**宿主读数**」这一类；本条是它的**兄弟机制**：量不是「读到的一个值」，而是**经过的墙钟时间**。⇒ seam（把宿主读数注入）**套不上**：注入时钟只会把断言变成空转（用假时钟测性能＝什么都没测），所以必须另立案。

**三个实例（实测读数取自 `.quay/verification-round.jsonl`，2026-09-13 核）**：

| 文件 | runs/fails | 失败率 | 妨害的不同任务数 | 钉死的量 |
|---|---|---|---|---|
| `packages/quay/test/observation.test.mjs` | 701 / 25 | 3.57% | 15 | AC1 冷请求 <3s / 预热 <500ms（实测红时 32.4s～65.2s） |
| `plugin/test/worker-driver-resident.test.mjs` | 611 / 17 | 2.78% | 13 | AC1/AC3 的 `waitFor(…, 10000)` |
| `packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs` | 532 / 5 | 0.94% | 5 | M63 D1 跑真 ts-typecheck 门（`.quay/config.yml` `timeoutMs` 120000） |

**共同的形态（硬规则 4 推论二）**：这三个字面量之所以「合理」，只因为它们**恰好**匹配当前这台 16 核机器的产能。换一台更忙的机器，它们就静默变成真限制，而且没有任何检查会报出来——报出来的是**受害任务的套件轮**。

**「再抬一次数字」已经被走过，且没按住**：`observation` 的阈值由人 2026-09-01 裁定从 1.5s/200ms 放宽到 3s/500ms（`gap-observation-ac1-perf-threshold-relax`，done），**放宽后仍 25 次红**；`worker-driver-resident` 的 `waitFor` 已从 5000 抬到 10000（见该测试体内注释），**仍红**；ts-typecheck 门的 `timeoutMs` 已从 60000 抬到 120000（`.quay/config.yml:95-98` 的注释自己写着「~25s 隔离 / >60s 满载」），**仍红**。⇒ 本条的修法**不得**是第三个数字。

## Plan

1. 逐处判断该断言**真正要守的性质**：
   - `observation` AC1 的真性质是「冷请求**不付全量历史遍历**」——这是结构性质，可用 instrument 计数（请求路径上是否发生了全量 walk/子进程数）直接量表示，⛔ 不该用墙钟代理；
   - `worker-driver-resident` AC1/AC3 的真性质是「常驻循环**最终**会派发第二个」——`waitFor` 的上限是防挂死的安全网，不是断言本身，可改成读宿主的推导值或直接去掉上限（由循环停条件收口）；
   - ts-typecheck 门是**真接线检查**（跑真 `npx tsc --noEmit`），其 `timeoutMs` 必须至少按宿主核数与实测基线推导，⛔ 不是再写一个更大的字面量。
2. 每一步的取值来源必须写成**读宿主**（`nproc` / 同轮同 N 的前后对照基线 / instrument 计数），⛔ 禁裸字面量。
3. 硬规则 5b：本条是**类级**收口，落完一处后 grep 同形态（`waitFor(..., <数字>)` / 裸墙钟阈值）的兄弟实例，把命中数与前 3 条贴进提交。

## Acceptance Criteria

- [ ] AC1（字面量零残留，⛔ 非布尔）：三处的裸墙钟字面量全部消除，且每处都能指出新取值的来源量（读哪个宿主量 / 哪个同轮基线）。判据：`git diff` 中不再出现「依赖宿主产能的裸数字阈值」，并在提交信息里逐处写出取值来源。
- [ ] AC2（双向对照，可取假）：三处各在①近空载 ②人为制造满载（load ≥ nproc）两种条件下各跑 ≥3 次并落盘 `.quay/wallclock-budget-evidence.jsonl`。判据：两种条件下**判定一致**，每条读数带 `condition` `passed` `durationMs`。⛔ 取假形态：两种条件判定不同 ⇒ 未达成。
- [ ] AC3（可告伪，防空转）：人为把宿主推导值压到极小 ⇒ 对应用例必须**红**。判据：干跑一次，退出码非 0，命令与输出尾部贴进读数段。⛔ 取假形态：压到极小仍绿 ⇒ 该判据已被改成空转（硬规则 3b）。
- [ ] AC4（结构量替代代理量，⛔ 非布尔）：`observation` AC1 的「不付全量遍历」改用可读产物（instrument 计数）。判据：附**一次回退干跑**——把优化回退后该计数必须变化，证明它确能取假（硬规则 4）。
- [ ] AC5（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后三本的 `perFile` 失败率下降。判据：给出五元读数（落地时刻 / 落地前 runs·fails / 落地后窗口 runs·fails / 窗口长度 / 不同任务数），落地后窗口 runs < 20 ⇒ 记 not-evaluated 并写明 runs 数。

## Definition of Done

- 三处不再有「依赖宿主产能的裸字面预算」；每处的取值来源可指认。
- `.quay/wallclock-budget-evidence.jsonl` 含 AC2 的真实双向读数；AC4 的干跑读数在案。
- ⛔ 本条**不新增**比现状更松的阈值（第三次数值放宽＝未达成）。
- ⛔ 本条**不动**泳道机制（`gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in` / `gap-serial-lowconc-reclassify-post-waterline-cap` 的范围）。

## Touches

- tasks/gap-suite-wallclock-budgets-literals-depend-on-host-capacity.md
- packages/quay/test/observation.test.mjs
- plugin/test/worker-driver-resident.test.mjs
- packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs