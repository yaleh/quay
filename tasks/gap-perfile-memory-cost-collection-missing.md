---
id: gap-perfile-memory-cost-collection-missing
title: 逐文件内存成本采集缺失——per-file-cpu-report.mjs 只报 CPU,verification-round.jsonl
  的内存字段只有整轮粒度
status: ready
labels:
  - gap
  - mechanism
  - observability
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

当前测试基础设施(`plugin/scripts/per-file-cpu-report.mjs`,通过 `NODE_OPTIONS=--require` 注入每个隔离的测试文件子进程,由 `gap-perfile-cpu-cost-collection`/`gap-suite-scheduler-perfile-cpu-emitter-missing` 两个已 done 任务落地)只采集 CPU 用量(`process.cpuUsage()` + 已回收子进程的 cutime/cstime,写入 `cpuMs` 字段,最终落进 `.quay/verification-round.jsonl` 的 `perFile[].cpuMs`),**完全没有逐文件的内存数据**。

`.quay/verification-round.jsonl` 里确实有 `mem_peak_mb`/`swap_peak_mb` 字段(`gap-verification-round-load-fields-from-systemd` 落地,读 systemd scope 退出行 `Consumed ... memory peak ...`),但只在**整轮**粒度记录——查了历史数据,没有任何窄范围(几个文件)的轮次带内存数据,结构上无法把某次内存峰值归因到具体某个测试文件。这在系统频繁 OOM(swap 一度占用超 80%)、需要定位内存热点测试时是一个明确的可观测性缺口——只能退而用逐文件 CPU 用量做代理指标,而 CPU 高不等于内存高(尤其是纯 I/O/子进程等待型的测试,这类文件的体质判别正是 `gap-perfile-cpu-cost-collection` 里 Type 2 类别关心的对象,而 CPU 代理对这类文件恰恰最没有分辨力)。

**关联(相关但不同机制,非重复)**:
- `gap-perfile-cpu-cost-collection`(done)/`gap-suite-scheduler-perfile-cpu-emitter-missing`(done)——同一套子进程自报 seam(`per-file-cpu-report.mjs`),但只报 CPU,本任务是它的内存镜像半边。
- `gap-verification-round-load-fields-from-systemd`(done)——整轮粒度的 `mem_peak_mb`/`swap_peak_mb`,读的是 systemd scope 退出行,不是逐文件,且该字段本身也只在近全量套件轮次(589-652 个文件)出现过,窄范围轮次结构上没有该数据。

## Proposal

照抄 `per-file-cpu-report.mjs` 已经验证过的"子进程自报"手法(同一个 exit 钩子里顺带做,不需要新的注入点):

1. 在同一个 `process.once("exit", ...)` 钩子里,除了现有的 `cpuMs` 计算,额外读:
   - 本进程自身:`process.resourceUsage().maxRSS`(单位 KB,内核记录的**整个进程生命周期内的峰值** RSS)——优先于 `process.memoryUsage().rss`(那是退出那一刻的快照,会因退出前的 GC/释放而低估峰值)。
   - 子进程内存覆盖是结构性难点:`cutime`/`cstime` 那一路只能算 CPU 时间,算不出内存——子进程(如 `worker-driver-fan-in.test.mjs` 这类会 spawn 真实 quay task worker 子进程的文件)的内存需要每个被 spawn 的子进程各自也在退出时上报(如果它们也是 node 进程且可控),或者退化为"仅覆盖本进程自身"并在文档里如实标注这个覆盖边界(不得假装覆盖了子进程内存——呼应硬规则 3b)。
