---
id: gap-routine-semantic-dedup-scan-parseargs-seven-forked-loops
title: "semantic-dedup-scan: Sixteen definitions delegate to the exported base
  parseArgs while seven hand-roll forked loops with divergent input languages
  (--root= form, positional-forbidd"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Sixteen definitions delegate to the exported base parseArgs while seven hand-roll forked loops with divergent input languages (--root= form, positional-forbidden rules, Number coercion), so the shared parser is bypassed rather than extended.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792752400273` · ts `2026-10-23T10:46:40.273Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseArgs`
- 涉及文件：
- `plugin/scripts/gate-script-base.ts:165`
- `plugin/scripts/ac69-slot-queue-gap-check.ts:140`
- `plugin/scripts/outer-anchor-check.ts:391`
- `plugin/scripts/loadbearing-test-gate.ts:223`
- `plugin/scripts/guard-lineage-check.ts:476`
- `plugin/scripts/instrument-decay-check.ts:756`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-23T10:46:40.273Z

## Disposition — 修掉（七条全部收敛到共享 parser）

复核（2026-10-23，任务 worktree，fork 点 develop `06870ed54`）：finding 记录逐字核实（`findingId: parseargs-seven-forked-loops` · runId `semantic-dedup-scan-1792752400273` · `dupKind/verdict: divergent-implementation` · `suggestedAction: merge`）。计数**按位置**实测（`^(export )?function parseArgs\b` 声明 + 函数体内是否出现 `baseParseArgs(` 调用；⛔ 不按关键词）：

| 读数 | 收敛前 | 收敛后 |
|---|---|---|
| plugin/scripts 内模块级 `parseArgs` 声明 | 22 | 22 |
| 其中 base 自身（gate-script-base.ts） | 1 | 1 |
| 其中**调用**共享 parser 的薄适配器 | 14 | **21** |
| 其中手搓 token 循环 | **7** | **0** |

finding 的「16 delegate / 7 hand-roll」：7 与实测完全对上；16 按其口径含 8 个直接调用点（文件内无私有 `parseArgs` 定义），按「定义」计为 14。finding 列出的 6 条文件里，`guard-lineage-check.ts` / `instrument-decay-check.ts` **本来就是适配器**（不手搓），真正的 7 条残余是下表；两者仍纳入本轮的 family-wide ratchet。

| 文件 | 收敛前的分叉点 | 收敛后由哪个 spec 键表达 |
|---|---|---|
| ac69-slot-queue-gap-check.ts | 手搓循环；未知 flag 静默忽略 | `unknown:"skip"` |
| outer-anchor-check.ts | 手搓循环；未知 flag 静默忽略；`--help` 自管 | `unknown:"skip"` + `help:"return"` |
| loadbearing-test-gate.ts | 库形 `{error}`；`--import-root` 可重复 | `errors:"return"` + `{type:"string[]"}` |
| defect-latency-pair.ts | 库形 `{error}`；`--emit-json\|--json` 双拼写；Number 强转 | `errors:"return"` + 两个 boolean 取或；数值校验留在调用点 |
| peer-identity-probe.ts | 子命令 + 任意 `--x` 可读；`--set` 贪婪 | `minArgs:0`（cmd 作 positional）+ `unknown:"accept"` + `{greedy:true}` |
| slice-readings.ts | 库形 `Result`；禁 positional；空值即错 | `errors:"return"` + `unknown:"reject"` + 调用点显式拒绝 positional |
| suite-lpt-order.ts | `--root=` 形式；Number 静默回落默认 | 共享 parser 的 `=` arm + 调用点数值回落 |

**Part A = 空**：base 无需扩键。前三个同族任务已加的 `unknown: accept|skip|reject` / `errors:"return"` / `help:"return"` / `type:"string[]"`（greedy 与 arity-1）/ `--flag=value` arm 足以表达上述全部输入语言 —— 这正是 finding 所说「bypassed rather than extended」的另一半：能力已在，缺的是迁移。

### 可核（每条独立可复跑）
1. 计数：对 `plugin/scripts/*.ts` 逐个取模块级 `parseArgs` 声明并检查函数体内 `baseParseArgs(` ⇒ 21 适配器 + 1 base + 0 手搓。
2. ratchet：`plugin/test/gate-script-base-adoption.test.mjs` 现列 **13** 条载体（原 6 + 本轮 7），并新增**目录级**扫描 `no module-level parseArgs in plugin/scripts bypasses the shared parser` —— 不靠列表，新增的绕过方直接报红。谓词两侧都取得到值：retired fixture ⇒ `handrolled:true / delegated:false`，adapter fixture ⇒ 反向。
3. 谓词修正（实测假阳性，⛔ 不是放宽）：`defect-latency-pair.ts:206` 的 `raw.startsWith("--- ")` 是 `git show` diff 头解析，旧谓词的 `startsWith("--` 分支会把它误判成 argv 循环；已收窄为**精确** `"--"` 字面量，并以一条负控制钉住（diff 头不命中、argv `--` 前缀命中）。
4. 受影响套件实跑（本 worktree，逐文件 `node --test`）：ac69-slot-queue-gap-check / defect-latency-pair / suite-lpt-order / outer-anchor-check / slice-readings / peer-identity-probe / suite-scheduler / carrier-retention / worker-fan-in-hooks / gate-script-base(-arg-modes/-help-mode/-adoption) / outer-cron-registry / session-primitives-adoption —— 全绿。
5. `laydown-set-check.sh --list` 收敛前后同为 `scripts_derived: 124` / `tests_resolved: 229` —— 七条本就 `import` gate-script-base，无新模块边。
6. scoped 门：见下 `## Verification`（两次实跑，均 exit 0 / 315 通过 / 0 失败）。

### 输入语言差异（enumerable，⛔ 不是「行为不变」的空话）
- `--help`：loadbearing-test-gate（旧 = unknown arg，exit 2）、defect-latency-pair（旧 = unknown flag，exit 2）、suite-lpt-order（旧 = 忽略后继续读 stdin）⇒ 现统一走共享 help 契约（usage + exit 0）。库形 parser 本身仍不 `process.exit`（`help:"return"` + 调用方 `main` 打印）。
- `reject` 三处的未知 flag 报文由 `unknown flag --x` 变为共享的 `unknown argument: --x`（退出码不变）。
- 尾部无值的 string flag 读作 `""`，**不折叠成默认值**（硬规则 3b）；数值 flag 仍按旧语义报错（`--sample needs a number`）。

## Verification
实跑读数（全部在本任务 worktree 内）：

- 实现提交：`7aabc3951`（semantic-dedup-scan: converge the seven residual hand-rolled parseArgs loops），9 个文件，全部在 `## Touches` 内。
- scoped 门（与 fan-in 同一条）：`bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-parseargs-seven-forked-loops --allow-thin`
  - 第一次（develop `d02b5357b`）：**exit 0 · tests 315 · pass 315 · fail 0**
  - 第二次（并入 develop `fc17b0ca2` 后）：**exit 0 · tests 315 · pass 315 · fail 0**
  - 两次之间 develop 前进的只有一个**他人的任务文件**（`tasks/gap-routine-architecture-analysis-dup-discovery-module-loader.md`）；`git diff --stat <第一次门后的树>..HEAD -- . ':!tasks'` 为空 ⇒ 代码面与被门过的树逐字节相同。
- 收尾反漂移硬闸：`anti-drift-touches-check.ts --task … --worktree … --merge-target develop` ⇒ **ANTI-DRIFT OK: 9 actual file(s), all within declared Touches (12 glob(s))**，exit 0。
- scoped 门缓存：`worker-driver.ts --write-scoped-gate-cache` ⇒ `{"event":"scoped-gate-cache-written","developSha":"fc17b0ca2e1d7e6b4553f4f0cdbce626cef92890"}`。
- AC/DoD 闸：`task_check` ⇒ `ok:true, acTotal:2 acChecked:2, dodTotal:2 dodChecked:2`。

### 续做轮（2026-10-23，全量 suite 四个 rung 全 OOM 之后）

前置状态：分支此前已有 4 个提交、AC 2/2；上一轮 `exited-not-landed` 的原因是 fan-in 全量 suite `oom-killed`。本轮**不重做实现**，只复核与收尾：

- 并入 develop `969e2a308`（合并提交 `f1c2af6ce`，**0 behind / 5 ahead**，无冲突、无未合并路径）；代码面 diff 仍是原来那 9 个文件，全部在 `## Touches` 内。
- scoped 门第三次（develop `969e2a308`）：**exit 0 · tests 315 · pass 315 · fail 0**。
- 反漂移硬闸：**ANTI-DRIFT OK: 9 actual file(s), all within declared Touches (12 glob(s))**，exit 0。
- scoped 门缓存：`{"event":"scoped-gate-cache-written","developSha":"969e2a308aac28273dc02d96e70360261c43b20a"}`。
- `task_check` ⇒ `ok:true, acTotal:2 acChecked:2, dodTotal:2 dodChecked:2`。

**全量 suite 红的归因（读 4 个 rung 日志 + 逐文件隔离复跑，⛔ 不是「与本任务无关」的空话）**

1. **OOM 是承载资源问题，不是本任务 delta**：四个 rung（126 探针 / 64 / 48 / 32）的 `oomKill` 依次为 3 / 2 / 1 / 1；
   `suite-memory-evidence-*.json` 读数 `peakBytes=34360000512` 对 `memoryMaxBytes=34359738368`（32 GiB 声明预算，`bound:declared`），
   `memoryTelemetry.statMax.anonBytes=33517527040`。floor rung `laneCount=32` 时 `maxConcurrentOverall` 仍为 **48**
   （调度器的 reliability cap 压住总数）⇒ **降低 rung 并不降低实际并发**，恢复阶梯在本机structurally 无法退出 OOM。
   该缺口已有独立任务在管（`gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable` / `gap-full-suite-runner-dedupe-memory-envelope-to-probe`），
   修复点在 `full-suite-runner.ts` / 调度器，**不在本任务 `## Touches`**。
2. **delta-unrelated 红逐个隔离复核**（本 worktree，`node --test --test-concurrency=1 <file>`）：
   - `packages/quay/test/npm-pack-e2e.test.mjs`：**11/11 绿** ⇒ 负载诱发 flake。
   - `plugin/test/shipped-set.test.mjs`：**11/11 绿** ⇒ 负载诱发 flake。
   - `plugin/test/task-granularity-advice.test.mjs`：AC6 生产臂**隔离下仍红** —— 该臂读**主检出**的 `.quay/worker-outcome.jsonl`（`MAIN_CARRIER`，worktree 按设计不接收它）⇒ 数据配额型 develop-wide 红。
   - `plugin/test/needs-human-parking-recheck.test.mjs`：AC1 **隔离下仍红** —— `the real board carries needs-human tasks (got 0)`，同为主检出实时板态的数据型红。
   两条都不是本任务 9 文件 delta 造成的（delta-relatedness 机检亦为 UNRELATED，且一阶导入不相交）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `parseargs-seven-forked-loops`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792752400273`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## ADR-007 dark axis
- 该轴仍暗,理由:本轮只把 7 个调用方的 argv 解析改调既有的 gate-script-base.parseArgs，模块依赖边一条未增未减（七条本就 import 该文件），L_D/L_G 对该改动不敏感，取不到有意义的读数。

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/ac69-slot-queue-gap-check.ts`
- `plugin/scripts/outer-anchor-check.ts`
- `plugin/scripts/loadbearing-test-gate.ts`
- `plugin/scripts/guard-lineage-check.ts`
- `plugin/scripts/instrument-decay-check.ts`
- `plugin/scripts/defect-latency-pair.ts`
- `plugin/scripts/peer-identity-probe.ts`
- `plugin/scripts/slice-readings.ts`
- `plugin/scripts/suite-lpt-order.ts`
- `plugin/test/gate-script-base-adoption.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-parseargs-seven-forked-loops.md`

## Blocker

**2026-10-23T12:36:30.944Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (3) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：7ffa8463-3e90-4625-ab4c-a3625042fd52
- 复核（本轮）：该 blocker 仍未解除，且已定位为**共享承载资源 + 恢复阶梯不降实际并发**的独立机制缺口（见上节），不是本任务 delta；本任务的 scoped 门 / 反漂移 / AC-DoD 三项均已绿。
