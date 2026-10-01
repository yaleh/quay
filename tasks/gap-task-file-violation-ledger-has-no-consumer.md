---
id: gap-task-file-violation-ledger-has-no-consumer
title: "`--no-block 的任务文件违规台账（task-file-violation-ledger.jsonl）只有写者、零读者`"
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

**同 coverage 台账的一份 grow-only 台账，同样是零读者 —— 2026-10-01 的 AC4 同载体扫描扫出来的。**

<!-- dedup-ref --> `tasks/gap-coverage-nonblock-ledger-has-no-consumer.md` 修的是 `.quay/gate-event-coverage-nonblock-ledger.jsonl`；它的 AC4 要求把 `plugin/scripts/runner-static-gate.ts` 里**全部** `--no-block` 接线扫一遍，看各自的 RED 落在哪个载体、载体有没有读者。

实测（2026-10-01，develop 上重跑）：该文件里 `--no-block` 接线共 5 条，其中**两条共用同一份零读者台账**：

- `runner-static-gate.ts:227` `run_checker "task-contract-check" … --no-block`
- `runner-static-gate.ts:241` `run_checker "task-ac-carryover-check" … --no-block`

两者都把新违规写进 `task-contract-check.ts` 的 `NO_BLOCK_LEDGER_REL = ".quay/task-file-violation-ledger.jsonl"`（`recordNoBlockLedger`；carryover 从 contract 那里 import 同一个写者）。

读者数 = 0：全仓 `grep -rn 'task-file-violation-ledger'` 只命中写者自身 2 处、runner-static-gate 的注释、rhythm-consumer-check 的一条 fixture 字符串、两个测试文件、以及若干 `orchestration/*.md` 的散文/日志 —— **没有任何代码路径读它**。

⇒ 与上一条同形：`--no-block` 下 run_checker 按 exit 0 把 cost 行记成 `verdict:"pass"`，取值只剩这份台账；台账没人读 ⇒ 取值轴断（硬规则 9）。而 `capability-catalog-declarations.json` 里 task-contract-check 的 CONSUMER 行写着「manager/outer 每轮读 .quay/task-file-violation-ledger.jsonl」，**这句在机制上不成立** —— rhythm-consumer-check 判据3 只查该行非空、不查它是否为真，这正是判据3 的已知边界。

### 为什么不能照抄 coverage 那一条的修法

coverage 台账的「已处置」可以从载体**推导**（同任务补上了 `complete` 事件）。这份台账没有对应的推导量：条目键是 `checker|violation`（一条消息字符串），没有任何「已修」事件会写到任何载体上。照抄会得到一份只会增长、永不沉默的读数 —— 那正是噪声形态。

⇒ 处置轴由实现者定，三候选各写判据与反例，见下一节。

## 处置轴定案（AC2）

### 一个贯穿三个候选的机械事实（先钉住，否则三条都判不准）

`runner-static-gate.ts:226` 给 `task-contract-check` 标了 `# @static-scoped-mode subset-touched`；该标记的消费者是 `select-static-checks-for-touches.ts:653/708`，它在 scoped 层把这条命令展开成 `--strict-subset <touched task files>`（同文件 `:19` 逐字写明「runs the checker against ONLY the touched task files」）。

⇒ **写者看到的那次运行里的「没看见」，既可能是「已修」、也可能是「根本没扫」。** 这个 bit 在到达写者之前就被中间层抹掉了（硬规则 4c：判据点名的量必须穿过所有中间层还取得到）。任何把「本次运行没报它」直接当成「已处置」的方案，都会在 scoped 路径上把整批未扫描条目静默标成已处置。

### 三条候选：各一条**必须有**的判据（能取假）+ 一条**必须不能**发生的形态

