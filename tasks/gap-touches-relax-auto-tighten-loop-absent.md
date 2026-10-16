---
id: gap-touches-relax-auto-tighten-loop-absent
title: 放宽派发的合并成本自动收紧闭环不存在：超阈值不写 relax_halted、样本不足/阈值未配置不分态、round 记录不留痕（GOAL-037
  AC-367 收尾面）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-relaxed-dispatch-ledger-and-merge-cost-report-absent
  - gap-touches-relax-live-semantics
  - gap-touches-relax-config-block-unread-unvalidated
goal_ac: AC-367
---
**type:** execution

## Proposal

**缺口（GOAL-037 的收尾面：合并成本做成受控预算，而不是一次性放开）**：自动收紧闭环在代码里不存在——放宽派发一旦生效，**没有任何机制在「放宽比不放宽多花太多」时把它收回来**。`plugin/scripts/` 全文 grep `relax_halted` / `auto_tighten` **零命中**。AC-363 只建了账本与报告（**读数**），AC-366 只建了 live 放行（**动作**）——**读出来之后没人判、没人写控制态、没人留痕**。没有本条，放宽是一个单向棘轮：可放开、不可收回。这是硬规则 4 推论三的形态：AC-363 的量被造出来却没有消费者。

**为什么阈值与最小样本数不在本条设定**（GOAL-037 立案的正面要求）：现在**没有放宽样本**（`mode` 默认 off，quay 自身不启用），凭空设一个阈值就是硬规则 12 禁止的「凭空设前置」。所以本条只落地**机制**（读配置 → 判定 → 写控制态 → 留痕），取值由人在 AC-362 的数据与影子期读数出来后填进配置。

**机制现状（读代码得出，非推断）**：
- **控制态单一真相源** = `packages/quay/src/kernel/control-state.ts`：`ControlState { halted, halted_by, halted_at, preference, forced }`、`readControlState(root, env, rel)` / `writeControlState(root, state, rel)`（`writeJsonAtomic` 原子写）/ `isHalted`，经 `plugin/scripts/driver-shared.ts` re-export（`export *`）。读失败/解析失败 **fail-closed**（`halted=true`，硬规则 3b）。载体 `.quay/worker-control.json` **已登记**在 `docs/carrier-registry.json:545` 与 `.gitignore:148` —— **复用 ⇒ 不新造载体、不动忽略表与登记表**（这正是 AC-367(b)「沿用 .quay/worker-control.json 一类的控制状态机制，不新造哨兵文件」）。
- **round 载体** `.quay/worker-round.jsonl` 的记录由 `computeWorkerRoundRecord`（`plugin/scripts/worker-driver.ts:1852`）产生，文件里已有成文约定：**`null` = 本轮没跑该步，对象 = 跑了并带读数**（`supersededReclaim` / `pushLag` / `releaseBranchJanitor` 三处先例，⛔ 两者不得同形）。「在 round 记录里留痕原因与读数」就落在这里，⛔ 不新造第二个载体。
- **两个词表不得互串**：`mechanical_fan_in.step`（`merge-develop` / `suite` / `ff`）与 `mechanical_fan_in.outcome`（`landed` / `red`）是**两个**词表，`worker-driver.ts:475-505` 记录过 `landed` 被写进 `final_state` 的实测事故（吞吐读数变 0 且与「系统停摆」同形）。
- **配置块**由 AC-364 的 `plugin/scripts/touches-relax-config.ts` 读（`readTouchesRelaxConfig` / `parseTouchesRelaxSection` / `loadTouchesRelaxConfig`）。本条**只扩**它的 `auto_tighten` 子块，⛔ **不写第二个读取器**（AC-364 已明写「不引入拒绝未知键」，扩块不与其任何 AC 冲突）。
- **live 放行语义**由 AC-366 落在 `driver-filters.ts` 的 `touchesDisjointOrAged` 的 `mode === "live"` 分支；AC-367(c)「relax_halted 为真时谓词在 live 下也保持阻塞」是在那条分支上加一个每轮一次读到的闸。

