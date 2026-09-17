---
id: gap-ac281-scheduler-ms-carrier-field
title: ci-runs-collect.ts 派生 jobs[].schedulerMs（AC-281 判据可评估性——从 __OVERHEAD__
  scheduler_ms= 行落进载体）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: plan
goal_ac: AC-281
---
**type:** plan

## Proposal

`goals/AC-281-*.md`（`GOAL-022`）原量的是 CI `test` job 的**总墙钟**（`durationSec`，含
checkout/npm install/coverage self-check/runner 收尾等固定开销），目标 ≤30s。
`gap-ac281-develop-ci-test-job-wallclock-under-30s` 任务用真实 CI 数据（tokyo-alpha 128 核 runner，
run 35225478541/35227553148/35228548244/35229453772 等 5 条一致读数）证明：job 的不可约开销 ≥ 27s
（checkout+npm install+coverage self-check+runner 收尾 ≈ 16–33s + runner 收尾 ≈10–12s），该判据在当前
job 结构下**数学上不可能达成**，且与 `GOAL-022` 自身「不追求绝对30秒是数学精确值」的非目标条款直接
矛盾（见该任务体「## Evidence §0」与「§7 给重定范围的建议」）。

人 2026-09-17 裁定：判据改为只量套件自身的调度器墙钟——`scripts/test.sh` 内部由
`plugin/scripts/suite-scheduler.ts:407` 打印的 house marker `__OVERHEAD__ scheduler_ms=<n>`（写到
stderr，单位毫秒；正则锚点 `plugin/scripts/full-suite-runner.ts:2780` 的
`schedulerEndRe = /^__OVERHEAD__\s+scheduler_ms=/`）。这条 marker **已经存在**、`scripts/test.sh` 每次跑
都会打印（上述任务体「## Evidence §1」实测贴出过一行 `scheduler_ms=53507`），缺的只是
`.quay/ci-runs.jsonl` 载体没有采集它。

manager 会话已完成的前置（2026-09-17，已落地并推送 `origin/develop`）：`AC-281` 的 criterion 已经改写为
读一个新字段 `jobs[].schedulerMs`（`goal write AC-281 --criterion ... --expect ... --origin ...`）。已验证
新判据能正确诊断出字段缺失（诚实的 NOT-EVALUATED，不是恒真/恒假）：

```
$ node packages/quay/bin/quay.ts goal gate AC-281 --json
CAUSE=scheduler-ms-not-recorded — the latest post-filing CI test job (...) carries no schedulerMs
reading, so the suite's own scheduler wall-clock cannot be judged from this carrier. This is
NOT-EVALUATED, not 'too slow'.
```

本任务要做的：给 `plugin/scripts/ci-runs-collect.ts`（唯一写面）新增 `schedulerMs` 字段的派生逻辑，
让 `.quay/ci-runs.jsonl` 里的 `jobs[]` 记录能带上这个读数，AC-281 才能真正被评估（pass 或 fail 都算
完成，NOT-EVALUATED 卡住才算没完成）。

### 同文件里已有的同构先例（照着抄形状，不是从零设计）

`prereqProvision` 字段是结构完全相同的先例（`gap-ac282-runner-prereqs-already-present` 落地的，
已 done）：

- `plugin/scripts/ci-runs-collect.ts:135` `PREREQ_MARKER_RE = /__PREREQ__[ \t]+([A-Za-z0-9_-]+)=([A-Za-z0-9_.-]+)/g;`
  （house marker 正则，同族形态；`__GROUP__` 的姊妹正则 `GROUP_FILES_RE` 在 `:104`）。
- `:154`-`:175` `derivePrereqProvision(logText)`：从一个 job 自己的日志里派生该字段的函数实现。
- `plugin/scripts/ci-red-attribute.ts:55`-`:70` `JobReading` 接口——`prereqProvision?: Record<string,
  string>;` 在 `:68`，字段的类型定义与「缺 ≠ absent」的纪律写在紧邻的注释里。
- `ci-runs-collect.ts:277`-`:303` `toJobReadings()`：`:292`-`:293` `const prov =
  prereqByJob?.get(j); if (prov !== undefined) reading.prereqProvision = prov;`——把派生结果写进
  `JobReading` 对象的位置（⚠️ 核实：原设想引用的行号 `:275` 与当前实际行号 `:293` 不完全一致，此处
  已按当前文件重新核实，落笔时以 `:293` 为准，二者相差是此前引用时机与本次核实之间的正常代码增补，不
  影响先例结构本身）。
- `:601`-`:638`：日志下载触发条件（`needsTestFiles`/`needsPrereq` 双闸门，`:605`-`:606`）、
  `wantsLogs()`/`offlineSeam` 判断（`:541`-`:546`/`:539`）、日志拉取的 job 过滤与 fail-soft 回退
  （`preferred`/`targets`，`:617`-`:619`）、预算耗尽留痕（`log-budget-exhausted:`，`:612`）。
