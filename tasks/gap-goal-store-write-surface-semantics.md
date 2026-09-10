---
id: gap-goal-store-write-surface-semantics
title: goal 写入面语义六缺陷：CLI 强制 --origin 制造覆盖写（底层本是 patch 语义）+ update 无内容校验 + 激活 AC
  零校验 + activatedAt 死字段
status: done
labels:
  - gap
  - defect
  - goal-store
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

goal 记录的写入面有六个缺陷，**全部落在 `packages/quay/src/goal-store.ts` 的 `write()`（:582）与 CLI `main()`（:749+）**——两两 Touches 重叠，拆开只会换来强制串行派发 + 多次 worktree/fan-in，收益为零，故合为一条。以下证据全部采于 2026-09-09 的实测，非主张。

**P1 根因——危险默认由 CLI 单独制造。** CLI `:810` 强制每次 `write` 都传 `--origin`，而底层 `store.write()` 本就是 patch 语义、省略即保留。双向实测：

```
CLI  : write AC-960 --status active（不传 --origin）  → exit=2 "write requires --origin"
Store: s.write("AC-960", { status: "active" })（不传） → exit 0，origin 逐字保留
```

⇒ 每个调用方必须自己 read-modify-write，忘了就**静默抹掉立条依据**；该补偿 dance 已被复制进生产代码两处（`goal-driver.ts:650`、`:661` 的 `String(ac.origin ?? "")`）。

**P2 竞态——P1 的直接后果。** goal-driver 每轮取一次 records 快照（`:626`），flip 时回传快照里的 origin ⇒ 人在快照之后、flip 之前改了 origin，会被旧值静默覆盖，无守卫、无痕迹。

**P3 状态变更无载体。** `activatedAt` 在 schema 里（`:99`/`:198`/`:711`）但**无任何代码路径给它赋值**（全仓 grep 无赋值点；生产 `goals/` 仅 GOAL-001/002 两个手写残留）。⇒ 激活理由被迫写进 `origin`，把 provenance 字段污染成 changelog（2026-09-09 已因此污染 GOAL-010 / AC-208 / AC-209 三条记录）。

**P4/P5 update 路径无内容校验。** 完整性契约是 create-only（`:659` `if (!existingFile)`，为放行 driver 的 status-only flip）。实测 update 时把 criterion 清空 ⇒ **exit 0**，静默写成空串；且校验只看非空不看有内容——实测 `--expect "判据 exit 0"`（同义反复）顺利通过。

**P6 激活 AC 零校验。** `:685` 的闸是 `if (isGoalRecord && frontmatter.status === "active")`，**只管 GOAL 记录**。激活一条判据语法错、恒真、或不可评估（gate verdict = `not-evaluated`）的 AC，没有任何东西会拦。

**P9/P10 人机工程。** CLI 无 `--dry-run`（只有 list/get/write/gate/check）；激活一条 AC 会把它的判据加进每轮热循环而无任何告知——实测 GOAL-010 的 6 条 = **6.26s/轮**（其中 AC-208 单条 2.1s，因它 spawn 一次完整 `goal-store list`）。

**修法（七步，同文件同函数簇，一次改完）**：

1. CLI `--origin` 改为 **create 必传、update 可省**；省略即走底层 patch 语义（⛔ 无需改 `store.write()`，它已经是对的）
2. 删 `goal-driver.ts:650`/`:661` 的 origin 回传 —— P2 的竞态随之消失
3. 完整性校验改按**本次写入触碰了哪些字段**分流，取代 create/update 分流：只写 `status` ⇒ 不校验内容（这才是 create-only 的初衷，放行机械 flip）；写了 `criterion`/`expect` ⇒ 校验非空 ∧ ≥ `MIN_SECTION_CHARS` 非空白字符
4. 激活前置闸：`draft→active` 先跑一次 gate，`verdict ∈ {pass, fail}` 才放行；`not-evaluated` ⇒ 拒绝并把 stderr 报出来；`--force` 留给明知故犯。它同时覆盖「判据经 YAML 往返是否仍可跑」——由"真的能跑"证明，不靠人记得验
5. `activatedAt` 复活 + append-only `statusLog: [{at, from, to, actor, reason}]`。**实现时必须在代码注释里写下它与 `evidence` 的分界理由**，否则下一个人会照 `gap-goal-evidence-cache-should-not-enter-git` 的先例把它删掉：evidence 每 ~42s 重算**且可从账本派生** ⇒ 不该落盘；状态变更低频、单调追加、**且无处可派生**（gate-events 只记 verdict，不记 status flip）⇒ 必须存
6. CLI 暴露 `--dry-run`（write 与 gate 都要）
7. 激活时打印该判据的实测墙钟，让 P10 的代价可见