<!-- dedup-ref --> 追踪与去重结论（机制去重已做，非症状去重）：`task_list` 全量检索 + `tasks/` 逐条 `grep '^goal_ac:'` **没有任何一条声明 `goal_ac: AC-367`**；同 goal 已立案的五条分别声明 AC-362 / AC-363 / AC-364 / AC-365 / AC-366，验收对象是观测面 / 账本报告面 / 配置面 / off-shadow 谓词面 / live 放行面，**都不做合并成本判定、不写控制态、不留 round 痕迹**。合并候选检查用现成机件跑过：`node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches plugin/scripts/touches-relax-tighten.ts --touches plugin/scripts/touches-relax-config.ts --touches plugin/scripts/driver-filters.ts --touches plugin/scripts/worker-driver.ts --touches plugin/scripts/relaxed-dispatch-ledger.ts --touches packages/quay/src/kernel/control-state.ts --touches plugin/scripts/capability-catalog-declarations.json --touches plugin/test/touches-relax-auto-tighten.test.mjs --touches tasks/gap-touches-relax-auto-tighten-loop-absent.md --json` ⇒ `peers: [gap-relaxed-dispatch-ledger-and-merge-cost-report-absent（共享 relaxed-dispatch-ledger.ts）、gap-touches-relax-config-block-unread-unvalidated（共享 touches-relax-config.ts）、gap-touches-relax-live-semantics（共享 driver-filters.ts + worker-driver.ts）、gap-touches-relax-off-parity-predicate（共享 driver-filters.ts）、gap-worker-round-filter-trace-attribution（共享 driver-filters.ts + worker-driver.ts）]`、`mentions: [同上四条]`。判定 **separate（独立立案）**：与五条 peer 共享的文件正是**同一条链上的先后环节**（363 建报告 → 本条消费；364 建配置 → 本条扩块；365 建谓词、366 加 live 分支 → 本条在 live 上挂闸），调度器本就按 Touches 串行，共享不产生额外并行损失；而合并会把六条 AC 的验收面耦合成一个任务、违背 GOAL-037「P0 观测 → P1 谓词 → P2 生效 → 自动收紧」的分阶段边界。

## Plan

1. **新模块 `plugin/scripts/touches-relax-tighten.ts`**（纯库 + `isDirectEntry` CLI，尾部与 `duration-report.ts` / `touches-relax-config.ts` 同形）：
   - **判定词表导出、三态可分**（硬规则 3b）：`verdict ∈ {"not-evaluated", "within-budget", "halt"}`。⛔ `"not-evaluated"` **不得与 `"within-budget"` 同形**（后者 = 评估过且未超阈，前者 = 没评估成），⛔ 不得因读不懂而退化成任何一个内置默认阈值。
   - `evaluateAutoTighten(root, { nowMs, config, report })` ⇒ `{ evaluated, verdict, reason, readings }`：`readings` **必须分步**给出 fan-in 失败率（按 `mechanical_fan_in.step` **逐键**，`suite` 红与 `merge-develop` 红**分开呈现**，⛔ 不折成一个「失败」数）、放宽组相对对照的额外 worker 分钟、以及**本次实际用的**阈值（读到的，⛔ 不是内置的）。`reason` 在 not-evaluated 时**点名**是哪一侧不足（样本数 < min_samples）或哪个键缺失，并带两侧计数。
   - `applyAutoTighten(root, decision)`：经 `writeControlState(root, next)`（`rel` = 既有 `CONTROL_STATE_REL`）做**读-改-写**，只在 verdict 翻转时落盘。⛔ 不直接 `writeFileSync`、⛔ 不新哨兵文件、⛔ 不新增 MCP 控制面 verb（新 verb 会牵动控制面注册表与身份闸，超出本条 AC）。
   - CLI `--evaluate [--root <dir>] [--json]`：退出码 `0` = evaluated · `3` = NOT-EVALUATED · `2` = 用法错误（照 `rework-predictors.ts` / `duration-report.ts` 的退出码约定）。
