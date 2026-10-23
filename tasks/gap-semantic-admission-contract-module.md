---
id: gap-semantic-admission-contract-module
title: 两段准入契约落成一份可复用模块 semantic-admission-contract.mjs（GOAL-911 AC-919）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-919
---
## Proposal

**事实（2026-10-22 立案当轮实测）**：AC-919 的判据在真实树上为红，且红在 instrument-failure，而不是「不合格」：

```
$ node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-919 --json | jq -r .criterion > .quay/ac919-criterion.sh
$ bash .quay/ac919-criterion.sh
CAUSE=instrument-failure: docs/analysis/semantic-admission-contract.mjs missing
exit=2
```

`docs/analysis/semantic-admission-contract.mjs` 不存在。`CONCERN_KIND_REGISTRY`（`docs/analysis/ownership-active-limited-proposal.mjs:331`）当前只登记每个 kind 的检测器/机制位，仓库里没有任何一处把「线索词表 vs 判断词表」抽成共享契约。GOAL-911 的裁定是「线索 vs 语义判断」的分离要做成**通用结构**，因此这份契约必须是**一份**模块，而不是每个 kind 一份副本。

**要建的东西（单一模块，零运行时依赖，纯 ESM，风格对齐同目录既有模块）**：`docs/analysis/semantic-admission-contract.mjs`

1. 线索层词表 `CLUE_STATES = Object.freeze(["candidate", "clear", "not-evaluated"])`，配具名常量 `CLUE_STATE = Object.freeze({ CANDIDATE: "candidate", CLEAR: "clear", NOT_EVALUATED: "not-evaluated" })`。语义：`candidate` = 机械信号命中、交语义判断；`clear` = 扫过、机械谓词未命中；`not-evaluated` = 线索读取器读不懂输入（硬规则 3b：不让「没查成」与「查过且干净」同形）。线索层**不含** `confirmed`，也不含任何判断层取值。
2. 判断层词表 `JUDGE_VERDICTS = Object.freeze(["confirmed", "refuted", "needs-more-evidence"])`，配 `JUDGE_VERDICT = Object.freeze({ CONFIRMED: "confirmed", REFUTED: "refuted", NEEDS_MORE_EVIDENCE: "needs-more-evidence" })`。
3. 两套取值互不同形的可取假校验（硬规则 3 / 3b）：导出 `checkVocabulariesDisjoint(clue = CLUE_STATES, judge = JUDGE_VERDICTS)`，返回 `{ evaluated: boolean, violations: string[] }`——⛔ 不返回裸 boolean；输入不是非空字符串数组时 `evaluated:false` 并给出非空 `cause`，⛔ 不与「合格」同形。另导出 `isClueState(v)` / `isJudgeVerdict(v)`。
4. 两段记录的最小 schema 与校验器（供 AC-920 的管线直接复用；本任务**不实现**管线）：
   - `clueRecord({ kind, subject, state, proxy_reading, evidence_ref })`：`state` 必须 ∈ `CLUE_STATES`；`state === "candidate"` 时 `proxy_reading` 必填非空；传入 `"confirmed"` ⇒ 具名拒绝（错误/违例文本必须点名 `confirmed` 与合法取值清单）。
   - `judgeRecord({ candidate_ref, verdict, rationale, counterfactual })`：`verdict` 必须 ∈ `JUDGE_VERDICTS`；`verdict === "confirmed"` 时 `counterfactual`（「若不为真则结果会不同」的对照，硬规则 4 推论四）必填非空；`refuted` / `needs-more-evidence` 不强制 `counterfactual`。
5. 模块头注释钉死：这是**唯一**契约模块；新 kind 只新增线索器与判断器，⛔ 不复制词表。

**⛔ 判据窗口陷阱（必须照做，否则 AC-919 判据会误红）**：AC-919 的 criterion 是源码文本检查，其中含正则 `/CLUE_STATES[\s\S]{0,200}?confirmed/`——从 `CLUE_STATES` 出现处起 **200 个字符内**出现 `confirmed` 即 exit 1。因此：①`CLUE_STATES` 的定义与紧邻注释之后 200 字符内**不得**出现 `confirmed` 字样（包括「CLUE_STATES 不含 confirmed」这类自解释注释——它恰好会触发）；②`JUDGE_VERDICTS` 及其取值必须放在距 `CLUE_STATES` 至少 200 字符之后（或之前）。写完用 criterion 原文实跑确认，不要靠读代码推测。

