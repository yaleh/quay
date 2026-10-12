---
id: gap-ac341-criterion-blind-to-v1-status-event-dialect
title: AC-341 判据只认 v0 方言的 ts 字段 ⇒ 7/154 次生产晋升被误判「有翻转无事件」，实测 0/154 真缺——修判定机件读两处方言
  + 给「读不懂」独立取值
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-341
---
**type:** execution

## Proposal

AC-341 判的是：GOAL-030 并入 develop 之后，develop 上每一次 promotion-driver 机械晋升 todo→ready 都在 `.quay/task-status-events.jsonl` 有对应的 promote 事件。**本轮直接实测**（求值根 = 共享主检出 `/data/home/yale/work/quay`；判据字节取自 `goals/AC-341-*.md`，sha256 `74bb00abdf89e305bddb2e6d2252623ab329fa726801b51b5fb516d9d5efca39`，与上一轮任务 Evidence 记录的同一份字节）：

```
$ bash crit.sh          # 现判据，逐字
EXIT=1
STDERR: CAUSE=flip-without-event — 7/154 production todo→ready flips since the merge have no promote event:
  gap-goal030-ac337-provenance-shape-drift, gap-open-discovery-consumes-task-status-events-optional-context,
  gap-status-sync-priority-drops-superseded-resurrects-or-loses-retired-tasks,
  gap-open-semantic-discovery-investigator-exits-before-hypotheses-zero-semantic-output,
  gap-prod-data-audit-whole-file-read-crashes-on-carrier-over-v8-string-limit,
  gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red,
  gap-driver-round-carriers-unbounded-growth-retention-design
```

**这 7 条翻转全部【有】事件。** 只把时间戳改成读两处方言（`at` 优先、回退 `ts`）、其余逐字不变后，**同一份 154 条 id 的读数变成 exit 0（0 缺失）**：

```
$ bash crit.sh          # 第二段改为方言感知，其余逐字不变
EXIT=0
STDOUT: PASS: all 154 production promotion-driver todo→ready flips since the merge carry a promote event
```

样本（7 条之一；v1 行，`actor.kind="promotion-driver"`，写入模块 = kernel；**证明事件确由生产 promotion-driver 写出**）：

```json
{"schema":"task-status-event/v1","eventId":"32636e5e22aa71477079115f03423897","seq":6,
 "carrierEpoch":"f0abc6d11b8c4c6aefdd687eb6b308dc",
 "taskId":"gap-driver-round-carriers-unbounded-growth-retention-design",
 "from":"todo","to":"ready","kind":"promote","at":"2026-10-12T18:31:05.841Z",
 "actor":{"kind":"promotion-driver","id":"ready-pool-check --apply"},
 "evidence":{"commit":"29dce667498360e114c01f97aea075703112329c"},
 "producer":{"writerModule":"/data/home/yale/work/quay/packages/quay/src/kernel/task-transition.ts",
             "entry":"/data/home/yale/work/quay/plugin/scripts/ready-pool-check.ts","pid":1969074}}
```

### 根因：载体有两种官方方言，判据只认其中一种

`.quay/task-status-events.jsonl` 共 176 行 = **两种官方方言**，两种都被仓库自己的正本读者认（`plugin/scripts/task-status-events-reconcile.ts:192` 对 v0 行取 `at = r.ts`、对 v1 行取 `at`；`packages/quay/src/cli/task-log.ts` 把两者都归一成 `at`）：

| 方言 | 行数 | 时间字段 | 时间范围 | `to=ready ∧ kind=promote` 的 taskId 数 |
|---|---|---|---|---|
| v0（无 `schema` 字段） | 150 | `ts` | 2026-10-08T23:30:43.072Z .. 2026-10-12T18:04:47.339Z | 147 |
| v1（`schema: task-status-event/v1`） | 26 | `at` | 2026-10-12T18:21:18.303Z .. 2026-10-12T20:25:02.089Z | 7 |