2. **读数复用 AC-363，⛔ 不写第二份**：只调它的 `buildRelaxedDispatchReport` / `readRelaxedDispatchLedger`；若「按 step 的失败率」无法从它的输出导出，**扩它**（已列 Touches），⛔ 不另读 `relaxed-dispatch.jsonl`（硬规则 1：口径单一来源）。worker 分钟口径 = `workerExitedAtMs − dispatchedAtMs`（⛔ **不用 `wall_clock_ms`**——它含 fan-in，会把 merge/suite 成本混进「worker 多花了多少」）。
3. **配置：扩 AC-364 的 `parseTouchesRelaxSection`** 支持 `loop.touches_relax.auto_tighten` 子块（最小样本数；额外 worker 分钟上界；按 step 的 fan-in 失败率上界）。⛔ **无内置回退**（缺键 ⇒ 非合格 / not-evaluated，⛔ 不回填任何数值——硬规则 12 与 AC-364「无内置回退」同一纪律）；键名与枚举**只此一处导出**。`mode` 为 off/absent ⇒ 本步**不动作**（⛔ 不得退化成「用默认阈值评估」）。
4. **控制态：`packages/quay/src/kernel/control-state.ts` 的 `ControlState` 增 `relax_halted`**（缺省 `false`；`mergeControlState` 映射之，读失败/解析失败 ⇒ `true`——fail-closed 的方向是**宁可不放宽**）。⛔ 不新造文件、⛔ 保持 kernel 不 import kernel 之外（`import-graph-check.ts` 的 `kernelChecked` 规则）。写路径必须**保留**既有四类字段（`halted` / `halted_by` / `halted_at` / `preference` / `forced`）——自动收紧**不得抹掉人工 halt 或强制派发**（AC7）。
5. **谓词保持阻塞（AC-367(c)）**：AC-366 的 live 分支读 `relax_halted` **每轮一次**（随 `FilterContext` 传入，⛔ 不逐候选重读盘；同 `:64-66` 既有纪律「在判定那一刻取一次」），为真 ⇒ 保持阻塞。⛔ 不改 off/shadow 行为（AC-365 的同形测试必须继续绿）。
6. **接线 `plugin/scripts/worker-driver.ts`**：轮末调 `evaluateAutoTighten`，verdict = `halt` ⇒ 调 `applyAutoTighten`；把 verdict / reason / 分步读数 / 实际阈值写进 round 记录**新键**（照 `supersededReclaim` 的约定：`null` = 本轮没跑该步，对象 = 跑了带读数）。
7. **测试 `plugin/test/touches-relax-auto-tighten.test.mjs`**（首行 `// @test-group engine`）：fixture 账本 + fixture `worker-outcome` + fixture 控制态载体 + 真实 `.quay/config.yml`，**注入时钟**（复用 AC-363/366 落下来的注入手法），调**真实**模块；断言读的是**从载体文件回读并 `JSON.parse`** 的内容（控制态、round 记录），⛔ 不是内存对象。fixture root 用 `fs.mkdtempSync`、登记 `TMP_ROOTS`、顶层 `after()` 统一删（`tmp-leak-pairing-check` 要求）。⛔ 不 mock 判定、⛔ 不 spawn driver、⛔ 不跑 suite（纯 fs ⇒ 55s 上限应有余量，实测值写进 Evidence）。
8. **不越界**：⛔ 不在 quay 自己的 `.quay/config.yml` 写 `touches_relax`（GOAL-037「不在 quay 自身启用」）、⛔ 不改 `applyTaskFilters` 的返回表达式、⛔ 不动 `slot-refill.ts` 与 anti-drift 白名单。

## Acceptance Criteria

