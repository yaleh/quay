---
id: gap-routine-architecture-analysis-plugin-scripts-flat-god-directory
title: "architecture-analysis: archguard god-package: plugin/scripts = 299
  top-level .ts, 4466 entities, 189347 lines, fanOut 3163 with fanIn 0 — one
  flat namespace where any script may im"
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
archguard god-package: plugin/scripts = 299 top-level .ts, 4466 entities, 189347 lines, fanOut 3163 with fanIn 0 — one flat namespace where any script may import any other, so no structural boundary (cycle ratchet only) separates kernel, drivers, checkers and routines.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792599464308` · ts `2026-10-21T16:17:44.308Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`resolveWorkerProcessName`、`runAutoTightenPass`、`isFinalState`、`readJsonLines`、`readJsonlLines`
- 涉及文件：
- `plugin/scripts/worker-driver.ts:602`
- `plugin/scripts/gate-script-base.ts:434`
- `plugin/scripts/driver-runtime.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Introduce domain subdirectories (drivers/ checkers/ routines/ lib/) with an import-graph allowlist extending the existing import-graph-baseline.json; move incrementally, one domain per task.

## Disposition

复核时间 2026-10-22，worktree `gap-routine-architecture-analysis-plugin-scripts-flat-god-directory` @ develop `ce33c06e7`。

### 1. 读数复核：两个静态量与行数**逐字命中**，但 fanIn/fanOut 是**分析拓扑的产物**

| 量 | finding | 本次实测 | 命令 |
|---|---|---|---|
| top-level `.ts` | 299 | **299** | `git ls-files 'plugin/scripts/*.ts' \| wc -l` |
| 总行数 | 189347 | **189347** | `git ls-files 'plugin/scripts/*.ts' \| xargs wc -l \| tail -1` |
| entityCount / fanOut / fanIn | 4466 / 3163 / 0 | 逐字命中 | `.archguard/metrics-history.jsonl` 的 `plugin/scripts` 行（2026-10-20T16:22:01Z … 2026-10-21T07:56:04Z） |

**但后三个数不是树的稳定读数**：同一个 runner 在 **2026-10-21T16:18:01.555Z**（finding 立案时刻
16:17:44.308Z 之后 17 秒）把同一棵树记成了 **285 个逐文件伪包**，其中**根本没有 `plugin/scripts` 这个包**
（2026-10-11T15:37:43Z 同样记录 270 个逐文件包，也没有该包）。⇒ `fanOut 3163 / fanIn 0` 只在「六个 source
各自单独分析、`plugin/scripts` 作为单个 `(root)` 包」这一拓扑下存在；换一次分析拓扑它们就消失。
这正是 `plugin/scripts/import-graph-check.ts` 文件头早已记录的同一件事（archguard 把该目录当成单个
`(root)` 包）。`fanIn 0` 更是结构恒等式——它是 source root，没有任何 scope 把整个包 import 进来，
按硬规则 4 它不是测量。

**独立直读（不经过 archguard 的包推断）**：`import-graph-check.ts --json` 读到
`files 487 / edges 1405 / valueSccs 0 / typeSccs 0 / reverseEdges 0 / kernelChecked true / gateLayerChecked true`；
其中 `plugin/scripts/**` 内部边 **832** 条。对 299 个 top-level 文件算入度：
**max 228（`gate-script-base.ts`）、中位 0、163/299 入度为 0**（入口脚本，无人 import）。
⇒ 真实结构不是「一团乱麻」，而是「163 个入口 + 一个被 228 个文件依赖的共享基底 + 其余共享池」；
它缺的是**领域边界**，不是「内部缠结」。

### 2. finding 的可执行部分成立

- 目录架构：`plugin/scripts/` 下唯一子目录是 `checker-mutation-cases/`（92 个 fixture），
  **没有** drivers/checkers/routines/lib 任何一层。成立。
- 「任何脚本可以 import 任何另一个」：成立，实测跨域边（按语句位置，非注释）——
  - `plugin/scripts/driver-runtime.ts:50` → `gate-script-base.ts`（kernel → checker 基底）
  - `plugin/scripts/driver-runtime.ts:82` → `routine-scheduler.ts`（kernel → 例程基础设施）
  - `plugin/scripts/worker-driver.ts:148` → `target-identity-literal-check.ts`（driver → checker）

### 3. 已有机制在管哪一部分、失败在哪一步（AC2 的答案）

| 机制 | 管什么 | 失败在哪一步 |
|---|---|---|
| `plugin/scripts/import-graph-check.ts`（已接 `runner-static-gate.ts`；基线 `plugin/import-graph-baseline.json`） | 值级/类型级 SCC、产品层→方法学层反向边、kernel 边界、provider→Core gate 层 | **没有 domain 维度**。其文件头把测量对象定义为「层间越界」，一个**无环的扁平命名空间**按定义通过；本次实测 0/0/0 全绿，而本 finding 描述的正是这个绿读数覆盖不到的维度。⇒ 它的 PASS ⛔ 不能读作「god-package 已被处置」。 |
| `plugin/scripts/archguard-runner.ts`（已接 suite） | 每次 analyze 记 `maxInDegree/maxOutDegree` 进 `.archguard/metrics-history.jsonl` | ①**只记录不判定**：`:20-21` 明写 god-package 是需要阈值的维度、**留待数据积累**；②载体 `.archguard/` 是 gitignored（`.gitignore:542`），跨机/重新 clone 即消失，不构成棘轮；③读数随分析拓扑变化（见 §1）。 |
| `git-lens-l-g-structural-drift.ts` | 唯一带 god-module 阈值的仪器（默认 400 行 / fan-in 5） | **已退役**：归档在 `archive/2026-09-07-zero-call-scripts/`，零生产调用点，未接 suite。 |
| `plugin/probes/architecture-analysis.md` + `routine-file-gate.ts` 三道闸 | 把 god-package 变成 finding 并立案 | 只产出 finding；该探针规格未声明 `remedy_availability` ⇒ 立案记录为 `not-declared`（见 `.quay/routine-findings.jsonl` 本条 run 的 filing-round 记录），即不携带任何「可执行性」判定。 |

⇒ **没有任何机制在 `plugin/scripts` 里强制 domain 边界，也没有任何棘轮量住扁平度。**
finding 成立，不是过期项。

### 4. Requested action 不能作为单任务机械执行——扁平命名空间是**承重**的

请求的动作（建 drivers/checkers/routines/lib 并移动文件）会同时打断四处「假定 sibling 同目录」的机制：

1. `packages/quay/scripts/build-plugin-dist.mjs:81` 用
   `/(?:\$\{CLAUDE_PLUGIN_ROOT\}\/|plugin\/)(scripts|gate-scripts)\/([A-Za-z0-9_.-]+\.ts)/g` 发现入口，
   产物固定输出到 `scripts/dist/<name>.js`（`:27`）——子目录会同时改变发现规则与产物布局。
2. `plugin/scripts/driver-runtime.ts:355` `resolveKernelSibling(name)` = `path.join(dir, name)`：
   驱动按**同目录 sibling** 解析脚本，移走即解析不到。
3. `plugin/scripts/select-static-checks-for-touches.ts:184`：shipped check-set 由
   `ls plugin/scripts/*.{sh,ts,mjs}` **top-level glob** 推导；移入子目录的文件会**静默退出** check-set。
4. `experiments/quay-perpetual-stream/scripts/` 下 **61 个符号链接**指向 `../../../plugin/scripts/<name>`
   （`git ls-files -s … | awk '$1=="120000"' | wc -l`）——移走目标即断链。

⇒ 这是一次需要「先让 build/packaging/resolution 支持子目录，再逐个 domain 迁移」的程序，
而不是本任务 Touches（3 个文件）能承载的单次文件移动。

### 5. 处置结论

- **复核结论**：finding **成立且未过期**；本任务**不修**——在上述承重机制改造前，任何单 domain 移动都会
  打断 build/resolve/check-set/symlink 四条链。
- **AC2 采用的臂**：走「已有机制在管、失败在哪一步」——上表逐条给出机制与失败步；结论是这些机制
  **各自**在 domain 维度上停止（cycle-only / 只记录不判定 / 已退役 / 只立案）。
- **对 finding 读数的更正**（可核、可复算）：`fanIn 0` 是 source-root 结构恒等式，`fanOut 3163` 是
  单 `(root)` 包拓扑下的总边数，二者都不是集中度测量；真实的直接读数是 **299 个 top-level `.ts`、
  163 个入度 0 的入口、1 个入度 228 的共享基底、3 条具名跨域边**。
- **可执行的下一个增量**（本任务不执行，留给后续程序任务，顺序不可交换）：
  ①先让 `plugin/scripts` 的扁平度可被机械读出（domain 声明表 + 一个只判「top-level 文件是否都属于某个
  已声明 domain」的检查器，零文件移动）；
  ②让 build/resolve/check-set/symlink 四条链在测试下支持子目录；
  ③每次只迁一个 domain，并同步更新符号链接与 registration。

### 6. 复核命令（可重跑）

```bash
git ls-files 'plugin/scripts/*.ts' | wc -l                       # 299
git ls-files 'plugin/scripts/*.ts' | xargs wc -l | tail -1       # 189347
node --experimental-strip-types plugin/scripts/import-graph-check.ts --json   # 0/0/0, kernelChecked=true
python3 -c 'import json;rs=[json.loads(l) for l in open(".archguard/metrics-history.jsonl")];[print(r["timestamp"],len(r["packages"]),any(p["name"]=="plugin/scripts" for p in r["packages"])) for r in rs[-6:]]'
# ⇒ … 2026-10-21T07:56:04Z 22 True / 2026-10-21T16:18:01Z 285 False   ← 拓扑翻转
```

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `plugin-scripts-flat-god-directory`（routine `architecture-analysis`，runId `architecture-analysis-1792599464308`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/worker-driver.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/driver-runtime.ts`
- `tasks/gap-routine-architecture-analysis-plugin-scripts-flat-god-directory.md`