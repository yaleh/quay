---
id: gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts
title: serve 宿主默认落在调用它的会话 scope 里，CloudCLI 重启时随旧会话 scope 被杀——宿主应像 anchor 一样用
  systemd-run --scope 起在独立 scope
status: ready
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
- `plugin/scripts/start-drivers.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/full-suite-runner.ts`
- `packages/quay/test/server-restart.test.mjs`
- `packages/quay/test/server-host-own-scope.test.mjs`
- `plugin/test/start-drivers.test.mjs`
- `plugin/sh-census-baseline.json`
- `tasks/gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts.md`

## AC
- [ ] 新增测试 `packages/quay/test/server-host-own-scope.test.mjs`(用真 `.quay/config.yml` 临时 workspace,配置带显式 native `path`/`mcp_entry` 以与版本无关):经 `spawnHost` 路径起宿主,断言宿主 `/proc/<pid>/cgroup` 以 `/app.slice/quay-serve-` 开头且以 `.scope` 结尾,**不等于**调用者(测试进程)所在 cgroup;`.quay/serve.pid`、`server.json` 的 pid 与 `/proc/<pid>` 一致且 cmdline 含 `serve`。`node --experimental-strip-types --test packages/quay/test/server-host-own-scope.test.mjs` 退出 0(`systemd-run --user` 不可用的 CI 上该用例须以明确的跳过原因标注,且回退用例仍执行)。取假:把包裹去掉后该用例红(附实跑输出)。
- [ ] 同一断言覆盖 `start-drivers.ts` 的 `startServe` 路径(`plugin/test/start-drivers.test.mjs` 新用例)。`grep -n "systemd-run" packages/quay/src/cli/server.ts plugin/scripts/start-drivers.ts` 排除注释后,两个文件都**不**自己拼 `systemd-run` argv,只经同一个共享实现(先打印改前基线读数,命中数为 0,证明谓词能分辨);共享实现只有一份。
- [ ] 回退可见:注入 `systemdRunAvailable()===false` 的夹具下,宿主仍被拉起(行为同改前),且返回值或 stderr 含稳定字样 `serve-scope-unavailable`;用例断言该字样,并断言它与成功路径输出可区分。
- [ ] Core 不新增对 plugin 层的静态 import:`bash scripts/test.sh --for-task gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts` 退出 0 且执行了 ≥1 个测试文件(包含依赖方向/导入图检查,valueSccs 基线保持 0)。
- [ ] `quay server status`/准入锁/`quay server stop|restart --only web` 行为不回归:`node --experimental-strip-types --test packages/quay/test/server-restart.test.mjs plugin/test/start-drivers.test.mjs` 退出 0(准入拒绝仍读 `.quay/serve.log` 的 `quay-serve-admission-refused`)。
- [ ] 读生产载体(重启存活实证):用一个临时 systemd 服务当 CloudCLI 的替身——`systemd-run --user --unit=fake-cloudcli-<ts> bash -c '<在临时 workspace 经 quay server start 起宿主并记录其 pid/cgroup>; sleep infinity'`,宿主起好后 `systemctl --user restart fake-cloudcli-<ts>`,断言宿主 pid 仍存活、`/proc/<pid>/cgroup` 仍是独立 `quay-serve-*.scope`、`quay server status --json` 为 `running`;原始读数贴进完成记录。负控制:把包裹去掉后同一步骤宿主 pid 在替身服务重启后不存在、`status` 为 `not-running`(stale carrier)。⛔ 只用替身单元,不得重启真实的 `claudecodeui-server.service`。
- [ ] 临时单元与宿主在测试结束时按 pid/单元名精确清理(⛔ 不用 `pkill -f` 匹配 serve),测试后 `systemctl --user list-units 'fake-cloudcli-*' 'quay-serve-test-*'` 无残留。
- [ ] 若 `plugin/scripts/start-drivers.ts` 或任何 `.sh` 被改动,sh-census 行数不高于改前基线(行数中性或净减),`plugin/sh-census-baseline.json` 同步。

## DoD
真实落地:在一个由 CloudCLI(或其替身 systemd 服务)启动的会话里经 `quay server start` 或 `/quay:drivers` 起的真实 serve 宿主,在该服务/会话 scope 被停掉并重启后仍然存活,`server.json` 有效、端口不变(绑定仍由 `resolveServeBinding` 决定);systemd 不可用的环境得到 `serve-scope-unavailable` 的明确报告而非静默失去保护。仅 fixture 绿不算完成。
