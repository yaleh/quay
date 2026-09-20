# observation.ts 消费者分组与可执行拆分调查

> 立案任务：`tasks/gap-arch-observation-ts-consumer-grouping-investigation.md`
> 上游：`SPEC-architecture-consolidation-ts-and-shell-2026-09-19` §5 Phase 6 / §10.2
> 先例体例：`docs/analysis/worker-driver-decomposition-investigation.md`
> **本任务不修改 `packages/quay/src/observation.ts`**——只产出可执行结论，供后续拆分任务直接引用作 Proposal 依据。

---

## TL;DR（结论先行，细节见后）

1. **现场基线（AC1）**：`observation.ts` = **4671 行 / 197 个导出**（93 函数 + 48 常量 + 43 interface + 13 type，**0 个 re-export、0 个 class**）。真实 import 图：**扇入 60 个文件**（14 生产 `.ts` + 46 测试 `.mjs`），**扇出 14 个模块**（6 个 node 内建 + 7 个本仓库模块 + `yaml`）。
   SPEC §1.2 T4 的 `4497 行 / 扇入 105 / 扇出 112` **在本仓库当前树上复现不出来**——它的单位是 archguard 的**实体-关系边**而非文件/import 语句，且该基线本身已过期（SPEC §1.1 的 `446 实体/908 关系` 今日同 scope 为 `782/1648`）。逐项对账见 §AC1-4。
2. **消费者分组（AC2）**：**197 个导出里只有 63 个有生产消费者**；**52 个仅测试消费**（51 个静态 import + 1 个生成式 import 缝）；**82 个无任何外部消费者**——其中 **79 个是「只在本文件内用」的过度导出**，**3 个是真死导出**（全仓库零引用）。
   ⇒ 这个文件的「被依赖」属性**被严重高估**：真正被生产代码消费的只有 **32%** 的导出。
3. **纠缠 vs 独立（AC3）的核心发现**：模块级可变状态**确实存在**（17 个绑定：7 个 `let` 计数器/memo + 9 个 `Map`/`Set` 短 TTL 缓存 + 1 个只读 `Set`），**但每一个都只被【单一区域】的函数引用**（注释剥离后实测最大跨区域数 = **1**）。文件大**不是因为共享可变状态纠缠**，而是因为**一条按读取源铺开的长线性 DAG**（文件自己带 19 个 `// ── … ──` section 头，加头部前段共 **20 个区域**；395 条文件内引用边，其中跨区域仅 132 条）。
4. **拆分结论（AC4）**：**值得拆，且缝是干净的**。文件自带的 19 个 section 头已经是天然边界。推荐按**读取源 / 页面路由**轴拆成 **~10 个域模块 + 1 个薄共享基座**，`observation.ts` 退化为 **re-export 桶**（60 个消费者文件的 import 面零改动，测试迁移成本 = 0）。
   最优先的第一刀：**`observation-tests.ts`（R13+R14，405 行，对外部区域的依赖实测 = 0）**——全文件唯一一个**完全自包含**的域。
5. **对 SPEC 假说的检验（AC5）**：SPEC 提的四个视图域切分轴 **只对上一半**——`sessions`（R15+R16+R17）与 `tests`（R13+R14）**确实是真实模块边界**；**`dashboard` 不是**（它是**跨 10 个区域的消费者**，是扇入汇点而非切分轴）；**`收敛观测` 在 region 图上找不到对应物**。数据给出的是 **11 个域**，不是 4 个（详见 §AC5）。

---

## AC1 — 现场基线（真实命令与输出）

在任务 worktree（off `develop` @ `aa4f2fcff`）执行：

```bash
$ cd /home/yale/work/quay-worktrees/gap-arch-observation-ts-consumer-grouping-investigation
$ wc -l packages/quay/src/observation.ts
4671 packages/quay/src/observation.ts
```

### AC1-1：导出的个数与**种类构成**

```bash
$ grep -c "^export " packages/quay/src/observation.ts
197
$ grep -cE "^export (async )?function " packages/quay/src/observation.ts   # 93
$ grep -cE "^export const "            packages/quay/src/observation.ts   # 48
$ grep -cE "^export interface "        packages/quay/src/observation.ts   # 43
$ grep -cE "^export type "             packages/quay/src/observation.ts   # 13
$ grep -cE "^export (\{|\*|class|enum|default) " packages/quay/src/observation.ts   # 0
```

| 种类 | 个数 |
|---|---|
| `function`（含 async） | 93 |
| `const` | 48 |
| `interface` | 43 |
| `type` | 13 |
| `class` / `enum` | 0 |
| **re-export（`export { … } from`）** | **0** |
| **合计** | **197** |

**与先例的关键差异**：`worker-driver.ts` 的 140 个「导出行」里有 38 个符号是 re-export（27%）；**`observation.ts` 的 197 个导出全部是【本文件定义】，一个 re-export 都没有**。⇒ 这个文件从未经历过任何一轮「先抽共享面、再留 re-export 面」的拆分——它是**一次长成的**。

**另有 65 个文件内私有顶层声明**（48 个 `function` + 14 个 `const` + 3 个 `interface`），不导出、只被本文件消费。

### AC1-2：真实扇入（按 import 语句位置判定）

**⚠️ 方法陷阱（硬规则 2）**：按行 grep 会**漏掉多行 import**。实测 **4 个文件被行式 grep 完全漏掉**（`serve-board.test.mjs`、`serve-ac95-views.test.mjs`、`observation-worktree-namespace.test.mjs`、`gap-ac292-board-request-path-cold-build.test.mjs`）；另有 **`serve-task.ts` 的多行 import 被漏掉**（它的文件计数没漏，只因该文件另有一条单行 `import type { LiveWorker, WorkerOutcomeRecord } from "./observation.ts";`，但其多行 import 的符号会被漏）。形态：

```ts
import {
  readTaskStatusMapAtRef,
} from "./observation.ts";
```

——`} from "…observation.ts";` 这一行不含 `import` 关键字，**行式 grep 一律漏掉**（用行式谓词的读者会量到 **56** 而非 **60**——这正是本调查第一版的错误读数，对照见 §AC6-2 的反例块）。必须用能跨行的谓词：

```bash
cd /home/yale/work/quay-worktrees/gap-arch-observation-ts-consumer-grouping-investigation
{ find . -name '*.ts' -not -path './node_modules/*' -not -path './.claude/*' \
       -not -path './.archguard/*' -not -path './archive/*' -print0;
  find . \( -name '*.mjs' -o -name '*.js' \) -not -path './node_modules/*' -not -path './.claude/*' \
       -not -path './.archguard/*' -not -path './archive/*' -print0; } \
| xargs -0 perl -0777 -ne \
  'if (/\b(?:import|export)[^;]*?\bfrom\s*["\x27]([^"\x27]*observation(?:\.ts)?)["\x27]/s) { print "$ARGV\n" }' 2>/dev/null \
| sed 's|^\./||' | sort -u | wc -l
60
```

（谓词的承重点：`[^;]*?` 里的 `[^;]` 保证不跨越语句边界——import 语句的 `from` 之前不可能出现 `;`。）

| 类别 | 文件数 |
|---|---|
| 生产（`packages/quay/src/**.ts`） | **14** |
| 测试（`packages/quay/test/**.test.mjs` 等 + `plugin/test/`） | **46** |
| **扇入合计** | **60** |

生产消费者 14 个：`serve.ts` / `serve-live.ts` / `serve-dashboard.ts` / `serve-board.ts` / `serve-task.ts` / `serve-git.ts` / `serve-system.ts` / `serve-tests.ts` / `serve-sessions.ts` / `serve-needs-human.ts` / `serve-architecture.ts` / `serve-send.ts` / `mcp-server.ts` / `cli/driver.ts`。

**60 个文件合计产生 237 对 (文件, 符号) import**。

### AC1-3：真实扇出（按 import 语句位置判定）

`observation.ts` 只有 **14 条 import 语句 / 14 个不同模块**：

| 目标 | 类别 |
|---|---|
| `node:fs` `node:os` `node:path` `node:child_process` `node:url` `node:util` | node 内建（6） |
| `./version.ts` `./frontmatter-store-base.ts` `./abi.ts` `./plugin-root.ts` `./worktree-namespace.ts` `./primitives/session-liveness.mjs` `./primitives/session-schema.mjs` | 本仓库模块（7） |
| `yaml` | npm（1） |
| **合计** | **14** |

**本仓库内扇出 = 7 个模块**（其中 2 个是共享原语 `primitives/`，文件头注释专门声明「⛔ 不要在此重新实现」）。

**另有一条运行期动态 import**（import 语句位置判据取不到）：
`:3430 return (await import(pathToFileURL(resolved.path).href)) as DriverRuntimeSurface;` ——经由 `resolvePluginScript("driver-runtime.ts")` 解析路径，是**配置驱动的运行期依赖**，不是静态扇出。SPEC §7 的证据表自己也标注过这类「运行时耦合本文未量化」。

### AC1-4：与 SPEC 的「105/112」逐项对账（**不一致，写原因**）

| 量 | SPEC 值 | 本次实测 | 是否一致 | 原因 |
|---|---|---|---|---|
| 行数 | 4497（§1.2 T4 / §5 Phase 6） | **4671** | ✗ | 文件在 SPEC 之后又长了 **+174 行**（立案时量到 4671，SPEC 写的是 4497）。与 `worker-driver.ts` 的 `4435 → 4445` 同族：**机制层持续沉积**。 |
| 扇入 | 105 | **60 个文件** | ✗ | 见下 |
| 扇出 | 112 | **14 个模块** | ✗ | 见下 |

**为什么对不上——三条可核原因（不是「看起来不一样」）**：

1. **单位根本不同**。SPEC §7 的证据表把 archguard 的读数列为「`archguard_analyze` 输出」。archguard 数的是 **实体-关系边**，不是文件或 import 语句。本任务在**同一个 worktree** 上跑 archguard（`lang=typescript`，`sources=["packages/quay/src"]`）得：
   - observation.ts 实体数 **140**（46 interface + 94 function）；
   - 入边 **145 条**，来自 **80 个外部实体**，分布在 **14 个 `.ts` 文件**；
   - 出边 **121 条**，指向 **65 个不同目标**。
   ⇒ 与 `105/112` 是**同一量级但不可复现**的数——`145/121` 今天也不是 `105/112`。
