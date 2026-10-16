---
id: gap-routine-semantic-dedup-scan-print-json-three-behaviours
title: "semantic-dedup-scan: One name spans three shapes: three byte-identical
  console.log(JSON.stringify(x)), two pretty-printers that are one behaviour in
  two spellings, and a third pret"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
depends_on:
  - gap-suite-recovery-ladder-log-wiring-reads-wrong-file-always-log-unreadable
  - gap-lwa-crit-fixture-sleep300-child-not-reaped-forces-aborted-on-clean-suite
---
## Finding
One name spans three shapes: three byte-identical console.log(JSON.stringify(x)), two pretty-printers that are one behaviour in two spellings, and a third pretty variant with a different signature — extraction must respect that core cannot import plugin sources.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792033478766` · ts `2026-10-15T03:04:38.766Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`printJson`
- 涉及文件：
- `plugin/scripts/run-identity.ts:471`
- `plugin/scripts/stage-receipt.ts:800`
- `plugin/scripts/workflow-journal.ts:607`
- `plugin/scripts/guard-lineage-check.ts:465`
- `plugin/scripts/worktree-process-reaper.ts:517`
- `packages/quay/src/cli/shared.ts:41`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
extract

## Disposition
**已修（extract），除一处结构性分歧外。** 三形态各自的落点：

- 紧凑（`console.log(JSON.stringify(obj))` ×3，三处字节相同）→ `plugin/scripts/gate-script-base.ts` 的 `printJsonCompact`。三处**本就** import 该模块，无新增依赖边。
- 美化（`console.log(JSON.stringify(x, null, 2))` 与 `` `process.stdout.write(\`${JSON.stringify(x, null, 2)}\n\`)` `` —— 同一行为两种拼写）→ 同模块的 `printJson`。
- 美化核心变体（`packages/quay/src/cli/shared.ts:41`）→ **保留**，并就地声明为**结构性分歧而非漂移**：`packages/quay` 从不 import plugin 源（依赖方向是 plugin → Core），两个面共用一份定义就得把 Core 源码放上 plugin 的 import 路径——`packages/quay/scripts/build-plugin-dist.mjs` 的 `CORE_SRC_DIR` 注释已记该写法在 staged 布局下 break esbuild。finding 自己的 rationale 点名了这条边界。

**字节等价是实测的，不是推的**：Node 的 `format()` 对单个字符串参数原样返回后再补 `\n`，故 `process.stdout.write(JSON.stringify(x) + "\n")` 与 `console.log(JSON.stringify(x))` 输出同字节（cmp 嵌套/undefined/null 夹具：46 字节，一致）；三个紧凑 CLI 的冒烟输出仍是单行。

**5b 扫描（同一符号，⛔ 不是「全仓 JSON 输出」）**：`grep -rn 'function printJson' plugin/scripts` 另命中 finding 未列的 **3 处**——`orphan-session-check.ts:240`、`psi-failure-correlation-check.ts:771`、`instrument-decay-check.ts:297`。三者都是**载荷构造器**（不是裸 emitter），其末行是两种共享形状之一的副本；现全部改走共享 emitter，并改名 `printOrphanReport` / `printCorrelationReport` / `printDecayReport`，使 `printJson` 在全仓只指一件事（emitter）。
**范围上界（写明，免得被读成「这一类已清完」）**：同一扫描的**内联**形态（`console.log(JSON.stringify(` / `stdout.write(JSON.stringify`）在 `plugin/scripts` 命中约 200 处——那是另一个、大得多的类，本 finding 的 `printJson` 簇不是它；`instrument-decay-check.ts` 内剩下的内联 error-path emitter 随该类留待另案。

**派发链复核补记（2026-10-15，第二轮；上一轮 exited-not-landed 的真因）**：上一轮以 `step=suite: incomplete suite (925/925 files)` 收尾，但读 suite 日志（`.quay/fan-in-suite-gap-routine-semantic-dedup-scan-print-json-three-behaviours~wk-prod-anchor~1792034656084-e57c61.log:2176`）可见真因**不是** suite 本身，而是先行的静态闸：
`checker-mechanical-spine-check — 138 checker(s), 2 violation(s), 0 exempted`，红的正是
`guard-lineage-check.ts (json)` 与 `psi-failure-correlation-check.ts (json)`：「声称 `--json` 但无 JSON 原语」。
二者恰好是本任务把**最后一个** `JSON.stringify` 搬进共享 `printJson` 的两处（`orphan-session-check.ts` / `instrument-decay-check.ts` 尚存 error-path 内联形态，故未被触发）。静态闸 fail-closed ⇒ 测试阶段从未起跑（`terminal=0 missing=925`）⇒ 下游把它报成「suite 不完整」。
**修法**：该判据的 `emitsJsonTs` **本就**有一条「委派给 `gate-script-base.ts` 的 emitter 即算产出 JSON」的分支（`emitVerdict/emitPass/emitFail/emitNotEvaluated`，其注释点名 `gap-gate-script-base-behavior-contract-unusable` 的同一次对齐）；`printJson`/`printJsonCompact` 是同一模块新增的**同类** emitter ⇒ 补上这一支是对**误报**的修正（委派是真的：两者体内就是 `JSON.stringify`），不是放宽闸门。
⛔ 未走「把 `JSON.stringify` 塞回源文件当摆设」那条路——那是给闸门看的死 token。
新支比 `emit*` 那支更**紧**：要求 **import 自 `./gate-script-base.ts`**（并解析 `as` 别名）后才认调用，因为 `printJson` 是通用名，裸名匹配会让「本地 `printJson` 只打印人读文本」这一 **C2 本要抓的形态**漏网；该负控制已进 `plugin/test/checker-mechanical-spine-check.test.mjs`。


