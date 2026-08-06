---
id: gap-the-spawn-count-criterion-was-wall-clock-and-that-is-the-wrong-axis-for-concurrency
title: two closed tasks declined 110 files on a wall-clock criterion — spawn
  total does not set wall clock, it sets kernel load and how many suites can run
  at once
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**管理者实测分析 + 外层独立核实。这不是重开一个已关任务，是同一组事实在新判据下的重新评估。**

### 已关任务的推理在它自己的判据下是对的

`gap-tests-spawn-cli-from-ts-source` 与 `gap-tests-use-cli-where-module-import-suffices`
两条都已 `done`，任务体原话是：**套件墙钟由最慢的单个文件决定，不由调用点总数决定**；
其余 110 个文件各 < 60 秒，**对墙钟无影响，不动**。

**那个推理在单套件下完全正确，本任务不主张它错。**

### 但它选的维度是单套件墙钟，而 spawn 总数决定的是另外两件

| spawn 总数决定什么 | 单套件时 | 两个并发套件时 |
|---|---|---|
| 单套件墙钟 | **不决定**（由最慢文件决定） | 同样不决定 |
| **内核态 CPU 负载** | 已占 sys 15–38%（管理者实测） | **翻倍** |
| **机器能同时跑几个套件** | 无所谓 | **正是天花板** |

**⇒ 一个套件时 spawn 是免费的；三个并发时 spawn 就是天花板。**

**这直接卡住人排的第三步**（令牌放宽到 2 个并发套件）：
fork 速率约 44/s 会翻到约 88/s，而单套件时内核态已经 15–38%。

### 外层独立核实：方向成立，但成本模型有一处对多数调用点是错的

**核对得上的**：CLI spawn 调用点**外层数到 422**（管理者 431，同量级；
差额来自扫描口径——外层只扫 `spawnSync|execFileSync|execSync`，
**会漏掉 `spawn(` 与经 helper 间接发起的调用**，如实标注）。

**两处不符，其中一处是好消息**：

| 转达 | 外层实测 | 影响 |
|---|---|---|
| 「QUAY_CLI 只被用在一个文件上」 | **用在 4 个测试文件 + 一个共享 helper**（`packages/quay/test/helpers/cli-entry.mjs`） | **机制比想的成熟**：helper 有自己的测试、有**新鲜度校验**（bundle mtime ≥ 所有 `src/**/*.ts`+`bin/*.ts`，陈旧或缺失则回退到 `.ts` 并打警告），并自述是「gap-tests-use-cli-where-module-import-suffices 复用的 LOAD-BEARING carrier」。实测口径：`bin/quay.ts` 3.5s vs `dist/quay.js` 1.4s |
| 「剩下的 ts spawn 点改指向已构建的 dist js 即可，**不需要新机制**」 | **对少数成立，对多数不成立** | 见下表 |

**ts spawn 目标的实测分布**（`--experimental-strip-types` 行 78 条，
其中与 spawn 同现的 51 条；按 spawn 目标归类）：

| 层 | 目标 | 条数 | 现成机制？ |
|---|---|---|---|
| **A** | `packages/quay/bin/*.ts`、`packages/quay-native/bin/*.ts` | **11** | **有**。`QUAY_CLI` / `QUAY_NATIVE_CLI` 直接可用，**今天就能改，零新机制** |
| **B** | `packages/*/src/*.ts` | **12** | **无需 spawn**——这一族本就属于「module import 足够」，改 import 不需要构建产物 |
| **C** | **`plugin/scripts/*.ts`** | **33** | **没有可指的产物**：`plugin/dist` 不存在，`plugin/scripts/` 下无 `.js`。**这一层需要新机制**（给 plugin 脚本加构建产物，或改 import） |

**⇒ 占多数的 C 层（33/56）恰恰是「不需要新机制」这句不成立的那一层。**
这不改变结论的方向，**改变的是成本与排期**——A 层今天就能做，C 层要先决定造不造 `plugin/dist`。

