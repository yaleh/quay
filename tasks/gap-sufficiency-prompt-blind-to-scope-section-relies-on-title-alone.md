---
id: gap-sufficiency-prompt-blind-to-scope-section-relies-on-title-alone
title: 充分性判官的第一层 prompt 只读标题+退出条件文本，看不到 `## 范围`——GOAL 可能在拆解完成前被机械翻 achieved
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`buildSufficiencyPrompt`（`plugin/scripts/goal-driver.ts:658-679`）组装给充分性判官的输入只有三样：
`goal_title`、`exitConditionsText(body)` 提取出的 `## 退出条件` 一节、以及当前在域 AC 的
`(id, title, expect)` 列表。**它不读 goal body 的 `## 范围` 或 `## 命题` 两节**——`exitConditionsText`
的正则（`:605`）只匹配 `## 退出条件` 标题到下一个 `##` 之间的文本，`## 范围`/`## 命题` 节的内容永远
不会进入这个函数的返回值，因而也永远不会出现在喂给判官的 prompt 里。

**这是一个真实、可复现的机制缺口，不是假设**。GOAL 机械翻 achieved 的唯一条件（`goal-driver.ts:2288`，
I2 推导）是「全部在域 AC achieved **且** 充分性判定为 covered」。而本仓库的「退出条件」写法（人 2026-09-13
裁定，见 GOAL-002/GOAL-003 body）刻意**不写死 AC 数字**（「四条 AC」这类字面数字会随拆解过程增长、变成
没人维护的谎言——GOAL-001 已经吃过这个亏，`docs/design/quay-fleet-design.md` 阶段1原文「四条 AC」
在阶段实际扩到 12 条后从未更新），退出条件文本因而写成结构性的自指句式（「本目标名下、未被 superseded
的全部 criterion 状态为 achieved，不写死数字」）。**这句话对任意数量的在域 AC 都同样成立**——它本身
不携带「这个目标应该有几块」的信息，那个信息实际写在 `## 范围` 节（一份人类可读的分解清单），而
**判官看不到这一节**。

⇒ 判官能否正确识别「当前只有 1 条 AC，还不够」，**完全依赖目标标题本身是否恰好写得足够详细**，
没有任何结构性保障。

**实测证据（2026-09-13，quay-fleet 项目，第一手读数）**：
- `GOAL-002` 于 `2026-09-13T14:40:34Z` 立项，此后 13 分钟（到 `14:53:45Z` AC-014 才被立案）**只有
  AC-013 一条在域 AC**，且 AC-013 已 achieved。`.quay/goal-sufficiency-cache.json` 记录判官在这个窗口内
  （`14:41:40Z`）真的被问到过，返回 `insufficient`——**这次答对了，但答对的唯一原因是 GOAL-002 的标题
  逐字写着「跨机聚合，全局 sessionKey，多机视图归并，本机 tailscale 身份只读」**，判官能从标题读出
  "只做了 sessionKey 一项、还有多机归并和 tailscale 两项没做"。
- `GOAL-003` 立项时同样只有 1 条在域 AC（`AC-016`），其 body 的 `## 范围` 节明确列了三块（PWA 壳静态
  服务 / SSE 驱动实时列表 / Web Push 订阅机制），但**判官看不到这节**——它能否正确判 `insufficient`，
  同样只取决于 `GOAL-003` 的标题是否巧合地把这三块都写进去了（这次恰好写了：「PWA 与推送 —— 一套代码
  覆盖桌面/手机，SSE 驱动会话列表，Web Push 订阅机制」）。
- ⇒ **两次都是标题恰好写得够详细，不是机制保证了什么**。若某次起草者图省事把标题写成「PWA 与推送」
  四个字（同样通过任何字段校验，因为标题字段没有长度/内容下限），而当时只有 1 条 AC，判官完全可能
  合理地（不是误判，是在【信息不足】的情况下给出的正确结论）判 `covered`——GOAL 会在起草者打算补第二
  条 AC 之前被机械翻 achieved，后续本该属于这个目标的工作变成孤儿（不会自动重开，需要人工发现并
  单独立一个新 GOAL 补齐，且没有任何读数会主动报出「这个已关闭的目标其实没做完」）。

