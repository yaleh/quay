---
id: GOAL-906
title: AC/DoD checkbox 计数等 3 个纯判定函数收敛到 kernel/ 单一定义（4 份零共享 import 实现 → 1 份）
status: draft
kind: goal
origin: 架构分析改进方案 G-1（2026-10-21 会话，基于 ArchGuard detect_duplicates + 源码按位置核对）
---
## 背景

archguard detect_duplicates（scope b4f87b21 @ HEAD 6473463e3）实测：AC/DoD checkbox 计数在 packages/quay/src 与 plugin/scripts 之间存在多份零共享 import 的独立实现——plugin/scripts/task-schema.ts:420 注释自认「数任务体里的 AC/DoD 复选框这个判定曾有 4 个零共享 import 的独立实现」；countAcCheckboxes（packages/quay/src/task-parsing.ts:117 vs plugin/scripts/task-schema.ts）、stripTrailingFullWidthAnnotation（packages/quay/src/observation.ts:504 vs plugin/scripts/touches-parser.ts:78）、expandGlob（plugin/scripts/canonical-test-files.ts:41 vs scripts/test-coverage-check.ts:122）各自双份。这是 GOAL-032（parseBinaryVerdict 2→1 收敛到 kernel/verdict-parse.ts）同一形状、更大的规模。

## 调查结论（机械事实 / 判断分开）

机械事实：上述函数定义处如上（按位置核对，非关键词）。kernel/ 是产品层与工具层唯一可双向 import 的共享叶（import-graph-check 棘轮禁止 packages→plugin 反向边），是这类无副作用纯判定函数的正确归属（GOAL-031/032 先例：verdict-parse、shape-sections、regex-escape 均在 kernel/）。

判断：checkbox 计数、全角注解剥离、glob 展开都是「无副作用的纯判定」，跨层重复实现违反单一真源（硬规则 5b：修好一处 ≠ 只有一处）。

## 范围与非目标

范围：三个纯函数各收敛为 kernel/ 单一定义；产品层与工具层各消费方 import kernel/ 真身；删除其余定义；detect_duplicates 不再报这三组。
非目标：不改变 AC/DoD 计数的判定语义本身；不碰 drain-scheduler.ts 双副本（另一机制，另行处理）。

## AC

- AC-909：countAcCheckboxes / stripTrailingFullWidthAnnotation / expandGlob 各恰 1 个定义处，且消费方 import kernel/ 真身。