| 候选 | 必须有（能取假） | 必须不能发生 | 反例（本仓实测） |
|---|---|---|---|
| **① 写者追加 `resolved`**（每轮重估全量违规集） | 「条目离开 unresolved 之前，必须有一次**扫到了它 subject** 的运行报它不成立」 | **静默**：子集运行把未扫描的条目判成已修 | 上面那条机械事实 —— 写者拿到的 violations 只是被点文件的，它**结构上**没有「扫没扫过」这个 bit ⇒ 该判据在 scoped 路径上取不了假 |
| **② 台账降为「最近一次运行」快照** | 「读数必须整体缩得下去：某条目真修好后计数 -1」 | **静默**（① 的快照版）+ 把「没人报过」与「报过且都处置了」压成同形 | 若快照取自「最近一次**写入者**跑的那次」，那次很可能正是子集；纯快照又丢掉了「曾经记过」这一维 |
| **③ 承认只是写侧审计，读侧在 suite 日志里非滚动呈现** | 「呈现里必须有「已处置」这一态，且它区别于「从未记过」」 | **噪声**：日志行每轮照打同一批、且会滚走 | 日志行**结构上没有**处置态 ⇒ 只增不减，正是本任务 DoD 明令排除的形态 |

### 定案 = ② 的读侧形态：快照不由「最近一次写入者」写，而由**读者自己对全量 store 重算**

- **采纳 ② 的核心**（「此刻还成不成立」才是要报的读数）、**换掉快照的产地**：读者跑全量 ⇒ 它与「最近一次写入者扫的是不是子集」无关，① 与原版 ② 的静默形态在此**结构上不可能发生**。
- **处置是推导量**：条目已处置 ⇔ 台账里有它 ∧ 读者此刻的全量重算里没有它。⛔ 不是手维护的豁免 id 表：把违规真修掉（或该任务文件消失 / 该 done 任务不再 done），下一轮就落 disposed。
- **活性谓词与写侧同一实现**（⛔ 不另写一份解析器）：contract 侧 `collectContractViolations`、carryover 侧 `collectUnownedAcs`，两者都是把各自 `runCli` 里原有的那段**提取**出来的（重构后 CLI 输出与重构前逐字节相同，见 Evidence）。
  - carryover 侧刻意**不做 baseline 减法**：`newViolations` 是相对祖父表的，一旦有人 `--reset-baseline`，整批条目会瞬间变成「已处置」—— 那是空转，不是处置（硬规则 4c）。
- **对「噪声」这条 ⛔ 的正面回答**：本读数**不是**「只增不减」—— 它随真实修复而缩小。生产证据（2026-10-01）：230 条里 **58 条已经这样沉默**（曾经记过、此刻不再成立），例如 `tasks/DIR-128.md: contract-line-unknown`（2026-08-12 记账，今天该文件违规数 = 0）。「每轮照报同一批」在这里的含义是「这批违规此刻真的都还成立」—— 那是**处置队列**，不是噪声；一旦有人处置就少一条，Evidence 的 DoD 一节给了 −1 的实测。

## AC

- [x] **AC1（现状固化）** 在 develop 上重跑 `grep -rn 'task-file-violation-ledger' --include='*.ts' --include='*.sh' --include='*.mjs' plugin packages scripts`，贴命中数与全部命中行，按「写者 / 读者」分类给两个计数。⛔ 不接受只写「零读者」结论而不贴行。→ 命中 **11 行 / 9 文件**；**写者（代码路径）1 / 读者（代码路径）0**；逐行与分类见 Evidence。
- [x] **AC2（处置轴定案）** 三候选至少各写出一条**必须有**的判据（能取假）与一条必须**不能**发生的形态（噪声 / 静默），据此选定一条，把理由与反例写进本任务体。→ 见 `## 处置轴定案`；定案 = ② 的读侧形态。
- [x] **AC3（读者落地·读生产载体）** 按 AC2 的选型实现读者，对着**生产**台账取一次读数并贴出（⛔ 不是布尔）；把 fixture/注入关掉后该读数仍须取得到。→ 生产读数 `unresolved 172 (entries 230, disposed 58)`，逐条清单可出；唯一参数是生产 `--root`，无任何测试缝。
- [x] **AC4（三态可取假）** 同一读者对「有未处置条目 / 条目已处置 / 载体缺席或坏行」三种输入各跑一次并贴读数；最后一态须是独立的「未评估」取值，与前两者都不同形（硬规则 3b）。→ 四态读数见 Evidence；未评估态 `state not_evaluated` + `unresolved -` + exit 3，`carrier` 取 `absent` / `unreadable` / `read` 三值。
- [x] **AC5（不回退前一条）** 在存在未处置条目的条件下，code delta 的静态闸仍不因它中止 —— 贴 `run_checker "task-contract-check"` 与 `run_checker "task-ac-carryover-check"` 的 exit 读数。→ 两条各自 **exit=0**（此时生产台账有 172 条未处置），且台账 230 行 → 230 行未变。
- [x] **AC6（本任务自身的门）** `bash scripts/test.sh --for-task gap-task-file-violation-ledger-has-no-consumer` 绿。→ scoped 门 EXIT=0（tests 112 / pass 110 / fail 0 / skip 2）。