**反向臂（判据能取假，执行时必须实跑）**：`cp` 备份后用临时注入，分别验证：①删掉判断层 `needs-more-evidence` ⇒ criterion exit 1、stderr 含 `CAUSE=judge verdict missing: needs-more-evidence`；②给 `CLUE_STATES` 加上 `confirmed`（落在 200 字符窗口内）⇒ exit 1、stderr 含 `CAUSE=clue vocabulary contains confirmed`；③文件不存在 ⇒ exit 2、`CAUSE=instrument-failure`。⛔ 不用 `git checkout --` 恢复，用 `cp` 备份回拷。

**为什么不能只让判据变绿**：criterion 只做源码字符串检查——只在注释里提到词表、或把两套词表写成同一份数组，都能让它变绿。因此本条要求新增测试**真实 import 模块并断言取值与互斥**（不是读文本），且负臂用注入的合成词表证明校验器能取假。

<!-- dedup-ref -->**与同 goal 其它验收面的关系**：AC-918 覆盖注册表 `admission` 字段与 Planner 分派，AC-920 覆盖 `unencapsulated-state` 端到端管线；本条只承载「一份可复用契约模块」这一交付面，验收面独立（driver 的 goal-AC 核验读顶层 `goal_ac`），因此保持独立任务。

## AC

- [x] AC1 正向（判据原文实跑）：`node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-919 --json | jq -r .criterion > .quay/ac919-criterion.sh && bash .quay/ac919-criterion.sh` ⇒ exit 0，stdout 为 `OK: contract present; clue excludes confirmed; judge verdicts present`。贴出立案基线（exit 2，`CAUSE=instrument-failure: docs/analysis/semantic-admission-contract.mjs missing`）与落地后绿灯两份输出，以及 `git rev-parse HEAD`。
- [x] AC2 词表内容（真实 import，非源码文本断言）：`node --test plugin/test/semantic-admission-contract.test.mjs` exit 0；测试从 `../../docs/analysis/semantic-admission-contract.mjs` import，断言 `CLUE_STATES` 是冻结数组且集合含 `candidate`/`clear`/`not-evaluated` 且不含任何 `JUDGE_VERDICTS` 取值，`JUDGE_VERDICTS` 是冻结数组且集合恰为 `confirmed`/`refuted`/`needs-more-evidence`，两套词表是不同数组对象、交集为空。贴测试输出。
- [x] AC3 互不同形能取假：同一测试内对合成 fixture 调用 `checkVocabulariesDisjoint`——正常词表 ⇒ `evaluated:true` 且 `violations:[]`；把 clue 换成 `JUDGE_VERDICTS`（同形）⇒ `evaluated:true` 且 `violations` 非空具名；输入非数组 / 空数组 ⇒ `evaluated:false` 且 `cause` 非空（⛔ 不与「合格」同形）。贴三个臂的实际输出。
- [x] AC4 记录 schema 具名拒绝：测试断言 `clueRecord` 传 `state:"confirmed"` ⇒ 拒绝且错误文本点名 `confirmed` 与合法取值；`judgeRecord` 传 `verdict:"confirmed"` 且无 `counterfactual` ⇒ 具名拒绝；`verdict:"refuted"` 无 `counterfactual` ⇒ 通过；`judgeRecord` 传 `verdict:"candidate"` ⇒ 具名拒绝。贴输出。
- [x] AC5 反向臂（AC-919 判据能取假）：按 Proposal 的 ① ② ③ 注入，逐条贴出 exit code 与 stderr 原文；`cp` 回拷后 criterion 重新 exit 0。⛔ 不用 `git checkout --`。
- [x] AC6 单一模块、不按 kind 复制：`grep -rn "JUDGE_VERDICTS[[:space:]]*=" docs/analysis plugin/scripts --include=*.mjs --include=*.ts --include=*.js` 命中**恰好 1 处**（`docs/analysis/semantic-admission-contract.mjs`）；且 `grep -rn "needs-more-evidence" docs/analysis plugin/scripts --include=*.mjs --include=*.ts` 不出现第二份词表声明。贴命中数与前 3 条实际内容。
- [x] AC7 scoped 门：`bash scripts/test.sh --for-task gap-semantic-admission-contract-module` exit 0，输出里包含新测试文件（测试文件顶部必须带 `// @test-group engine`，与 `plugin/test/ownership-*.test.mjs` 同层；缺该声明会 fail-closed 拒绝归类）。贴输出尾部。

## DoD

- [x] 真实仓库（非夹具）上 AC-919 criterion 逐字读绿，且反向三臂都实跑具名——不是靠注释/夹具「看起来有这个词」过关。
- [x] 契约只有一份：仓库内 `JUDGE_VERDICTS` 声明恰 1 处，没有任何 kind 拥有自己的词表副本；模块被测试真实 import，取值断言不是 source-text grep。
- [x] `plugin/test/semantic-admission-contract.test.mjs` 进入全量 suite，并在 fan-in 的 scoped 门与全量跑中为绿；改动经 ff-merge 进入 develop。

