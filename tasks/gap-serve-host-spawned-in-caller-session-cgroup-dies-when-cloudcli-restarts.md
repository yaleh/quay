---
id: gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts
title: serve 宿主默认落在调用它的会话 scope 里，CloudCLI 重启时随旧会话 scope 被杀——宿主应像 anchor 一样用
  systemd-run --scope 起在独立 scope
status: done
labels:
  - gap
  - defect
  - priority:p1
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**目标(人 2026-10-06)**:CloudCLI 重启时,不要搞死各项目在 CloudCLI 启动的会话中起的 quay web server。不让 anchor 管 web server,而是**参考 anchor 的启动机制**启动 web server。本任务只解决"重启存活",不解决"崩溃后被拉起"(监管另案)。

**生产证据(2026-10-06,本机,已安装 quay 0.16.0,实测原始读数见 `/tmp/serve-survival-1791289658/phase1.txt` 与 `phase2.txt`)**:
1. 在 CloudCLI 启动的会话(其 Bash 所在 cgroup 为 `cloudcli.slice/cloudcli-resident.slice/claudecodeui-session-1006778-b9a01352.scope`)里,用 `quay server start --only web,control --host 127.0.0.1 --port 0 --root <wsA>` 起宿主(走 `packages/quay/src/cli/server.ts` 的 `spawnHost`)。读数:宿主 pid 2552174,父进程为 `systemd --user`(319121,说明 `detached:true` 确已脱离会话),但 `/proc/2552174/cgroup` 仍是上述**会话 scope**。
2. 对照:在同一会话里用 `systemd-run --user --scope --collect --unit=quay-serve-test-<ts> -p MemoryAccounting=yes -p OOMPolicy=continue quay serve --host 127.0.0.1 --port 0` 起宿主(workspace wsC):pid 2553564,cgroup `app.slice/quay-serve-test-1791289658.scope`。
3. 参考读数:`claudecodeui-server.service` 的 `KillMode=control-group`,cgroup `app.slice/claudecodeui-server.service`;会话 scope 是独立单元,`Slice=cloudcli-resident.slice`,`KillMode=control-group`,名字里带的 1006778 是 CloudCLI 服务进程号。
4. 重启 `claudecodeui-server.service`(journal:20:34:46 Stopping → 20:34:48 Started,MainPID 1006778→3423318)后:A 宿主 pid 2552174 **不存在**,`quay server status` 报 `not-running`,原因 "stale carrier — the server was killed without a graceful close",`server.json` 原样残留;C 宿主 pid 2553564 **存活**(运行 558 秒),cgroup 不变,`server.json` 有效。旧的两个 `claudecodeui-session-1006778-*` scope 消失,新出现三个 `claudecodeui-session-3423318-*`(本会话被恢复进新 scope)。
结论:**默认路径起的宿主在会话 scope 里,CloudCLI 重启停掉旧会话 scope 时被一并杀死;独立 scope 的宿主存活**;死后残留 stale `server.json`。(是 systemd 停单元连带停了会话 scope,还是 CloudCLI 自身关闭逻辑去停的,未区分。)

**机制(已读代码)**:
1. `packages/quay/src/cli/server.ts` 的 `spawnHost`(约 488-520 行)与 `plugin/scripts/start-drivers.ts` 的 `startServe`(约 560-605 行)都是 `spawn(..., { detached: true, ... })`,**不包 systemd scope**;`detached:true` 只脱离会话,不脱离 cgroup。
2. anchor 的启动机制在 `plugin/scripts/driver-runtime.ts`:`anchorLaunchArgv`(约 1523-1532 行)把内层 argv 包进 `systemd-run --user --scope --collect --unit=<name> -p MemoryAccounting=yes -p OOMPolicy=continue [-p MemoryMax=…]`;`--scope` 下 systemd-run **原地 exec**,pid 与内层命令的语义不变;`anchorUnitName(root, nowMs)`(约 1444 行)生成 `quay-anchor-<root>-<ts>.scope`;`envelope==="none"` 时原样返回内层 argv 作为回退;可用性由真瞬态 scope 探测(`full-suite-runner.ts` 的 `systemdRunAvailable`)判定。本机已有三个 `quay-anchor-*.scope` 在运行。
3. 现存能存活的 serve 都是人手工包过的(例如 `quay-drivers-claudecodeui-….scope`、手搓的 `quay-serve-quay-….service`),不是产品默认行为。

