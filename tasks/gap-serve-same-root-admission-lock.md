---
id: gap-serve-same-root-admission-lock
title: quay serve 启动准入锁（同-root pidfile）+ 默认临时端口 + start-drivers 探测收编进 startServer
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**触发**：分析 4173 端口被外部进程（meta-cc）占用一事，追出两个耦合缺陷：

1. `packages/quay/src/serve.ts` 的 `startServer()` 对"同 workspace root 是否已有活体"**没有任何准入检查**——每次启动无条件覆盖 `.quay/server.json`。第二个 `quay serve`（同 root）今天靠 EADDRINUSE 偶然失败；一旦默认端口改成内核分配的临时端口（下面第 2 点），这个偶然护栏会消失，第二个实例会在不同的临时端口上静默成功，顶掉 carrier，把第一个实例变成孤儿——而 `plugin/scripts/worktree-process-reaper.ts` 的 `--orphan-serves` 回收模式已经把"carrier 被顶掉后活体与泄漏者不可区分"这个后果写在注释里（2026-09-17 全局 OOM 的成因）。
2. 默认端口硬编码 4173（`serve.ts:357`、`cli/server.ts:485`、`start-drivers.ts:78` 三处 + README/SKILL 文档），且 `start-drivers.ts:666` 用 `GET /` HTTP 探测（`probeUrl`）判断"已在监听"，**不带任何身份校验**——外部进程占用同一端口时，探测返回 true，`planActions` 直接判定"已运行"、跳过启动，把外部进程误报成自己的 server（本次事故的真实形态）。

**人的决策（本任务的约束，全部来自事前讨论，按顺序）**：

- 默认端口从硬编码 4173 改为**可选参数，未显式指定时默认 0**（内核在 0.0.0.0 自动分配临时端口）。**显式 `--port N` 语义不变**——精确绑定，真冲突时响亮失败，不静默换端口。
- **同-root 准入锁必须完全封装在 `startServer()`（`quay serve` 自身，资源所有者）内部**，不放在 `start-drivers.ts`，也不用 HTTP 探测实现。`start-drivers.ts:666` 现有的前置 `probeUrl` 判断整条删除，不在别处另开一种探测形式（避免耦合）。
- **锁的原语不是真 OS flock**（Node 没有 flock 系统调用绑定；本仓库现有的 flock 先例 `suite-slot-lib.sh`/`full-suite-runner.ts` 是"spawn 一个子进程持锁"的形状，不适配"进程为自身生命周期持锁"，且正是"子进程若 fork 出孙进程继承 fd，kill 持锁者不释放锁"这个坑的形状）。改用**独立的 pidfile `.quay/server.lock`**（与展示用途的 `.quay/server.json` 分开——两者职责不同：一个互斥、一个供外部读者观察，符合 `server-state.ts` 自己"单一 owner 定义 shape"的设计哲学），用 `fs.openSync(path, O_CREAT|O_EXCL|O_WRONLY)` 保证创建这一步的原子性。EEXIST 时读出既有 pid：`pidAlive()` 为真 **且** `/proc/<pid>/cmdline` 确认是真的 quay serve 进程（复用 `worktree-process-reaper.ts` 已导出的 `readProcCmdline`，防 pid 复用误判）⇒ 拒绝启动，exit 0（幂等"已在运行"，对齐 driver kernel 自身"already-running"的幂等惯例，不当错误）；pid 已死或 cmdline 对不上 ⇒ 判陈旧 ⇒ unlink 后重试一次 O_EXCL（有限重试，不无限循环）。
- **锁获取必须是 `startServer()` 的第一条语句，早于 `connectProvider`**——避免一次被拒绝的启动仍然 spawn provider 子进程再收尾清理（早于现有 `closeSetupFailure` 覆盖的"绑定失败不能漏子进程"纪律一步）。
- `start-drivers.ts` 的 `ServeStartResult` 联合类型新增判定态 `"already-running"`（区别于 `started`/`exited`/`timeout`/`spawn-failed`），使"因已运行而拒绝"永远不与"崩溃"同形。
- `start-drivers.ts` 的 `stopServeHost()`（reload/staleness-replace 路径用）把等待条件从 HTTP 端口探测（`probeUrl`）**换成 pid 死亡轮询**（`pidAlive`）——更直接的信号，且与新锁自身的陈旧回收逻辑天然兼容：新实例起来时即便老实例的清理还没完全跑完，新实例自己的"陈旧锁回收"分支（pid 已死 ⇒ unlink 重试）会自然接管，不需要额外的新老交接同步。
- **staleness 判断本身不变**（`/health` 比对 git 提交时间 vs 进程启动时间，仍由 `start-drivers.ts` 作为编排策略持有）——pidfile 回答不了"代码是否过期"这类内容问题，只回答"同 root 是否已有活体"。
- **明确排除在本任务范围外**：`/health` + carrier 加身份标记（`instanceId`）以解决"外部观察者（`quay server status`、staleness 探测）在显式钉死端口上遇到外来进程"这个不同消费者的问题——留作后续候选，不在本任务 Touches 内（避免范围蔓延）。