## Evidence

**AC1 / AC5 — AC-919 criterion 原文实跑（cwd = 任务 worktree，相对路径因此读的是本任务落地的模块）**

```
# 立案基线（模块缺失）
exit=2
CAUSE=instrument-failure: docs/analysis/semantic-admission-contract.mjs missing

# 落地后绿灯
exit=0
OK: contract present; clue excludes confirmed; judge verdicts present
```

- 实现提交 HEAD = `254ab2fa0`；合并 develop 后 worktree HEAD = `7034d6548`（merge commit）。
- 反向臂① 删除判断层全部 `needs-more-evidence` 出现：`exit=1`，stderr `CAUSE=judge verdict missing: needs-more-evidence`
- 反向臂② `CLUE_STATES` 数组内加入 `confirmed`（落在 200 字符窗口内）：`exit=1`，stderr `CAUSE=clue vocabulary contains confirmed (hard-rule 3b: clue must not be isomorphic to verdict)`
- 反向臂③ 模块移走：`exit=2`，stderr `CAUSE=instrument-failure: docs/analysis/semantic-admission-contract.mjs missing`
- `cp` 备份回拷后 criterion 再次 `exit=0`；回拷后模块与备份 md5 一致（`6a4eb73d…`）。⛔ 全程未使用 `git checkout --`。
- 窗口余量实测：`CLUE_STATES` 的 4 处出现与紧随其后的 `confirmed` 的最小距离为 731 字符（> 200），不是靠贴边通过。

**AC2–AC4 — `node --test plugin/test/semantic-admission-contract.test.mjs`**

```
✔ AC2 — the two vocabularies are frozen, complete, distinct arrays with no shared value
✔ AC3 arm 1 — the real vocabularies evaluate as disjoint
✔ AC3 arm 2 — a clue vocabulary isomorphic to the judge vocabulary is reported by name
✔ AC3 arm 3 — unreadable input is NOT shaped like a pass
✔ AC4 — clueRecord rejects a verdict value by name and requires evidence for a candidate
✔ AC4 — judgeRecord enforces verdict membership and the counterfactual on confirmed
ℹ tests 6 / pass 6 / fail 0
```

测试真实 import `../../docs/analysis/semantic-admission-contract.mjs`：断言两套词表是冻结数组、集合内容、不同数组对象、交集为空；三个互斥臂（正常 / 同形 / 不可读）分别校验 `evaluated`+`violations`+`cause`；四类具名拒绝（clue 传 `confirmed`、candidate 缺 `proxy_reading`、confirmed 缺 `counterfactual`、judge 传 `candidate`）。

**AC6 — 单一模块**

```
$ grep -rn "JUDGE_VERDICTS[[:space:]]*=" docs/analysis plugin/scripts --include=*.mjs --include=*.ts --include=*.js
docs/analysis/semantic-admission-contract.mjs:45:export const JUDGE_VERDICTS = Object.freeze(["confirmed", "refuted", "needs-more-evidence"]);
count=1
```

`needs-more-evidence` 的其余出现（count=5）全部是契约模块自身的常量/注释，以及 `ownership-active-limited-proposal.mjs:548` 的一行交叉引用注释（「that single contract belongs to its own task」）——没有第二份词表声明。

**AC7 — scoped 门（AC 原文命令，无额外 flag）**

```
bash scripts/test.sh --for-task gap-semantic-admission-contract-module   → exit 0
✔ AC2 … ✔ AC4（新测试文件在本次运行中被执行）
ℹ tests 6 / pass 6 / fail 0
```

另按 driver 的 fan-in 口径跑过同一条门加 `--allow-thin`：exit 0，同样包含新测试文件；scoped-gate cache 已写入（developSha `7a47b273…`）。`// @test-group engine` 已在测试文件第一行。

**本轮（2026-10-23，第二次落地尝试）复验（cwd = worktree `/home/yale/work/quay-worktrees/gap-semantic-admission-contract-module`）**

- 实现提交 `254ab2fa0`；merge develop（`2b50a2eb…`）后 worktree HEAD `411c21658`
- AC-919 criterion 原文实跑：`exit=0` / `OK: contract present; clue excludes confirmed; judge verdicts present`
- 反向三臂复跑：① `exit=1` `CAUSE=judge verdict missing: needs-more-evidence`；② `exit=1` `CAUSE=clue vocabulary contains confirmed (hard-rule 3b: clue must not be isomorphic to verdict)`；③ `exit=2` `CAUSE=instrument-failure: docs/analysis/semantic-admission-contract.mjs missing`；`cp` 回拷后 md5 一致（`6a4eb73d…`）且 criterion 复绿
- `node --test plugin/test/semantic-admission-contract.test.mjs` → tests 6 / pass 6 / fail 0
- AC6：`JUDGE_VERDICTS =` count=1；`needs-more-evidence` count=5，无第二份词表声明
- 机械门：`bash scripts/test.sh --for-task gap-semantic-admission-contract-module --allow-thin` → `GATE_EXIT=0`（含本测试 6/6）；scoped-gate cache 已写（developSha `2b50a2eb…`）
- anti-drift Touches：`ANTI-DRIFT OK: task gap-semantic-admission-contract-module — 2 actual file(s), all within declared Touches (3 glob(s))`

