---
id: gap-routine-quota-consumer-convergence
title: routine 限流②：probe-routine.ts / meta-driver.ts 真实调用点收敛到独立 Policy 函数 +
  真实全局天花板生效（依赖①落地）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-routine-quota-canonical-config-and-policy-gate
---
**type:** execution

## Proposal

`gap-routine-quota-canonical-config-and-policy-gate` 落地了配置面 + 独立纯 Policy 函数（`routineQuotaDecision`），但过渡期把 `globalCeiling` 硬编码为 `Infinity`，保证那一步零行为改变。本任务是**真正的 consumer convergence**：让两个真实调用点（`probe-routine.ts`/`meta-driver.ts`）都换成读配置得到的**有限**全局天花板，并证明"全部 consumer 真正收敛"而不是"接了线但只有一个用"（搬壳陷阱，`docs/references/ownership-first-refactoring-methodology.md` §2 的三条判据——单一定义处、调用方真的改口、新实现不反向依赖旧写原语）。

**⛔ 明确排除**：不碰"历史立案计数 vs 板压力"的混淆（同上一个任务，仍是独立待裁定问题）；不重启生产 driver 进程。

## Plan

1. **`plugin/scripts/probe-routine.ts`**：`selectFilings`（消费 `countRecentFilings`/`gateFinding` 的真实调用点）改为：① 用 `routineK(root, routine)`（上一任务新增）替代硬编码/透传的 `DEFAULT_RATE`；② 额外读一次 `countRecentFilings(carrier, now, window, null)`（全局汇总，已有能力，只是没被消费）；③ 把 `{perRoutine, global}` 一并喂给 `routineQuotaDecision`（不再调 `gateFinding` 里那条过渡期 `globalCeiling:Infinity` 的硬编码路径——即 `gateFinding` 本身此时应接一个新的可选参数,或本调用点直接调 `routineQuotaDecision` 后再走 `gateFinding` 原有的 quality/dedup 两道闸，具体接法由实现者选，但**两道闸的执行顺序不能变**：quality → dedup → rate/global-rate，顺序错了会把"重复"误判成"超额"或反之）。
2. **`plugin/scripts/meta-driver.ts`**：`driveItems` 里 `gateFinding(... { existingKeys: [], recentCount: filed, K: opts.cap })` 这一调用同样接上真实全局读数——⚠️ 注意 `recentCount: filed` 当前传的是**本轮函数内局部计数**（不是跨轮读 carrier），核实它与 `probe-routine.ts` 的 `recentCount` 语义是否一致（若不一致，必须在本任务里写清楚两条调用链各自喂的是什么量，⛔ 不能假装两者同构）；全局读数接法与①一致。
3. **两个调用点的 routine 命名口径对齐一个已发现的既存分歧（供本任务记录，择一处理）**：`probe-routine.ts` 走 `fileRoutineTask(..., ["gap","routine-filed", decl.name], ...)` 的标签含 routine 名；`meta-driver.ts` 的 `createAutoDriveTask` 走 `createTask(root, id, item.title, ["meta-driver","driver-candidate"], body)`，**不带 routine 名标签**。全局计数不受此影响（`countRecentFilings` 读的是 `.quay/routine-findings.jsonl` 的 `filing-round` 记录而非任务标签），但若后续要做"按 routine 名查询真实在办任务数"（即被明确列为下一步待裁定的板压力问题），这条标签分歧会挡路。**本任务只需记录该分歧（写进 `## Evidence`，引用具体行号），不要求本任务修它**——那是板压力设计任务的前置输入，不是本任务范围。

## Acceptance Criteria

