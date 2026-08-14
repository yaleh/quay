---
id: gap-tick-driver-live-ship-drift-no-backflow
title: 3 项通用判准（枚举式判据 / status 必填枚举 /
  投递工具名）在跑副本有、出厂模板零命中——通用改进未回流出厂（纯测量：产出缺口清单，不含回流机制；manager
  出厂=通用模板为设计，字节差/同提交率非缺陷）
status: done
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**【人 05:2x 裁定重写（非退回）】三层 tick 驱动"在跑/出厂漂移"重写为精确窄版：三项目通用判准（枚举式监视器判据 / 自审 violation 的 status 必填枚举 / 跨会话投递工具名必须入记录）在跑副本有、出厂模板零命中——通用改进未回流出厂。范围比原判断窄得多，但缺口真实。**

### 已实测前提（管理者 05:2x，可复核）

| 通用判准 | 在跑副本 | 出厂模板 .md |
|---|---|---|
| 枚举式监视器判据（枚举而非布尔） | 有 | **0** |
| 自审 violation 的 status 必填枚举 | 有 | **0** |
| 跨会话投递工具名必须入记录 | 有 | **0** |

- `plugin/scripts/manager-tick-readings.ts` 最后改动 2026-08-07T23:08Z，13,922 B；在跑副本（.claude/workflows/manager-tick-readings.js）36,037 B，含枚举式判据；
- **关键论证**：这三项【不含任何 quay 网络特有内容】（枚举进程 / 给违规分类 / 记录投递工具，任何装了 quay 的主机都适用）。**"通用模板"豁免的是项目列表、仓库路径、tmux 窗口名，豁免不到通用判准。** 所以缺口是真的，只是范围窄。

### 必须删除的错误前提（管理者已撤回）

1. **"manager 出厂件弃养"**——错。`plugin/loop/manager-loop-tick.md:1`「（通用模板）」+ 裁定 `gap-the-manager-layer-does-not-propagate-...` 第 208 行：管理者驱动按项目铺设、内容为网络通用模板。**出厂与在跑本就不该相等，字节差是设计**；
2. **"三层全部漂移、无同步纪律"**——未验证，撤回（orchestrator/fast-mode 是否模板-vs-实例未查）；
3. **同提交同步率判据作废**——被"模板 vs 实例"结构污染，测不出要测的东西。原 Contract 的 sync_rate measure 与 band **整条删除**。

### 实测结果（内层 2026-08-08 执行，纯测量）

三判准在跑副本 vs 出厂模板命中矩阵（grep 计数，非同提交率）：

| 判准 | 在跑 .js | tracked .ts | 出厂 manager.md | 出厂 orchestrator.md | 出厂 fast-mode.md |
|---|---|---|---|---|---|
| 枚举式判据 | 4 | 3 | **5** | 0 | 0 |
| status必填 | 3 | 0 | 0 | 0 | 0 |
| 投递工具 | 3 | 0 | 0 | 0 | 0 |

**前提修正（实测发现）**：任务体前提表「枚举式判据 出厂 0」**与事实不符**——manager 出厂模板已含枚举式判据（5 命中，含 line 198「枚举全部实例，不 break」正是该判据），tracked .ts 也含（3 命中）。**枚举式判据已回流出厂（manager 层）；status必填 / 投递工具 才是真实缺口（三层出厂模板全 0）**。判据范围进一步收窄：status必填 + 投递工具 两项缺口，枚举式判据缺口仅在 orchestrator/fast-mode 两层（manager 已回流）。

- status必填：在跑 .js 有（AUDIT_SCHEMA `enum: ['新发生','已入账','判准已退休']` line 292/306/383），tracked .ts 0，三层出厂模板 0 → **真缺口（三层）**；
- 投递工具：在跑 .js 有（lines 224/232/233「记录里必须写出用的哪个投递工具」），tracked .ts 0，三层出厂模板 0 → **真缺口（三层）**；
- 枚举式判据：在跑 .js 4 / tracked .ts 3 / manager 出厂 5（已回流）→ 缺口仅在 orchestrator（0）+ fast-mode（0）。
- **第 4 项确认排除**：`跳过六判准|豁免理由|六判准` 在 .js 与 .ts 均 0 命中（grep 实测）——tick-log 惯例，非 .js 证据，不写入。

### 不写进去的（无证据）

第四项「跳过六判准须声明豁免理由」——活在 tick-log 写作惯例里，不在 .js，grep 在跑副本 0 命中，**不能当证据**。只用上面三项。

### 本任务定位：纯测量（二选一，不两者并存）

**纯测量**：AC 只要求产出「哪些通用判准未回流到出厂」的清单（含每项在跑/出厂命中数），**不含回流机制落地**（机制形态——强制同提交/生成物/单源+覆盖层——是设计选择，越过停点，留给后续裁）。

## Contract

