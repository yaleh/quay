---
id: gap-fast-mode-loop-tick-duplicate-paste-blocks
title: fast-mode-loop-tick.md 有明显重复粘贴段（270/271 两条①、459-471 rebase 块、820-832
  scheduler 块、956-961 步骤 6）——单源原则被破坏，同一条规则两处表述、行号漂移后消费方读不到权威版
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

**inner 的 tick 文档 `plugin/loop/fast-mode-loop-tick.md`（1149 行）存在至少 4 处重复粘贴段——同一条规则两处表述，语义含糊，读错版本即行为漂移。**（inner 子代理执行核提取时发现；outer 复核确认全部 4 处。）

### 实证（outer 复核，2026-08-09）

| # | 位置 | 重复内容 | 风险 |
|---|---|---|---|
| 1 | L270-271 两条 `① 在飞 agent 是否符合文档` | 同一核对行号下两条完整表述（读槽位视角 vs 遥测 realConcurrency） | 两处措辞不同（`--slots` 输出字段名一个写 `real-concurrency` 一个写 `realConcurrency`）——读错版本=读错字段名 |
| 2 | L459-471 | rebase 步骤与 `git merge --no-ff` 说明块疑似重复（`先 rebase 到当前 integration` 出现） | 合并流程两处描述，冲突处置顺序不一致 |
| 3 | L820-832 | `concurrent-batch-scheduler.ts` 的 deferred `(overlap: <file>)` 注释行完全重复（L823 与 L829 同一行） | 明显粘贴残留，阅读噪音 |
| 4 | L956-961 | 步骤 6 的 tick 间隔/事件驱动派发说明与步骤 4「槽位释放回填」重复（`槽位释放回填` 在 757 与 958 各出现） | 兜底心跳 vs 事件驱动的主从关系两处表述 |

**为什么重要**：这是「单一事实源」原则（DIR-028 / exp5 结晶方向）在 tick 文档内的破坏——**同一条规则两处表述，等于没有权威版**。文档内重复比文件间重复更隐蔽：文件间漂移有 anti-drift 检查，文档内重复只有人重读才暴露。且这类重复是「写了但没强制」缺陷族的温床（消费方读到一个版本执行，与另一版本不一致的行为差异无人对账）。

**修的方向（实现归内层）**：
- 每条重复：语义上抽一次、引较早行号（子代理已按语义抽过一次核——保留它的行号映射），删后出现的重复块。
- 删后**自检**：`grep` 确认每条规则的机械命令/判据只剩一处；重读受影响步骤确认无语义丢失。
- 与 `orchestrator-tick-core.md` / `fast-mode-tick-core.md`（manager 2026-08-09 提取的执行核，src:N 回指源文档）**方向一致**——执行核把「执行路径」从理由档案里抽出来，本任务把源文档内的重复清掉，两边不冲突。

**验证锚**：修后，(a) 4 处重复位置的 `grep` 只命中一处（或两处都有明确区分头，非逐字重复）；(b) 受影响步骤重读无语义丢失；(c) 文档总行数下降、`fast-mode-loop-tick.md` 无新增重复块。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 4 处重复定位（L270/271、459-471、820-832、956-961）+ 每处重复内容与风险（本任务 Proposal 已含）
- [x] AC2: **每条重复抽一次、引较早行号**——4 处重复块的机械命令/判据只留一处，删后块保留语义（子代理抽取核的行号映射为准）
- [x] AC3: **删除自检**——修后对 4 处规则 `grep` 确认只剩一处（或两处有明确区分头）；受影响步骤重读无语义丢失
- [x] AC4: **不引入新重复**——修后全文档扫一遍，无新增逐字重复块（>3 行相同）被引入
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 fast-mode-loop-tick.md 相关的 tick 文档契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：4 处规则 `grep` 各只剩一处（贴任务体）；文档行数下降记录
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/loop/fast-mode-loop-tick.md（4 处重复块去重——语义抽一次、引较早行号）
- orchestration/fast-mode-tick-core.md（执行核的 src:N 映射——若删除改变了行号，交叉标注「src:N 已因去重移位」，不逐字改核心文件本身）
- tasks/gap-fast-mode-loop-tick-duplicate-paste-blocks.md（自身：勾 AC + 贴证据）

## Contract

measure   dup_blocks_after_fix = `grep -c "<各规则关键行>" plugin/loop/fast-mode-loop-tick.md` 的 stdout 数字
band      dup_blocks_after_fix = 1（每处规则只剩一处；或两处有明确区分头，非逐字重复）
invariant no_new_duplicate_block = 1（修后无 >3 行逐字重复块被引入）
invariant no_semantic_loss = 1（受影响步骤重读无语义丢失——去重是合并不是删减）
invoke    `grep -c "<各规则关键行>" plugin/loop/fast-mode-loop-tick.md`（4 处实跑贴回）
control   4 处重复位置修前 grep 命中 >1、修后命中 =1（或明确区分）
resume    逐条去重分步提交，任一步完成即写盘；被 src:N 映射引用的行号变动按执行核头注交叉标注

