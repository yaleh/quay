# 测试隔离契约（Test-Isolation Contract）

**来源任务：** `tasks/gap-test-isolation-contract-is-unwritten.md`（2026-08-02/03）

## 类：测试触碰了它不独占的东西

2026-08-02/03 一晚出现**三个**「隔离下 100% 绿、全量套件里红」的失败，且是同一个类：

| # | 测试 | 机制 | 已修 |
|---|---|---|---|
| 1 | M136（`plugin-packaging`） | 别的测试在套件运行中**重建共享 `dist/quay.js`** | ✓（三轮） |
| 2 | `relation-sync` | 固定共享路径 `__dirname/.tmp-relation-sync-test`（8 并发副本实测 **7/8 崩**）+ harness 静默退出 | ✓ |
| 3 | `AC11`（`select-tests-for-touches`） | 测试在套件内 **spawn 一个完整的 `scripts/test.sh`**，嵌套运行要在争抢中完成 esbuild + 一轮测试，60s 预算 | 在飞 |

三次的共同点：**测试触碰了它不独占的东西**——共享构建产物、共享目录、或整个 runner 本身。

**诊断成本被同一件事放大**：手写 harness 失败时说不出话（见
`orchestration/test-shape-analysis.md`：34 个非 `node:test` 文件，其中 **8 个**在失败路径上用危险的
`process.exit(1)`）。

本契约的作用：让第四次在**写下时就被拦住**，而不是在套件红了之后花三轮去找。

## 六条规则（直接从三个实例归纳，后补 R5/R6，不预先扩充）

### R1 · 写入路径必须每运行唯一（`mkdtemp`），不得是固定路径

> 来源：relation-sync。它用固定的 `path.join(__dirname, ".tmp-relation-sync-test")`，每次
> `rmSync` + `mkdirSync` 同一个目录；**8 个并发副本实测 7/8 崩**（副本 A 的 rmSync 删掉副本 B 正在读的文件）。
> 修复：`fs.mkdtempSync(path.join(os.tmpdir(), "relation-sync-test-"))` —— 每运行唯一。

**扫描信号**：`path.join(__dirname, … ".tmp…")` 的 dot-tmp 目录，**且不是 `mkdtemp` 的前缀**
（`mkdtempSync(path.join(…, ".tmp-tree-"))` 是每运行唯一的，安全）。

### R2 · 不得重建/覆盖共享构建产物（`packages/*/dist/`、`plugin/vendor/`）

> 来源：M136（三轮）。测试在套件运行中**重建共享 `dist/quay.js`**，导致别的测试（`sync-vendor.sh --check`）
> 读到漂移的 vendored 副本而**确定性失败**——且 DRIFT 消息把被比较的文件标错，让排查读成「flaky」。
> 修复（round-3）：构建输出改走临时目录（`build-dist.test.mjs` 的
> `QUAY_BUILD_DIST_OUTFILE` → `os.tmpdir()` 下的 `dist/quay.js`）。

**扫描信号**：以**同步模式**调用 `sync-vendor.sh`（不带 `--check`，会把源 dist 镜像进共享
`plugin/vendor/`），或直接写操作指向字面量 `packages/<pkg>/dist/` / `plugin/vendor/` 路径。
**安全形态**：构建到 `mkdtemp`/`os.tmpdir()` 临时树（`build-dist.test.mjs` 的 M136 round-3 处置）。

### R3 · 不得在套件内 spawn 完整的 runner（`scripts/test.sh`）

> 来源：AC11（`select-tests-for-touches`）。测试在套件内 spawn 完整的 `scripts/test.sh`，嵌套运行要在
> 争抢中完成 esbuild + 一轮测试，**60s 预算被外层负载绑架** —— 隔离绿、套件红（run 1 pass / run 2 fail）。
> 缓解：`QUAY_TEST_SKIP_DIST_BUILD=1` 让内层跳过重建（嵌套的 `--for-task`/0-match 运行不消费 bundle，
> 跳过不会测到陈旧代码）。**但结构暴露仍在**：外层负载仍是内层的成败条件。

