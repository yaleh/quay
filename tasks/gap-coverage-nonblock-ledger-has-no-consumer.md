---
id: gap-coverage-nonblock-ledger-has-no-consumer
title: "`--no-block` 把覆盖率 RED 从「挡住全部 code
  落地」降为「写进一份没人读的台账」——gate-event-coverage-nonblock-ledger.jsonl
  只有写者、零读者，漏记不再有任何机制把它送到会处置的人面前"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

**读侧修复把代价从「过高」改成了「为零」：覆盖率 RED 现在只落进一份只有写者、没有读者的台账。**

<!-- dedup-ref --> `tasks/gap-coverage-miss-fail-closed-stops-code-landings.md` 给 `gate-event-coverage-check` 加了 `--no-block`：RED 照常打印并记入 grow-only 台账 `.quay/gate-event-coverage-nonblock-ledger.jsonl`，但 `exit 0`、不再中止套件。那条修的是「一条历史读数不该让无关任务停摆」，方向是对的；本条修它留下的另一半。

### 实测（2026-10-01，分支 `task/gap-coverage-miss-fail-closed-stops-code-landings`）

`git grep -n 'gate-event-coverage-nonblock-ledger' <该分支> -- plugin packages scripts .gitignore` ⇒ **4 处命中，全部在写侧**：

1. `plugin/scripts/gate-event-coverage-check.ts:41`（头注释）
2. `plugin/scripts/gate-event-coverage-check.ts:329`（`NO_BLOCK_LEDGER_REL` 常量，唯一写者 `recordNonBlockReport` 用它）
3. `plugin/scripts/runner-static-gate.ts:968`（接线注释）
4. `plugin/test/gate-event-coverage-check.test.mjs:278`（写者自己的单测）

**读者数 = 0**：没有任何 checker、driver、routine、manager 读数或 Web UI 页面读这份文件。生产载体里此刻已有一行（`{"day":"2026-09-30","task":"gap-ac292-criterion-carrier-absence-not-evaluated",…,"at":"2026-10-01T12:18:29.066Z"}`），它不会被任何机制送到任何人面前。

### 为什么这是缺陷而不是「以后再说」

- 修复前：漏记 ⇒ 全部 code 落地停一天（代价过高，但**一定有人处置**）。修复后：漏记 ⇒ 套件日志里一行会滚走的 `NON-BLOCKING` + 台账里一行没人读的 JSON（**没有任何东西保证有人处置**）。「守」与「不守」在任何会被读的记录上无法区分——硬规则 9：可见性 ≠ 执行。
- 接线处自己写明了代价：`--no-block` 下 `run_checker` 按 exit 0 把 cost 行记成 `verdict:"pass"`。⇒ 取值轴**只**剩这份台账；台账没人读 ⇒ 取值轴实际上是断的。
- 写侧注释把这份台账称为「取值轴的持久载体，可审计、不消失」。「不消失」成立，「可审计」目前只意味着「有人想起来去 cat 它」。
- 同文件里另有三处 `--no-block` 先例（`task-contract-check` / `suite-duration-exceed-check` / `instrument-decay-check`）。它们各自的 RED 最终有没有读者，本条**未查**——见 AC4。

### 附带观察（未定性）

`git check-ignore -v .quay/gate-event-coverage-nonblock-ledger.jsonl` 在主检出返回非零（未被忽略）⇒ 这份运行时台账会以 untracked 形态出现在主检出 `git status` 里。是否该进 `plugin/scripts/quay-runtime-artifacts.txt` 清单，由实现者按 `gitignore-runtime-coverage-check` 的规矩判。

### 请求动作

给台账接一个**会把未处置条目送到处置面**的读者。落点由实现者定，约束三条：

