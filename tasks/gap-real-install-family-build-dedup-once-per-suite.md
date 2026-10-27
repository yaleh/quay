---
id: gap-real-install-family-build-dedup-once-per-suite
title: real-install 族构建去重：build-dist+npm pack 每测试各跑一遍 → once-per-suite 共享产物
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

全量轮实测：release-cut.test.mjs 仍 654.7s（`floor_ms=654704`，suite 最长文件），先前的 clone 去重无效——根因是每个测试的 shipped-set 构建（`publish-dist-branch.sh` → build-dist + npm pack，每个 ~35–40s）主导成本，clone 只是零头。证据：release-cut 的 "AC4 CI three-valued" 单测 169.4s = 5 次 `--dry-run` 各真构建一次。同族测试（npm-pack-e2e、shipped-set、shipped-shell-reachability、verify-deliver-coldstart、build-plugin-dist、release-cut）各自独立 build-dist + npm pack，重复构建同一产物。把构建改成 once-per-suite 共享：before() 构建一次，各测试消费同一 tarball/dist。

<!-- dedup-ref --> 相关但不同机制，不合并：gap-suite-memory-host-fraction-0-25-to-0-5（内存护栏，已 done）、gap-release-cut-test-613s-fixture-clone-dedup（clone 去重，已证明无效）。

## Plan

1. 枚举所有独立调用 `package.sh` / `build-dist` / `npm pack` 的测试文件（grep + 列清单）。
2. 新增一个共享构建 helper（`before()` 一次性 build+pack 到 fixture 目录；各测试消费产物，不再各自构建）。
3. 逐个改造上述测试文件，改用共享产物；保留各自需要独立构建的负向臂（如「构建失败」类测试）除外。
4. 验证：standalone 跑 release-cut.test.mjs 时长显著低于 654.7s，real-install 族各文件时长下降。

## Acceptance Criteria

- [x] `grep -rlE "package\.sh|build-dist|npm pack" plugin/test packages/quay/test` 列出的构建调用点清单贴进本任务 evidence（非空、且覆盖 release-cut/npm-pack-e2e/shipped-set/shipped-shell-reachability/verify-deliver-coldstart/build-plugin-dist 中至少 4 个）
- [x] 共享构建 helper 落地：`before()` 构建一次，被改造的测试消费同一产物（grep 显示 `before(` 里 build 调用、测试体里改为引用共享路径）
- [x] 负向臂保留：需要「构建失败 / 产物不可用」的测试（如 AC1 precheck-unavailable）仍独立构建，不在共享之列（grep 证明）
- [x] standalone 跑 `node --no-warnings --experimental-strip-types --test plugin/test/release-cut.test.mjs`，总 duration 显著低于改造前基线 654.7s（记录前后两值进 evidence）

## Definition of Done

once-per-suite 共享构建落地，real-install 族不再每测试重复 build+pack；release-cut standalone 时长显著下降；负向臂（构建失败类）未被共享化吞掉。

## Evidence

### AC1 — 构建调用点清单（2026-10-27 实测，worktree @ 16bb6ff77）

字面谓词 `grep -rlE "package\.sh|build-dist|npm pack" plugin/test packages/quay/test` → **32 个文件**。
⚠️ 该字面谓词**看不到本任务最重的 4 个消费者**（它们经脚本间接调用，文件里根本没有这些串），所以下面按**位置**（实际 spawn 到构建机制的调用点）重新判定（硬规则 2 / 5b）：

| 文件 | 真实构建调用点 | 每次构建 | 处置 |
|---|---|---|---|
| plugin/test/release-cut.test.mjs | 经 `plugin/scripts/release-cut.mjs` preflight ⑥ → `publish-dist-branch.sh`（sync-vendor + build-plugin-dist + rewrite + stamp + prune） | 33.7 s（= AC4 三值单测 168.7 s ÷ 5 次） | **已改造**（21 次 `release-cut.sh` 调用中约 15 次走到 preflight） |
| packages/quay/test/npm-pack-e2e.test.mjs | `bash packages/quay/scripts/package.sh`（build-dist + build-plugin-dist + npm pack） | 见 AC4 表 | **已改造**：共享 tarball |
| plugin/test/shipped-set.test.mjs | `bash <stub>/plugin/scripts/publish-dist-branch.sh --no-build` | 22.67 s（scratch stub 实测） | **已改造**：共享 dev-form artifact |
| plugin/test/shipped-shell-reachability.test.mjs | 同上 | 22.67 s | **已改造**：与 shipped-set 同一 cache entry（实测 `reused`） |
| packages/quay/test/build-plugin-dist.test.mjs | **无整构建**：45 个 test 全部直接 import `build-plugin-dist.mjs` 的函数，在 per-test mini tree 上做单元级 staging；`package.sh`/`build-dist` 只出现在注释里 | 0 | 不改造（单元级，非整构建） |
| plugin/test/verify-deliver-coldstart.test.mjs | **无整构建**：从不传 `--build-root`；`--selfcheck` 已由 `_selfcheck` memo 化成 1 次/文件 | 0 | 不改造（本来就没有） |
| plugin/test/publish-dist-branch-closure-gate.test.mjs | `bash <stub>/plugin/scripts/publish-dist-branch.sh --no-build` | 22.67 s × 1 | **同类未改造**（不在本任务 Touches；同族剩余点，按硬规则 5b 明确记录） |

### AC2 — 共享构建 helper

