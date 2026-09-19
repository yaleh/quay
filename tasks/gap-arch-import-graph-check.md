---
id: gap-arch-import-graph-check
title: 架构棘轮：按语句位置解析 import 的模块依赖图检查器（值级环 / 类型级环 / 产品层→方法学层反向边），三个量只降不升
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-304
---
**type:** execution

## Proposal

**建一个按【语句位置】解析 import/export 的模块依赖图检查器 `plugin/scripts/import-graph-check.ts`，把三个结构量变成「只降不升」的棘轮，并接入套件静态层。**

来源：`orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md`（下称 SPEC；⚠️ 该文件此刻位于分支 `worktree-spec-architecture-refactor`，可能尚未在 develop 上——**本任务体自足，不依赖读到它**）§2 P1 / §5 Phase 0a。人 2026-09-19 已裁定共享原语落点为 `packages/quay/src/kernel/`。

**为什么需要它（实测，非印象）**：archguard 对 `plugin/scripts` 只当成单个 `(root)` 包，`detect_cycles` 返回 `[]`，而对同一批文件自写的 import 图算出 3 个文件级环（1 个值级、2 个类型级）。⇒ archguard 的「0 环」只能读作「未评估」。此外 `packages/quay` 与 `quay-native` 反向 import `plugin/scripts`（5 条边），没有任何检查在盯。

**要量的三个量（每个都是「会回升」的量，故必须做成棘轮）**：
1. `valueSccs`：只用【值导入】边（`import x from`、`export … from`、动态 `import()`；`import type`/`export type` 不算）构成的强连通分量（大小≥2）。**当前基线 = 1**：`plugin/scripts/ready-pool-check.ts:238` 值导入 `judgePoolCandidate`（自 `strategic-doc-staleness-check.ts`），后者 `:55` 值导入 `stripCodeSpans`（自 ready-pool-check）。
2. `typeSccs`：把类型边也算进去才成立、但仅用值边不成立的 SCC。**当前基线 = 2**：①`gate/registry.ts` 值导入 `gate/factories/{document-contract,goal}.ts`，而 11 个工厂 `import type { GateFn } from "../registry.ts"`（SCC 大小 11）；②`full-suite-runner.ts` 值导入 `runner-state-write.ts`/`runner-red-parse.ts` 等，后两者 `import type` 回指它（SCC 大小 5）。
3. `reverseEdges`：`packages/**` 下的文件 import `plugin/**` 或 `experiments/**` 的边（列出 `{from,to,line}`）。**当前基线 = 5**：`packages/quay/src/serve.ts:36/38/42`（→ `driver-shared`、`write-json-atomic`、`worktree-process-reaper`）、`packages/quay/src/server-state.ts:38`（→ `write-json-atomic`）、`packages/quay-native/src/store.ts:42`（→ `shape-sections`）。

⚠️ 上面三个基线来自一个**正则**脚本（未做注释/字符串掩码）。**本任务落地时必须以检查器的真实读数为准**：若与上述数字有差异，逐条对账（哪一条是正则误判、哪一条是新发现），把对账写进任务 notes，**不得调整检查器去凑这三个数**。

**第四条规则（kernel 边界，条件性）**：若目录 `packages/quay/src/kernel/` 存在，其下文件不得 import `packages/quay/src/kernel/` 之外的任何模块（也不得 import `plugin/`、`experiments/`）。目录不存在时输出 `kernelChecked:false`——**不得**返回与「已检查且合格」同形的值（硬规则 3b）。

