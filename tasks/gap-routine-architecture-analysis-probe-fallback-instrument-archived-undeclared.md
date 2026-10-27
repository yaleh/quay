---
id: gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared
title: "architecture-analysis: Both probes still declare fallback: git-lens and
  name three scripts in plugin/scripts/ that were archived to
  archive/2026-09-07-zero-call-scripts/ and are ab"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
Both probes still declare fallback: git-lens and name three scripts in plugin/scripts/ that were archived to archive/2026-09-07-zero-call-scripts/ and are absent on disk (verified: all three MISSING), while the specs were edited 2026-09-13 and 2026-10-20 — after the archive — so a run on a host without the archguard MCP follows the declared fallback to MODULE_NOT_FOUND and emits an empty findings array, which this routine records as a genuine 'nothing found' measurement (rule 3b conflation).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793051973088` · ts `2026-10-26T21:59:33.088Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`git-lens-l-d-code-doc-ratio`、`git-lens-l-g-structural-drift`、`git-lens-l-s-behavior-variance`
- 涉及文件：
- `plugin/probes/architecture-analysis.md:31`
- `plugin/probes/architecture-analysis.md:32`
- `plugin/probes/architecture-analysis.md:33`
- `plugin/probes/semantic-dedup-scan.md:40`
- kind：`instrument-drift`
- verdict：`confirmed`

## Requested action
Repoint both probes' fallback block at live readers (phase-declare.ts takeLdFileReading for L_D, archguard-runner.ts readDirectoryCycleReading for L_G, ls-mutation-reading.ts for L_S) or set fallback: none so the driver records not-evaluated; AC = every path named in any plugin/probes/*.md fallback section exists on disk and a fixture run of it exits 0 or 1, never a module-resolution error, checked by one script in the probe routine's pre-spawn check.

## 复核（2026-10-27，派发 worker 读盘实测，⛔ 非转述）
- 三个被点名的路径在 HEAD 上全部 **MISSING**：`plugin/scripts/git-lens-l-d-code-doc-ratio.ts` / `-l-g-structural-drift.ts` / `-l-s-behavior-variance.ts`；归档副本在 `archive/2026-09-07-zero-call-scripts/plugin/scripts/` 下（`find` 逐条命中）。
- 两个探针 frontmatter 原为 `fallback: git-lens`，正文 FALLBACK 段逐字点名上述路径（`architecture-analysis.md:31-33`、`semantic-dedup-scan.md:40`）。
- `probe-routine.ts` 的 spawn 前检查此前**只**判「主仪器在不在本机」（③b，`instrumentPreflight`），**不判规格自己声明的 fallback 路径** ⇒ 归档路径不会被任何机械判定看到，空 findings 与「跑过没发现问题」同形。
⇒ finding 成立（confirmed）。成因不是「探针写错一次」，而是**声明面与磁盘之间没有判定**。

## 处置（已修）
1. 两个探针的 FALLBACK 段改为点名仓里**活着**的读取器，并把 frontmatter 的 `fallback:` 改为 `live-readers`：
   - L_D → `plugin/scripts/phase-declare.ts --ld-reading --numstat-file <f>`（`takeLdFileReading`；exit 0/1/3 三值）
   - L_G → `plugin/scripts/archguard-runner.ts --root .`（`readDirectoryCycleReading`；exit 0/1，not-evaluated 不冒充 0 环）
   - L_S → `plugin/scripts/ls-mutation-reading.ts --target … --functions … --test …`（`takeReading`；exit 0/3）
   - deep-scan 的 L_G 一并从归档路径换成 `archguard-runner.ts`；`identity-replication-check.ts` 本就存在，保留。
2. 新增 `plugin/scripts/probe-fallback-path-check.ts`：解析每个 `plugin/probes/*.md` 的 FALLBACK 段，逐条路径判 (a) 可解析（源码形态，或发布产物的 `scripts/dist/<name>.js` 同级——与 `resolveKernelSibling` 同一口径，⛔ 不让 dist 安装因「raw .ts 被 strip」而永远跑不了探针）与 (b) fixture run 可跑（`node [--experimental-strip-types] <path> --help` / `bash -n`，exit 必须 0 或 1，stderr 不得含 `ERR_MODULE_NOT_FOUND` / `Cannot find module` 等模块解析错误）。三值输出：0 合格 / 1 违规 / 3 NOT-EVALUATED（探针目录读不到或点名的探针不存在）。
3. `plugin/scripts/probe-routine.ts` 新增 **③c spawn 前检查**（紧随 ③b 仪器可用性）：调用上面那一个脚本判本条例程自己的 probe；违规 ⇒ **零 spawn** 的 `not-evaluated` fact，`fallbackPathViolations` 里逐条带 path/probe/line/reason，理由文案与「主机缺仪器」不同形（硬规则 3b）。
4. `plugin/scripts/archguard-runner.ts` 接受 `--help` 并 exit 0（原为 unknown argument ⇒ exit 2），使「所有被点名的读取器都有同一个 fixture 入口」成立，而不是给 runner 开特例。
5. 反向对照（两条，均在 `plugin/test/probe-fallback-path-check.test.mjs` 里）：把归档路径写回 FALLBACK 段 ⇒ `probe-routine` 记 not-evaluated、`spawns=0`、载体不落一条；换成活的读取器 ⇒ 正常 spawn（闸不是恒拒）。