1. **不重新 fail-closed 套件**——那是前一条刚拆掉的形态。读者应落在不挡 fan-in 的面上（例如 manager tick 读数 / needs-human 面 / 一条自动立案的 gap，按 `day|task` 去重）。
2. **条目要有「已处置」这一态**——否则读者要么永远报同一条（噪声），要么靠时间窗滑过自动沉默（等于没读）。处置 = 该落地补上了 `complete` 事件，或有一条带理由的裁定；⛔ 不是手维护的豁免 id 表。
3. **读不到台账 ≠ 台账为空**（硬规则 3b）：载体缺席 / 不可解析要有独立取值，不与「零未处置」同形。

## AC

- [x] **AC1（现状固化）** 在 develop 上重跑上面那条 `git grep`，贴命中数与全部命中行，并按「写者 / 读者」分类写出两个计数；另贴生产台账当前行数与前 3 行原文。若 develop 上还没有这个常量（写者尚未落地）⇒ 写明并停在此处，⛔ 不自行实现写者。
- [x] **AC2（读者落地·读生产载体）** 新读者对着**生产**台账跑一次，贴读数：未处置条目数与清单（⛔ 不是布尔）。把 fixture/注入关掉后这条读数仍须取得到。
- [x] **AC3（三态可取假）** 同一读者对三种输入各跑一次并贴读数：有未处置条目 ⇒ 报出；条目已处置（对应落地已有 `complete` 事件）⇒ 不再报；台账缺席或坏行 ⇒ 独立的「未评估」取值，与前两者都不同形。
- [x] **AC4（5b 同载体扫描）** 对 `runner-static-gate.ts` 里**全部** `--no-block` 接线逐条列出：它的 RED 落在哪个载体、该载体有没有读者。贴命中数与清单；零读者的每一条要么在本任务内接上，要么各立一条 gap 并贴 id。⛔ 不写成「其余同上」。
- [x] **AC5（不回退前一条）** 在存在一条未处置条目的条件下，code delta 的静态闸仍不因它中止——贴 `run_checker "gate-event-coverage-check"` 的 exit 读数。
- [x] **AC6（本任务自身的门）** `bash scripts/test.sh --for-task gap-coverage-nonblock-ledger-has-no-consumer` 绿。

## DoD

**真实落地**：生产台账里那条 2026-09-30 的条目，被新读者在一个**有人/有机制会处置**的面上报出过一次（贴该面的读数），并在处置后不再被报。⛔ 只加一段说明「可以去看这份台账」⇒ 不算完成；⛔ 把 `--no-block` 改回 fail-closed ⇒ 不算完成。

## Touches

- `plugin/scripts/gate-event-coverage-check.ts`
- `plugin/test/gate-event-coverage-check.test.mjs`
- `plugin/scripts/manager-tick-readings.ts`
- `plugin/test/manager-tick-readings.test.mjs`
- `plugin/scripts/quay-runtime-artifacts.txt`
- `.gitignore`
- `tasks/gap-coverage-nonblock-ledger-has-no-consumer.md`

## Evidence

Round 2026-10-01（worker `gap-coverage-nonblock-ledger-has-no-consumer`；worktree
`/data/home/yale/work/quay-worktrees/gap-coverage-nonblock-ledger-has-no-consumer`，branch
`task/gap-coverage-nonblock-ledger-has-no-consumer`）。**所有生产读数都取在主检出**
`/data/home/yale/work/quay` —— 台账与 gate-events 载体都是那里的运行态，一次性 worktree 的
`.quay/` 结构上没有它们。

### AC1 — 现状固化（develop 上重跑）

```
$ git grep -n 'gate-event-coverage-nonblock-ledger' develop -- plugin packages scripts .gitignore
develop:plugin/scripts/gate-event-coverage-check.ts:41://   `.quay/gate-event-coverage-nonblock-ledger.jsonl`，可审计、不消失）；**阻断轴**关掉（RED 不再
develop:plugin/scripts/gate-event-coverage-check.ts:329:export const NO_BLOCK_LEDGER_REL = ".quay/gate-event-coverage-nonblock-ledger.jsonl";
develop:plugin/scripts/runner-static-gate.ts:968:  #     `<main_root>/.quay/gate-event-coverage-nonblock-ledger.jsonl`（取值轴的持久载体，⛔ 不是「改成
develop:plugin/test/gate-event-coverage-check.test.mjs:278:const LEDGER_REL = path.join(".quay", "gate-event-coverage-nonblock-ledger.jsonl");
⇒ hits = 4

$ git grep -c 'readNonBlockLedger' develop -- plugin packages scripts
⇒ （无输出）reader hits = 0
```