2. 输出字段命名为 `memPeakKb`(内存不是时间单位,不沿用 `*Ms` 命名风格),写进同一份 `<cpuDir>/<key>.cpu` 文件,或新增 `<key>.mem` 文件——两种都可以,由实现者根据 `measure-suite-reporter.mjs` 现有的读取契约决定哪种改动更小。
3. `measure-suite-reporter.mjs` 对应读出这个新字段,追加到 `__PERFILE__` 行(如 `__PERFILE__ duration_ms=... passed=... cpu_ms=... mem_peak_kb=...`),并写进 `.quay/verification-round.jsonl` 的 `perFile[].memPeakKb`。**已知同族缺陷**:`gap-suite-scheduler-perfile-cpu-emitter-missing` 实证过 `__PERFILE__` 有**两处独立发射代码**(`measure-suite-reporter.mjs:196` 的 legacy 路径 + `suite-scheduler.ts:343` 统一调度器路径,后者才是 2026-08-31 起的生产默认入口),只改一处会导致生产从未产出——本任务落地后必须在**统一调度器路径**(`QUAY_SUITE_SCHEDULER=1`)下端到端复现,不能只验 legacy 路径。
4. 如实标注覆盖边界:只覆盖"被 node:test 隔离出的这一个测试文件自己的进程",不覆盖它 spawn 出的、且不受这套机制控制的外部子进程(除非那些子进程本身也是可控的、可以注入同一份 preload 的 node 进程——需要实现者核实哪些子进程满足这个条件)。

## Implementation（实现落点，2026-09-14）

- **Proposal 第 2 条选了 `<key>.mem` 独立文件**（而不是把两个值塞进 `.cpu`）：`.cpu` 的读取契约是"一个裸数字"，改动它要同时动 writer/reader/既有测试三处；新增一个同键同目录的 `<key>.mem` 只需加一个读器，CPU 侧的契约逐字不动。
- 读器做成**单一实现 + 两个薄导出**：`measure-suite-reporter.mjs` 新增私有 `readPerFileMetric(file, ext)`，`readPerFileCpuMs` / `readPerFileMemPeakKb` 都委托它 —— 键派生与"缺席⇒省略"契约不可能在两个维度间漂移（同一份"两处发射点共享一个读器"纪律的延伸）。
- 环境变量**不新增**：同一个 `QUAY_PERFILE_CPU_DIR` 目录同时装 `.cpu` 与 `.mem`。多一个 env 就是多一处要接的线，正是 `gap-suite-scheduler-perfile-cpu-emitter-missing` 已经付过代价的那类漂移。

## Touches

- plugin/scripts/per-file-cpu-report.mjs（route (a) 子进程自报 preload seam：同一 exit 钩子追加 `process.resourceUsage().maxRSS` 内核峰值，写 `<key>.mem`）
- plugin/scripts/measure-suite-reporter.mjs（单一读器 `readPerFileMemPeakKb`（与 `readPerFileCpuMs` 共用 `readPerFileMetric`）+ legacy/LPT 发射点追加 `mem_peak_kb=`）
- plugin/scripts/suite-scheduler.ts（统一调度器发射点，复用同一读器；生产默认入口，⛔ 禁止只改一边）
- plugin/scripts/measure-trend-check.ts（`parsePerFileLines` 第五个可选尾字段 `mem_peak_kb=` → `PerFileRecord.memPeakKb`；两个 round-record writer 共用的唯一口径）
- plugin/scripts/full-suite-runner.ts（round-record writer 之一：perFile 成形面带 memPeakKb）
- plugin/scripts/pre-verified-round-record.ts（round-record writer 之二：同款字段，禁止只改一边）
- plugin/test/measure-suite-reporter.test.mjs（AC1 峰值 vs 退出快照差分夹具 + AC4 负控制 + 读器单测 + AC5 两条发射路径端到端）
- plugin/test/suite-scheduler.test.mjs（统一调度器路径端到端发射断言）
- plugin/test/measure-trend-check.test.mjs（新旧行形解析 + 缺席非 0）
- plugin/test/full-suite-runner.test.mjs（writer 之一带该字段）
- plugin/test/pre-verified-round-record.test.mjs（writer 之二带该字段）
- plugin/test/driver-anchor.test.mjs（**⛔ 非本任务 delta**：落地时修掉的 suite-red 阻塞——夹具的 fake driver 必须 import anchor 实际加载的那份 kernel，否则停机登记表分裂；机制、两向对照与边界见下方 Evidence 的「落地时修掉的 suite-red 阻塞」一节）
- tasks/gap-perfile-memory-cost-collection-missing.md（自身）

