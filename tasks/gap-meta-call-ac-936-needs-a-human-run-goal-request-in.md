---
id: gap-meta-call-ac-936-needs-a-human-run-goal-request-in
title: AC-936 needs a human-run goal request in the main checkout
status: ready
labels:
  - meta-human-call
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding
AC-936 的判据要求主检出 `.quay/goal-requests.jsonl` 里至少一条被 driver 消费的请求，而 worker 的写守卫禁止把主检出当作写目标、goal-driver 又把该 AC 判为 world-gated 不派活 ⇒ GOAL-914 的收尾停在一次人工动作上。这份证据应该由谁产生？

**要人裁决的是什么**：AC-936 needs a human-run goal request in the main checkout
**选项与代价**：① 人工/manager 在主检出跑一次 `quay goal request GOAL-914 AC-936 --reason '<why now>'`，下一轮 goal-driver 消费即转绿；代价=一次人工动作，但证据仍是外部真实请求；② 让 goal-driver 在世界门控时自己提交一条请求；代价=AC 的证据变成自产，driver 用自己的运行造出证明自己机制的载体，此后真请求与自产请求不可区分；③ 放宽 AC-936 判据接受 worktree 证据；代价=直接废掉 AC-938/AC-941 刚建立的『绿必须来自落地后的生产写入』
**为什么机器不能自决**：机器不能自决：①/②/③ 的差别不是实现选择，而是『这条判据还要不要能取假』——② 让 driver 自己造出证明自己机制的载体（硬规则 4：结构上不可能取假的量不是测量），③ 让 worktree 的一次性证据重新算数（AC-938/AC-941 正是为杜绝它而立的否证条件）。本轮读数为 fail，timeSeries `goal:AC-936:verdict` 已连续 50 轮 unchanged=fail、crossed=true（threshold 8）；证据文档把 ① 写成预期，同一段又承认主检出载体不存在，与 GOAL-914 命题『推进不应依赖人』相抵。
**若机器自行选错，什么难以撤销**：若机器自行选 ②（driver 自产请求），此后 `.quay/goal-requests.jsonl` 再也分不清真外部请求与自产请求，AC-936 的证据永久失去取假能力——这种污染不会自愈，只能靠人事后重造载体与判据；③ 一旦落地，AC-938/AC-941 建立的『生产载体』纪律就被同一份判据自己撤回。
**实测依据**：`criteria.AC-936.verdict` = "fail"（meta-driver 机械采集于 2026-11-06T20:04:49Z）

**互相矛盾的既有立场（逐字引用，已机械核对确实存在于对应文件）**：
- `docs/evidence/2026-11-06-goal-request-queue.md`：「它由第一个真正调用该动词的人创建。worker 的写守卫禁止把主检出路径当作写目标」
- `goals/GOAL-914-goal-driver-自驱闭环-立案生命周期-下一步投影与请求消费-quay-native.md`：「结果是：goal 的推进仍然依赖人读 round fact、人写任务、人恢复卡住的任务。」

## Worker Reading (2026-11-07) — 本任务需要 worker 产不出的东西

**这是读数与落地清单，⛔ 不是裁定。** 本 worker 会话**未勾任何 AC**：两条 AC 的内容都是「人作出选择并落实」，
而 worker 既不能代替人选择，也不能执行选项 ① 的那条命令（写守卫把主检出当写目标 = 违规）。所以本轮只做三件
worker 能真做的事：把现场读数摆齐、把每个选项的落地代价写成可执行清单、留一条**人可直接跑的只读确认命令**。

### 1. 现场读数（直接量，本次采集于 2026-11-06T20:20Z 前后）

| 读数 | 取值 | 采集方式 |
|---|---|---|
| AC-936 verdict | `fail`，reason=`no goal-requests ledger` | `quay goal gate AC-936 --store --root /data/home/yale/work/quay --json` |
| 主检出载体 | `/data/home/yale/work/quay/.quay/goal-requests.jsonl` **不存在** | `ls` |
| 连续 fail 轮数 | **52**（2026-11-06T08:43:30Z → 20:16:53Z 期间 52 轮无一次非 fail；全历史 54 次读数里 53 fail / 1 not-evaluated） | 逐轮提取 `.quay/goal-round.jsonl` 的 `goal-ring.criteria` |
| GOAL-914 其余 AC | AC-934 / 935 / 937 / 938 / 939 / 940 / 941 / 942 **全部 achieved（pass）** | 同上 |
| 缺口投影 | `{goal:GOAL-914, ac:AC-936, gapState:"world-gated", owner:"world", action:{kind:"wait"}, blocker:null}` | `goal-ring.next` |
| 消费者接线 | `goal-ring.requests` = `{evaluated:true, openBefore:0, appended:0, errors:[]}` | 同上 — 通道每轮在跑，只是从来没有请求可消费 |