2. **SPEC 的仪器基线已过期（可核）**。SPEC §1.1 自报 `packages/quay/src` = **446 实体 / 908 关系**；本次同 scope 实测 = **782 实体 / 1648 关系**（仪器现在多解析了约 1.75 倍）。基线一动，`105/112` 就不再是同一个数上的读数。**⇒ `105/112` 不能当基线用；本文件以「按 import 语句位置判定」的真实读数（60/14）为基线。**
3. **archguard 不解析 `.mjs`，而 77% 的真实消费者是 `.mjs`**。60 个消费者里 46 个是测试 `.mjs`——SPEC 的仪器**完全看不到它们**。archguard 的「14 个文件」恰好等于**生产 `.ts` 消费者数**，这不是巧合：它只解析得出 `.ts`。**⇒ 用 archguard 的扇入回答「拆分会伤到谁」会漏掉 46 个文件。**
4. **补一条仪器自身的解析缺陷**：出边的 65 个目标里 **56 个是未解析的裸名**，其中 **42 个其实是 `observation.ts` 自己的实体**（archguard 未把本文件内的类型引用限定到文件 id）。扣除后**真实外部出目标 ≈ 23**。⇒ archguard 的「扇出」用于本项目时**高估**，且高估的部分是本文件的自引用。

---

## AC2 — 消费者分组表（全部 197 个导出）

### AC2-0：全局计数（最重要的三个数字）

| 分类 | 个数 | 占 197 |
|---|---|---|
| **生产消费**（至少 1 个 `packages/quay/src/**` 文件静态 import） | **63** | 32.0% |
| **仅测试消费**（无生产消费者，但测试消费） | **52** | 26.4% |
| **无任何外部消费者** | **82** | 41.6% |
| — 其中「只在本文件内用」的过度导出（`export` 关键字无外部收益） | 79 | 40.1% |
| — 其中**真死导出**（全仓库零引用） | **3** | 1.5% |
| **合计** | **197** | 100% |

**⇒ SPEC §5 Phase 6 称本文件是「核心层里唯一『最被依赖 ∧ 最依赖别人』的模块」。前半句被数据削弱：真正被生产代码消费的只有 63/197 = 32%，而扇入的 46/60 = 77% 是测试文件。** 这个文件更像**一个内聚的读取层 + 一大片只服务测试的可注入缝**，而不是一个被广泛复用的公共库。

### AC2-1：三个真死导出（**每个都附判定依据**）

| 行 | 种类 | 导出 | 判定依据 |
|---|---|---|---|
| `:1606` | const/function | `resetTaskStatusRefBuildCount` | 全仓库（除本行）**零提及**。它是 `getTaskStatusRefBuildCount` 的复位对偶，但没有任何测试调用它 |
| `:3713` | const | `VERIFICATION_ROUND_REL` | 全仓库零提及。`parseVerificationRound(line)` 接收的是**行内容**不是路径，该常量从未被读 |
| `:2735` | const | `GIT_HISTORY_ACTIVE_WINDOW_SEC` | 唯一提及在 `packages/quay/test/observation.test.mjs:6`，是**注释**（硬规则 2：注释里提到不算命中） |

**⚠️ 一个「疑似死、其实活」的反例（记录下来防止误删）**：`:3416 getDriverRuntimeLoadError` 在全仓库**没有任何静态 import**，但 `packages/quay/test/gap-dashboard-driver-status-card.test.mjs:313` 把它**生成**进一个临时探针脚本：

```js
`import { readDriverStatus, getDriverRuntimeLoadError } from ${JSON.stringify(pathToFileURL(OBSERVATION_SRC).href)};`
```

⇒ **它是活的**。这也是 AC2 表的一处已知漏计：**存在生成式 import 缝**（`writeFileSync` 出一个 `.mjs` 再 `execFileSync` 跑），静态 `from "…observation"` 扫描看不见。本次全仓库只找到这 **1 处**、只影响 **1 个符号**。

### AC2-2：区域划分口径

本文件**自己带 19 个 `// ── … ──` section 头**（`:441` 起），加上头部无 section 的前段，共 **20 个区域**。本表的「区域」列即该文件的**自有分区**，不是外部假说：

| 区域 | 行范围 | 行数 | 本文件自己的 section 标题 |
|---|---|---|---|
| R0 | :1–440 | 440 | （无 section 头的前段：常量 + live/journal/activity 类型） |
| R1 | :441–623 | 183 | Cross-task blocking visibility |
| R2 | :624–1045 | 422 | Worker-driver carrier |
| R3 | :1046–1401 | 356 | the fan-in attempt reader |
| R4 | :1402–2373 | 972 | needs-human 显式承接（**实则含 3 个子簇**，见 §AC3-3） |
| R5 | :2374–2426 | 53 | Board: three-source join |
| R6 | :2427–2704 | 278 | Board landing cache |
| R7 | :2705–2955 | 251 | Git history |
| R8 | :2956–3036 | 81 | AC95: six new views（**2 个私有 helper，0 导出**） |
| R9 | :3037–3141 | 105 | System view |
| R10 | :3142–3243 | 102 | Manager view |
| R11 | :3244–3372 | 129 | promotion-driver round-carrier 短 TTL 缓存 |
| R12 | :3373–3572 | 200 | Driver 存活读取 |
| R13 | :3573–3791 | 219 | Tests view |
| R14 | :3792–3977 | 186 | verification-round 短 TTL 缓存 |
| R15 | :3978–4176 | 199 | Sessions view |
| R16 | :4177–4333 | 157 | `claude agents --json` discovery |
| R17 | :4334–4565 | 232 | Single-session view（**夹带 session 身份原语**，见 §AC3-3） |
| R18 | :4566–4628 | 63 | Architecture view |
| R19 | :4629–4672 | 44 | Branch model |

### AC2-3：完整导出 → 消费者 → 区域表（**197 行，全覆盖**）

口径：
- **生产消费者**列用短名（`serve-dash` = `serve-dashboard.ts`，`cli:driver` = `cli/driver.ts`，等）；`—` 表示**无生产消费者**。
- **测试消费者数**列 = 消费该符号的测试文件个数（测试文件身份见 §AC2-4 的反向索引——**每个导出对应的测试文件清单可由该索引唯一还原**，故本表不为每个导出重复罗列 46 个文件名）。
- **文件内引用**列 = 该导出在 `observation.ts` **内部**被引用的次数（已扣除声明行自身）。`0` 且无外部消费者 ⇒ 真死。

**⚠️ 本表的口径与 §AC2-0 有 1 个符号的差**（写出来避免读者误读）：本表「测试消费者数」列是**静态 import 计数**，因此它给出 **63 / 51 / 83**；而 §AC2-0 给出 **63 / 52 / 82**。差的正是 `:3416 getDriverRuntimeLoadError`——它的消费者是一条**生成式 import 缝**（`gap-dashboard-driver-status-card.test.mjs:313` 把它写进临时探针脚本再执行），**静态扫描看不见**，故本表把它记在 `测试消费者数 = 0`、落入 83 的无外部消费者组。**两处都对，只是读的不是同一个谓词**（硬规则 3b：读不懂输入的判定不许与「合格」同形——这里的处理是**把差异写明而不是抹平**）。