**设计约束（每条都对应一次已发生的错误）**：
- **按位置判定**（硬规则 2）：只认真实的 import/export 语句，注释与字符串里出现 `from "…plugin/…"` 不算。可复用仓库已有的 `buildNonCodeMask`（`plugin/scripts` 中 13 处依赖它）而不是新造。
- **数据源用 `git ls-files '*.ts'`**，不用 `find`——一次 `find` 曾因扫进 `.claude/worktrees/*`（4806 个副本）而把计数污染 10 倍以上。排除 `*.test.*`、`/test/` 目录、`node_modules`、`dist`、`archive/`。
- **符号链接按 realpath 去重**：`experiments/quay-perpetual-stream/scripts/` 有 22 个指向 `plugin/scripts/` 的符号链接，同一文件只算一个节点，相对 import 从 realpath 解析。
- **读不懂输入要说出来**（硬规则 3b）：输出 `evaluated:true|false`；解析失败/git 不可用/无文件 ⇒ `evaluated:false` + exit 2，**不得** exit 0。
- **诚实自报未覆盖面**：输出里带 `notAnalyzed:{mjs:N,js:N}`（tracked 的非测试 .mjs/.js 数），本检查器只分析 TS。
- **棘轮形态照 `plugin/scripts/quay-init-closure-ratchet.ts` 与 `test-framework-policy-check.ts`**：基线是数据文件 `plugin/import-graph-baseline.json`（`{valueSccs,typeSccs,reverseEdges}`）；读数 > 基线 ⇒ exit 1；同时基线文件在工作树里的值相对 git HEAD 里的值只许降不许升（防止「调高基线」绕过）；bootstrap（HEAD 尚无该文件）时以当前为基线并注明。

**CLI**：`node --experimental-strip-types plugin/scripts/import-graph-check.ts [<root>] [--json] [--selftest] [--baseline <file>]`；exit 0 = 全部不超基线；1 = 有超出；2 = 用法/环境错误。`--json` 输出至少含 `{evaluated, files, edges, valueSccs:[{files:[…]}], typeSccs:[…], reverseEdges:[…], kernelChecked, notAnalyzed}`。

**新增检查器的四件套义务（缺一不可，各自在套件不同位置报红）**：①`plugin/scripts/capability-catalog.sh` 六张表（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER）各补一行，键=basename；②登记进 `plugin/scripts/runner-static-gate.ts` 的 `run_static_checks`，带 `# @static-tier` 与 `# @static-object`；③新增 `plugin/scripts/checker-mutation-cases/import-graph-check.sh`；④把 `run_static_checks` 上的 `# @checker-count <N>` 加 1。新测试文件用 `node:test` 并在文件顶部声明 `// @test-group <name>`。

## Touches

- plugin/scripts/import-graph-check.ts (new)
- plugin/import-graph-baseline.json (new)
- plugin/test/import-graph-check.test.mjs (new)
- plugin/scripts/capability-catalog.sh
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checker-mutation-cases/import-graph-check.sh (new)
- tasks/gap-arch-import-graph-check.md

## AC

- [x] AC1（自检能取假）`node --experimental-strip-types plugin/scripts/import-graph-check.ts --selftest` exit 0，且输出逐行枚举 ≥6 个具名注入用例及其预期判定：值环 A↔B ⇒ 超基线 FAIL；A 值导入 B 而 B 仅 `import type` 回指 A ⇒ PASS 且 `typeSccs`+1；`packages/x.ts → plugin/y.ts` ⇒ `reverseEdges`+1 且超基线 FAIL；仅在注释/字符串字面量里出现的 `from "../plugin/…"` ⇒ **不计数**；kernel 目录存在且其文件 import 了 kernel 之外 ⇒ FAIL；空输入/非 git 目录 ⇒ `evaluated:false` 且 exit 2（不是 0）。
- [x] AC2（真样本，零计数的配套）在真实仓库根跑 `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json`：`evaluated===true`，且 `valueSccs` 中恰有一个 SCC 同时含 `plugin/scripts/ready-pool-check.ts` 与 `plugin/scripts/strategic-doc-staleness-check.ts`；`typeSccs` 至少含一个含 `packages/quay/src/gate/registry.ts` 的 SCC 与一个含 `plugin/scripts/full-suite-runner.ts` 的 SCC。**读数为 0 视为检查器失效，不是「无环」。**
- [x] AC3（反向边真样本）同一次 `--json` 的 `reverseEdges` 至少包含 `packages/quay/src/serve.ts`、`packages/quay/src/server-state.ts`、`packages/quay-native/src/store.ts` 三个 `from` 文件，且指向 `plugin/scripts/write-json-atomic.ts` 与 `plugin/scripts/shape-sections.ts`；若总数 ≠5，任务 notes 里有逐条对账。
- [x] AC4（去重与污染）同一次 `--json` 中每个节点路径唯一，且不含 `.claude/worktrees/`；`experiments/quay-perpetual-stream/scripts/` 下指向 `plugin/scripts/` 的符号链接不作为独立节点出现。
- [x] AC5（棘轮）`plugin/import-graph-baseline.json` 存在且三个值等于 AC2/AC3 的真实读数；`--selftest` 含一条用例：把基线里任一值调高相对「HEAD 基线」⇒ exit 1。
- [x] AC6（四件套）`bash plugin/scripts/capability-catalog.sh --entry-surface` exit 0；`node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts` exit 0；`bash plugin/scripts/checker-mutation-check.sh --check` exit 0；`grep -n "import-graph-check" plugin/scripts/runner-static-gate.ts` 命中 `run_static_checks` 内的调用行（位置命中，非注释）。
- [x] AC7（生产载体，非 fixture）经套件静态层**真实执行**：在任务 worktree 内用 `scripts/test.sh` 的 scoped/静态入口（见其头注释）跑一次，产出里能看到 `import-graph-check` 被执行且判定 PASS（不是仅被登记）；关掉 `--selftest` 的注入 seam 后该结论仍成立。把该次命令与输出关键行贴进 notes。