## Plan

1. `packages/quay/src/serve.ts`：`startServer()` 首行加同-root 准入锁获取（`.quay/server.lock`，O_EXCL 创建 + EEXIST→pidAlive+cmdline 复核→陈旧则 unlink 重试一次算法），置于 `connectProvider` 之前；拒绝分支打印既有 pid，不绑定任何端口、不 spawn 任何子进程，exit 0。
2. `packages/quay/src/serve.ts`：`startServer` 默认 `port` 由 `4173` 改为 `0`；改写 `listenWeb`/契约注释块（现断言"显式端口精确遵守，port:0 只是内部/测试约定"）为"未显式指定时默认 0"的新语义，显式端口精确遵守的部分保持不变。
3. `packages/quay/src/cli/server.ts`（`spawnHost`）：硬编码 `port ?? "4173"` 改为不设默认 / `"0"`。
4. `plugin/scripts/start-drivers.ts`：
   - `DEFAULT_SERVE_PORT`：4173 → 0（或去掉它作为强制默认的角色，对齐新的可选端口语义）；
   - 删除前置 `probeUrl(opts.host, opts.port)` 调用（~666 行）及其在 `planActions` 的 `startServe` 布尔判定里的角色；
   - `startServe()` 的 spawn+轮询循环需要识别子进程因锁拒绝退出的信号（特定 exit code / stdout 标记），映射为新增的 `"already-running"` 态，不归入 `"exited"`；
   - `stopServeHost()`：探测循环由 `probeUrl` 换成 `pidAlive` 轮询（相同超时/退避形状）；
   - 相应调整 `report.serve` 形状 / CLI 输出文案（原来挂在被删前置探测上的"already listening"分支需要改为从子进程自身结果推导）。
5. 文档：`README.md:171,676`、`plugin/skills/drivers/SKILL.md:27,59,64` 改写"默认端口 4173"为"未指定 --port 时内核分配临时端口"。
6. 测试：更新 `packages/quay/test/cli.test.mjs`、`serve.test.mjs`、`plugin/test/start-drivers.test.mjs` 中依赖硬编码默认 4173 的用例改为动态读回端口；新增：(a) 同 root 第二次 `startServer()` 被拒绝（锁持有中，不绑端口、不 spawn provider 子进程）；(b) 陈旧锁（死 pid）被回收，新实例正常起来；(c) pid 复用场景（pid 活着但 cmdline 对不上 quay serve）按陈旧处理而非活体冲突；(d) 显式 `--port N` 精确绑定、真冲突仍响亮失败（回归不变）；(e) `stopServeHost` 的 reload 路径等 pid 死亡而非端口探测。
7. 提交（不合并）。全量验证留给外层 fan-in。

## AC

- [x] AC1: 同-root 第二次 `startServer()` 调用被拒绝（锁被一个活体、cmdline 确认为 quay-serve 的 pid 持有）——被拒绝的启动不绑定任何端口、不 spawn provider 子进程（用第二个监听 socket 不存在 / 第二个 provider 子进程 pid 不存在来验证）。
- [x] AC2: 陈旧锁（pid 已死，或 pid 活着但 cmdline 对不上 quay-serve 进程）被检测并回收——新实例正常启动，有限单次重试，不死循环。
- [x] AC3: 默认 `quay serve`（不带 `--port`）绑定内核分配的临时端口；实际绑定端口被正确读回并上报（日志行 / carrier / --json）。
- [x] AC4: 显式 `--port N` 精确遵守，行为与今天完全一致——真实占用 N 时仍响亮失败（EADDRINUSE 形态的拒绝），不静默换端口。
- [x] AC5: `start-drivers.ts` 不再对同-root 准入判定做任何前置 HTTP 存活探测——代码库里"是否已运行"的唯一判定机制是 `startServer()` 内部的锁；`ServeStartResult` 把 `already-running` 与 `exited`/`timeout`/`spawn-failed` 区分开，`start-drivers.ts` 的 report/CLI 输出据此区分呈现（不折叠进失败）。
- [x] AC6: `stopServeHost`（reload 路径）等待 pid 死亡（`pidAlive`）而非端口探测；staleness 判断本身（`/health` 的 git 提交时间 vs 进程启动时间比对）不受影响。
- [x] AC7: 既有 serve/cli/start-drivers 测试套件在新的默认端口 0 语义下全绿（除显式端口用例外，不再有硬编码 4173 假设残留）；AC1/AC2/AC3/AC6 对应的新测试隔离跑绿。