- [x] AC1 — 测试落地且通过（AC-367 判据面逐字）：`timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-auto-tighten.test.mjs` **exit 0**，文件首行带 `// @test-group engine`。附实际命令、输出尾部与实测耗时（秒）。
- [x] AC2 — (a) 样本不足 / 阈值未配置 ⇒ not-evaluated **且不动作**：三组 fixture（样本数 < 配置的 `min_samples`；配置里**根本没有** `auto_tighten` 阈值；缺 `min_samples` 键）各断言 `evaluated === false`、`reason` **点名**是样本不足还是哪个键缺失并带两侧计数、读数里阈值/额外成本取 `NOT_EVALUATED`（**显式断言 `!== 0`**，硬规则 3b：不得输出 0 或空均值伪装成「无额外成本」）；且控制态载体**字节不变**（⛔ 不写 `relax_halted`）。**两向**：阈值与样本都齐 ⇒ `evaluated === true`（证明判据不是恒 false）。附三组报告 JSON 与载体哈希。
- [x] AC3 — (b) 超阈值 ⇒ 写 `relax_halted:true`（**沿用既有控制态机制，⛔ 不新造哨兵文件**）：放宽组相对对照的额外 worker 分钟超配置阈值 ⇒ 从 `.quay/worker-control.json` **回读** `relax_halted === true`；断言 `.quay/` 下**未新增任何文件**（写入前后载体清单对比——排除 `.tmp` 瞬时态），且写入走的是既有 `readControlState` / `writeControlState`（附调用点代码）；round 记录带原因与读数。**负控制**：把额外分钟调到阈值之下 ⇒ 同一次评估 `relax_halted` 保持 `false`（证明判据真读了读数，不是恒真）。
- [x] AC4 — (b)(e) fan-in 失败率**按 `mechanical_fan_in.step` 分步**、`suite` 红与 `merge-develop` 红**分开呈现**：fixture 放宽组 `suite` 失败率超配置的 suite 阈值、`merge-develop` 未超 ⇒ `reason` 逐字点名 `suite`；**对称 fixture** ⇒ 点名 `merge-develop`；显式断言读数的**两个 step 是两条独立条目**、两者给出**不同**的 `reason`（⛔ 不合并成一个「失败」）。**负控制**：一条失败运行**没有** `mechanical_fan_in`（无 step）⇒ 不计入任何 step 的分子或分母（fail-closed，⛔ 不折成 `"unknown"`、⛔ 不折成 0）；并显式断言 `step` 词表取值**不含** `exited-not-landed` / `completed` / `landed`（两词表不互串）。
- [x] AC5 — (c) `relax_halted` 为真 ⇒ **live 模式下仍阻塞**：在 AC-366 的 live fixture 形状上（真实 `applyTaskFilters` + 真实谓词 + 注入时钟），控制态 `relax_halted: true` ⇒ 本可放宽的候选**被滤掉**；**负控制**：把控制态清成 `false` ⇒ **同一候选被放宽**（证明阻塞是 `relax_halted` 引起的，不是恒阻塞）。附两次返回集合与两次控制态字节。
- [x] AC6 — (d) **人工清除后恢复**：清零动作**只**改控制态载体（人可做的事：改那一份 JSON），⛔ 不改代码、⛔ 不删文件、⛔ 不需要新命令；清零后下一轮评估**重新按读数判定**，并在读数仍超阈值时**再写回** `true`——两次读数都从载体回读。附清零前后的载体字节与两次判定。
- [x] AC7 — (b) **写路径不得抹掉既有控制态**：载体预置 `halted:true` / `halted_by:"outer"` / `halted_at` / `preference:{…}` / `forced:[…]` ⇒ 自动收紧写入后 `relax_halted === true` **且那几类字段逐字不变**（⛔ 自动收紧不得抹掉人工 halt / 强制派发）。另：**旧载体**无 `relax_halted` 键 ⇒ 读作 `false`（缺键 ≠ `true`）。附前后逐字 JSON。
- [x] AC8 — round 记录留痕**且两态可分**：跑过评估的轮，round 记录带 verdict / reason / 分步读数 / **实际阈值**；**没跑**该步的轮为 `null`（⛔ 不得写成「跑过且未超阈值」）——两者从载体文件回读并 **two-way** 断言（`strictEqual` 各一次）。⛔ 不用第二个载体承载它。
- [x] AC9 — (f) **取假形态**（真红并留痕，⛔ 注入不得留在落地代码里）：① 把比较写成**恒不超阈值**（如 `0 > 阈值`，或把读数钳成 0）⇒ 本测试变红；② 让 not-evaluated 分支**写** `relax_halted` 或**回退到任一内置默认阈值** ⇒ 本测试变红。各附非零退出码 + 失败断言原文；恢复后 `git status --porcelain` 只含本 Touches 内的预期改动、落地 diff 与该测试最终内容一致。
- [x] AC10 — 静态面与不越界：① `bash plugin/scripts/capability-catalog.sh --summary` 报 `0 unclassified`（新脚本已在 declarations 六表成组声明）；② `git diff -- .gitignore docs/carrier-registry.json` **空**（复用 `worker-control.json`，⛔ 不新造载体）；③ `bash scripts/test.sh plugin/test/driver-filters.test.mjs plugin/test/worker-driver.test.mjs plugin/test/touches-relax-live-predicate.test.mjs` **exit 0**（谓词与既有驱动不回归；名字序列以 AC-365/366 落地态为准）；④ `git diff -- .quay/config.yml` **空**（不在 quay 自身启用）；⑤ `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` 的 `reverseEdges` 为空数组（kernel 方向未写反）。附五条命令、退出码与输出。
- [x] AC11 — 配置面扩块**无回退、只读**：① 真实 parser 读 fixture 的 `auto_tighten` 子块 ⇒ 读出的阈值 / `min_samples` **逐字等于** YAML 里写的值；② 子块给定非法值（非数值 / 负 / 率不在 `0..1`）⇒ 具名 issue 且模块 CLI **非零退出**；③ 运行前后 fixture `.quay/config.yml` **字节哈希相同**（一个字节没写），且**缺键时**不得出现被回填的默认值——显式断言这些键为 `undefined`（⛔ 不是 30 / 1 / 0.3 之类字面量）。附三段 fixture、校验结果与哈希前后值。