**⚠️ 本清单已按实现核实改写**：原文列的 `plugin/test/measure-suite.test.mjs` **在仓库里不存在**（撰写时按"机制自己的测试落在哪些文件"猜的，任务体自己就写明需实现者核实）。实测该机制的测试落在 `measure-suite-reporter.test.mjs`（preload seam 的接线 + 行形）与 `suite-scheduler.test.mjs`（调度器发射），这两份都在原文清单里；本次实际改动的是上面这 12 个文件 + 自身任务体。

## Acceptance Criteria

- [x] AC1:新字段(`memPeakKb` 或等价命名)真实来自 `process.resourceUsage().maxRSS` 或等价的内核峰值读数,不是 `process.memoryUsage().rss` 的退出时快照——需实测两者在同一个人为分配大对象又释放的夹具上的差异,证明选用的是真峰值读数(不是退出时快照,后者会因 GC/释放低估峰值)。
- [x] AC2:`.quay/verification-round.jsonl` 的 `perFile[]` 条目真实出现新字段,贴一条真实生产轮次(落地提交时刻之后)的记录作证据,非 fixture/单测数据(硬规则 4 推论三)。
- [x] AC3:覆盖边界如实写进代码注释和本任务的 Evidence——明确说明是否覆盖子进程内存,如果不覆盖,说明为什么以及后续如果要覆盖需要什么(呼应硬规则 3b:不得把"部分覆盖"伪装成"全覆盖")。
- [x] AC4:负控制——一个几乎不分配内存的测试文件(如纯断言测试)报出的 `memPeakKb` 应该明显低于一个故意分配大对象(如几十 MB 数组)的夹具测试文件,证明该读数真的能取假、不是恒定值。
- [x] AC5:落地后必须核实统一调度器路径(`QUAY_SUITE_SCHEDULER=1`,生产默认入口)与 legacy 路径**都**产出该字段——不得重复 `gap-suite-scheduler-perfile-cpu-emitter-missing` 那次"只验了一条路径就标 done,另一条路径生产从未产出"的缺陷;贴两条路径各自的端到端复现证据。
- [x] AC6:`scripts/test.sh` 对应泳道绿。

## Definition of Done

逐文件内存峰值读数真实落进 `perFile[]` 记录(两条 `__PERFILE__` 发射路径都接上、两个 round-record writer 若涉及都带上该字段);AC1-AC6 全部勾选且勾选状态与本 DoD 文字一致;生产载体(非 fixture)贴出至少一条落地后的真实记录;覆盖边界(是否含子进程内存)如实写进代码与 Evidence,不伪装成全覆盖;负控制证明该读数有分辨力、非恒定值;全量测试绿。

## Evidence

实现提交：`549596281`（主体）+ `00f1309ed`（legacy 路径 E2E）。以下读数全部产自这两个提交之后（HEAD 见各条）。**两条独立发射路径用它们各自的签名区分**：调度器的 `duration_ms` 是整数（`Date.now()-startMs`），reporter 的是小数（node:test 的 `details.duration_ms`）——所以下面每条样本都能自证来自哪条路径，不是靠我贴标签。

### AC1 — 读数确实来自 `resourceUsage().maxRSS`（内核峰值），不是退出时快照

**代码面**：`per-file-cpu-report.mjs` 的 exit 钩子里读 `process.resourceUsage().maxRSS`（KB，`getrusage(RUSAGE_SELF)` 高水位），代码里**没有** `process.memoryUsage().rss`（有一条按位置的检查，先剥注释行再断言 —— 注释里为了解释"它不是什么"必须提到那个名字）。

**行为面**：同一个人为分配 128MB Buffer→快照 rss→释放→`global.gc()` 的夹具，实测

```
{"rssBeforeKb":42620,"rssDuringKb":173820,"rssAfterKb":43320,"maxRSS_kb":174332}
```