**扫描信号**：spawn/exec 子进程调用（`spawnSync`/`spawn`/`execSync`/`execFileSync`/`execFile`）的参数
引用了 `scripts/test.sh` —— 字面量（`test-coverage-check`）或经声明的变量
（`const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh")`，`select-tests-for-touches`、
`runner-grouping`）。

### R4 · 手写 harness 的失败路径必须用 `process.exitCode`，不得用 `process.exit(1)`

> 来源：relation-sync 的 harness。`process.exit(1)` 立即终止、不等事件循环；POSIX 管道下 stderr 是
> **异步写** ⇒ 断言输出被丢弃，套件只留给外层一行 `✖ relation-sync.test.mjs (Nms)` —— 无法诊断。
> 修复：FAIL/汇总改 `fs.writeSync(2, …)` + 退出改 `process.exitCode = 1`。

**扫描信号**：**非 `node:test`** 文件里，代码位置上的 `process.exit(1)`。`process.exitCode = 1` 永不报；
`node:test` 文件里的 `process.exit(1)`（例如写进模板字符串的 child 脚本）不在规则范围内。

### R5 · 不得依赖运行环境仓库的 git 历史（浅克隆必须绿）（2026-08-03 补）

**来自**：CI 红（2026-08-03）——`prepare-admission-check.test.mjs` 两个已知-good 用例引用本仓真实提交
`335317d` + `REPO_ROOT` 作 workspace；`actions/checkout@v4` 默认 depth-1 浅克隆没有旧提交，
`git cat-file -e <sha>^{commit}` 判它缺失 → 一个真实 precedent 在 CI 被误判为缺失。

**规则**：测试断言「某个 commit 存在」时，必须用一个**临时 git 仓库**构造已知 commit（或用一个
任何克隆里都存在的 commit），**不得引用本仓当前历史**。一个依赖运行环境仓库历史的测试，对任何浅克隆的
人都会红，且结果取决于在哪里跑。机械判据：测试代码里出现 `<REPO_ROOT 作 workspace 传给 git>` + 引用
非 HEAD 的提交哈希 → 潜在违规。

**实例修复**：`prepare-admission-check.test.mjs` 的 `makeGitWorkspaceWithCommit()`（临时 repo + 已知 commit）。

### R6 · `mkdtemp` 建的目录必须在同一测试内删除（用 try/finally 或 `t.after()`）（2026-08-03 补）

> 来源：`tasks/gap-tests-never-clean-up-their-tmpdirs.md`——2026-08-03 发现 `/tmp`（tmpfs，内存盘）积了
> **166,923 个顶层条目、6.3 GB**（占内存，不是磁盘），最早时间戳 2026-07-25，积了 9 天。根因：
> 测试用 `mkdtemp` 建**每运行唯一**目录（R1 满足——名字带随机后缀，每次新建一个），但**没有任何规则
> 要求删掉它**。R1 只写了契约的一半。
> 修复：**同一测试内删除**——`try/finally`，或 `t.after(() => fs.rmSync(dir, {recursive:true, force:true}))`。
> 静态可判（AC5）：**有 `mkdtemp` 而无对应的 `rm`/`rmSync`/`after` 即报出**。

**收紧（2026-08-03，`tasks/gap-tmp-leak-is-live-r6-absolves-a-file-for-one-cleanup-call.md`）**：旧判据是
**文件级存在性**——文件里**任何**清理构造（`rmSync(`/`rm(`/`t.after(`/`after(`/`finally {`）就放行整个文件。
一个「7 个 `mkdtemp`、2 个无关清理（比如 finally 只恢复 env）」的文件因此与全清文件不可区分；本小时的
冠亚军 `driver`/`gate` 已被基线化、第三名 `gate-diagnostics`（7 建 2 清）根本没上名单——再按前缀修一轮
修不住。**收紧后判据能识别部分清理**：每个变量赋值的 `mkdtemp` 结果都必须被一条清理路径覆盖：

- **直接覆盖**：该变量出现在某个清理构造（`rmSync`/`rm`/`unlinkSync` 调用区、`after`/`afterEach` 钩子区、
  `finally` 块体）内；或
- **载体数组覆盖**：该变量被 `push` 进一个数组，而该数组出现在清理构造内（`document-store`/`adr-store`
  的 `_createdDirs` + `after(() => for … rmSync)` 形态）；或
