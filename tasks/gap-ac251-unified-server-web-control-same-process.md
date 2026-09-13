---
id: gap-ac251-unified-server-web-control-same-process
title: GOAL-017/AC-251：web 与 control 合入同一进程 —— 新增 `quay server status --json`
  且二者同 pid（SPEC 阶段 A2）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-251
---
## Proposal

**AC-251 现状（立案当轮实测，取假形态）**：

```
$ node packages/quay/bin/quay.js server status --json
usage: quay <adr|goal|meta|init|task list|view|create|edit|check|gate|gate-log|complete|adjudicate|promote|retreat|run|migrate|config validate|config check|action list|action run|serve|mcp|manager start|manager arm|driver> ...
Run `quay --help` for full usage documentation.
exit=1
```

两个缺口叠加：**① CLI 表层没有 `server` 子命令**（`packages/quay/bin/quay.ts:216` 的 usage 行就是完整动词表，其中无 `server`）；**② 进程边界上 web 与 control 今天分属两个进程** —— `quay serve`（`packages/quay/src/serve.ts:203` `startServer()`）只起 HTTP/Web UI，而控制面 `serveControlPlane` 的实现早在 `plugin/scripts/driver-shared.ts:283`（AC150-3），**当前唯一调用点是 `plugin/scripts/worker-driver.ts:5375` 的 `--serve` 路径**。⇒ 本 AC 今天**结构上必然取假**（与 AC 记录 origin 一致）；且即使补上子命令、若不同时把控制面移进 serve 进程，`status` 也报不出「同 pid」这个事实。

**为什么这是 SPEC 阶段 A2、不是新功能**：`orchestration/SPEC-unified-quay-server-2026-09-13.md` §7 的 A2 行要求「`web`(serve) + `control` 合入一个进程；drivers 仍是独立进程」，**两边实现都已存在，本步是合并**；它的判据是「进程数 13 → 12」+「Web 全部路由零回退」。AC-251 是这条的机器判据，并把 `status --json` 的最小契约钉死：`services[]` 各含 `name` 与**整数** `pid`。

**现状读数（立案当轮实测，非印象）**：长驻进程 **13** 个（6 个 driver kind × (driver + supervisor) + `quay serve`）；`.quay/<kind>-driver{,-supervisor}.pid` 恰 **12** 个（`ls` 一次列全核对；⛔ 不把 `.quay/suite-load-*.jsonl.pid` 混进来 —— 那种宽松 glob 会数出 136）；`.quay/serve.pid` = **3157065**，cmdline `node --watch --experimental-strip-types packages/quay/bin/quay.ts serve --host 0.0.0.0 --port 4173`，etime **3 天 16:27**。

**范围边界（⛔ 不越界）**：SPEC §8 判据 9 要求阶段 A 零新用户可见能力 ⇒ 本任务只加 AC-251 自己要求的 `server status`；SPEC §6.9 的 `start` / `add` / `stop` 三个动词属阶段 B（AC-254），本任务不实现。本任务也不动 driver 的进程形态（阶段 C / AC-255）：`quay driver stop --kind X` 不杀在飞子进程的语义（SPEC §6.9 不变式 3）保持原样。⛔ 实现与验证期间不得实跑 `quay driver stop`（那会停掉生产 driver）。

<!-- dedup-ref -->
**关联（仅登记，不构成本任务的阻塞）**：`gap-quay-server-lightweight-peer-identity-spike`（done）= SPEC 阶段 D 的可行性 spike；`gap-skill-start-drivers-webserver`（done）= 现状「driver + web serve」的会话内起停封装；`gap-webui-server-stale-code-no-restart-detection`（done）= `/health` 的 stale 读数（本任务复用 `/health` 作为 web 面的独立探针，不重复实现）。三者与本任务机制不同、Touches 不相交。

## Plan

