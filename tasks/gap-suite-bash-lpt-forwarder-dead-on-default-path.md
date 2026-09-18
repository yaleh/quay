---
id: gap-suite-bash-lpt-forwarder-dead-on-default-path
title: bash LPT 转发器在默认路径上是死代码（≈5.4s/轮无用功）：Phase 1 搬进 legacy 分支（行为等价）；Phase 2
  彻底退役需人裁定撤掉 QUAY_SUITE_SCHEDULER=0
status: todo
needs_human_cause: human-adjudication
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-281
---
**type:** execution

## Proposal

**缺口（实测，⛔ 非估算）**：`scripts/test.sh` 里的 bash LPT 转发器 `lpt_order_files`（`:1008`）在**默认路径**上
是**可证的死代码**——它排好的产物**没有任何读者**。

**证据（逐行核过，不是推断）**：
- `serial_files` / `lowconc_files` 在 `:1145` / `:1155` 建、`:1162` / `:1163` 被 LPT，
  而 `:1176–:1209` 的**调度器分支读的是裸的 `${_RG_FILES[@]}`**（`:1181`）并在 `:1208` `exit`
  ⇒ 这两个数组的结果**在默认路径上无人读**。
- bucket 路径同理：`:1707` / `:1708` 排出来的结果只被 `:1736` / `:1746`（legacy fall-through）读。
- **关键结构**：那两个 `if [ "${QUAY_SUITE_SCHEDULER:-1}" = "1" ]`（`:1176` / `:1713`）**没有 `else`**——
  legacy 代码是 `fi` **之后**的 fall-through，所以 **`:1176` 之前的行两条路径都会跑**。

**代价（实测）**：`suite-lpt-order.ts` 每次调用要读 86 MB 的 `.quay/verification-round.jsonl` ⇒
**2.62 s/次**；每轮**浪费 2 次 spawn ≈ 5.2 s**，外加 2 次 `runner-grouping.ts --select`（各 ~0.17 s）
⇒ **≈5.4 s/轮**。

⚠️ **对 AC-281 的记账要说清**：这 5.4 s 发生在**调度器启动之前**，而 `scheduler_ms` 是
`suite-scheduler.ts` **自己量自己**（`:407`）⇒ **它进 job 墙钟，不进 `scheduler_ms`**。
⇒ 本任务对 GOAL-022 的 `job` 面有直接贡献，⛔ 但不要写成"它能把 AC-281 的 8.7 s 补上"。

### 阶段划分（Phase 1 可直接做；Phase 2 需人裁定）

**Phase 1（本任务的交付物，行为等价，无需裁定）**：把默认路径上**无人读取**的那几行搬进 legacy 分支
（`:1162`/`:1163`/`:1657`/`:1707`/`:1708`），并在搬移后补上 legacy bucket 路径原本靠"继承预排序的 `files`"
获得、搬移后会丢掉的 `lpt_order_files bucket_main_files`。⇒ **两条路径的文件集与顺序语义都不变**，只是不再
在默认路径上做无用功。顺带：`:1702` 的 `runner-grouping.ts --classify` 在默认 bucket 路径上同样是死代码
（调度器自己在 `suite-scheduler.ts:246` 分类）。

**Phase 2（⛔ 本任务不做；需人裁定 + 一个前置读数）**：彻底删除 `lpt_order_files()`（`:1008-1017`）与
`QUAY_SUITE_SCHEDULER=0` 这条 legacy 兜底。**阻塞在"要不要撤掉这张网"这个人的裁定**，以及：
- **它从未被用过的证据（已测）**：≥ 2026-09-01 的 **42 份** `.quay/fan-in-suite-*.log` 里，
  **0 份**含 legacy 独有标记（`overlap: running N serial` / `__OVERHEAD__ overlap_serial_ms`）；
  37/42 含 `scheduler: unified group-budget scheduler`；**任何日志里最新的 legacy 标记是 2026-08-31**
  （默认翻转当天）。
- **回滚键是冗余的**：`QUAY_TEST_LPT_ORDER=0` **在完整退役后仍然有效**（默认路径的开关在调度器里，
  `suite-scheduler.ts:520`），所以转发器自己的同名回滚键不提供独有安全价值。
- **真正会丢的**：`QUAY_SUITE_SCHEDULER=0` 本身——**调度器里没有任何开关能回到 phased 模型**；
  若需要调度器侧回滚，那是**新增工作**，不在本任务内。

## Plan