| # | 行 | 种类 | 导出 | 区域 | 生产消费者 | 测试消费者数 | 文件内引用 |
|---|---|---|---|---|---|---|---|
| 1 | :54 | const | `FAST_MODE_EVENTS_DIR` | R0 | — | 0 | 4 |
| 2 | :55 | const | `ORCHESTRATION_DIR` | R0 | — | 0 | 2 |
| 3 | :56 | const | `ESCALATIONS_FILE` | R0 | — | 0 | 1 |
| 4 | :57 | const | `TICK_LOG_FILE` | R0 | — | 0 | 2 |
| 5 | :58 | const | `GIT_LOG_LIMIT` | R0 | — | 0 | 1 |
| 6 | :60 | const | `JOURNAL_ESCALATION_SECTIONS` | R0 | — | 0 | 1 |
| 7 | :62 | const | `JOURNAL_TICK_SECTIONS` | R0 | — | 0 | 1 |
| 8 | :68 | const | `ESCALATIONS_STALE_DAYS` | R0 | — | 0 | 2 |
| 9 | :75 | const | `ACTIVITY_WINDOW_MS` | R0 | — | 0 | 1 |
| 10 | :77 | type | `ObservationStatus` | R0 | — | 0 | 21 |
| 11 | :86 | type | `LiveState` | R0 | — | 0 | 2 |
| 12 | :89 | interface | `ActivitySignals` | R0 | — | 0 | 4 |
| 13 | :105 | type | `RunLiveness` | R0 | — | 0 | 3 |
| 14 | :115 | type | `InFlightPhase` | R0 | serve-live | 0 | 2 |
| 15 | :120 | interface | `SuiteStateView` | R0 | serve-live | 0 | 2 |
| 16 | :131 | interface | `InFlightTask` | R0 | serve-dash | 0 | 12 |
| 17 | :198 | interface | `LiveResult` | R0 | serve-dash serve-live | 0 | 1 |
| 18 | :224 | interface | `JournalSection` | R0 | serve-live | 0 | 8 |
| 19 | :244 | interface | `JournalResult` | R0 | serve-live | 0 | 1 |
| 20 | :293 | function | `pairInFlight` | R0 | — | 0 | 8 |
| 21 | :385 | function | `readActivitySignals` | R0 | — | 0 | 1 |
| 22 | :420 | function | `decideLiveState` | R0 | — | 1 | 1 |
| 23 | :462 | interface | `BlockingTask` | R1 | — | 0 | 5 |
| 24 | :472 | function | `extractTouchesSection` | R1 | — | 0 | 3 |
| 25 | :514 | function | `parseTouchPaths` | R1 | — | 0 | 1 |
| 26 | :537 | function | `computeBlockingRelations` | R1 | — | 0 | 2 |
| 27 | :570 | function | `readTaskBlockingInputs` | R1 | — | 0 | 2 |
| 28 | :609 | function | `computeInFlightBlocking` | R1 | — | 0 | 3 |
| 29 | :642 | const | `WORKER_OUTCOME_REL` | R2 | — | 2 | 6 |
| 30 | :648 | const | `WORKER_ROUND_REL` | R2 | — | 1 | 4 |
| 31 | :655 | const | `FAN_IN_LOCK_EVENTS_REL` | R2 | — | 0 | 1 |
| 32 | :659 | const | `FULL_SUITE_STATE_REL` | R2 | — | 0 | 1 |
| 33 | :665 | const | `WORKER_PROCESS_NAME` | R2 | — | 2 | 3 |
| 34 | :671 | interface | `MechanicalFanInRecord` | R2 | — | 0 | 3 |
| 35 | :705 | interface | `WorkerOutcomeRecord` | R2 | serve-dash serve-task | 0 | 10 |
| 36 | :738 | function | `parseMechanicalFanIn` | R2 | — | 0 | 1 |
| 37 | :762 | interface | `ParsedWorkerOutcomes` | R2 | — | 0 | 1 |
| 38 | :779 | function | `parseWorkerOutcomeRecordsDetailed` | R2 | — | 1 | 3 |
| 39 | :820 | function | `parseWorkerOutcomeRecords` | R2 | — | 1 | 3 |
| 40 | :848 | function | `workerInFlightTasks` | R2 | — | 1 | 1 |
| 41 | :880 | interface | `LiveWorker` | R2 | — | 0 | 3 |
| 42 | :902 | function | `workerTaskIdFromCmdline` | R2 | — | 2 | 1 |
| 43 | :915 | function | `workerRepoRootFromCmdline` | R2 | — | 1 | 1 |
| 44 | :961 | function | `readLiveWorkerProcesses` | R2 | serve-task | 2 | 3 |
| 45 | :996 | function | `liveSessionIdForPid` | R2 | serve-task | 1 | 1 |
| 46 | :1012 | type | `CarrierTextStatus` | R2 | — | 0 | 1 |
| 47 | :1014 | interface | `CarrierText` | R2 | — | 0 | 1 |
| 48 | :1041 | function | `readWorkerOutcomeRecords` | R2 | serve-dash | 4 | 0 |
| 49 | :1069 | interface | `FanInAttempt` | R3 | — | 0 | 3 |
| 50 | :1087 | type | `FanInAttemptsStatus` | R3 | — | 0 | 1 |
| 51 | :1089 | interface | `FanInAttemptsResult` | R3 | cli:driver serve-nh | 0 | 1 |
| 52 | :1105 | function | `fanInAttemptFromRecord` | R3 | — | 1 | 1 |
| 53 | :1129 | function | `readFanInAttempts` | R3 | cli:driver mcp serve-nh serve-task | 1 | 1 |
| 54 | :1170 | function | `workerDriverOnlineMs` | R3 | — | 1 | 3 |
| 55 | :1278 | function | `workerDriverActive` | R3 | serve-task | 0 | 4 |
| 56 | :1292 | function | `readFanInLockAcquiredTasks` | R3 | — | 0 | 1 |
| 57 | :1333 | interface | `CurrentSuiteRun` | R3 | serve-dash | 0 | 1 |
| 58 | :1341 | function | `readCurrentSuiteRun` | R3 | serve-dash | 0 | 0 |
| 59 | :1361 | function | `readFullSuiteState` | R3 | — | 0 | 4 |
| 60 | :1391 | function | `deriveInFlightPhase` | R3 | — | 0 | 2 |
| 61 | :1413 | const | `PROMOTION_OUTCOME_REL` | R4 | — | 0 | 1 |
| 62 | :1417 | interface | `PromotionOutcomeRecord` | R4 | — | 0 | 3 |
| 63 | :1426 | function | `parsePromotionOutcomeRecords` | R4 | — | 1 | 1 |
| 64 | :1448 | function | `readNeedsHumanLedger` | R4 | serve-nh | 1 | 0 |
| 65 | :1483 | function | `readTaskAtRefMeta` | R4 | serve-task | 1 | 3 |
| 66 | :1520 | function | `readTaskStatusAtRef` | R4 | — | 3 | 3 |
| 67 | :1561 | const | `TASK_STATUS_REF_CACHE_TTL_MS` | R4 | — | 0 | 3 |
| 68 | :1574 | function | `resetSingleTaskGitSpawnCount` | R4 | — | 1 | 0 |
| 69 | :1575 | function | `getSingleTaskGitSpawnCount` | R4 | — | 1 | 0 |
| 70 | :1588 | function | `resetDevelopRefWalkCounts` | R4 | — | 1 | 0 |
| 71 | :1592 | function | `getDevelopRefFullWalkCount` | R4 | — | 1 | 0 |
| 72 | :1593 | function | `getDevelopRefBoundedWalkCount` | R4 | — | 1 | 0 |
| 73 | :1605 | function | `getTaskStatusRefBuildCount` | R4 | — | 1 | 0 |
| 74 | :1606 | function | `resetTaskStatusRefBuildCount` | R4 | — | 0 | 0 |
| 75 | :1608 | function | `clearTaskStatusRefCache` | R4 | — | 4 | 0 |
| 76 | :1645 | function | `readTaskStatusMapAtRef` | R4 | serve-board serve-task | 2 | 1 |
| 77 | :1678 | function | `readTaskTitleMapAtRef` | R4 | serve-task | 2 | 1 |
| 78 | :1758 | function | `readTaskCommitTimesAtRef` | R4 | serve-task | 2 | 2 |
| 79 | :1819 | function | `readTaskCommitTimeAtRef` | R4 | serve-task | 1 | 2 |
| 80 | :1843 | function | `refreshDevelopRefCaches` | R4 | — | 2 | 1 |
| 81 | :1860 | function | `startDevelopRefBackgroundRefresh` | R4 | serve | 0 | 0 |
| 82 | :1876 | function | `readTaskStatusForLive` | R4 | — | 0 | 4 |
| 83 | :1896 | const | `DEFAULT_DRIVER_CAP` | R4 | serve-dash serve-live | 0 | 5 |
| 84 | :1923 | function | `readLive` | R4 | serve-dash serve-live | 6 | 37 |
| 85 | :2365 | function | `readJournal` | R4 | serve-live | 3 | 0 |
| 86 | :2404 | const | `IN_FLIGHT_TIMEOUT_MINUTES` | R5 | — | 0 | 2 |
| 87 | :2406 | interface | `BoardLanding` | R5 | serve-board | 0 | 4 |
| 88 | :2418 | interface | `BoardExecution` | R5 | serve-board | 0 | 1 |
| 89 | :2438 | const | `LANDING_CACHE_TTL_MS` | R6 | — | 1 | 2 |
| 90 | :2442 | const | `LANDING_TIMEOUT_MS` | R6 | — | 0 | 3 |
| 91 | :2446 | function | `clearLandingCache` | R6 | — | 4 | 0 |
| 92 | :2453 | function | `getLandingColdRunCount` | R6 | — | 2 | 0 |
| 93 | :2459 | interface | `ReadBoardLandingOpts` | R6 | — | 0 | 1 |
| 94 | :2475 | function | `readBoardLanding` | R6 | serve-board | 2 | 4 |
| 95 | :2556 | function | `runProcessAliveSync` | R6 | — | 2 | 4 |
| 96 | :2583 | function | `classifyRunLiveness` | R6 | — | 0 | 2 |
| 97 | :2590 | function | `isRunProcessAlive` | R6 | — | 0 | 1 |
| 98 | :2604 | function | `resetWorktreeFallbackWarnings` | R6 | — | 1 | 0 |
| 99 | :2637 | function | `taskWorktreeOpen` | R6 | — | 2 | 3 |
| 100 | :2680 | function | `readBoardExecution` | R6 | serve-board | 2 | 0 |
| 101 | :2720 | const | `GIT_HISTORY_LIMIT` | R7 | serve-git | 3 | 2 |
| 102 | :2735 | const | `GIT_HISTORY_ACTIVE_WINDOW_SEC` | R7 | — | 0 | 0 |
| 103 | :2738 | const | `GIT_HISTORY_MAINLINE_REFS` | R7 | — | 0 | 1 |
| 104 | :2740 | interface | `GitHistoryCommit` | R7 | serve-git | 0 | 2 |
| 105 | :2758 | interface | `GitHistoryResult` | R7 | serve-dash serve-git | 0 | 3 |
| 106 | :2802 | const | `GIT_HISTORY_REF_SCOPE` | R7 | — | 3 | 3 |
| 107 | :2823 | const | `GIT_HISTORY_CACHE_TTL_MS` | R7 | — | 1 | 1 |
| 108 | :2827 | function | `clearGitHistoryCache` | R7 | — | 3 | 0 |
| 109 | :2840 | type | `GitExec` | R7 | — | 0 | 3 |
| 110 | :2843 | const | `realGitExec` | R7 | — | 2 | 3 |
| 111 | :2846 | function | `readGitHistory` | R7 | serve-dash serve-git | 12 | 2 |
| 112 | :2917 | function | `parseDecorations` | R7 | — | 0 | 2 |
| 113 | :2924 | function | `primaryRefFromDecorations` | R7 | — | 0 | 1 |
| 114 | :2945 | function | `readGitRemotes` | R7 | serve-git | 1 | 0 |
| 115 | :3039 | interface | `ResourceGateReading` | R9 | serve-sys | 0 | 3 |
| 116 | :3055 | interface | `ProcessBudgetReading` | R9 | — | 0 | 3 |
| 117 | :3064 | interface | `SystemResult` | R9 | serve-dash serve-sys | 0 | 1 |
| 118 | :3078 | const | `RESOURCE_GATE_REL` | R9 | — | 0 | 1 |
| 119 | :3079 | const | `PROCESS_BUDGET_REL` | R9 | — | 0 | 1 |
| 120 | :3088 | function | `parseResourceGateJson` | R9 | — | 1 | 1 |
| 121 | :3105 | function | `parseProcessBudgetJson` | R9 | — | 1 | 1 |
| 122 | :3117 | function | `readSystem` | R9 | serve-dash serve-sys | 1 | 0 |
| 123 | :3144 | interface | `LoopDriverReading` | R10 | — | 0 | 4 |
| 124 | :3152 | interface | `SessionLivenessReading` | R10 | — | 0 | 2 |
| 125 | :3158 | interface | `ObserverRow` | R10 | — | 0 | 4 |
| 126 | :3172 | interface | `DriverKindReading` | R10 | serve-dash | 0 | 2 |
| 127 | :3185 | type | `DriversReading` | R10 | — | 0 | 5 |
| 128 | :3187 | interface | `ManagerResult` | R10 | serve-dash serve-sys | 0 | 7 |
| 129 | :3200 | const | `LOOP_DRIVER_CHECK_REL` | R10 | — | 0 | 1 |
| 130 | :3201 | const | `OBSERVER_REGISTRY_CONF` | R10 | — | 0 | 1 |
| 131 | :3204 | function | `parseLoopDriverJson` | R10 | — | 1 | 1 |
| 132 | :3216 | function | `parseObserverRegistry` | R10 | — | 1 | 1 |
| 133 | :3256 | const | `POOL_METRICS_CACHE_TTL_MS` | R11 | — | 1 | 3 |
| 134 | :3260 | function | `clearPoolMetricsCache` | R11 | — | 2 | 0 |
| 135 | :3267 | const | `PROMOTION_ROUND_REL` | R11 | — | 0 | 3 |
| 136 | :3271 | const | `PROMOTION_CAP_DEFAULT` | R11 | — | 0 | 1 |
| 137 | :3274 | const | `PROMOTION_FLOOR_MULT_DEFAULT` | R11 | — | 0 | 1 |
| 138 | :3279 | interface | `PromotionRoundRecord` | R11 | — | 0 | 3 |
| 139 | :3290 | function | `parsePromotionRoundRecords` | R11 | — | 1 | 1 |
| 140 | :3416 | function | `getDriverRuntimeLoadError` | R12 | — | 0 | 0 |
| 141 | :3446 | function | `clearDriverStatusCache` | R12 | — | 1 | 0 |
| 142 | :3466 | function | `readDriverStatus` | R12 | — | 1 | 2 |
| 143 | :3505 | function | `readManagerLight` | R12 | serve-dash | 1 | 0 |
| 144 | :3526 | function | `readManager` | R12 | serve-sys | 4 | 4 |
| 145 | :3575 | interface | `TestRunRecord` | R13 | serve-tests | 0 | 7 |
| 146 | :3641 | type | `TestsStatus` | R13 | — | 0 | 6 |
| 147 | :3643 | interface | `TestsResult` | R13 | serve-dash serve-tests | 0 | 5 |
| 148 | :3663 | interface | `RoundWriterPath` | R13 | — | 0 | 2 |
| 149 | :3672 | const | `ROUND_WRITER_LOOP_KEYS` | R13 | — | 0 | 1 |
| 150 | :3678 | function | `detectRoundWriterPath` | R13 | — | 1 | 3 |
| 151 | :3713 | const | `VERIFICATION_ROUND_REL` | R13 | — | 0 | 0 |
| 152 | :3716 | function | `parseVerificationRound` | R13 | — | 2 | 1 |
| 153 | :3801 | const | `VERIFICATION_ROUND_CACHE_TTL_MS` | R14 | — | 1 | 3 |
| 154 | :3805 | function | `clearVerificationRoundCache` | R14 | — | 9 | 0 |
| 155 | :3812 | function | `readTests` | R14 | serve-dash serve-tests | 8 | 5 |
| 156 | :3921 | const | `ROUNDS_PARSE_CHUNK_LINES` | R14 | — | 1 | 4 |
| 157 | :3925 | function | `yieldToEventLoop` | R14 | serve-board serve-dash | 0 | 1 |
| 158 | :3943 | function | `readTestsNonBlocking` | R14 | serve-dash | 1 | 3 |
| 159 | :3980 | interface | `SessionMessage` | R15 | — | 0 | 4 |
| 160 | :3986 | type | `SessionLayer` | R15 | — | 0 | 3 |
| 161 | :3988 | interface | `SessionDetail` | R15 | serve-sess | 0 | 5 |
| 162 | :4011 | type | `SessionLifecycleValue` | R15 | — | 0 | 1 |
| 163 | :4013 | type | `SessionActivityValue` | R15 | — | 0 | 1 |
| 164 | :4023 | interface | `SessionLayeredState` | R15 | — | 0 | 3 |
| 165 | :4031 | const | `SESSION_ACTIVITY_WINDOW_MS` | R15 | — | 0 | 1 |
| 166 | :4046 | function | `buildSessionLayeredState` | R15 | — | 0 | 2 |
| 167 | :4076 | function | `attachValidatedSession` | R15 | — | 0 | 2 |
| 168 | :4094 | function | `classifySessionLayer` | R15 | — | 1 | 2 |
| 169 | :4103 | const | `SESSION_LAYERS` | R15 | serve-sess | 0 | 0 |
| 170 | :4110 | interface | `SessionsResult` | R15 | serve-sess | 0 | 1 |
| 171 | :4116 | const | `SESSIONS_TRANSCRIPT_MAX_MSGS` | R15 | — | 0 | 1 |
| 172 | :4117 | const | `SESSIONS_TRANSCRIPT_TAIL_BYTES` | R15 | — | 0 | 1 |
| 173 | :4125 | function | `readTranscriptTail` | R15 | — | 2 | 2 |
| 174 | :4186 | interface | `ClaudeAgentRow` | R16 | — | 0 | 2 |
| 175 | :4198 | function | `parseClaudeAgentsJson` | R16 | — | 1 | 1 |
| 176 | :4237 | const | `SESSIONS_ENDED_MAX` | R16 | — | 0 | 2 |
| 177 | :4270 | function | `readSessions` | R16 | serve-sess | 1 | 0 |
| 178 | :4342 | const | `SESSION_ID_RE` | R17 | — | 0 | 1 |
| 179 | :4345 | const | `SESSION_VIEW_TRANSCRIPT_TAIL_BYTES` | R17 | — | 0 | 1 |
| 180 | :4348 | const | `SESSION_VIEW_INITIAL_TURNS` | R17 | serve-sess | 1 | 0 |
| 181 | :4350 | const | `SESSION_VIEW_EARLIER_CHUNK` | R17 | serve-sess | 1 | 0 |
| 182 | :4352 | function | `isValidSessionId` | R17 | serve-send serve-sess serve-task | 2 | 3 |
| 183 | :4358 | function | `projectSlug` | R17 | — | 1 | 2 |
| 184 | :4367 | function | `sessionTranscriptPath` | R17 | serve-send serve-sess | 2 | 3 |
| 185 | :4372 | type | `TranscriptBlock` | R17 | serve-sess | 0 | 3 |
| 186 | :4379 | interface | `TranscriptTurn` | R17 | serve-sess | 0 | 4 |
| 187 | :4385 | interface | `SessionViewResult` | R17 | serve-sess | 0 | 1 |
| 188 | :4419 | function | `transcriptContentBlocks` | R17 | — | 1 | 1 |
| 189 | :4502 | function | `parseTranscript` | R17 | — | 1 | 2 |
| 190 | :4534 | function | `readTranscript` | R17 | serve-sess | 2 | 1 |
| 191 | :4557 | function | `readSession` | R17 | serve-sess | 1 | 0 |
| 192 | :4568 | interface | `ArchComponent` | R18 | — | 0 | 2 |
| 193 | :4577 | interface | `ArchitectureResult` | R18 | serve-arch | 0 | 1 |
| 194 | :4585 | const | `ARCH_RECENT_WINDOW_DAYS` | R18 | serve-arch | 1 | 1 |
| 195 | :4588 | function | `readArchitecture` | R18 | serve-arch | 0 | 0 |
| 196 | :4640 | interface | `BranchNames` | R19 | — | 0 | 1 |
| 197 | :4651 | function | `readBranchModel` | R19 | serve | 0 | 0 |

