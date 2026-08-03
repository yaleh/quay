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

**扫描信号**（`mkdtemp-no-cleanup`，per-file 粒度）：文件里出现 CODE 位置的 `mkdtemp`/`mkdtempSync` 调用，
且文件里**没有**任何 CODE 位置的清理构造（`rmSync(`、`rm(`、`t.after(`、`after(`、`finally {`）。
**永不匹配** `/tmp/claude-*`（会话数据）与 `/tmp/quay-wt-*`（在用 worktree）前缀（AC6）——这两个前缀的
`mkdtemp` 不是测试 fixture，跳过。
## 扫描与棘轮（AC2–AC6）

`plugin/scripts/test-isolation-check.ts` 对 `scripts/test.sh --list-files` 的每个文件做六条判定，
**按代码位置匹配**（剥离注释与字符串/正则字面量 —— 复用 `test-framework-policy-check.ts` 的
`buildNonCodeMask`）。「匹配到提到它的注释而非它本身」正是 relation-sync 数 `process.exit(1)` 数到
4 处全是解释性注释的教训。

- **报出而不阻断（AC6）**：已知违规被打印，但不让套件变红。
- **棘轮（AC5）**：`plugin/test-isolation-violations.txt` 是**只能变短**的名单 ——
  - 当前违规**没有**名单条目（新引入的违规）→ 失败；
  - 名单条目相对 git HEAD **变长** → 失败；
  - 名单条目**失效**（违规已修但条目未删）→ 失败（删掉它）；
  - 条目数超过 `# baseline-count` 头（提交后仍存活的封顶）→ 失败。

## 当前基线（2026-08-03，51 条）

`--list` 实测（与 `plugin/loop/fast-mode-loop-tick.md` 判绿无关；本清单是报告，不是门禁）：

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
packages/quay/test/driver.test.mjs:mkdtemp-no-cleanup
packages/quay/test/frontmatter-store-base.test.mjs:mkdtemp-no-cleanup
packages/quay/test/gap-cli-gate-enforcement.test.mjs:mkdtemp-no-cleanup
packages/quay/test/gap002-create-ergonomics.iteration-0.test.mjs:mkdtemp-no-cleanup
packages/quay/test/gap002-create-ergonomics.iteration-0.test.mjs:process-exit-1
packages/quay/test/gap002-create-ergonomics.test.mjs:mkdtemp-no-cleanup
packages/quay/test/gate-config-loader.test.mjs:mkdtemp-no-cleanup
packages/quay/test/gate-list-verbose.test.mjs:mkdtemp-no-cleanup
packages/quay/test/gate.test.mjs:mkdtemp-no-cleanup
packages/quay/test/init.test.mjs:mkdtemp-no-cleanup
packages/quay/test/it0-gates.test.mjs:mkdtemp-no-cleanup
packages/quay/test/lifecycle.test.mjs:mkdtemp-no-cleanup
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
- **R2 直接写共享产物只认首参字面量**：`writeFileSync("packages/quay/dist/x.js", …)` 会被报，但
  `writeFileSync(path.join(REPO_ROOT, "packages","quay","dist","x.js"), …)` 这种**拼接出来的共享路径**
  不被报（无当前实例；要报需要 join 起点溯源，超出静态扫描的当前范围）。
- **棘轮引导期**：数据文件尚未提交到 git HEAD 前（bootstrap），`C2a`（相对 HEAD 变长）与 `C0b`
  （封顶被抬高）不可执行；提交后自动生效。**同一 commit 里同时加长名单并抬高 `# baseline-count`**
  可绕过——这与 test-framework-policy 棘轮已接受的一类代码评审级后门相同（CLAUDE.md 已记录）。
- **R6 是 per-file 粒度**：判据是「文件有 `mkdtemp` 且**整文件**没有任何 `rm`/`rmSync`/`after`/`finally`」。
  一个**只给部分** mkdtemp 加了清理的文件会被放行——`prepare-admission-check.test.mjs` 是 #1 泄漏者
  （14,220 个 `prepare-admission-*`），但因为它**其他**测试用了 `after`，R6 静态扫不到它；它的修复
  靠的是 AC2（手动加 `after` 钩子），不是扫描器。这是 per-file 静态判定的固有盲区，接受。