**147 + 7 = 154 = 判据要核的 id 总数** —— 现判据恰好全中 v0 的 147 条、漏掉 v1 的 7 条，一一对应。判据第二段写的是 `Date.parse(e.ts) >= t-60000`：v1 行没有 `ts` ⇒ `Date.parse(undefined)` = `NaN` ⇒ 比较恒为假 ⇒ 该行**从不进入 `have` 集合**，其 taskId 被判成「有翻转无事件」。

### 为什么上一轮的修复没有保住（`done` 任务 `gap-goal030-post-merge-promotion-events-reading`）

那不是回归，是**潜伏的方言耦合**：那条任务按自身范围是 read-only（且它自己写死「⛔ 不改判据」），2026-10-09 取读数时载体**只有 2 行 v0**（其 Evidence 逐字记录了那 2 行），判据「只读 `ts`」的假设当时成立，`exit 0` 是**当时正确**的读数。**2026-10-12T18:21Z 起写入方切到 v1 方言**（状态事件契约 v1 落地，`gap-task-status-events-abi-writes-and-creation` / `gap-task-status-events-contract-v1-all-driver-writers` 一族），判据随即开始把 v1 写出的翻转误报成缺事件。⇒ 判据从不曾与 v1 方言一起被验证过；**写作侧（4c）漏了这一层**：那个量在「产生处→读取处」之间的中间层（写入方言）换过一次。

### 这是【判定机件】缺陷，不是生产缺陷（硬规则 3b）

生产侧保证完好：**154/154 条翻转都带事件**（上表两方言相加；7 条 v1 的 `actor.kind` 都是 `promotion-driver`）。坏的是判定机件——它【读不懂输入】时返回的是与「查过且不合格」同形的 `CAUSE=flip-without-event`。修法两半，缺一不可：

1. **读两处方言**：优先经 kernel 正本读者取归一后的转移视图（`packages/quay/src/kernel/task-transition.ts` 的 `readTaskStatusEventCarrier` / `taskStatusTransitionView`，行 644 / 915，`CarrierLine.klass ∈ {v0, v1, corrupt}`）；若在 judge 里不可行，则用与 `task-status-events-reconcile.ts:192` **逐字相同的映射**（v1 `at` / v0 `ts`）。⛔ **不得出现第三套方言语义**。
2. **给「读不懂」一个独立取值**：候选行（`to=ready ∧ kind=promote`）若既无 `at` 也无 `ts`，判 `exit 3 / NOT-EVALUATED`，⛔ 不再落到 `exit 1`。这样第三种方言出现时是**响亮失败**（未评估），而不是伪装成红。

### 为什么这不构成「为取绿而改判据」

判据**强度不变**，并有负对照逐条钉死（本轮已在 `/tmp` fixture 上实测，见下表）：真实缺事件的翻转仍 `exit 1`；`t-60000` 时间窗仍排除并入前的事件；载体缺席仍 `exit 1`；匹配谓词仍是 `to=ready ∧ kind=promote`（⛔ 不得被 `ready→done` 的 promote 事件满足）。变的只是**读时间戳的字段名**——判据所判的「有对应的 promote 事件」这件事本身没有被放松。上一轮任务的「⛔ 不改判据」是**它自己的 read-only 范围**（前提是「红 ⇒ 生产健康度信号」），本轮实测该前提不成立（0/154 真缺），故不再沿用。**⛔ 若执行者发现任何一条负对照不能取假，停手并把该臂记为 `NOT-EVALUATED`，不得为了让判据变绿而弱化它。**

### 本轮已跑的负对照（7 臂，同一份判据字节；fixture = `/tmp` 下自建 git 仓库 + 自制两种载体）