### AC2-4：反向索引——每个消费者文件导入了哪些符号（60 行，与上表互补）

上表按导出展开，本表按消费者展开；两表合起来给出**完整的 (文件, 符号) 映射**（237 对）。

| 消费者文件 | 类别 | 符号数 | 导入的符号 |
|---|---|---|---|
| `packages/quay/src/cli/driver.ts` | prod | 2 | `FanInAttemptsResult` `readFanInAttempts` |
| `packages/quay/src/mcp-server.ts` | prod | 1 | `readFanInAttempts` |
| `packages/quay/src/serve-architecture.ts` | prod | 3 | `ARCH_RECENT_WINDOW_DAYS` `ArchitectureResult` `readArchitecture` |
| `packages/quay/src/serve-board.ts` | prod | 6 | `BoardExecution` `BoardLanding` `readBoardExecution` `readBoardLanding` `readTaskStatusMapAtRef` `yieldToEventLoop` |
| `packages/quay/src/serve-dashboard.ts` | prod | 19 | `CurrentSuiteRun` `DEFAULT_DRIVER_CAP` `DriverKindReading` `GitHistoryResult` `InFlightTask` `LiveResult` `ManagerResult` `SystemResult` `TestsResult` `WorkerOutcomeRecord` `readCurrentSuiteRun` `readGitHistory` `readLive` `readManagerLight` `readSystem` `readTests` `readTestsNonBlocking` `readWorkerOutcomeRecords` `yieldToEventLoop` |
| `packages/quay/src/serve-git.ts` | prod | 5 | `GIT_HISTORY_LIMIT` `GitHistoryCommit` `GitHistoryResult` `readGitHistory` `readGitRemotes` |
| `packages/quay/src/serve-live.ts` | prod | 8 | `DEFAULT_DRIVER_CAP` `InFlightPhase` `JournalResult` `JournalSection` `LiveResult` `SuiteStateView` `readJournal` `readLive` |
| `packages/quay/src/serve-needs-human.ts` | prod | 3 | `FanInAttemptsResult` `readFanInAttempts` `readNeedsHumanLedger` |
| `packages/quay/src/serve-send.ts` | prod | 2 | `isValidSessionId` `sessionTranscriptPath` |
| `packages/quay/src/serve-sessions.ts` | prod | 13 | `SESSION_LAYERS` `SESSION_VIEW_EARLIER_CHUNK` `SESSION_VIEW_INITIAL_TURNS` `SessionDetail` `SessionViewResult` `SessionsResult` `TranscriptBlock` `TranscriptTurn` `isValidSessionId` `readSession` `readSessions` `readTranscript` `sessionTranscriptPath` |
| `packages/quay/src/serve-system.ts` | prod | 5 | `ManagerResult` `ResourceGateReading` `SystemResult` `readManager` `readSystem` |
| `packages/quay/src/serve-task.ts` | prod | 11 | `WorkerOutcomeRecord` `isValidSessionId` `liveSessionIdForPid` `readFanInAttempts` `readLiveWorkerProcesses` `readTaskAtRefMeta` `readTaskCommitTimeAtRef` `readTaskCommitTimesAtRef` `readTaskStatusMapAtRef` `readTaskTitleMapAtRef` `workerDriverActive` |
| `packages/quay/src/serve-tests.ts` | prod | 3 | `TestRunRecord` `TestsResult` `readTests` |
| `packages/quay/src/serve.ts` | prod | 2 | `readBranchModel` `startDevelopRefBackgroundRefresh` |
| `packages/quay/test/gap-ac136-web-truth-source.test.mjs` | test | 3 | `clearPoolMetricsCache` `parsePromotionRoundRecords` `readManager` |
| `packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs` | test | 4 | `ROUNDS_PARSE_CHUNK_LINES` `clearVerificationRoundCache` `readTests` `readTestsNonBlocking` |
| `packages/quay/test/gap-ac292-board-request-path-cold-build.test.mjs` | test | 4 | `clearLandingCache` `clearTaskStatusRefCache` `getLandingColdRunCount` `getTaskStatusRefBuildCount` |
| `packages/quay/test/gap-dashboard-driver-status-card.test.mjs` | test | 2 | `clearDriverStatusCache` `readDriverStatus` |
| `packages/quay/test/gap-dashboard-fanin-card-not-in-auto-refresh.test.mjs` | test | 1 | `readWorkerOutcomeRecords` |
| `packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs` | test | 2 | `readTests` `readWorkerOutcomeRecords` |
| `packages/quay/test/gap-dashboard-parallelize.test.mjs` | test | 11 | `GIT_HISTORY_CACHE_TTL_MS` `POOL_METRICS_CACHE_TTL_MS` `VERIFICATION_ROUND_CACHE_TTL_MS` `clearGitHistoryCache` `clearPoolMetricsCache` `clearVerificationRoundCache` `readGitHistory` `readLive` `readManager` `readManagerLight` `readTests` |
| `packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs` | test | 2 | `GIT_HISTORY_LIMIT` `readGitHistory` |
| `packages/quay/test/gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs` | test | 2 | `clearGitHistoryCache` `readGitHistory` |
| `packages/quay/test/gap-git-graph-decoration-labels-as-colored-chips.test.mjs` | test | 2 | `readGitHistory` `readGitRemotes` |
| `packages/quay/test/gap-git-graph-edge-fold-bends-at-child-for-first-parent-edges.test.mjs` | test | 1 | `readGitHistory` |
| `packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs` | test | 4 | `GIT_HISTORY_LIMIT` `clearGitHistoryCache` `readGitHistory` `realGitExec` |
| `packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs` | test | 2 | `GIT_HISTORY_REF_SCOPE` `readGitHistory` |
| `packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs` | test | 1 | `readGitHistory` |
| `packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs` | test | 1 | `readGitHistory` |
| `packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs` | test | 1 | `readGitHistory` |
| `packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` | test | 3 | `GIT_HISTORY_LIMIT` `GIT_HISTORY_REF_SCOPE` `readGitHistory` |
| `packages/quay/test/gap-webui-accent-palette-no-success-color.test.mjs` | test | 1 | `clearVerificationRoundCache` |
| `packages/quay/test/gap-webui-board-transient-columns-drowned-by-history.test.mjs` | test | 2 | `clearLandingCache` `runProcessAliveSync` |
| `packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs` | test | 1 | `clearVerificationRoundCache` |
| `packages/quay/test/gap-webui-list-table-no-overflow-container.test.mjs` | test | 1 | `clearVerificationRoundCache` |
| `packages/quay/test/gap-webui-tests-page-missing-rounds-timeline-bar.test.mjs` | test | 1 | `clearVerificationRoundCache` |
| `packages/quay/test/gap-webui-tests-page-timeline-gantt-truncated.test.mjs` | test | 1 | `clearVerificationRoundCache` |
| `packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs` | test | 1 | `clearVerificationRoundCache` |
| `packages/quay/test/helpers/git-ref-window.mjs` | test | 2 | `GIT_HISTORY_REF_SCOPE` `realGitExec` |
| `packages/quay/test/live-state.test.mjs` | test | 2 | `decideLiveState` `readLive` |
| `packages/quay/test/observation-worktree-namespace.test.mjs` | test | 6 | `WORKER_PROCESS_NAME` `readLiveWorkerProcesses` `resetWorktreeFallbackWarnings` `taskWorktreeOpen` `workerRepoRootFromCmdline` `workerTaskIdFromCmdline` |
| `packages/quay/test/observation.test.mjs` | test | 35 | `WORKER_OUTCOME_REL` `WORKER_PROCESS_NAME` `WORKER_ROUND_REL` `clearTaskStatusRefCache` `fanInAttemptFromRecord` `getDevelopRefBoundedWalkCount` `getDevelopRefFullWalkCount` `isValidSessionId` `parseClaudeAgentsJson` `parseTranscript` `parseVerificationRound` `parseWorkerOutcomeRecords` `parseWorkerOutcomeRecordsDetailed` `projectSlug` `readFanInAttempts` `readJournal` `readLive` `readLiveWorkerProcesses` `readSession` `readTaskAtRefMeta` `readTaskCommitTimeAtRef` `readTaskCommitTimesAtRef` `readTaskStatusAtRef` `readTaskStatusMapAtRef` `readTaskTitleMapAtRef` `readTranscript` `readTranscriptTail` `refreshDevelopRefCaches` `resetDevelopRefWalkCounts` `sessionTranscriptPath` `taskWorktreeOpen` `transcriptContentBlocks` `workerDriverOnlineMs` `workerInFlightTasks` `workerTaskIdFromCmdline` |
| `packages/quay/test/serve-ac95-views.test.mjs` | test | 9 | `classifySessionLayer` `parseLoopDriverJson` `parseObserverRegistry` `parseProcessBudgetJson` `parseResourceGateJson` `parseVerificationRound` `readManager` `readTests` `readTranscriptTail` |
| `packages/quay/test/serve-architecture-body-i18n.test.mjs` | test | 1 | `ARCH_RECENT_WINDOW_DAYS` |
| `packages/quay/test/serve-board-body-i18n.test.mjs` | test | 3 | `clearLandingCache` `readBoardExecution` `readBoardLanding` |
| `packages/quay/test/serve-board.test.mjs` | test | 8 | `LANDING_CACHE_TTL_MS` `clearLandingCache` `clearTaskStatusRefCache` `getLandingColdRunCount` `readBoardExecution` `readBoardLanding` `readTaskStatusAtRef` `runProcessAliveSync` |
| `packages/quay/test/serve-dashboard-body-i18n.test.mjs` | test | 1 | `readTests` |
| `packages/quay/test/serve-dashboard.test.mjs` | test | 3 | `WORKER_OUTCOME_REL` `readLive` `readWorkerOutcomeRecords` |
| `packages/quay/test/serve-handlers.test.mjs` | test | 6 | `isValidSessionId` `liveSessionIdForPid` `readGitHistory` `readLive` `readWorkerOutcomeRecords` `sessionTranscriptPath` |
| `packages/quay/test/serve-journal-body-i18n.test.mjs` | test | 1 | `readJournal` |
| `packages/quay/test/serve-manager-body-i18n.test.mjs` | test | 1 | `readManager` |
| `packages/quay/test/serve-needs-human.test.mjs` | test | 2 | `parsePromotionOutcomeRecords` `readNeedsHumanLedger` |
| `packages/quay/test/serve-sessions-body-i18n.test.mjs` | test | 1 | `readSessions` |
| `packages/quay/test/serve-sessions.test.mjs` | test | 3 | `SESSION_VIEW_EARLIER_CHUNK` `SESSION_VIEW_INITIAL_TURNS` `readTranscript` |
| `packages/quay/test/serve-system-body-i18n.test.mjs` | test | 1 | `readSystem` |
| `packages/quay/test/serve-task.test.mjs` | test | 8 | `clearTaskStatusRefCache` `getSingleTaskGitSpawnCount` `readTaskCommitTimesAtRef` `readTaskStatusAtRef` `readTaskStatusMapAtRef` `readTaskTitleMapAtRef` `refreshDevelopRefCaches` `resetSingleTaskGitSpawnCount` |
| `packages/quay/test/serve-tests-body-i18n.test.mjs` | test | 1 | `readTests` |
| `packages/quay/test/serve-tests-empty-state.test.mjs` | test | 3 | `clearVerificationRoundCache` `detectRoundWriterPath` `readTests` |
| `packages/quay/test/serve.test.mjs` | test | 2 | `readJournal` `readLive` |
| `plugin/test/third-party-capability-degradation.test.mjs` | test | 1 | `readTests` |

