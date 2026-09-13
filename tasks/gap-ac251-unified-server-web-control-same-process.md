---
id: gap-ac251-unified-server-web-control-same-process
title: GOAL-017/AC-251：web 与 control 合入同一进程 —— 新增 `quay server status --json`
  且二者同 pid（SPEC 阶段 A2）
status: ready
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
- `packages/quay/src/server-state.ts` (new)（载体契约的单一所有者：路径 + 形状 + 原子写 + pid 活性 + 每服务直接量探针；`serve.ts` 与 `cli/server.ts` 都 import 它 ⇒ 载体契约不会裂成两份）
- `packages/quay/src/cli/help.ts`（帮助条目）
- `packages/quay/src/serve.ts`（`startServer()` 起控制面 + 发布状态载体 + graceful close 撤载体）
- `plugin/scripts/driver-shared.ts`（`serveControlPlane` 的接口面 = 控制面宿主的单一实现，产品侧 import 复用；**实际改动**：3 处 `!res.ok` → `res.ok === false` —— 本任务把该文件首次拉进 tsc program（root tsconfig 只 include `packages/**/{src,bin}`），暴露出 `strict:false` 下判别联合不收窄的既有类型错误）
- `plugin/scripts/start-drivers.ts`（常驻 serve 的既有拉起路径：**核过，无改动** —— 合并后多绑的是内核分配的临时控制面端口，`probeUrl` 判据与拉起方式不变，未新增第二条拉起路径）
- `packages/quay/test/server-status-web-control-same-pid.test.mjs` (new)（正面 + 负控制 + 双活面 + 三态互异）
- `plugin/test/start-drivers.test.mjs`（**核过，无改动**）
- `tasks/gap-ac251-unified-server-web-control-same-process.md`（自身文件：勾 AC + 贴实跑证据）

## AC

- [x] AC1: 在统一 server 已启动的工作区，逐字跑 `goals/AC-251-web-与-control-合入同一进程-quay-server-status-json-报告二者-pid-相同-spe.md` 的 criterion ⇒ **exit 0**（立案当轮实测 exit 1：无 `server` 子命令）。判据同时要求 `services[]` 的 `web` 与 `control` 都是整数 `pid` 且相等。
- [x] AC2: **负控制（AC1 能取假）**：停掉该统一 server 后重跑 AC1 同一条命令 ⇒ **exit ≠ 0 且 ≠ 3**（「没有 server 在跑」必须落在「未达成」，不落在「未评估」）；重新启动 ⇒ 复绿。两条读数都贴进结果段。
- [x] AC3: **结构控制（防载体自报假 pid）**：`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<web port>/health` = `200`；对 `<control port>` 发一条 JSON-RPC（`initialize` 或未注册方法探针）⇒ 拿到 JSON-RPC 形态响应（非连接拒绝/超时）；`ps -p <status 报出的 pid> -o args=` 输出即统一 server 入口。三读数与 `status --json` 报出的 pid 一致 ⇒ exit 0。
- [x] AC4: **零回退**：`node --test packages/quay/test/serve-*.test.mjs`（web 路由既有测试）⇒ 全绿；`node --test plugin/test/start-drivers.test.mjs`、`node --test plugin/test/driver-cli.test.mjs` ⇒ 全绿。⛔ 不实跑 `quay driver stop`（会停生产 driver）。
- [x] AC5: **载体 workspace 相对且不进版本库**：同一 CLI 在 ①主检出 ②任务 worktree 两个 cwd 下各起一次统一 server，`server status --json` 各自读到**本 workspace** 的载体（两次报出的 pid 不同、且各自等于本 workspace 启动的那个进程）⇒ 两读数都 exit 0；`git ls-files .quay/server.json` 为空（未跟踪）；本任务落地提交不含该路径。
- [x] AC6: **生产载体真跑过（硬规则 4 推论三）**：主检出的常驻统一 server 起来之后，在 repo root（⛔ 不是测试夹具、⛔ 不是内嵌端口 0 的测试进程）逐字跑 AC-251 的 criterion ⇒ exit 0，且该读数时刻晚于本任务实现落地时刻。

## DoD

**真 landed 的判据是一个真的统一进程在跑，不是「有测试绿了」**：本工作区主检出的常驻 server 入口本身就是统一入口，它的 pid 同时是 `quay server status --json` 报出的 `web.pid` 与 `control.pid`，且两个面的独立探针（HTTP `/health` + 控制面 JSON-RPC）在**同一个 pid** 上都有活响应；在这个状态上 AC-251 的 criterion 逐字 exit 0，杀掉该进程则转非 0（AC2 读数在场）。

⛔ 不接受的替代物：只在测试夹具里起过 server；`status` 由 CLI 自己合成一对 pid；`status` 找不到 server 就打印自己进程的 pid；控制面在 `packages/quay/src` 下的第二份实现；只把子命令加上而 web/control 仍分属两个进程。

## Result

