---
id: gap-goal-status-stale-achieved-after-new-active-criterion-filed
title: 给已 achieved 的 GOAL 挂新 active criterion 后,GOAL 自己的 status
  字段不会跟着标记过期——真正完成与名义完成同形
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: plan
---
## Proposal

**实测证据（2026-09-14，第三方项目 quay-fleet，第一手读数）**：`GOAL-003`（quay-fleet 自己的目标）曾经
一度 `status: achieved`，之后陆续有 AC-025/026/029/030/031/032 被以 `status: active`（未达成）挂到它
名下（`goal: GOAL-003`）。`GOAL-003` 自己的 `status` 字段**没有跟着变化**——直到 fleet-warden（该项目的
驱动会话）人工发现并手动把它改回 `active`。核实读数：`quay goal list --json` 当前显示
`GOAL-003 [active]`（已经过人工修正），其名下 AC-029/030/031/032 四条状态确为 `active`（真实未达成）。

**根因（读代码确认，不是猜测）**：`packages/quay/src/goal-store.ts:1663` 的 `write()` 是**逐记录**函数——
写一条新 AC（`write("AC-029", {goal: "GOAL-003", status: "active", ...})`）时，函数体内**没有任何路径**
读取或改写它所属 GOAL（`GOAL-003`）自己的记录。两条记录的写入完全独立，没有耦合。

⚠️ **这不是"缺一个自动重开机制"，正确的修法方向必须避开一条已裁定的原则**：`plugin/scripts/goal-driver.ts`
在 `:516`、`:2243` 两处明确写着 ⛔「不得反向翻转状态（achieved→active；裁定 3：激活归人）」——人已经裁定
"激活"是人类/被授权行为者的决定，机制不能自动把 achieved 翻回 active。**任何修法如果表述成"机制检测到新
AC 就自动把 GOAL 翻回 active"，字面上就会撞上这条裁定，会被正确拒绝或需要重新裁定**——本任务的实现者
必须避免这个表述。

**真正的缺口是可观测性，不是自动化**：现在一个"名下全部 criterion 真的都 achieved 且 sufficiency covered"
的 GOAL，和一个"曾经 achieved、之后被挂了新 active criterion、状态字段从未更新"的 GOAL，读出来是**同一个
`achieved` token**——读者（人或下游机制）没有任何字段能区分这两种情况。这正是本仓库反复处理过的同一类
问题（硬规则 3b：一个"读不懂/需要人判断"的态，不得和"合格"共用同一个取值）——此前 `gap-goal-sufficiency-
gate` 等任务已经在 AC 层建立了 `covered`/`insufficient`/`not-evaluated` 三态可枚举的先例，本任务是把同
一原则用在"GOAL 状态与其子 criterion 集合的一致性"这个此前没覆盖到的角落。

**与已有任务的区分**：`gap-activation-gates-bypassed-on-reopen-path-non-draft-to-active`（已 done）修的
是"重开一个 GOAL 时，激活闸被绕过"这个问题——它处理的是**已经决定要重开**之后的闸门检查路径（`:840/867/890`
三道闸，按被写入记录自身的 `prevStatus`/`nextStatus` 判断是否触发）；本任务处理的是**更早一步**：新 AC
被挂上去这一刻，有没有任何信号告诉任何人"这个 GOAL 的 status 字段现在可能是假的"。两者不重复，前者是
重开路径本身的正确性，后者是"需要重开"这件事能不能被发现。

## Plan

1. **不做**：给 `write()` 增加"检测到 goal 已 achieved 就自动翻回 active"的逻辑——这会撞上裁定 3。
2. **做**：在写入一条 `goal: <G>` 的新 AC/更新 AC 记录时（`goal-store.ts:1663` 的 `write()`），若目标 GOAL
   `<G>` 当前 `status === "achieved"` 且本次写入的 AC 记录 `status !== "achieved"`（即真的引入了一条未达成
   子项），产出一个**独立、可枚举的观测信号**——不是把 GOAL 的 `status` 字段本身改写成别的字面量（那仍然
   是在"翻转状态"，只是换了个词，同样可能撞裁定 3 的精神），而是一条**旁路记录/事件**（类比
   `goal-driver.ts` 已有的 `writeDocDevelopSyncEvent`/各类 `*-sync.jsonl` 落痕手法）：一条形如
   `goal-staleness-signal.jsonl` 的事件，字段至少含 `goalId`、`staleSince`（本次写入的时刻）、
   `triggeringAcId`（是哪条新 AC 触发的）、`goalStatusAtTime`（当时读到的 GOAL status，即 `"achieved"`）。