- [x] `probe-routine.ts` 真实调用 `routineK`/`routineQuotaDecision`（grep 到真实调用，非仅 import）；旧的 `DEFAULT_RATE` 硬编码在该调用路径上消失（`grep -n "DEFAULT_RATE" plugin/scripts/probe-routine.ts` 的命中要么为 0，要么只剩无关用途，须在 Evidence 里逐条交代每个剩余命中）
- [x] `meta-driver.ts` 同上，`driveItems` 真实调用新 Policy 路径
- [x] **真实全局天花板生效的取假（核心判据）**：构造一个 fixture（`.quay/routine-findings.jsonl` 等效临时载体），两个不同 routine 各自远低于自己的 per-routine K，但**合计**触及 `global_ceiling`（如 `drivers.yml` 测试 fixture 设 `global_ceiling: 4`，routine A 填 2、routine B 填 2）⇒ 第三个候选（无论来自 A 还是 B）必须被 `global-rate:` 拒绝，即便发起方自己的 per-routine 窗口远未满——这正是人裁定③要堵的"K×R 无上限增长"场景，必须用真实调用链（不是单测直接调 `routineQuotaDecision`，上一个任务已经测过那个）复现
- [x] 正反对照：同一 fixture，把 `global_ceiling` 调大到不会被触及的值（如 100）重跑 ⇒ 第三个候选被接受——证明红不是闸恒红
- [x] 两条调用链的 `recentCount`/本轮计数语义差异（Plan 第②点）已在 `## Evidence` 写明且不是靠猜测——读两处实际代码逐行核对
- [x] 回归：`plugin/test/probe-routine.test.mjs`、`plugin/test/meta-driver.test.mjs`、`plugin/test/quality-gate-driver.test.mjs`、`plugin/test/routine-file-gate.test.mjs`、`plugin/test/driver-config.test.mjs` 全绿
- [x] ⛔ 本任务不重启任何生产 driver 进程；如果实现过程中判断需要重启生产 driver 才能生效，必须在任务体里**只报告**准备情况与影响（哪个 driver、读哪个配置、重启后行为会怎样变化、当前生产読数现状），**不执行重启**，交回给调用方（待外部裁定，本任务不得自行重启）

## Evidence

### AC1 — `probe-routine.ts` 的真实调用点（grep 到真实调用，非仅 import）

真实调用（3 处，行号为改动后）：

- `L454` `routineQuotaDecision({ perRoutine: recentBase + acceptedThisRound, global: globalBase + acceptedThisRound }, { k: o.k, globalCeiling: o.globalCeiling ?? Infinity })` —— `selectFilings` 内核，把 `{perRoutine, global}` 一并喂给独立 Policy 函数。
- `L448` `countRecentFilings(o.carrierPath, o.nowMs, FILING_WINDOW_MS, o.routine)` —— per-routine 窗口（既有）。
- `L450` `countRecentFilings(o.carrierPath, o.nowMs, FILING_WINDOW_MS, null)` —— **全局**窗口合计（本任务新增读数）。
- `L981` `k: opts.filingRate ?? routineK(opts.root, decl.name)`、`L982` `globalCeiling: routineGlobalCeiling(opts.root)` —— 生产调用点从 `drivers.yml` 的 `routine_quota` 段读出真实 K 与有限全局天花板。

`grep -n "DEFAULT_RATE" plugin/scripts/probe-routine.ts` 剩余命中 = **3 条，全部是注释，无一处可执行引用**（逐条交代）：

1. `L77` —— import 块的说明注释「⛔ 不再用 routine-file-gate 的孤儿字面量 DEFAULT_RATE 兜底」。
2. `L364` —— `FilingOptions.k` 的文档注释「⛔ 不再是孤儿字面量 DEFAULT_RATE」。
3. `L980` —— 生产调用点的行内注释「⛔ 不是孤儿字面量 DEFAULT_RATE」。

⇒ import 已删除（`DEFAULT_RATE` 不再从 routine-file-gate.ts 引入 probe-routine.ts）；调用路径上的硬编码消失。

### AC2 — `meta-driver.ts` 的真实调用点

`driveItems`（`plugin/scripts/meta-driver.ts`）真实调用新 Policy 路径：

- `L1772` `const globalBase = countRecentFilings(carrierPath, nowMs, FILING_WINDOW_MS, null)` —— 全局窗口合计，读**同一载体** `<root>/.quay/routine-findings.jsonl`（路径常量 `ROUTINE_FINDINGS_REL` 从 probe-routine.ts 单一来源引入，⛔ 不硬写字面量）。
- `L1773` `const globalCeiling = routineGlobalCeiling(root)` —— 有限全局天花板，`drivers.yml` 单一来源。
- `L1798-1801` `routineQuotaDecision({ perRoutine: filed, global: globalBase + filed }, { k: opts.cap, globalCeiling })`，结果交给 `gateFinding(candidate, { existingKeys: [], quota })` —— 闸序仍为 quality → dedup → rate/global-rate（由 `gateFinding` 保持）。