## Test-Files

- plugin/test/fast-mode-loop-tick-dedup.test.mjs（新：把 AC3/AC4 的去重判据机械固化——规则关键行各只一处 + 无 ≥4 行重复块）

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（inner 子代理执行核提取时发现 4 处重复粘贴段——L270/271 两条①、459-471 rebase、820-832 scheduler、956-961 步骤 6；outer 复核确认全部逐字/语义重复；manager 裁定「重复本身是待修缺陷，归外层判要不要立案」→ 立为 gap/defect，实现归内层）

## Evidence（内层实现 2026-08-09）

**复现（修前 1200 行文档的 `grep -c`）**：

| 规则关键行 | 修前 | 修后 |
|---|---|---|
| `| ① | 在飞 agent 是否符合文档 |`（两条①） | 2 | 1 |
| `git -C $WORKTREE_ROOT/<slug> rebase `（rebase 步骤 0） | 2 | 1 |
| `(overlap: <file>)`（scheduler deferred 注释） | 2 | 1 |
| `ScheduleWakeup`，间隔 **1200–1800 秒**（步骤 6） | 2 | 1 |
| `rebase integration`（字面写死分支名，违反「不要字面写死分支名」） | 1 | 0 |

**去重（5 处，语义抽一次、引较早行号）**：

1. **L270/271 两条①** → 保留「读槽位视角」行（用 `realConcurrency`/`realInFlight`，与执行核 A13/C6 同字段名），删「遥测 `real-concurrency` 字段」行——该连字符字段名既与执行核不一致，也与 `--slots` 实际 JSON 字段 `real_concurrency` 不一致，正是任务风险表点名的「读错版本=读错字段名」。
2. **459-471 rebase 块** → 保留 `$MERGE_TARGET` 配置代入版（`git -C $WORKTREE_ROOT/<slug> rebase $MERGE_TARGET`），删整块字面 `integration`/`develop` 重复版（rebase 冲突/merge 冲突处置、`$FORK_BASELINE` 只由外层批量合推进等语义在保留版中原有）。
3. **820-832 scheduler 块** → 保留围栏内 `(overlap: <file>)` 注释，删围栏外粘贴残留注释块 + 重复「重叠 →」行；保留 `重叠 → 不可并发，等下一 tick`（batch-vocabulary-check AC1 测试契约钉住的措辞）。
4. **956-961 步骤 6** → 保留「事件驱动派发（槽位回填）+ tick 兜底必跑心跳 slot-refill + 不引入新轮询源」完整版，删旧「槽位释放回填」重复段。
5. **（附，同类）判绿三条件段**：L152/153 与 L161-168 为同句两版本交错（「历史引用」vs「历史批名」）——保留带 `（**历史批名**，指旧的全量验证轮次，保留不改名）` 显式标注版，删 `（历史引用）` 重复版。

**文档行数**：1200 → 1173（删 27 行，净下降）。

**删除自检（AC3）**：
- 上表 4 处规则 `grep -c` 各 = 1；`rebase integration` = 0；判绿三条件 / 判绿理由 各 = 1。
- 受影响步骤重读：判绿段、① 行、fan-in 编号列表 0-4、scheduler 围栏、步骤 6 均无语义丢失（去重是合并不是删减）。
- AC4 扫描：全文档无 ≥4 连续相同行、无重复 4 行块。

**机械固化（AC4，新增测试）**：`plugin/test/fast-mode-loop-tick-dedup.test.mjs`（`// @test-group governance`，node:test，4 断言：① 规则关键行各只一次 / ① 行字段名一致（`realConcurrency` 非 `real-concurrency`）/ 无 ≥4 连续相同行 / 无 4 行块重复）。单跑：4 pass 0 fail。

**执行核交叉标注**：`orchestration/fast-mode-tick-core.md` 头注新增「行号注（2026-08-09）——`src:N` 已因去重移位 ≈27 行，按内容核对，不按行号」；未逐字改核心文件正文。

**scoped 门（AC5）**：`bash scripts/test.sh --for-task gap-fast-mode-loop-tick-duplicate-paste-blocks --allow-thin` 实跑 **EXIT=0**。
- 静态检查（change-relevant tier）全 PASS：`task-contract-check: no violations`（strict-subset）、`adr016-screen-use-check` 0 违规、`strategic-doc-staleness-check` 无新增陈旧引用、`drive-contract-check` 0 违规（fast-mode-loop-tick / orchestrator-loop-tick / QUAY-OUTER-HANDOFF）、`instrument-failure-check --gate` PASS。
- 新增测试 `plugin/test/fast-mode-loop-tick-dedup.test.mjs`：4 pass / fail 0 / cancelled 0。
- 相关既有 doc 断言单跑全绿：`tick-vocabulary` + `batch-vocabulary-check` 13 pass；`slot-visibility` AC3/AC2 doc 2 pass；`cap-from-gate` doc/AC7/AC8 2 pass。
- 全量套件绿（DoD 第 4 条）留外层 verification-round 验证。