⇒ 峰值读数 `174332` KB 相对**退出时刻快照** `43320` KB 高 **128 MB**（3.0x）。若字段取自 `memoryUsage().rss`，它只能看到释放后的 ≈43 MB —— 这正是本任务要杀掉的低估形态。同款差分在 `plugin/test/measure-suite-reporter.test.mjs` 的 `AC1/AC4` 测试里作为断言恒常执行（真 `node --test` 子进程 + 真 preload seam，两条断言：`mem_peak_kb ≥ 持有期 rss − 4096` ∧ `mem_peak_kb − 退出期 rss > 64MB`）。

### AC2 — 生产载体 `perFile[].memPeakKb`

真实生产轮（`full-suite-runner.ts` 写的 round 记录，命令是默认全量套件 `bash scripts/test.sh`，`env -u QUAY_PLUGIN_ROOT`，HEAD `fbed359ad`）：

```
round 1736  state=red(见下)  durationMs=475557  pass=8162  fail=1
perFile n=654   perFile_with_memPeakKb=654   perFile_with_cpuMs=654
memPeakKb min=52184   max=1250120 (KB)
```

样本条目（逐字取自该轮记录）：

```
{"file":"plugin/test/runner-grouping-flags-only.test.mjs","durationMs":24588,"passed":true,
 "endedAtMs":1789407574573,"startedAtMs":1789407549985,"cpuMs":24112.03,"memPeakKb":55296}
```

**654/654 全覆盖、且与 `cpuMs` 同号同现** —— 不是"有但是 0"，也不是部分文件有字段。

**该轮 state=red 的唯一失败与本改动无关**：`plugin/test/help-contract-incompatible-behaviors.test.mjs` 的 `AC1: every -check.ts exits 0 + prints usage on --help`（耗时 54.6s，是它自己常态的 2–8 倍，runner 自己的归因标记就是 `in_family:true, kind:child-spawn`）；该文件在**同一棵树上**单独跑是绿的，是已知的 spawn-heavy 负载相关 flake（`suite-red-spawn-heavy-driver-tests-load-correlated` 家族）。**同轮另一次证据（round 1737）state=green**。

### AC3 — 覆盖边界（如实标注，不伪装全覆盖）

- **覆盖**：被测的那一个测试文件自己的进程（node:test 为它 fork 的隔离子进程）——该文件自身的全部进程内分配都算在内，这正是查内存热点/泄漏时的主要目标。
- **⛔ 不覆盖**：该文件 **spawn 出的子进程**的内存。原因是结构性的，不是没做：Node 的 `process.resourceUsage()` 只给 `RUSAGE_SELF`（没有 `RUSAGE_CHILDREN.ru_maxrss` 这个读数）；`/proc/<pid>/stat`（逐文件 CPU 那一路 cutime/cstime 的来源）没有峰值 RSS 列；子进程被 `wait()` 回收之后其 rusage 也不再可取。要覆盖它，只能要求每个被 spawn 的子进程自己上报 —— 只有"本身也是 node 进程、且继承到同一份 `NODE_OPTIONS=--require`"的那些才够得着，非 node 子进程、或被测试自己用 scrubbed env 起的 node 子进程结构性够不到。
- **落点**：这段边界逐字写进了三处代码 —— `per-file-cpu-report.mjs` 头部 `WHAT mem_peak_kb MEANS — and its COVERAGE BOUNDARY`、`measure-suite-reporter.mjs` 的 `readPerFileMemPeakKb` 注释、`measure-trend-check.ts` 的 `PerFileRecord.memPeakKb` 注释。
- **⇒ 消费纪律**：**不要把 `memPeakKb` 读成"这个文件的全部内存成本"**，spawn-heavy 文件尤其（那类文件恰好是 CPU 代理最没分辨力、最想用内存维度看的一类，所以这条边界必须写在最显眼处）。

### AC4 — 负控制（有分辨力，非恒定值）