| 臂 | fixture | 现判据 | 拟定判据 |
|---|---|---|---|
| A | v1 载体 + 匹配事件 | **exit 1** `CAUSE=flip-without-event`（复现生产故障） | **exit 0** `PASS:` |
| B | v0 载体 + 匹配事件 | exit 0 | exit 0 |
| C | 混合载体（v0 + v1） | — | exit 0 |
| D | 真缺事件（有翻转、无任何匹配事件） | exit 1 `CAUSE=flip-without-event` | **exit 1** `CAUSE=flip-without-event` |
| E | 载体文件缺席 | — | exit 1 `CAUSE=event-carrier-absent` |
| F | 候选行方言不可读（无 `at`、无 `ts`） | — | **exit 3** `NOT-EVALUATED` |
| G | 只有并入前的事件 | — | exit 1（时间窗仍有效） |

### 拟定判据（安装面 = goal store；执行者应采用，除非负对照显示它不能取假）

```bash
set -u
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
cd "$root"
t=$(node -e '(()=>{const fs=require("fs");let s="";try{s=fs.readFileSync(".quay/gate-events.jsonl","utf8")}catch{};let r="";for(const l of s.split("\n")){try{const e=JSON.parse(l);if(e.gate==="goal-merge-result"&&e.item_id==="GOAL-030"&&e.payload&&e.payload.outcome==="landed")r=e.timestamp}catch{}};process.stdout.write(r)})()')
[ -n "$t" ] || { echo "NOT-EVALUATED: GOAL-030 has no landed goal-merge-result yet (post-merge AC)" >&2; exit 3; }
ids=$(git log develop --since="$t" --format='%s' | sed -nE 's/^tasks: ([^ ]+) todo→ready（promotion-driver 机械晋升）.*/\1/p' | sort -u)
n=$(printf '%s\n' "$ids" | grep -c .)
[ "$n" -ge 1 ] || { echo "NOT-EVALUATED: no production promotion-driver todo→ready commit on develop since the merge ($t)" >&2; exit 3; }
printf '%s\n' "$ids" | node -e '(()=>{const fs=require("fs");const t=Date.parse(process.argv[1]);let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ids=s.split("\n").filter(Boolean);let ev="";try{ev=fs.readFileSync(".quay/task-status-events.jsonl","utf8")}catch{console.error("CAUSE=event-carrier-absent — .quay/task-status-events.jsonl missing while "+ids.length+" production promotions happened since the merge");process.exit(1)}
const atOf=e=>typeof e.at==="string"?e.at:(typeof e.ts==="string"?e.ts:null);
const have=new Set();let unreadable=0;
for(const l of ev.split("\n")){if(!l.trim())continue;let e=null;try{e=JSON.parse(l)}catch{continue}
if(e.to!=="ready"||e.kind!=="promote")continue;
const ts=atOf(e);if(ts===null){unreadable++;continue}
if(Date.parse(ts)>=t-60000)have.add(e.taskId)}
if(unreadable){console.error("NOT-EVALUATED: "+unreadable+" ready-promote carrier row(s) carry no readable timestamp (v1 `at` / v0 `ts`) — the judge cannot read its input");process.exit(3)}
const miss=ids.filter(i=>!have.has(i));if(miss.length){console.error("CAUSE=flip-without-event — "+miss.length+"/"+ids.length+" production todo→ready flips since the merge have no promote event: "+miss.slice(0,5).join(","));process.exit(1)}
console.log("PASS: all "+ids.length+" production promotion-driver todo→ready flips since the merge carry a promote event")})})()' "$t"
```

草稿 sha256 = `cc5779aabf8caad53418b3d370376bf0f8ea835939447aa7c80abe55cd76f509`。⛔ **安装后必须从 goal store 读回并重算 sha256**，不假定写入字节 == 草稿字节；AC-341 的 `expect:` 行须同步补第三态（「载体中存在时间戳读不懂的候选行」）。

