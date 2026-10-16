---
id: gap-routine-semantic-dedup-scan-list-script-basenames-diverged-under-one-name
title: "semantic-dedup-scan: Identical bodies under one name, but one filters on
  EXEC_EXTENSIONS (.ts .sh .mjs .js .cjs .bash) and the other on
  SCRIPT_EXTENSIONS (.ts .sh .mjs), so the two"
status: todo
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
Identical bodies under one name, but one filters on EXEC_EXTENSIONS (.ts .sh .mjs .js .cjs .bash) and the other on SCRIPT_EXTENSIONS (.ts .sh .mjs), so the two same-named enumerators return different sets and any consumer swapping them silently loses .js/.cjs/.bash scripts.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792033478766` · ts `2026-10-15T03:04:38.766Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`listScriptBasenames`
- 涉及文件：
- `plugin/scripts/outer-retirement-precondition-check.ts:112`
- `plugin/scripts/registry-bare-filename-scan.ts:200`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge

## Disposition（复核结论：**已修掉**，不是「已注意到」）

**复核**：finding 描述属实，且这是**同一判定的第二轮**——更早一轮以
`list-script-basenames-divergence`（runId `semantic-dedup-scan-1791238550062`）报过同一对，当时未被立案。
两个 `listScriptBasenames` 本体逐字节相同（`readdirSync(dir,{withFileTypes:true})` + `isFile()` + 扩展名过滤 +
`sort()`），只有谓词不同 ⇒ **一个名字两个答案**。实测本仓：`EXEC_EXTENSIONS`（6 扩展）得 384 个 basename，
本地 `SCRIPT_EXTENSIONS = {.ts,.sh,.mjs}` 得 381 个，差集恰是三个 `.cjs`
（`checked-in-write-guard.cjs` / `checked-in-write-run.cjs` / `suite-fs-trace-preload.cjs`）。
另外 `outer-retirement-precondition-check.ts` 那份副本的 JSDoc 自称「`.ts/.sh/.mjs`」，代码却按 6 扩展过滤
—— **注释断言的同一性不是同一性**（同 `gap-routine-semantic-dedup-scan-concurrency-parse-divergence` 的形态）。

**处置（requested action: merge → 合并成单一定义）**：
- `plugin/scripts/fs-walk.ts` 导出**唯一定义** `listScriptBasenames(root)`（该 leaf 本就持有 `EXEC_EXTENSIONS`）。
  `SCRIPTS_DIR_REL` 同样两份逐字相同，一并上收。
- `plugin/scripts/outer-retirement-precondition-check.ts` / `plugin/scripts/registry-bare-filename-scan.ts`
  改为 `import` + `re-export`，⛔ 不再有本地副本。
- 上收后 `plugin/scripts` 里 `readdirSync(...withFileTypes...)+extname` 形式的枚举只剩 `fs-walk.ts` 一处。

**谓词取宽的（`EXEC_EXTENSIONS`）是实测判据，不是偏好**：本轮先量了三件事，再决定合并到哪一边——
1. 差集只有 3 个文件，全是 `.cjs`（本仓确有此类脚本）；
2. 对退役检查器**完全无影响**：执行核在两种谓词下引用的脚本集合都是同一批 28 个（实跑 `referencedScripts` 两侧比对），
   故该检查器任何判词都不动；
3. 对死集扫描器是**无害且更完整**：三个 `.cjs` 全都有引用者（`checked-in-write-check.ts` / `suite-fs-trace.ts`，
   其中两个还有 test-pin），把 universe 放宽后是 **+3 kept / +0 dead**（实跑 `computeKept` 前后对照：dead 计数两侧都是 21）。
⇒ 窄谓词什么也没换来，却把一个本仓真实存在的脚本类挡在**完备性仪器**的 universe 之外（硬规则 5：来源不完备时
「搜不到」≠「不存在」）。故按 fs-walk.ts 自己的规矩——**集合只有在调用方策略真的不同时才留作参数**
（`collectShellScripts` 的 skip-set 是那种情形），这两个调用方不是。

