---
id: gap-quay-init-coldstart-usability-launch-not-used-huge-tick-doc-selftest-dominant
title: quay-init 冷启动可用性三缺陷——①消费方未用铺下的 quay-launch.sh 起会话（outer 无 --settings、inner 名非角色约定）②铺下 tick 文档 126,895 字节（冷启动第一件事读它）③基础设施自检占掉冷启动绝大部分（ad-arm1 archguard 15 分钟 / 120.6k token 诊断 monitor 为什么不发事件 = 设计如此）（F4/F5/F6）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实测（manager 2026-08-11 15:2x，ad-arm1 真实消费方 archguard，ssh 实测非猜测）——AC16③ Level3 第一次真的在跑**：

**F4**：两个会话都不是用铺下来的 `quay-launch.sh` 起的（outer 进程无 `--settings`、inner 名为 `inner` 而非角色约定名）⇒ 冷启动脚本铺下来了但没被用，要么不好用要么不显眼。

**F5**：铺下的 tick 文档 **126,895 字节**（quay 自己的 manager-loop-tick 1647 行也才约 50KB）——消费方 inner 冷启动第一件事是读一个 126KB 文档。

**F6**：archguard 的 outer 冷启动花了 **15 分钟 / 120.6k token** 在诊断「session-liveness monitor 为什么不发事件」（答案是设计上只在状态转换时发），**基础设施自检占掉了冷启动绝大部分，不是在驱动开发**。

### 验证锚

修后 (a) 消费方冷启动用铺下的 `quay-launch.sh` 起会话（outer 带 --settings、inner 用角色约定名）；(b) 铺下 tick 文档体积可控（或冷启动引导不强制先读超大文档）；(c) 冷启动时间/ token 主要花在驱动开发而非基础设施自检（自检可跳过/并行/缩短）；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 ad-arm1 archguard 实测（F4 未用 quay-launch.sh / F5 126,895 字节 / F6 15min 120.6k token 自检）
- [ ] AC2: **launch 可被消费方使用**——铺下的 quay-launch.sh 好用且显眼（冷启动文档指引用它）
- [ ] AC3: **tick 文档体积可控**——消费方冷启动引导不强制读超大文档（或文档瘦身）
- [ ] AC4: **自检不占主导**——冷启动自检可跳过/并行/缩短，主要时间花在驱动开发
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：ad-arm1 冷启动用铺下 launch + 体积/自检读数改善
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/quay-init.sh（冷启动引导文档 + 铺下 launch 的使用指引）
- plugin/skills/cold-start/SKILL.md（引导用铺下的 quay-launch.sh + 自检可跳过/并行）
- plugin/loop/*.md（tick 文档体积/冷启动引导）
- tasks/gap-quay-init-coldstart-usability-launch-not-used-huge-tick-doc-selftest-dominant.md（自身：勾 AC + 贴证据）

## Contract

measure   coldstart_uses_laid_launch = `grep -c 'quay-launch.sh' <冷启动铺下文档>` stdout 数字
band      coldstart_uses_laid_launch ≥ 1（冷启动文档指引用铺下的 launch）
invariant tick_doc_size_bounded = 1（铺下 tick 文档 ≤ 合理阈值，冷启动不强制先读）
invoke    `quay-init --loop` 到临时目标后量铺下文档字节 + 冷启动引导（贴证据）
control   launch 可用；体积可控；自检不占主导；既有不回归
resume    launch 指引 / 文档体积 / 自检优化分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: ad-arm1 archguard 真实消费方 Level3 首跑实测 F4/F5/F6——冷启动可用性三缺陷（launch 未用 / 126KB tick 文档 / 自检占 15min 120.6k token）。实现归 inner，判定归 outer