## DoD

**真实落地**：生产台账里的条目，被新读者在一个**有人/有机制会处置**的面上报出过一次（贴该面的读数），并在处置后不再被报。⛔ 只加一段说明「可以去看这份台账」不算完成；⛔ 把 `--no-block` 改回 fail-closed 不算完成；⛔ 交出一份只增不减、每轮照报同一批条目的读数不算完成（那是噪声，不是处置面）。

## Touches

- `plugin/scripts/task-contract-check.ts`
- `plugin/scripts/task-ac-carryover-check.ts`
- `plugin/test/task-contract-check.test.mjs`
- `plugin/test/task-ac-carryover-check.test.mjs`
- `plugin/scripts/manager-tick-readings.ts`
- `plugin/test/manager-tick-readings.test.mjs`
- `plugin/scripts/capability-catalog-declarations.json`
- `.gitignore`
- `tasks/gap-task-file-violation-ledger-has-no-consumer.md`

## Evidence

Round 2026-10-01（worker `gap-task-file-violation-ledger-has-no-consumer`；worktree
`/data/home/yale/work/quay-worktrees/gap-task-file-violation-ledger-has-no-consumer`，branch
`task/gap-task-file-violation-ledger-has-no-consumer`）。**所有生产读数取在主检出**
`/data/home/yale/work/quay` —— 台账与 store 都是那里的运行态，一次性 worktree 的 `.quay/`
结构上没有台账。

### AC1 — 现状固化（develop 上重跑）

```
$ git grep -n 'task-file-violation-ledger' develop -- plugin packages scripts    # 11 行 / 9 文件
develop:packages/quay/src/goal-ac-write-face.ts:155:    // file whose shape is judged elsewhere: task-contract-check / the task-file-violation-ledger).
develop:plugin/scripts/capability-catalog-declarations.json:2004:    "task-contract-check.ts": "消费方：manager/outer 每轮读 .quay/task-file-violation-ledger.jsonl（grow-only 账本）…
develop:plugin/scripts/rhythm-consumer-check.ts:474:  check("判据3: --no-block with a CONSUMER row → ok", judgeNoBlockConsumer("消费方：manager tick 读 .quay/task-file-violation-ledger.jsonl 据此动作").ok === true);
develop:plugin/scripts/runner-static-gate.ts:222:  # round. --no-block records new violations in the grow-only ledger (.quay/task-file-violation-ledger.jsonl,
develop:plugin/scripts/task-ac-carryover-check.ts:56:// (.quay/task-file-violation-ledger.jsonl, shared with task-contract-check) but NEVER sets red —
develop:plugin/scripts/task-contract-check.ts:38:// violations are REPORTED and recorded in a GROW-ONLY ledger (.quay/task-file-violation-ledger.jsonl)
develop:plugin/scripts/task-contract-check.ts:437:// it visible is a GROW-ONLY ledger at .quay/task-file-violation-ledger.jsonl (gitignored runtime
develop:plugin/scripts/task-contract-check.ts:442:export const NO_BLOCK_LEDGER_REL = ".quay/task-file-violation-ledger.jsonl";
develop:plugin/test/precommit-guard.test.mjs:637:  // (task-contract-check / the task-file-violation-ledger judge that shape).
develop:plugin/test/task-ac-carryover-check.test.mjs:305:  const ledgerPath = path.join(root, ".quay", "task-file-violation-ledger.jsonl");
develop:plugin/test/task-contract-check.test.mjs:795:  const ledgerPath = path.join(root, ".quay", "task-file-violation-ledger.jsonl");
```

