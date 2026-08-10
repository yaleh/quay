---
id: gap-crystallization-five-directions
title: 熔融-结晶张力五方向实现——①失效前提可测 ②零调用默认可疑(人硬修正:cadence周期门限+
  全历史表态+禁止最近没用为唯一退休理由+默认待观察) ③last-reaffirmed ④checker-lib抽取
  ⑤审视者(归manager);证据=A结晶点熔融(182机件49%零调用)/B条文理由失效无触发器/ C判据形态错/D可见不执行;理由档案
  orchestrator-loop-tick §熔融-结晶张力五方向
status: ready
labels:
  - gap
  - mechanism
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**人的五方向（2026-08-10 批准，②带人硬修正）已入理由档案（orchestrator-loop-tick.md §熔融-结晶张力五方向，outer 提交）。本任务实现①②③④（⑤归 manager）。** 四类证据：A 结晶了但调用点熔融（182 机件 49% 零调用）；B 条文还在但理由已失效（无触发器，今晚 3 个 B 类发现全靠人问）；C 判据形态错；D 可见不执行。

### 实证（人 2026-08-10 + outer 核实）

- **A**：manager-tick-core.js 停调 19h ⇒ 466 行判准缺席 ⇒ 8 条违规；nyf-semantic-judge 跑一次即弃（却是今晚唯一被证明有价值的 workflow：24 分钟 4 个 done-flip）；supervisor-deliver 被绕过 332 次；182 已声明机件近 3 天零调用 89 个=49%。
- **B**：四处「不要自己用 Agent」理由=共享树单写入者，worktree 隔离后对隔离树不成立；@static-object 仍指 *-loop-tick.md 而 tick-core 0 次。
- **C**：A16 关键词 3 次假阳性；capture-pane 自证不可能失败；B3 借判准编号使缺席伪装成在场。
- **D**：C8 读 7 次引用 7 次违反 9 次。
- **人的②硬修正（必须照做，原话）**：「对这条的处理必须加时间/频率门限，且处理时应回顾更大时间尺度的记录。我们已经出现了很多『最近没有用』而被丢掉的有价值机制。」

**为什么重要**：B 类最危险——心跳测「条文有没有被调用」（关于条文的属性），但「理由是否仍成立」是关于世界的属性，没有读数直接对应。唯一被正确退休的判准⑥恰因失效有可测形式（答案恒定⇒零信息）。

### 选定机制方向（实现归 inner，判定归 outer）

1. **① 失效前提字段**：每条硬约束（C 表/禁令文档/机件声明）带 `失效前提:` 字段且可 grep/可测；缺字段=入口闸拒绝（照 capability-catalog 已有做法）；写不出可测形式的明标「无可测前提，靠周期复核」。
2. **② 零调用默认可疑（人硬修正四形态）**：
   - (a) catalog 增 `cadence:` 字段（每轮/每红窗/每里程碑/冷启动/按需），零调用 > 3× 声明周期才进「待表态」；
   - (b) 表态回看全历史（meta-cc 全会话 + git log --all），不得只看近 N 天；
   - (c) 禁止以「最近没用」为唯一退休理由——退休必须给「理由失效」或「已被取代」实证；
   - (d) 默认处置「待观察」不是「退休」。
3. **③ last-reaffirmed 时间戳**：超 N 天未被任何调用/检查/复核触及 ⇒ 进「待重新确认」，只要求看一眼盖章。
4. **④ checker-lib 抽取**：「按位置不按关键词」已实现两次（drive-contract-check、test-framework-policy-check）未抽库；抽 `checker-lib`（matchAtCommandPosition / 枚举式存在性），catalog 入口闸要求新检查器声明匹配方式。
5. **⑤ 审视者（manager 实现，本任务不含）**：manager tick 每 N 轮随机抽 3 条核前提，输出被抽条目+核验结论。

**验证锚**：修后 (a) catalog 有 cadence 字段且零调用按 3×周期分档；(b) 零调用表态输出全历史证据（非近 N 天）；(c) 失效前提缺字段=入口闸拒绝；(d) checker-lib 被新检查器引用；(e) last-reaffirmed 超期进待重新确认。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录四类证据 + 人②硬修正原话 + 五方向（本任务 Proposal 已含）
- [ ] AC2: **①失效前提**——硬约束带失效前提字段,缺字段入口闸拒绝,无可测形式明标
- [ ] AC3: **②cadence 字段**——catalog 增 cadence(每轮/每红窗/每里程碑/冷启动/按需),零调用>3×周期进待表态
- [ ] AC4: **②全历史表态**——表态回看全历史(meta-cc 全会话+git log --all),不只看近 N 天
- [ ] AC5: **②禁止最近没用为唯一退休理由**——退休须给理由失效或已被取代实证;默认待观察
- [ ] AC6: **③last-reaffirmed**——超 N 天未触及进待重新确认,看一眼盖章
- [ ] AC7: **④checker-lib**——抽 matchAtCommandPosition/枚举式存在性,新检查器声明匹配方式
- [ ] AC8: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC8 全部勾上
- [ ] 修后实跑：cadence 分档 + 零调用全历史表态 + 失效前提入口闸 + checker-lib 引用（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/capability-catalog.sh（cadence 字段 + 零调用分档 + 失效前提入口闸）
- plugin/scripts/<新检查器>.ts（零调用 triage + last-reaffirmed + 失效前提入口闸）
- plugin/scripts/checker-lib.ts（④ 抽取：matchAtCommandPosition / 枚举式存在性）
- plugin/scripts/drive-contract-check.ts + test-framework-policy-check.ts（④ 改用 checker-lib）
- plugin/test/（各 AC 测试）
- orchestration/orchestrator-tick-core.md（若核需同步失效前提/零调用判据）
- tasks/gap-crystallization-five-directions.md（自身：勾 AC + 贴输出）

## Contract

measure   cadence_field_present = `grep -c "cadence:" plugin/scripts/capability-catalog.sh` 的 stdout 数字
band      cadence_field_present >= 1（catalog 有 cadence 字段）
invariant zero_call_cadence_gated = 1（零调用按 3×声明周期分档,非统一天数）
invariant retirement_needs_reason_or_replacement = 1（禁止最近没用为唯一退休理由）
invariant invalidation_precondition_testable = 1（失效前提缺字段=入口闸拒绝）
invariant checker_lib_extracted = 1（matchAtCommandPosition/枚举式存在性抽库）
invoke    `bash plugin/scripts/<新检查器>.sh --check`（贴输出：cadence 分档 + 零调用全历史 + 失效前提入口闸）
control   cadence 周期门限；全历史表态；禁止最近没用退休；last-reaffirmed；checker-lib；默认待观察
resume    失效前提 / cadence / 全历史表态 / last-reaffirmed / checker-lib 分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人批准五方向(②带硬修正);①②③④归 outer 实现(⑤归 manager);理由档案已入 orchestrator-loop-tick §熔融-结晶张力五方向。实现归 inner
