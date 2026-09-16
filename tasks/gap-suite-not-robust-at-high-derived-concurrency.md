---
id: gap-suite-not-robust-at-high-derived-concurrency
title: 套件在 nproc 推导的高并发（128路，tokyo-alpha）下不稳定——已临时封顶到16，根因未修
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
**type:** execution

## Finding

`scripts/test.sh` 的默认并发是 `max(1, floor(nproc × oversub / S))`——按执行机器的核数动态推导（`gap-no-resource-awareness-heavy-ops-run-blind` AC5）。这个设计假设"更多核 ⇒ 更高并发是安全的"，但在 `gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red` 排查环境缺口时，第一次真的在一台 128 核机器（tokyo-alpha self-hosted runner）上以推导出的高并发（128路）跑了全量套件，实测**推翻了这个假设**：

**实测（同一 commit，同一台机器，连跑三次，128路并发）**：每次失败集合都不一样，且都是负载/时序形状，不是确定性的产品缺陷：
- `serve-board` 相关测试：`EADDRINUSE 0.0.0.0:44203`（端口分配在高并发下发生冲突）
- `fan-in-execute-paths` ⑧⑩：15s 有界等待被打破（时序假设在高负载下不成立）
- `dead-code-after-return-check` AC6：live-tree 严格零扫描的判据在高并发抖动下不稳

这三类失败在同一 commit 三次运行里**互不相同**，符合"负载相关 flake"而非"确定性缺陷"的形状（同类模式已见于本仓库其它已知 flake：`tmux-leak-scan-r2`、`git-graph-oracle` 等——见 `[[flaky-test-cluster-test-separates-data-dependence-from-load-sensitivity]]` 一类既有记录，但这三个具体测试之前没被专门记录过，因为从未有机器真的跑出 128 路并发）。

**当前处置（`gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red` 里做的，是工作区绕过不是根因修复）**：在 `.github/workflows/ci.yml` 的 `Run tests` 步骤里把并发**显式封顶到 16**（这个套件日常被开发/验证所用的那台 16 核机器的既有惯例值），绕开了不稳定区间，但没有修复这三类测试本身对高并发的不健壮性。

## 根因与实现（2026-09-16 实现轮，逐类取证）

三类都不是"阈值太紧"，而是**测试自身的机制错**；封顶只是把错遮住。每类的实测证据、根因、修法如下（实现落在本任务 worktree，分支 `task/gap-suite-not-robust-at-high-derived-concurrency`）：

**① 端口分配（`serve-board` + 11 个同族文件）—— 探针-关闭-再绑定是共享资源上的两步 TOCTOU**
- 取证（CI run 35121096175，tokyo-alpha，128 路，pre-fix 码）：`test at packages/quay/test/serve-board.test.mjs:261` ⇒
  `Error: listen EADDRINUSE: address already in use 0.0.0.0:44203`，抛点 = `Server.setupListenHandle`（即 `startServer` 的 listen）。
- 根因：`freePort()` 在 **127.0.0.1** 上 bind(0) 取一个临时端口 → **close** → 返回数字；调用方**稍后**再绑同一端口。
  探针与真绑定之间该端口对全机无主，128 路并发下有多个测试文件正在做同一动作 ⇒ 同一临时端口被发给两个进程。
  且探针查的是回环，而 `startServer` 绑 `0.0.0.0`（接口面不匹配——本仓库既有记录 `cli-test-serve-eaddrinuse-tailscaled-port-collision` 已记这一半）。
- 修法（**不是重试、不是换端口段**）：不再猜端口——绑 `port: 0` 一次，从活着的 handle 读内核实绑的端口
  （`startServer` 在 `'listening'` 之后才 resolve，见 `serve.ts#listenWeb`；`serve.ts` 自己就把 `--port 0` 记为"测试用临时端口的约定"）。窗口结构上归零。
- 硬规则 5b 扫描：把**探针端口喂给同进程 `startServer`** 的全部文件同批修（`serve-handlers` / `live-state` /
  `serve-ac95-views` / `serve-tests-empty-state` / `serve-live-implcomplete` / `gap-webui-tests-page-*` /
  `gap-dashboard-*`）；残留 = 把端口交给**独立进程**的两个文件（`packages/quay/test/build-dist.test.mjs`、
  `plugin/test/start-drivers.test.mjs`），`port: 0` 在进程内读不回来，**显式记为残留**而非默默留白。