`gateFinding` 新增可选参数 `quota`（`plugin/scripts/routine-file-gate.ts:277`）：缺省 `null` ⇒ 逐字保留迁移期行为（`global = recentCount`、`ceiling = Infinity` ⇒ 全局分支恒不触发），故所有既有调用方（`fileProposals` L1165、routine-file-gate.mjs CLI L1125、全部既有单测）行为逐字节不变。

### AC3/AC4 — 真实调用链上的全局天花板取假（核心判据）

测试：`plugin/test/probe-routine.test.mjs` 的 `FILING QUOTA AC3` / `FILING QUOTA AC4`（夹具工厂 `makeGlobalCeilingWorkspace(globalCeiling)`，经 `llmProbeRoutine` 的**真实调用链**——`llmProbeRoutine → selectFilings → routineQuotaDecision → gateFinding`，⛔ 不是直接调纯函数）。

夹具（两臂逐字相同，只有 `global_ceiling` 变）：临时 workspace + `plugin/scripts/drivers.yml`（`routine_quota`）+ 预填载体 `.quay/routine-findings.jsonl`，两条 `filing-round` 记录：routine `freshness-refresh` 立案 2 条、routine `semantic-dedup-scan` 立案 2 条（ts 落在窗口内）。

- **AC3 臂**：`global_ceiling: 4`。夹具自检真实读数（非猜测）：`routineGlobalCeiling(root)=4`、`routineK(root,"freshness-refresh")=min(default_k=3,4)=3`、per-routine 窗口 `=2`（< K）、全局合计 `=4`（≥ ceiling）。⇒ 第三个候选（freshness-refresh 的 finding）被拒，`written.length=0`；载体 `filing-round.rejected[0]` 为 `gate="quality-dedup-rate"` 且 reason 匹配 `/global-rate:/`（⛔ 与 per-routine 的 `rate:` 不同形，硬规则 3）。
- **AC4 臂**：`global_ceiling: 100`（唯一变化）。同一夹具 ⇒ 同一候选被**接受**（`written.length=1`，`filing-round.filed.length=1`）——证明 AC3 的红不是闸恒红。

meta-driver 对应臂（AC2 取假）：`plugin/test/meta-driver.test.mjs` 的 `driveItems AC2 (red)` / `(green control)`，同款载体 + `drivers.yml`，红臂拒绝理由匹配 `/global-rate:/`、绿臂接受。

### AC5 — 两条调用链的 `recentCount`/本轮计数语义差异（逐行核对，⛔ 非猜测）

**两条链喂进 `routineQuotaDecision` 的 `perRoutine` 量来源不同**：

- `probe-routine.ts` `selectFilings`（`L448`/`L455`）：`recentBase = countRecentFilings(carrier, now, window, o.routine)` —— **跨轮读载体**（`.quay/routine-findings.jsonl` 中本例程自己的 `filing-round.filed` 尾窗合计），再加 `acceptedThisRound`（本轮已接受数，因本轮 `filing-round` 记录要在 `selectFilings` 返回后才 append）。
- `meta-driver.ts` `driveItems`（`L1798`）：`perRoutine: filed` —— **本轮函数内局部计数**（`driveItems` 循环里的 `filed++`），**不读载体**。同名不同量，本任务如实记录，⛔ 不假装同构。

**`global` 一侧两链同构**：都 = `countRecentFilings(carrier, now, window, null)`（同一载体、跨 routine 汇总）**再加本轮已接受/已驱动数**（probe-routine：`+acceptedThisRound` L455；meta-driver：`+filed` L1799）。meta-driver 本轮立案不写该载体（autoDrive 任务标签为 `["meta-driver","driver-candidate"]`，⛔ 非 `routine-filed`），故只有本地 `+filed` 能把本轮自身计入全局——与 probe-routine 的 `+acceptedThisRound` 形状一致。

