---
id: gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log
title: '`quay server start/add/restart` 拉起的 serve 宿主 stdio
  被丢弃（stdio:"ignore"），宿主死时零痕迹；同一宿主经 start-drivers 启动却写 .quay/serve.log——两个 spawn
  点两套行为'
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
**症状(2026-10-06,cantus 实测)**:通过 `quay server start` 起的 web/control 宿主进程死亡后,`.quay/server.json` 成为 stale carrier,而 `.quay/` 下各 round 日志与任何地方都找不到死因,因为宿主 stderr/stdout 无处可去。

**机制(已读代码)**:宿主有两个 spawn 点,行为不一致:
1. `packages/quay/src/cli/server.ts` 的 `spawnHost`(约 488-520 行)用 `spawn(process.execPath, args, { cwd, detached: true, stdio: "ignore", env })`——输出被丢弃;被 `server start`(约 658 行)与 `server add/restart`(约 738 行)调用。
2. `plugin/scripts/start-drivers.ts` 的 `startServe`(约 560-605 行)打开 `.quay/serve.log`(追加,失败退回 /dev/null),以 `stdio: ["ignore", logFd, logFd]` 启动,并读该日志的新增字节判定准入结果(`quay-serve-admission-refused` 等记录就在这个文件里)。
同一个宿主因入口不同而日志去向不同;`quay server` 路径上的死因不可追溯。

**修法**:`spawnHost` 使用与 `startServe` 相同的日志约定——`.quay/serve.log`(⛔ 不新增第二个日志文件名),`stdio: ["ignore", fd, fd]`,打开失败才退回 /dev/null,且退回时必须在返回值/stderr 中**明确报告**日志不可用(硬规则 3b:不得静默);两个 spawn 点共用一个日志打开/stdio 构造 helper(单一实现,不各写一份)。不改变宿主 argv、env、detached 语义,不引入 `--host/--port` 默认值(绑定的唯一正本仍是 `resolveServeBinding`)。

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
- [ ] 新增/扩展测试(`packages/quay/test/server-restart.test.mjs` 或同目录新用例,用真 `.quay/config.yml` 临时 workspace):经 `spawnHost` 路径起一个宿主夹具(或可注入的 spawn seam,⛔ 但须有一条用例走真实 spawn),让它向 stderr 写一行并退出,断言 `.quay/serve.log` 含该行。`node --experimental-strip-types --test packages/quay/test/server-restart.test.mjs` 退出 0。取假:把 `stdio` 改回 `"ignore"` 后该用例红(附实跑输出)。
- [ ] 日志不可用:让 `.quay/serve.log` 无法打开(目录权限/同名目录夹具)时,`spawnHost` 仍拉起宿主,但返回值或 stderr 含明确的 `serve-log-unavailable`(或等价稳定字样)提示,⛔ 不静默;用例断言该字样。
- [ ] 单一实现:`grep -n "stdio" packages/quay/src/cli/server.ts plugin/scripts/start-drivers.ts` 中,宿主 spawn 的 stdio/日志 fd 构造只出现在一个共用 helper(先打印改前基线命中与前 3 条证明谓词对改前代码能命中)。
- [ ] 不回归准入判定:`node --experimental-strip-types --test plugin/test/start-drivers.test.mjs` 退出 0(`quay-serve-admission-refused` 读取仍然有效)。
- [ ] 读生产载体:在本机用 `quay server start`(临时 workspace,随机端口)起宿主,`kill -9` 后读 `.quay/serve.log`,确认其中含宿主在死前写出的输出(例如启动横幅);原文贴进完成记录。该 AC 在把 stdio 改回 "ignore" 后必须变红(负控制)。
- [ ] `bash scripts/test.sh --for-task gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:经 `quay server start` 起的真实宿主在被杀或崩溃后,`.quay/serve.log` 里能读到它最后的输出;两个入口起的宿主日志去向一致。仅 fixture 绿不算完成。