1. **统一进程（合并已有实现，⛔ 不新建能力）**：让 `quay serve` 的进程同时承载 HTTP/Web UI 与 MCP 控制面 —— `packages/quay/src/serve.ts` 的 `startServer()` 在监听 web 端口的同时调用**已有**的 `serveControlPlane`（`plugin/scripts/driver-shared.ts:283`，返回 `{url, port, close}`）。控制面端口缺省在本进程内起（`port: 0` ⇒ 从 `ControlPlaneHandle.port` 回读实际端口），可由 env/flag 覆盖。**单一实现纪律**：控制面只有这一份实现，⛔ 不得在 `packages/quay/src` 下另写第二份 MCP 控制面（SPEC §8 判据 1 的同族形态：出现第二份并行实现即未达成）。产品侧 import 插件脚本的既有先例 = `packages/quay-native/src/store.ts:34`（import `plugin/scripts/shape-sections.ts`）；若直接 import `driver-shared.ts` 会拖入不必要依赖，则把**控制面宿主**抽到与 `shape-sections.ts` 同族的零依赖共享模块、两边各 import 同一份 —— ⛔ 不是复制一份。

2. **状态载体（进程自发布，workspace-root 相对）**：统一进程启动时把服务清单原子写入 `<workspaceRoot>/.quay/server.json`（`plugin/scripts/write-json-atomic.ts` 已有），形状 `{schemaVersion:1, pid, startedAt, services:[{name:"web",pid,port},{name:"control",pid,port}]}`。每个服务的 `pid` = **宿主进程自己的 pid** —— 这正是「已合入同一进程」的可取假读数。进程退出/被杀后，载体必须能被 `status` 判为 stale（否则死进程会被报成在跑 —— 硬规则 3b：读不懂/读不到不得返回与「合格」同形的值）。该载体是运行时状态，⛔ 不提交。

3. **CLI（CLI 先行，SPEC §6.8）**：新增 `packages/quay/src/cli/server.ts`，只实现 `status [--json]`：读 `.quay/server.json` → 逐服务核 pid 活性（`process.kill(pid,0)` 或 `/proc/<pid>` 存在性）→ 输出 JSON。**无载体 / 载体指向已死进程 ⇒ exit 1**（诚实失败，⛔ 不合成一对假 pid）；`--json` 下输出必须是机器可解析 JSON（读不懂 ⇒ exit 3，⛔ 不与「未达成」同形 —— 这正是 AC-251 自己的三分法）。每服务的活性取**直接量**（该服务自己的最后一次成功动作时刻 / 心跳），读不到写 `not-evaluated`，⛔ 不是「正常」（SPEC §6.10）。同时更新 `packages/quay/bin/quay.ts`（动词派发 + usage 行，与 `serve` 同族写法）与 `packages/quay/src/cli/help.ts`。

4. **零回退**：Web 全部既有路由行为不变（`packages/quay/test/serve-*.test.mjs` 全绿）；合并后 serve 多绑一个控制面端口 ⇒ 须核 `plugin/scripts/start-drivers.ts` 的既有拉起路径与 `plugin/test/start-drivers.test.mjs` 不因端口/生命周期变化转红（⛔ 不因此新增第二条拉起路径）。

5. **取假控制（证明 AC1/AC6 的读数不是恒真）**：① 停掉统一 server ⇒ `status` 必须非 0；② **两个独立活面各证一次同一 pid** —— `curl <web port>/health` 有响应 ∧ 对 `<control port>` 发一条 JSON-RPC（`initialize` 或未注册方法探针）拿到 JSON-RPC 响应 ∧ `ps -p <status 报出的 pid> -o args=` 就是统一 server 入口。三者一致才等于「两个服务真在这一个进程上」；缺任一 ⇒ 那只是载体自报（硬规则 4b：被测对象自己产生、自己维护的量，不能单独用来判它）。

6. **真落地（生产载体，非夹具）**：主检出的常驻 server 带到统一形态后，在 repo root 逐字跑 AC-251 的 criterion ⇒ exit 0；把 `status --json` 原文、`ps` 行、负控制读数贴进本任务结果段。

## Touches

