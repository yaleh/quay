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

## Acceptance Criteria

- [x] AC1（能取假，governance 退役）：39 段文件内自跳过守卫删除，`@test-group governance` 不再作为「选择/跳过」机制（无唤回路径的第三套语义移除）；（⛔ 守卫仍在 ⇒ 假）。
- [x] AC2（能取假，相标真实）：142 文件改标真实相（默认 engine；负载敏感含 worker-driver.test.mjs / full-suite-runner.test.mjs → serial/lowconc）；（⛔ 今天两 flake 文件仍在主池裸跑 ⇒ 假）。
- [x] AC3（能取假，bucket 单一选择）：「这次要不要跑」只由 bucket 回答；132/142 落现有桶、10 UNRESOLVED 落安全侧或新桶；（⛔ 仍有第三套选择机制 ⇒ 假）。
- [x] AC4（能取假，正本工具核对 + 时序）：实现前 `suite-bucket-attribution.ts` 对 10 UNRESOLVED 实跑取真值（⛔ 用 grep 近似当结论 ⇒ 假），**且须在 gap-suite-move-27-evidenced-files-out-serial-lowconc 与 gap-suite-serial-lowconc-classification-recheck 两个在飞任务 ff 之后重取**（它们的 diff 含 57+28 行 `@test-group` 改动，落地后 142 总数 / 各文件相 / bucket 归属都会变；在它们落地前跑正本工具仍是过期真值）。
  - **AC4 真值（两个在飞任务已 done 落地后重取）**：`suite-bucket-attribution.ts`（`bucketSetOf` 原始 AC120 闭包）对 10 命名文件 = **10/10 UNRESOLVED**（与 manager 实跑一致）；但**选择路径**（`suite-bucket-select.ts` → `effectiveBucketAttribution`，生产 bucket 判定真正走的函数）对同一 10 个 = **9 个 mirror-fold → M**（chart2-s1/s2/s3、portfolio-choice、vmeta-lag、rolling-slope、deliverable-governor、outward-vt、preparation-feedback，全部 `source=mirror-fold` 落 M 桶）+ **1 个真 UNRESOLVED**（`integration-batch-merge.test.mjs`，落安全侧=每桶必跑）。⇒ **「10 UNRESOLVED 落安全侧还是新开桶」已由现有机制消解，无需新开桶**：9 个经 EXP→PLUGIN 镜像折叠落 M、1 个安全侧；⛔ 故 `suite-bucket-select.ts`/`suite-bucket-attribution.ts`/`full-suite-runner.ts`（Touches 原列）**零改动**——本任务不动 bucket 机制本体。
- [x] AC5（能取假，AC101 冲突人裁）：**人已逐字裁定（2026-08-26）**「等锁时间不计入上述预算。在此前提下，full bucket 可以放宽到 900s。超过就应当触发测试优化。」⇒ 选 (a) 真全量，AC101 预算重谈为 **900s、仅计纯执行时间（durationMs − lock_wait_ms）、专指 full-bucket 轮**；等锁时间（lock_wait_ms）明确不计入；超限后果 = 「触发测试优化」（动作触发点，非 fail-closed 硬闸）。⛔ 数据事实（已核实）：最近 6 个 full-bucket 轮已有 4 个纯执行超 900s——`612:1149.6 / 614:1224.5 / 615:1070.4 / 619:998.5`（620:848.1 / 621:880.6 未超）⇒ 阈值已被现实数据击穿，「触发测试优化」此刻已成立；（⛔ 未裁定即实现/默认滑过 ⇒ 假）。

## Definition of Done

governance 第三套退役、142 文件改标真实相、bucket 单一选择落地；AC1-AC5 全勾；AC101 冲突人裁有记录；checker-mutation-check 等被漏文件有自动执行路径。

## Touches

- plugin/scripts/runner-grouping.ts（group_of / select_files / list_groups 移除 governance）
- plugin/scripts/test-group-downgrade-check.ts（TARGET_GROUPS 移除 governance + uncommitted 路径补 ORIGIN_GROUPS 判定）
- plugin/scripts/test-framework-policy-check.ts（groupDeclRE 移除 governance）
- plugin/scripts/runner-static-gate.ts（downgrade 注释收窄）
- plugin/scripts/test-file-baseline.ts（关系示例注释收窄）
- plugin/scripts/capability-catalog.sh（downgrade-check 描述收窄）
- plugin/scripts/dispatch-worktree-setup.sh（测试指向注释 engine）
- plugin/scripts/checker-mutation-cases/test-group-downgrade-check.sh（downgrade 目标 governance→serial）
- scripts/test.sh（governance 跳过语义移除 + 组清单收窄）
- scripts/test-coverage-check.ts（--group 四组枚举收窄）
- plugin/test/*.test.mjs（145 文件相标改标 + 40 守卫删除 + 机制测试更新 + 删除 runner-grouping-governance/fixture-runs——有界顶层 glob）
- experiments/quay-perpetual-stream/test/*.test.mjs（13 文件相标改标 + 守卫删除）
- plugin/test/runner-fixtures/gov.test.mjs（fixture 删除）
- plugin/test-isolation-violations.txt（spawns-test-sh ratchet 删 2 条指向已删 governance 测试的 entry）
- docs/analysis/test-file-baseline.txt（test-file-snapshot 基线重生成——2 文件 engine→serial 移出 --list-files）
- tasks/gap-retire-governance-group-merge-into-bucket.md（自身）