---

## AC3 — 纠缠组 vs 独立组（两类都有证据）

### AC3-0：模块级私有可变状态清单（**结论：存在，但全部单区域**）

检索命令（见 §AC6-3）。全文件 **17 个模块级可变绑定**：

| 行 | 绑定 | 形态 | 所属区域 | 被哪些同区域 decl 引用 |
|---|---|---|---|---|
| `:1563` | `taskStatusRefCache` | `Map`（短 TTL） | R4 | `readTaskAtRefMeta` / `clearTaskStatusRefCache` / `readTaskStatusMapAtRef` |
| `:1564` | `taskTitleRefCache` | `Map`（短 TTL） | R4 | `readTaskAtRefMeta` / `clearTaskStatusRefCache` / `readTaskTitleMapAtRef` |
| `:1568` | `taskCommitTimesRefCache` | `Map`（短 TTL） | R4 | `clearTaskStatusRefCache` / `readTaskCommitTimesAtRef` / `readTaskCommitTimeAtRef` |
| `:1573` | `singleTaskGitSpawnCount` | `let` 计数器 | R4 | `readTaskAtRefMeta` / `reset…` / `get…` / `readTaskCommitTimeAtRef` |
| `:1586` | `developRefFullWalkCount` | `let` 计数器 | R4 | `resetDevelopRefWalkCounts` / `get…` / `readTaskCommitTimesAtRef` |
| `:1587` | `developRefBoundedWalkCount` | `let` 计数器 | R4 | `resetDevelopRefWalkCounts` / `get…` / `readTaskCommitTimesAtRef` |
| `:1604` | `taskStatusRefBuildCount` | `let` 计数器 | R4 | `get…` / `reset…` / `readTaskStatusMapAtRef` |
| `:1887` | `NON_LIVE_TASK_STATUSES` | `ReadonlySet`（**只读**） | R4 | `readLive` |
| `:2443` | `landingCache` | `Map`（短 TTL） | R6 | `clearLandingCache` / `readBoardLanding` |
| `:2452` | `landingColdRunCount` | `let` 计数器 | R6 | `getLandingColdRunCount` / `readBoardLanding` |
| `:2598` | `worktreeFallbackWarned` | `Set` | R6 | `resetWorktreeFallbackWarnings` / `warnWorktreeFallback` |
| `:2824` | `gitHistoryCache` | `Map`（短 TTL） | R7 | `clearGitHistoryCache` / `readGitHistory` |
| `:3257` | `poolMetricsCache` | `Map`（短 TTL） | R11 | `clearPoolMetricsCache` / `readPoolMetrics` |
| `:3400` | `driverRuntimePromise` | `let`（memo） | R12 | `loadDriverRuntime` |
| `:3413` | `driverRuntimeLoadError` | `let`（memo） | R12 | `getDriverRuntimeLoadError` / `loadDriverRuntime` |
| `:3443` | `driverStatusCache` | `Map`（短 TTL） | R12 | `clearDriverStatusCache` / `readDriverStatus` |
| `:3802` | `verificationRoundCache` | `Map`（短 TTL） | R14 | `clearVerificationRoundCache` / `readTests` / `readTestsNonBlocking` |

