---
id: gap-serve-sessions-body-i18n-red-only-under-full-ci-concurrency
title: serve-sessions-body-i18n.test.mjs 只在 CI 全量并发下红、单跑 12/12 绿——先取证再归因
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

`packages/quay/test/serve-sessions-body-i18n.test.mjs` 只在 CI 全量并发下红、单跑绿：

- **CI 侧（上一轮观察，⚠️ 本轮未能复核）**：develop CI 的 `test` job 中，该文件跑到第 7 个用例中止（约 460ms，位置在起 live server 处）。本轮试图取原始日志复核：`gh api --allow-escape-sequences /repos/yaleh/quay/actions/jobs/107535642743/logs` 返回 `404 BlobNotFound` ⇒ 该日志已不可得。**所以「第 7 个用例 / 起 server 处」目前只是假说，不是结论**（硬规则 4 推论四）。
- **本地单跑（本轮实测）**：`node --test --test-reporter=tap --experimental-strip-types packages/quay/test/serve-sessions-body-i18n.test.mjs` ⇒ `tests 12 / pass 12 / fail 0`，2.0s。
- **载体侧**：`.quay/ci-runs.jsonl` 里 develop 最近 6 条 CI 记录全部是 `attribution=real-defect`（`defect:tests-ran-and-failed`），但载体没有按文件的失败读数，无法从载体确认红的就是这个文件。

与本仓库已知形态的相似性（**只作为待检验的假说**）：起 live server 的 fixture 在高并发下端口/启动超时饿死（`fixture-spawnsync-timeout-starves-under-loaded-suite`）、或泄漏 serve 形子进程改变拒绝模式（`leaked-serve-shaped-fixture-child-flips-the-refusal-mode`）。

## AC

- [x] 取证：一次 develop CI（或本地 `scripts/test.sh` 全量）运行的**原始日志**被保存进本任务 Evidence，逐字含该文件失败用例名 + 首条决定性错误行；取不到 ⇒ 本任务停在取证，不进入修复
- [x] 复现：本地用 `scripts/test.sh` 全量（同 CI 泳道与并发推导）至少复现一次该文件的失败，并记录复现率 k/N（N ≥ 5）
- [x] 归因对照：给出成因 Y，并附一个「若 Y 为假则结果不同」的对照（例：给 fixture 的启动超时加余量后复现率降为 0/N；或去掉并发后 0/N 而恢复后 ≥1/N）
- [x] 修复后：同一全量命令 N ≥ 5 次中该文件 0 失败；单跑仍 12/12

## DoD

落地后 develop 上至少一次 decisive CI run 的 `test` job 里，该文件的 `__PERFILE__` 行 `passed=true`（从该 run 的 job 日志逐字取，日志须在 blob 过期前落进 Evidence）。若 `test` job 仍红，但红来自别的文件，如实列出，不把「本文件已绿」写成「CI 已绿」（CI 首绿另受 hosted-runner job 迁移影响，见 AC-319）。

## Touches

- tasks/gap-serve-sessions-body-i18n-red-only-under-full-ci-concurrency.md
- packages/quay/test/serve-sessions-body-i18n.test.mjs

## Evidence

### AC1 — CI 原始日志（逐字；本轮取到，未过期）

来源：`gh run view 35974457177 --log`（develop CI，job `test`，2026-09-24T08:18Z），全文存 `/tmp/ci-run-35974457177.log`。同一次红在 `35974537318` 原样复现（`duration_ms=499`，同一签名）。

```
✖ /_work/quay/quay/packages/quay/test/serve-sessions-body-i18n.test.mjs (468.60173ms)
ℹ tests 7
ℹ suites 0
ℹ pass 6
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 469.276254

✖ failing tests:

test at packages/quay/test/serve-sessions-body-i18n.test.mjs:1:1
✖ /_work/quay/quay/packages/quay/test/serve-sessions-body-i18n.test.mjs (468.60173ms)
  'test failed'
__PERFILE__ duration_ms=470 /_work/quay/quay/packages/quay/test/serve-sessions-body-i18n.test.mjs passed=false end_ms=1790237972737
```

**失败用例名 = 文件级（`test at packages/quay/test/serve-sessions-body-i18n.test.mjs:1:1`，⛔ 不是某个具名用例）；首条决定性错误行 = `'test failed'`。**

⚠️ **这不是断言失败。** `'test failed'` + `stack: undefined` 是 node 测试运行器在【子进程以非零码退出、或被信号杀死】时合成的 `ERR_TEST_FAILURE('test failed', kTestCodeFailure)`（`internal/test_runner/runner`）。同一个 CI run 里另外 4 个红文件（arch-coverage-report / cross-machine-verify-characterization / release-branch-janitor / worker-driver-retry-classification）全都是 `test at <file>:<行号>:1` 的**真实断言失败**且各自有独立成因（例：`no manifest at /_work/quay/quay/.archguard/query/manifest.json`）；**只有本文件是这个「进程死了」的签名**。

⇒ 上一轮 Finding 里「第 7 个用例 / 起 server 处」的假说**被证伪了一半**：确有 6 个用例通过、第 7 个用例在飞时进程消失（`tests 7 / pass 6`），但中止点不是「起 server」（server 早已起来，前 6 个 AC4 用例是纯字典断言），而是**第 7 个用例第一次触到 live server + `readSessions`**。

### AC2 — 本地全量复现（`bash scripts/test.sh`，泳道/并发推导同 CI：`concurrency=128 files=813`）