## 验证读数（本轮实跑）
- `node --no-warnings --experimental-strip-types plugin/scripts/probe-fallback-path-check.ts --root .` ⇒ `PASS — 6 fallback path(s) across 8 probe(s) exist and pass the fixture run`（architecture-analysis: probe-fallback-path-check/phase-declare/archguard-runner/ls-mutation-reading；semantic-dedup-scan: identity-replication-check/archguard-runner；逐条 fixture exit 0，无模块解析错误）。
- `node --test plugin/test/probe-fallback-path-check.test.mjs` ⇒ 14/14 pass（含：段落式与嵌套 bullet 两种 FALLBACK 形状、blockquote 里的 `fallback:` 不算段落、`.json` 不被误读成 `.js`、存在但导入断裂 ⇒ 违规、`--no-fixture` 只判存在性、exit 2 ⇒ 违规、dist sibling 解析、两条派发接线对照）。
- `node --test plugin/test/probe-routine.test.mjs` ⇒ 32/32 pass（既有 32 条未被 ③c 改动影响）。
- 归档路径现状（本轮逐条 `[ -e ]`）：三条均 MISSING；活的读取器五条均 EXISTS。

- 该轴仍暗,理由:本任务只修「探针 fallback 路径的声明面可运行性」并加一道 spawn 前判定，未改动产品结构或产生可比的 code:doc 基线，因此没有 L_D/L_G 的新读数可记。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `probe-fallback-instrument-archived-undeclared`（routine `architecture-analysis`，runId `architecture-analysis-1793051973088`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/probes/architecture-analysis.md`
- `plugin/probes/semantic-dedup-scan.md`
- `plugin/scripts/archguard-runner.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/scripts/probe-routine.ts`
- `plugin/scripts/probe-fallback-path-check.ts`
- `plugin/test/probe-fallback-path-check.test.mjs`
- `tasks/gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared.md`
- plugin/test/quality-gate-driver.test.mjs

## Fleet 案卷回执（case_01b4d1fb570b）

- **案卷读数**（Fleet `resolution-cases.jsonl`，立案于 2026-10-27T00:43:46Z）：`caseId=case_01b4d1fb570b`，entity 即本任务，`category=worker-stall`，`class=delegate`，`classReason=ephemeral-dev-session`，案卷状态 `DELEGATED`；立案时读到的真实状态是 `status=ready`（`develop:tasks/gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared.md`，commit `580e71d80`）。
- **现场复核**（本会话读盘，⛔ 非转述）：实现已在任务分支 `task/gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared` 的 `a56d49106`（新增 `plugin/scripts/probe-fallback-path-check.ts` 与 `plugin/test/probe-fallback-path-check.test.mjs`；repoint 两个 probe 的 FALLBACK 段；`probe-routine.ts` 加 ③c spawn 前检查）；worktree 已 merge develop（`7cedfd72b`）。
- **fan-in 在飞、被锁排队**（观测于 2026-10-27T00:47Z）：`worker-driver.ts --mechanical-fan-in --task <本任务>` 进程存活（pid 585182，08:09 起），其子进程阻塞在 `flock -x`（锁文件 `.git/fan-in.lock`，持锁者是另一任务的 fan-in）⇒ 不是「worker 停了且无人接手」；⛔ 不要手工再起一条 fan-in。
- **`develop` 上尚无 `a56d49106`**，任务仍为 `status=ready`，等 mechanical fan-in 落地。
- ⛔ **不自判验收**：本记录不改 `status`、不写 `verifiedBy`；落地与完成由本项目 fan-in 判定。
- **结论**：Fleet 的 `worker-stall` 读数对应的是「worker 会话已退出、mechanical fan-in 在锁上排队」；本任务不需要新的修复，保持 `ready` 等 fan-in。

## Needs-Human

**执行 2026-10-27T01:52:52.995Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：LOOP DEADLOCK: task gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared has been blocked by the SAME pre-existing red set for 3 consecutive fan-in rounds (signature unchanged across rounds). Blocked red points: plugin/test/quality-gate-driver.test.mjs. No other task in the carrier shares this signature yet — if more arrive, they are mutually landing gates. Suggested resolution: land ANY ONE of them first (each one's own fix is outside the blocked set, so the red set does not grow); the others' blocked sets then shrink by that red point and they land in turn. If a landing still makes it worse, a human must decide the order. ⛔ The gates were NOT relaxed: every new/changed red point still hard-fails this task (baseline-equivalence exemption never covers a red the task introduced). — 停止自动重派（电路断路器：同一既存红签名连续 3 轮未变）。⛔ 判据未放宽：本次新增 / 断言文本变化的红点仍然硬红（既存红等价豁免只覆盖「不变差」的方向）。
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /fallback declared: 'git-lens'/. Input: [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/quality-gate-driver.test.mjs,plugin/test/quality-gate-driver.test.mjs changed=-]
- run_id：wk-prod-anchor
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared~wk-prod-anchor~1793059798100-508f58.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared-wk-prod-anchor.log