3. **消费端**：`quay goal list`/`goal show`/dashboard 层读到一个 `status: achieved` 的 GOAL 时，若存在
   对应的、尚未被"人工确认处理过"的 staleness 信号，在展示/CLI 输出里追加一个独立可枚举的标记（例如
   `achieved（⚠️ 名下有 N 条未达成 criterion，状态可能已过期，需人工确认）`），⛔ 不与"真正干净的 achieved"
   同形输出。
4. **人工确认路径**：提供一个显式命令（或复用 `goal write --status active --reason "..."`  这类已有写入
   路径）让人/被授权行为者做出"是，需要重开"的**决定**，写入后清除对应的 staleness 信号——这一步维持
   "激活归人"，机制只负责让这件事可见，不负责替人做决定。

## Acceptance Criteria

- [x] AC1 构造一个 `status: achieved` 的 GOAL，往它名下写一条 `status: active` 的新 AC——写入完成后，
      staleness 信号载体（如 `goal-staleness-signal.jsonl`）必须新增恰好一条记录，字段完整（`goalId`/
      `staleSince`/`triggeringAcId`/`goalStatusAtTime`）。⛔ 负控制：往一个本来就 `active` 的 GOAL 挂新
      AC，不得产生 staleness 信号（只有"曾经 achieved"这一态触发）。
- [x] AC2 `quay goal list`（或等价读接口）读到一个带未清除 staleness 信号的 `achieved` GOAL 时，输出必须
      带有可枚举的过期标记；读到一个没有 staleness 信号、名下 AC 确实全部 achieved 的 GOAL 时，输出**不带**
      该标记——两种情况的输出必须可区分（不是同一个字符串）。
- [x] AC3 人工确认路径：对一条带 staleness 信号的 GOAL 执行"确认重开"动作后（走既有的 `status: active`
      写入路径，不新造一条），对应的 staleness 信号被标记为已处理（不是删除——保留审计痕迹，类比其他
      `*-sync.jsonl` 载体"事件不删只追加状态"的既有风格）；之后 `quay goal list` 不再显示过期标记。
- [x] AC4 `write()` 函数本身（`goal-store.ts:1663`）**不得**对被写入 AC 所属的 GOAL 记录做任何字段级修改
      （不改 `status`，不改任何既有字段）——只允许新增旁路的 staleness 信号记录。用一次前后对比
      （goal 记录的完整内容 diff）验证：GOAL 自己的 `.md` 文件字节内容在这次写入前后必须完全一致。
- [x] AC5 全量 `scripts/test.sh` 绿。

## Definition of Done

- 五条 AC 全部满足。
- ⛔ 不得让机制自动把 GOAL 的 `status` 字段从 `achieved` 改成任何其他值——这是本任务反复强调、必须遵守
  的边界（裁定 3：激活归人），AC4 是这条边界的直接机械验证。
- ⛔ 不得把这条 staleness 信号和"sufficiency 判定"的三态（covered/insufficient/not-evaluated）混在
  同一个字段里——两者是不同维度（一个问"AC 集合是否覆盖退出条件"，一个问"GOAL 状态字段是否还反映其
  子项的真实构成"），混合会重演硬规则 3b 同一类错误。
- 任务体保留本条的第一手证据：quay-fleet 的 GOAL-003 实测读数（AC-029/030/031/032 均 active、GOAL 曾经
  achieved 后被人工手动修正）+ `goal-driver.ts:516/2243` 裁定 3 的原文引用 + `goal-store.ts:1663 write()`
  函数确认零耦合的读码依据。
- 与 `gap-activation-gates-bypassed-on-reopen-path-non-draft-to-active`（done）的边界已在 Proposal 中
  区分：该任务修重开路径本身的激活闸；本任务修"需要重开"这件事的可见性。

## Touches
- packages/quay/src/goal-store.ts
- packages/quay/src/abi.ts
- packages/quay/src/cli/goal.ts
- packages/quay/test/gap-goal-status-stale-achieved-after-new-active-criterion-filed.test.mjs
- tasks/gap-goal-status-stale-achieved-after-new-active-criterion-filed.md