- **夹具级**（`measure-suite-reporter.test.mjs` 的 `AC1/AC4`）：同一次运行内，故意分配 128MB 的夹具 vs 纯断言的极小夹具，`mem_peak_kb` 相差 **> 50MB**（断言下限）；实测两条读数分别在 ~170 MB 与 ~60 MB 量级。
- **生产级**（round 1736 的 654 个真实文件）：`memPeakKb` 从 **52184 KB 到 1250120 KB（52 MB → 1.22 GB，24x）**。一个恒定值/代理量不可能张开这个范围。

### AC5 — 两条发射路径都端到端产出（不是只验一条）

- **统一调度器路径**（`QUAY_SUITE_SCHEDULER=1`，生产默认入口）：round 1736 的套件日志里 **654 条**真实 `__PERFILE__` 行，`duration_ms` 全是整数（调度器签名），**654 条全部带 `mem_peak_kb=`**。样本：
  `__PERFILE__ duration_ms=24588 .../plugin/test/runner-grouping-flags-only.test.mjs passed=true end_ms=1789407574573 cpu_ms=24112.03 mem_peak_kb=55296`
- **legacy/LPT 路径**（reporter 作为 `--test-reporter`，经生产 `scripts/test.sh --group serial` 的真实分支驱动）：**14 条**真实行，`duration_ms` 全是小数（reporter 签名），**14 条全部带 `mem_peak_kb=`**。样本：
  `__PERFILE__ duration_ms=1812.229654 .../plugin/test/conformance-target-fixture.test.mjs passed=true end_ms=1789408061765 cpu_ms=1436.621 mem_peak_kb=98876`
- **测试侧同样两条都钉住**：`plugin/test/suite-scheduler.test.mjs`（调度器，端到端子进程）与 `plugin/test/measure-suite-reporter.test.mjs` 的 `AC5` 用例（legacy，真 `--test-reporter` + 真 preload，断言字符串含 `mem_peak_kb=`）。两条路径都从 `readPerFileMemPeakKb` 单一读器取数 —— 只改一边会立刻红。
- **全仓只有两处 `__PERFILE__` 发射点**（按位置扫过整仓，非只改被报出来的那个）：`measure-suite-reporter.mjs` 与 `suite-scheduler.ts`，两处都接上了。

### AC6 — `scripts/test.sh` 对应泳道

在最终树（HEAD `fbed359ad`，已 merge 当时的 develop）上：

```
bash scripts/test.sh --for-task gap-perfile-memory-cost-collection-missing --allow-thin
⇒ exit 0；ℹ tests 193 / pass 193 / fail 0；11 条静态检查全 PASS
```

### 取证过程中实测到的两个坑（写给后人，避免重踩）

1. **`QUAY_PLUGIN_ROOT` 会让 runner 的 per-file 采集指向主检出**：worker 环境导出 `QUAY_PLUGIN_ROOT=<主检出>/plugin`，而 `full-suite-runner.ts` 的 `PER_FILE_CPU_PRELOAD = resolveKernelPluginRoot()/scripts/per-file-cpu-report.mjs` **优先读它** ⇒ 从 worktree 起的 runner 会把**主检出那份**（改动未落地时 = 旧代码）preload 烘进 `NODE_OPTIONS`。实测：第一次证据轮 6 条真实 `__PERFILE__` 行**全部只有 `cpu_ms=` 而没有 `mem_peak_kb=`**，看起来像"新字段没接上"；`env -u QUAY_PLUGIN_ROOT` 后同一条命令立刻恢复 654/654。**这不是本改动引入的**（`resolveKernelPluginRoot` 是既有机制），但它会让任何"在 worktree 里验一个 preload 改动"的尝试跑成假阴性。**⇒ 生产上这个字段同样要等主检出那份同步到本改动之后才会亮**（author↔develop 同步链），与 sibling 的 `cpu_ms` 同一个前提。
2. **`--for-task`/`--scoped` 路径结构上不接 per-file 成本采集**：`scripts/test.sh` 的该分支直接 `node --test <files>`，既没有 `$(suite_reporter_flags)` 也没有调度器 ⇒ **不可能**产出 `__PERFILE__`。用它取证会得到"0 条"并误判为"字段没接上"（第一次尝试就是这样，0 条）。取证必须走全量/分组路径（或直接调调度器）。