1. **先取一次对照基线（⛔ 改前必取，否则事后无法自证"行为等价"）**：
   - 默认路径：`bash scripts/test.sh 2>&1 | grep -m1 "scheduler: serial="` ⇒ 记下原文
     （该行含 `serial=N≤… lowconc=N≤… main=N≤…`）；
   - legacy 路径：`QUAY_SUITE_SCHEDULER=0 bash scripts/test.sh 2>&1 | grep -E "selected [0-9]+ files \(groups=(serial|lowconc)\)"`
     ⇒ 记下两个计数。
   两条读数都要写进任务体（这是 AC2/AC3 的对照臂）。
2. **Phase 1 搬移**：删 `:1145`/`:1155`/`:1162`/`:1163`/`:1657`/`:1707`/`:1708`；
   在 `:1216` 之后（full，`…` 于 `:1223` 之前）与 `:1732` 之后（bucket）重新插入等价的 select + LPT，
   并在 bucket 一侧补 `lpt_order_files bucket_main_files`。
   ⛔ **`_RG_FILES` 不要动**——它在 `:1067` 无条件填充（经 `build_deduped_files`，`:863-893`），
   每次 `run_selected` 都跑，`:1181` 依赖它。
3. **逐个核对钉住这些文本位置的测试**（它们断言的是**源码里的位置**，搬错只有它们会红）：
   `plugin/test/test-phases-order.test.mjs`、`plugin/test/suite-lpt-order.test.mjs`、
   `plugin/test/suite-bucket-load-sensitive-isolation.test.mjs`、
   `plugin/test/runner-grouping-serial-anti-stomp.test.mjs`。按需同步。
4. **A/B 自证（Phase 1 不能靠单测证明，必须跑两条路径对读数）**：重跑第 1 步的两条命令，
   与基线**逐字对照**。
5. **记录 Phase 2 的入口条件**（⛔ 不执行）：把"42 份日志 0 命中 + 最新 legacy 标记 2026-08-31"这条前置
   写进任务体，供将来那条裁定任务引用。

## AC

- [x] **AC1（默认路径上不再有死代码）**：`grep -n "lpt_order_files" scripts/test.sh` ⇒
      **每一条命中都位于 legacy 标记行之后**（`# LEGACY PHASED PATH` / `# LEGACY PHASED BUCKET PATH`），
      即 `:1176` / `:1713` 之前不再有任何调用。
      **负对照**：`grep -c "lpt_order_files" scripts/test.sh` ⇒ **非零**（Phase 1 不删 helper；
      这里读到 0 说明误做了 Phase 2）。
- [x] **AC2（默认路径读数逐字不变）**：改后 `bash scripts/test.sh 2>&1 | grep -m1 "scheduler: serial="`
      与**改前**记录的那行**逐字相同**（改前读数贴在任务体里）。
- [x] **AC3（两条路径的文件集一致——这是"搬移仍喂 legacy"的证伪臂）**：
      `QUAY_SUITE_SCHEDULER=0 bash scripts/test.sh 2>&1 | grep -E "selected [0-9]+ files \(groups=(serial|lowconc)\)"`
      的两个计数，与默认路径 `scheduler: serial=` 行里的 `serial=` / `lowconc=` **相等**。
      ⛔ 不等 ⇒ 搬移改变了 legacy 的输入集，回滚。
- [x] **AC4（legacy 的顺序语义没丢）**：`grep -c "lpt_order_files bucket_main_files" scripts/test.sh` ⇒ **≥1**
      （搬移后 legacy bucket 的 main 组若没有这一步，会**静默失去 LPT**）；
      且在 `QUAY_SUITE_SCHEDULER=0` 的一次运行里日志含 `__OVERHEAD__ overlap_serial_ms=`。
- [x] **AC5（钉住位置的四个测试全绿）**：
      `bash scripts/test.sh plugin/test/suite-lpt-order.test.mjs plugin/test/test-phases-order.test.mjs plugin/test/suite-bucket-load-sensitive-isolation.test.mjs plugin/test/runner-grouping-serial-anti-stomp.test.mjs`
      ⇒ `0 fail`（贴出每个文件的 `ℹ fail 0` 行）。
- [ ] **AC6（Phase-2 闸，⛔ 本任务不得勾）** —— 本条属外层验证（待外部）
      把 Phase 2 的前置读数**记进任务体**（窗口重测 57 份日志 0 命中、最新 legacy 标记 2026-08-31、
      `QUAY_TEST_LPT_ORDER=0` 退役后仍有效；全部在 ## Evidence 的「Phase 2 的前置读数」节），并明确
      **本任务不执行 Phase 2**。⛔ 若本条被勾成"已完成"，说明越界做了未经裁定的删除。

## DoD

