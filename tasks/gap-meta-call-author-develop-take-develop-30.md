---
id: gap-meta-call-author-develop-take-develop-30
title: author↔develop 同步 take-develop 拒绝（脏工作树/不可弃提交）持续时无消抖、无升级——一个脏文件冻结同步 30+ 分钟
status: needs-human
labels:
  - meta-human-call
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding
当 take-develop 终局解因工作树脏或提交不可弃而被拒绝、且拒绝跨 tick 持续时，同步机制应当保持每 tick 重拒（status quo）、按状态变化消抖、还是消抖并升级给人类？

**要人裁决的是什么**：author↔develop 同步 take-develop 拒绝（脏工作树/不可弃提交）持续时无消抖、无升级——一个脏文件冻结同步 30+ 分钟
**选项与代价**：A 保持每 tick 重拒：活性可见、脏文件清理后自愈，但一个事件淹没 syncHealth 窗口且冻结期间无任何升级（10-31 .mcp.json 实测 30+ 分钟，worktree 跑旧代码）；B 按状态变化消抖：一次阻塞=一条事件，计数可解读，但持续阻塞更安静、仍无人类升级；C 消抖+升级：连续 N 次同因拒绝后写 META/needs-human 信号，闭合冻结盲区但新增一条通知路径且有噪声风险。
**为什么机器不能自决**：读码+读原始 .quay/doc-develop-sync.jsonl 解释读数：semanticTakeDevelopRefused=7、semanticConflict=7、ffError=13 全部来自同一次 .mcp.json 脏工作树事件（10-31 09:18–09:41 每 ~70s 一条相同拒绝）。CLAUDE.md 的「永不卡死」不变量与拒绝终止态互相矛盾且无既定裁决，属未声明的方向取舍，机器不得单方面定夺。
**若机器自行选错，什么难以撤销**：选错方向要么自动丢弃/提交脏文件从而销毁人已授权的未提交改动（拒绝守卫正是为防此损失），要么不加升级使冻结的同步与健康同形、静默持续到人类偶然发现——两者都难逆转。
**实测依据**：`syncHealth.semanticTakeDevelopRefused` = 7（meta-driver 机械采集于 2026-11-01T18:28:45Z）

**互相矛盾的既有立场（逐字引用，已机械核对确实存在于对应文件）**：
- `CLAUDE.md`：「因为允许损失 doc 侧变更，「取 develop」永远是有效解 ⇒ 语义同步必成功、永不卡死」
- `plugin/scripts/driver-filters.ts`：「reset 前先枚举工作树；有任何 reset 会破坏的状态 ⇒ 拒绝」

## AC（draft）
- [ ] 人在上述选项中作出选择，并把选择写进本任务体（或以 DIR 记录该裁定）
- [ ] 依该选择产生的后续工作已立案或已落地（⛔ 不以「已回答」本身充当完成）

## DoD（draft）
- [ ] 裁定已记录在可被后续读到的正本里，⛔ 不只存在于本任务的对话中
- [ ] 上面两条互相矛盾的立场中，落败的一方已被就地更正或标注，⛔ 不留着继续制造同一次冲突

## Touches
- `plugin/scripts/driver-filters.ts`
- `plugin/scripts/meta-driver.ts`
- `tasks/gap-meta-call-author-develop-take-develop-30.md`