| 条件 | k/N | 每轮 `__PERFILE__` |
|---|---|---|
| 本机环境 `PATH`（`claude` 在） | **0/5** | 全 `passed=true` |
| **CI 等价 `PATH`（`claude` 不在）** | **5/5** | 705 / 775 / 825 / 1007 / 1015 ms，全 `passed=false` |

CI 等价 `PATH` = `PATH=/data/scratch/yale/ac319/nodeonly/bin:/usr/bin:/bin`（node 在、`claude` 不在）。**依据不是推测**：`docker exec gh-runner-quay sh -c 'which claude'` ⇒ `NO claude` —— CI runner 是同一台宿主机上的 Docker 容器（`runs-on: [self-hosted, tokyo-alpha]`，`docker inspect` 显示无 Memory/CPU/Pids 限制），容器里**根本没装 `claude`**。

本地复现出的失败块与 CI **逐字同形**：

```
✖ .../packages/quay/test/serve-sessions-body-i18n.test.mjs (1004.629777ms)
test at packages/quay/test/serve-sessions-body-i18n.test.mjs:1:1
✖ .../packages/quay/test/serve-sessions-body-i18n.test.mjs (1004.629777ms)
  'test failed'
```

### AC3 — 成因 Y 与对照

**成因 Y = `runScriptBounded` 的【子进程 spawn 失败（ENOENT）】路径会 abort 整个进程。**

取证链（每一步都可复算）：

1. **信号是自戕的 SIGABRT**：`node --test --test-reporter=tap` 给出 `signal: 'SIGABRT'`、`exitCode: ~`。`strace -f` 捕到
   `openat(<outPath>, O_RDONLY) = -1 ENOENT` → `unlink(<outPath>) = -1 ENOENT` → `rt_sigprocmask(SIG_UNBLOCK,[ABRT])` → `tgkill(self,self,SIGABRT)`，
   且**之前没有任何 `write(2,...)`** ⇒ 无消息的 `abort()`（非 V8 fatal OOM，`--report-on-fatalerror` 也不落盘）。
2. **触发它的代码路径**：`handleSessions` → `readSessions(root)` → `runScriptBounded(["claude","agents","--json"], {cwd: root, timeoutMs: 20_000})`。
   `spawn` 带 `detached: true`，失败时 `error` 处理器已 `close+unlink` 过 outPath，随后 `close` 处理器又对同一路径 `readFileSync`+`unlinkSync`（strace 里那两个 ENOENT 就是它）。
   `claude` 不在 PATH ⇒ 只有这条路会被走到。
3. **对照（若 Y 为假则结果不同）**——单文件、同一命令、只改 `PATH`：

   | `PATH` 里 `claude` 是 | 失败率 |
   |---|---|
   | 真 CLI（dev 机） | **0/20** |
   | 不存在（CI） | **14/20** |
   | fixture 自带的 stub（打印 `[]`） | **0/20** |
   | 存在但 `exit 1`（走到「读失败」但**不**走 spawn 失败路径） | **0/20** |

   第四行是关键判别：它让 `readSessions` 同样返回**失败 reason**（页面走同一条失败分支渲染），
   但 spawn 本身成功 ⇒ **0/20**。⇒ 触发量是 **spawn 失败这一步**，不是「页面渲染失败分支」，也不是并发。

**⇒ 标题里的「只在 CI 全量并发下红」是错的前提：并发从来不是变量。** 该文件在**并发 1 的单跑**下以 14/20 复现（此时唯一的差异是 PATH），在**并发 128 的全量**下只要 `claude` 在 PATH 就 0/5 不红。

### AC4 — 修复后的读数

修复 = 让 fixture **自己拥有 `claude`**：`before()` 在 fixture 的临时 workspace 里写一个打印 `[]` 的 stub 并把它的目录前置到 `process.env.PATH`（`after()` 还原）。于是 `readSessions` 的答案**是测试自己的**、两台机器逐字相同（`status:"ok"`、`reason:null`、零会话）——这正是 dev 机**本来就已经落在**的状态（真 CLI 的机器级 registry 被 `readSessions` 按 cwd 收窄到本临时 root 后为空），所以绿基线是被**保持**而不是被削弱；同时消掉一处真实的隔离违约（原 fixture 读的是宿主机**活的**会话 registry + 依赖一个不归它管的可执行文件）。

| 读数 | 修复前 | 修复后 |
|---|---|---|
| 全量 `scripts/test.sh`，CI 等价 `PATH`（`claude` 不在） | **5/5 `passed=false`** | **0/5 `passed=false`**（3949 / 8326 / 11001 / 4979 / 3135 ms，全 `passed=true`） |
| 全量 `scripts/test.sh`，本机 `PATH` | 0/5 | 0/5 |
| 单跑（合规 `PATH` 有 `claude`） | 12/12 | **12/12** |
| 单跑 ×20，CI 等价 `PATH` | 14/20 红 | **0/20 红** |

修复提交：`9020bf46e`（task 分支）。

### ⛔ 本任务未修、需另立任务的产物缺陷

产品侧那个 `abort()` **没有修**（在 `packages/quay/src/observation.ts` 的 `runScriptBounded`，不在本任务 Touches 内）：
`quay serve` 在 `claude agents --json` **无法 spawn（ENOENT）**时会整体 abort（SIGABRT）——任何没装 `claude` 的部署打开 `/sessions` 都会崩。
最小复现：`env PATH=<无 claude> node --test packages/quay/test/serve-sessions-body-i18n.test.mjs`（本仓根目录即可，14/20）。
本任务只**移除该文件对这条路径的暴露**；缺陷本身留档待办，不在此静默带过。