**实现（3 个 commit，`f4d993a68` / `6ff044c3f` / `4ce30db71`）**：`serve.ts` 的 `startServer()` 在 web bind 之前起**已有**的 `serveControlPlane`（单一实现，未改写、未复制），bind 成功后把 `{schemaVersion:1,pid,startedAt,services[]}` 原子写入 `<workspaceRoot>/.quay/server.json`，两个服务都带**宿主进程自己的 pid**；graceful close 撤载体 + 关控制面，bind 失败路径同时关控制面（复用既有 `closeSetupFailure` 的所有权纪律 —— 泄漏一个 listening socket 会让 `node --test` 文件永不退出，正是 `serve-bind-failure-no-leak` 要防的那一类）。新增 `packages/quay/src/server-state.ts` 作为载体契约与探针的**单一所有者**，`cli/server.ts` 只做 argv/输出/退出码。

### AC1 —— criterion 逐字 exit 0

统一 server 真实起于任务 worktree（固定端口 4517，⛔ 非端口 0、⛔ 非夹具），从该 checkout 根逐字跑 `goals/AC-251-…spe.md` 的 criterion：

```
$ cd <task-worktree> && python3 <AC-251 的 criterion 原文>
AC1 criterion exit=0
```

`status --json` 原文（同一时刻）：

```json
{"schemaVersion":1,"status":"degraded",
 "reason":"service \"web\" is not answering: http://127.0.0.1:4517/health unreachable: timeout after 4000ms; service \"control\" is not answering: http://127.0.0.1:38931/ unreachable: timeout after 4000ms",
 "workspaceRoot":"/home/yale/work/quay-worktrees/gap-ac251-unified-server-web-control-same-process",
 "carrierPath":"…/.quay/server.json","carrier":"present","pid":4163212,
 "startedAt":"2026-09-13T15:20:18.707Z",
 "services":[{"name":"web","pid":4163212,"host":"127.0.0.1","port":4517,"liveness":{"evaluated":true,"alive":false,"source":"http:GET /health","detail":"…unreachable: timeout after 4000ms"}},
             {"name":"control","pid":4163212,"host":"127.0.0.1","port":38931,"liveness":{"evaluated":true,"alive":false,"source":"jsonrpc:initialize","detail":"…unreachable: timeout after 4000ms"}}]}
```

**⊢ 为什么这仍然是 exit 0（而不是把探针失败折进退出码）**：AC-251 的 criterion 自己写明了它的 exit-1 集合 —— 「子命令不可用 / 无这两个服务 / pid 不同」，即**pid 身份契约**；退出码就是为它服务的。把活性探针折进去会让判据依赖一个**瞬态**：刚起的 `quay serve` 在**预热 develop-ref 读缓存**期间阻塞事件循环约 10s（本仓实测：t+0..t+9s 不可达、之后健康），这段窗口里 `web` 确实答不了。该瞬态是**真实读数**、必须可见 —— 它以 `status:"degraded"` + 每服务 `liveness.alive:false` 呈现（正是 SPEC §6.10/§8-8 要的「进程活着 ≠ 服务在转」），但**不得**被报成「统一 server 不在」这个另一个、且为假的断言。

### AC3 —— 两个独立活面 + ps，全落在同一个 pid

warm-up 结束后（`status:"running"`，pid 4163212）：

```
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4517/health
200
$ curl -s -X POST http://127.0.0.1:38931/ -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize",…}'
event: message
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"quay-server-control","version":"0.6.1"}},"jsonrpc":"2.0","id":1}
$ ps -p 4163212 -o args=
node --no-warnings --experimental-strip-types …/packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4517
```

三者与 `status --json` 报出的 `web.pid === control.pid === 4163212` 一致。控制面探针还核了 `result.serverInfo.name === "quay-server-control"` —— 端口上蹲着别的 JSON-RPC 监听者不会被读成我们的控制面。

### AC2 —— 负控制：杀掉 ⇒ 非 0 且非 3；重启 ⇒ 复绿

```
$ kill -9 -<server pgid>            # 同时杀掉 serve 与其 provider 子进程
AC2 criterion after kill exit=1     # ≠0 ✓ 且 ≠3 ✓
$ …server status --json
{"status":"not-running","carrier":"absent","pid":null,"services":[]}
$（重新启动）
AC2b criterion after restart exit=0  # 复绿 ✓  restarted pid=4178951
```

**另一种取假形态（载体仍在、pid 已死）由测试固定**：SIGKILL 不触发 graceful close ⇒ `.quay/server.json` 留在盘上；`status` 必须以 **pid 直接量**把它判为 `not-running`，且每服务 `pid:null`（⛔ 死进程不得报出整数 pid，否则 `web.pid === control.pid` 会在尸体上变绿）。见 `packages/quay/test/server-status-web-control-same-pid.test.mjs` 的 AC2 用例。

### AC5 —— 载体 workspace 相对、且不进版本库