新增 `plugin/test/helpers/real-install-shared-build.mjs`：
- `ensureSharedShippedArtifact({repoRoot, ref, form})` / `ensureSharedPackedTarball({repoRoot})`；
- **内容寻址**：key = `git rev-parse <ref>^{tree}` + form +（`--no-build` 形态下）vendor bundle 的 sha256。这是 release-cut fixture 能命中的前提——每个 fixture 都在 `develop` 上提交了自己的 ceiling，**commit sha 各不相同而 tree oid 完全相同**（实测两个 fixture：commit `57418ed54` / `228a56f63`，tree 同为 `f5d11433fa9b9a035edd1f59c661afaf67935f64`）；
- **跨文件 / 跨进程**：entry 落在 `writableTmpRoot()/quay-real-install-build-cache`，`mkdir` 原子锁 + `rename` 原子发布 ⇒ 并发两个测试进程只产出一份构建；锁等待有上限，超时回答 `evaluated:false` 而不是死等；
- **不是第二份实现**：artifact 仍由 `plugin/scripts/publish-dist-branch.sh` 产出、tarball 仍由 `packages/quay/scripts/package.sh` 产出；helper 只把「再跑一遍」换成「取同一份」；
- **⛔ 构建 worktree 必须在分支上，不能 detached**：`resolve-version --mode build` 在 detached HEAD 上返回 NOT-EVALUATED（exit 3），而 stamp/prune 是一条 `&&` 列表 ⇒ errexit 不触发 ⇒ 后半段静默跳过，产出一份**没剪枝**的 artifact（`release-cut.mjs` 头注释记的就是 306 files/16594 .sh lines vs 287/7345 那次测量）。

消费方（首次真正需要时调用并缓存路径，测试体引用共享路径）：`grep -n "ensureSharedShippedArtifact\|ensureSharedPackedTarball"` 在 4 个文件里各命中 2 行（1 处 import + 1 处调用）——release-cut.test.mjs:48/181、shipped-set.test.mjs:47/177、shipped-shell-reachability.test.mjs:36/158、npm-pack-e2e.test.mjs:44/154。
注：release-cut 的共享构建放在**惰性函数**里由第一次 `run()` 触发，而不是 `before()` 钩子——node:test 的顶层 `before()` 在本文件求值**完成之前**就执行，钩子里调用 fixture 构造函数会撞文件下方 `const AMPLE_SHIPPED_CEILING` 的 TDZ（实测整文件 `fail 18 / pass 0`，每条 <1 ms）。

`release-cut.mjs` 侧新增 `readInjectedShippedSetArtifact()`：只有当 provenance 的 `form === "release"`、`publisher === "plugin/scripts/publish-dist-branch.sh"`、且 **`<baseRef>^{tree}` 与 provenance.tree 逐字相等**时才消费注入产物；任一条不满足就**回落到真实构建**（不报错、不变红）。ceiling 仍由 **base tree 的** checker 读出，注入路径不绕过 publisher/checker 存在性检查。

### AC3 — 负向臂仍独立构建

- release-cut `AC0`（ceiling=1 文件）与 `AC1`（`breakPublisherOnDevelop`）各自在 `develop` 上提交了**不同 tree** 的改动 ⇒ tree 校验必然不匹配 ⇒ 走真构建。实测：AC0 用时 29.93 s（一次完整构建）；AC1 的 publisher 立刻失败 ⇒ `CAUSE=release-cut-shipped-set-precheck-unavailable` 与子进程原文 `PUBLISHER-BLEW-UP` 仍被带出。
- shipped-set 的红色控制（revert rsync 排除表、注入 `foo.test.mjs`、reanchor）与 shipped-shell 的三个红色控制都先把 artifact `cpRecursive` 到私有 tmp 再变异，**没有**在共享产物上写；shipped-set 的两个控制仍用 `runPublish(stub, ...)` 真跑一次发布。
- grep 证据：`grep -n "runPublish(" plugin/test/shipped-set.test.mjs` → 4 行 = 1 处函数定义 + **3 个调用点**（before 的 fallback + 2 个重跑发布的控制）。

### AC4 — release-cut standalone 时长（同一主机、同一命令、2026-10-27）

| | wall | `ℹ duration_ms` | 结果 |
|---|---|---|---|
| 改造前（develop 原样） | **589.80 s** | 589781 | 18 pass / 0 fail |
| 改造后（冷 cache） | **118.64 s** | 118622 | 18 pass / 0 fail |
| 改造后（热 cache） | **99.18 s** | 99158 | 18 pass / 0 fail |

⇒ 589.80 s → 118.64 s（**−79.9%**，5.0×）。冷跑剩下的时间里 33.0 s 是那一次共享构建本身、29.9 s 是 AC0 必须独立构建的那一次；改造前每一次 `release-cut.sh` 调用都要付这 33 s 左右。Proposal 里的 654.7 s 是另一个时间窗的读数，本表两行才是**同主机同命令的前后对照**。

同族其他文件（改造后实测）：`packages/quay/test/npm-pack-e2e.test.mjs` 57.91 s → 35.62 s（冷）/ **5.04 s**（热），11 pass；`plugin/test/shipped-set.test.mjs` 建共享 artifact 71.64 s，11 pass；`plugin/test/shipped-shell-reachability.test.mjs` **2.71 s**（复用前者的 entry），8 pass。

### ADR-007 暗轴

该轴仍暗,理由:本任务只新增测试侧共享构建 helper 与一条 env-gated 的 release-cut 注入口,不新增包间依赖边、不新增或合并包,依赖结构与 god-package 两轴无可归因的变化

## Touches

- plugin/test/release-cut.test.mjs
- packages/quay/test/npm-pack-e2e.test.mjs
- plugin/test/shipped-set.test.mjs
- plugin/test/shipped-shell-reachability.test.mjs
- plugin/test/verify-deliver-coldstart.test.mjs
- packages/quay/test/build-plugin-dist.test.mjs
- plugin/scripts/release-cut.mjs
- plugin/test/helpers/real-install-shared-build.mjs
- tasks/gap-real-install-family-build-dedup-once-per-suite.md