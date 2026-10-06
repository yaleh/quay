---
id: gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log
title: '`quay server start/add/restart` 拉起的 serve 宿主 stdio
  被丢弃（stdio:"ignore"），宿主死时零痕迹；同一宿主经 start-drivers 启动却写 .quay/serve.log——两个 spawn
  点两套行为'
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
**症状(2026-10-06,cantus 实测)**:通过 `quay server start` 起的 web/control 宿主进程死亡后,`.quay/server.json` 成为 stale carrier,而 `.quay/` 下各 round 日志与任何地方都找不到死因,因为宿主 stderr/stdout 无处可去。

**机制(已读代码)**:宿主有两个 spawn 点,行为不一致:
1. `packages/quay/src/cli/server.ts` 的 `spawnHost`(约 488-520 行)用 `spawn(process.execPath, args, { cwd, detached: true, stdio: "ignore", env })`——输出被丢弃;被 `server start`(约 658 行)与 `server add/restart`(约 738 行)调用。
2. `plugin/scripts/start-drivers.ts` 的 `startServe`(约 560-605 行)打开 `.quay/serve.log`(追加,失败退回 /dev/null),以 `stdio: ["ignore", logFd, logFd]` 启动,并读该日志的新增字节判定准入结果(`quay-serve-admission-refused` 等记录就在这个文件里)。
同一个宿主因入口不同而日志去向不同;`quay server` 路径上的死因不可追溯。

**修法**:`spawnHost` 使用与 `startServe` 相同的日志约定——`.quay/serve.log`(⛔ 不新增第二个日志文件名),`stdio: ["ignore", fd, fd]`,打开失败才退回 /dev/null,且退回时必须在返回值/stderr 中**明确报告**日志不可用(硬规则 3b:不得静默);两个 spawn 点共用一个日志打开/stdio 构造 helper(单一实现,不各写一份)。不改变宿主 argv、env、detached 语义,不引入 `--host/--port` 默认值(绑定的唯一正本仍是 `resolveServeBinding`)。

**实现(落地)**:新增 `packages/quay/src/serve-log.ts` —— `openServeLog(root)` 是唯一的日志打开 + `stdio` 构造点(`serveLogPath`/`SERVE_LOG_BASENAME` 是 `.quay/serve.log` 唯一的命名点),`SERVE_LOG_UNAVAILABLE` 是「日志打不开」的稳定 token。它**永不抛**:真日志打不开 ⇒ 退回 /dev/null 且 `unavailable:true` + `reason`(不得静默);连 /dev/null 都打不开 ⇒ `stdio:"ignore"` 且两个原因都报。`cli/server.ts:spawnHost` 改用该 helper 并把不可用经 stderr/warn 报出;`plugin/scripts/start-drivers.ts:startServe` 删掉自己那份拷贝改用同一 helper,并同样报出不可用。⛔ 宿主 argv / env / detached 语义、`resolveServeBinding` 的绑定唯一正本均未改动。

**不在范围**:serve 的 systemd 单元模板(另案,需人裁定);serve 宿主的版本读数(任务 B);serve 进程级监管。

<!-- dedup-ref -->相关(追溯,非前置):gap-serve-same-root-admission-lock(准入锁,读 serve.log 判定);gap-serve-binding-defaults-three-copies-to-one-definition-point(绑定正本)。

## Touches
- `packages/quay/src/serve-log.ts`
- `packages/quay/src/cli/server.ts`
- `plugin/scripts/start-drivers.ts`
- `packages/quay/test/server-restart.test.mjs`
- `plugin/test/start-drivers.test.mjs`
- `tasks/gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log.md`