⇒ **AC-936 是 GOAL-914 唯一未达成的 AC**（任务体原写的「连续 50 轮」现在是 52 轮）。整条 GOAL 的收尾
= 主检出里出现一条被消费的终态请求行，没有第二件事。

### 2. 为什么本 worker 不能自己消掉它

- ①/②/③ 的差别是「这条判据还要不要能取假」，不是实现选择 ⇒ 属人的方向裁定（见 Finding 的论证）。
- 选项 ① 要求**在主检出**写 `.quay/goal-requests.jsonl`；worker 的 Bash 写守卫逐字禁止把主检出当写目标。
- 选项 ② 会让该载体分不清真外部请求与自产请求（硬规则 4：结构上不可能取假的量不是测量）。
- 选项 ③ 会撤回 AC-938 / AC-941 刚建立的「绿必须来自落地后的生产写入」。

### 3. 三个选项的落地清单（裁定后可直接照做）

**① 人工 / manager 在主检出跑一次真实请求 —— 成本最低，证据仍可取假**

```
cd /data/home/yale/work/quay
node --experimental-strip-types packages/quay/bin/quay.ts goal request GOAL-914 AC-936 \
  --reason 'GOAL-914 closure: AC-936 is the last unmet criterion; first real request on the production carrier'
```

然后等下一轮 goal-driver（约 ≤10 分钟）。**⚠️ 第一次消费很可能落 `refused` 而不是 `accepted`**——那不是失败：
那一刻载体上还没有终态行，判据如实判红；再发一条（reason 换一句）即转 `accepted`。这条「先 refused 后 accepted」
的链是 `docs/evidence/2026-11-06-goal-request-queue.md` §2–3 的实测原件，不是推测。
裁定落地后还需：把选择写进本任务体（或 DIR）并勾 AC1；消费落定后勾 AC2。

**② 让 goal-driver 自产请求** —— ⛔ 三个选项里唯一**不可撤销**的

改 `plugin/scripts/goal-driver.ts` 的世界门控分支（`worldGatedRoutes` / `readsProductionCarrier` 判定之后），
在 gapState=world-gated 且判据读 `.quay/goal-requests.jsonl` 时由 driver 自己 append 一条 `requested-by:driver` 的行。
必须同时改 `goals/AC-936-*.md` 的 `expect`，声明「自产请求也算」——否则这条 AC 从此恒真，结构上取不了假。

**③ 放宽 AC-936 判据接受 worktree 证据**

改 `goals/AC-936-*.md` 的 `criterion`，让它接受任意 root 下的载体；并同步修改 AC-938 / AC-941 的否证条件，
否则同一份判据自己撤回了刚建立的纪律。

### 4. 本任务在同一小时内被两次从 needs-human 退回 todo，两次都没有理由

| 时刻 | 事件 | 说明 |
|---|---|---|
| 20:12:19Z | seq 1335 **create** as `needs-human` | meta-driver 立案（actor `cli:49009`）——系统自己把这条判为「待人」 |
| 20:13:53Z | seq 1337 `needs-human → todo`（retreat） | actor `cli:221186`，commit `7e24d0395`，diff = 仅 `status` 一行 |
| 20:14:43Z | seq 1338 `todo → ready` | promotion-driver 机械晋升，随后派到本 worker |
| 20:28:32Z | seq 1339 `ready → needs-human` | **本 worker** 的裁定请求（actor `mcp`，session `43003894…`） |
| 20:29:26Z | seq 1340 `needs-human → todo`（retreat） | actor `cli:3369341`，commit `99fc96141`，diff = 仅 `status` 一行，**54 秒后** |

两次退回的形态逐字相同（身体不变、只改 status 一行），且都在立案/停放后 1 分钟内发生 ⇒ 这更像**机制**而非两次人的决定：

- `.quay/worker-round.jsonl` 在 `20:29:47Z` 的 round 把本任务列在 **`cold_start_inflight`** 里（`in_flight:2, pool:1`）。
- `packages/quay-native/src/store.ts` 的 **PARK DURABILITY** 守卫（`parkGuardVerdict`，注释写明
  「measured 2026-11-06 on this host」「the commit diff was exactly ONE frontmatter line
  `-status: needs-human` / `+status: todo`」）在生产上**没有生效**：该文件 mtime 是 `2026-11-06 20:08`，
  而两个实际被执行的构建产物里一次都搜不到 `parkGuardVerdict` / `PARK_GUARD_STATUS`——
  `plugin/vendor/quay-native/dist/quay-native.js`（Oct 31）与
  `~/.claude/plugins/cache/quay/quay/0.14.0/vendor/quay-native/dist/quay-native.js`（Oct 4）。
  ⇒ 任何整任务写入只要带着自己早先读到的 `status: todo`，都能把停放静默改回去。