**防退化断言下沉套件**：第 1/2/3 步的「别再退化」那半是 hermetic 常设不变式，按已定分界线（hermetic → 套件；生产载体的长期保证 → 复验域；活性 → 归监控）下沉现成载体 `plugin/test/goal-invariants-standing.test.mjs`，⛔ 不写成 goal AC——`achieved` 不可逆，活性/常设判据写成 goal AC 正是 2026-09-09 退役 AC-180/184/186 的类别错误。

**与既有任务的关系（查重按机制，非症状）**：`gap-goal-record-completeness-undefined`（done）建立了 create-only 的完整性契约——本任务第 3 步是它的**后继**（把 create-only 分流换成字段分流），不是重复。提交信息的动作与写入者归姊妹任务 `gap-store-commit-action-and-actor`，本任务不碰。

## AC

- [x] AC1（P1 根治，双向负控制）：对**既有**记录 `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts --root <tmp> write <既有id> --status active` 不传 `--origin` ⇒ exit 0 **∧** 该记录 origin 与写入前逐字相同；反向：同一命令用于**新建** id ⇒ 仍 exit≠0（create 必传，契约不被削弱）。
- [x] AC2（P2，按位置判定）：`grep -c 'origin ?? ""' plugin/scripts/goal-driver.ts` == 0 **∧** `writeGoalStatus` 的签名不再要求 origin 参数。
- [x] AC3（P4/P5，双向）：对既有 AC 记录 `write <id> --criterion ""` ⇒ exit≠0（当前为 exit 0）；反向：`write <id> --status achieved`（只碰 status）⇒ exit 0，机械 flip 不被挡。
- [x] AC4（P6，双向）：激活一条 criterion 为不可评估命令的 AC ⇒ 拒绝且 stderr 含 `not-evaluated`；反向：激活一条判据可跑（pass 或 fail 均可）的 AC ⇒ 放行。
- [x] AC5（P3，双向）：一次 `draft→active` 之后该记录含 `activatedAt`（首次激活时刻）**∧** `statusLog` 追加一条含 `{at, from, to}`；反向：只改 `title` 的写入不追加 statusLog 条目。
- [x] AC6（P9）：`write <id> --status active --dry-run` ⇒ exit 0 **∧** `git status --porcelain goals/` 无新增变化 **∧** 该记录内容未变。
- [x] AC7（防退化下沉）：`node --no-warnings --experimental-strip-types --test plugin/test/goal-invariants-standing.test.mjs` exit 0，且该文件含对 AC2 与 AC3 两条不变式的断言。

## DoD

- 六个缺陷在**真实** `goals/` 载体（或以 `--root` 指向的真实拷贝）上不再复现：AC1–AC6 逐条在真实 store 上跑过，⛔ 不是注入 fixture 满足的。
- `goal-driver.ts` 的两处 origin 回传已删，且 goal 机械环仍能正常 flip——以生产轮记录里出现新的 `flips` 条目为准，或以负控制单测证明 flip 路径未回归。
- `statusLog` 与 `evidence` 的分界理由已写进代码注释（可 grep 到「派生」与「落盘」两词的对照说明），否则下一个人会照 evidence 的先例把它删掉。
- 全量 `scripts/test.sh` 绿。

## Touches

- `packages/quay/src/goal-store.ts`
- `plugin/scripts/goal-driver.ts`
- `packages/quay/test/goal-store.test.mjs`
- `plugin/test/goal-driver.test.mjs`
- `plugin/test/goal-invariants-standing.test.mjs`
- `tasks/gap-goal-store-write-surface-semantics.md`