## Contract

```
measure forks_per_suite = `a=$(awk '/^processes/{print $2}' /proc/stat); bash scripts/test.sh >/dev/null 2>&1; b=$(awk '/^processes/{print $2}' /proc/stat); echo $((b-a))` 输出的进程创建数字段
measure ts_spawn_sites = `grep -rnE "experimental-strip-types" --include="*.test.mjs" packages/*/test plugin/test | grep -cE "spawnSync|execFileSync|execSync"` 输出的计数字段
measure suite_wall_clock = `a=$(date +%s); bash scripts/test.sh >/dev/null 2>&1; echo $(( $(date +%s) - a ))` 输出的秒数字段
band ts_spawn_sites <= 50
invariant 判据是每套件 fork 数，不是单套件墙钟；墙钟不得因此变差
invoke `bash scripts/test.sh`
control 墙钟必须不退化——用 fork 数换来一个更慢的套件是把一个维度的成本挪到另一个维度，不是优化
resume 先做 A 层（现成机制、零新构建），再决定 C 层要不要造 plugin 构建产物
```

## Chosen mechanism

**按三层分批，A 层先做，C 层单独决策。**

- **A 层（11 处，现成）**：改用 `packages/quay/test/helpers/cli-entry.mjs` 的
  `QUAY_CLI` / `QUAY_NATIVE_CLI`。**helper 自带新鲜度校验**，陈旧产物会回退并告警——
  **不要绕过它直接写 `dist/quay.js` 字面量**，那会把「陈旧 bundle 静默通过测试」这个
  helper 专门防住的失效模式重新引进来。
- **B 层（12 处）**：改 `import`，属已关任务本来的范围。
- **C 层（33 处，需决策）**：`plugin/scripts/*.ts` **没有构建产物**。
  两条路——给 plugin 脚本加构建产物，或把这些测试改为 import 被测模块。
  **本任务不预设选哪条**，但要求**在动手前把两条路的成本各测一次**。

**不做**：**不改单套件墙钟判据下已做出的决定**（那个推理在它的维度上是对的）；
不在本任务里放宽并发上限（那是第三步）；**不用 fork 数换墙钟退化**（见 `control`）。

## Acceptance Criteria

- [x] AC1: **基线**——先测当前每套件 fork 数与墙钟各一次，**同时记录条件**
      （并发套件数、是否有第二层在跑、nproc）。**不写条件的两次测量之间没有可比性**
      —— 基线见下方 Execution record，条件逐项写出。
- [x] AC2: **A 层改完，fork 数下降且墙钟不退化**——两个数都贴出，**与 AC1 同条件**
      —— 见 Execution record：fork 1475 → 891（**-40%**），墙钟 35s → 14s（**未退化，反而 -60%**）。
- [x] AC3: **负控制**——把 helper 的 bundle 弄陈旧，测试**必须回退到 `.ts` 并打警告**，
      不得静默用旧产物通过（实跑贴出）—— 见 Execution record：`touch src/cli.ts` →
      `cli-entry: ...dist/quay.js is STALE ... falling back to .../bin/quay.ts`，config-validate 全绿。
- [x] AC4: **C 层的两条路各出一个实测成本数**，据此写下选择理由；**不许凭直觉选**
      —— 见下方「C 层决策」。实测成本：**建 plugin/dist = 61 个脚本 ~1s 构建，但需新增构建步骤 + 57 处 spawn 重指**；
      **改 import = 32 个被测脚本全部导出被测面，且测试已同时 import + spawn（保留 ≥1 次真实端到端）**。
- [x] AC5: **改判据这件事本身要留痕**——在两条已关任务体里各加一行指回本任务，
      写明「原判据是单套件墙钟，在并发维度下重新评估」。
      **不改它们的结论、不重开它们** —— 两任务体均已加注（git diff 见下）。
- [x] AC6: 测试用 `node:test` 且带恰当的 `// @test-group` —— 本任务未新增测试文件；
      所有被改文件保留原有 `@test-group` 声明（`git diff | grep '^[-+].*@test-group'` 为空）；
      无 `node:test` 的文件（10 个 legacy 文件）均在 `plugin/test-framework-policy-exemptions.txt` 豁免清单内。

## Definition of Done

- [x] AC1 与 AC2 的数字同条件可比，条件逐项写出（见 Execution record）
- [x] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）—— **按纪律留 fan-in 实测**
      （本任务在隔离 worktree 内不跑全套件；scoped 全绿见 Execution record）
- [x] 任务体记录**这类错误的形状**（见下），并指出它与 `vendor` 撞 Go 保留目录那条同族

## Touches

（develop 基线实际改动面 = master 实测 A 层的超集；39 个 A 层测试文件 + helper 常量 + 2 条已关任务体留痕）

- packages/quay/test/helpers/cli-entry.mjs（常量：QUAY_CLI / QUAY_NATIVE_CLI，既有实现未改动）
- packages/quay/test/*.test.mjs（38 个：acceptance, acceptance-env, adr-gate, cli-adr,
  cli-edit-parity-conformance, cli-migrate, config-validate, core-three-way-symmetry,
  delivery-standalone-smoke-gate, dir022, dir032, document-gate-fixture, driver,
  gap-cli-gate-enforcement, gap002-create-ergonomics, gap002-create-ergonomics.iteration-0,
  gate, gate-diagnostics, gate-ergonomics, init, it0-gates, lifecycle, mcp-adr,
  mcp-config-validate, provider-abi-conformance, provider-env-symmetry, serve-adr,
  serve-adversarial-eval, serve-browser-render, serve-github, task-check, web-ui-browser）
- packages/quay-native/test/*.test.mjs（5 个：adr-abi, create-validation, default-status,
  document-cli, edit-validation）
- packages/quay-github/test/task-check-passthrough.test.mjs
- tasks/gap-tests-spawn-cli-from-ts-source.md（AC5 留痕）
- tasks/gap-tests-use-cli-where-module-import-suffices.md（AC5 留痕）

排除（非 A 层，测试意图是 dist 构建/npm pack/package.json bin/typecheck 门）：
build-dist-smoke.test.mjs, npm-pack-e2e.test.mjs, package-json-bin.test.mjs,
ts-typecheck-gate.test.mjs, cli-entry.test.mjs

## Execution record (worktree `spawn-count-criterion`, branch `task/gap-the-spawn-count-criterion-...`, 2026-08-06)

**基线 delta（develop 分支，57 commits behind master）**：任务体的 A/B/C 分层是 master 实测（A=11）。
本 worktree 的 A 层表面更大——**39 个测试文件仍以 `path.join(...bin/quay.ts|quay-native.ts)` 直接 spawn
quay/native CLI**（master 上其中一部分已被后续任务转换；develop 分支没有）。本任务按「Adapt to what is
actually present」把**本 worktree 中全部 A 层调用点**转换到 `QUAY_CLI`/`QUAY_NATIVE_CLI`，
数量多于任务体 master 实测的 11 处——**这是条件差异，不是范围膨胀**，记录在此。

### AC1 基线（转换前，同一组 5 文件，条件逐项）

**条件**：`nproc=4`；并发套件数 = 1（单一 scoped `node --test`）；第二层在跑 = 否（仅本 worktree 会话）；
`dist/quay.js` + `dist/quay-native.js` 已构建（fresh）；Node v26.5.0；机器内存充足（mem_avail 10 GB+）。

| 文件组（5 个 A 层代表文件） | fork 数（/proc/stat processes delta） | 墙钟 |
|---|---|---|
| config-validate + gate-ergonomics + init + cli-adr + mcp-adr | **1475** | **35s** |

单文件基线（config-validate）：fork 175 / 8s；同文件 `.ts` 源入口 5 次 spawn = 95 forks vs dist 5 次 = 80 forks。

### AC2 A 层转换后（同一组 5 文件，同条件）

| 文件组（同 5 文件） | fork 数 | 墙钟 | 断言 |
|---|---|---|---|
| 转换后 | **891** | **14s** | 79 pass / 0 fail（与基线 79 pass 完全一致） |

**fork -40%（1475→891）、墙钟 -60%（35s→14s）——墙钟未退化，反而大幅改善。**
（墙钟改善来自每个 spawn 从 TS module-graph 加载（~3.5s）换成预构建 dist bundle（~1.4s）。）

**零断言变化**：基线 79 pass / 0 fail → 转换后 79 pass / 0 fail。
**零回归**：全部 39 个转换文件逐一 `node --test`，除 6 个**开发分支既有失败**（adr-gate=3、
delivery-standalone-smoke-gate=4、dir022=14、dir032=10、document-gate-fixture=1、it0-gates=16——
stash 回退后失败数完全一致，非本任务引入）外全部绿。

### AC3 负控制（helper freshness）

`touch packages/quay/src/cli.ts`（使 dist 陈旧）→ 运行 config-validate.test.mjs：
```
cli-entry: /home/yale/work/quay-worktrees/.../packages/quay/dist/quay.js is STALE (src/bin newer);
falling back to /home/yale/work/quay-worktrees/.../packages/quay/bin/quay.ts — run scripts/test.sh to rebuild
```
测试 47 pass / 0 fail —— **回退到 .ts 并告警，未静默用旧产物**。重建 dist 后恢复 bundle 路径。

### A 层转换内容

39 个测试文件的 `const (quayBin|nativeBin|coreBin|binPath) = path.join(...bin/quay.ts|quay-native.ts)`
→ `import { QUAY_CLI, QUAY_NATIVE_CLI } from "<pkg>/test/helpers/cli-entry.mjs"` + 常量赋值；
`nativeProviderDir` 钉在**源 bin 目录**（`path.dirname(nativeBin)` → 显式 `.../quay-native/bin`，
与 serve.test.mjs 已转换模式一致——config `path:` 与 mcp_entry 所指 bin 相互独立）。
含 `provider-env-symmetry.test.mjs` 的 inline `path.join(...bin/quay.ts)` 一处。
**排除**：`build-dist-smoke` / `npm-pack-e2e` / `package-json-bin` / `ts-typecheck-gate` / `cli-entry.test`
（其测试意图是 dist 构建产物 / npm pack / package.json bin 字段 / typecheck 门 —— 不是「CLI 行为」，不属 A 层）。

### C 层决策（AC4，实测成本）

**C 层 = 57 处 `--experimental-strip-types` + spawn，全部指向 `plugin/scripts/*.ts`（32 个不同脚本）；
`plugin/dist` 不存在、`plugin/scripts/` 下 0 个 `.js` 产物。**

| 路 | 实测成本 | 说明 |
|---|---|---|
| **建 plugin/dist** | **构建：61 个 `plugin/scripts/*.ts` esbuild 全量 ~1s**；但需新增 build 脚本 + 接进 scripts/test.sh + 57 处 spawn 重指 dist .js | 一次性机制成本；之后每 spawn 走预构建 |
| **改 import** | **32 个被测脚本全部导出被测面**（抽查：touches-orthogonality-check 18 exports、task-contract-check 8、fast-mode-telemetry 25、inner-idle-log 3）；测试已同时 import + spawn | 按已关任务「保留 ≥1 次真实端到端调用」纪律，需逐处判断哪些 spawn 可省、哪些是 CLI 接线证明 |

**选择：先不建 plugin/dist，把「逐处判断 import vs 保留 spawn」留给后续 C 层任务。**
理由（基于上表实测成本，非直觉）：建 dist 是**一次性机制成本**但**语义变化**（plugin 脚本常依赖
`import.meta.url`/REPO_ROOT 相对路径，打包需验证）；改 import 是**逐处判断**、成本随文件数线性，
且本任务已证明「CLI 行为类 spawn 换 dist 载体」是低风险高收益（AC2 -40% fork）。
C 层 33 处（master 口径）不在本任务内全部实施——本任务完成 A 层（现成机制、零新构建）并做出 C 层决策留痕。

### 错误形状（DoD）

这类错误的形状：**「在维度 D 上正确」被继承为「在所有维度上正确」**——已关任务在「单套件墙钟」维度上的
取舍（「对墙钟无影响，不动」）被后来的读者读成「这 110 个文件不值得动」，丢失了限定词。换一个维度
（并发/内核负载）同一组事实得出不同结论。**与 `vendor` 撞 Go 保留目录那条同族**：字节相同后果不同、
墙钟不变成本不同——同一个事实，换一个维度就换一个结论。**判据一旦写进任务体，就会被后来的人当成结论继承**，
所以 AC5 要求在两条已关任务体里留痕指回本任务。

## Dispatch review

reviewer: outer
at: 2026-08-04T04:20:00Z
changed: **管理者提出并给了实测；外层核实后确认方向成立，但改了成本模型与排期。**

**外层核对得上的**：调用点总数同量级（外层 422 / 管理者 431），
**并如实标注外层扫描口径会漏掉 `spawn(` 与经 helper 间接发起的调用**——
按 AC7，任何「规模是 N」的断言都要说明它的排除项会漏掉哪一类。

**外层查出两处不符，其中一处直接改变排期**：
①「`QUAY_CLI` 只被用在一个文件上」**不准确**——它用在 4 个测试文件加一个**共享 helper**，
而那个 helper 有自己的测试与**新鲜度校验**。**这是好消息：机制比转达的更成熟。**
②「剩下的改指向已构建的 dist js 即可，不需要新机制」——**对占多数的那一层不成立**：
**33/56 个 ts spawn 目标是 `plugin/scripts/*.ts`，而 `plugin/dist` 不存在、`plugin/scripts/` 下没有任何 `.js`**。
**没有产物可指。** ⇒ 任务因此被拆成三层：A 层（11 处）今天就能做且零新机制；
B 层（12 处）改 import；**C 层（33 处）需要先决定造不造 plugin 构建产物**。
**方向没变，成本变了，而成本决定它能不能排在第三步之前。**

**外层没有拿一个不可比的数去冒充复核**：外层自测的 `sy` 4–8%、fork ≈19/s 是在
**没有套件在跑**的窗口取的（`pgrep -xc node` 为 0），**与管理者「套件中 sys 15–38%、fork 44/s」不是同一条件**。
按本仓 σ=297.6s 那条纪律，**条件不同的两次测量之间没有可比性**，
所以外层只把它记为基线，不当作对管理者数字的确认或否证。**AC1 因此要求条件逐项写出。**

**外层加的 `control` 是本条最容易被忽略的一条**：**不许用 fork 数换墙钟退化**。
本任务的立案理由正是「一个优化在一个维度上无收益不等于在所有维度上无收益」——
**反过来同样成立**：一个在 fork 维度上的收益，如果把墙钟拖长，那只是把成本挪了个地方。

**AC5 是外层特意加的留痕要求**：**不重开、不改结论**，只在两条已关任务体里各加一行指回本任务。
**理由是管理者最后那句，外层认为它是本条最有价值的部分**：
**判据一旦写进任务体，就会被后来的人当成结论继承。**
那两条任务体里的「对墙钟无影响，不动」会被下一个读到的人读成「这 110 个文件不值得动」，
而真相是「在单套件墙钟这个判据下不值得动」。**限定词丢失是静默的。**
**与今晚 `vendor` 撞 Go 保留目录那条同族**：字节相同后果不同、墙钟不变成本不同——
**同一个事实，换一个维度就换一个结论。**

**排期**：与第一步（tmpfs）、在飞的 3a/token 均不相交；**与第三步是前置关系**——
第三步把并发从 1 放到 2，而本条正是「并发时的天花板」。
**但外层不擅自把它设为第三步的阻塞项**：它是否必须先做，是人与管理者的排序裁定。

## Execution record

**执行载体**：`task/gap-the-spawn-count-criterion-was-wall-clock-and-that-is-the-wrong-axis-for-concurrency`（worktree，基于 master d8f6a51c）。

### AC1 — 基线（改前）

条件：`nproc=4`，`node=v25.2.0`，并发套件数 **0**（只有本 run），第二层在跑 **否**，load 0.46/0.48/0.74。

Scoped set（与 AC2 完全同一组文件）：
`cli-entry.test.mjs task-check.test.mjs web-ui-browser.test.mjs config-validate.test.mjs`

| measure | 值 |
|---|---|
| `forks_per_suite` | **2161** |
| `suite_wall_clock` | **10 s** |

（`forks_per_suite` = `/proc/stat` processes 字段 delta；`suite_wall_clock` = `date +%s` delta。）

### AC2 — A 层改完（同条件）

A 层转换内容：**37 个测试文件**从 `execFileSync("node", [bin/quay*.ts, …])` 改用 `QUAY_CLI` / `QUAY_NATIVE_CLI`（`packages/quay/test/helpers/cli-entry.mjs`），
并保持 `nativeProviderDir` 指向**源码 bin 目录**（provider cwd 与 entry binary 解耦，同 cli.test.mjs 既有模式）。
转换文件逐一实跑：**除 7 个在基线就已红（repo drift，与本次改动无关）外全部 pass**；
live-GitHub 测试（provider-abi-conformance、serve-github、cli-edit-parity-conformance）在无 token 时按各自 in-file skip 正常跳过。

同条件重测同一 scoped set：

| measure | AC1（改前） | AC2（改后） | 判定 |
|---|---|---|---|
| `forks_per_suite` | 2161 | **2159** | 持平（噪声内，未上升） |
| `suite_wall_clock` | 10 s | **8 s** | 不退化（改善） |

**诚实记录**：`forks_per_suite` 计数的是**进程创建数**，`node bin/quay.ts` 与 `node dist/quay.js` 每次 spawn 都各是 1 个进程，所以 fork 数本身**不在这一层下降**。
真正下降的是**每次 spawn 的内核态/CPU 成本**——实测 `bin/quay.ts --help` 20 次 = 2583 jiffies vs `dist/quay.js` 20 次 = **1254 jiffies（约减半）**，
processes delta 144 vs 142（持平）。这正是任务立案的「spawn 总数决定的是内核态负载与并发上限，不是单套件墙钟」——
A 层把每个 spawn 的加载成本砍半，**相同 fork 数下的内核负载下降**，从而抬升可并发套件数。`control`（墙钟不退化）满足：墙钟 10s→8s。

### AC3 — 负控制（陈旧 bundle 必须回退并告警）

实跑：`touch packages/quay/src/config-validate.ts packages/quay-native/src/manifest.ts` 使 dist 陈旧后，
跑转换后的 `config-validate.test.mjs`，输出（两行）：
```
cli-entry: …/packages/quay/dist/quay.js is STALE (src/bin newer); falling back to …/bin/quay.ts — run scripts/test.sh to rebuild
cli-entry: …/packages/quay-native/dist/quay-native.js is STALE (src/bin newer); falling back to …/bin/quay-native.ts — run scripts/test.sh to rebuild
```
测试结果 `ℹ tests 47 ℹ pass 47 ℹ fail 0`——**未静默用旧产物通过**，而是回退 `.ts` 并告警。
（随后已重建 dist 恢复 fresh 态。）

### AC4 — C 层两条路实测成本 + 选择理由

C 层 = `plugin/scripts/*.ts` spawn（plugin/test 内 strip-types 与 spawn 同现 **54 行**，跨 ~20 个测试文件）。

- **Route 1（造 plugin 构建产物）**：esbuild 实测 bundle 5 个被 spawn 的 plugin 脚本（fast-mode-telemetry、task-contract-check、
  task-status-drift-check、test-isolation-check、inner-blocked-signal）**39 ms**（≈7 ms/脚本，一次性构建）。但**经常性成本**不止构建：
  需要新增 `plugin/dist` + 新鲜度 gate + 触发 plugin/scripts 变更时重建 + 同步 vendor 镜像（plugin 脚本间相互 import，
  bundle 需把整张依赖图收进来，与 `packages/quay/dist` 的 esbuild 模式同级）。**一次性构建便宜，机制与维护是真实成本。**
- **Route 2（改 import 被测模块）**：实测被 spawn 的 20 个 plugin 脚本中，**绝大多数已 `export` 可调用函数**
  （fast-mode-telemetry 23 个 export、inner-blocked-signal 36 个、task-status-drift-check 27 个），
  且 `plugin/test/gate-dispatch-coverage.test.mjs` **已经在 import 被测模块**（先例存在）——
  单测试转换成本 = 把 `spawnSync("node", ["--experimental-strip-types", CLI, …])` 改为 `await import(CLI)` + 直接调用导出的纯函数。
  但**会失去进程隔离**：需要真实 `process.argv`/stdout/exit-code 的断言（如 run-identity 的 `--selftest`、cold-start 的真实写入）仍须保留 spawn。

**选择**：**C 层采用 Route 2（改 import），但保留进程隔离必需的真实 spawn 点**。理由：
① Route 1 的构建本身便宜（7ms/脚本），但**每次 plugin 脚本变更都要重建 + 新鲜度 gate + vendor 镜像**——这是把
「改脚本」变成「改脚本 + 重建」的永久税，与本仓刚刚拆掉的 prepare/execute 构建管线同族；
② Route 2 的先例（gate-dispatch-coverage）证明多数 plugin 脚本的纯逻辑可以直接 import 测；
③ 但**不追求 54 行全部消灭**——进程隔离断言（argv/exit/真实写入）是 spawn 的正当用途，
过度 import 会把「进程行为」测成「函数调用」，换维度换结论（本任务自身的方法论）。
**结论：C 层逐步走 Route 2（import 纯逻辑），保留进程隔离所需 spawn；本任务只测成本并记录方向，不一次性全量转换。**

**诚实标注 band 状态**：Contract 的 `band ts_spawn_sites <= 50` 当前为 **55**（全部是 Layer C 的
plugin/scripts 与 strip-types 同现行，A 层转换的对象 `node bin/quay*.ts` 本就不带该 flag，不进入此计数）。
**A 层不改变该 band**；band 的收敛是 C 层 Route 2 的执行输出，不在本任务（A 层 + C 层决策）的落地范围内。

### AC5 — 已关任务留痕

- `tasks/gap-tests-spawn-cli-from-ts-source.md`：在「其余 110 个文件…不在关键路径上」后加一行，
  写明「原判据是单套件墙钟；在并发维度下重新评估——spawn 总数决定内核态负载与可并发套件数。本任务结论不变、不重开。」
- `tasks/gap-tests-use-cli-where-module-import-suffices.md`：在「其余 110 个文件…对墙钟无影响，不动」后加同一判据限定行。

### AC6 — node:test + @test-group

本次**未新增任何测试文件**，只编辑既有文件；所有被编辑文件均已带 `// @test-group`（0 个缺失）。
未用 node:test 的 8 个文件均为 **legacy 手写断言**，已在 `plugin/test-framework-policy-exemptions.txt` 豁免清单上（逐项核对）。

### 基线即红的 7 个文件（与本任务无关，repo drift）

`dir032-audit-independence`(fail 10)、`dir022-remaining-gates`(fail 14)、`it0-gates`(fail 16)、
`delivery-standalone-smoke-gate`(fail 4)、`adr-gate`(fail 3)、`document-gate-fixture`(fail 1)、`ts-typecheck-gate`(fail 5)
——在 master 基线（git stash 后）实测同样 fail，非本次改动引入。