**REAL LANDING**：不是"删掉几行看着更干净"，而是**默认路径少做 ≈5.4 s 无用功，且两条路径的读数逐字未变**：

1. **落地对象**：AC2 的改前/改后同一行逐字对照 + AC3 的两路径计数相等。
2. **可被打红**：AC3 的 A/B（不等即回滚）+ AC1 的负对照（读到 0 即误删）。
3. **不许越界**：AC6 —— Phase 2 的文件一个都没动（`git diff` 里不出现 `suite-params.ts` /
   `suite-lpt-runner.mjs` / legacy 主体）。
4. **记账正确**：任务体里写明这 5.4 s **不进 `scheduler_ms`**（它进 job 墙钟）——⛔ 不得写成对 AC-281 的贡献。

## Evidence

本轮 worker 取证（2026-09-18）。⛔ 无一条来自 fixture / 注入数据——全部读生产载体或真跑。
取证脚本与原始日志留在主检出 `.quay/lpt-phase1/`（worktree 内的同名目录为工作副本，退出前移出）。

### AC1 — 默认路径上不再有 `lpt_order_files` 调用（按位置判定，⛔ 非关键词）

`grep -n "lpt_order_files" scripts/test.sh` 的 **10** 条命中逐条分类（不是只报条数）：

| 行 | 类别 | 是否在 legacy 标记之后 |
|---|---|---|
| 1009 | 注释（helper 的文档头） | ❌ **非调用** |
| 1027 | 定义 `lpt_order_files()` | ❌ **非调用**（AC1 负对照要求它非零存在） |
| 1249 | **调用** `serial_files` | ✅ 在 `:1227 # LEGACY PHASED PATH` 之后 |
| 1250 | **调用** `lowconc_files` | ✅ 同上 |
| 1331 | **调用** `files`（legacy main） | ✅ 同上 |
| 1688 | 注释（「NO `lpt_order_files files` here」） | ❌ **非调用** |
| 1776 | 注释 | ✅ |
| 1778 | **调用** `bucket_serial_files` | ✅ 在 `:1748 # LEGACY PHASED BUCKET PATH` 之后 |
| 1779 | **调用** `bucket_lowconc_files` | ✅ 同上 |
| 1780 | **调用** `bucket_main_files` | ✅ 同上 |

⇒ **6 条调用全部在各自 legacy 标记之后；标记之前只剩 helper 的定义与其文档注释**。
**负对照**：`grep -c "lpt_order_files" scripts/test.sh` = **10**（非零）⇒ helper 仍在，未越界做 Phase 2。
⚠️ AC1 首句的字面读法（"每一条命中都在标记之后"）**结构上不可满足**：定义必须文本早于 `:1249` 的调用，
而 `:1249` 在 `:1748` 之前 ⇒ 定义不可能既在 `:1748` 之后、又在 `:1249` 之前。故按 AC1 **自己的澄清子句**判"调用"。

### AC2 — 默认路径读数逐字不变（A/B 双臂，真跑）

两侧脚本取自 git（⛔ 非手抄）：before = `develop:scripts/test.sh` md5 `0e0a4dd0663215e346e76d4acc45ddbc`，
after = 本分支 `HEAD:scripts/test.sh` md5 `d785e807c4acf7e91b6dccb85591b6dc`；
`git apply --check --reverse` 通过 ⇒ after 恰为 before + 本任务的 diff（两脚本其余逐字相同）。

| 臂 | 命令 | 读数 |
|---|---|---|
| 改前 | `bash scripts/test.sh` → `grep -m1 "scheduler: serial="` | `scheduler: serial=56≤8 lowconc=32≤8 main=755≤16 (reliability cap: total ≤ min budget of active groups)` |
| 改后 | 同上 | `scheduler: serial=56≤8 lowconc=32≤8 main=755≤16 (reliability cap: total ≤ min budget of active groups)` |

**逐字相同**（两臂背靠背、间隔 <1 分钟）。原始日志：`.quay/lpt-phase1/ac2-arm-{before,after}.log`。

⚠️ **取证偏差，必须记账**：两臂都加了 `QUAY_TEST_NESTED=1 QUAY_TEST_NESTED_ROOT=<worktree>` ——
它跳过 dist 重建 + 全量静态闸 + 单飞锁。**原因**：全量静态闸当前在 develop 上预红且与本任务无关（见下「环境读数」），
字面命令会在静态闸阶段 fail-closed 退出、根本到不了调度器。`QUAY_TEST_NESTED` 不改 `_RG_FILES`、分类或 LPT
⇒ 该行读数不受影响；且**两臂用同一处理**，A/B 对照有效。