- `:697`-`:723` `knownPrereqRunsFromCarrier()`：载体里已经派生过该字段的 runId 集合，喂给
  `collect(knownPrereqRuns:)` 防止已派生过的 run 重复拉日志。
- `:736`-`:775` `prereqPatch()` / `enrichable()`：既有载体记录的**就地补全**逻辑（`:750`
  `return { ...rec, prereqProvision: src.prereqProvision };`——只填缺失的键，其余字段逐字保留，不重写
  整条记录）。

### `schedulerMs` 与 `prereqProvision`/`testFiles` 的关键差异（不要照抄错了语义）

- `prereqProvision` 是一个**对象**（三键：pyyaml/tmux/procps 各自的状态词），`testFiles` 是一个
  **计数**（取所有 `__GROUP__ … files=N` 命中的最大值），`schedulerMs` 应该是一个**单一数值**
  （毫秒）。marker `__OVERHEAD__ scheduler_ms=<n>` 在同一份日志里**只会出现一次**（调度器结束时打印
  一次，不是逐组重复）——派生逻辑应该比 `derivePrereqProvision`/`deriveTestFilesFromLog` 都更简单：
  正则匹配到就取那个数字，匹配不到就**不写这个键**（缺 ≠ 0，硬规则 6：缺值=未查，不是为假）。
- `schedulerMs` **只在跑测试的那个 job**（当前是 `test` job）的日志里才可能出现——和 `__GROUP__`/
  `__PREREQ__` 是同一份日志来源，**复用同一次日志下载**（`:601`-`:638` 那个循环体内，`log` 变量已经
  拿到手），**不新增网络调用**。`ci-runs-collect.ts` 现有的日志拉取逻辑已经是"一次下载、多个字段
  派生"的模式（同一个 `log` 变量既喂 `deriveTestFilesFromLog(log)` 又喂
  `derivePrereqProvision(log)`），这条要接入同一条路径，不要另起一套下载。

## Plan

1. **加正则 + 派生函数**（`plugin/scripts/ci-runs-collect.ts`，紧邻 `GROUP_FILES_RE`/`PREREQ_MARKER_RE`
   那一组常量）：`SCHEDULER_MS_RE = /__OVERHEAD__\s+scheduler_ms=(\d+)/` + `deriveSchedulerMs(logText):
   number | null`——命中取第一个（或最后一个，需先看真实日志确认 marker 是否可能重复打印，若结构上
   只可能出现一次两者等价）匹配的数字，转 `Number`；`Number.isFinite` 失败或无命中 ⇒ 返回 `null`。
2. **接入日志下载循环**（`:601`-`:638`）：在已经拿到 `log` 变量的地方（`const log = run([...])`
   之后），追加 `const sched = deriveSchedulerMs(log); if (sched !== null) schedulerByJob.set(j, sched);`
   —— 与 `prereqByJob.set(j, derivePrereqProvision(log))` 同一处、同一次下载。是否需要独立的
   `needsSchedulerMs` 闸门（类比 `needsTestFiles`/`needsPrereq`）取决于：该字段一旦某条 run 已经派生
   出来是否还需要重新拉日志——参考 `prereqProvision` 的闸门设计理由（`:601`-`:606` 注释：两个量共用
   同一次下载，但各自独立判断"是否已知"），本字段应照此加第三个闸门 `needsSchedulerMs`，避免重蹈
   `testFiles`-only 闸门曾让 `prereqProvision` 结构性不可派生的错误（同一份任务体 AC-282 的教训）。
3. **`JobReading` 接口加字段**（`plugin/scripts/ci-red-attribute.ts:55`-`:70`）：`schedulerMs?: number;`
   ——紧邻 `prereqProvision` 字段之后，注释写清楚它只在 `test`（或跑测试的那个）job 的读数里出现、
   缺 ≠ 0 的纪律，照抄 `prereqProvision` 注释的格式。
4. **`toJobReadings()` 写入**（`ci-runs-collect.ts:277`-`:303`）：新增一个可选参数
   `schedulerByJob?: ReadonlyMap<GhJob, number>`，仿照 `:292`-`:293` 的 `prov` 写法：
   `const sched = schedulerByJob?.get(j); if (sched !== undefined) reading.schedulerMs = sched;`。
5. **调用链穿透**：`collect()`（`:502`-`:645`）里新建 `schedulerByJob` map，传给
   `buildRecord(r, { jobs, timeouts, testFiles, prereqByJob, schedulerByJob })`（`:641`）；`buildRecord`
   自身（约 `:305` 起的 `BuildRecordOptions`）与其对 `toJobReadings` 的调用也要接上这个新参数。