<!-- dedup-ref -->
关联任务（traceability，非前置；已核无同机制在飞任务）：`gap-goal030-post-merge-promotion-events-reading`（**done**，`goal_ac: AC-341`）是上一轮的读数任务，它 read-only、不改判据，故本任务**不是它的重复**而是「它验的判据被方言换掉后失效」的修复；其 Evidence/§停放说明里的 2 行 v0 事件样本正是本任务 §根因 的时间线依据。`gap-task-status-events-contract-v1-all-driver-writers` / `gap-task-status-events-abi-writes-and-creation`（均 done）引入了 v1 写入方言——**它们不是缺陷**（契约 v1 是官方设计，`task-status-events-reconcile.ts` 的载体分类器与 `quay task log` 都按两方言读），本任务只修那个只认一种方言的判定机件。规则 5b 复查（本轮已做，结果为空）：载体 `.quay/task-status-events.jsonl` 的全部读者中，只有 AC-341 判据读裸 `e.ts`——kernel 读侧（`readTaskStatusEventCarrier` / `taskStatusTransitionView`）、`plugin/scripts/task-status-events-reconcile.ts`、`packages/quay/src/cli/task-log.ts` 都已方言感知；`goals/*.md` 中除 AC-341 外无第二份判据读该载体（`plugin/scripts/gate-event-coverage-check.ts` 的 `Date.parse(e.ts)` 读的是【另一个载体】`.quay/gate-events.jsonl`，其行确实带 `ts`，不属同族）。

## AC

- [x] AC1 判据已安装且在**生产读数面**取绿：`quay goal show AC-341` 从 goal store **读回**的 criterion（⛔ 不是从本任务体里抄的）在共享主检出根（`/data/home/yale/work/quay`，⛔ 非任务 worktree）实跑 ⇒ `exit 0` 且 stdout 含 `PASS:`；exit 码、完整 stdout/stderr、读回字节的 sha256 逐字进 `## Evidence`
- [x] AC2 两处方言都读（同一份判据字节，fixture 三臂）：(a) 只有 v1 匹配事件 ⇒ `exit 0`；(b) 只有 v0 匹配事件 ⇒ `exit 0`；(c) v0+v1 混合 ⇒ `exit 0`；三个 exit 码与 stdout 进 `## Evidence`（臂 (a) 正是本轮复现生产故障的那一臂）
- [x] AC3 强度未被放松（红仍红，fixture 三臂）：(a) 有翻转、无任何匹配事件 ⇒ `exit 1` 且 stderr 含 `CAUSE=flip-without-event`；(b) 载体文件缺席 ⇒ `exit 1` 且 stderr 含 `CAUSE=event-carrier-absent`；(c) 只有早于 `t` 的匹配事件 ⇒ `exit 1`（`t-60000` 时间窗仍生效）；另 (d) 只有 `ready→done` 的 promote 事件、无 `todo→ready` 事件 ⇒ `exit 1`（`to=ready` 谓词未被放宽）；四个 exit 码与 stderr 进 `## Evidence`
- [x] AC4 「读不懂」有独立取值：候选行（`to=ready ∧ kind=promote`）既无 `at` 也无 `ts` ⇒ `exit 3` 且 stderr 含 `NOT-EVALUATED`，⛔ 不是 `exit 1`（硬规则 3b）；exit 码与 stderr 进 `## Evidence`
- [x] AC5 根因已用**退化的判据字节**复现：把现判据（sha256 `74bb00ab…`）逐字喂给夹具跑器 ⇒ (a) v1 臂 `exit 1`、(b) v0 臂 `exit 0`；两个 exit 码进 `## Evidence`（证明差异确实只来自时间戳字段名，不来自 fixture 的其它差别）
- [x] AC6 回归 pin 已落：新增 `plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs`，从 **goal store** 抽出 AC-341 的 criterion 并驱动 AC2/AC3/AC4 的臂，`node --test plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs` ⇒ `exit 0`；pin **按行为（exit 码）断言，⛔ 不把判据文本逐字钉进测试**（防未来改判据时产生假红），并带 `@test-group` 标注（口径读 `scripts/test.sh` 头注释）
- [x] AC7 pin 能取假：同一 pin 用**退化的判据字节**（`74bb00ab…`）驱动 v1 臂 ⇒ 该臂判红（把 criterion 文本做成跑器的入参或等价 seam）；实测 exit 码进 `## Evidence`（这条是「pin 真的在测方言、不是恒绿」的判据）
- [x] AC8 载体已更新：`docs/rup/goal030-post-merge-reading.md` 记录修订后读数（154/154、`exit 0`）、7 条先前假阴的 id 与其中的 v1 事件样本、以及方言时间线（v0 止于 2026-10-12T18:04:47Z / v1 起于 2026-10-12T18:21:18Z）；`test -f` 该文件 exit 0 且 `grep -cE 'PASS|NOT-EVALUATED|CAUSE'` ≥ 1