### Evidence

**实现落点（8 个文件，全在本条 Touches 内；anti-drift 复核 `ANTI-DRIFT OK: 8 actual file(s), all within declared Touches (9 glob(s))`，exit 0）**

| 文件 | 做什么 |
|---|---|
| `plugin/scripts/touches-relax-tighten.ts`（新） | 判定（`evaluateAutoTighten`）+ 写盘（`applyAutoTighten`）+ round 记录装配（`toRoundRecord`）+ 只读 CLI |
| `plugin/scripts/touches-relax-config.ts` | 扩 `auto_tighten` 子块（`parseAutoTightenSection`、`AUTO_TIGHTEN_KEYS`、`TouchesRelaxAutoTighten`） |
| `plugin/scripts/relaxed-dispatch-ledger.ts` | `RunStats` 增 `fanInReached` / `fanInStepFailures` / `fanInStepRates`（分步分子/分母/率） |
| `plugin/scripts/driver-filters.ts` | `FilterContext.relaxHalted` + live 词表最外层条件 `relax-not-halted` |
| `plugin/scripts/worker-driver.ts` | 轮末 `step="auto-tighten"` → `runAutoTightenPass`；round 记录新键 `auto_tighten`；派发 ctx 带入 `relaxHalted` |
| `packages/quay/src/kernel/control-state.ts` | `ControlState.relax_halted` + `mergeControlState` 映射 + `applyRelaxHalt` + 两条 fail-closed 读路径 |
| `plugin/scripts/capability-catalog-declarations.json` | 新脚本在 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER 六表成组声明 |
| `plugin/test/touches-relax-auto-tighten.test.mjs`（新） | 10 个用例的判据面 |

**Git**：实现提交 `2e2d00cef`；merge develop（`f765c1abc`）后为 `ae42e3dc0`。

**AC1 — 实测命令与耗时**

```
$ time timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-auto-tighten.test.mjs
EXIT=0  elapsed=0.590s
首行： // @test-group engine
ℹ tests 10 · ℹ pass 10 · ℹ fail 0 · ℹ duration_ms 560.294338
```
（上限 55s，实测 **0.59s**，余量 ~93×。）

**AC2 — 三组 fixture 的判定 + 载体哈希**

```
[AC2] ac2-samples : verdict=not-evaluated reason="not-evaluated: 样本不足 — samples=2 < min_samples=5 (relaxed measurable tasks=2, ledger records=2, ledger present=true)"
[AC2] ac2-samples : 载体 sha256=<前=后>  applied=false
[AC2] ac2-noblock : verdict=not-evaluated reason="not-evaluated: thresholds not configured — missing auto_tighten (the whole sub-block is absent); samples=2, extraWorkerMinutes=65.000, fanInReached=5. ..."
[AC2] ac2-nominkey: verdict=not-evaluated reason="not-evaluated: thresholds not configured — missing min_samples; ..."
[AC2] 正控制      : verdict=within-budget extra=65min reason="within-budget: extra worker minutes 65.0 <= 1000.0; steps [merge-develop=0.200<=0.990, suite=0.400<=0.990]; samples=2 >= min_samples=2"
```
三组的 `applied` 均为 `false` 且载体字节逐字节不变（测试用 `readFile` 前后对比 + `sha256`）；读数断言 `minSamples`/`maxExtraWorkerMinutes` 为 `NOT_EVALUATED` 且显式 `!== 0`。两向由正控制给出（`evaluated === true`，且 `extraWorkerMinutes === 65` 由载体数据算得）。

**AC3 — 回读 + 未新增文件 + 负控制**

