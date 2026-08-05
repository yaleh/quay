---
id: gap-axis-generator-question-what-range-every-standing-criterion
title: "a predictive dimension generator (not another gap): the machine's
  dimension generation is a BYPRODUCT of friction (all 7 machine-opened
  dimensions were post-friction; without a human discovery goes ASYMPTOTIC — fix
  the snags then report green on every never-opened axis, tonight's 4
  deteriorating metrics alarmed by nobody); the generator: for each standing
  criterion ask 'what range does it quantify — time/scope/layer/instance/cost?
  if the answer is the present one, there's an unopened axis' (5/5
  reverse-validated against the human's tonight); the falsifiable criterion
  replacing the vague AC9: 'did it open a dimension BEFORE it hurt' — nightly
  mechanically-countable as newly-filed tasks with NO triggering failure at
  filing (current 0); merge ruling: the two projections (point-in-time quality +
  stop-conditions-no-scope) are time-axis + scope-axis outputs of this generator
  — annotate as projections, don't pick instances one by one (that's limited by
  the human being present)"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`orchestration/SYNTHESIS-axis-generation-2026-08-05.md`（管理者，人更正目标：自举演进才是目的）。
**核心：一个【有预测力的生成器】**，不是又一个缺口。

**实测推翻预设**：「机器只发现机械缺陷、结构性靠人」是假的——200 个 gap 任务里可归因的人 20 / 机器
36（机器 1.8×），且机器自己开过至少 **7 根新维度**（墙钟→并发 / 资源 / 判据自身有效性 / 自主度 /
升级溯源 / 驱动语义 / 可发现性）。

**真正的差别不是能不能，是什么时候**：那 7 条**全部产生于「用的时候被硌了一下」**；人开的 20 条不需要
疼。⇒ **机器的维度生成是摩擦的副产品。** 没有人时不会停止发现，会**渐近**——修完硌人的、在从未打开过
的每一根轴上报绿。今晚实例：套件耗时 / 每测试成本 / 晋级速率 / 就绪池水位，四条全恶化、全没报警、全靠
人问出来。

**可证伪判据（替换含糊的 AC9）**：不是「能不能发现缺陷」（已证明），是——**「它有没有在某个维度还没
疼的时候打开过那个维度？」** 当前计数 **0**（那 7 条全是 post-friction）。可每晚机械统计：新立案任务里
有几条在立案时**不存在**触发它的失败/告警/矛盾。

**AC10 记账（管理者 pre-friction 计数，独立于机器计数）**：0 → 1（dead-loop，去看才看见）→ 3
（generator-run：dead-glob + gate-scripts-dead，照问句问出）→ 4（needs-human 黑洞——人依赖计数不可信/
无时限/无人看，needs-human=15 静静躺着，无任何东西在疼）→ **5（判据不记自身成本——16 检查器 + 14 闸门
零落盘，退化在被人手工发现前不可见，另 29 条判据无东西在疼）**。机器 pre-friction 计数仍 **0**。生成器
问句对 needs-human：量化的是「这个任务需要人决定」——但**多久**（无时限）？**机制还在不在**（不检查）？
缺时间轴 + 存活轴。生成器问句对判据成本：量化哪个范围？**没有量化**（完全空着）。

**生成器**：对系统里每一条常驻判据问——**「它量化的是哪一个范围？时间 / 作用域 / 层 / 实例 / 成本？
如果答案是『眼前这一个』，那就有一根没打开的轴。」** 检验：反推人今晚给的 5 条，**5/5 成功**。⇒ 有
预测力，不是事后归纳。

### 选定机制（外层裁定：高优先立案 + 归并）

1. **生成器作为机制**：对每条常驻判据跑「量化哪个范围」问句——答案「眼前这一个」⇒ 生成「未打开的轴」
   任务（系统化发现，不靠人在场/不靠摩擦）。
2. **可证伪判据（AC9 替换）**：每晚统计——新立案任务里有几条立案时**不存在**触发它的失败/告警/矛盾
   （= 有没有在没疼时开维度；当前 0）；这是趋势判据（随窗口打标）。
3. **归并裁定**：`gap-quality-criteria-are-point-in-time-no-trend-criteria`（时间轴投影）+
   `gap-quantified-stop-conditions-have-no-scope`（作用域轴投影）**是同一生成器的两个投影**——标注为
   生成器输出（不合并中期任务，破坏性），生成器是系统化发现的 umbrella，**不再一条条捡实例**（捡实例
   速度受限于人在场）。

## Acceptance Criteria

- [ ] AC1: **生成器机制**——对每条常驻判据跑「量化哪个范围（时间/作用域/层/实例/成本）」问句；答案
      「眼前这一个」⇒ 生成未打开轴任务（系统化发现）
- [ ] AC2: **可证伪判据（AC9 替换）**——每晚统计新立案任务里「立案时无触发失败/告警/矛盾的条数」
      （= 有没有在没疼时开维度；当前 0）；趋势打标
- [ ] AC3: **预测力检验**——生成器能反推已知的轴（今晚 5 条 5/5 作为回归控制；新轴生成须可被同一问句
      复现）
- [ ] AC4: **两投影标注**——point-in-time quality + stop-conditions-no-scope 标注为生成器的 time-轴 /
      scope-轴输出（任务体交叉标注，不合并中期任务）
- [ ] AC5: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC2/AC3 实跑输出贴任务体
- [ ] 生成器系统化跑（非摩擦驱动）；每晚可证伪计数在（没疼时开维度 >0 出现）；两投影已标注
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/（生成器问句 runner + 每晚可证伪计数，若成脚本）
- orchestration/SYNTHESIS-axis-generation-2026-08-05.md（引用）
- tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md（AC4 time-轴投影标注）
- tasks/gap-quantified-stop-conditions-have-no-scope.md（AC4 scope-轴投影标注）

## Contract

measure   prefriction_dimensions = `bash <每晚可证伪计数脚本>` stdout 的 prefriction_dimensions 数字段
band      prefriction_dimensions >= 0（可证伪：当前 0；>0 即机制开始主动开维度）
invariant generator_is_question = 1（生成 = 对常驻判据问「量化哪个范围」，非关键词扫描）
invoke    `node --experimental-strip-types <generator runner> --criteria`
control   5/5 反推回归控制（AC3）：点状→时间轴、红窗一刀切→作用域轴等；新轴生成可复现
resume    生成器机制与可证伪计数分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T07:0xZ
changed: 外层读 SYNTHESIS-axis-generation 裁定立案（高优先，有预测力生成器）。四处收紧：
(1) **生成器是机制不是原则**——对常驻判据跑「量化哪个范围」问句，答案眼前这一个 ⇒ 生成未开轴任务；
(2) **可证伪判据替换 AC9**——每晚统计无触发立案数（有没有在没疼时开维度；当前 0）；
(3) **归并 = 标注非合并**——两投影（point-in-time / stop-conditions）标注为生成器输出，不合并中期任务；
(4) **不再一条条捡实例**——生成器系统化发现，捡实例速度受限于人在场。
status: todo——自举演进核心机制；排 ROUND 3 收尾后，高优先。