## DoD

真实落地 = **AC-341 的判定机件被修好、并在生产读数面上取绿**，四件产物全部落库：

1. **安装**：`goals/AC-341-<…>.md` 的 `criterion` 与 `expect` 经 goal store 写入（goal/判据类写入需在两个根一致）；从 goal store**读回**的字节 sha256 记入 `## Evidence`；在**共享主检出根**实跑 ⇒ `exit 0`、`PASS:`。
2. **强度未被放松**：负对照四条红臂（真缺事件 / 载体缺席 / 并入前事件 / 只有 `ready→done` 事件）逐条仍在其应有的退出码上；不可读方言落在 `exit 3`。每条 exit 码 + stderr 落 `## Evidence`。
3. **回归 pin 是测量而非回声**（硬规则 4 推论三）：pin 从 goal store 抽判据（⛔ 不读任务体、⛔ 不内置一份判据文本副本），驱动 AC2/AC3/AC4 的臂为 `exit 0`；并且**用退化的判据字节把 v1 臂跑红**（AC7）——「关掉正确实现就变红」是这条 pin 不是回声的判据。
4. **载体**：`docs/rup/goal030-post-merge-reading.md` 记录修订读数与方言时间线。

⛔ 硬约束：不得为了让判据变绿而删掉 `t-60000` 时间窗、放宽 `to=ready ∧ kind=promote` 谓词、或把不可读当通过；⛔ 不得手写/补造/回填事件行；⛔ 不得改生产 `.quay/`（含 gate-events / task-status-events 两个载体）、不得改 `tasks/` 里别的任务的状态。若实测发现某条负对照在该判据上不可达 ⇒ 停手、记 `NOT-EVALUATED` 并上报，⛔ 不以减弱判据收场。

## Touches

- tasks/gap-ac341-criterion-blind-to-v1-status-event-dialect.md
- goals/AC-341-并入后生产读数-goal-030-并入之后-develop-上每一次-promotion-driver-机械晋升-tod.md
- docs/rup/goal030-post-merge-reading.md
- plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs

## Evidence

**修订轮 2026-10-13（per-task worker 会话）。** 全部读数逐字如下；判据字节一律**从 goal store 读回**，⛔ 不是从本任务体里抄的。

### AC1 · 生产读数面 = 共享主检出 `/data/home/yale/work/quay`（⛔ 非任务 worktree）

读回字节：**2290 bytes，sha256 `0df4104081d62e2955dea6e68df1b216f6fc555072cd5f21c6adbfdc9bda9308`**。
⛔ 与草案 sha256 `cc5779aabf8caad53418b3d370376bf0f8ea835939447aa7c80abe55cd76f509` **不相等**，且不假装相等：
写入方把 block scalar 序列化为 `criterion: |-`（strip chomping）⇒ 存值不带尾换行，而草案文件带尾换行
（1904 字节的前修复字节同理）。语义不受影响（bash 不依赖末尾换行）。