```
[AC3] 正方向: verdict=halt extra=65 > 30
[AC3] 载体回读 = {"schemaVersion":1,"halted":false,"halted_by":null,"halted_at":null,"preference":{},"forced":[],"relax_halted":true}
[AC3] round.auto_tighten = {"verdict":"halt","reason":"halt: extra worker minutes 65.0 > max_extra_worker_minutes 30.0 (relaxed median=80.0, control median=15.0)","applied":false,"maxExtra":30}
[AC3] .quay/ 清单 = ["config.yml","relaxed-dispatch.jsonl","worker-control.json","worker-outcome.jsonl"]   ← 写入前后逐字相同
[AC3] 负控制: verdict=within-budget（阈值 120 vs 读数 65）relax_halted=false
```
写入走既有机制 —— 测试直接读 `touches-relax-tighten.ts` 源码断言：含 `writeControlState(root, next)`、含 `CONTROL_STATE_REL`、且**不含**任何 `writeFileSync(`（唯一写面 = 既有控制态写入器）。

**AC4 — 分步（两条独立条目 + 不同 reason）**

```
[AC4] suite 超阈: halt: fan-in failure rate at step 'suite' 0.400 > threshold 0.300 (failures=2/5)
[AC4] merge 超阈: halt: fan-in failure rate at step 'merge-develop' 0.200 > threshold 0.100 (failures=1/5)
[AC4] 分步条目 = [{"step":"merge-develop","failures":1,"reached":5,"threshold":0.9,"rate":0.2,"overThreshold":false},
                  {"step":"suite","failures":2,"reached":5,"threshold":0.3,"rate":0.4,"overThreshold":true}]
[AC4] 负控制①（去掉无 fan-in 的失败）    : fanInReached=5 suite=2 merge=1 withoutStep=0   ← 分子分母**都不变**
[AC4] 负控制②（换成有 fan-in 无 step 的失败）: fanInReached=6 suite=2（率 0.3333）merge=1  ← 只动**分母**，不动分子
```
两个 fixture 的 reason 互不相同且各不含对方步名；`failuresWithoutStep=1` 单独报出（⛔ 不折成 `"unknown"`、⛔ 不折成 0）。分母 = **放宽组**走到 fan-in 的运行数（5 = A 的 4 条 + B 的 1 条；⛔ 不是 `attempts`：没跑过 fan-in 的运行不算「那一步失败了」）。step 词表不含 `NOT_STEP_TOKENS = ["completed","exited-not-landed","landed","killed","timed-out","failed"]` 任一取值。

**AC5 — live 下仍阻塞（双向）**

```
[AC5] 闸关: kept=["gap-live-cand"]  relaxed=true   载体 sha256=b28be9c0…a4fd
[AC5] 闸开: kept=[]                 blockedBy=relax-not-halted  载体 sha256=0bda587d…b02
```
两次走的是**真实** `applyTaskFilters` + 真实谓词 + 注入时钟；两次控制态载体字节**不同**（不是同一份读两遍）。

**AC6 — 人工清零后恢复**

```
[AC6] 第一轮后载体   = {…,"relax_halted":true}
[AC6] 人工清零后载体 = {…,"relax_halted":false} —— .quay/ 清单不变 ["config.yml","relaxed-dispatch.jsonl","worker-control.json","worker-outcome.jsonl"]
[AC6] 第二轮: verdict=halt applied=true relaxHaltedBefore=false 载体 = {…,"relax_halted":true}
```
第二轮读到的 `relaxHaltedBefore=false` 证明确实**重读了载体**（⛔ 不是「记得上一轮判过」）。

**AC7 — 写路径保留既有控制态**

```
[AC7] 写入前 = {"schemaVersion":1,"halted":true,"halted_by":"outer","halted_at":"2026-10-17T03:04:05.000Z","preference":{"board":"native","strategy":"oldest-first"},"forced":[{"task":"gap-some-other-task","reason":"人指定的强制派发","caller":"outer","at":"2026-10-17T03:05:00.000Z"}]}
[AC7] 写入后 = {…同上逐字…,"relax_halted":true}
[AC7] 旧载体读取 relax_halted = false（缺键 ⇒ false）→ 写入后 = true
```
测试对六个键逐个 `deepEqual` 前后值，并断言键集合恰为「原键 ∪ {relax_halted}」。

**AC8 — round 记录 two-way**