### Plan 3 — 两个调用点的 routine 命名口径分歧（本任务只记录，⛔ 不修）

- `plugin/scripts/probe-routine.ts:1011`：`fileRoutineTask(opts.root, …, ["gap", "routine-filed", decl.name], tasksDir, escalateStatus)` —— 标签含 **routine 名**。
- `plugin/scripts/meta-driver.ts:1755`：`createTask(root, id, item.title, ["meta-driver", "driver-candidate"], body)`（`createAutoDriveTask` 调用点）—— **不带 routine 名标签**。

全局计数不受此分歧影响（`countRecentFilings` 读载体的 `filing-round` 记录，⛔ 不读任务标签）；但要做「按 routine 名查询真实在办任务数」（板压力设计任务）时这条标签分歧会挡路——**记录在案，作为该设计任务的前置输入**。

### AC6 — 回归

`node --experimental-strip-types --test plugin/test/probe-routine.test.mjs plugin/test/meta-driver.test.mjs plugin/test/quality-gate-driver.test.mjs plugin/test/routine-file-gate.test.mjs plugin/test/driver-config.test.mjs` ⇒ **tests 219 / pass 219 / fail 0**。另 `npx tsc --noEmit` exit 0；`plugin/scripts/import-graph-check.ts` PASS（valueSccs=0，新增的 meta-driver→probe-routine 边未引入环）。

### AC7 — 生产 driver 未重启（只报告准备情况与影响，⛔ 已遵守）

**未执行任何 driver 重启**。以下为生效条件与影响（交回调用方裁定）：

- **哪个 driver**：`quality-gate-driver`（宿主 `probe-routine.ts` 的例程轨道）与 `meta-driver`。两者都是常驻进程，**改动在重启后才加载**（模块在进程启动时求值）。
- **读哪个配置**：`plugin/scripts/drivers.yml` 的 `routine_quota` 段（`global_ceiling: 12`、`default_k: 3`、`window_ms: 86400000`），经 `driver-config.ts` 的 `routineK` / `routineGlobalCeiling` 读取。
- **重启后行为会怎样变化**：routine 立案与 meta-driver autoDrive 额外受**跨 routine 全局天花板 12 / 24h** 约束（此前该维度恒 `Infinity`，结构性不可能触发）。低于天花板时行为不变。
- **当前生产读数现状**（`2026-10-09T02:04Z` 实测，读主检出 `.quay/routine-findings.jsonl`）：24h 窗口内 `filing-round` 12 条、全局 filed 合计 **3**（< ceiling 12）⇒ 重启后**无立即行为变化**；per-routine：`semantic-dedup-scan=3`（= default_k 3，已达自身 K）、`freshness-refresh=0`。
- **残留（观察项，非本任务范围）**：`drivers.yml` 的 `window_ms` 段目前仍不被运行时消费（`selectFilings` 用模块常量 `FILING_WINDOW_MS`，由其缺省常量派生，值相同 24h）——若未来调 `window_ms` 需单独接线，与本任务的 K/天花板收敛无关。

## Definition of Done

两个真实生产调用点（`probe-routine.ts`/`meta-driver.ts`）都已收敛到同一个独立 Policy 函数，全局天花板在真实调用链上可被真实触发（非仅单元测试里的纯函数调用），既有测试全绿，生产 driver 进程未被重启（若需要重启，报告而非执行，等待裁定）。

## Test-Files

- plugin/test/probe-routine.test.mjs
- plugin/test/meta-driver.test.mjs
- plugin/test/quality-gate-driver.test.mjs
- plugin/test/routine-file-gate.test.mjs
- plugin/test/driver-config.test.mjs

## Touches

- plugin/scripts/probe-routine.ts
- plugin/scripts/meta-driver.ts
- plugin/scripts/routine-file-gate.ts
- plugin/scripts/drivers.yml
- plugin/test/probe-routine.test.mjs
- plugin/test/meta-driver.test.mjs
- tasks/gap-routine-quota-consumer-convergence.md
