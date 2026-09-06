---
id: GOAL-003
title: 插件面收敛 —— 单一 bundle、原生交付、死物归档
status: draft
kind: goal
origin: |
  人 2026-09-02 裁定「根据该 SPEC 创建一个新的阶段，稍后我们将执行这一阶段」+ 四条裁定：
  ① quay-init 复制 Claude Code 各种扩展文件的行为应当废弃；② 同一功能本项目自用与产品交付
  应是同一个，不应有「简化版用于产品交付」；③ 开发环境不污染本机其它项目，仅 User Scope
  以本项目目录为 plugin marketplace 源；④ 零调用的工具先退役（archive），后续需要再恢复。
  正本 orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md（460 行）。
labels: [next-phase, plugin-surface, single-bundle]
---

## 背景

当前插件面存在三处漂移：quay-init 复制 Claude Code 各种扩展文件（人 2026-09-02 判为非常糟糕的
实践）；「开发用」与「产品交付用」是两套（.claude/skills 5 个 + .claude/workflows 双副本）；
本机全局安装污染其它项目。SPEC-plugin-lifecycle-single-bundle-2026-09-02.md 实测 97 个死集脚本、
三天 178 次 mcp__quay__* 调用 vs 6 次 mcp__plugin_quay_quay__*。本 GOAL 把插件面收敛到「单一
bundle + 原生命名空间交付 + 死物归档」，按人四条裁定推进。

## 范围与非目标

范围：注册表/清单裸文件名扫描（AC156）；archive 机制与五个排除面接线（AC157）；执行批次一
git mv + INDEX 同一提交（AC158）；三个连带文档提及同步（AC159）；runtime-usage-inventory
枚举盲区（AC160）；用户级只留 marketplace 源（AC161）；register-plugin.mjs 不写用户级
enabledPlugins（AC162）；allowed-tools 改插件前缀（AC163）；命名空间承接生产流量（AC164）；
撤 root .mcp.json 条目（AC165）；第二副本退役（AC166）；baime-iteration-executor 摘除（AC167）；
quay-init 收缩闭集（AC168）；交付面与文档同步（AC169）。

非目标：AC1–AC142 的历史阶段迁移（留散文作档案）；milestone 词义的其它占用；插件功能本身的
增删（只做「同名同功能收敛」与「零调用退役」）；`label:milestone-candidate` 的存废。

## 退出条件

散文版：完成判据 14/14 全勾，且三条方向性读数同时成立——① mcp__plugin_quay_quay__* 调用数
> mcp__quay__*（当前 6:178 须翻转）；② 非 quay 项目会话 PATH 不含 <quay>/plugin/bin（当前含且
出现两次）；③ plugin/scripts 计数下降 ≥ 扫描后死集数且全量 suite 绿（当前 309）。切换需人明令
（不设自动切换，当前阶段 AC143–AC149 未达成时本阶段与其无依赖、可并行可后置）。机器判据在本
GOAL 的 14 条 AC 记录（AC156–AC169）里，**不在本节**。

## 风险

1. 顺序是硬的：AC156→AC158、AC163→AC164→AC165、AC157→AC158、AC160→AC156→AC158 四处颠倒即破坏
   （扫描前 archive = 按有缺口清单删东西；先撤后接 = 断 3 天 178 次生产流量）。
2. archive 不接线就执行会当场弄红 catalog / 测试 glob。
3. 仪器盲区不修就重算会拿「零执行」读数删 97 个脚本（该读数正是盲区的受害者）。
4. AC168 收缩若未显式包含安装步骤、或未修 plugin-root-resolution，下游 quay driver start 全线失效。

## 与其他 goal 的关系

本 GOAL 是 GOAL-001（goal 机制启用）迁移产生的下一阶段，迁入时 status=draft——是 draft 状态的
第一个真实载体（AC-172）。与 GOAL-002（三层塌缩）无依赖关系、可并行可后置，切换时机由人定。
它自己就是「用 goal 记录承载阶段」的第二个实例，证明 store 不只服务当前阶段。