- **helper 返回覆盖**：该变量被从某函数 `return` 出去，且**至少一个调用点**把返回值捕获进一个被清理的变量
  （`makeFakeGhBin` → `const fakeBinDir = …` → `rmSync(fakeBinDir)` **不是泄漏**；无人清理返回值的
  `makeWorkspace` **是泄漏**）。

首处未被覆盖的 `mkdtemp` 结果即为 per-file 报告。两条刻意保留的低误报宽限：**整文件没有任何清理构造**
仍报（旧「no-cleanup」形态，`it0-gates`/`gate`/`driver` 之类，名单条目保持有意义）；**内联 `mkdtemp`**
（无赋值变量，如 `return fs.mkdtempSync(...)`）只在它是 `return` 直接值且无调用点捕获+清理时才报，
非 return 的内联 `mkdtemp` 无法静态关联到清理、跳过（宽松）。

**永不匹配** `/tmp/claude-*`（会话数据）与 `/tmp/quay-wt-*`（在用 worktree）前缀（AC6）——这两个前缀的
`mkdtemp` 不是测试 fixture，跳过。

**共享修复助手**（`plugin/test/helpers/tmp-workspace.mjs`）：`makeTmpDir(tag)` / `makeTmpWorkspace(tag, …)`
把 `mkdtemp` 与删除注册成一对（文件级 `after()` 钩子，每个测试文件一个进程、各自实例），测试文件不再
各自写 `finally { rmSync }`——上一轮各写各的、只覆盖到当时改的点的教训。

### R7 · 不得写入仓库的 LIVE 产品数据目录（`tasks/`、`.quay/`、`.workflow-events/`、`adr/`）（2026-08-03 补）

> 来源：`tasks/gap-r1-cannot-see-tests-writing-into-the-live-task-store.md`——一个测试 fixture
> 被误提交进真实任务库（`tasks/M-FAKE-FRONTMATTER-SCOPE-M124.md`，提交 `b505d3aa`，随即 revert）。
> R1 的判据要求 **`__dirname` 与 `.tmp` 字面同时成立**，而这次是
> `path.join(process.cwd(), "tasks", "M-FAKE-…md")` —— `process.cwd()` 不在 R1 的正则里、路径里
> 也没有 `.tmp`，两条都不沾，R1 看不见它。它被 `git add -A` 偶然扫进提交才被发现，**不是任何检查
> 报出来的**——这正是本任务存在的理由。

**规则**：测试的写操作（`writeFileSync`/`mkdirSync`/`appendFileSync`/`rmSync`/`unlinkSync`/`cpSync`/
`createWriteStream`…）目标路径不得解析进仓库的 **LIVE 产品数据目录**，且根必须是**非每运行唯一**的
（`process.cwd()`/`__dirname`/`import.meta` —— 共享 checkout）。写进这些目录比写进共享 `.tmp` 路径
严重：污染的是产品数据（`task list`、web UI、`task-status-drift-check`、任务计数都会看见），不只是
测试环境。**安全形态**：根是每运行唯一的（`os.tmpdir()`/`mkdtemp`/`makeTmpDir` 派生的变量）。

**扫描信号**（R7 `live-data-dir-write`，与 R1 并列、严重度更高的单独一类）：
- `path.join(process.cwd(), "tasks", …)` / `path.join(REPO_ROOT, ".quay", …)` 这类**共享根 + LIVE 目录段**的
  join（`process.cwd()`/`__dirname`/`import.meta` 或引用它们的变量作根），且不是 mkdtemp/os.tmpdir 根；
- 字面量相对路径写入 `writeFileSync("tasks/x.md", …)`（仅当文件没有 `process.chdir` 时——chdir 过的
  相对路径基座不可判定）；
- 写操作首参是**变量**、其初始化器是上述 join（`const taskPath = path.join(process.cwd(), "tasks", …)`
  然后 `writeFileSync(taskPath, …)`）——变量溯源一层。

**`process.cwd()` 本身不判违规**：`originalCwd = process.cwd()` 这类保存/恢复用法（14 处，全部无害）
不触发——只有「写 + LIVE 目录段 + 共享根」的组合才报。

