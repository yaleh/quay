---
id: gap-observability-blocks-main-execution-audit
title: worker-driver 全程审计——观测性写入/闸门是否阻塞主执行（ledger 不得 gate 落地）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

原则（人裁定 2026-08-30）：**观测（ledger / 遥测 / 镜像写）不得阻塞主执行（merge→suite→flip→ff→land）**。「记录=落地前提」被否——账本本就是观测性的，不应 gate 主执行。

对 `runMechanicalFanIn`（plugin/scripts/worker-driver.ts）全程做观测性写入审计。审计结论如下（AC1 枚举 → AC2 判定 → AC3 结论）。

### AC1 枚举——runMechanicalFanIn 自身代码路径里的观测性载体写

| 载体 | 写函数（worker-driver.ts） | 失败语义 |
|---|---|---|
| fan-in-step-trace（`.quay/fan-in-step-trace.jsonl`） | `appendFanInStepTrace`（:1839） | **best-effort**——try/catch（:1863-1865） |
| fan-in 过程日志（`.quay/fan-in-<task>-<runId>.log`） | `appendFanInTrace`（:2182） | **best-effort**——try/catch（:2187） |
| 步骤失败裸流 dump（`/tmp/fan-in-step-*.log`） | `fail()` 内联（:2240-2245） | **best-effort**——try/catch，写失败 `logFile=null` |
| full-suite-state 镜像 | `mirrorMechanicalFanInSuiteState`（:2464） | **best-effort**——try/catch（:2482-2484） |
| **suite capture**（`/tmp/fan-in-suite-<task>.env`） | **`writeSuiteCapture`（:2036，调用 :2353/:2365）** | **⛔ 阻塞**——裸 `writeFileSync` 无 try/catch ⇒ 抛异常 ⇒ `catch`(:2390) → `failClean("exception")` |
| **archguard-metrics 镜像**（`.archguard/metrics-history.jsonl`） | **`mirrorArchguardMetrics`（:2074，调用 :2325-2326）** | **⛔ 阻塞**——镜像写失败返回 `ok:false` ⇒ `failClean("archguard-metrics")` |

AC1 清单点名的其余载体不在 runMechanicalFanIn 自身代码路径，划清边界：

- **verification-round / suite-load / measure-history**：由 suite 子进程 `full-suite-runner.ts`（`--state-dir`）写，runMechanicalFanIn 只 gate 子进程退出（`sr.outcome`），不直接写；其失败语义属 runner，非本审计对象。
- **worker-outcome**：由常驻循环 `appendOutcome`（:796）在 worker 返回后写（reap 路径），不在 fan-in 落地路径；`appendOutcomeToFile`（:789）同样无 try/catch——同款「裸 fs 写」，但不在落地路径，作边界观察项（非 runMechanicalFanIn 命中）。
- **writeRedSuiteRecord**（suite-driver.ts:316）：best-effort（try/catch + WARN，:354-356），且当前机械路径已不调用（runner 是 verification-round 唯一 writer，注释 :2347-2350）。

### AC2 判定——两个命中点的代码路径证据 + 执行闸 vs 观测写区分

**命中 1：writeSuiteCapture。** 证据：:2036-2040 定义，`fs.mkdirSync` + `fs.writeFileSync` 无 try/catch；调用点 :2353（suite 绿）与 :2365（doc-only skip）都在 try 块（:2292）内；写失败抛异常 → `catch`（:2390-2391）→ `failClean("exception", ...)`。结果：suite 已绿（`sr.outcome === "done"`）但落地仍失败，且失败 step 被标成无上下文的 `"exception"`（丢步骤名）。
执行闸 vs 观测写：capture 内容（`suite_exit`/`suite_head`）是 ff 闸 `fan-in-ff-merge.sh`（:351-364）读的**正确性证书**——所以它的**内容**是执行关键；但它是**从内存权威态（`sr.outcome` / `suiteHead`）投影到盘**的派生载体。真正的缺陷不是「证书不该存在」，而是：① 投影写失败以**裸 exception** 形态弄死落地（丢步骤上下文）；② 证书是易碎的盘投影，而权威源本就存在（`suite_head` = `task/<id>` tip 的父 = flip commit 的父；机械路径走到 ff ⇔ suite 已绿）。