## DoD

真实落地标准（DIR-026 Reading A）：检查器已经**通过套件静态层在真实仓库上跑过一次**并输出真实基线；**负控制已实做并留证**——在任务 worktree 临时加一条 `packages/quay/src/` → `plugin/scripts/` 的 import（以及一个人造值环），套件静态层变红，撤销后转绿，两次输出贴进 notes。fixture 全绿而未在真实树上跑过 ⇒ 不算完成（硬规则 4 推论三）。落地后 `bash plugin/scripts/capability-catalog.sh --summary` 的脚本数自报值比落地前 +1，且 UNCLASSIFIED=0。不修改任何 `packages/**` 生产代码——本任务只观测，纠正在 Phase 2/3 的其它任务里做。

## Notes

**落地 2026-09-19** — 分支 `task/gap-arch-import-graph-check`（6 个提交，全部 cherry-pick 到本地 `develop` 之上，见 §7）。工作树 `git status` 干净。

### 1. 与任务体三个「正则先验」的对账 —— 逐条命中，无一条需要处置

任务体要求「以检查器真实读数为准；有差异逐条对账；**不得调整检查器去凑这三个数**」。实测**三个量在数值、方向、行号上全部命中**：

| 量 | 任务体先验 | 检查器实测（`--root .`，2026-09-19） |
|---|---|---|
| `valueSccs` | 1（`ready-pool-check.ts` ↔ `strategic-doc-staleness-check.ts`） | **1**，且是唯一一个值级 SCC，成员恰为该二文件 |
| `typeSccs` | 2（`gate/registry.ts` SCC 大小 11；`full-suite-runner.ts` SCC 大小 5） | **2**；①registry SCC = **11 个文件**；②`full-suite-runner.ts` SCC = **5** 个文件（`full-suite-runner` / `pre-verified-round-record` / `runner-red-parse` / `runner-state-write` / `suite-state-trigger`） |
| `reverseEdges` | 5：`serve.ts:36/38/42`、`server-state.ts:38`、`store.ts:42` | **5**，`from`/`to`/`line` **逐条一致**（`store.ts:42→shape-sections`、`serve.ts:36→driver-shared`、`serve.ts:38→write-json-atomic`、`serve.ts:42→worktree-process-reaper`、`server-state.ts:38→write-json-atomic`） |

**唯一一处措辞出入（不构成差异，无需对账）**：Proposal 写「`registry.ts` 值导入 `factories/{document-contract,goal}.ts`，而 **11 个工厂** `import type { GateFn } from "../registry.ts"`（SCC 大小 11）」。实测 11 = **该 SCC 的文件总数**，其中工厂 9 个（`adr`/`coverage-floor`/`document-contract`/`fixed-script`/`goal`/`it0`/`red-green`/`test-pass`/`index`）+ `registry.ts` + `gate/config/loader.ts`。数字与方向都命中；「11 个工厂」是任务体自身的措辞松动。

⇒ **没有一条是正则误判，也没有新发现**，因此没有逐条对账表可写（无差异可对）。