**判据（可复核，见 §AC6-3）**：把注释剥离后，对每个绑定求「引用它的顶层声明所属的区域集合」，**17 个绑定的最大跨区域数全部 = 1**。

**⇒ 本调查对 AC3 最要紧的一条证据**：**不存在**跨区域共享的可变闭包状态。文件大**不是**「共享状态纠缠」造成的。这条与先例 `worker-driver.ts` 的结论同形（那边是「模块级可变状态 ≈ 0」），但**这里的形态不同且更强**：那边是「没有状态」，这边是「有 17 处状态，但每处都被区域封住」——**对拆分而言两者等价**，且后者说明**拆分连状态都不必动**（每个缓存跟自己的区域一起搬走即可）。

**⚠️ 一处必须点名的假命中**：`poolMetricsCache` 的裸 grep 会在 R13 的 `parseVerificationRound` 里命中一次——那是 `:3798` 的**注释**（「the same display-snapshot freshness the taskSummaryCache / poolMetricsCache already use」），不是引用。**这是硬规则 2 的实例：按位置判定，注释里提到不算命中。** 注释里提到的 `taskSummaryCache` 更是一个**已经不存在的缓存**（本文件无此标识符）。

### AC3-1：导出之间的互相调用（区域间引用图）

把每个顶层声明的函数体做**注释剥离**后匹配其它顶层声明的名字，得 **395 条文件内引用边**，其中**跨区域 132 条**。区域级邻接矩阵（只列非零）：

| 从 → 到 | 边数 | 说明 |
|---|---|---|
| R4 → R0 / R1 / R2 / R3 / R6 | 23 / 1 / 7 / 6 / 3 | **`readLive`（`:1923`）是 R4 里唯一的巨型枢纽** |
| R3 → R0 / R2 | 3 / 13 | fan-in 读取器**建在** worker-carrier 之上 |
| R0 → R4 | 1 | 仅 `JournalSection` → `staleSource`（一个类型→判定的孤边） |
| R6 → R0 / R4 / R5 | 2 / 1 / 4 | `readBoardExecution` → `readLive` |
| R12 → R0 / R10 / R11 | 1 / 11 / 2 | driver 存活读取**建在** manager 视图之上 |
| R11 → R10 | 3 | pool 缓存**建在** manager 视图之上 |
| R16 → R0 / R15 / R17 / R8 | 1 / 7 / 3 / 1 | agents 发现**建在** sessions 之上 |
| R15 → R0 / R17 | 3 / 1 | |
| R2 → R0 / R17 | 1 / 1 | **唯一一条**：`liveSessionIdForPid` → `isValidSessionId` |
| R9 → R0 / R8 | 3 / 1 | |
| R10 → R0 / R8 / R9 | 3 / 1 / 1 | |
| R17 / R18 / R5 / R7 / R1 / R3 | → R0 各 1–3 | |

### AC3-2：独立组（**可安全外移**，每组附依赖清单）

判据：**该区域（或区域并集）对区域外的引用边 = 0，或只依赖一个薄基座**。

| 独立组 | 区域 | 行数（估计） | 导出数 | **对外部区域的引用** | 独立度 |
|---|---|---|---|---|---|
| **Tests 域** | R13+R14 | **~405** | 14 | **0 条**（R13 完全自包含；R14→R13 是组内边） | ⭐ **最高——全文件唯一的零外部依赖域** |
| **Branch 域** | R19 | ~44 | 2 | **0 条** | ⭐ 最高（但很小） |
| **Git 域** | R7 | ~260 | 14 | R0 的 `ObservationStatus`（1 处） | 高 |
| **Architecture 域** | R18 | ~72 | 4 | R0 的 `ObservationStatus`（1 处） | 高 |
| **Sessions 域** | R15+R16+R17 | ~588 | 33 | R0 `ObservationStatus` + R8 `runScriptBounded` | 高 |
| **Drivers 域** | R9+R10+R11+R12 | ~536 | 30 | R0 `ObservationStatus`/`execFileP` + R8 `runPluginScript` | 高 |
| **Worker-carrier + fan-in** | R2+R3 | ~771 | 32 | R0（3 个类型）+ **R17 `isValidSessionId`** | 中（见下） |
| **Board 域** | R5+R6 | ~316 | 15 | R0 + **R4 `readLive`** | 中（见下） |

**两个必须点名的跨域耦合（拆分的真实路障，各有具体证据）**：

1. **`R2 → R17`（`liveSessionIdForPid` → `isValidSessionId`）**：worker-carrier 域要用 session 身份原语。修法二选一：把 `isValidSessionId`/`projectSlug`/`sessionTranscriptPath`/`SESSION_ID_RE`（R17 的 `:4342–4367`）**下沉到共享基座**（它们本来就是被 R2/R15/R16 **三方**共用的原语，放在「Single-session view」里是**位置错误**）；或在 R2 保留一个注入缝。
2. **`R6 → R4`（`readBoardExecution` → `readLive`）**：board 的执行侧**就是** live 读取器。⇒ **board 域必须在 live 域之后提取**，或把 `readLive` 注入。

### AC3-3：两个区域划分本身有缺陷（**顺带发现，供后续拆分任务参考**）

- **R4（972 行）一个 section 头下塞了三个簇**：`needs-human`/promotion-outcome（`:1413–1464`）、**task-at-ref**（`:1465–1875`，含全部 4 个 R4 可变绑定）、**live + journal**（`:1876–2373`，含 `readLive` 这个枢纽）。R4 的「对外依赖最多」（R0/R1/R2/R3/R6）**正是因为它是三个簇的并集**，不是因为三簇本身纠缠。
- **R17（232 行）夹带 session 身份原语**：`isValidSessionId` / `projectSlug` / `sessionTranscriptPath` / `SESSION_ID_RE`（`:4342–4367`）被 R2、R15、R16 **三方**引用，它们不属于「Single-session view」。

---

## AC4 — 可执行拆分方案

### AC4-0：拆前读数（SPEC §5 Phase 6 要求的三个量，各给基线）

| 判据 | 拆前读数 | 读法 |
|---|---|---|
| **扇入 × 扇出乘积** | 扇入 **60** × 扇出 **14** = **840** | 按 import 语句位置（§AC1-2/1-3）。archguard 口径的同族读数为 `145 入边 × 121 出边`（单位不同，见 §AC1-4） |
| **是否在环上** | **否**。全仓库 471 个非测试 `.ts` 的自写 import 图 SCC>1 个数 = **0**；`observation.ts` 不在任何 SCC 中 | Tarjan SCC，见 §AC6-5 |
| **import-graph 棘轮（Phase 0a）** | `plugin/import-graph-baseline.json` = `{valueSccs:0, typeSccs:0, reverseEdges:0}`；**实跑读数与之完全一致**（`evaluated:true, files:418, edges:1024, valueSccs:[], typeSccs:[], reverseEdges:[], verdict.ok:true`） | `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` |

> **⚠️ 关于第一条判据的一处诚实更正（建议后续任务改判据，不要照抄）**：
> 「扇入×扇出乘积」是**单模块**量，而**拆分必然增加模块数**——它在「残体单模块」读法下会下降（`observation.ts` 60×14=840 → 退化为桶后 60×~11=660），但在「全域求和」读法下**必然上升**（本次候选方案 Σ(模块扇入×模块扇出) ≈ 53 **只是新增项**，是全域集合的一个子集）。⇒ **同一个方案在两种读法下给出相反结论**，这个量不能当拆分成功判据。
> 这**不是本调查的推论**：SPEC §10.3 自己已把「扇入×扇出 ≤ N」列入 **⛔ 不作 AC**（「会回退且易被刷」）。**⇒ 建议后续拆分任务改用可判且不会两读的替代判据**：① **每模块的跨模块依赖数 ≤ 小常数**（本调查的主体数据：88% 的区域对外依赖 ≤ 2）；② **无新环**（棘轮 `valueSccs`/`typeSccs` 保持 0）；③ **棘轮不回升**（`reverseEdges` 保持 0）。这三条都**能取假、且只有一种读法**。