**② 等待边界（`fan-in-execute-paths` ⑧⑩）—— 等待的是一个无上界的量，却用墙钟字面量裁决**
- 取证（CI run 35115599539，128 路，pre-fix 码）：`AssertionError: the waiting suite must acquire the freed slot and write its exit marker`，
  该测试 **18.2s** 用时（本机空闲 16 核约 2s）⇒ 15s 字面量在负载机上把**健康的 suite** 判成"锁坏了"。
  （上一任务把它 15s→60s；**换个数字是错的形状**——这正是本 AC 明令禁止的那一种。）
- 根因：等待对象是"detached suite 在**任意负载**的宿主上跑完"，不存在一个字面量能诚实声称的上界。
- 修法：**事件驱动**——`fs.watch` 盯 marker 所在目录（完成事件），detached suite 自己的 pid 作失败探测器
  （"进程没了且 marker 不在"= 真失败，报 `dead`，不是超时）；**时钟不再参与成败裁决**，只留一个
  显式可配置的 hang-guard（`FANIN_TEST_MARKER_GUARD_MS`，默认 120s ≈ 空闲代价 60× / 实测最坏负载 6.6×）。
  pidfile 读数加了**新鲜度闸**（只信本次 launch 之后写入的）——本机实测一个不可删的 root 残留 pidfile 会让
  `rm -f` 失败并留下死 pid，不设闸就会把健康运行判死。
  取假对照：新增 `⑧⑩ wait AC1` 测试证明它**能**返回非 `marker`（死 pid ⇒ 立刻 `dead` 且不烧预算；等待中出现的
  marker ⇒ `marker`；活着且无 marker ⇒ `guard`）。

**③ 判据竞态（`dead-code-after-return-check` AC6）—— walk→read 两步之间，活树会动，而读侧不容错**
- 取证（CI run 35121096175）：`plugin/test/dead-code-after-return-check.test.mjs:90` 断言 `assert.equal(res.status, 0)` 得 `1 !== 0`。
  **注意是 CLI 子进程的退出码 1，不是"violations 计数 1"**——同一次运行里微秒之前、同进程内的 `scanTree` 是干净的（line 87 带消息的断言通过）。
- 根因（两条，都已实测）：**(a)** 走树是两步——`collectShellScripts` 先遍历，`scanTree` 再逐个 `readFileSync`；
  读侧**没有任何容错**（walk 侧对不可读目录是吞掉跳过的），文件在两步之间消失 ⇒ 未捕获 ENOENT ⇒ 进程退出 **1**，
  而 1 正是该 checker 自己的"至少发现一处违规"码 ⇒ **竞态与真违规同形**（硬规则 3b）。
  **(b)** 树真的会动，且动的是**被扫的那棵树自己**：npm-pack / delivery-smoke 路径把 `plugin/` 的**镜像**
  stage 进**源树**再 `rm -rf`（`packages/quay/test/delivery-standalone-smoke.sh`：`STAGED_PLUGIN="$ROOT/packages/quay/plugin"`，
  `rm -rf` → `cp -R plugin/.` → `npm pack` → `rm -rf`；`packages/quay/scripts/package.sh` 同）。
  `packages/quay/plugin` **不在** `SKIP_DIRS` 里，走树会跟进去。
  **实测**：一个以同规则遍历同一表面的探测器在 24 路并发下跑了若干轮，`READ-FAIL ENOENT` 共 **188 次，其中 186 次在
  `packages/quay/plugin/` 下**（其余 2 次在该目录内自身），**别处 0 次**；`VIOLATION` 0 次（即抖动只产生"消失"，不产生假违规）。