一次完整读数：`files=428 edges=1039`（value 930 / type 109）；`kernelChecked=false`（`packages/quay/src/kernel/` 尚未落地 ⇒ **显式 false，不与「已检查且合格」同形**）；`notAnalyzed={mjs:35,js:11}`；`dangling` = 3 条悬空符号链接（`experiments/quay-perpetual-stream/scripts/git-lens-l-{d,g,s}-*.ts` —— 归档后只剩符链，**列出而非静默丢弃**，且不因此判 NOT-EVALUATED：那是仓库自身的状态，不是检查器读不懂输入）。

### 2. AC6 四件套（命令与结果）

| 命令 | 结果 |
|---|---|
| `bash plugin/scripts/capability-catalog.sh --entry-surface` | **exit 0**（六张表各补一行，键 `import-graph-check.ts`） |
| `node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts` | **exit 0**（`run_static_checks` declared 63 / measured 63；注解 `@checker-count 62 → 63`） |
| `bash plugin/scripts/checker-mutation-check.sh --check` | **exit 0**（`checkers_total: 81 / checkers_with_mutation: 81 / uncovered: 0 / mutations_that_stayed_green: 0`） |
| `grep -n "import-graph-check" plugin/scripts/runner-static-gate.ts` | **位置命中** `:969` 的 `run_checker "import-graph-check" …` 调用行（在 `run_static_checks` 函数体内，非注释） |

同族连带（非 AC6 但同族义务，全绿）：`rhythm-consumer-check --check` exit 0（判据1：「每轮」有真实调用点，否则它判红）；`instrument-failure-check --gate` FAMILY 1–5 全在 shrink-only 基线内（新写的 catalog 值未产生 FAMILY-5 命中）；`checker-mechanical-spine-check` exit 0；`test-impl-census-check` exit 0；`test-framework-policy-check` exit 0；`anti-drift-touches-check --merge-target develop` exit 0（§7）。

### 3. AC7 生产载体（套件静态层**真实执行**，非 fixture）

```
$ bash scripts/test.sh --for-task gap-arch-import-graph-check --allow-thin
  scoped check: run_checker "import-graph-check" node --no-warnings --experimental-strip-types \
    "/home/yale/work/quay-worktrees/gap-arch-import-graph-check/plugin/scripts/import-graph-check.ts" \
    --root "/home/yale/work/quay-worktrees/gap-arch-import-graph-check"
import-graph-check: files=428 edges=1039 (value 930 / type 109)
PASS — valueSccs=1 ≤ 1, typeSccs=2 ≤ 2, reverseEdges=5 ≤ 5 (headBaseline {"valueSccs":1,"typeSccs":2,"reverseEdges":5})
...  ℹ tests 36 · pass 36 · fail 0
RW exit=0     （全文 /tmp/igc-final-rw.log；`STATIC_CHECK_FAILED` 行数 = 0）
```

三点是关键：①它是被 **scoped 选择器选中并真实执行**的（不只是被登记在注册表里）；②`headBaseline` **不是 bootstrap** —— 基线文件已随本任务提交，所以「相对 HEAD 只许降」这条规则在这次运行里**是活的**；③判 PASS 靠的是 **读数 ≤ 基线**，不是自证。该结论与 `--selftest` 的注入 seam 无关（`--selftest` 是独立子命令，主路径不经过它）。

### 4. DoD 负控制（实做并留证）

**注入方式**：在任务 worktree 里**暂存**（`git add`，**不提交**）三个文件 —— `git ls-files` 读的是**索引**，未 `add` 的注入对检查器**不可见**，那样测的是「看不见」而不是「判不出」：

- `packages/quay/src/zz-negative-control.ts`：`import { writeJsonAtomic } from "../../../plugin/scripts/write-json-atomic.ts"`（人造反向边）
- `plugin/scripts/zz-nc-cycle-a.ts` ↔ `plugin/scripts/zz-nc-cycle-b.ts`：互相值导入（人造值环）

