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

**三层 tick 驱动的【在跑副本】与【出厂件】全部漂移，无任何同步纪律。manager 层是极端案例——其出厂件实质弃养（30 天只碰 2 次，在跑改了 32 次）。这与已有的 `gap-the-manager-layer-does-not-propagate-...`（管铺设）【不是同一件事】：本任务管【回流】（在跑副本的演化回到出厂件），铺设任务管【铺设】（quay-init --loop 铺不铺 manager 驱动）。**

### 实测（管理者 04:5x，近 30 天同提交同步率）

| 层 | 在跑改动 | 出厂改动 | 同提交 | 同步率 |
|---|---|---|---|---|
| manager-loop-tick.md | 32 | 2 | 1 | **3%** |
| orchestrator-loop-tick.md | 42 | 53 | 11 | **26%** |
| fast-mode-loop-tick.md | 37 | 71 | 7 | **18%** |

- 最好的一层也只有 26%；**manager 出厂件 30 天只被碰 2 次、在跑改了 32 次**；
- **字节差方向不同**：manager 出厂 18,855B / 在跑 31,809B（在跑更大 → 演化只在本仓未回流）；orchestrator 出厂 91,490B / 在跑 72,599B（出厂更大 → 出厂件被独立维护）；fast-mode 同向。
- **outer/inner 出厂件是活的、只是不同步；manager 出厂件是死的**。

### 与已有任务的区别（本任务存在的理由）

`gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver`（ready）管**铺设**（quay-init --loop 不铺 manager 驱动）。本任务管**回流**（在跑副本演化不回到出厂件）。两者独立：即便铺设修好、byte-identity 断言（93bd3737/2dc55ba9 合法停用的那两条）恢复，它断的也是【出厂件 ↔ 新工作区的铺设结果】，**断不到【本仓在跑副本 ↔ 出厂件】这条边**——后者才是演化实际发生的地方。

**实锤**：今晚 2 小时管理者往判准加的四项（枚举式监视器判据、自审 violation 的 status 必填枚举、跨会话投递工具名必须入记录、跳过六判准须声明豁免理由）**全部只活在本仓在跑副本里，新工作区一个都拿不到**。

### 为什么这条压过提速类议题

阶段目标原话：「产品化的判据是装得上跑得起来（静态）；自举演进的判据是不在场时仍在开新维度（动态、趋势型）」。**一层演化出的机制若不回流到出厂件，它就只在这一个仓里演进过一次，下一个工作区从零开始**——那不是"演进慢"，是"演进不累积"。

### 判据（趋势型，一行可测）

同提交同步率 = `comm -12 <(git log --format=%H --since=30.days -- <live>|sort) <(git log --format=%H --since=30.days -- <ship>|sort) | wc -l` ÷ 在跑改动次数。符合阶段目标对自举演进的要求，不是一次性静态检查。

### 边界（管理者声明）

**不改法**：要不要强制同提交、要不要把在跑副本改成出厂件的软链/生成物、要不要只对 manager 层做——设计选择，越过停点。本任务只立测量与归类，改法由内层/外层后续裁。

## Contract

measure sync_rate = `python3 -c "import subprocess; l=subprocess.run(['git','log','--format=%H','--since=30.days','--','orchestration/manager-loop-tick.md'],capture_output=True,text=True).stdout.split(); s=subprocess.run(['git','log','--format=%H','--since=30.days','--','plugin/loop/manager-loop-tick.md'],capture_output=True,text=True).stdout.split(); c=len(set(l)&set(s)); print(f'{c}/{len(l)}={round(c*100/len(l),1)}%' if l else '0')"` stdout 数字段（回流机制落地后 manager 同步率显著高于 3%）
measure all_layers = `for p in "orchestration/manager-loop-tick.md plugin/loop/manager-loop-tick.md" "orchestration/orchestrator-loop-tick.md plugin/loop/orchestrator-loop-tick.md" "docs/analysis/fast-mode-loop-tick.md plugin/loop/fast-mode-loop-tick.md"; do set -- $p; l=$(git log --format=%H --since=30.days -- "$1"|wc -l); s=$(git log --format=%H --since=30.days -- "$2"|wc -l); c=$(comm -12 <(git log --format=%H --since=30.days -- "$1"|sort) <(git log --format=%H --since=30.days -- "$2"|sort)|wc -l); echo "$1/$2=$c/$l"; done` stdout 数字段（三层同步率）
band sync_rate = 显著 > 3%（回流机制落地后）且 all_layers = 三层都有同提交
invoke `python3 -c "import subprocess; l=subprocess.run(['git','log','--format=%H','--since=30.days','--','orchestration/manager-loop-tick.md'],capture_output=True,text=True).stdout.split(); s=subprocess.run(['git','log','--format=%H','--since=30.days','--','plugin/loop/manager-loop-tick.md'],capture_output=True,text=True).stdout.split(); print(len(set(l)&set(s)), '/', len(l))"`
control 回流机制落地后，任一层的在跑改动应出现在出厂件（同提交数上升）；出厂件不再是死件（manager 出厂 30 天 >2 次改动）
resume 若中断，先跑 measure 读三层同步率现状

## Acceptance Criteria

- [ ] AC1: **回流机制落地**——在跑副本的演化回流到出厂件（软链/生成物/同步纪律之一，设计选择留给执行）
- [ ] AC2: **manager 出厂件复活**——manager-loop-tick.md 出厂件不再 30 天 2 次改动；同步率显著上升
- [ ] AC3: **三层同步率上升**——orchestrator/fast-mode 同步率从 26%/18% 显著提升
- [ ] AC4: **趋势型判据**——同提交同步率作为持续判据（非一次性），符合自举演进要求
- [ ] AC5: 与 gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver（铺设，独立）、
      gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them（铺装改写）交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（回流机制 + 三层同步率前后对照）
- [ ] 回流机制接入出厂件发布路径（quay-init 铺装时在跑副本与出厂件一致）

## Touches
- plugin/loop/manager-loop-tick.md（或回流机制：软链/生成物）
- plugin/loop/orchestrator-loop-tick.md / plugin/loop/fast-mode-loop-tick.md（同机制）
- tasks/gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver.md（AC5 交叉标注）
- tasks/gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T05:0xZ
changed: 人 04:5x 指示提任务。实测确认三层同步率：manager 3%/orchestrator 26%/fast-mode 18%——manager
  出厂件弃养。与铺设任务独立（本任务管回流：在跑演化回出厂件）。判据趋势型一行可测。改法留给执行。