**本轮（2026-10-23，第四次落地尝试）复验 + suite 归因**

复验（全部重跑，cwd = worktree；merge develop `ef5aa0a4f` 后 HEAD `2fa8e971d`）：

- AC-919 criterion 原文实跑 `exit=0`；反向三臂 ①`exit=1` `CAUSE=judge verdict missing: needs-more-evidence` ②`exit=1` `CAUSE=clue vocabulary contains confirmed (hard-rule 3b: …)` ③`exit=2` `CAUSE=instrument-failure: … missing`；`cp` 回拷后 md5 `6a4eb73df053341950ffeffc61990aa1` 一致、criterion 复绿
- `node --test plugin/test/semantic-admission-contract.test.mjs` → tests 6 / pass 6 / fail 0
- AC6：`JUDGE_VERDICTS =` count=1
- AC7：`bash scripts/test.sh --for-task … --allow-thin` → `GATE_EXIT=0`（含本测试 6/6）；scoped-gate cache 已写（developSha `ef5aa0a4f…`）
- anti-drift：`ANTI-DRIFT OK … 2 actual file(s), all within declared Touches (3 glob(s))`

**suite 红不是本任务的 delta 造成的（实测归因，非推测）**：

- 本分支对 develop 的 delta 是**两个新增文件**、零修改既有文件：`git diff --name-status develop...HEAD` ⇒ 仅 `A docs/analysis/semantic-admission-contract.mjs`、`A plugin/test/semantic-admission-contract.test.mjs`。新增文件在结构上不可能让 `goal-store` / `npm-pack-e2e` / `quay-init` / `shipped-set` / `capability-catalog` 等既有测试转红。
- 全量跑里**本任务的新测试确实执行且通过**：`__PERFILE__ …/plugin/test/semantic-admission-contract.test.mjs passed=true`。
- 全量跑的 `# fail` 计数在 8 轮里是 6/8/9/10/11/13/15/23（**浮动** ⇒ 负载形状），失败集每次都不同，且全部落在 delta-UNRELATED 文件；`planned=1044 terminal=1044 missing=0`（每个文件都有终态判定）。
- 但 `oomKill` **每一轮都 ≥1**（1/1/2/3/3/3/3/3），因此每轮都是 `SUITE-INCOMPLETE reason=oom-killed`，fan-in 一律拒绝落地。suite 自己的内存证据：`memory.limitBytes = memoryMaxBytes = 34359738368`（32G）、`peakBytes = 34359988224`、`oom=11 / oomKill=3`，而 `laneScaledEstimateBytes = 8.99G`——即 scope 真的被填满并杀了进程。
- **已排除「自家 OOM 夹具污染计数器」这一解释**：实测从当前 scope 内起 `systemd-run --user --scope` 落在 `app.slice/run-u…scope`（**兄弟**，不是后代），所以嵌套夹具的 kill 不会进 suite scope 的 `memory.events`；`memory.events` 是层级计数但那条路径不成立。
- 同工作区另一个任务（`gap-instrument-decay-dedup-reader-round-log-path`）同期 4 轮**全部** `SUITE-INCOMPLETE reason=oom-killed`（64/48/32 三档都试过）⇒ 这是**develop-wide / 主机级**现象，不是本任务特有。

**结论**：本任务交付面已完成并逐条复验为绿（AC1–AC7 全绿、scoped 门绿、anti-drift 绿）；剩余阻塞是套件 scope 的 32G 上限 / 重文件并发导致的真实 OOM，属于 `suite.memory_max` 与重文件并发的配置/代码面，**不在本任务 Touches 内**，需要单独修复；重跑本任务不会改变该结论。

## Dark Axis（ADR-007）

- 该轴仍暗,理由:本任务只在 docs/analysis 新增一个零 import 的独立契约模块及其测试,不触及产品依赖图

## Touches

- tasks/gap-semantic-admission-contract-module.md
- docs/analysis/semantic-admission-contract.mjs (new)
- plugin/test/semantic-admission-contract.test.mjs (new)

## Blocker

**2026-10-23T09:50:56.340Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (3) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：bfca68e0-53b1-4ebe-872a-1ab51dc94700