```
[AC8] 轮1（跑过）= {"evaluated":true,"verdict":"within-budget","reason":"…extra worker minutes 10.0 <= 1000.0; steps [merge-develop=0.000<=0.990, suite=0.000<=0.990]; samples=2 >= min_samples=2","thresholdsConfigured":true,"applied":false,
                    "readings":{"extraWorkerMinutes":10,"maxExtraWorkerMinutes":1000,"samples":2,"minSamples":2,
                                "fanIn":[{"step":"merge-develop",…,"reached":2},{"step":"suite",…,"reached":2}],"failuresWithoutStep":0,"fanInReached":2,"relaxHaltedBefore":false}}
[AC8] 轮2（没跑）= null   载体行数=2
```
两条 round 记录经真实 `appendHeartbeatLine` 落进 `.quay/worker-round.jsonl` 后由 `readJsonl` 回读；`r1.auto_tighten === null` 为 `false`、`r2.auto_tighten === null` 为 `true` —— `strictEqual` 两个方向各一次。

**AC9 — 两次注入真红（各附退出码与失败断言原文）**

注入①（把读数钳成 0：`extraWorkerMinutes: 0`）：
```
$ timeout 120 node --experimental-strip-types --test plugin/test/touches-relax-auto-tighten.test.mjs
EXIT=1   ℹ fail 5
✖ AC2(a) … AssertionError: extra worker 分钟逐值可算（实得 0）   actual: 0, expected: 65
✖ AC3(b) … AssertionError: 超阈值 ⇒ halt（实得 within-budget：within-budget: extra worker minutes 0.0 <= 30.0; …）actual: 'within-budget', expected: 'halt'
✖ AC6(d) … AssertionError: actual: 'within-budget', expected: 'halt'
✖ AC7(b) … AssertionError: actual: 'within-budget', expected: 'halt'
✖ AC8    … AssertionError: 带额外成本读数（放宽 20 − 对照 10）
```
注入②（拆掉 not-evaluated 不落盘闸：`if (false) {`）：
```
EXIT=1   ℹ fail 3
✖ AC2(a) … AssertionError: ac2-samples: not-evaluated ⛔ 不得落盘   actual: true, expected: false
✖ AC3(b) … AssertionError: within-budget ⛔ 不落盘                  actual: true, expected: false
✖ 装配自检 … AssertionError: within-budget ⇒ 不落盘（applied 与 verdict 是两件事） actual: true, expected: false
```
**恢复**：`diff /tmp/ac367-inj/orig.ts plugin/scripts/touches-relax-tighten.ts` ⇒ 无输出（逐字节相同）；`git show HEAD:plugin/scripts/touches-relax-tighten.ts` 与注入前原文亦逐字节相同；两文件 `grep -c INJECTION` 均为 **0**；恢复后重跑 `ℹ pass 10 · ℹ fail 0`。

**AC10 — 五条静态命令**

```
① bash plugin/scripts/capability-catalog.sh --summary
   capability-catalog: 387 scripts | 387 declared | 0 unclassified | 382 ship        exit=0
② git diff --stat -- .gitignore docs/carrier-registry.json      （空）              exit=0
③ bash scripts/test.sh plugin/test/driver-filters.test.mjs plugin/test/worker-driver.test.mjs plugin/test/touches-relax-live-predicate.test.mjs
   ℹ tests 248 · ℹ pass 248 · ℹ fail 0 · duration_ms 37794.95                       exit=0
④ git diff --stat -- .quay/config.yml                           （空）              exit=0
⑤ node --experimental-strip-types plugin/scripts/import-graph-check.ts --json
   reverseEdges: []   valueSccs: []   kernelViolations: []                           exit=0
```
另跑相邻面（本条**扩了**它们的模块，验证不回归）：`scripts/test.sh plugin/test/touches-relax-ledger.test.mjs plugin/test/touches-relax-config.test.mjs plugin/test/touches-relax-off-parity.test.mjs plugin/test/touches-relax-filter-trace.test.mjs plugin/test/driver-runtime-control-plane.test.mjs` ⇒ **exit 0，ℹ tests 43 · pass 43 · fail 0**。

**AC11 — 配置面**

```
[AC11] 逐字读出 = {"min_samples":4,"max_extra_worker_minutes":12.5,"max_fan_in_failure_rate":{"suite":0.4,"merge-develop":0.15}}
                  （config.yml sha256 前后=f67e206a22c995a7f5e258fe955f75bda89a5f8084d86d4a03e8d87c58fdb51e）
[AC11] 缺键读出 = {"min_samples":4}     ← 另两个键是 undefined（⛔ 不是内置默认值；键集合恰为文件写了的那些）
[AC11] 非法 issue = ["loop.touches_relax.auto_tighten.min_samples",
                     "loop.touches_relax.auto_tighten.max_extra_worker_minutes",
                     "loop.touches_relax.auto_tighten.max_fan_in_failure_rate.suite",
                     "loop.touches_relax.auto_tighten.max_fan_in_failure_rate.merge-develop"]
       子进程 CLI：exit=1；非法 fixture sha256 前后=27608e81…c7d6（跑完 CLI 仍不变）
```
边界自检：`{suite: 0, merge-develop: 1}` ⇒ `ok:true`（0 与 1 都在 `0..1` 闭区间内，拒的是值不是字段）。

