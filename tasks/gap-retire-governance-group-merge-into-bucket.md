---
id: gap-retire-governance-group-merge-into-bucket
title: 退役 @test-group governance 第三套机制——并入 bucket（人裁定「不要在 bucket
  和相机制以外再搞一套」），142 文件改标真实相
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

> **✅ AC5 已人裁（2026-08-26），翻 ready**：人逐字「等锁时间不计入上述预算。在此前提下，full bucket 可以放宽到 900s。超过就应当触发测试优化。」→ 选 (a) 真全量，预算 900s/纯执行/排除等锁，超限触发测试优化。裁定原文 + 4/6 突破表记进 AC5。

## Proposal

**人 2026-08-25T19:4xZ 逐字裁定**：「这应当并入现有 bucket 机制。不要在 bucket 和相机制以外再搞一套。能应用现有 bucket 或创建新 bucket 均可。」

`@test-group governance` 是本仓库**第三套「要不要跑」机制**，与 bucket 冗余。manager 读码/grep 现状（标注核实态）：

**① 三套机制并存，一套多余**：相（serial c=1 / lowconc c=3 / 主池 c=nproc）答「什么并发下跑」，正交保留；bucket（suite-bucket-select.ts 从 touched paths 推触发桶）答「这次要跑哪些」，fail-closed；governance 用静态标签 + 文件内自跳过守卫，且**唤回路径不存在**——多余的第三套。

**② governance 的按需唤回结构性空**（三处独立核实全零命中）：ci.yml 仅 `--test-concurrency=8` 无 --group；full-suite-runner.ts grep --group=0；全仓库无「定期 --group governance」安排。⇒ 实现自跳过的那批文件**没有任何自动路径跑它们**。最刺眼：`checker-mutation-check.test.mjs`（变异测试所有注册检查器、防静默破坏）就在这批里，现有证据下**从未被自动执行过**。

**③ 142 governance 文件只有 39 个有守卫、103 个没有**（逐文件 grep 核实）。⇒「parked/self-skip」承诺对 72.5% 文件不成立，它们一直在主池满并发真跑（今天翻车的 worker-driver.test.mjs / full-suite-runner.test.mjs 都在 103 里）。

**④ bucket 已正确跑它们**（并入方案成立的基础）：`scripts/test.sh:1444-1445`「Explicit file list (no --group): QUAY_TEST_GROUPS stays unset, so in-file skips do not trigger」；bucket 产出正是显式文件列表 ⇒ bucket run 里 governance 守卫全部失效、文件照跑。⇒ governance 跳过只在默认全量轮（QUAY_TEST_GROUPS=product,engine）生效。

**⑤ 142 文件 bucket 归属**（复用 suite-bucket-attribution.ts 正则 python 复算，⛔ 非正本工具，实现前须实跑核对）：S+M 70 · S 43 · UNRESOLVED 10 · M 8 · P+S+M 8 · P+M 2 · P 1。⇒ **132/142 已落现有 P/S/M**，剩 10 个全是 exp5 计量/图表类（chart2-s1/s2/s3、portfolio-choice、vmeta-lag、rolling-slope、deliverable-governor、outward-vt、preparation-feedback + integration-batch-merge），subject 在 experiments/quay-perpetual-stream/scripts/。

## Plan

1. 退役 governance 作为「选择/跳过」语义，删掉 39 段文件内自跳过守卫。
2. 142 文件改标真实相：默认 engine；负载敏感（含今天两 flake）标 serial/lowconc——同时修掉今天两 flake 根（本该隔离却在主池裸跑）。
3. 「这次要不要跑」此后只由 bucket 回答。132/142 现有桶覆盖；10 UNRESOLVED 落安全侧（每次 bucket run 都跑）或新开桶（触发=experiments/quay-perpetual-stream/scripts/）。
4. ⛔ **实现前实跑 `suite-bucket-attribution.ts` 对这 10 个取真值**（manager 已用正本工具实跑：**10/10 全 UNRESOLVED**，EXP_SCRIPTS_PREFIX→PLUGIN_SCRIPTS_PREFIX 镜像折叠对它们一个都没生效——「可能部分能解析」已证否）。⇒「10 个落安全侧还是新开桶」是**真决策**（不开桶则永久安全侧、每次 bucket run 都付它们时间），别用 grep 近似当结论。