**命中 2：mirrorArchguardMetrics。** 证据：:2074-2093，镜像写 `appendFileSync` 抛错 → 返回 `{ok:false}`（:2090-2092）；调用点 :2325-2326 `if (!mirrored.ok) return failClean("archguard-metrics", ...)`。结果：archguard 结构闸（执行，sccCount=0）已绿，但 **metrics 到生产载体的镜像**写失败 ⇒ failClean ⇒ 落地失败。
执行闸 vs 观测写：`step("archguard-structure")`（:2323-2324）是**执行闸，该挡**；`mirrorArchguardMetrics` 是把 worktree 结构信号记录**持久化到主检出生产载体**的**观测写，不该挡落地**。注释 :2069-2073 自认「镜像失败 fail-closed（记录是『被某判据读』半边）」——正是本 finding 要否掉的前提：账本本就是观测性的，不应 gate 落地。

### AC3 结论——修法

**命中 1（writeSuiteCapture）：**
- 近端（非阻塞化 + 结构化）：写套 try/catch，失败改 `failClean("suite-capture", ...)`（结构化 step + 清晰 reason），不再裸 `"exception"`。这仍会挡落地（ff 闸 fail-closed 读不到证书，`fan-in-ff-merge.sh:346-347` 已是 exit 2）——但这是**诚实的挡**：证书缺 ⇒ ff 无法验证 ⇒ 该挡，只是要挡得有名有姓、非裸异常。
- 结构端（ff 闸改读权威源）：`suite_head` 可从 git 直接重推（`task/<id>` tip 的父 = suite 时刻 HEAD），`suite_exit=0` 在机械路径由「已走到 ff 步」蕴含；证书改权威源直读后，`writeSuiteCapture` 退化为纯 best-effort 观测（或删除）。

**命中 2（mirrorArchguardMetrics）：** fail-open + 独立载体——镜像写失败不再 `return failClean`；改【响亮告警 + 独立 best-effort 载体记 mirror-failure】（stderr WARN + trace 行 + 如 `.archguard/mirror-failures.jsonl` 记一条），然后继续 scoped/suite/ff。「能产出≠已产出」由【结构闸本身是执行】+【镜像失败被显式记录】共同覆盖，不再用「fail-closed 落地」保证。

**结论：** 审计确认 **2 个命中**（writeSuiteCapture、mirrorArchguardMetrics）均为「观测/投影写失败 ⇒ 阻塞落地」；其余载体（fan-in-step-trace / fan-in 日志 / 失败裸流 dump / full-suite-state 镜像 / writeRedSuiteRecord）已核 best-effort。修法已给（近端结构化 + 结构端权威源直读；fail-open + 独立载体）。本 finding 交付审计结论与修法，不改产品代码；落地修法建议另立 gap 任务由 outer 排期。

## Acceptance Criteria

- [x] AC1（枚举）：列出 runMechanicalFanIn 每步中所有观测性载体写（verification-round / full-suite-state / suite-load / measure-history / fan-in-step-trace / fan-in 日志 / suite capture / archguard-metrics 镜像 / worker-outcome）及其失败语义（best-effort vs 阻塞）。
- [x] AC2（判定）：对每个「观测写失败 ⇒ 阻塞/弄红落地」的点给出代码路径证据（行号 + 失败语义），并区分「执行闸（该挡）vs 观测写（不该挡）」。
- [x] AC3（结论）：对每个命中点给出非阻塞化修法（移到主路径外 / fail-open + 独立载体 / ff 闸改读权威源），或证明其本就 best-effort。

## Definition of Done

审计结论列出全部观测性载体写的失败语义、命中清单（至少含 writeSuiteCapture 与 mirrorArchguardMetrics 两个实锤）与修法；不再有「观测写失败 ⇒ 阻塞落地」的静默点。

## Touches

- plugin/scripts/worker-driver.ts（审计对象）
- plugin/scripts/suite-driver.ts（writeRedSuiteRecord 审计）
- tasks/gap-observability-blocks-main-execution-audit.md（自身）