## DoD

- [x] AC1–AC7 全部勾上
- [x] 改点清单 + 隔离跑测试结果贴出（Evidence）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence

**实现提交**：`ce0f47518`（主体）+ `fbb5e22b9`（bundle 直接入口守卫修复）。

**改点清单**（全部在声明的 Touches 内）：

- `packages/quay/src/serve.ts`：`acquireServeAdmissionLock()` 成为 `startServer()` 的第一条语句（loadConfig 之后、`connectProvider`/`listen` 之前）：`.quay/server.lock` 用 `O_CREAT|O_EXCL` 创建；EEXIST ⇒ `inspectAdmissionLock()` 三分法（live / stale / unidentified）——live 或"读不懂"⇒ 拒绝，stale ⇒ unlink 后**只重试一次**；pid 复用靠复用 reaper 的 `readProcCmdline`+`isQuayServe` 判据。释放点：`shutdownHost()`（**pid 守卫**：只删写着自己 pid 的锁，清理永不误伤别人的宿主）与"启动失败"路径（catch 里释放，失败启动不留锁）。默认 `port` 4173 → 0，`listenWeb` 契约注释改写为新语义。
- `packages/quay/src/cli/serve.ts`：拒绝 ⇒ **exit 0**（幂等「已在运行」不是错误），打印一行持有人 pid + 机器可读标记 `[quay-serve-admission-refused self=<自己> holder=<持有者>]`。
- `packages/quay/src/cli/server.ts`：`spawnHost` 只在调用方显式给了端口时才传 `--port`（默认端口只活在 `startServer` 一处）。
- `plugin/scripts/start-drivers.ts`：删除前置 `probeUrl` 存活探测（连同 `probeUrl` 本身与它的单元测试）；`startServe()` 改为 **spawn 后读子进程自己的判定**（carrier 是本次 child 且活着 ⇒ `started` + 端口读回；退出且追加了自己的标记 ⇒ `already-running`，独立态，不折叠进 `exited`；标记读取按 spawn 前的 log 偏移 + `self=<child pid>` 绑定）；staleness 策略保留在原处（从 carrier 取 pid+web port，`GET /health` 判 fresh/stale/not-evaluated，STALE ⇒ SIGTERM + 等 pid 死亡 + 重启）；`stopServeHost(pid)` 改为 `pidAlive` 轮询（新增可区分取值 `still-alive`）；被删探测的唯一使用者 `planActions` 由 `planServeAction` 取代；`DEFAULT_SERVE_PORT` 4173 → 0（`--port` 校验放行 0）。
- `plugin/scripts/worktree-process-reaper.ts`：**唯一的非"只读引用"改动**——直接入口守卫从裸 `fileURLToPath(import.meta.url) === resolve(argv[1])` 换成单一真相源 `isDirectEntry(import.meta, undefined, "worktree-process-reaper")`。理由见下（scoped 门实测到的 bundle 缺陷）。
- `README.md` / `plugin/skills/drivers/SKILL.md`：`--port` 可选 + 未指定则内核分配临时端口 + 同 root 至多一个活体宿主。

**隔离跑测试结果（`--for-task scoped`，本 worktree 内）**：

```
$ bash scripts/test.sh --for-task gap-serve-same-root-admission-lock --allow-thin
EXIT=0
ℹ tests 125 · pass 125 · fail 0 · cancelled 0
```
（选中并在一个进程内跑完：`packages/quay/test/serve.test.mjs` 321 PASS / 0 FAIL、`packages/quay/test/cli.test.mjs`、`plugin/test/start-drivers.test.mjs` 17/17、`plugin/test/worktree-process-reaper.test.mjs` 全绿，外加 Touches 相关的静态检查全过：instrument-failure-check / tmp-leak-pairing-check / test-isolation-check / anti-drift 等。）

**新增/改写的测试**（AC 逐条的取证）：

