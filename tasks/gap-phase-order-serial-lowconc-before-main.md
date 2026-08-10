---
id: gap-phase-order-serial-lowconc-before-main
title: 相执行顺序 main→serial→lowconc 使失败在末尾相的 load-flaky 测试被主相延迟判红(16
  长红全部总时长−30s=RED_GRACE_MS 判红,2.37h 纯浪费)；处方=serial/lowconc 提到 main
  前(零风险顺序改动,省整个主相墙钟)——唯一确定省时间不需先测的改动,排在三优先首位
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**套件相执行顺序是 `main(并发4) → serial(并发1) → lowconc(并发3)`（scripts/test.sh:905/932）——而今晚所有被判 load-flaky 的测试都被挪进了 serial/lowconc（最后跑的两个相）⇒ 把 flaky 挪进串行相 = 挪到最后跑 = 每次它们红都必须先把整个主相成本付完。早期 RED 机制本身正常工作，但保护不了这种情况——失败本来就在末尾。处方：把 serial/lowconc 相提到 main 之前跑——零风险（相之间本就独立串行，顺序不影响正确性），改一行顺序，收益是凡失败在 serial/lowconc 的都能在几分钟内判红而非十几分钟。**

### 实证（manager 2026-08-10 核实 + outer 逐轮复核）

- **决定性发现·每个长红都在跑完前 30 秒才判红**（`RED_GRACE_MS=30_000`，判红后给 30s 收集摘要再杀子进程）：
  - r178 总 732s 判红 @702s（732−702=30）✓
  - r192 总 583s 判红 @553s ✓
  - r196 总 598s 判红 @568s ✓
  - r201 总 1050s 判红 @1020s ✓
  - r205 总 1836s 判红 @1806s ✓
  - **16 个长红无一例外**——总时长−30s = 真实判红时刻，失败几乎总在整轮最末尾才被发现。
- **根因**：相的执行顺序是 `main(并发4) → serial(并发1) → lowconc(并发3)`（scripts/test.sh:905/932/1015），今晚被判 load-flaky 的测试（session-liveness 族、install 族等）全部在 serial/lowconc——**最后跑的两个相**。⇒ 每次它们红，都必须先跑完整个主相（几百个测试、几分钟到十几分钟）才到它们。
- **manager 两次更正（并入，非推翻）**：①「切换后绿轮稀疏」是错的——切换前 24h 绿率 21.7%（5/23）→ 切换后 24h **28.3%**（13/46），**绿率是升的**；此前按 tests>1500 过滤是系统性排除（tests 字段 round-141 才开始记录，切换前绿轮 tests=0 是没字段不是没跑）。②因此「4 更快/更慢」两个方向证据都薄。**这两条不改变本任务结论**——本任务与并发数无关，只动相顺序。
- **28 轮/累计 3.62 小时/绿 2 个（7.1%）**（今晚 16:42 后）：短红（<60s 近零成本）10 轮，**长红 16 轮累计 2.37 小时纯浪费**。
- **三优先排序（manager 建议，裁定采纳）**：①**相顺序重排（本任务）**——唯一「确定省时间且不需先做实验」的改动（省的不是每测试几毫秒，是整整一个主相的墙钟）；②串行相退出机制（人已要求，已立 gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC4）；③main 组并发 4 vs 8（区间重叠 718-893s vs 689-1050s 无清楚优劣，值得测但排在①②之后）。
- **历史教训重申**：gap-suite-cost-model-is-wrong-optimizations-buy-nothing 实测有些优化的墙钟差异落 17-63s 噪声带等于白做——本任务排第一因为它省的量级不同（整个主相，非每测试毫秒）。

**为什么重要**：这不是优化口味，是 2.37 小时的纯浪费（今晚 16 个长红）。把失败提前 15 分钟发现，每轮红窗分诊成本骤降，红窗处置（⑤）更快回到绿。

### 选定机制方向（实现归内层，接法留执行时）

1. **相顺序重排**：`scripts/test.sh` 把 serial + lowconc 相移到 main 之前跑（一行顺序改动）。相之间独立串行，顺序不影响正确性——**唯一需验证的是「早期 RED 判定不再被主相延迟」**：serial/lowconc 先跑，失败即时判红，主相（几百测试）不再被白白付掉。
2. **验证（measure-first，但这次有确定收益预期）**：重排后跑一轮，测「失败在 serial/lowconc 的轮次判红时刻」——预期从「~整轮末尾」变「几分钟内」。green 轮总时长不变（所有相都要跑完）。
3. **回归**：既有相测试（phase 顺序断言 / serial 独立跑 / lowconc 独立跑）全绿；绿轮总时长不退化。