**判据（能取假，实跑过）**：`plugin/test/list-script-basenames-single-source.test.mjs`，5 条断言 ——
① 两侧 re-export 的 `listScriptBasenames` **恒等于** `fs-walk.ts` 的同一函数对象（同一性）；
② 按**位置**扫 `plugin/scripts/*.ts`：定义点恰为 1 处（`fs-walk.ts`），谓词对「真定义」命中、对「同一段文本在注释里」不命中
（硬规则 2 两半都做）；
③ 本仓真样本：三个 `.cjs` 必须在 universe 里（0 命中 = 谓词写错，⛔ 不是「无此脚本」），并带 `.md` 排除 / 非递归对照；
④ fixture 谓词控制：`.cjs/.ts/.sh/.mjs` 进、`.md/.json` 出、子目录不下降，且**空目录返回 ∅**（反方向负控制，
否则「含 .cjs」可被一个恒真谓词满足）；
⑤ **运行时臂（读生产载体）**：真 spawn 两个 checker 的 CLI，对一个**唯一脚本是 `foo.cjs`** 的 fixture ——
`registry-bare-filename-scan --scan --json` 的 `scriptCount` 必须 = 1、退役检查器必须 exit 0 且
`referencedCount` = 1、`orphanNonCheckers` 逐字含 `foo.cjs`；同一条码路在**无脚本** fixture 上读数为
`scriptCount 0` / exit 3（NOT-EVALUATED）—— 这一对才证明读数跟着输入走，而不是结构上必然为真。
**负控制实跑**：把谓词改回 3 扩展 ⇒ ③④⑤ 变红（①② 仍绿，它们查的是同一性/定义点数，不查谓词）；
`cp` 备份复原后 md5 一致（`213da5cc47fa2cb2abeb3eece09da18a`），5/5 复绿。
**回归**：`--check`（`run_checker` 生产调用点）exit 0；退役检查器 `referencedCount=28 / checkerCount=9 / ok=true`；
`fs-walk` + `registry-bare-filename-scan` + `outer-retirement-precondition-check` + `source-text-lib` 四个既有测试文件 83/83 绿。

**5b 扫描（同原则的其它落点）**：修完在**同一载体**（`plugin/scripts/`）重扫「同名/同骨架的枚举器」——
`readdirSync(...withFileTypes...)` + `path.extname(e.name)` 形式的脚本枚举**还剩 0 处同名副本**：
`fs-walk.ts:350` 是本次唯一源；`fs-walk.ts:239` 是 `walkFiles` 内部按传入的 `classify` 取扩展（走树本体）；
`registry-bare-filename-scan.ts:243` 走的是调用方传入的 `exts` 参数（载体枚举，非同名孪生）。
其它本地扩展集常量（`CODE_CARRIER_EXTENSIONS` / `SCAN_EXTENSIONS` / `WORKFLOW_EXTENSIONS`）各只有一份、
回答的是不同问题，不在本 divergence 类内。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `list-script-basenames-diverged-under-one-name`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792033478766`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/fs-walk.ts`
- `plugin/scripts/outer-retirement-precondition-check.ts`
- `plugin/scripts/registry-bare-filename-scan.ts`
- `plugin/test/list-script-basenames-single-source.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-list-script-basenames-diverged-under-one-name.md`

## Blocked（人 2026-10-15 裁定：改用 depends_on 结构化阻塞，不用 needs-human）

**人指出更正**：这不该是 needs-human（人工停派）——应当用 `depends_on` 正确表达依赖关系，挂 `todo`，让既有 todo→ready 促升闸的 `depsReadinessFor` 判定自动拦住，两个真因任务落地后自动解阻塞、无需人工翻回。

- 真因①（已立案，`gap-suite-recovery-ladder-log-wiring-reads-wrong-file-always-log-unreadable`，**正在隔离 worktree 实际开发**）：OOM 低并发恢复阶梯每一档都读错日志文件，`classifyRecoveryRound` 恒报 `log-unreadable`，即便某一档其实完整、零 OOM。
- 真因②（已立案，`gap-lwa-crit-fixture-sleep300-child-not-reaped-forces-aborted-on-clean-suite`，待空闲派发槽）：`live-web-address-fixture.mjs` 的 `sleep 300` 夹具子进程未被回收，floor 档即便零 OOM 也被误判 `aborted`。
- 本任务自身的 AC/Touches 没有变化，不是因为本任务有缺陷才阻塞。
- `depends_on` 已指向上述两个任务；两者皆 `done` 后，`ready-pool-check` 的 `depsReadinessFor` 会自动判定解阻塞，促升回 `ready`，不需要人工介入。

## Blocker

**2026-10-15T06:07:57.956Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (1) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：6635aec1-549b-42ff-ad59-dc26098af244

## Needs-Human

**执行 2026-10-15T06:07:59.057Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 3 failing lines and attributed none to a file; pseudo-stage tokens: __PERFILE__, lint; unrecognized tokens: ...); stopping instead of spending another worker session
- 失败步/判词：step=suite: oom-killed (1) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：6635aec1-549b-42ff-ad59-dc26098af244
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-routine-semantic-dedup-scan-list-script-basenames-diverged-under-one-name~wk-prod-anchor~1792040372743-b70c82.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-routine-semantic-dedup-scan-list-script-basenames-diverged-under-one-name-wk-prod-anchor.log