**红**（注入态，同一条 scoped 命令）：
```
import-graph-check: files=431 edges=1042 (value 933 / type 109)
  value SCC: plugin/scripts/zz-nc-cycle-a.ts, plugin/scripts/zz-nc-cycle-b.ts
  reverse edge: packages/quay/src/zz-negative-control.ts:2 → plugin/scripts/write-json-atomic.ts
import-graph-check: FAIL — valueSccs 2 > baseline 1; reverseEdges 6 > baseline 5
STATIC_CHECK_FAILED: import-graph-check exit=1
nc2 exit=1        （全文 /tmp/igc-nc2.log）
```
（同一次注入还连带触发 `STATIC_CHECK_FAILED: capability-catalog exit=1` —— 两个 `plugin/scripts/zz-*.ts` 未在 catalog 声明，正是它 AC1c 入口闸在起作用。）

**绿**（`git reset` + `rm` 三个注入文件之后，同一条命令）：
```
import-graph-check: files=428 edges=1039 (value 930 / type 109)
PASS — valueSccs=1 ≤ 1, typeSccs=2 ≤ 2, reverseEdges=5 ≤ 5 (headBaseline {...})
green exit=0       （全文 /tmp/igc-green.log）
```
⇒ 红/绿两半是**同一条命令在同一棵树上的前后对照**；两半所依据的**本任务 6 个文件**与最终分支上的**逐字相同**（§7 有 `git diff` 证据），且读数完全相同（428/1039，因为 release 线改的不是任何 `.ts`）。

**另外三组独立对照（同一结论的其它方向）**：
- `--baseline` 指向三值全 0 的基线 ⇒ `exit 1` 并逐条报 `valueSccs 1 > baseline 0; typeSccs 2 > baseline 0; reverseEdges 5 > baseline 0`；指向宽松基线 ⇒ `exit 0`；指向不存在的文件 ⇒ `exit 2` + `NOT-EVALUATED`（**不与「≤ 基线」同形**）。
- **基线被调高**：把工作树里 `typeSccs` 由 2 改成 3（HEAD 仍是 2）⇒ `exit 1` 且 `FAIL — the working-tree baseline was RAISED past git HEAD on typeSccs (a baseline may only shrink)` —— 证明「调高基线」买不到绿灯。
- **mutation case 自身的双向性**：临时把 shrink-only 规则短路 ⇒ case `STAYED-GREEN` 退出 3；恢复 ⇒ 退出 0（若 case 恒绿，这次短路不会让它变红）。

**DoD 其余两条**：
- `bash plugin/scripts/capability-catalog.sh --summary` → `341 scripts | 341 declared | 0 unclassified | 336 ship`。落地前同一读法（`git ls-tree` 于 `develop`，按 catalog 自身的 find 口径排除 `checker-mutation-cases/` 与 `archive/`）= **340** ⇒ **+1**，且 **UNCLASSIFIED = 0**。
- **未修改任何 `packages/**` 生产代码**：`git diff --name-only develop..HEAD` = **恰好 6 个文件**，全在 `## Touches` 内，无 `packages/**` 条目（负控制注入的两个文件已 `git reset` + 删除，工作树干净）。

### 5. AC4 去重的直接读数

`git ls-files '*.ts'` 在 `experiments/quay-perpetual-stream/scripts/` 下有 **74** 条（71 条可解析 + 3 条悬空）。逐条 `realpathSync` 后，可解析的每一条都规范化成 `plugin/scripts/<同名文件>`（样本：`anti-drift-touches-check.ts -> plugin/scripts/anti-drift-touches-check.ts`）。⇒ 不做 realpath 去重会多出 **71 个幻影节点**（428 → 499，虚增 16%），并让每个镜像文件在 SCC 里被数两遍。

`--json` 实测：SCC 成员共 **18** 个、**零重复**（SCC 对节点集构成划分）；`reverseEdges` 的 `from:line->to` 三元组 5 条全唯一；命名路径中 **无** 一条以 `.claude/worktrees/` 开头，**无** 一条以 `experiments/quay-perpetual-stream/scripts/` 开头。

### 6. 实现过程中由**套件/自检**（不是我的 inspection）暴露并修掉的三个缺陷