**⚠️ 实现前必须解决的冲突（须人裁，⛔ 不代拍；事实基础已更正 2026-08-25）**：退役 governance 跳过 ⇒ 默认全量轮多出 ~**33–39 个文件的【实际执行】**（⛔ 非「把 120 文件加进选择集」——142 个 governance 文件本就在 `selected 381 files` 内，只有 39 带守卫的运行时自跳过，本轮实测 33 次）。这 33–39 个文件落在 **main 相**（墙钟仅 34.3%、并行度最好），真正大头是 serial+lowconc（34.0%）+ 锁等待（17.6%）= 51.6%，`effective_parallelism 5.54/16` 说明套件结构性欠并行、瓶颈在低并发相非 main 相 ⇒ **(a) 撞 600s 预算的风险远小于先前陈述**。⛔ 口径警示：本轮分解是 `scope=worktree + laneCount=16`（1395.6s），AC101 预算是「main 相 lane=8」，**不得直接比对**；且这 33–39 文件自身耗时仍无测量（本轮它们跳过了）。**另（减争用一层，供 (b) 参考，⛔ 非主张 (b)）**：当日 70 轮中 49 轮（70%）已完全绕开锁——bucket 轮结构上不取锁（`scripts/test.sh:630`「Scoped paths never take the lock」+ `:881` full_suite_lock_acquire 只在 run_selected + `--buckets` 走显式文件形态不经 :881）；争用只发生在 21 个 full 轮之间 ⇒ (b) 会把轮次从争用人群移出，(a) 作为完整闸门的理由一字未弱。两条路**已人裁（2026-08-26）选 (a)**：全量轮变真·全量；AC101 预算重谈为 **900s / 纯执行（durationMs − lock_wait_ms）/ 排除等锁**，超限触发测试优化（裁定原文 + 4/6 突破表见 AC5）。⛔ 实现方按 (a) 落地，不默认滑过去。

**⛔ 关系与前置（2026-08-30 更新，硬规则 2 计数纪律）**：
- **B 已收窄为本任务 AC2 子集**：`gap-worker-driver-governance-self-skip-missing` 由「加守卫 + 机械强制」收窄为「5 个重文件先行改标 lowconc、无守卫」（消除与人裁第三套机制的方向冲突）。⇒ 本任务实现前须在 B 落地后重取计数/相分布（见 AC4）。
- **计数口径漂移**：governance 文件数三快照不一致——本文 142 / 主检出工作树 148 / develop 136。⇒ 142 全量清单在实现前**以 develop git ref 为单一正源重取**（同 `gap-dispatch-reads-stale-main-checkout-task-status` 主题），不把任一历史快照当结论。
- **AC2 重分类的测量前置**：AC5 的 900s 预算证据（4/6 超限）取自 33–39 文件跳过的轮次；AC2 把两个最重文件（full-suite-runner 396s / worker-driver 208s）移入 serial/lowconc，其在该相的实际耗时**从未被测量**。⇒ 重分类前**先测 5 个重文件在 lowconc（及必要处 serial）的实际墙钟**；child-spawn 族（full-suite-runner.test.mjs）**优先 lowconc 而非 serial**（concurrency=3，避免 396s 进 serial 相直接 +396s）。「触发测试优化」落地即刻成立，但耗时未知数要摊开，不默认「风险小」结论。

## Acceptance Criteria