6. **既有记录的就地补全**：新增 `knownSchedulerRunsFromCarrier()`（仿 `knownPrereqRunsFromCarrier`
   `:697`-`:723`）与在 `enrichable()`（`:765`-`:775`）里加一段仿 `prereqPatch` 的
   `schedulerPatch()`——只填缺失的 `schedulerMs` 键，其余字段逐字保留。
7. **CLI 接线**：确认 `collectForRound`/主入口把新的 `known*RunsFromCarrier` 结果喂进
   `collect(knownSchedulerRuns:)`，与 `knownPrereqRuns`/`knownTestFiles` 同一处接线，不要漏掉生产
   调用路径（否则单测绿但 CLI 实际调用永远不会传这个已知集合）。
8. **单测**：在 `plugin/test/ci-runs-collect.test.mjs`（已有 ⑦ 段讲 `prereqProvision` 的先例注释，
   本次新增一段 ⑧ 讲 `schedulerMs`）里补：正向（真实日志片段派生出数字）、负控制（无 marker ⇒
   `undefined`，不是 `0`/`null`）、就地补全（缺字段的既有记录被追加、其余字段不变）、闸门（已知
   schedulerMs 的 run 是否还需要为了别的字段拉日志时不受影响）。
9. **真实端到端验证**：对一条已经在 `.quay/ci-runs.jsonl` 里但缺 `schedulerMs` 的历史 run（如
   35229453772 / 35227553148——`gap-ac281-develop-ci-test-job-wallclock-under-30s` 任务体「## Evidence
   §0/§3」引用过这些 run id）跑一次采集器的补全路径，比对改前改后的完整 JSON 差异。
10. **触发一次真实 develop CI**（或复用最新已有的 post-filing run）验证新 run 的原生派生路径（不是
    补全路径）也真的在跑，并重跑 `goal gate AC-281 --json` 确认不再报
    `CAUSE=scheduler-ms-not-recorded`。

## AC

- [x] AC1：`deriveSchedulerMs`（或最终定名的派生函数）有单元测试，对一段含
      `__OVERHEAD__ scheduler_ms=53507` 的真实日志片段（从一次真实 CI run 的日志里摘取，不是编造的
      样本）派生出 `53507`（`number` 类型，单位毫秒，不是字符串）。
- [x] AC2：负控制——对一段**不含**该 marker 的日志片段，派生结果是 `undefined`（键不存在，不写进
      `JobReading`），不是 `0` 或 `null` 这类"看起来像失败"的假值（硬规则 6）。
- [x] AC3：真实端到端验证——对一个真实的、已经在 `.quay/ci-runs.jsonl` 里但缺 `schedulerMs` 的历史
      CI run（如 `35229453772` 或 `35227553148`），跑一次 `ci-runs-collect.ts` 的补全逻辑，验证该条
      记录被**就地追加** `schedulerMs` 键（不是重写整条记录、不丢失其他既有字段——比对改前改后的
      完整 JSON 差异，只多一个键）。
- [x] AC4：`node packages/quay/bin/quay.ts goal gate AC-281 --json` 逐字重跑，验证不再报
      `CAUSE=scheduler-ms-not-recorded`（可能报 `too-slow` 也可能报 `OK`，取决于当前真实读数——不
      强求这一轮就 ≤30s，那是下一步压低 `driver-anchor.test.mjs` 之类文件的实现工作，本任务只负责
      让判据能被评估，不负责让它变绿）。
- [x] AC5：触发一次真实的 develop CI（或复用最新已有的 post-filing run），跑 `ci-runs-collect.ts`
      采集，确认新落地的记录带着真实的 `schedulerMs` 数值（不是历史 run 的补全，是新 run 的原生
      派生路径也在跑——贴出该次采集器调用打印的 `appended=`/`schedulerMsDerived=`（或等价读数）与
      落地记录本身）。
- [x] AC6：`bash scripts/test.sh --for-task gap-ac281-scheduler-ms-carrier-field` 退出 0。

## DoD

验收对象是"AC-281 的判据能够被真实评估（不再永久卡在 NOT-EVALUATED）"——不是"加了一个正则"就算
完成；AC3/AC5 的真实读数（改前无该字段、改后有）是最终证据，不是推理（硬规则 4 推论三：一个只能被
fixture/注入数据满足的判据不是测量,证据必须来自生产载体）。本任务**不要求**让 AC-281 立刻转绿（那
需要额外压低套件本身的调度器时长，比如拆分 `plugin/test/driver-anchor.test.mjs`，是另一个范围，
`gap-ac281-develop-ci-test-job-wallclock-under-30s` 任务体「## Evidence §7」已经给出建议方向），只
要求判据能读到真数据、给出真判定（pass 或 fail 都算完成，NOT-EVALUATED 卡住才算没完成）。

## Touches

- plugin/scripts/ci-runs-collect.ts
- plugin/scripts/ci-red-attribute.ts
- plugin/test/ci-runs-collect.test.mjs
- tasks/gap-ac281-scheduler-ms-carrier-field.md