**写者（非测试代码路径）= 1**：`plugin/scripts/task-contract-check.ts:442` 的 `NO_BLOCK_LEDGER_REL`
常量（唯一写者 `recordNoBlockLedger` 用它；carryover 从 contract import 同一写者）。
**读者（非测试代码路径）= 0**。

其余 9 行逐条：注释 5（`goal-ac-write-face.ts:155`、`runner-static-gate.ts:222`、
`task-ac-carryover-check.ts:56`、`task-contract-check.ts:38`、`:437`）· CONSUMER 声明 1
（`capability-catalog-declarations.json:2004`，那句「manager/outer 每轮读」）· selftest fixture
字符串 1（`rhythm-consumer-check.ts:474`）· 写者自己的单测常量 2 ·
测试注释 1（`precommit-guard.test.mjs:637`）。

生产台账（主检出）当前 230 行，前 3 行原文：

```
$ wc -l .quay/task-file-violation-ledger.jsonl
230
$ head -3 .quay/task-file-violation-ledger.jsonl
{"key":"task-ac-carryover-check|gap-serial-install-family-shared-prebuilt-fixture: AC4","checker":"task-ac-carryover-check","violation":"gap-serial-install-family-shared-prebuilt-fixture: AC4","at":"2026-08-12T03:23:09.779Z"}
{"key":"task-contract-check|tasks/DIR-128.md: contract-line-unknown","checker":"task-contract-check","violation":"tasks/DIR-128.md: contract-line-unknown","at":"2026-08-12T03:23:10.183Z"}
{"key":"task-contract-check|tasks/gap-ac37-exec-core-ships-with-package.md: contract-line-unknown","checker":"task-contract-check","violation":"tasks/gap-ac37-exec-core-ships-with-package.md: contract-line-unknown","at":"2026-08-12T03:23:10.183Z"}
```

### AC2 — 处置轴定案

见本任务体 `## 处置轴定案`（三条候选各带「必须有」判据 + 「必须不能发生」形态 + 反例，定案 = ②
的读侧形态）。该节的机械前提（`@static-scoped-mode subset-touched` ⇒ 写者看不见「扫没扫过」）
是本轮在代码里核过的，不是推断：`select-static-checks-for-touches.ts:19/653/708/748`。

### AC3 — 读者落地（读生产载体，非布尔）

```
$ node --experimental-strip-types plugin/scripts/manager-tick-readings.ts task-file-violation-ledger --root /data/home/yale/work/quay
task_file_violation_ledger.state UNRESOLVED
task_file_violation_ledger.unresolved 172 (entries 230, disposed 58)
task_file_violation_ledger.detail task-ac-carryover-check|gap-serial-install-family-shared-prebuilt-fixture: AC4,…,…(+160)
exit=0
```

未处置 **172**（⛔ 不是布尔），清单可逐条出（`--json` 给全量）。**fixture/注入都关掉了**：唯一的
参数是生产 `--root`，读数由读者对生产 store 全量重算得出，没有走任何测试缝。

**重构后 CLI 输出与重构前逐字节相同**（改 `runCli` 前先留了基线，改完对拍）：

```
$ node … task-contract-check.ts --root <main> --json   > /tmp/tcc.json      # 重构前
$ node … task-contract-check.ts --root <main> --json   > /tmp/tcc-new.json  # 重构后
IDENTICAL: true
$ node … task-ac-carryover-check.ts --root <main> --json > /tmp/tac.json ; … > /tmp/tac-new.json
IDENTICAL: true
```

### AC4 — 四态各跑一次（读数不同形）

| 输入 | 读数 | exit |
|---|---|---|
| ① 有未处置条目（**生产**） | `state UNRESOLVED` · `unresolved 172 (entries 230, disposed 58)` | 0 |
| ② 条目已处置 | `state ok` · `unresolved 0 (entries 230, disposed 230)` | 0 |
| ③a 载体缺席 | `state not_evaluated` · `unresolved -` · `carrier=absent` | 3 |
| ③b 载体在但**全部**行不可解析 | `state not_evaluated` · `unresolved -` · `carrier=unreadable` | 3 |
| ④ 载体读到了、全量重算跑不成（无 `tasks/`） | `state not_evaluated` · `unresolved -` · `carrier=read` · `ENOENT … scandir '<root>/tasks'` | 3 |