**修法**:serve 宿主的两个 spawn 点(`spawnHost` 与 `startServe`;任务 `gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log` 已 done,应已把两处收拢到共享 helper——**实现前先读代码确认 helper 的名字与位置,在其上改,不要再并行出第二个 spawn 点**)改为经 `systemd-run --user --scope --collect` 包裹启动,**复用** anchor 的参数构造与 `systemdRunAvailable` 判据(⛔ 不复制一份)。单元名用 `quay-serve-<root>-<ts>.scope`(注意仓库外已有手搓的 `quay-serve-quay-<ts>.service`,命名不得冲突)。内存:独立 scope 即独立 OOM 域,是否设 `MemoryMax` 沿用 anchor 的"空则不传"规则(⛔ 不写等价无限制的字面值)。`systemd-run` 不可用(无 user manager、非 systemd 平台)⇒ 回退为当前行为,并**明确报告**"本次宿主未受重启存活保护"(稳定字样 `serve-scope-unavailable`),⛔ 不静默。Core(`packages/quay`)不得静态依赖 plugin 层:`anchorLaunchArgv`/`systemdRunAvailable` 在 plugin 层,实现者在"经 `plugin-root.ts` 动态解析"与"把纯函数提到 Core 与 plugin 共享的叶模块"之间选一种,AC 约束行为与单一实现。pid 语义:`server.json`、`.quay/serve.pid`、准入锁(`.quay/server.lock`)的 pid 与 cmdline 校验必须与现在一致(`--scope` 原地 exec 保证),不得经 shell。绑定仍只经 `resolveServeBinding`,⛔ 不引入 `--host/--port` 默认值。

**不在范围**:serve 崩溃后被拉起(监管,另案);serve 宿主的版本读数(任务 `gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only`);`.quay/serve.log` 轮转;systemd 单元模板;CloudCLI 重启后 serve 仍跑旧版本的处理(只报告不自动重启)。

<!-- dedup-ref -->相关(追溯,非前置):gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log(done,收拢两个 spawn 点并统一日志);gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only(版本读数);gap-ac251-resident-unified-host-dead-no-restore(done,宿主死后无人拉回)。

## Touches
- `packages/quay/src/cli/server.ts`
- `packages/quay/src/systemd-scope.ts`
- `plugin/scripts/start-drivers.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/full-suite-runner.ts`
- `packages/quay/test/server-restart.test.mjs`
- `packages/quay/test/server-host-own-scope.test.mjs`
- `plugin/test/start-drivers.test.mjs`
- `plugin/sh-census-baseline.json`
- `tasks/gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts.md`