```
$ cd /data/home/yale/work/quay && bash <readback-criterion>       # 从 goal store 读回的那份字节
EXIT=0
STDOUT: PASS: all 155 production promotion-driver todo→ready flips since the merge carry a promote event
STDERR: (empty)
```

真实 gate 路径（`--dry-run`：跑判据但**不**追加 GateEvent ⇒ 生产 `.quay/gate-events.jsonl` 未被写）：

```
$ node packages/quay/bin/quay.js goal gate AC-341 --dry-run --root /data/home/yale/work/quay
verdict: "pass"   exit=0   evaluationRoot=/data/home/yale/work/quay   timeoutMs=60000
```

并入瞬间 `t` 未变：`2026-10-08T18:35:54.646Z`（`.quay/gate-events.jsonl` 里 GOAL-030 唯一一条 landed
`goal-merge-result`）。集合 154 → 155 是本任务自身的 `todo→ready` 翻转（v1 行 `at=2026-10-12T20:39:46.371Z`，
`actor.kind="promotion-driver"`，`entry=…/plugin/scripts/ready-pool-check.ts`）—— 判据量的是一支**会增长的生产总体**，
不是冻结样本。

### AC2 / AC3 / AC4 · 夹具臂（判据逐字取自 goal store，经 `runAcceptanceCapture` 运行）

夹具 = 独立 git 仓库（自建 `develop` 分支、自造 `tasks: <id> todo→ready（promotion-driver 机械晋升）` 提交、
自造 `.quay/gate-events.jsonl` + `.quay/task-status-events.jsonl`），全部建在 `os.tmpdir()` 下的一次性目录里。

| 臂 | fixture | exit | 输出（逐字） |
|---|---|---|---|
| AC2a | 只有 **v1** 匹配事件 | **0** | `PASS: all 2 production promotion-driver todo→ready flips since the merge carry a promote event` |
| AC2b | 只有 **v0** 匹配事件 | **0** | 同上 `PASS:` 行 |
| AC2c | **v0+v1 混合** | **0** | 同上 `PASS:` 行 |
| AC3a | 有翻转、无任何匹配事件 | **1** | `CAUSE=flip-without-event — 2/2 production todo→ready flips since the merge have no promote event: gap-fixture-alpha,gap-fixture-beta` |
| AC3b | 载体文件缺席 | **1** | `CAUSE=event-carrier-absent — .quay/task-status-events.jsonl missing while 2 production promotions happened since the merge` |
| AC3c | 只有早于 `t−60000` 的匹配事件 | **1** | `CAUSE=flip-without-event — 2/2 …`（时间窗仍生效） |
| AC3d | 只有 `ready→done` 的 promote（无 `todo→ready`） | **1** | `CAUSE=flip-without-event — 2/2 …`（`to=ready` 谓词未被放宽） |
| AC4 | 候选行（`to=ready ∧ kind=promote`）无 `at` 也无 `ts` | **3** | `NOT-EVALUATED: 1 ready-promote carrier row(s) carry no readable timestamp (v1 `at` / v0 `ts`) — the judge cannot read its input` |

⇒ 红仍红、`t−60000` 窗口与 `to=ready ∧ kind=promote` 谓词均未被放宽；读不懂输入落到**独立取值 exit 3**，不再伪装成 `exit 1`。

### AC5 · 根因用退化判据字节复现（`sha256 74bb00abdf89e305bddb2e6d2252623ab329fa726801b51b5fb516d9d5efca39`，1904 bytes）

同一批夹具、同一跑器，只把判据换回**前修复字节**：

| 臂 | fixture | exit | 输出 |
|---|---|---|---|
| (a) | v1 载体 + 匹配事件 | **1** | `CAUSE=flip-without-event — 2/2 …`（= 生产故障的复现） |
| (b) | v0 载体 + 匹配事件 | **0** | `PASS: all 2 production promotion-driver todo→ready flips since the merge carry a promote event` |