measure generic_in_ship = `for f in plugin/loop/manager-loop-tick.md plugin/loop/orchestrator-loop-tick.md plugin/loop/fast-mode-loop-tick.md; do echo "$f: 枚举=$(grep -cE '枚举式|枚举' $f 2>/dev/null) status必填=$(grep -cE 'status.*必填|必填.*status' $f 2>/dev/null) 投递工具=$(grep -cE '投递工具' $f 2>/dev/null)"; done` stdout 数字段（纯测量：出厂模板三判准命中数，当前应全 0）
measure live_has = `grep -cE '枚举|status.*必填|投递工具' plugin/scripts/manager-tick-readings.ts .claude/workflows/manager-tick-readings.js 2>/dev/null | paste -sd+ -` stdout 数字段（在跑副本三判准命中总数，>0 为缺口存在）
band generic_in_ship = 全 0（出厂模板无三判准）且 live_has > 0（在跑有）——纯测量记录缺口，不要求落地
invoke `grep -cE '枚举式|status 必填|投递工具' plugin/loop/*.md`
control 清单产出后，任一通用判准仍在跑有、出厂无（缺口记录准确）；不引入回流机制（纯测量）
resume 若中断，先跑 measure 读出厂模板三判准命中 + 在跑副本命中

## Acceptance Criteria

- [x] AC1: **前提确认**——manager 出厂=通用模板、在跑=实例落地是设计非缺陷（不修字节差）；"三层全部漂移"撤回
      **证据**：`plugin/loop/manager-loop-tick.md:1`「# 管理者 tick 指令（通用模板）」+「随 quay-init --loop 铺设」
      明示出厂=模板；本任务 Proposal「必须删除的错误前提」三条（弃养/三层漂移/同提交率判据）按人 05:2x 裁定整条撤回。
      出厂/在跑字节差是模板-vs-实例设计，不修。
- [x] AC2: **三判准缺口记录**——枚举式判据 / status 必填枚举 / 投递工具名，各列出在跑命中 vs 出厂模板命中（纯测量清单）
      **证据**：见 Proposal「实测结果」矩阵——在跑 .js / tracked .ts / 三层出厂 .md 各判准命中数已列出。
      **实测修正前提**：枚举式判据已回流出厂（manager 出厂 5、tracked .ts 3、在跑 .js 4）；
      **status必填（三层缺口）+ 投递工具（三层缺口）是真实缺口**；枚举式判据缺口仅在 orchestrator/fast-mode。
      命中清单 = grep 计数：`generic_in_ship` 实测 manager 枚举=5/status=0/投递=0、orchestrator 全 0、fast-mode 全 0；
      `live_has` = 在跑 .js 6 + tracked .ts 3 = 9（>0，缺口存在确认）。
- [x] AC3: **不含实例污染判据**——不用同提交率（模板-vs-实例结构污染作废）；用通用机制名 grep 出厂件
      **证据**：measure/band 全部改用 grep 计数（枚举式|枚举 / status.*必填 / 投递工具），原 sync_rate 同提交率
      measure 与 band 整条删除（Proposal 错误前提 3）。判据不含 quay 实例特有路径（home/yale/yaleh/work/quay）。
- [x] AC4: **第四项排除**——「跳过六判准须声明豁免理由」无证据（tick-log 惯例非 .js），不写入
      **证据**：`grep -cE '跳过六判准|豁免理由|六判准' .claude/workflows/manager-tick-readings.js plugin/scripts/manager-tick-readings.ts` → 两文件均 0 命中。
      Proposal「不写进去的（无证据）」段已明示排除，第 4 项不进入缺口清单。
- [x] AC5: 与 gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver（铺设，独立）、
      gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them（铺装改写）交叉标注
      **证据**：本任务 Proposal「前提确认」引用铺设任务裁定（manager 驱动按项目铺设、内容为网络通用模板）——
      铺设管「出厂件↔新工作区」，本任务管「在跑↔出厂」的缺口测量，两者独立；instance_specific 引用
      gap-install-rewrites-files（出厂模板不含实例特有路径为健康态）。

## Definition of Done

- [x] AC1-AC4 实跑输出贴任务体（三判准在跑/出厂命中清单 + 前提确认）——见各 AC 证据 + Proposal「实测结果」
- [x] 纯测量定位——不引入回流机制（机制形态留后续裁）——未改动任何 plugin/loop/*.md / .ts/.js（只读测量）

## Touches
- plugin/loop/manager-loop-tick.md（只读测量，不改）
- plugin/loop/orchestrator-loop-tick.md（只读测量，不改）
- plugin/loop/fast-mode-loop-tick.md（只读测量，不改）
- plugin/scripts/manager-tick-readings.ts（只读测量）
- .claude/workflows/manager-tick-readings.js（只读测量）
- tasks/gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T05:3xZ
changed: 人 05:2x 裁定重写（非退回）。删 3 错误前提（manager 弃养/三层漂移/同提交率判据）+ 第 4 项无证据
  排除。站 3 项通用判准在跑有/出厂 0 的窄缺口。定位=纯测量（产出缺口清单，不引入回流机制——形态
  留后续裁）。内层已收到重写版。