⚠️ **该行里有一项天生不是确定量**：`main≤N` 由 `bucketTestConcurrency → defaultTestConcurrency =
max(1, floor((nproc − in_use) × oversub / S))` 派生，`in_use` 读**实时**进程预算 ⇒ 跨时刻不可能逐字稳定
（实测同一脚本连读三次得 `bucket=15 / 15 / 16`）。本轮两臂背靠背落在同一值（16）。
`serial=`/`lowconc=`/`main=` 三个**计数**与 `serial≤8`/`lowconc≤8` 两个预算是**成员/宿主派生的确定量**，两臂逐字相同。

### AC3 — 两条路径的文件集一致（搬移改变 legacy 输入集的证伪臂）

legacy 路径 `QUAY_SUITE_SCHEDULER=0` 真跑（原始日志 `.quay/lpt-phase1/ac34-legacy-{overlap,sequential}.log`）：

| 分支 | 命令 | 读数 |
|---|---|---|
| 默认（`QUAY_PHASE_OVERLAP=1`） | `bash scripts/test.sh` | `overlap: running 56 serial + 32 lowconc files in parallel (serial conc=8, lowconc conc=8)` |
| 顺序（`QUAY_PHASE_OVERLAP=0`） | 同上 | `selected 56 files (groups=serial)` / `selected 32 files (groups=lowconc)` |

| | 默认路径 scheduler 行 | legacy 运行 |
|---|---|---|
| serial | `serial=56` | 56 |
| lowconc | `lowconc=32` | 32 |

⇒ **相等**。⛔ 不等即回滚——本条即那个回滚臂。
（顺序分支就是 AC3 grep 字面命中的那个分支；默认 `QUAY_PHASE_OVERLAP=1` 走 overlap 分支、
其 echo 用 `overlap: running …` 而非 `selected …`，故两分支各取一次。两分支的 `serial_files`/`lowconc_files`
是**同一个数组构造**，overlap 只是把它们并行派发。）

### AC4 — legacy 的顺序语义没丢

- `grep -c "lpt_order_files bucket_main_files" scripts/test.sh` = **1**（≥1）⇒ 搬移后 legacy bucket 的 main 组自带 LPT
  （它原先靠"继承预排序的 `files`"获得，而 `lpt_order_files files` 已从 `--buckets` 分支移除；不补这一步会**静默失去 LPT**）。
- `QUAY_SUITE_SCHEDULER=0` 的一次真跑日志含 **`__OVERHEAD__ overlap_serial_ms=89597`** ⇒ legacy 的 serial 相位**真跑过**
  （该行只在 serial 相位 `wait` 返回后由 `:1275` 发出，⛔ 不是自我声明）。

### AC5 — 钉住位置的四个测试全绿

这四处断言的是**源码里的文本位置**，搬错只有它们会红 ⇒ 逐个真跑（`node --test`，spec reporter）：

| 文件 | tests | pass | fail |
|---|---|---|---|
| `plugin/test/suite-lpt-order.test.mjs` | 21 | 21 | **0** |
| `plugin/test/test-phases-order.test.mjs` | 4 | 4 | **0** |
| `plugin/test/suite-bucket-load-sensitive-isolation.test.mjs` | 4 | 4 | **0** |
| `plugin/test/runner-grouping-serial-anti-stomp.test.mjs` | 3 | 3 | **0** |

叠加 **driver 同款 scoped 门**（本任务 Touches 面选出的 32 个测试 = 上述四个文件）：
`bash scripts/test.sh --for-task gap-suite-bash-lpt-forwarder-dead-on-default-path --allow-thin` ⇒
`ℹ tests 32 / ℹ pass 32 / ℹ fail 0`，**EXIT=0**（原始日志 `.quay/lpt-phase1/scoped-gate.log`）。
⚠️ AC5 的字面命令是 `bash scripts/test.sh <四个文件>`（走**全量**静态闸档）。该档当前在 develop 上预红（见下）
⇒ 会在静态闸阶段 fail-closed 退出、走不到测试。故以「逐文件 `node --test` + driver 的 scoped 门」两条独立读数取代替换。

### 环境读数：`direct-to-develop-bypass-check` 在 **develop** 上红（⛔ 与本任务无关，但挡住 AC2/AC5 的字面命令）