## AC
- [x] 新增/扩展测试(`packages/quay/test/server-restart.test.mjs` 或同目录新用例,用真 `.quay/config.yml` 临时 workspace):经 `spawnHost` 路径起一个宿主夹具(或可注入的 spawn seam,⛔ 但须有一条用例走真实 spawn),让它向 stderr 写一行并退出,断言 `.quay/serve.log` 含该行。`node --experimental-strip-types --test packages/quay/test/server-restart.test.mjs` 退出 0。取假:把 `stdio` 改回 `"ignore"` 后该用例红(附实跑输出)。 —— 落地:server-restart.test.mjs 新增用例「spawnHost — the host's stdout/stderr reach `.quay/serve.log` through a REAL spawn」,用 `{ entry: <夹具.mjs> }` 走**真实 spawn**(非 seam 替身),夹具向 stderr/stdout 各写一行并退出,断言两行都在 `.quay/serve.log` 里且夹具真的执行过(marker 文件)。实跑 `node --no-warnings --experimental-strip-types --test packages/quay/test/server-restart.test.mjs` ⇒ `tests 7 / pass 7 / fail 0`(exit 0)。**取假**(cp 备份 → `sed` 把 server.ts 的 `stdio: log.stdio` 改回 `stdio: "ignore"`)⇒ `✖ spawnHost — the host's stdout/stderr reach .quay/serve.log through a REAL spawn (15052ms)` / `AssertionError [ERR_ASSERTION]: the fixture host's STDERR reached .quay/serve.log — before this fix \`spawnHost\` passed stdio:"ignore" and the bytes went nowhere` / `ℹ pass 6 ℹ fail 1`;还原后复跑 7/7 绿。
- [x] 日志不可用:让 `.quay/serve.log` 无法打开(目录权限/同名目录夹具)时,`spawnHost` 仍拉起宿主,但返回值或 stderr 含明确的 `serve-log-unavailable`(或等价稳定字样)提示,⛔ 不静默;用例断言该字样。 —— `openServeLog` 对「同名目录夹具」实测 `EISDIR: illegal operation on a directory, open '…/.quay/serve.log'` ⇒ `unavailable:true` + 该 reason + 退回 /dev/null(stdio `["ignore",<devnullFd>,<devnullFd>]`);`spawnHost` 经 `warn`(默认 process.stderr)写出 `serve-log-unavailable: cannot open <path> (<reason>) — the host's stdout/stderr will be discarded…`。用例断言 `warnings.length === 1` ∧ `/serve-log-unavailable/` ∧ `/serve\.log/`,并**断言宿主仍被拉起**(夹具 marker 文件出现)——「报告了」没有替换「拉起了」。(`spawnHost` 的返回字符串仍只表达「定位失败」这一 fatal 情形,故本提示走 stderr 一路,AC 允许「返回值**或** stderr」。)
- [x] 单一实现:`grep -n "stdio" packages/quay/src/cli/server.ts plugin/scripts/start-drivers.ts` 中,宿主 spawn 的 stdio/日志 fd 构造只出现在一个共用 helper(先打印改前基线命中与前 3 条证明谓词对改前代码能命中)。 —— **改前基线**(谓词对改前代码确实命中):命中 2 处构造 —— `packages/quay/src/cli/server.ts:512:    stdio: "ignore",` 与 `plugin/scripts/start-drivers.ts:590:      stdio: ["ignore", logFd, logFd],`;前 3 条为 `server.ts:512` / `start-drivers.ts:546`(注释里的 "stdio → log file")/ `start-drivers.ts:590`。**改后**:两文件里与 stdio 有关的调用点只剩各自 spawn 的 `stdio: log.stdio`(`server.ts:552` / `start-drivers.ts:607`),fd 打开与 `["ignore", fd, fd]` 三元组的构造只在共用 helper `packages/quay/src/serve-log.ts:openServeLog` 一处。
- [x] 不回归准入判定:`node --experimental-strip-types --test plugin/test/start-drivers.test.mjs` 退出 0(`quay-serve-admission-refused` 读取仍然有效)。 —— 实跑 ⇒ `tests 20 / pass 20 / fail 0`(exit 0)。原有的 full-flow 用例仍走真锁:run#2 从 `.quay/serve.log` 读回 `quay-serve-admission-refused … self=<childPid>` 得 `already-listening`,而 run#2 的「attempted a serve start and was refused」记录也照旧。`readAdmissionRefusal(logPath, startOffset, pid)` 仍读同一文件、同一 offset(offset 现在由 helper 产出,语义不变:只认本次 spawn 之后追加的字节)。另新增 1 例覆盖 unavailable 分支(宿主仍 `started`)。
- [x] 读生产载体:在本机用 `quay server start`(临时 workspace,随机端口)起宿主,`kill -9` 后读 `.quay/serve.log`,确认其中含宿主在死前写出的输出(例如启动横幅);原文贴进完成记录。该 AC 在把 stdio 改回 "ignore" 后必须变红(负控制)。 —— 真机真 CLI:临时 workspace(自带真 `.quay/config.yml`)里 `node --no-warnings --experimental-strip-types <wt>/packages/quay/bin/quay.ts server start --only web --json` ⇒ exit 0,`{"name":"web","outcome":"started","pid":1363561,…}`;`kill -9 1363561` 后 `.quay/serve.log` **原文**:`quay-native mcp: serving tasks from /tmp/ac5-serve-ws-Yd0adX/tasks, ADRs from /tmp/ac5-serve-ws-Yd0adX/adr, meta from /tmp/ac5-serve-ws-Yd0adX/meta` / `quay serve: listening on http://0.0.0.0:9369` / `quay serve: control plane (MCP) listening on http://127.0.0.1:17839 — same pid 1363561 (SPEC stage A2)`;`grep -c "quay serve: listening on"` ⇒ `1`。**负控制**(同步骤,先 `sed` 把 stdio 改回 `"ignore"`)⇒ `.quay/serve.log` 文件存在但 **0 字节**——宿主死前输出零痕迹,正是本任务所修症状;已还原并复跑绿。
- [x] `bash scripts/test.sh --for-task gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log` 退出 0 且执行了 ≥1 个测试文件。 —— 在 worktree 内实跑 `bash <wt>/scripts/test.sh --for-task gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log --allow-thin` ⇒ **EXIT=0**。scoped 静态层全绿(`== scoped static checks (change-relevant tier…) ==`,含 `import-graph-check`、`serve-binding-literal-check`、`checked-in-write-check` 等),并执行了测试文件:`node:test` 汇总 `tests 117 / suites 0 / pass 117 / fail 0 / cancelled 0`(含本任务的 server-restart.test.mjs 与 start-drivers.test.mjs 两个文件)。

## DoD
真实落地:经 `quay server start` 起的真实宿主在被杀或崩溃后,`.quay/serve.log` 里能读到它最后的输出;两个入口起的宿主日志去向一致。仅 fixture 绿不算完成。 —— 见 AC5:真 CLI `quay server start` 起的真宿主在 `kill -9` 后,`.quay/serve.log` 里读到它死前写出的三行输出(含 `quay serve: listening on …` 启动横幅);两个入口现在共用 `packages/quay/src/serve-log.ts:openServeLog` 的同一份路由,`grep -n stdio` 在两文件里已无第二份构造。start-drivers 一侧的 `startServe` 也改读同一 helper,并同样报告不可用。