### AC4-1：方案（推荐）——按**读取源 / 页面路由**轴拆成 域模块 + 1 个薄基座

**回填方式（关键，风险缓解的核心）**：`packages/quay/src/observation.ts` **保留为 re-export 桶**：

```ts
// observation.ts — 旧 import 面（60 个消费者文件零改动）
export { readTests, readTestsNonBlocking, clearVerificationRoundCache, /* … */ } from "./observation/observation-tests.ts";
export { readSessions, readSession, readTranscript, /* … */ } from "./observation/observation-sessions.ts";
// …
```

⇒ **60 个消费者（14 生产 + 46 测试）的 import 语句一行都不用改**，测试迁移成本 = **0**。这是本方案与「直接改 46 个测试文件」路线的决定性差别。

**提取顺序（可执行规则，不可乱序）**：

> **规则**：一个区域**只有在它引用的所有跨区域符号都已经不在残体里**（即已提取、或已下沉到基座）**时**才能提取；否则会产生 `observation.ts → 子模块 → observation.ts` 的**新环**，当场触发 §AC4-0 的棘轮判据②失败。

按此规则拓扑排序（与 §AC3-2 的依赖表一一对应）：

| 序 | 候选子模块 | 含哪些区域 | 含哪些导出（要点） | 行数估计 | 外部依赖 |
|---|---|---|---|---|---|
| **0** | `observation-base.ts` | R8 + R0 的共享原语 | `ObservationStatus`（25 个导出引用它）、`execFileP`、`runScriptBounded`、`runPluginScript`、**并从 R17 下沉 session 身份原语**（`isValidSessionId`/`projectSlug`/`sessionTranscriptPath`/`SESSION_ID_RE`） | ~120 | 无 |
| **1** | `observation-tests.ts` | R13+R14 | `TestsStatus` `TestsResult` `TestRunRecord` `RoundWriterPath` `detectRoundWriterPath` `VERIFICATION_ROUND_REL` `parseVerificationRound` `clearVerificationRoundCache` `readTests` `readTestsNonBlocking` `yieldToEventLoop` …（14 个） | **~405** | **0**（除了 node 内建） |
| **2** | `observation-branch.ts` | R19 | `BranchNames` `readBranchModel` | ~44 | 无 |
| **3** | `observation-git.ts` | R7 | `GIT_HISTORY_*` `GitHistoryCommit` `GitHistoryResult` `GitExec` `realGitExec` `readGitHistory` `readGitRemotes` `parseDecorations` `clearGitHistoryCache` …（14 个） | ~260 | base |
| **4** | `observation-architecture.ts` | R18 | `ArchComponent` `ArchitectureResult` `ARCH_RECENT_WINDOW_DAYS` `readArchitecture` | ~72 | base |
| **5** | `observation-sessions.ts` | R15+R16+R17 | `readSessions` `SessionDetail` `SessionsResult` `SESSION_LAYERS` `readTranscript` `readSession` `SessionViewResult` `parseTranscript` `parseClaudeAgentsJson` …（去掉下沉到 base 的原语后 ~29 个） | ~540 | base |
| **6** | `observation-drivers.ts` | R9+R10+R11+R12 | `readSystem` `SystemResult` `ResourceGateReading` `readManager` `readManagerLight` `ManagerResult` `LoopDriverReading` `ObserverRow` `DriversReading` `readDriverStatus` `clearDriverStatusCache` `readPoolMetrics` `clearPoolMetricsCache` …（30 个） | ~536 | base |
| **7** | `observation-worker-carrier.ts` | R2+R3 | `WORKER_OUTCOME_REL` `WORKER_ROUND_REL` `WorkerOutcomeRecord` `parseWorkerOutcomeRecords(+Detailed)` `workerInFlightTasks` `LiveWorker` `readLiveWorkerProcesses` `readFanInAttempts` `FanInAttempt*` `workerDriverActive` `readFullSuiteState` `readCurrentSuiteRun` `deriveInFlightPhase` …（32 个） | ~771 | base（`readLive` 反向消费它，见序 9） |
| **8** | `observation-live.ts` | R1 + R4c（live/journal 簇） | `BlockingTask` `computeInFlightBlocking` `readLive` `readJournal` `DEFAULT_DRIVER_CAP` `InFlightPhase` `JournalResult` … | ~660 | base + 序 7（worker-carrier） |
| **9** | `observation-board.ts` | R5+R6 | `BoardLanding` `BoardExecution` `readBoardLanding` `readBoardExecution` `IN_FLIGHT_TIMEOUT_MINUTES` `runProcessAliveSync` `taskWorktreeOpen` …（15 个） | ~316 | base + 序 8（`readLive`） |
| **10** | `observation-task-at-ref.ts` | R4b | `readTaskAtRefMeta` `readTaskStatusAtRef` `readTaskStatusMapAtRef` `readTaskTitleMapAtRef` `readTaskCommitTimesAtRef` `readTaskCommitTimeAtRef` `refreshDevelopRefCaches` `startDevelopRefBackgroundRefresh` `clearTaskStatusRefCache` + 全部 4 个可变缓存/计数器 | ~410 | base + 序 8（`readTaskStatusForLive`） |
| **11** | `observation-needs-human.ts` | R4a | `PROMOTION_OUTCOME_REL` `PromotionOutcomeRecord` `parsePromotionOutcomeRecords` `readNeedsHumanLedger` | ~60 | base |
| — | `observation.ts`（残体 → 桶） | R0 剩余常量 + 全部 re-export | `FAST_MODE_EVENTS_DIR` `ORCHESTRATION_DIR` `GIT_LOG_LIMIT` … | ~120 | 全部子模块 |

**收益**：4671 行 → 残体约 120 行（**-97%**）；模块数 1 → 12；每个子模块的行数落在 **44–771**，跨模块依赖数 **0–3**。

**风险**：
- **低**——无跨区域可变状态可破（§AC3-0 实测 17/17 单区域）；
- **低**——无环（§AC4-0 实测 SCC=0），且按上表拓扑序提取**不会产生新环**；
- **中**——序 5 的 `isValidSessionId` 下沉是**语义判断**（判定它属于「session 身份原语」而非「单会话视图」），需人工确认；
- **已知成本**——**catalog / Touches**：若子模块放在 `packages/quay/src/observation/` 下，属产品层，**不触发 plugin catalog 六行门**；若放 `plugin/scripts/`，则每个新文件都要补 catalog 行（记忆条目「new plugin script needs six capability catalog rows」）。

### AC4-2：拆到哪为止（**反向证据**，不是「看起来复杂」）

建议**不要**继续把 §AC4-1 的子模块再拆成函数级模块，可检验依据：

