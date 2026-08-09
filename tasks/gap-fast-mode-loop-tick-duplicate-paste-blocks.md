---
id: gap-fast-mode-loop-tick-duplicate-paste-blocks
title: "fast-mode-loop-tick.md 有明显重复粘贴段（270/271 两条①、459-471 rebase 块、820-832 scheduler 块、956-961 步骤 6）——单源原则被破坏，同一条规则两处表述、行号漂移后消费方读不到权威版"
status: ready
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

- [ ] AC1: **复现固化**——任务体记录 4 处重复定位（L270/271、459-471、820-832、956-961）+ 每处重复内容与风险（本任务 Proposal 已含）
- [ ] AC2: **每条重复抽一次、引较早行号**——4 处重复块的机械命令/判据只留一处，删后块保留语义（子代理抽取核的行号映射为准）
- [ ] AC3: **删除自检**——修后对 4 处规则 `grep` 确认只剩一处（或两处有明确区分头）；受影响步骤重读无语义丢失
- [ ] AC4: **不引入新重复**——修后全文档扫一遍，无新增逐字重复块（>3 行相同）被引入
- [ ] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 fast-mode-loop-tick.md 相关的 tick 文档契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：4 处规则 `grep` 各只剩一处（贴任务体）；文档行数下降记录
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
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

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（inner 子代理执行核提取时发现 4 处重复粘贴段——L270/271 两条①、459-471 rebase、820-832 scheduler、956-961 步骤 6；outer 复核确认全部逐字/语义重复；manager 裁定「重复本身是待修缺陷，归外层判要不要立案」→ 立为 gap/defect，实现归内层）