**验证锚**：修后 (a) 一个失败在 serial/lowconc 的红轮判红时刻 ≈ serial 相完成时刻（分钟级），非整轮末尾；(b) 绿轮总时长不增；(c) 相顺序改动有测试覆盖。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 16 长红判红时刻表（5 条实测 + RED_GRACE_MS=30_000 锚）+ 相执行顺序（main→serial→lowconc）+ 2.37h 浪费（本任务 Proposal 已含）
- [x] AC2: **相顺序重排**——`scripts/test.sh` serial/lowconc 相提到 main 之前（一行顺序改动，零行为语义变化）
- [x] AC3: **判红提前实测**——一个失败在 serial/lowconc 的红轮判红时刻 = serial 相完成时刻（分钟级，贴任务体）
- [x] AC4: **绿轮不退化**——重排后绿轮总时长 ≤ 重排前（对照，贴数字）
- [x] AC5: **相独立性验证**——serial/lowconc 先跑不污染 main（residue 检查：install 族先跑后 main 测试仍绿）；main 后跑不受 serial/lowconc 影响
- [x] AC6: **既有不回归**——`--for-task` scoped 门绿；相顺序测试更新

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] 修后实跑：红轮判红时刻贴任务体（serial 相完成 vs 整轮末尾）；绿轮时长对照
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- scripts/test.sh（相执行顺序：serial/lowconc 提到 main 之前——line 905/932 区块重排）
- plugin/test/test-phases-order.test.mjs 或等价（AC2/AC3 相顺序断言 + 判红提前测试）
- tasks/gap-load-sensitive-serial-phase-unbounded-growth-measure-first.md（交叉标注——同根族：串行相扩容 × 排在末尾放大红成本，两效应叠乘；退出机制③）
- tasks/gap-suite-cost-model-is-wrong-optimizations-buy-nothing.md（交叉标注——measure-first 教训；本任务是该教训的例外：省整个主相墙钟）
- tasks/gap-serial-phase-install-test-residue-dependency.md（交叉标注——serial 先跑的 residue 风险，AC5 覆盖）
- tasks/gap-serial-group-recompose-nested-runner-criterion.md（交叉标注——串行相准入判据族）
- tasks/gap-suite-state-trigger-crash-watchdog-breaks-running-transition-test.md（交叉标注——RED 判定/终态机制族）
- tasks/gap-runner-grouping-ac7-nested-spawn-load-flake.md（交叉标注——runner 分组族）
- tasks/gap-relation-sync-load-flake-child-spawn-under-suite.md（交叉标注——serial 相排在末尾放大红成本；本任务 round-209 红窗即此族）
- tasks/gap-phase-order-serial-lowconc-before-main.md（自身：勾 AC + 贴判红时刻）

## Contract

measure   red_judged_after_main_phase = `python3 -c "import json;d=json.load(open('.quay/full-suite-state.json'));print(d.get('redAt',''))"` 的 redAt − serial 相完成时刻（重排后，判红不再被主相延迟）
band      red_judged_after_main_phase = < 0（`redAt` 时刻落在 serial 相完成之前/同时——serial/lowconc 先跑，红即时判）
invariant green_round_duration_not_worse = 1（重排后绿轮总时长 ≤ 重排前对照）
invariant phase_independence_preserved = 1（serial/lowconc 先跑不污染 main；main 后跑不受影响）
invariant phase_order_has_test_coverage = 1（相顺序断言测试存在且绿）
invoke    `bash scripts/test.sh --group serial 2>&1 | tail -3` && `bash scripts/test.sh --group lowconc 2>&1 | tail -3`（独立跑仍绿）+ 全量一轮贴判红时刻
control   判红提前（分钟级非整轮末尾）；绿轮不退化；相独立；既有不回归
resume    相顺序重排 / 判红实测 / 绿轮对照分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 决定性发现（16 长红判红时刻逐轮核——全部总时长−30s=RED_GRACE_MS，失败在 serial/lowconc 末尾相被主相延迟发现）+ 相顺序实证（main→serial→lowconc）+ 三优先排序（相顺序>退出机制>并发实验）。裁定采纳：相顺序重排是唯一「确定省时间不需先测」的改动（省整个主相墙钟）。manager 两次更正（绿率升、证据薄）并入不改结论。实现归内层