⇒ 差异**只**来自时间戳字段名，不来自 fixture 的其它差别（同 fixture、同 runner，仅判据字节不同）。

### AC6 / AC7 · 回归 pin

新增 `plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs`（`// @test-group engine`）：判据**从 goal store 抽**
（`createGoalStore(REPO_ROOT/goals).get("AC-341").criterion`，⛔ 不读任务体、⛔ 不内置判据文本副本），经 `runAcceptance`
驱动 AC2/AC3/AC4 的臂，并**按行为（exit 码）断言**：

```
$ node --test plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs
✔ AC2a  ✔ AC2b  ✔ AC2c  ✔ AC3a  ✔ AC3b  ✔ AC3c  ✔ AC3d  ✔ AC4  ✔ AC7
ℹ tests 9   pass 9   fail 0        EXIT=0
```

**AC7 取假实测（把正确实现关掉就变红）** —— 把工作树 goal store 的 criterion 临时替换成前修复字节
（`74bb00ab…`）后重跑**同一个 pin**：

```
✖ AC2a（v1 臂）   ✖ AC2c（混合臂）   ✖ AC4（第三态臂）      ← 恰好三条**方言相关**臂转红
✔ AC2b  ✔ AC3a  ✔ AC3b  ✔ AC3c  ✔ AC3d  ✔ AC7             ← 方言无关臂保持绿
ℹ pass 6   fail 3
```

替换后 goal 文件按备份逐字还原（替换前/后 `sha256` 均为
`651ab34a6726ad567503fc71ad47fe638266b9a4f13565bda6b9649d87d47d3d`），pin 复跑 9/9 绿。
pin 内另有一条独立对照臂：把 base64 冻结的前修复字节喂给 v1 夹具 ⇒ `exit 1`、喂给 v0 夹具 ⇒ `exit 0`，
且其 `sha256` 在测试内被断言为 `74bb00ab…` —— 对照被改写或退化成转述时会**响亮失败**，而不是静默减弱。

### AC8 · 载体

`docs/rup/goal030-post-merge-reading.md`：§1–§4（2026-10-09 的前修复读数）保留为历史记录并在抬头标注被 §5 取代；
新增 §5 记录修订读数 **155/155 `exit 0`**、7 条先前假阴 id 及其 v1 事件（含逐字事件样本）、方言时间线
（v0 止于 `2026-10-12T18:04:47.339Z` / v1 起于 `2026-10-12T18:21:18.303Z`）与负对照表。

```
$ test -f docs/rup/goal030-post-merge-reading.md ; echo $?
0
$ grep -cE 'PASS|NOT-EVALUATED|CAUSE' docs/rup/goal030-post-merge-reading.md
13
```

### 范围 / 纪律

- ⛔ 未改生产 `.quay/`：`goal gate` 全程 `--dry-run`；未手写、未回填、未补造任何事件行；未改 `tasks/` 里别的任务。
- 判据安装**经 goal ABI 写一次**（主检出根 `goal write AC-341 --criterion … --expect …`），再
  `git checkout author -- goals/AC-341-*.md` **搬运**到任务分支（两处字节一致 ⇒ 后续 `git merge develop` 无冲突）。
- 工作树 scoped gate：`bash scripts/test.sh --for-task gap-ac341-criterion-blind-to-v1-status-event-dialect --allow-thin`
  ⇒ **exit 0**（首跑红在 `tmp-leak-pairing-check` / `test-isolation-check`，因为夹具用了嵌套 `mkdtempSync` 而
  cleanup 在 `after()` 里——改成在单一 `mkdtemp` 根下 `mkdir` 后两检查通过，pin 仍 9/9）。
- 工作树 anti-drift：`ANTI-DRIFT OK: task gap-ac341-… —— 2 actual file(s), all within declared Touches (4 glob(s))`。
