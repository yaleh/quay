---
id: gap-retire-governance-group-merge-into-bucket
title: 退役 @test-group governance 第三套机制——并入 bucket（人裁定「不要在 bucket 和相机制以外再搞一套」），142 文件改标真实相
status: needs-human
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

> **⛔ 暂持 needs-human（2026-08-25）**：AC5 的 AC101 600s 冲突（a 真全量 vs b bucket 驱动默认轮）**须人裁定**，裁定落地前不放 ready——避免 worker 读到 AC5 发现结构上无法自行满足（人不在 worker 回合里）⇒ 白烧 worktree + 派发。⛔ **不能用 todo**：promotion-driver 会把形状完整的 todo 机械晋升回 ready（已实证 b1762d8a「todo→ready 机械晋升」）。needs-human 是 driver 不自动晋升的持稳态。人裁定后由 outer 记进 AC5 Evidence 并翻 ready。

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

**⚠️ 实现前必须解决的冲突（须人裁，⛔ 不代拍）**：退役 governance 跳过 ⇒ 默认全量轮多出 ~120 文件，本轮 suite dur=599.2s 已贴 AC101 ≤600s。两条路须显式选一：(a) 全量轮变真·全量（修掉「full suite 静默漏 142 文件」的「声明在/保证没了」形态，但 AC101 600s 须重谈）；(b) 默认全量轮本身改 bucket 驱动（省时，但改「全量轮作闸门」含义）。manager 倾向 (a)+省时责任交回 bucket，但**AC101 重谈须人裁**——实现方在 Plan 里显式记录所选项 + 人裁定，⛔ 不默认滑过去。

## Acceptance Criteria

- [ ] AC1（能取假，governance 退役）：39 段文件内自跳过守卫删除，`@test-group governance` 不再作为「选择/跳过」机制（无唤回路径的第三套语义移除）；（⛔ 守卫仍在 ⇒ 假）。
- [ ] AC2（能取假，相标真实）：142 文件改标真实相（默认 engine；负载敏感含 worker-driver.test.mjs / full-suite-runner.test.mjs → serial/lowconc）；（⛔ 今天两 flake 文件仍在主池裸跑 ⇒ 假）。
- [ ] AC3（能取假，bucket 单一选择）：「这次要不要跑」只由 bucket 回答；132/142 落现有桶、10 UNRESOLVED 落安全侧或新桶；（⛔ 仍有第三套选择机制 ⇒ 假）。
- [ ] AC4（能取假，正本工具核对 + 时序）：实现前 `suite-bucket-attribution.ts` 对 10 UNRESOLVED 实跑取真值（⛔ 用 grep 近似当结论 ⇒ 假），**且须在 gap-suite-move-27-evidenced-files-out-serial-lowconc 与 gap-suite-serial-lowconc-classification-recheck 两个在飞任务 ff 之后重取**（它们的 diff 含 57+28 行 `@test-group` 改动，落地后 142 总数 / 各文件相 / bucket 归属都会变；在它们落地前跑正本工具仍是过期真值）。
- [ ] AC5（能取假，AC101 冲突人裁）：AC101 ≤600s 冲突（a 真全量 vs b bucket 驱动默认轮）在实现前由人裁定，所选方向写进 Evidence；若 (a) 则 600s 预算重谈有记录；（⛔ 未裁定即实现/默认滑过 ⇒ 假）。

## Definition of Done

governance 第三套退役、142 文件改标真实相、bucket 单一选择落地；AC1-AC5 全勾；AC101 冲突人裁有记录；checker-mutation-check 等被漏文件有自动执行路径。

## Touches

- plugin/scripts/suite-bucket-select.ts（10 UNRESOLVED 真值核对 + 可能的镜像折叠）
- plugin/scripts/suite-bucket-attribution.ts（10 UNRESOLVED 真值核对）
- plugin/scripts/full-suite-runner.ts（governance 退役 + QUAY_TEST_GROUPS 语义收窄）
- plugin/test/（142 文件相标改标 + 39 守卫删除 + bucket 归属测试）
- scripts/test.sh（governance 跳过语义移除）
- tasks/gap-retire-governance-group-merge-into-bucket.md（自身）