1. **`test-impl-census-check` 把我自己的测试判红。** `plugin/test/import-graph-check.test.mjs` 的 fixture 里**逐字写**了 `from "../../../plugin/scripts/y.ts"` 这类路径，而 `test-impl-census-check.ts` 会从每个测试文件里抽出 `from "…/scripts/<name>"` 字面量、磁盘上找不到对应实现即判红 —— **fixture 路径不是 import**。修法：fixture 的说明符**在运行时拼出来**（`pkgToPlugin()` / `siblingPlugin()`），被测形状（`packages/` 伸进 `plugin/scripts/`）一字未改。
2. **`--json` 里混进了人类可读行。** `PASS — valueSccs=1 ≤ 1, …` 被写在 JSON 对象**之后**的 stdout 上，于是 `import-graph-check --json | jq .` 报 `Unexpected non-whitespace character after JSON` **而检查器退出码是 0** —— 一次**通过的**运行打断机器消费方，且直接违反本任务自己声明的 CLI 契约。修法：两个 `--json` 面（读数与 `--selftest`）都只输出那个 JSON 文档，人类行以 `!asJson` 为闸。加了**两条测试**把它钉住。
3. **AC4 的「唯一」原来可能被 Set 静默吸收。** 原测试把节点收进 `Set` 再断言，而「同一路径出现两次」正是 Set 会悄悄吞掉的失败形态。改成对**扁平列表**断言（SCC 成员零重复 + 反向边三元组零重复），重复即红。

另有两次**只有实测才会暴露**的实现修正：`import` 语句的定位原本只锚在关键字上，于是 `export const doc = 'import { b } from "./b.ts";'` 这样的**字符串字面量**会被读出一条模块边 —— 现在**关键字与 `from` 两处**都必须在代码位置（AC1 的注释/字符串负控制用例钉住它）；以及「未闭合的 `[^;]*?` 会把两条无分号语句并成一条」（本仓库无分号风格）—— 由单测钉住。

### 7. 一个真实的落地阻塞：worktree 的 fork 点选错（已修，值得复现者读）

**现象**：`anti-drift-touches-check --task … --merge-target develop` **HARD FAIL**，13 条 `out-of-declared`，全部是版本号文件（`.claude-plugin/marketplace.json` / `package-lock.json` / `packages/*/package.json` / `plugin/VERSION` / `plugin/vendor/quay/package.json` / …）。driver 的机械 fan-in **step 3 就是这一步** ⇒ 会直接拒翻。

**真因**：本 worktree 用 **`git worktree add -b … origin/develop`** 建，而本仓库**本地 `develop` 与 `origin/develop` 已分叉** —— `origin/develop` 带 v0.10.0 release 线（`8c7b85e79` / `4c8116632` / `225c81e17`，`plugin/VERSION` = `0.11.0-dev`），本地 `develop` **不带**（`plugin/VERSION` = `0.10.0-dev`），而 driver 的 merge target 默认就是本地 `develop`（`worker-driver.ts:4534`）。于是 `git diff develop...HEAD` 除我的 6 个文件外，还包含 **release 线对那批文件的改动** —— 那是**主干的分叉**，不是本任务的写入面。

**修法（可复现）**：
```
git checkout -B task/<id> develop
git cherry-pick <本任务的每个非 merge 提交>
```
⛔ **不要**用 `git rebase --onto develop <fork-origin>`：`<fork-origin>..HEAD` 的范围里包含 origin/develop 那 60+ 个**不属于本任务**的提交，rebase 会去重放它们并在 `tasks/*.md` 上撞 add/add 冲突（实测 `Rebasing (1/66)` 即冲突）。

**结果**：`git diff --name-only develop..HEAD` = **恰好 6 个文件**；`anti-drift-touches-check --task … --merge-target develop` → `ANTI-DRIFT OK: task gap-arch-import-graph-check — 6 actual file(s), all within declared Touches (7 glob(s))` exit 0；6 个文件的**内容与重写前逐字相同**（`git diff backup/igc-pre-rebase HEAD -- <每个文件>` 全空），检查器读数不变（428/1039，三值均等于基线），scoped 门重跑 **exit 0**（36/36 测试）。

**为什么值得写下来**：`dispatch-worktree-setup.sh` 当时报的是 **`fork-point PASS`**，所以这个错**不会被建树这一步拦住**；它只在 fan-in 的 anti-drift 才现形，而那时的表象（一串版本号文件）与真因（fork 点选了 `origin/develop`，而权威基线与 merge target 都是本地 `develop`）**完全不同形**。本仓库凡「本地 develop 落后 origin/develop」的时段，任何 fork 自 `origin/develop` 的任务都会撞同一堵墙。