**适配条款**：AC-363 / 364 / 366 落地态的导出名与本节一致（`readRelaxedDispatchLedger` / `buildRelaxedDispatchReport` / `RelaxedRow` / `loadTouchesRelaxConfig` / `parseTouchesRelaxSection` / `FilterContext` / `applyTaskFilters` / `ControlState` / `readControlState` / `writeControlState`），**无差异需要记录**。唯一新增的 live 条件 id 是 `relax-not-halted`（AC-366 的词表只被「包含性」断言，故可追加）。

**⛔ 未启用生产**：quay 自己的 `.quay/config.yml` 未写 `touches_relax`（AC10④ 的 `git diff` 为空），`mode` 缺省 off ⇒ `runAutoTightenPass` 每轮返回 `null`，行为与现状逐字节相同。

**如实写明（DoD 要求）**：本条判据面止于**夹具载体回读**；生产消费（人在目标项目填阈值、driver 每轮真判）由人择机开启的 P2/P3 阶段承担——与 GOAL-037 立案文本「已知缺口」一致。判别力不由「测试存在且 55s 内绿」提供，而由 AC2 的三态、AC4 的两条差分、AC5/AC6 的双向负控制与 AC9 的两次注入真红提供（均已在上面逐条附读数）。

## Definition of Done

真实落地 = **同一个真实评估函数在 fixture 载体上真的判出超阈值、并真的把 `relax_halted: true` 落进既有控制态载体**，且 (a)–(f) 的判别读数（not-evaluated 三态 + 双向负控制 + 分步失败率 + 注入红）都真实取到 —— 不是「单测绿了」，也不是「内存对象里有这个字段」。四条逐一对上：① 新测试落地并 `exit 0`（AC1）；② 从 fixture 控制态载体**回读**的 `relax_halted` 与 round 记录逐字贴出（AC3 / AC7 / AC8）；③ 每条判据至少一个**双向读数或负控制**（AC2 的两向 / AC3 / AC4 / AC5 / AC6 的负控制）；④ **取假形态**两次注入各真红一次（AC9，附红输出）。全部新增测试在 `bash scripts/test.sh --for-task gap-touches-relax-auto-tighten-loop-absent` 下绿。

**如实写明（⛔ 不作为省略的理由）**：本 AC 的判据面是**夹具读数** —— GOAL-037 立案文本的「已知缺口」已承认本 goal 的 AC 都不读生产载体（生产读数需要人在目标项目启用 shadow/live 并重启 driver，这是人工步骤，写进 AC 会成为无法由 worker 满足的判据）。因此本条的落地证明止于「夹具载体回读」；生产消费（人在目标项目填阈值、driver 每轮真判）由人择机开启的 P2/P3 阶段承担。⛔ 同时：AC-367 的判据面（测试存在且 55s 内绿）**单独不具备判别力** —— 它区分不了「真收紧」与「恒真断言」；判别力由 AC2 的三态、AC4 的分步、AC5/AC6 的双向负控制与 AC9 的两次注入红提供，故这些不得省略、不得只在文字上声称跑过。

**适配条款**：若 AC-363/364/366 落地后的导出名 / 键名 / 条目形状 / 条件 id 与本节不同，**以其导出为准**并把差异写进 Evidence；⛔ 不得为了让测试变绿而发明新条件、改动配置语义或另起一份读数 / 账本实现。⛔ 本条**不启用生产**（`mode` 缺省 off ⇒ 行为与现状逐字节相同）。

## Touches

- plugin/scripts/touches-relax-tighten.ts (new)
- plugin/scripts/touches-relax-config.ts
- plugin/scripts/driver-filters.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/relaxed-dispatch-ledger.ts
- packages/quay/src/kernel/control-state.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/touches-relax-auto-tighten.test.mjs (new)
- tasks/gap-touches-relax-auto-tighten-loop-absent.md