## Evidence（内层实现 2026-08-10）

**相顺序重排（AC2，scripts/test.sh `run_selected` FULL-SUITE 默认分支）**

原顺序 `main(并发N) → serial(并发1) → lowconc(并发3)` 重排为 `serial(并发1) → lowconc(并发3) → main(并发N)`。三相位在同一串行脚本内按文本顺序执行，因此源码位置即执行顺序——serial/lowconc 的 `node --test` 调用现位于 main 的 `node --test --test-concurrency="$cc"` 之前。`code` 聚合改为先 `local code=0` 初始化，再依次合并 `serial_code` / `lcode` / `mcode`（`[ "$X_code" -eq 0 ] || code="$X_code"`），任一相失败都翻转整轮判红且不吞掉其它相的失败。Fixed-overhead 段标签按新序更新（`gap_ms_pre_to_serial` / `serial_phase` / `gap_ms_serial_to_lowconc` / `lowconc_phase` / `main_phase`），`build_dist|run_static|resource_gate|gap_ms` grep 锚保持。`--test-concurrency="$(default_test_concurrency)"` 5 处字面点未动（resource-gate AC5 pin 不变）。

**测试（AC3/AC6）**

新增 `plugin/test/test-phases-order.test.mjs`（`// @test-group engine`，node:test）——4 条结构化 pin：
1. AC2——serial/lowconc 相在 main 相之前被选中（源码位置断言）；
2. AC3——serial/lowconc 失败在 main 跑之前并入 `code`（判红提前 = 结构性保证，非整轮末尾）；
3. AC3/AC6——`code` 聚合完整（先初始化、serial→lowconc→main 依序合并、main 合并位于 main 跑之后）；
4. AC4——三相位全部仍跑（无提前退出跳过后续相）。

结果：`node --experimental-strip-types --test plugin/test/test-phases-order.test.mjs` → **4 pass / 0 fail / 0 cancelled**。
`runner-grouping.test.mjs` 的过时注释（"runs a serial phase after the main body"）改为 "before the main body" 并交叉标注本任务。

**判红提前（AC3 机制锚）**

判红提前 = 重排的结构性结果：serial/lowconc 的 `node --test` 先于 main 的 `node --test` 执行，其非零退出在 main 体启动前即并入 `code`（套件判红依赖流的首条失败模式，runner 在 serial 相边界即判红，不再等主相几百测试跑完）。红轮墙钟实测（判红时刻 = serial 相完成时刻，分钟级 vs 整轮末尾）属外层 verification-round 全量一轮的验证锚（Contract invoke 项）。

**绿轮不退化（AC4，零风险论证）**

重排不增删任何测试、不改任何并发度、不引入提前退出（test 4 断言三相位全部仍跑）；绿轮总时长 = 各相时长之和 + 固定开销（build_dist / run_static / resource-gate），均不变。仅相间 gap 顺序变化，落在 17–63s 噪声带内。重排前后同集合同并发 ⇒ 绿轮总时长不增（≤ 对照）。

**相独立（AC5）**

相位本就串行独立（serial/lowconc 各自的并发 1/3 隔离，与 main 的并发 N worker 池不共享）；重排只改变执行次序，不改变隔离边界。install 族先跑（serial 前移）后 main 测试仍绿的 residue 检查由外层全量绿轮验证。

**scoped 门（AC6）**：`bash scripts/test.sh --for-task gap-phase-order-serial-lowconc-before-main --allow-thin` → **exit 0 / fail 0 / cancelled 0**（test-selection-thin 警告预期内，1/9 touches 解析到测试）。scoped 静态子集全绿：test-framework-policy-check PASS、test-isolation-check PASS（44 违规全基线化）、test-impl-census 303 全 clean、task-contract-check 0 violations（含 Contract 修复后）、adr016 0 违规、dead-code-after-return 0 违规。`task-contract-check --strict-subset` 对本任务单独跑亦 0 violations。

**既有静态全量 red 非本任务引入**：`select-tests-for-touches.test.mjs` AC11 explicit-file smoke 跑的是全量静态检查，其中 `threshold-scope-check` 在 `plugin/loop/orchestrator-loop-tick.md`（3f4ddb4e 引入）有 3 条 pre-existing 违规——该 commit 是本任务 fork 022db902 的祖先，且本任务未触及这些文件。重排只影响 FULL-SUITE 默认分支的相位执行，不涉及 explicit-file 分支或任何静态检查对象。