## AC
- [x] 新增测试 `packages/quay/test/server-host-own-scope.test.mjs`(用真 `.quay/config.yml` 临时 workspace,配置带显式 native `path`/`mcp_entry` 以与版本无关):经 `spawnHost` 路径起宿主,断言宿主 `/proc/<pid>/cgroup` 以 `/app.slice/quay-serve-` 开头且以 `.scope` 结尾,**不等于**调用者(测试进程)所在 cgroup;`.quay/serve.pid`、`server.json` 的 pid 与 `/proc/<pid>` 一致且 cmdline 含 `serve`。`node --experimental-strip-types --test packages/quay/test/server-host-own-scope.test.mjs` 退出 0(`systemd-run --user` 不可用的 CI 上该用例须以明确的跳过原因标注,且回退用例仍执行)。取假:把包裹去掉后该用例红(附实跑输出)。
- [x] 同一断言覆盖 `start-drivers.ts` 的 `startServe` 路径(`plugin/test/start-drivers.test.mjs` 新用例)。`grep -n "systemd-run" packages/quay/src/cli/server.ts plugin/scripts/start-drivers.ts` 排除注释后,两个文件都**不**自己拼 `systemd-run` argv,只经同一个共享实现(先打印改前基线读数,命中数为 0,证明谓词能分辨);共享实现只有一份。
- [x] 回退可见:注入 `systemdRunAvailable()===false` 的夹具下,宿主仍被拉起(行为同改前),且返回值或 stderr 含稳定字样 `serve-scope-unavailable`;用例断言该字样,并断言它与成功路径输出可区分。
- [x] Core 不新增对 plugin 层的静态 import:`bash scripts/test.sh --for-task gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts` 退出 0 且执行了 ≥1 个测试文件(包含依赖方向/导入图检查,valueSccs 基线保持 0)。
- [x] `quay server status`/准入锁/`quay server stop|restart --only web` 行为不回归:`node --experimental-strip-types --test packages/quay/test/server-restart.test.mjs plugin/test/start-drivers.test.mjs` 退出 0(准入拒绝仍读 `.quay/serve.log` 的 `quay-serve-admission-refused`)。
- [x] 读生产载体(重启存活实证):用一个临时 systemd 服务当 CloudCLI 的替身——`systemd-run --user --unit=fake-cloudcli-<ts> bash -c '<在临时 workspace 经 quay server start 起宿主并记录其 pid/cgroup>; sleep infinity'`,宿主起好后 `systemctl --user restart fake-cloudcli-<ts>`,断言宿主 pid 仍存活、`/proc/<pid>/cgroup` 仍是独立 `quay-serve-*.scope`、`quay server status --json` 为 `running`;原始读数贴进完成记录。负控制:把包裹去掉后同一步骤宿主 pid 在替身服务重启后不存在、`status` 为 `not-running`(stale carrier)。⛔ 只用替身单元,不得重启真实的 `claudecodeui-server.service`。
- [x] 临时单元与宿主在测试结束时按 pid/单元名精确清理(⛔ 不用 `pkill -f` 匹配 serve),测试后 `systemctl --user list-units 'fake-cloudcli-*' 'quay-serve-test-*'` 无残留。
- [x] 若 `plugin/scripts/start-drivers.ts` 或任何 `.sh` 被改动,sh-census 行数不高于改前基线(行数中性或净减),`plugin/sh-census-baseline.json` 同步。

## DoD
真实落地:在一个由 CloudCLI(或其替身 systemd 服务)启动的会话里经 `quay server start` 或 `/quay:drivers` 起的真实 serve 宿主,在该服务/会话 scope 被停掉并重启后仍然存活,`server.json` 有效、端口不变(绑定仍由 `resolveServeBinding` 决定);systemd 不可用的环境得到 `serve-scope-unavailable` 的明确报告而非静默失去保护。仅 fixture 绿不算完成。

## Evidence
**实现**:`packages/quay/src/systemd-scope.ts`(新,Core 叶模块,只 import node 内建)= 「包进 `systemd-run --user --scope`」的**唯一一份**实现:单元名派生 / 可用性探测(同一 `QUAY_TEST_SYSTEMD_RUN_AVAILABLE` seam)/ MemoryMax 策略("空则不传")/ argv 构造。两个 serve spawn 点(Core `cli/server.ts:spawnHost`、plugin `start-drivers.ts:startServe`)与 driver anchor(`driver-runtime.ts` 的 `anchor*` 族改为薄委托)都取这一份 —— 没有任何一处自己拼 argv。`--scope` 原地 exec ⇒ pid 语义不变。

- **AC1**:`node --experimental-strip-types --test packages/quay/test/server-host-own-scope.test.mjs` → 3 tests / 3 pass / 0 fail(exit 0)。实读:宿主 `/proc/<pid>/cgroup` = `/user.slice/user-1004.slice/user@1004.service/app.slice/quay-serve-test-serve-own-scope-XXXXXX-<ts>.scope`(机制段 tail = `/app.slice/quay-serve-….scope`),**≠** 调用者(测试进程,在 `quay-anchor-*` scope)的 cgroup;`server.json.pid` 与 `/proc/<pid>` 一致,`cmdline` 含 `serve`。**取假实跑**:把 `scopeLaunchArgv` 改成原样返回内层 argv 后,该用例红,失败断言原文 `the host must live in its own quay-serve-* scope; got cgroup=/user.slice/…/app.slice/quay-anchor-quay-1791291767121.scope`;恢复后重新绿。
  ⚠️ 与 AC 文本的一处偏差(如实报出):`.quay/serve.pid` **改前就只由 `startServe` 写**,`spawnHost` 从不写它(改前改后一致,本任务不改变这一点)——故该文件的 pid 一致性断言落在 AC2 的 `startServe` 用例,`spawnHost` 用例断言的是它实际写的载体 `server.json`。