- `packages/quay/bin/quay.ts`（`server` 动词派发 + usage 行）
- `packages/quay/src/cli/server.ts` (new)（`status [--json]`）
- `packages/quay/src/cli/help.ts`（帮助条目）
- `packages/quay/src/serve.ts`（`startServer()` 起控制面 + 发布状态载体）
- `plugin/scripts/driver-shared.ts`（`serveControlPlane` 的接口面 = 控制面宿主的单一实现，产品侧复用；仅当需暴露端口/参数时改动）
- `plugin/scripts/start-drivers.ts`（常驻 serve 的既有拉起路径：核合并后端口/生命周期不撞）
- `packages/quay/test/server-status-web-control-same-pid.test.mjs` (new)（正面 + 负控制 + 双活面）
- `plugin/test/start-drivers.test.mjs`（回归）
- `tasks/gap-ac251-unified-server-web-control-same-process.md`（自身文件：勾 AC + 贴实跑证据）

## AC

- [ ] AC1: 在统一 server 已启动的工作区，逐字跑 `goals/AC-251-web-与-control-合入同一进程-quay-server-status-json-报告二者-pid-相同-spe.md` 的 criterion ⇒ **exit 0**（立案当轮实测 exit 1：无 `server` 子命令）。判据同时要求 `services[]` 的 `web` 与 `control` 都是整数 `pid` 且相等。
- [ ] AC2: **负控制（AC1 能取假）**：停掉该统一 server 后重跑 AC1 同一条命令 ⇒ **exit ≠ 0 且 ≠ 3**（「没有 server 在跑」必须落在「未达成」，不落在「未评估」）；重新启动 ⇒ 复绿。两条读数都贴进结果段。
- [ ] AC3: **结构控制（防载体自报假 pid）**：`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<web port>/health` = `200`；对 `<control port>` 发一条 JSON-RPC（`initialize` 或未注册方法探针）⇒ 拿到 JSON-RPC 形态响应（非连接拒绝/超时）；`ps -p <status 报出的 pid> -o args=` 输出即统一 server 入口。三读数与 `status --json` 报出的 pid 一致 ⇒ exit 0。
- [ ] AC4: **零回退**：`node --test packages/quay/test/serve-*.test.mjs`（web 路由既有测试）⇒ 全绿；`node --test plugin/test/start-drivers.test.mjs`、`node --test plugin/test/driver-cli.test.mjs` ⇒ 全绿。⛔ 不实跑 `quay driver stop`（会停生产 driver）。
- [ ] AC5: **载体 workspace 相对且不进版本库**：同一 CLI 在 ①主检出 ②任务 worktree 两个 cwd 下各起一次统一 server，`server status --json` 各自读到**本 workspace** 的载体（两次报出的 pid 不同、且各自等于本 workspace 启动的那个进程）⇒ 两读数都 exit 0；`git ls-files .quay/server.json` 为空（未跟踪）；本任务落地提交不含该路径。
- [ ] AC6: **生产载体真跑过（硬规则 4 推论三）**：主检出的常驻统一 server 起来之后，在 repo root（⛔ 不是测试夹具、⛔ 不是内嵌端口 0 的测试进程）逐字跑 AC-251 的 criterion ⇒ exit 0，且该读数时刻晚于本任务实现落地时刻。

## DoD

**真 landed 的判据是一个真的统一进程在跑，不是「有测试绿了」**：本工作区主检出的常驻 server 入口本身就是统一入口，它的 pid 同时是 `quay server status --json` 报出的 `web.pid` 与 `control.pid`，且两个面的独立探针（HTTP `/health` + 控制面 JSON-RPC）在**同一个 pid** 上都有活响应；在这个状态上 AC-251 的 criterion 逐字 exit 0，杀掉该进程则转非 0（AC2 读数在场）。

⛔ 不接受的替代物：只在测试夹具里起过 server；`status` 由 CLI 自己合成一对 pid；`status` 找不到 server 就打印自己进程的 pid；控制面在 `packages/quay/src` 下的第二份实现；只把子命令加上而 web/control 仍分属两个进程。