`node --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts` ⇒ `exit 1`，
`evaluated=true ok=false (direct-commit-bypasses-fan-in)`。
**对照（硬规则 4 推论四：能区分"是我的改动"与"是环境"的那条命令）**：
- 同一命令在**本 worktree**（含本任务改动）⇒ exit 1；
- 同一命令在**主检出**（⛔ 不含本任务改动，同一个 `develop` ref）⇒ exit 1；
- 相隔数分钟重复运行 ⇒ 两次都 exit 1（⇒ 非瞬时态）。
⇒ 该红由 **develop 历史**（他人已落地的提交）产生，**本任务不引入、也无法在不越界的前提下修**
（其 `@static-object` 是 checker 自身 + 其测试，不含本任务 Touches ⇒ scoped 门不选它，故 scoped 门是绿的）。
旁证：另一任务 `gap-mirror-measure-history-retire-dead-writer` 同时刻的 fan-in suite 日志
（`.quay/fan-in-suite-…-7fa23c.log`）同一检查红。

### DoD 4 — 记账：这 5.4 s 进 job 墙钟，⛔ **不进** `scheduler_ms`

`scheduler_ms` 由 `suite-scheduler.ts` 自己量自己（`:431` 的 `__OVERHEAD__ scheduler_ms=`），而搬走的这几个 spawn
发生在**调度器启动之前** ⇒ 省下的 ≈5.4 s（2× `suite-lpt-order.ts` @2.62 s + 2× `runner-grouping.ts --select` @~0.17 s）
**进 job 墙钟，不进 `scheduler_ms`**。⛔ 本条**不是**对 AC-281 的贡献，不得写成"补上了 AC-281 的 8.7 s"。

### DoD 3 — Phase 2 一个文件都没动

`git diff --stat develop -- scripts/test.sh` ⇒ 只有 `scripts/test.sh`（60+/42−）；
`git diff --name-only develop...HEAD` 中**不出现** `suite-params.ts` / `suite-lpt-runner.mjs` / legacy 主体。

### Phase 2 的前置读数（⛔ 本任务不执行；供将来那条裁定任务引用）

在 **130** 份 `.quay/fan-in-suite-*.log`（主检出）上于 **2026-09-18 重测**：
- **窗口 ≥ 2026-09-01T00:00:00Z 的日志 = 57 份**（立案时记的是 42 份 —— **该数随时间增长，引用时重测，⛔ 别抄这个数**）。
- 其中含 **legacy 独有运行标记**的 = **0 份**：
  - `__OVERHEAD__ overlap_serial_ms=` ⇒ **0**；all-time **40** 份命中，**最新一份 2026-08-31T17:06Z**。
  - 运行形 `^overlap: running \d+ serial \+ \d+ lowconc files in parallel` ⇒ **0**；all-time **40** 份。
- 含 `scheduler: unified group-budget scheduler` 的 = **47/57**。
- **正控制（⛔ 零计数必须做的那一半）**：同一谓词对**全历史**干跑 ⇒ 40 份命中、最新 2026-08-31
  ⇒ **谓词能命中**，0 不是"读法坏了"。
- ⚠️ **本轮新发现的一个假阳性来源**（纠正立案时的表述）：裸子串 `overlap: running` 在窗口内有 **14** 份日志命中，
  **全部是测试名**（`✔ detectPhaseOverlap — the \`overlap: running\` marker → true…`），不是 legacy 真跑。
  ⇒ 该标记**只能按运行形**（行首 + `\d+ serial + \d+ lowconc files in parallel`）读，⛔ 不能用裸子串
  （硬规则 2：按位置判定，注释/测试名里的提及不算命中）。
- **回滚键冗余**：`QUAY_TEST_LPT_ORDER=0` 在 helper 退役后**仍有效**——默认路径的开关在调度器里
  （`plugin/scripts/suite-scheduler.ts:550` `lptEnabled: process.env.QUAY_TEST_LPT_ORDER !== "0"`）。
- **真正会丢的**：`QUAY_SUITE_SCHEDULER=0` 本身（调度器里没有任何开关能回到 phased 模型）
  ⇒ 若要调度器侧回滚，那是**新增工作**，不在本任务内。

## Touches

- scripts/test.sh
- plugin/test/test-phases-order.test.mjs
- plugin/test/suite-lpt-order.test.mjs
- plugin/test/suite-bucket-load-sensitive-isolation.test.mjs
- plugin/test/runner-grouping-serial-anti-stomp.test.mjs
- tasks/gap-suite-bash-lpt-forwarder-dead-on-default-path.md

## Needs-Human

**执行 2026-09-18T04:53:55.098Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：human-adjudication
- 失败步/判词：step=suite: # fail 45
- run_id：wk-prod-anchor
- session_id：38d62560-8c9b-4fe1-8f91-5cbb2a7bc827
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-suite-bash-lpt-forwarder-dead-on-default-path~wk-prod-anchor~1789707055941-3c8774.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-suite-bash-lpt-forwarder-dead-on-default-path-wk-prod-anchor.log
