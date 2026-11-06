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

## 裁定（2026-11-06，人）
**选择**：不改「每 tick 重拒」，也不新增 driver 侧通知路径；让阻塞态在**既有读数**里可见，由既有 meta-driver 语义半在阻塞开始/结束时各判读一次（即在已落地的 Option B 之上闭合升级盲区，而不是 Option C 的 META/needs-human 直写路径）。

**裁定依据（现场读数）**：
- Option B（按成因消抖）已于 2026-11-03 落地：提交 `e10c0c34d`，`plugin/scripts/driver-filters.ts` 的 `refuseTakeDevelop` / `lastOngoingRefusal` —— 同一阻塞只落一条事件。A 已不是现状。
- 消抖之后阻塞仍静默：`collectSyncHealth`（`plugin/scripts/meta-driver.ts`）不读 `doc-develop-sync-bidirectional` 的 `docToDevelop`，`readingsDigest` 只取 `lastEvent` ⇒「阻塞中」与「健康」摘要同形（都是 `sync:doc-develop-sync-bidirectional`）⇒ 摘要不变 ⇒ 语义半不被唤醒。
- 生产读数：21 条拒绝全部来自同一次 `.mcp.json` 脏工作树（2026-10-31T09:16–09:41），此后无新的拒绝；裁定当日主检出无已跟踪改动。

**选项代价（人已权衡）**：
- 复用读数：不新增通知路径、天然消抖（一次阻塞至多判读两次：开始/结束）；代价是升级仍走语义半的既有通道（autoDrive / needs-human），不保证立刻出现一条任务。
- Option C 原义（driver-filters 直写 META/needs-human）：多一条通知路径、需新增计数状态（消抖后次数已不可见），与仓库「不新建第二个机制」的纪律冲突。
- 停在 B：长阻塞依旧安静，只能靠人偶发发现。

**后续工作（已立案）**：`tasks/gap-meta-synchealth-doc-to-develop-outcome-invisible.md`（status: todo）—— `SyncHealth.lastDocToDevelop` 三态 + `readingsDigest` token + probe spec + 真实生产载体复算。

**落败立场（DoD2 已执行）**：`CLAUDE.md` 的「语义同步必成功、永不卡死」已就地标注例外——守卫在工作树不干净时会**有意拒绝并让同步等待**（不永久 wedge，冻结期间不算「成功」）；`plugin/scripts/driver-filters.ts` 同一表述处一并标注（提交 `99e701e34`）。

## AC（draft）
- [x] 人在上述选项中作出选择，并把选择写进本任务体（或以 DIR 记录该裁定）
- [x] 依该选择产生的后续工作已立案或已落地（⛔ 不以「已回答」本身充当完成）

## DoD（draft）
- [x] 裁定已记录在可被后续读到的正本里，⛔ 不只存在于本任务的对话中
- [x] 上面两条互相矛盾的立场中，落败的一方已被就地更正或标注，⛔ 不留着继续制造同一次冲突

## Dark Axis（ADR-007）
该轴仍暗,理由:本任务只写裁定与文档标注（任务体、CLAUDE.md、driver-filters.ts 注释），不改变包/依赖结构，L_D/L_G 无本任务可归因的结构读数。

## Touches
- `plugin/scripts/driver-filters.ts`
- `plugin/scripts/meta-driver.ts`
- `CLAUDE.md`
- `tasks/gap-meta-call-author-develop-take-develop-30.md`