**AC2 活标本**：`experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs` 原状
（`path.join(process.cwd(), "tasks", \`${taskId}.md\`)` 写真实任务库）在探测器上线后立即被报出。

**类的规模（实测）**：外层用「写操作 + 真实数据目录路径参数」扫过 `packages/*/test`、`plugin/test`、
`experiments/*/test`，估为 1；**探测器上线后报出第 2 个**——`plugin/test/workflow-event-schema.test.mjs`
的 `path.join(REPO_ROOT, ".workflow-events", \`${event.runId}.jsonl\`)` + `unlinkSync`（固定名 `M248` 的
写+删，`--emit-event` CLI 默认写 LIVE `.workflow-events/`，并发下互相踩）。外层扫描以创建类写操作为主，
漏掉了 `unlinkSync` 删除类写操作——探测器是 unlink/rm 感知的，故发现它。两个实例都已修。

**修复的两个实例**：
- `it0-dod-check.test.mjs`：`runDodCheck` 增加可选 `tasksDir` 参数（纯函数 API，CLI 不传则行为不变），
  测试用 `mkdtemp` 工作区 + `tasks/` 子目录 + `tasksDir` 传入——**真实 frontmatter 文件仍在磁盘上、走同一
  条解析路径**（断言 `milestone:M5` 出现在 pass 消息里证明读的是真文件），只是不再写 LIVE `tasks/`。
- `workflow-event-schema.test.mjs`：CLI `--emit-event` 增加 `WORKFLOW_EVENTS_DIR` 环境变量覆盖
  （默认仍是 `repoRoot/.workflow-events`），测试把输出重定向到 `mkdtemp` 目录——CLI 创建→读→校验的
  端到端覆盖保留。

**棘轮**：名单 44 → 45 → 44。44→45 是 AC2 活标本验证期间为 `it0-dod-check` 基线化一条；45→44 是两个
实例都修完后删掉。`# baseline-count` 封顶永久不变（51）。

### R8 · `mkdtemp` 的根不得解析进共享检出（`REPO_ROOT`/`repoRoot`/`__dirname`/`process.cwd()`）（2026-08-03 补）

> 来源：`tasks/gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree.md`——外层 tick 时在共享工作树里
> 看到未跟踪目录 `.quay-tmp-test-o30sII/`，追到 `ts-typecheck-gate.test.mjs:69` 的
> `mkdtempSync(path.join(REPO_ROOT, ".quay-tmp-test-"))`。名字是每运行唯一的（R1 的一半满足了），
> 但**它落在共享检出里**（R1 意图的另一半「不要弄脏共享树」没被满足）。三个后果：
> ① 弄脏工作树 ⇒ `restart-readiness-check.sh` 的「工作树干净」硬检查在套件运行期间假失败；
> ② `git add -A` 会把它扫进提交（与今早 `M-FAKE-FRONTMATTER-SCOPE-M124.md` 被扫进 master 同机制）；
> ③ **两条规则都看不见它**——R1 要求 `.tmp` 字面而这里是 `.quay-tmp`（点后不紧跟 tmp）、
> R7 只覆盖 LIVE 数据目录不含仓库根 ⇒ 它正好落在 R1 与 R7 之间。

**规则**：`mkdtemp`/`mkdtempSync` 的**根**（传给它的路径基座）不得解析进共享检出——`REPO_ROOT`/`repoRoot`/
`__dirname`/`import.meta`/`process.cwd()` 及**引用它们的变量**都算。**不变式：每运行唯一 ≠ 可以落在共享检出里**
（per-run-unique is NECESSARY, not SUFFICIENT）。`os.tmpdir()` 派生的根（或 `makeTmp`/`mkdtemp` 派生的变量）
**永不报**；未知根（函数参数等）宽松跳过（R6 的宽松先例）。

**扫描信号**（R8 `shared-root-mkdtemp`，与 R1/R7 并列的新一类）：
- `fs.mkdtempSync(path.join(REPO_ROOT, …))` / `path.join(__dirname, …)` / `path.join(process.cwd(), …)`；
- 变量间接（外层 grep 会漏的写法）：`const ROOT = path.join(REPO_ROOT, "fixtures")` 然后
  `mkdtempSync(path.join(ROOT, …))`——R8 的 `sharedRootVars` 沿声明初始化器追一层。