- 修法：消失的文件**跳过并在判决里报告**（沿用本仓库既有约定 `plugin/test/loop-shipping.test.mjs`："ENOENT during scan = race, not a crash"），
  使"0 violations"始终可与"只读到部分输入"区分（硬规则 3b）；**非 ENOENT** 的读错误仍然抛出（真读不到不得被静默当干净）。
  取假对照：新增确定性测试——用 **FIFO 做会合点**（`aa.sh` 是 FIFO，checker 读它必阻塞；写端的非阻塞 open 只在 checker
  已阻塞时才成功 ⇒ 走树**可证**已完成，此时删掉排在后面的 `zz.sh`），全程无 sleep、无 flake；把 checker 换回 pre-fix 版本 ⇒ 该测试红（已实测 2 红），换回修复版 ⇒ 绿。

**④ `ci.yml` 封顶移除**：`--test-concurrency=16` 是一个"恰好等于某台机器容量"的字面量（硬规则 4 推论二），
它把上面三个**真缺陷**遮住而不是修掉。已删回 `bash scripts/test.sh`（宿主推导）。

## Requested action

给上面三类测试各自的时序/资源假设做出健壮化处理（不是简单再调阈值），使套件在真正的高并发（128路量级）下也能稳定：
1. `serve-board`：端口分配改用动态探测而非固定端口猜测，或加重试。
2. `fan-in-execute-paths` ⑧⑩：15s 有界等待的边界在高负载下需要要么变成显式可配置、要么改用事件驱动而非墙钟等待。
3. `dead-code-after-return-check` AC6：查清"live-tree 零扫描"判据为什么会被高并发抖动影响（可能是并发写入同一路径 / 判据本身有竞态）。

⛔ 不要仅仅"调大超时数字"敷衍——按硬规则 4 的推论，成本结构未知前不要设数值阈值；先搞清楚每类失败的真实机制。

## Acceptance Criteria
- [ ] AC1: 三类失败各自的根因机制查清（端口分配策略 / 等待边界来源 / 判据竞态来源），不是"调大数字让它过"。
- [ ] AC2: 三类测试修复后，在 tokyo-alpha（128 核，真实环境）上，同一 commit 用推导并发（不封顶，即 `default_test_concurrency()` 的原生值）连跑 ≥5 次，`cancelled`/`failed` 恒为 0（取假：修复前同样跑 5 次必须复现至少 1 次失败，作为对照）。
- [ ] AC3: `.github/workflows/ci.yml` 里 `gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red` 加的并发封顶（16）移除，恢复使用 `default_test_concurrency()` 的宿主推导值（呼应硬规则 4 推论二：不要用一个恰好等于某台机器容量的字面量代替"读宿主"）。

## Definition of Done
- [ ] 并发封顶字面量从 `ci.yml` 移除，套件改回宿主推导并发，且在 tokyo-alpha 上稳定跑绿（AC2 的 5 连跑记录落证据）。

## Touches
- packages/quay/test/serve-board.test.mjs（端口分配部分——AC 里的 `plugin/test/serve-board*.test.mjs` 是错路径，真实路径在此）
- packages/quay/test/serve-handlers.test.mjs（同族 5b）
- packages/quay/test/live-state.test.mjs（同族 5b）
- packages/quay/test/serve-ac95-views.test.mjs（同族 5b）
- packages/quay/test/serve-tests-empty-state.test.mjs（同族 5b）
- packages/quay/test/serve-live-implcomplete.test.mjs（同族 5b）
- packages/quay/test/gap-webui-tests-page-timeline-gantt-truncated.test.mjs（同族 5b）
- packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs（同族 5b）
- packages/quay/test/gap-webui-tests-page-missing-rounds-timeline-bar.test.mjs（同族 5b）
- packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs（同族 5b）
- packages/quay/test/gap-dashboard-visual-review-batch-fixes.test.mjs（同族 5b）
- packages/quay/test/gap-dashboard-testscard-livecard-auto-refresh.test.mjs（同族 5b）
- packages/quay/test/gap-dashboard-fanin-card-not-in-auto-refresh.test.mjs（同族 5b）
- plugin/test/fan-in-execute-paths.test.mjs（⑧⑩ 等待边界部分）
- plugin/scripts/dead-code-after-return-check.ts（AC6 判据部分）
- plugin/test/dead-code-after-return-check.test.mjs（AC6 的两侧对照：FIFO 会合的确定性竞态测试）
- .github/workflows/ci.yml（移除并发封顶字面量）
- tasks/gap-suite-not-robust-at-high-derived-concurrency.md（自身）