分类计数：**写者 4 / 读者 0**。4 处逐条都是写侧（1 处头注释、1 处 `NO_BLOCK_LEDGER_REL` 常量定义、
1 处接线注释、1 处写者自己的单测常量）。develop 上**已有**这个常量（写者已落地）⇒ 不触发
「写明并停在此处」分支。

生产台账（主检出）：

```
$ wc -l .quay/gate-event-coverage-nonblock-ledger.jsonl
1
$ head -3 .quay/gate-event-coverage-nonblock-ledger.jsonl
{"day":"2026-09-30","task":"gap-ac292-criterion-carrier-absence-not-evaluated","sha":"0f784470f8de16a40f796a718b320721e4ab1273","coverage":0.9411764705882353,"threshold":95,"at":"2026-10-01T12:18:29.066Z"}
```

### AC2 — 读者落地（读生产载体，非布尔）

```
$ node --experimental-strip-types plugin/scripts/gate-event-coverage-check.ts --root /data/home/yale/work/quay --ledger
gate-event-coverage-nonblock ledger — /data/home/yale/work/quay/.quay/gate-event-coverage-nonblock-ledger.jsonl
entries=1 disposed=0 unresolved=1 malformed_lines=0
  UNRESOLVED 2026-09-30 gap-ac292-criterion-carrier-absence-not-evaluated — coverage 94% < 95% · sha=0f784470f8de16a40f796a718b320721e4ab1273 · recorded 2026-10-01T12:18:29.066Z
exit=0
```

未处置条目数 = **1**，清单逐条如上（⛔ 不是布尔）。**fixture/注入已关掉**：上面这条就是对着
**生产**台账 + **生产** gate-events 载体跑的，唯一参数是生产 `--root`，没有走任何测试缝。
同一读数在 manager 面上的形态见 DoD 一节。

### AC3 — 三态各跑一次（四行读数，三态不同形）

| 输入 | 读数 | exit |
|---|---|---|
| ① 有未处置条目（**生产**） | `evaluated=true carrier=read unresolved=1 -> ['2026-09-30\|gap-ac292-criterion-carrier-absence-not-evaluated']` | 0 |
| ② 条目已处置 | `entries=1 disposed=1 unresolved=0` | 0 |
| ③a 台账缺席 | `NOT-EVALUATED: --no-block 台账载体缺席（…）` · `carrier=absent` · `unresolved=null` | 3 |
| ③b 台账存在但全部行不可解析 | `NOT-EVALUATED: 台账存在但 2 行全部不可解析` · `carrier=unreadable` · `unresolved=null` | 3 |

arm② 的构造（**不是豁免 id 表**）：把生产台账与生产 `.quay/gate-events.jsonl` 逐字复制到 scratch
root，再追加**那一条本应被写下的** `complete` 事件（`pipeline_id=gap-ac292-criterion-carrier-absence-not-evaluated`、
`ts=2026-10-01T13:00:00.000Z` ≥ 条目 `at`）⇒ 读者不再报它。判定完全由
「载体里有没有同任务、`ts ≥ entry.at` 的 `complete`+`pass` 事件」**推导**得出，代码里没有任何 id 名单。

⛔ 三态不同形：未评估两态 `unresolved = null`（⛔ 不是 `[]` —— 空数组会被读成「查过且干净」），
`carrier` 取 `absent` / `unreadable` / `read` 三值，退出码 3 / 3 / 0。

### AC4 — `runner-static-gate.ts` 里全部 `--no-block` 接线，逐条