**AC2 活标本**：探测器上线后报出 **3 个**（外层 grep 的 2 是下界，不是确数——探测器是真正的兜底）：
- `ts-typecheck-gate.test.mjs`（`REPO_ROOT` 根，本次现场目录的来源）；
- `loadbearing-test-gate.test.mjs`（`__dirname` 根，建到 fixtures 子树里）；
- `run-identity.test.mjs`（`TMP = path.join(REPO_ROOT, "tmp")` 根——**grep 没找到的第三个**，靠 gitignore 的
  `tmp/` 掩盖；与任务「不许用 .gitignore 掩盖」的立场冲突，一并修掉）。

**修复的三个实例**：全部改为 `os.tmpdir()` 根（`mkdtempSync(path.join(os.tmpdir(), "<tag>-"))`），
`run-identity` 的 `TMP` 直接改 `os.tmpdir()`。每个 mkdtemp 目录仍在同一测试内删除（R6 不变式保持）。

**棘轮**：名单 44 → 47 → 44。44→47 是 AC2 活标本验证期间为 3 个实例各基线化一条；47→44 是三个实例都修完
后删掉。`# baseline-count` 封顶永久不变（51）。这是**同一形态的第四次**（R1 看不见 `process.cwd()` → R6 文件级
存在性 → R7 不含仓库根 → 本条）：**规则名覆盖类、实现覆盖标本**。

### R9 · 不得依赖挂钟计时判定时序（时序判定须受控假时钟/事件）（2026-08-08 补）

> 来源：`tasks/gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7.md`——并发 8 恒红的根因
> （管理者 2026-08-07 实测）：`session-liveness.test.mjs` 的 noise-gate 测试用真 `sleep(2500)` +
> 10-25 秒等待窗口判定一个真实轮询进程翻转状态；负载下调度延迟超过等待窗口 ⇒ 断言失败。**R1-R7 全部
> 关于文件系统/进程隔离**（mkdtemp 位置、进程生命周期、共享检出写入等），**没有一条覆盖「挂钟计时依赖」**——
> 这是一个现有规则机制上无法捕获的新类别。同款写法（真 sleep + 有限等待窗口）当时还有
> `send-keys-verified` / `monitor-mount-check` / `measure-suite`（B 类共 6 文件）。

**规则**：测试**不得依赖挂钟计时判定时序**——不得用「真 sleep 推进 N 轮 + 固定等待窗口」断言一个
异步/轮询行为在窗口内翻转，因为结果会取决于机器速度与调度负载。时序判定必须用**受控假时钟/事件**
（fake timers / `mock.timers` / 注入事件或回调 / 确定性轮询步进），使结果只取决于输入、不取决于
机器速度或负载。**不变式：一个测试的结果不得因负载（CPU 饥饿 / 调度延迟）而翻转。**

**扫描信号**（R9 `real-wall-clock-wait`，与 R1-R8 并列的新一类）：
- 测试代码里 `sleep(N)`（`setTimeout` / `node:timers/promises`）且 **N ≥ 2000ms** 的长等待
  （机械判据即任务 Contract 的 measure：`grep -rlE 'sleep\(2[0-9]{3}|sleep\([0-9]{4,}' plugin/test/ packages/*/test/`）；
- `Date.now()` / `performance.now()` 直接参与时序断言（未受控时钟源的单调流逝断言）。

**既有测试的处置（2026-08-07 人裁定覆盖「逐文件假时钟重写」方向）**：B 类 6 个挂钟依赖文件
（session-liveness / measure-suite / monitor-mount-check / quay-init-tmux-detection / send-keys-verified /
build-dist-smoke，后者已删）**不逐文件重写**——经 `@test-group lowconc`/`serial` 隔离路由
（见 `tasks/gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests` 与
`tasks/gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive`），从并发主体移出、单独低并发跑，
消除 CPU 饥饿击穿。**本规则约束的是新测试**：新测试不得再引入真挂钟等待判定时序；`wall_clock_tests`
measure 计数不得因新测试上升（当前 3，session-liveness 拆分后的三文件，全部在 `lowconc` 组）。