- AC1（`serve.test.mjs`）：起一个**真的** `quay serve` 子进程持有锁（`/proc` cmdline 真的是 quay serve —— 锁的 pid 复用判据读的就是它），然后 ①同 root 再起一个真 CLI ⇒ exit 0 + 标记里同时出现 `self=<被拒者>` 与 `holder=<持有者>`、carrier 与锁文件**都没被动过**；②同进程内 `startServer({port:0})` ⇒ 抛 `ServeAdmissionRefusedError`（自带类型，不与启动失败同形）、`holderPid` 命中持有者、**本次进程没有新增直接子进程**（provider 没被 spawn，附"这个读数确实能看见新子进程"的对照）、carrier 仍指持有者（没绑第二个 web face）；③stderr 不含 reaper 的 usage 行。
- AC2：死 pid 锁 ⇒ 新实例正常起并接管锁、干净关闭后锁被释放；**pid 复用**（活 pid 但 cmdline 不是 quay serve）⇒ 判 stale 回收（正对照：活 pid 且 cmdline **是** quay serve ⇒ 判 held、锁不动）；无可用 pid 的锁 ⇒ `held-unidentified` 且**不删**（fail-closed，读不懂 ≠ 陈旧）；`release()` 不删别人的锁、删自己的锁。
- AC3：`startServer({})`（不带 port）⇒ `address().port > 0`、carrier 的 web port === 内核实际绑定的端口、`/health` 在它上面真的应答。
- AC4：显式 `--port N` ⇒ 精确绑定且 carrier 记 N；真的占用 N ⇒ 仍以 `EADDRINUSE` 响亮拒绝、**不**伪装成准入拒绝、且锁被释放（失败启动不挡下一次）。
- AC5：`start-drivers.test.mjs` 的假 CLI 现在是一个**微型忠实宿主**（同一套锁协议：O_EXCL + 陈旧回收 + carrier + `/health`）——run#2 的记录里出现 `["serve","refused"]`（即**它确实去 spawn 了**，没有前置探测可短路），且全程只有一个 `["serve","listening"]`；另有"拒绝但 carrier 读不到"⇒ `already-listening` + `staleness:"not-evaluated"` + `stalenessReason:"carrier-absent"` + exit 0 + 零重启。`readAdmissionRefusal` 的偏移 + `self=` 绑定单独钉住（前一轮的标记、并发进程的标记都不算数）。
- AC6：`stopServeHost` 两个方向（配合的宿主 ⇒ `stopped` 且 pid 真的没了；无视 SIGTERM 的宿主 ⇒ `still-alive`，绝不与 `stopped` 同形）；stale reload 端到端（run#1 起宿主 → 改 `/health` 为 stale → run#2 真的 SIGTERM 旧宿主、等 pid 死、起新宿主，新宿主 reclaim 了死锁；run#3 fresh ⇒ 不再重启）。
- AC7：上面 scoped 门 125/125 + serve.test.mjs 321 PASS；`grep -r 4173` 在 `packages/`+`plugin/`+`README.md` 的生产/文档面只剩测试数据与历史注释。

**实测发现并修掉的附带缺陷（bundle 直接入口守卫）**：把 `worktree-process-reaper.ts` 引进 `serve.ts` 后它被**内联进 shipped bundle**，而 bundle 里所有内联模块共享同一个 `import.meta.url` ⇒ 旧的裸守卫在 `quay serve` 里为真，reaper 自己的 CLI 块拿 serve 的 argv 跑了起来，往 stderr 打 usage 并把**退出码写成 2**，覆盖了拒绝分支约定的 exit 0（scoped 门实测：`got 2; stderr=worktree-process-reaper: one of --worktree …`）。改用仓库单一真相源 `isDirectEntry`（按 basename 判定，源码与 bundle 形态都对，且永不匹配被内联的库）后，`node packages/quay/dist/quay.js serve` 在 bundle 形态下也干净（实测：stderr 无该行、第二次启动 exit 0）。

**已知遗留（不在本任务 Touches 内，未改）**：`packages/quay/README.md:350` 与 `docs/webui-guide.md:27` 仍写着"默认端口 4173"，本次未纳入声明范围，建议另立一条 doc-only 任务收口。

## Touches

- packages/quay/src/serve.ts（同-root 准入锁 + 默认端口改 0 + 契约注释改写）
- packages/quay/src/cli/serve.ts（拒绝分支：exit 0 + 机器可读标记 —— Plan 未列，但"exit 0"这条约束只能落在 CLI 动词的 catch 里，实测确实改了，故补进声明）
- packages/quay/src/cli/server.ts（spawnHost 默认端口）
- packages/quay/src/server-state.ts（如需为锁逻辑复用/导出 pidAlive，读引用 —— 实际只 import 了既有 `pidAlive`，无改动）
- plugin/scripts/start-drivers.ts（去前置探测 + ServeStartResult 新增态 + stopServeHost 改 pid 轮询 + DEFAULT_SERVE_PORT 改 0）
- plugin/scripts/worktree-process-reaper.ts（复用其已导出的 readProcCmdline/isQuayServe；**并把它不可 bundle 的裸直接入口守卫换成 isDirectEntry** —— 引进 serve.ts 后该守卫会在 shipped bundle 里误触发，实测覆盖了 exit 0）
- README.md
- plugin/skills/drivers/SKILL.md
- packages/quay/test/serve.test.mjs
- packages/quay/test/cli.test.mjs
- plugin/test/start-drivers.test.mjs
- tasks/gap-serve-same-root-admission-lock.md（自身：勾 AC + 贴证据）