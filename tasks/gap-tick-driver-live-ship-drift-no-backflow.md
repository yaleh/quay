---
id: gap-tick-driver-live-ship-drift-no-backflow
title: 三层 tick 驱动在跑副本与出厂件全部漂移（manager 同步率 3% 出厂件弃养、orchestrator 26%、fast-mode
  18%）——回流机制缺失（在跑演化不回出厂件），与铺设任务独立，判据趋势型一行可测
status: ready
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**【前提撤回重写，2026-08-08 管理者紧急更正】三层 tick 驱动"在跑/出厂全部漂移"原判断撤回——manager 层出厂件是通用模板（`plugin/loop/manager-loop-tick.md` 第 1 行 `# 管理者 tick 指令（通用模板）` + "随 quay-init --loop 铺设"），在跑副本是 quay 网络实例落地（33 处实例特有 vs 出厂 16 处）——字节差与低同提交率是【设计非缺陷】。orchestrator/fast-mode 的出厂/在跑不含实例特有（0），模板-vs-实例关系未确认，管理者一并撤回"三层全部漂移"结论。重写为窄版本：通用改进是否回流到出厂模板。**

### 原前提为何错（管理者自省 + 外层核实）

- 比较两个对象前没确认它们【是否应当相等】——manager 出厂（通用模板）与在跑（实例）本来就不该相等；
- 同型于今晚噪声带错误（把两个不同样本极差拼成一条带），两小时内第二次；
- 内层报的矛盾真实且部分源于措辞：任务体"只立测量与归类"与 AC1"回流机制落地"、band"同步率上升"自相矛盾。

### 窄版本（仍可能成立，管理者供判）

管理者今晚往判准加的四项——枚举式监视器判据 / 自审 violation 的 status 必填枚举 / 跨会话投递工具名必须入记录 / 跳过六判准须声明豁免理由——**全部是通用的，不含任何 quay 网络特有内容**。问题变成：**通用改进有没有进模板？**

判据**不能是原始同提交率**（被"模板 vs 实例"结构污染）。需要不含实例内容的判据：如"出厂模板是否含通用改进的关键词/机制名"（grep 出厂件 vs 在跑副本的通用机制，排除实例特有路径）。

### 边界

- **不判定 manager 字节差/低同提交率为缺陷**（是设计）；
- **改法留给执行**（要不要强制同提交、软链/生成物，设计选择）；
- orchestrator/fast-mode 的模板-vs-实例关系未确认——若确认是同类，同样不能用同提交率。

## Contract

measure gen_improve_in_ship = `for f in plugin/loop/manager-loop-tick.md plugin/loop/orchestrator-loop-tick.md plugin/loop/fast-mode-loop-tick.md; do echo "$f: $(grep -cE '枚举式监视器|status 必填|投递工具名|跳过六判准|enum.*判据|豁免理由' $f 2>/dev/null)"; done` stdout 数字段（通用改进回流后，出厂模板含相应机制名，≥1/层）
measure instance_specific = `grep -cE 'home/yale|yaleh|quay-0|work/quay' plugin/loop/manager-loop-tick.md` stdout 数字段（出厂模板应【不含】实例特有内容，=0 为健康）
band gen_improve_in_ship = 每层出厂模板含通用改进（≥1/层）且 instance_specific = 0（出厂模板干净、无实例特有）
invoke `grep -cE '枚举式监视器|status 必填|投递工具名|跳过六判准' plugin/loop/*.md`
control 通用改进（如枚举式判据）写入在跑副本后，回流到出厂模板（grep 出厂件命中）；出厂模板不含实例特有路径
resume 若中断，先跑 measure 读各层出厂模板通用改进数 + 实例特有数

## Acceptance Criteria

- [ ] AC1: **前提确认**——manager 出厂=通用模板、在跑=实例落地是设计非缺陷（不修字节差/同提交率）
- [ ] AC2: **通用改进回流**——管理者四项（枚举式判据/status 必填/投递工具名/豁免理由）等通用改进写入在跑副本后回流到出厂模板（grep 出厂件命中）
- [ ] AC3: **判据不含实例污染**——不使用原始同提交率（模板-vs-实例结构污染）；用不含实例内容的判据（通用机制名 grep 出厂件）
- [ ] AC4: **orchestrator/fast-mode 关系确认**——确认它们出厂/在跑是否模板-vs-实例（若是同样不能用同提交率）
- [ ] AC5: 与 gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver（铺设，独立）、
      gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them（铺装改写）交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（出厂模板通用改进数、实例特有数、orchestrator/fast-mode 关系确认）
- [ ] 通用改进回流机制接入（在跑副本通用机制写入出厂模板）

## Touches
- plugin/loop/manager-loop-tick.md / orchestrator-loop-tick.md / fast-mode-loop-tick.md（通用改进回流）
- tasks/gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver.md（AC5 交叉标注）
- tasks/gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T05:2xZ
changed: 管理者紧急更正撤回原前提：manager 出厂=通用模板、在跑=实例落地是设计非缺陷（模板-vs-实例）。
  原任务（三层同步率判据）作废——被结构污染。重写为窄版本：通用改进是否回流到出厂模板，
  判据用不含实例内容的通用机制名 grep 出厂件。内层已紧急暂停原任务。
