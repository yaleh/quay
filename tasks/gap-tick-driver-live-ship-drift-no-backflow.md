---
id: gap-tick-driver-live-ship-drift-no-backflow
title: 3 项通用判准（枚举式判据 / status 必填枚举 /
  投递工具名）在跑副本有、出厂模板零命中——通用改进未回流出厂（纯测量：产出缺口清单，不含回流机制；manager
  出厂=通用模板为设计，字节差/同提交率非缺陷）
status: ready
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

- [ ] AC1: **前提确认**——manager 出厂=通用模板、在跑=实例落地是设计非缺陷（不修字节差）；"三层全部漂移"撤回
- [ ] AC2: **三判准缺口记录**——枚举式判据 / status 必填枚举 / 投递工具名，各列出在跑命中 vs 出厂模板命中（纯测量清单）
- [ ] AC3: **不含实例污染判据**——不用同提交率（模板-vs-实例结构污染作废）；用通用机制名 grep 出厂件
- [ ] AC4: **第四项排除**——「跳过六判准须声明豁免理由」无证据（tick-log 惯例非 .js），不写入
- [ ] AC5: 与 gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver（铺设，独立）、
      gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them（铺装改写）交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（三判准在跑/出厂命中清单 + 前提确认）
- [ ] 纯测量定位——不引入回流机制（机制形态留后续裁）

## Touches
- plugin/loop/manager-loop-tick.md / orchestrator-loop-tick.md / fast-mode-loop-tick.md（只读测量，不改）
- plugin/scripts/manager-tick-readings.ts / .claude/workflows/manager-tick-readings.js（只读测量）
- tasks/gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T05:3xZ
changed: 人 05:2x 裁定重写（非退回）。删 3 错误前提（manager 弃养/三层漂移/同提交率判据）+ 第 4 项无证据
  排除。站 3 项通用判准在跑有/出厂 0 的窄缺口。定位=纯测量（产出缺口清单，不引入回流机制——形态
  留后续裁）。内层已收到重写版。