- **AC2**:`plugin/test/start-drivers.test.mjs` → 21 tests / 21 pass(新增 `startServe — the host runs in its OWN quay-serve-*.scope, and its pid records name it`:断言 `.quay/serve.pid` == carrier pid == `/proc/<pid>`、cmdline 含 `serve`、cgroup tail `/app.slice/quay-serve-….scope` ≠ 调用者)。静态读数:`grep -n "systemd-run"` 改前(git HEAD)= server.ts 0 / start-drivers.ts 0;改后**剥注释**后仍为 0 / 0;正控制 `plugin/scripts/full-suite-runner.ts` = 5(谓词能分辨,⛔ 不是恒零);共享实现 `systemd-scope.ts` = 3(唯一落点)。
- **AC3**:`QUAY_TEST_SYSTEMD_RUN_AVAILABLE=0` 夹具下宿主仍被拉起(fixture marker 落盘),且**恰一次**报出稳定字样 `serve-scope-unavailable`;同一用例断言成功路径的 `warnScope` 为空(AC1 用例内 `assert.deepEqual(scopeReports, [])`)⇒ 该字样在两条路上可区分。
- **AC4**:`bash scripts/test.sh --for-task gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts --allow-thin` → **exit 0**,执行 121 个测试(0 fail,含 change-relevant 静态检查与 scoped 测试选择)。`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` → `valueSccs=0 / typeSccs=0 / reverseEdges=0`(基线保持 0;新叶模块只 import node 内建,两个反向边都是受认可的 `plugin/` → `packages/`)。
- **AC5**:`node --experimental-strip-types --test packages/quay/test/server-restart.test.mjs plugin/test/start-drivers.test.mjs` → 7 + 21 = 28 tests / 0 fail。准入拒绝仍读 `.quay/serve.log`(full-flow 用例 `run#2` 仍报 `already-running`,日志只有一条 `serve listening`)。
- **AC6**(生产载体;原始读数 `/tmp/ac6-evidence.txt`,替身单元 `fake-cloudcli-<ts>`,⛔ 未触碰真实 `claudecodeui-server.service`):
  - 正(本修法):宿主 cgroup = `/user.slice/user-1004.slice/user@1004.service/app.slice/quay-serve-test-wsA-1791292627757.scope`(≠ 替身服务的 `…/app.slice/fake-cloudcli-1791292627.service`);`systemctl --user restart fake-cloudcli-1791292627` 之后 → `host_alive=yes`、cgroup **不变**、`quay server status --json` = `status=running pid=3079483`(同一 pid;端口 18829 前后不变)。
  - 负控制(`QUAY_TEST_SYSTEMD_RUN_AVAILABLE=0`,即"把包裹去掉"):宿主 cgroup = `…/app.slice/fake-cloudcli-1791292627.service`(继承启动者);重启后 → `host_alive=no`、`status=not-running`,reason = `…/test-wsA/.quay/server.json names pid 3083364, which is not alive (stale carrier — the server was killed without a graceful close)`。
  - 同一次负控制里 captured 的 start 日志含稳定字样 `serve-scope-unavailable: the serve host will spawn WITHOUT its own cgroup scope — …`(AC3 的生产侧读数)。
- **AC7**:测试内按 pid + 单元名精确清理(⛔ 无 `pkill -f`);两轮 AC6 之后 `systemctl --user list-units 'fake-cloudcli-*' 'quay-serve-test-*' --all --no-legend` **空**(无残留)。
- **AC8**:未改动任何 `.sh`(改动集中在 `.ts`/`.mjs`);`node --experimental-strip-types plugin/scripts/sh-census-check.ts` → `embeddedInterpreterLines=7692 ≤ baseline 7692`,`duplicateCopies=0`,PASS;`plugin/sh-census-baseline.json` 无需变更(与 committed baseline 一致)。