**Fleet 升级复核（2026-10-15，case_81318cfe801f；第三轮 exited-not-landed 的真因）**：本轮 `step=suite: oom-killed (1) — recovery exhausted at floor concurrency 32` **不是本任务 delta 的缺陷，也不是 suite 真红**，而是 OOM 恢复梯子的读取缺陷（已知形态，同批 `semantic-dedup-scan` 兄弟任务三连同因）：
- 原轮 `fan-in-step-trace.jsonl`：`suite-incomplete planned=925 terminal=925 missing=0 oomKill=1` → 梯子 64/48/32 三档全部 `recovery round had no conclusion (log-unreadable)`。
- 梯子各档日志 `.quay/fan-in-suite-…~recovery-{64,48,32}-*.log` 均为 **0 字节**（结构性：恢复命令仍 tee 进原日志、而 `spawnSuiteAndWait` 只把 stdout 写进档日志）⇒ 这是**读数不可得**，不是「该档不完整」（硬规则 3b）。
- 原日志 `.quay/fan-in-suite-gap-routine-semantic-dedup-scan-print-json-three-behaviours~wk-prod-anchor~1792035507942-bdbd92.log` 现存的是**地板档（32）的完整输出**：`SUITE-PLAN planned=925 terminal=925 missing=0 oomKill=0 laneCount=32`，`# tests 10247 / # pass 10247 / # fail 0`，静态闸 `checker-mechanical-spine-check — 138 checker(s), 0 violation(s)`（上一轮的 2 处红已由本任务的 spine 修正消除）。⇒ 地板档是一轮**完整、零 OOM、零失败**的 suite，梯子却无法认证它。
- 任务分支 `task/gap-routine-semantic-dedup-scan-print-json-three-behaviours`（tip `0f9a5ffad`，worktree 干净，仅未追踪 `.quay/` 运行时文件）代码未变；**无需改代码，重派即可**——下一轮若原轮不撞 `oomKill>0`（主机内存/swap 压力），走普通路径即可落地。
- 缺陷落点在 `worker-fan-in.ts` `recoverySuiteCommand` / `suite-driver.ts` `spawnSuiteAndWait`（报错尾注所指 `full-suite-runner.ts` 是错的文件）；⛔ 本任务不扩 Touches 去修它。
⛔ 本记录不判验收：不写 done/verifiedBy，完成由 fan-in 判。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `print-json-three-behaviours`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792033478766`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/stage-receipt.ts`
- `plugin/scripts/workflow-journal.ts`
- `plugin/scripts/guard-lineage-check.ts`
- `plugin/scripts/worktree-process-reaper.ts`
- `plugin/scripts/orphan-session-check.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/instrument-decay-check.ts`
- `plugin/scripts/checker-mechanical-spine-check.ts`
- `plugin/test/checker-mechanical-spine-check.test.mjs`
- `packages/quay/src/cli/shared.ts`
- `tasks/gap-routine-semantic-dedup-scan-print-json-three-behaviours.md`

## Blocked（人 2026-10-15 裁定：改用 depends_on 结构化阻塞，不用 needs-human）

**人指出更正**：这不该是 needs-human（人工停派）——应当用 `depends_on` 正确表达依赖关系，挂 `todo`，让既有 todo→ready 促升闸的 `depsReadinessFor` 判定自动拦住，两个真因任务落地后自动解阻塞、无需人工翻回。

- 真因①（已立案，`gap-suite-recovery-ladder-log-wiring-reads-wrong-file-always-log-unreadable`，**正在隔离 worktree 实际开发**）：OOM 低并发恢复阶梯每一档都读错日志文件，`classifyRecoveryRound` 恒报 `log-unreadable`，即便某一档其实完整、零 OOM。
- 真因②（已立案，`gap-lwa-crit-fixture-sleep300-child-not-reaped-forces-aborted-on-clean-suite`，待空闲派发槽）：`live-web-address-fixture.mjs` 的 `sleep 300` 夹具子进程未被回收，floor 档即便零 OOM 也被误判 `aborted`。
- 本任务自身的 AC/Touches 没有变化，不是因为本任务有缺陷才阻塞。
- `depends_on` 已指向上述两个任务；两者皆 `done` 后，`ready-pool-check` 的 `depsReadinessFor` 会自动判定解阻塞，促升回 `ready`，不需要人工介入。

## Blocker

**2026-10-15T05:39:22.144Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (2) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：84fa96f2-95ad-4b74-8dfb-21f75937ab4d

## Needs-Human

**执行 2026-10-15T05:39:23.235Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 3 failing lines and attributed none to a file; pseudo-stage tokens: __PERFILE__, lint; unrecognized tokens: ...); stopping instead of spending another worker session
- 失败步/判词：step=suite: oom-killed (2) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：84fa96f2-95ad-4b74-8dfb-21f75937ab4d
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-routine-semantic-dedup-scan-print-json-three-behaviours~wk-prod-anchor~1792039225310-cabaeb.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-routine-semantic-dedup-scan-print-json-three-behaviours-wk-prod-anchor.log