### 落地时修掉的 suite-red 阻塞（⛔ 非本任务 delta，如实划界）

本任务前两轮 `exited-not-landed` 都停在 `step=suite`，失败断言是 `stop --kind goal` / `stop --kind worker`（`plugin/test/driver-anchor.test.mjs`）。**如实说明：这是本任务 delta 之外的既有缺陷**，两条独立证据：

1. `plugin/test/driver-anchor.test.mjs`、`plugin/scripts/driver-runtime.ts`、`plugin/scripts/driver-anchor.ts` 在本分支与 develop **逐字相同**（`git diff HEAD develop -- <三者>` 为空），且 `driver-runtime.ts` 不 import 本任务改动的任何文件（一跳 import 无交集）。
2. 单跑即复现（⛔ 不是负载 flake）：`env -u QUAY_PLUGIN_ROOT node --test plugin/test/driver-anchor.test.mjs` ⇒ 两条断言各等满 60s 后失败（62325ms / 65321ms）。

**真因（实测，非推测）**：anchor 进程经 `preferredAnchorKernel()` **优先主检出**的内核（AC-184/AC-255 的设计：常驻 anchor 的生存期⛔ 不绑在短命 worktree 路径上），而停机登记表（`registerKindStop`/`requestKindStop`）是**模块级**的（`driver-anchor.ts` 头注释：「在本进程里只有一个模块实例，登记表才与各 kind 看到的是同一张」）。夹具原本硬编码 import worktree 那份 `driver-runtime` ⇒ anchor 与夹具各持一张**独立登记表** ⇒ `requestKindStop(kind)` 置的不是该 kind 读的那个标志 ⇒ `stop --kind X` 永远等不到收尾，等满 60s 后 exit 1 —— 与「该 kind 的循环真的挂了」**同形**（硬规则 3b 的同形异因）。故本文件在**任何 worktree** 里都是确定性红，这正是前两轮卡的同一个点。

**两向对照（同一棵树，只改夹具那一行 import）**：

| 夹具 import 哪份 kernel | AC3①（`stop --kind goal`） | AC6（`stop --kind worker`） |
|---|---|---|
| worktree 那份（原状） | 62325 ms / **FAIL** | 65321 ms / **FAIL** |
| 主检出那份（= anchor 实际加载的） | 2739 ms / **PASS** | 6784 ms / **PASS** |

**改法**：`DRIVER_RUNTIME_ABS` 由 `preferredAnchorKernel()` 派生（+ 存在性断言，⛔ 不静默回退到一个自造路径 —— 硬规则 3b）。修后整文件 `EXIT=0`，6/6 全绿（提交 `d29592113`）。

**⚠️ 如实标注该修法的边界（⛔ 不声称它做不到的事）**：本文件因此验的是 anchor **实际加载的那份**内核 —— 在 worktree 里 = 主检出那份 ⇒ **worktree 中对 anchor 内核本身的改动不会被本文件验到**（`driver-runtime.ts` 的 `preferredAnchorKernel` 注释里已明记该形态「结构上无法自测」）。这是 anchor 形态的性质，⛔ 不是夹具能绕开的，故本修法**不**使 anchor 改动在 worktree 里变得可测。

**同源的生产面风险（本任务⛔ 不修，只记，留给 anchor 归属的任务裁定）**：`spawnAnchor` 透传 `env: process.env`（不剥 `QUAY_PLUGIN_ROOT`），而 `invokeKindDefault` 经 `resolveKernelSibling` 解析 kind 模块（= `$QUAY_PLUGIN_ROOT/scripts` 优先）。⇒ 当 anchor 的内核与 `QUAY_PLUGIN_ROOT` **指向不同的 plugin 目录**时，同一套登记表分裂在**生产**上也会发生（`stop --kind X` 退化成等满 60s 的 no-op，且 `stopKindViaAnchor` 会打 `loop did not stop within 60s` 后返回 1）。常规配置下两者同目录，故未观察到；机制与上面这条完全相同，属 anchor 形态的设计面。