这与已立案的 `tasks/gap-needs-human-park-overwritten-by-inflight-worker.md` 是**同一形态的再现**，且本任务是它的
第三、第四个样本（该任务自己在 2026-11-06T10:28/10:35 也被退回两次）。⛔ 本 worker 不据此改判据、不改 store。

**没有任何载体记录这两次退回的理由，也没有任何裁定落进本任务体。** 本 worker 因此把任务放回 `needs-human`
（= 系统立案时自己的分类），并明确声明：**不据此推断任何裁定内容**。若退回本身就是一次人的决定
（「让它进池子做」），请把它写成裁定（选了哪条选项、为什么）——下面的读数、清单与确认命令都已备好，一步即可。

### 5. 人用来一眼确认「该放出来了」的只读命令

```
node -e "const fs=require('fs');const p='.quay/goal-requests.jsonl';if(!fs.existsSync(p)){console.log('AC-936-request-consumed=ledger-absent');process.exit(1)}const d=fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(s=>{try{return JSON.parse(s)}catch{return null}}).filter(r=>r&&['accepted','refused','not-evaluated'].includes(r.state)&&typeof r.consumedAt==='string'&&r.consumedAt);if(!d.length){console.log('AC-936-request-consumed=0');process.exit(1)}console.log('AC-936-request-consumed='+d.length)"
```

在 `/data/home/yale/work/quay` 下跑：`AC-936-request-consumed=1` 或更大 ⇒ 选项 ① 已经生效；`ledger-absent` / `=0` ⇒ 还没生效。

两个方向本次都跑过（硬规则 2 的两半）：**主检出今天** = `AC-936-request-consumed=ledger-absent` / exit 1（取假方向受控）；
**正控**（worktree 里放一行带 `consumedAt` 的终态行）= `AC-936-request-consumed=1` / exit 0（谓词确实能命中）。
该命令只读：`judgeCriterionCapability` 判为 `{"capability":"read-only","code":null}`。

⛔ **它没有自动消费者（硬规则 4c，写下来免得后人误以为有）**：`needs-human-parking-recheck.ts` 的两个桶都不复跑它——
`scanNeedsHumanParking` 只重跑阻碍原因里**点名的机械判据**（本任务不点名任何一条 ⇒ 该桶读数是 `no-registered-judge`，
即「人的决定没有机械判据可复跑」，这是读数不是失败）；`scanParkedUnpark` 只扫**带行首 `**PARKED**` 标记**的任务。
所以**解停这件事本身仍由人做**（`quay task edit <id> --status todo` 或直接完成本任务），这条命令只是让人不必重读全文。

### 6. 记录边界（硬规则 4b / 4c）

- 本节的 52 轮、AC 集合、投影、消费者读数全部取自 `.quay/goal-round.jsonl` 的**生产轮记录**，不是 fixture。
- 未验证的部分：主检出载体在候选人执行 ① 之后是否**真的**被下一轮消费——那要等执行之后才存在，本轮无从测量。
- 未验证的部分（2）：第 4 节那两次退回的**具体写入者**没有定论。已核实的只有事件记录（actor/commit/diff）与
  「两个构建产物都不含停放守卫」两件事；把二者连成单一因果链的那一步**没有做对照**，故只作假说。

## AC（draft）
- [ ] 人在上述选项中作出选择，并把选择写进本任务体（或以 DIR 记录该裁定）
- [ ] 依该选择产生的后续工作已立案或已落地（⛔ 不以「已回答」本身充当完成）

## DoD（draft）
- [ ] 裁定已记录在可被后续读到的正本里，⛔ 不只存在于本任务的对话中
- [ ] 上面两条互相矛盾的立场中，落败的一方已被就地更正或标注，⛔ 不留着继续制造同一次冲突

## Dark Axis（ADR-007）
该轴仍暗,理由:本任务若按现状收尾只写裁定与文档标注、不改包/依赖结构，L_D/L_G 无本任务可归因的结构读数；三条选项中只有 ② 会改生产代码，其结构读数应在执行该项时另采。

## Touches
- `goals/AC-936-goal-request-队列-提交-消费-幂等.md`
- `plugin/scripts/goal-driver.ts`
- `docs/evidence/2026-11-06-goal-request-queue.md`
- `tasks/gap-meta-call-ac-936-needs-a-human-run-goal-request-in.md`

## Needs-Human

**执行 2026-11-07T04:28Z（worker 会话；不是重试上限触发）— 待人工裁定**

- 阻碍原因：AC-936 是 GOAL-914 唯一未达成的 AC，判据要主检出 `.quay/goal-requests.jsonl` 里有一条被消费的请求；worker 写守卫禁止写主检出、goal-driver 又把该 AC 判为 world-gated 不派活 ⇒ 需人从 ①②③ 裁定由谁产生这份证据（现场读数与三条落地清单见本任务体 ## Worker Reading）