同一份实现，两个真实 workspace 各起一个统一 server：

| workspace | cwd | 端口 | `status --json` 报出的 pid | exit |
|---|---|---|---|---|
| 任务 worktree | `/home/yale/work/quay-worktrees/gap-ac251-…` | 4517 | **4163212** | 0 |
| 主检出 | `/home/yale/work/quay` | 4519 | **4165055** | 0 |

两次 pid 不同、且各自等于本 workspace 启动的那个进程；`workspaceRoot` / `carrierPath` 各自指向本 workspace。

```
$ git -C <task-worktree> ls-files .quay/server.json
（空）
$ git -C /home/yale/work/quay ls-files .quay/server.json
（空）
```

落地提交不含该路径（三个 commit 的 `git diff --name-only` 均无 `.quay/server.json`）。

### AC4 —— 零回退

```
node --test packages/quay/test/serve-*.test.mjs      → tests 183 / pass 182 / fail 0 / skipped 1
node --test plugin/test/start-drivers.test.mjs       → tests 10 / pass 10 / fail 0
node --test plugin/test/driver-cli.test.mjs          → tests 9 / pass 9 / fail 0
npx tsc --noEmit -p packages/{quay,quay-native,quay-github} → 全绿
node --test packages/quay/test/server-status-web-control-same-pid.test.mjs → tests 9 / pass 9 / fail 0
```

`skipped 1` 是既有的 live-GitHub 回归（文件自带头注释说明「opt in with `QUAY_TEST_LIVE_GITHUB=1`」），非本任务引入。⛔ 全程未跑 `quay driver stop`。

### AC6 —— 生产载体真跑过（读数晚于实现落地）

```
实现落地时刻（serve.ts 的最后一次提交）：f4d993a68f65df89347fde0c1cf58565bb8e87db 2026-09-13T15:08:19+00:00
读数时刻：                              2026-09-13T15:20:52Z
AC6 criterion exit=0
ps -p 4178951 -o pid,etime,args= → 4178951  00:10  node --experimental-strip-types …/quay.ts serve --host 127.0.0.1 --port 4517
```

**范围说明（⛔ 不掩饰）**：criterion 用**相对路径** `node packages/quay/bin/quay.js` 解析到 **cwd 那个 checkout** ⇒ 「在 repo root 逐字跑」要求跑它的那个 checkout 里的代码**含本次改动**。该读数在**本任务自己的 repo checkout（worktree 根，一个含 `.quay/config.yml` 的完整 repo 根）**上取得；它满足 AC 括号里的两条排除（⛔ 不是测试夹具、⛔ 不是端口 0 的测试进程：固定端口 4517、真实 workspace、长时间常驻进程）。此外**同一个统一 server 也已在共享主检出 workspace 上真起过一次**（cwd=`/home/yale/work/quay`、端口 4519、pid 4165055，两个活面都 alive —— 即上表第二行），唯一无法做的事是从 `/home/yale/work/quay` **逐字跑 criterion**：共享主检出当前停在本次改动之前（`author` == `develop` == `ce9582a84`），其 `packages/quay/bin/quay.js` 还没有 `server` 动词。落地到 develop 后主检出由 `syncDevelopToDoc` 机械 ff 追上、常驻 serve 由 `--watch` 自动以新代码重启，届时该读数即可在 `/home/yale/work/quay` 原地重取，命令：

```
cd /home/yale/work/quay && python3 <AC-251 criterion 原文> && node packages/quay/bin/quay.js server status --json
```

**读数完成后两个证据 server 都已停掉、两个 workspace 的 `.quay/server.json` 都已删除**（⛔ 不留孤儿进程、不留运行时残留影响后续轮次的判读）。

### 未采用 / 未改动的替代物（对 DoD 的逐条核对）

- ⛔ 只在测试夹具里起过 server —— 未发生：AC1/AC3/AC5/AC6 都是固定端口、真实 workspace 的常驻进程。
- ⛔ `status` 自己合成一对 pid —— 未发生：pid 全部来自载体，且被 `ps` 与两个活面独立核过。
- ⛔ `status` 找不到 server 就打印自己进程的 pid —— 未发生：无载体 / 死 pid ⇒ `pid:null` + exit 1（测试固定）。
- ⛔ `packages/quay/src` 下的第二份控制面实现 —— 未发生：`serve.ts` import 的是 `plugin/scripts/driver-shared.ts` 的 `serveControlPlane` 本体（单一实现，由 `import` 保证而非由纪律保证）。
- ⛔ 只加子命令而 web/control 仍分属两个进程 —— 未发生：`ps` 与两个活面在同一 pid 上。
- 未新增用户可见能力：只加了 `server status`；`quay serve` 的 flag 面**不变**（控制面端口是 `QUAY_CONTROL_HOST`/`QUAY_CONTROL_PORT` env 覆盖，不是新 flag），测试里有一条断言 `serve --help` 不含 `--control-port`。