```
$ node … task-file-violation-ledger --root <无台账的目录>
task_file_violation_ledger.state not_evaluated
task_file_violation_ledger.unresolved -
task_file_violation_ledger.detail absent — NOT-EVALUATED: 违规台账载体缺席（…）——「没有人报过」⛔ 不与「报过且都处置了」同形
exit=3
$ node … task-file-violation-ledger --root <台账只有 2 行坏行的目录>
task_file_violation_ledger.detail unreadable — NOT-EVALUATED: 台账存在但 2 行全部不可解析（读不懂 ⛔ 不等于零未处置）
exit=3
$ node … task-file-violation-ledger --root <有台账、无 tasks/ 的目录>
task_file_violation_ledger.detail read — NOT-EVALUATED: 全量重算跑不成（ENOENT: no such file or directory, scandir '…/tasks'）⇒ 处置不可判，⛔ 不与「零未处置」同形
exit=3
```

⛔ 未评估态**有独立取值**：`state not_evaluated` + `unresolved -`（不是 `0`），且 `unresolved` 在
`readTaskFileViolationLedger` 里是 `null` 而不是 `[]`（空数组会被读成「查过且干净」）。`carrier`
三值 `absent` / `unreadable` / `read` 把三种「查不成」彼此也分开。

**负控制（判据取得到假）**：同一个 root，只把 store 里那一条条目对应的 task 文件改回违规 ⇒ 读数
从 `ok` 翻回 `UNRESOLVED`（unit test `台账读侧 ①/②` 成对钉住，且断言台账文件本身没被动过）。

### AC5 — 未处置条目在场时，静态闸仍不因它中止

```
$ node --no-warnings --experimental-strip-types <wt>/plugin/scripts/task-contract-check.ts      --root /data/home/yale/work/quay --no-block   ⇒ exit=0
$ node --no-warnings --experimental-strip-types <wt>/plugin/scripts/task-ac-carryover-check.ts  --root /data/home/yale/work/quay --no-block   ⇒ exit=0
```

`run_checker "task-contract-check"` / `run_checker "task-ac-carryover-check"` 的 exit 读数都 = **0**
（此时生产台账 172 条未处置）。台账行数 before=230 / after=230 —— `--no-block` 这两条没有写进任何
新行（13 条与 159 条「new」是**相对祖父表**的，不是相对台账的；台账按 key 去重后一条都没新增）。
⇒ 阻断轴只是被 `--no-block` 关掉，本任务的改动没有把它改回去，也没有把它改弱。

### AC6 — 本任务自身的门

```
$ bash scripts/test.sh --for-task gap-task-file-violation-ledger-has-no-consumer --allow-thin
== scoped static checks (change-relevant tier) == … 全部 PASS …
ℹ tests 112  ℹ pass 110  ℹ fail 0  ℹ skipped 2
EXIT=0
```

### DoD — 生产条目被报到处置面；处置后不再被报

**处置面 = manager tick 机械读数**（`orchestration/manager-tick-core.md` 每轮调用的那一条；输出是
固定标签结构，人为跳过一项即缺行 ⇒ 新增的三行每轮都会被管理者读到，且落在它能处置的面上）。

```
$ MTR_REPO_ROOT=/data/home/yale/work/quay node --experimental-strip-types plugin/scripts/manager-tick-readings.ts | grep task_file_violation_ledger
task_file_violation_ledger.state UNRESOLVED
task_file_violation_ledger.unresolved 172 (entries 230, disposed 58)
task_file_violation_ledger.detail task-ac-carryover-check|gap-serial-install-family-shared-prebuilt-fixture: AC4,…(+160)
```

**处置后不再被报 —— 生产数据上的直接证据**：这 230 条里有 **58 条已经这样沉默**（曾经记过、
此刻不再成立）。抽验一条到文件级：

```
$ # 台账里最老的一条 contract 记账
{"key":"task-contract-check|tasks/DIR-128.md: contract-line-unknown", … ,"at":"2026-08-12T03:23:10.183Z"}
$ node … task-contract-check.ts --root /data/home/yale/work/quay --json tasks/DIR-128.md
DIR-128 violations now: []          # 记过 → 已修 → 今天的读者不再报它
```