## Plan

1. `buildSufficiencyPrompt` 增加读取 goal body 的 `## 范围` 节（若存在），复用与 `## 退出条件` 相同的
   提取手法（一个通用的 `extractSection(body, heading)` 帮助函数，`exitConditionsText` 改为调用它，
   避免同一正则逻辑写两份）。`## 范围` 节存在时附加进 prompt（单独一个小节，不与退出条件文本合并，
   保持判官输入的可追溯性）；不存在时行为不变（向后兼容旧的/没写这节的 GOAL）。
2. ⛔ 不强制要求每个 GOAL 必须有 `## 范围` 节——阶段1的 GOAL-001 立项时可能就没写这节，缺失时不能让
   充分性判定结构性失败（fail-closed 到 `insufficient` 或 `not-evaluated` 都可以，但要明确选一个、
   写清楚为什么，不能悄悄当成「没有范围限制」）。
3. `sufficiencyCacheKey`（`:681` 附近）的输入哈希也要纳入 `## 范围` 节文本——否则「范围节被编辑」不会
   触发重判（与「AC 集合变化触发重判」同一条纪律）。

## Acceptance Criteria

- [ ] AC1 给定一个 body 里 `## 范围` 列了 3 个子项、`## 退出条件` 只写通用句式、且只有 1 条已 achieved
      AC 的 GOAL，`buildSufficiencyPrompt` 的输出**必须**包含 `## 范围` 节的原文；对照：把 `## 范围`
      节删掉后再跑一次，两次 prompt 的输出**必须不同**（能取假：范围节存在与否要改变 prompt 内容，
      不能读了没用）。
- [ ] AC2 双向对照：注入一个总是读到 prompt 全文、按"标题+退出条件文本是否提及范围节里的关键词"判断
      的假判官——给它①带范围节的 prompt 和②不带范围节、但标题里手工塞进同样关键词的 prompt，若两次
      判官输出不同，证明范围节确实在影响判定（不是摆设）。
- [ ] AC3 `## 范围` 节缺失时（旧格式 GOAL）不报错、不崩溃，`buildSufficiencyPrompt` 正常产出（用一个
      没有该节的 body 跑一次，断言不抛异常且 prompt 仍含标题与退出条件文本）。
- [ ] AC4 `sufficiencyCacheKey` 在其他输入不变、只改动 `## 范围` 节文本时，输出的哈希值**必须不同**
      （若相同则说明范围节改了也不会触发重判，判据空转）。
- [ ] AC5 全量 `scripts/test.sh` 绿。

## Definition of Done

- 五条 AC 全部满足。
- ⛔ 不得把 `## 范围` 节的内容并入 `## 退出条件` 的判定文本（`hasExitConditions`/`goalSufficiencyVerdict`
  的机械层不应因为「范围节非空」就改变行为——本任务只扩展语义判官的【输入】，不碰机械可证层的既有逻辑）。
- ⛔ 不得为「必须写 `## 范围` 节」新增一条硬性校验挡住 GOAL 立项——这是 Plan 第2条明确排除的范围，
  历史 GOAL（可能没写这节）不能因此被结构性判死。
- 任务体须保留本条的两个第一手实测证据（GOAL-002 的 14:40-14:53 单 AC 窗口 + 判官在此期间的真实
  `insufficient` 判定；GOAL-003 当前的 `## 范围` 三项拆解与其标题措辞的对照）。

## Touches
- plugin/scripts/goal-driver.ts
- tasks/gap-sufficiency-prompt-blind-to-scope-section-relies-on-title-alone.md