## 扫描与棘轮（AC2–AC6）

`plugin/scripts/test-isolation-check.ts` 对 `scripts/test.sh --list-files` 的每个文件做七条判定，
**按代码位置匹配**（剥离注释与字符串/正则字面量 —— 复用 `test-framework-policy-check.ts` 的
`buildNonCodeMask`）。「匹配到提到它的注释而非它本身」正是 relation-sync 数 `process.exit(1)` 数到
4 处全是解释性注释的教训。

- **报出而不阻断（AC6）**：已知违规被打印，但不让套件变红。
- **棘轮（AC5）**：`plugin/test-isolation-violations.txt` 是**只能变短**的名单 ——
  - 当前违规**没有**名单条目（新引入的违规）→ 失败；
  - 名单条目相对 git HEAD **变长** → 失败；
  - 名单条目**失效**（违规已修但条目未删）→ 失败（删掉它）；
  - 条目数超过 `# baseline-count` 头（提交后仍存活的封顶）→ 失败。

## 当前基线（2026-08-03，44 条）

`--list` 实测（与 `plugin/loop/fast-mode-loop-tick.md` 判绿无关；本清单是报告，不是门禁）。
2026-08-03 `gap-tmp-leak-is-live-r6-absolves-a-file-for-one-cleanup-call` 修掉 12 个被 R6 放行的
部分清理文件 + 6 个基线化 no-cleanup 文件（`driver`/`gate`/`lifecycle`/`gap002-create-ergonomics`/
`gate-config-loader`/`init`），名单从 50 条缩到 44 条、`mkdtemp-no-cleanup` 从 28 条缩到 22 条：

```
experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs:mkdtemp-no-cleanup
experiments/quay-perpetual-stream/test/drain-dispose-corruption-check.test.mjs:mkdtemp-no-cleanup
experiments/quay-perpetual-stream/test/vmeta-lag-check.test.mjs:fixed-path-write
packages/quay-backlog/test/backlog-client.test.mjs:mkdtemp-no-cleanup
packages/quay-native/test/adversarial-eval.test.mjs:fixed-path-write
packages/quay-native/test/adversarial-eval.test.mjs:process-exit-1
packages/quay-native/test/cas-write.test.mjs:fixed-path-write
packages/quay-native/test/cas-write.test.mjs:process-exit-1
packages/quay-native/test/compound-gate-recursive.test.mjs:fixed-path-write
packages/quay-native/test/compound-gate.test.mjs:fixed-path-write
packages/quay-native/test/create-validation.test.mjs:fixed-path-write
packages/quay-native/test/create-validation.test.mjs:process-exit-1
packages/quay-native/test/document-cli.test.mjs:mkdtemp-no-cleanup
packages/quay-native/test/edit-validation.test.mjs:fixed-path-write
packages/quay-native/test/edit-validation.test.mjs:process-exit-1
packages/quay-native/test/gate-checked-state.test.mjs:fixed-path-write
packages/quay-native/test/gate-correctness.test.mjs:fixed-path-write
packages/quay-native/test/gate-gameability.test.mjs:fixed-path-write
packages/quay-native/test/lock.test.mjs:fixed-path-write
packages/quay-native/test/lock.test.mjs:process-exit-1
packages/quay-native/test/yaml-frontmatter-colon.test.mjs:fixed-path-write
packages/quay-native/test/yaml-frontmatter-colon.test.mjs:process-exit-1
packages/quay/test/cli-adr.test.mjs:mkdtemp-no-cleanup
packages/quay/test/cli-edit-parity-conformance.test.mjs:mkdtemp-no-cleanup
packages/quay/test/cli-entry.test.mjs:mkdtemp-no-cleanup
packages/quay/test/cli-migrate.test.mjs:mkdtemp-no-cleanup
packages/quay/test/delivery-standalone-smoke-gate.test.mjs:mkdtemp-no-cleanup
packages/quay/test/dir022-remaining-gates.test.mjs:mkdtemp-no-cleanup
packages/quay/test/dir032-audit-independence.test.mjs:mkdtemp-no-cleanup
packages/quay/test/document-gate.test.mjs:mkdtemp-no-cleanup
packages/quay/test/dod-gate-set.test.mjs:mkdtemp-no-cleanup
packages/quay/test/frontmatter-store-base.test.mjs:mkdtemp-no-cleanup
packages/quay/test/gap-cli-gate-enforcement.test.mjs:mkdtemp-no-cleanup
packages/quay/test/gap002-create-ergonomics.iteration-0.test.mjs:mkdtemp-no-cleanup
packages/quay/test/gap002-create-ergonomics.iteration-0.test.mjs:process-exit-1
packages/quay/test/gate-list-verbose.test.mjs:mkdtemp-no-cleanup
packages/quay/test/it0-gates.test.mjs:mkdtemp-no-cleanup
packages/quay/test/mcp-config-validate.test.mjs:mkdtemp-no-cleanup
packages/quay/test/provider-abi-conformance.test.mjs:mkdtemp-no-cleanup
plugin/test/plugin-packaging.test.mjs:shared-build-artifact-write
plugin/test/runner-grouping.test.mjs:spawns-test-sh
plugin/test/runtime-usage-inventory.test.mjs:mkdtemp-no-cleanup
plugin/test/select-tests-for-touches.test.mjs:spawns-test-sh
plugin/test/task-contract-check.test.mjs:mkdtemp-no-cleanup
plugin/test/test-coverage-check.test.mjs:spawns-test-sh
```