**处置端到端实测（在生产 store 的忠实副本上做，见下方「为什么没有改生产任务体」）**：

```
$ S=<主检出 tasks/ + docs/analysis/ + .quay/task-file-violation-ledger.jsonl 的原样副本>
$ node … task-file-violation-ledger --root "$S"      # 副本先自证忠实：读数与生产一致
task_file_violation_ledger.unresolved 172 (entries 230, disposed 58)

$ # 处置前：该条目在未处置清单里
① 生产 unresolved: 172 | 含 ac264: true  | disposed: 58
$ # 处置动作 = 把违规真修掉（在此副本的 tasks/gap-ac264-….md 里，于 ## Contract 之外点名它 Contract
$ #   invoke 行给出的可执行入口路径 plugin/scripts/goal-driver.ts）
$ # 处置后：同一份台账文件（230 行、ac264 行仍在），只有 store 变了
② 副本  unresolved: 171 | 含 ac264: false | disposed: 59
```

⛔ **不是删台账行**（负控制）：副本台账 230 行、`ac264` 字样仍出现 2 次，条目却已离开 unresolved
⇒ 位移完全来自读者的全量重算。⛔ 不是豁免 id 表（判定在 `readTaskFileViolationLedger` 里由 store
推导，代码里没有任何 id 名单）。⛔ 不是「只加一段说明」（消费方是每轮真跑的 manager 读数）。

**⚠️ 为什么没有改生产任务体**：上面那次处置是在**生产 store 的逐字副本**上做的（副本先被证明
读数与生产完全一致：172/58）。要在**生产**上新增一次沉默，就得单方面改另一个 `done` /
`delivery-critical` / 带 `goal_ac: AC-264` 绑定的任务体的正文 —— 那不是本任务的授权范围，而且
那条修复的措辞会是我的推断而不是该任务作者的记录。所以本轮的做法是：**机制在生产读数上被证明
是活的（230 → 58 条真实沉默），处置动作在忠实副本上端到端跑通（172 → 171，同一份台账）**。
生产上此刻仍为 `UNRESOLVED 172` —— **这是读者在正确工作**（那 172 条此刻确实都还成立），
不是演示缺口；处置它们 = 各自把对应任务文件的 Contract/AC 修好，是一件一件独立的动作。

### 落点与清单：为什么 `.gitignore` 进了清单却没改

Touches 沿用原声明里的 `.gitignore`，但**实现时无需改动**：`
git check-ignore -v .quay/task-file-violation-ledger.jsonl` ⇒
`.gitignore:218:**/.quay/task-file-violation-ledger.jsonl` —— 已被覆盖（与近邻
`ci-runs.jsonl` / `release-branch-finish.jsonl` 同形）。故不动它，只记下读数。
`plugin/scripts/capability-catalog-declarations.json` 与
`plugin/test/manager-tick-readings.test.mjs` 是**新加进清单**的两条：前者因为 task-contract-check
的 CONSUMER 行此前写着「manager/outer 每轮读 …」这句**在机制上不成立**的声明，现在改成点名真实
消费面（`manager-tick-readings.ts` 的 `task_file_violation_ledger.*` 行）与判定来源；后者是因为
读取面就落在 `manager-tick-readings.ts`，它的四态读数必须有自己的门。

### 测试

新增/扩展三处，共 27 + 3 + 1 条直接 import 的单测（⛔ 无 subprocess）：

```
$ node --test plugin/test/manager-tick-readings.test.mjs      ⇒ tests 27 · pass 27 · fail 0
$ node --test plugin/test/task-contract-check.test.mjs        ⇒ tests 66 · pass 65 · fail 0 · skip 1
$ node --test plugin/test/task-ac-carryover-check.test.mjs    ⇒ tests 19 · pass 18 · fail 0 · skip 1
```

含三条负控制：①「台账行仍在」（防止 `ok` 是因为行被删）；②subset 清单里看不见违规 ≠ 已修
（`collectContractViolations` 的 §4c 臂）；③明细有界但计数是全量（20 条不得印成 12 条，且真处置
掉 10 条后计数随之降到 10）。