```
$ grep -c 'run_checker .*--no-block' plugin/scripts/runner-static-gate.ts
5
```

| # | 行 | `run_checker` | 它的 RED 落在哪个载体 | 该载体有读者吗 |
|---|---|---|---|---|
| 1 | `runner-static-gate.ts:227` | `task-contract-check` | `.quay/task-file-violation-ledger.jsonl`（`task-contract-check.ts:442`，写者 `recordNoBlockLedger`）+ 打印行 | **✗ 零读者** |
| 2 | `runner-static-gate.ts:241` | `task-ac-carryover-check` | **同一份**台账（`task-ac-carryover-check.ts:66` 从 contract import 那个写者；`:358` 调它） | **✗ 零读者** |
| 3 | `runner-static-gate.ts:976` | `gate-event-coverage-check` | `.quay/gate-event-coverage-nonblock-ledger.jsonl` | **✓ 本任务接上**（`manager-tick-readings.ts:320` 调 `readNonBlockLedger`） |
| 4 | `runner-static-gate.ts:1274` | `suite-duration-exceed-check` | ⛔ 不落任何持久载体（`writeFileSync`/`appendFileSync` 计数 = 0）—— RED 只以 `SUITE-DURATION-EXCEEDED` 打印行承载 | 打印行（CONSUMER 行声明「外层/人每轮读」；与其余 ~65 条普通闸同形） |
| 5 | `runner-static-gate.ts:1294` | `instrument-decay-check` | 同上（写动词计数 = 0）—— RED 只以 `INSTRUMENT-DECAY:` 打印行承载 | 同上（CONSUMER 行声明「外层/人/manager 读 `--static-checks-operational` 输出」） |

#1/#2 的「零读者」是**机械核过**的，不是推断：全仓非测试源码里 `task-file-violation-ledger` 的 **7** 处命中
逐条是注释 5 处（`task-contract-check.ts:38` / `:437`、`task-ac-carryover-check.ts:56`、
`runner-static-gate.ts:222`、`goal-ac-write-face.ts:155`）、fixture 字符串 1 处
（`rhythm-consumer-check.ts:474` 判据3 的 selftest 断言）与写者常量 1 处（`task-contract-check.ts:442`）
—— **代码路径读者 = 0**。CONSUMER 行那句「manager/outer 每轮读 .quay/task-file-violation-ledger.jsonl」
在机制上不成立（`rhythm-consumer-check` 判据3 只查该行非空、不查它是否为真）。

#1/#2 **不在本任务内接上**，因为它们共用的台账**没有可从载体推导的「已处置」量**：条目键是
`checker|violation`（一条消息字符串），没有任何「已修」事件会写到任何载体 ⇒ 照抄 coverage 的修法
只会得到一份只增不减、每轮照报同一批条目的读数，即本任务 AC 明令排除的**噪声**形态。

<!-- dedup-ref --> 零读者的这一条（#1 与 #2 共用一份台账 ⇒ 一条 gap 覆盖两条接线）已**另行立案**：
`gap-task-file-violation-ledger-has-no-consumer`（status `todo`，6 条 AC，`role:primitive`，
`extra.schema: execution`，已由 `task_get` 回读确认落库）。

### AC5 — 未处置条目在场时，静态闸仍不因它中止

```
$ node --experimental-strip-types plugin/scripts/gate-event-coverage-check.ts --root /data/home/yale/work/quay --days 1 --gate --no-block
RED: 覆盖率低于阈值 95% 的非豁免日：2026-09-30=94%
  UNCOVERED 2026-09-30 (94%): gap-ac292-criterion-carrier-absence-not-evaluated
NON-BLOCKING (--no-block): verdict RED is reported + recorded 0 new entry(s) → /data/home/yale/work/quay/.quay/gate-event-coverage-nonblock-ledger.jsonl; blocking is OFF for this round. The RED is a PREVIOUS-day landing-coverage fact, unrelated to the current delta; the DEFAULT mode still exits 1.
exit=0

$ （同一条命令去掉 --no-block）
exit=1
```