- [ ] AC1（能取假，governance 退役）：39 段文件内自跳过守卫删除，`@test-group governance` 不再作为「选择/跳过」机制（无唤回路径的第三套语义移除）；（⛔ 守卫仍在 ⇒ 假）。
- [ ] AC2（能取假，相标真实）：142 文件改标真实相（默认 engine；负载敏感含 worker-driver.test.mjs / full-suite-runner.test.mjs → serial/lowconc）；（⛔ 今天两 flake 文件仍在主池裸跑 ⇒ 假）。⛔ **重分类以实测耗时为准**：实现前先测 5 个重文件 lowconc/serial 实际墙钟（AC5 预算用它们跳过的轮次测得，见「关系与前置」），child-spawn 族优先 lowconc。
- [ ] AC3（能取假，bucket 单一选择）：「这次要不要跑」只由 bucket 回答；132/142 落现有桶、10 UNRESOLVED 落安全侧或新桶；（⛔ 仍有第三套选择机制 ⇒ 假）。
- [ ] AC4（能取假，正本工具核对 + 时序）：实现前 `suite-bucket-attribution.ts` 对 10 UNRESOLVED 实跑取真值（⛔ 用 grep 近似当结论 ⇒ 假），**且须在 gap-suite-move-27-evidenced-files-out-serial-lowconc、gap-suite-serial-lowconc-classification-recheck（均已 done）与 gap-worker-driver-governance-self-skip-missing（AC2 子集，5 重文件改标 lowconc）落地之后重取**（它们的 diff 含 57+28 行 `@test-group` 改动 + 5 行低并发改标，落地后 142 总数 / 各文件相 / bucket 归属都会变；在它们落地前跑正本工具仍是过期真值）。**全量清单（非仅 10 UNRESOLVED）以 develop git ref 为单一正源重取**（计数漂移见「关系与前置」）。
- [x] AC5（能取假，AC101 冲突人裁）：**人已逐字裁定（2026-08-26）**「等锁时间不计入上述预算。在此前提下，full bucket 可以放宽到 900s。超过就应当触发测试优化。」⇒ 选 (a) 真全量，AC101 预算重谈为 **900s、仅计纯执行时间（durationMs − lock_wait_ms）、专指 full-bucket 轮**；等锁时间（lock_wait_ms）明确不计入；超限后果 = 「触发测试优化」（动作触发点，非 fail-closed 硬闸）。⛔ 数据事实（已核实）：最近 6 个 full-bucket 轮已有 4 个纯执行超 900s——`612:1149.6 / 614:1224.5 / 615:1070.4 / 619:998.5`（620:848.1 / 621:880.6 未超）⇒ 阈值已被现实数据击穿，「触发测试优化」此刻已成立；（⛔ 未裁定即实现/默认滑过 ⇒ 假）。

## Definition of Done

governance 第三套退役、142 文件改标真实相、bucket 单一选择落地；AC1-AC5 全勾；AC101 冲突人裁有记录；checker-mutation-check 等被漏文件有自动执行路径；B（gap-worker-driver-governance-self-skip-missing）已收窄为 AC2 子集并被本任务吸收。

## Touches

- plugin/scripts/suite-bucket-select.ts（10 UNRESOLVED 真值核对 + 可能的镜像折叠）
- plugin/scripts/suite-bucket-attribution.ts（10 UNRESOLVED 真值核对）
- plugin/scripts/full-suite-runner.ts（governance 退役 + QUAY_TEST_GROUPS 语义收窄）
- plugin/test/*.test.mjs（142 文件相标改标 + 39 守卫删除——有界顶层 glob，非递归；实现方按此 glob 内文件落地）
- plugin/test/runner-fixtures/gov.test.mjs（fixture）
- plugin/test/suite-bucket-select.test.mjs（bucket 归属测试）
- plugin/test/suite-bucket-attribution.test.mjs（bucket 归属测试）
- scripts/test.sh（governance 跳过语义移除）
- tasks/gap-retire-governance-group-merge-into-bucket.md（自身）

## Needs-Human

**执行 2026-08-28T20:54:20.233Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- **2026-08-30 更新：全量红已消，重派条件成立**——`@load-sensitive-entry` 已落 develop（2026-08-27）、known-load-sensitive 28/28、full-suite-state green（见 `gap-full-suite-runner-missing-load-sensitive-entry` 收尾）。重派/执行前先完成「关系与前置」两步：develop 计数重取 + 5 个重文件 lowconc 测时。