用已知答案验证（AC3/AC4）：M136 相关（`plugin-packaging`）与 AC11 相关（`select-tests-for-touches`）
在清单里；relation-sync 已修故**不再报**；7 个剩余 `process.exit(1)` 手写 harness 全部在列。
R6 新增 28 条 `mkdtemp-no-cleanup`（gap-tests-never-clean-up-their-tmpdirs，2026-08-03 引入）——
`adr-store`/`document-store`/`loop-params` 已修故**不在列**。

## 已知局限（对抗评审记录，2026-08-03）

- **R1 只识别 dot-tmp 形态**：固定路径契约的机械信号是 `__dirname/.tmp-*` dot-tmp 目录（从实例归纳，
  按任务要求「不预先扩充」）。非 `.tmp` 的固定路径写入（如 `path.join(__dirname, "out.json")`）不被报。
  **R7 部分补上了「写进 LIVE 产品数据目录」的那一块**（`tasks/`/`.quay/`/`.workflow-events/`/`adr/`）；
  其它非 `.tmp`、非 LIVE 目录的固定路径（如 `path.join(__dirname, "out.json")`）仍是 R1 已知盲区，
  无当前实例，不预先扩充。
- **R2 直接写共享产物只认首参字面量**：`writeFileSync("packages/quay/dist/x.js", …)` 会被报，但
  `writeFileSync(path.join(REPO_ROOT, "packages","quay","dist","x.js"), …)` 这种**拼接出来的共享路径**
  不被报（无当前实例；要报需要 join 起点溯源，超出静态扫描的当前范围）。
- **棘轮引导期**：数据文件尚未提交到 git HEAD 前（bootstrap），`C2a`（相对 HEAD 变长）与 `C0b`
  （封顶被抬高）不可执行；提交后自动生效。**同一 commit 里同时加长名单并抬高 `# baseline-count`**
  可绕过——这与 test-framework-policy 棘轮已接受的一类代码评审级后门相同（CLAUDE.md 已记录）。
- **R6 仍以 per-file 粒度报告**：报出粒度是一个文件一条（首处未被覆盖的 `mkdtemp` 结果），不逐行报。
  静态判定对「**内联** `mkdtemp`（无赋值变量）且非 `return` 直接值」是盲的（宽松跳过）——这类目录
  无法从文件内关联到清理路径；若有真实泄漏者落在这一形态，需要按 AC2 手动修（加 `after` 钩子），
  不指望扫描器。变量赋值的 `mkdtemp` 结果则已被 `gap-tmp-leak-is-live-r6-absolves-a-file-for-one-cleanup-call`
  收紧后的部分清理判据覆盖（直接/载体数组/helper 返回三种覆盖路径）。