⇒ `run_checker "gate-event-coverage-check"` 的 exit 读数 = **0**（未处置条目在场）；而默认模式同一
输入仍 `exit 1` ⇒ 阻断轴只是被 `--no-block` 关掉，判据强度没被改弱。本任务自己的 scoped 静态闸
日志里那一行同样是非阻断的，整体 `exit=0`：

```
scoped 静态闸日志 174 行：RED: 覆盖率低于阈值 95% 的非豁免日：2026-09-30=94%
```

### AC6 — 本任务自身的门

```
$ bash scripts/test.sh --for-task gap-coverage-nonblock-ledger-has-no-consumer --allow-thin
== scoped static checks (change-relevant tier) == … 全部 PASS …
ℹ tests 37  ℹ pass 37  ℹ fail 0
EXIT=0
```

### DoD — 生产条目被报到处置面；处置后不再被报

**处置面 = manager tick 机械读数**（`orchestration/manager-tick-core.md` 每轮调用的那一条命令；
其输出是固定标签结构，人为跳过一项即缺行 ⇒ 新增的三行每轮都会被 manager 读到，且落在它能处置的
面上）。对着**生产** root 跑：

```
$ MTR_REPO_ROOT=/data/home/yale/work/quay MTR_PROJECTS=quay=/data/home/yale/work/quay \
    node --experimental-strip-types plugin/scripts/manager-tick-readings.ts | grep gate_event_coverage_nonblock
gate_event_coverage_nonblock.state UNRESOLVED
gate_event_coverage_nonblock.unresolved 1 (entries 1, disposed 0)
gate_event_coverage_nonblock.detail 2026-09-30|gap-ac292-criterion-carrier-absence-not-evaluated
```

「处置后不再被报」的读数 = 上面 AC3 的 arm②（同一份读者、同一份生产台账，只把那条缺失的
`complete` 事件补进载体）⇒ `entries=1 disposed=1 unresolved=0`。

⚠️ 生产那一条**今天确实仍未处置**：`gap-ac292-criterion-carrier-absence-not-evaluated` 已于
2026-09-30 被 manager 置 `done`，可它的 `complete` 事件从未写下 —— 这正是本判据当年要抓的那类漏记。
所以生产读数是 `UNRESOLVED 1`，**这是读者在正确工作**，不是演示缺口；处置它 = 补写那条历史事件，
是一件独立决定，本任务不代写。

⛔ 未把 `--no-block` 改回 fail-closed（AC5 的 `exit 0` + 默认模式 `exit 1` 就是反证）；
⛔ 未把条目做成手维护的豁免 id 表（判定在 `readNonBlockLedger` 里由载体推导）；
⛔ 未只加一段「可以去看这份台账」的说明（消费方是每轮真跑的 manager 读数，不是散文）。

### 非对称说明：为什么 `.gitignore` 进了清单、`quay-runtime-artifacts.txt` 没有

Touches 列了 `plugin/scripts/quay-runtime-artifacts.txt`，**实现时按该文件自己的 INCLUSION CRITERION
判定为「不进」**：它的纳入标准是「quay 写进 workspace 的** `.quay/` 之外** 的运行时态」，
而本台账在 `.quay/` 内（quay-init 已给消费项目写覆盖规则 `.quay/*`）；纳入会与它的既定政策冲突，
并破坏 `gitignore-runtime-coverage-check.ts` 断言的 marked-set == manifest-set 绑定。因此只向
`.gitignore` 加了一条**不带** `@quay-runtime-artifact` 标记的规则（与它的近邻
`task-file-violation-ledger.jsonl` / `ci-runs.jsonl` / `release-branch-finish.jsonl` 同形）。
反证：`gitignore-runtime-coverage-check` 仍 PASS（marked=9 manifest=9），且
`git check-ignore -v .quay/gate-event-coverage-nonblock-ledger.jsonl` 现在命中该规则。