1. **剩余区域已经是「一读一源」的最小单位**：R7 = 只读 git 历史；R18 = 只读 packages/* 的 git facts；R19 = 只读分支模型。再拆会得到**单函数模块**，只增加文件数不降低任何依赖（每模块对外依赖已是 0–1）。
2. **出口面 41.6% 无外部消费者**（§AC2-0）：82 个导出的 `export` 关键字**没有外部收益**。**这比继续拆结构更值得做的前置动作是**：先把 79 个「仅文件内使用」的导出改为私有（去掉 `export`），把 3 个真死导出删除。**这会把「搬家要带走的公共面」从 197 缩到约 115**，直接降低每一步拆分的 re-export 桶体积与后续维护面。
3. **该文件从未拆过**（§AC1-1：re-export = 0），而 `worker-driver.ts` 已经拆过 5 个兄弟模块。⇒ 第一步的边际收益最大，后续递减。

---

## AC5 — 对 SPEC 假说的检验

**SPEC §5 Phase 6 的假说**：`observation.ts` 按**视图域**切分为 `dashboard / sessions / tests / 收敛观测`（四个）。

**用 §AC2 的消费者分组数据检验（判据：一个「域」必须同时满足 ① 存在一组导出被同一批消费者消费、② 该组在文件内位置上连续、③ 组内互相调用多于组外）**：

| SPEC 假说轴 | 数据结论 | 证据 |
|---|---|---|
| **sessions** | ✅ **成立** | `serve-sessions` 消费 **13 个**导出，全部落在 **R15+R16+R17** 三区域（`serve-sessions` 的 region 分布：R17:9 R15:3 R16:1）。组内边 11 条（R16→R15:7, R16→R17:3, R15→R17:1），组外仅 R0/R8。**位置连续 ✓、组内调用占优 ✓** |
| **tests** | ✅ **成立** | `serve-tests` → R13:2 R14:1；`serve-dashboard` → R14:3 R13:1。R13+R14 对外部区域依赖 **0**。**位置连续 ✓、自包含 ✓** |
| **dashboard** | ❌ **不成立** | `serve-dashboard` **跨 10 个区域**消费（R0:2 R2:2 R3:2 R4:2 R7:2 R9:2 R10:2 R12:1 R13:1 R14:3）。**它是一个扇入汇点（页面），不是一个域（模块）**。把它当切分轴会把 10 个区域判给同一个「dashboard 模块」——那是把文件换个名字，不是拆分。 |
| **收敛观测** | ❌ **找不到对应物** | 数据里最接近的是 R10（Manager view）+ R11（promotion 缓存）+ R12（driver 存活）。但它们的消费者是 **`serve-system` + `serve-dashboard`**，不存在一个「收敛观测」专属消费者。R11 甚至**零生产消费者**（只有 serve-dashboard 经 R12 间接用）。 |
| —（SPEC 未提，但数据成立） | **另外 7 个域** | **git**（R7，`serve-git` 5/5 独占）、**board**（R5+R6）、**task-at-ref**（R4b）、**worker-carrier + fan-in**（R2+R3）、**live/journal**（R0+ R4c）、**architecture**（R18，`serve-architecture` 3/3 独占）、**branch**（R19） |

**⇒ 以数据为准的结论**：
1. 四个假说轴里 **2 个成立**（sessions / tests），**1 个是类别错误**（dashboard —— 它是消费者不是域），**1 个无对应物**（收敛观测）。
2. 真实切分轴是 **「读取源 / 页面路由」**，给出 **11 个域**（§AC4-1），不是 4 个。
3. **两个 1:1 的强信号**（域边界最干净的证据）：`serve-git` ↔ R7（5 个导出全部来自 R7，无其它来源）、`serve-architecture` ↔ R18（3/3）。**当一个消费者文件 100% 只消费一个区域的导出时，该区域就是它的域**——这是「页面 = 模块」的最硬证据。
4. **一处结构性错配**（值得单独记）：SPEC 的「dashboard」之所以看起来像域，是因为 `serve-dashboard` 是**先有页面后有读取层**长出来的——它把 10 个源的读取函数都拉到自己名下。**真正的修法不是把 10 个源合成一个 dashboard 模块，而是承认它们本来就是 11 个域、dashboard 只是其中一个消费者。**

---

## AC6 — 可复核命令（读者可独立重跑本文每个数字）

全部命令在任务 worktree 根目录执行：

```bash
cd /home/yale/work/quay-worktrees/gap-arch-observation-ts-consumer-grouping-investigation
```

**(1) AC1-1 行数与导出构成**

```bash
wc -l packages/quay/src/observation.ts                                  # 4671
grep -c "^export " packages/quay/src/observation.ts                      # 197
grep -cE "^export (async )?function " packages/quay/src/observation.ts   # 93  function
grep -cE "^export const "            packages/quay/src/observation.ts    # 48  const
grep -cE "^export interface "        packages/quay/src/observation.ts    # 43  interface
grep -cE "^export type "             packages/quay/src/observation.ts    # 13  type
grep -cE "^export \{|^export \*|^export (class|enum|default) " packages/quay/src/observation.ts   # 0
# 私有顶层声明（65）
grep -nE "^(const|let|var|function|async function|class|interface|type|enum) " packages/quay/src/observation.ts \
  | grep -vE "^[0-9]+:export " | wc -l                                  # 65
```

**(2) AC1-2 真实扇入 60（⚠️ 必须用跨行谓词，行式 grep 会漏 4 个）**

```bash
{ find . -name '*.ts' -not -path './node_modules/*' -not -path './.claude/*' \
       -not -path './.archguard/*' -not -path './archive/*' -print0;
  find . \( -name '*.mjs' -o -name '*.js' \) -not -path './node_modules/*' -not -path './.claude/*' \
       -not -path './.archguard/*' -not -path './archive/*' -print0; } \
| xargs -0 perl -0777 -ne \
  'if (/\b(?:import|export)[^;]*?\bfrom\s*["\x27]([^"\x27]*observation(?:\.ts)?)["\x27]/s) { print "$ARGV\n" }' 2>/dev/null \
| sed 's|^\./||' | sort -u | wc -l
# 60
# 对照：同一条谓词只跑 .ts ⇒ 14（= 生产消费者）；只跑 .mjs/.js ⇒ 46（= 测试消费者）

# ⛔ 错误的行式谓词（会量到 56，不是 60）—— 留在这里当反例，读者可自行复现差异：
grep -rlE "^[[:space:]]*(import|export)[^;]*from[[:space:]]+[\"'][^\"']*observation(\.ts)?[\"']" \
  --include='*.ts' --include='*.mjs' --include='*.js' . 2>/dev/null \
  | grep -vE "node_modules|/\.claude/|/\.archguard/|/archive/" | wc -l
# 56   ← 少的 4 个正是多行 import 的文件（差异用 diff 可逐行核对）

# 零计数的配套动作（硬规则 2 的另一半）：把谓词对着【已知为真】的样本干跑
# 把 observation 换成 observation-not-a-module ⇒ 两版谓词都应给 0
```

**(3) AC3-0 模块级可变状态（列 0 声明），以及「全部单区域」的自检**

```bash
grep -nE "^(let|var) " packages/quay/src/observation.ts                  # 7 个 let
grep -nE "^const [A-Za-z0-9_$]+ *(: *[^=]+)?= *new (Map|Set)" packages/quay/src/observation.ts   # 10 个容器（含 1 个 ReadonlySet）
# ⇒ 17 个可变绑定（7 let + 9 可变 Map/Set + 1 ReadonlySet）
```

「每个绑定只被单一区域引用」的完整判定见 §AC6-6 的脚本（注释剥离后求引用者所属区域集合，最大值为 1）。

**(4) AC4-0 三个拆前读数**

```bash
# ① 扇入×扇出：扇入见 (2) = 60；扇出：
grep -oE "from \"[^\"]+\"" packages/quay/src/observation.ts | sort -u | wc -l      # 14
grep -oE "from \"[^\"]+\"" packages/quay/src/observation.ts | sort -u              # 逐条列出
# ② 无环 / ③ 棘轮（Phase 0a 正本仪器）：
cat plugin/import-graph-baseline.json                                             # {valueSccs:0,typeSccs:0,reverseEdges:0}
node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts --json
# evaluated:true, valueSccs:[], typeSccs:[], reverseEdges:[], verdict.ok:true
```

**(5) AC1-4 与 SPEC 的 105/112 对账（archguard 口径，需先 analyze）**

```bash
# 先用 archguard 工具：archguard_analyze({lang:"typescript", sources:["packages/quay/src"], format:"json"})
# 再对 .archguard/query/<globalScopeKey>/arch.json 求：observation.ts 的实体数 / 入边 / 出边
node -e '
const fs=require("fs");
const key=JSON.parse(fs.readFileSync(".archguard/query/manifest.json","utf8")).globalScopeKey;
const d=JSON.parse(fs.readFileSync(".archguard/query/"+key+"/arch.json","utf8"));
const OBS="packages/quay/src/observation.ts";
const obs=new Set(d.entities.filter(e=>e.id.startsWith(OBS+".")).map(e=>e.id));
const inR=d.relations.filter(r=>obs.has(r.target)), outR=d.relations.filter(r=>obs.has(r.source));
console.log("entities",obs.size,"| in-edges",inR.length,"| out-edges",outR.length,
  "| total entities",d.entities.length,"| total relations",d.relations.length);
'
# 实测：entities 140 | in-edges 145 | out-edges 121 | total 782/1648
# （SPEC 写的是 446/908 —— 基线已过期，见 §AC1-4 原因 2）
```

**(6) 完整分析脚本（本文全部「区域图 / 消费者映射 / 可变状态单区域」结论的生成器）**

本调查的四个生成脚本**按设计放在仓库外**（`/tmp/`），以免污染本任务的 diff：

| 脚本 | 作用 | 产物 |
|---|---|---|
| `/tmp/obs-analyze2.mjs <root>` | 197 导出 → 消费者映射（多行 import 感知、命名空间 import 感知） | `/tmp/obs-map.json` |
| `/tmp/obs-graph.mjs <root>` | 注释剥离 + 按本文件 section 头切区域 + 区域间引用矩阵 | `/tmp/obs-graph.json` |
| `/tmp/obs-table.mjs <root>` | 生成 §AC2-3 的 197 行表 | `/tmp/obs-table.md` |
| `/tmp/obs-mutable.mjs <root>` | 「每个可变绑定只被单一区域引用」的自检 | stdout |
| `/tmp/obs-plan.mjs <root>` | §AC4-1 方案的逐模块扇入/扇出投影 | stdout |

**为什么放在仓库外**：本任务的 `Touches` 只有调查文档与任务文件本身（`docs/analysis/…` + `tasks/…`）。把生成器塞进仓库会**扩大本次 diff 的承载面**，且它们是**一次性的取证工具**，不是产品件（正本纪律：新脚本进仓库要连带 catalog 六行门）。⇒ **读者若要复跑，把上表脚本内容贴进 `/tmp/` 即可**；本文所有数字都能由 §AC6 (1)–(5) 的内联命令独立重跑，脚本只是把它们批量化的便捷路径。

**反例对照（证明每个判据都能取假，硬规则 3b）**：

| 判据 | 取假对照 | 预期 |
|---|---|---|
| 扇入谓词 | 把 `observation` 换成 `observation-nope` | 0（而非 60） |
| 「无外部消费者」判定 | 对 `getDriverRuntimeLoadError` 手工找生成式 import | 找得到（`gap-dashboard-driver-status-card.test.mjs:313`）⇒ 该判定**能取假** |
| 「注释不算命中」 | 对 `poolMetricsCache` 裸 grep，再对注释剥离后的源码 grep | 前者命中 R13，后者**只命中 R11** |
| 棘轮仪器 | `node … import-graph-check.ts --selftest` | 注入用例变红 |

---

## 附：本调查未做的事（边界声明，防止本文被当作用尽）

1. **未做**：`observation.ts` 的**函数体逐行精读**。区域归属来自声明名 + 区域级引用矩阵，不是逐行审计。⇒ §AC4-1 的行数估计是**声明跨度之和**，±5% 量级。
2. **未量化**：**运行期耦合**。`observation.ts` 通过 `resolvePluginScript` 动态载入 `driver-runtime.ts`（`:3430`），并大面积 `spawn`/`execFile` 外部脚本；SPEC §7 已自陈这类耦合「本文未量化」。本调查沿用了这一边界。
3. **未覆盖**：`plugin/vendor/quay/dist/quay.js`（打包产物）与 `.claude/worktrees/` 下的副本——按源码树纪律排除；SPEC §1.3 记载的「上一轮 397 个 .sh 被 `.claude/worktrees` 污染」正是此类（硬规则 2）。
4. **未判定**：79 个「仅文件内使用」的导出中，哪些是**有意的测试注入缝**（如各 `clear*Cache`/`reset*`/`get*Count` 对）而该保留 `export`。§AC4-2 把它们整体列为「先收口再拆」的动作，但**逐个归类需要消费者意图判断**，超出本次取证范围。
