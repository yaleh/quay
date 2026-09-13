---
id: gap-ac252-control-plane-hoist-to-layer0
title: GOAL-017/AC-252：控制面上收进 Layer 0 —— serveControlPlane 调用点由 worker-driver 移入
  driver-runtime，六个 kind 全部从共享骨架获得入站控制面（SPEC 阶段 A1）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-252
---
## Proposal

**AC-252 现状（立案当轮实测，取假形态）**：控制面 `serveControlPlane` 早在 `driver-shared.ts:283` 实现（AC150-3），但 Layer 0（`driver-runtime.ts`）**零调用点**，且六个 kind 里只有 worker 一处调用。逐字跑 AC-252 的 criterion：

```
$ python3 <AC-252 的 criterion 原文>
AC-252: driver-runtime.ts (Layer 0) has 0 serveControlPlane call site(s) => control plane NOT hoisted; every kind does not get it
exit=1
```

按【位置判定】的逐文件计数（只数非注释行的调用点，⛔ 不数关键词出现次数）：

```
promotion-driver.ts      0
worker-driver.ts         1   （:5375，`--serve` 分支体内）
outer-driver.ts          0
quality-gate-driver.ts   0
meta-driver.ts           0
goal-driver.ts           0
driver-runtime.ts        0   （:73 / :98 两处是 re-export 列表里的 `serveControlPlane,`，不是调用）
driver-shared.ts         1   （:283 定义）
```

⇒ AC 今天**结构上必然取假**，与 AC 记录 origin 一致。

**与 AC 记录的一处漂移（以实测为准）**：AC 记录的 origin/expect 写 `worker-driver.ts:4955`，实测唯一调用点在 **`:5375`**（`--serve` 分支内；识别特征是 `const handle = await serveControlPlane({ root: rootDir, host, port, name: "worker-driver-control" });`）。行号漂移不影响判据本身（判据按位置数调用点、不按行号），但**它正是硬规则 2「引用一个计数之前先打印命中」的实例**：记录里的是旧读数，直接照抄会写出一个查不到的位置。

**为什么这是 SPEC 阶段 A1、不是新功能**：`orchestration/SPEC-unified-quay-server-2026-09-13.md` §7 的 A1 行写明「`serveControlPlane` 由 worker-driver 上收进 Layer 0，**六个 kind 全部获得控制面**；已有实现在 `driver-shared.ts:283`，只是仅 `worker-driver.ts` 一处调用」⇒ **这是合并已有实现，不是新建**（裁定原则①）。SPEC §2.2 的进程图也把「MCP over HTTP 控制面 halt/preference/forceDispatch」画在 Layer 0 那一格里（与 supervisor · loop · trigger · stopCondition 同层），而 `driver-runtime.ts` 的头注释（`:14`）已经把 `controlPlane MCP（halt/preference/forceDispatch，⛔ 非 worker 私产）` 列为 Layer 0 的一项。

**比机器判据更严的一层（本任务按 SPEC 的意图做，⛔ 不按判据的最小满足做）**：AC-252 的判据只数两个文件的调用点。把 worker 那一行挪进 `driver-runtime.ts` 的**某个私有分支**就能让判据 exit 0，而另外五个 kind 仍然拿不到控制面 —— 判据绿而意图未达成。⇒ 本任务自加 **AC2（六 kind 各自可达 + 结构断言）** 与 **AC3（逐 kind 负控制：halt 只停该 kind）**，与 SPEC A1 判据列「六个 kind 的控制面各自可达；逐个负控制：对该 kind 发 halt 后它判停」逐字对齐。⛔ AC2/AC3 不是可选加强项，是这条任务的实际目标。

**halt 语义六个 kind 全部已在位，缺的只是「送达通道」**（立案当轮逐文件实测）：每个 kind 的循环都已消费自己的控制态文件 —— `promotion-driver.ts:702`、`outer-driver.ts:427`、`quality-gate-driver.ts:1057`（meta 经 `runResidentQualityGateLoop` 传入 `META_CONTROL_STATE_REL`，`meta-driver.ts:2535`）、`goal-driver.ts:2378`、`worker-driver.ts:4908`（走 Layer 0 的 `makeStopCondition`，`driver-runtime.ts:554`；`isHalted` 在 `:562` 读 `statePaths(root, kind).controlFile`）。⇒ 本任务**不新建判停语义**，只把入站控制面接上。

**关键约束（`meta-driver.ts:2394` 的注释已经点出）**：「控制态文件（与 quality 分开——⛔ 共用会让一个 kind 的 halt 误停另一个）」。`serveControlPlane` 的 `rel` 参数**缺省是 worker 的 `CONTROL_STATE_REL`**（`driver-shared.ts:283-295`）⇒ 上收时若按缺省调用，halting kind X 会写进 worker 的控制态文件 —— 一个「看起来控制面通了、实际停错了 kind」的恒假读数（硬规则 3b 同形：读不懂输入却返回与合格同形的值）。

**`--serve` 今天在生产上从未被拉起（实测）**：`--serve` 只在 `worker-driver.ts:5301` 解析、`:5325` 帮助、`:5375` 消费；而 supervisor 组装 driver argv 的**单一构造点** `driverArgvForKind`（`driver-runtime.ts:526`）**不传它**，全仓无任何生产调用者给 worker-driver 传 `--serve`（grep 命中的 `--serve-timeout` 属 `start-drivers.ts` 的 web serve 探针，同名不同物）。⇒ **连 worker 这个「有调用点」的 kind，在生产上也没有活的控制面**；这一条本身就是「AC 的判据形态与生产形态脱节」的实证，也是本任务必须做到 AC6（生产载体真跑过）的理由。

**范围边界（⛔ 不越界）**：本任务只做 A1 的「上收 + 六 kind 可达」。⛔ 不做 A2（web+control 合入同一进程，属 `gap-ac251-unified-server-web-control-same-process`）、⛔ 不做阶段 B/C（服务化启停 / driver 内收）。不改变 driver 的判定语义（SPEC §7：本 GOAL 只动进程边界与接口面，不动派发/判停/归因逻辑）。⛔ 实现与验证期间**不得实跑 `quay driver stop`**（会停掉生产 driver）；负控制一律在**独立一次性 driver**（测试缝 / 临时 root）上做，不是在跑的生产进程上做。

<!-- dedup-ref -->
**关联（仅登记，本任务不被它们收窄）**：`gap-ac150-promotion-driver-resource-gate-control-plane`（done）= 把 `serveControlPlane` 实现抽到 `driver-shared.ts` 并让 promotion 也读控制态，落的是**实现**与**消费侧**，不是**调用点位置**；`gap-ac251-unified-server-web-control-same-process`（ready）= 在 `packages/quay/src/serve.ts` 里增加控制面调用点（产品侧合进程），与本任务的 `driver-runtime.ts` 上收是不同的机制与不同的文件面，两者交集只有「都叫 serveControlPlane」；`gap-driver-drain-no-inverse`（done）= drain 无逆操作的表层通道缺口，改的是 CLI 动词面。三者 Touches 与本任务不相交。

## Plan

1. **Layer 0 落下唯一的控制面宿主**：在 `driver-runtime.ts` 新增导出（名可改，下称 `serveKindControlPlane(kind, root, opts)`），函数体是**本仓库唯一**的 `serveControlPlane` 调用点，且**必须按 kind 传 `rel`**（= `statePaths(root, kind).controlFile` 的相对路径）与按 kind 的 `name`（如 `${spec.prefix}-control`）。⛔ 不得回落 `driver-shared.ts` 的缺省 `rel`（那是 worker 的）——见 Proposal 末段的关键约束。`serveControlPlane` 的实现仍只在 `driver-shared.ts` 一份，⛔ 不复制第二份 MCP 控制面（SPEC §8 判据 1 的同族形态：出现第二份并行实现即未达成）。

2. **让六个 kind 都从共享骨架拿到它（结构保证，⛔ 不是逐一记得调用）**：在两条候选路径中选一条并**把理由写进结果段**——
   (a) **由 Layer 0 的宿主机件统一起服**：六个 kind 都经 `runSupervisor`（`driver-runtime.ts:1151`，registry 表驱动）拉起，让控制面在 Layer 0 的这一侧起，则新增 kind 只改 `DRIVER_KINDS` 一行即自动获得；
   (b) **六个 kind 的 resident loop 各调一次 Layer 0 的宿主函数**：`runResidentPromotionLoop` / `runResidentLoop` / `runResidentOuterLoop` / `runResidentQualityGateLoop` / meta 与 goal 的 `main` 各调一次。
   判据（两条路径都要满足）：**新 kind 加进 `DRIVER_KINDS` 时不需要改任何 kind 文件就能获得控制面** —— 结构保证而不是「记得加一行」（硬规则 9：一条规则若「守」与「不守」在记录上无法区分，它就只能靠意志）。⛔ 无论选哪条，`driver-runtime.ts` 必须是**唯一**持有 `serveControlPlane` 调用点的地方。

3. **拆掉 worker 的自带调用点**：删除 `worker-driver.ts:5373-5384` 的 `--serve` 分支体（`serveControlPlane` 直调 + SIGINT/SIGTERM 处理），改由第 1/2 步的共享骨架承载。`--serve` 这个 flag 的**去留要显式决定并写下**：保留则降为纯 argv 透传（由 Layer 0 消费），删除则同步 `:5301` 解析与 `:5325` 帮助两处。⛔ 不得留下「解析了但没人消费」的死 flag（硬规则 3b：读不懂输入却返回合格形）。

4. **端口与生命周期**：六个 kind 各起一个控制面 ⇒ 端口必须不撞。`serveControlPlane` 支持 `port`（`driver-shared.ts:283` 的 opts），**取假形态**：写死固定端口必然六 kind 互撞。做法：每 kind 传 `port: 0` 由内核分配、把**实际端口**（`ControlPlaneHandle.port`）回写进该 kind 的可观测面（supervisor 日志一行，或 `statePaths` 同族的一个运行时字段），使 AC2 可回读。控制面的生命周期随宿主进程（⛔ 不留孤儿 listener；进程退出即释放，与 `driver-runtime.ts` 现有 stop sentinel 路径一致）。

5. **零回退**：`node --test plugin/test/driver-runtime.test.mjs`（`:196` 断言 `worker.serveControlPlane` 是 function —— re-export 面不得断）、`plugin/test/worker-driver.test.mjs`、`worker-driver-resident.test.mjs`、`worker-driver-fan-in.test.mjs` 全绿；`packages/quay/test/serve-*.test.mjs` 不受影响（本任务不碰 `packages/`）。⛔ 不实跑 `quay driver stop`。

6. **取假控制**：见 AC2（六端口互不相同 + 结构断言）、AC3（halt 只停该 kind，其余控制态文件 sha256 不变）、AC4（判停真被消费）。核心是「该 kind 的 halt 只停该 kind」这一条能**取假**：若 `rel` 传错，AC3 的 sha256 对比会立刻抓出来。

7. **真落地（生产载体，非夹具）**：主检出的六个 kind 常驻 driver 在跑时，逐 kind 经其控制面发 `halt`（随后 `halted:false` 复原），把 ① 逐 kind 控制面 URL/端口 ② 该 kind 控制态文件的前后读数 ③ 其余 kind 控制态文件未变的读数（sha256）贴进结果段；再在同一时刻逐字跑 AC-252 的 criterion ⇒ exit 0。

## Touches

- `plugin/scripts/driver-runtime.ts`（Layer 0 唯一控制面宿主；`driverArgvForKind` / registry 表若需传端口或 flag 也在本文件）
- `plugin/scripts/worker-driver.ts`（删掉 `:5373-5384` 自带调用点；`:5301` 解析 / `:5325` 帮助按第 3 步裁定同步）
- `plugin/scripts/driver-shared.ts`（仅在需暴露参数面时改动；`serveControlPlane` 实现保持单一）
- `plugin/scripts/promotion-driver.ts`（仅当第 2 步选路径 (b)：调一次 Layer 0 宿主；⛔ 不得直调 `serveControlPlane`）
- `plugin/scripts/outer-driver.ts`（同上，路径 (b) 时）
- `plugin/scripts/quality-gate-driver.ts`（同上，路径 (b) 时）
- `plugin/scripts/meta-driver.ts`（同上，路径 (b) 时）
- `plugin/scripts/goal-driver.ts`（同上，路径 (b) 时）
- `plugin/test/driver-runtime-control-plane.test.mjs` (new)（宿主函数单测 + 逐 kind `rel` 断言 + 「新 kind 不改 kind 文件即获得控制面」的结构断言 + 端口互不相同）
- `plugin/test/worker-driver.test.mjs`（回归：`--serve` 路径变化不转红）
- `plugin/test/driver-runtime.test.mjs`（回归：re-export 面不变）
- `tasks/gap-ac252-control-plane-hoist-to-layer0.md`（自身文件：勾 AC + 贴实跑证据）

## AC

- [ ] AC1: 在 repo root 逐字跑 `goals/AC-252-控制面上收进-layer-0-六个-kind-全部从共享骨架获得入站控制-spec-阶段-a1.md` 的 criterion ⇒ **exit 0**（立案当轮实测 exit 1，报 `driver-runtime.ts (Layer 0) has 0 serveControlPlane call site(s)`）。判据同时要求 `worker-driver.ts` 非注释调用点数 = 0；两条读数（改前 / 改后）都贴进结果段。
- [ ] AC2: **六个 kind 各自可达（结构控制，⛔ 不是逐一手工接线）**：`serveKindControlPlane`（或等价命名）是 `driver-runtime.ts` 的导出；在带完整 `DRIVER_KINDS` 条目的临时 root 上，六个 kind 的宿主各起一次，`port:0` 回读实际端口 ⇒ 六次都拿到非零端口且**互不相同**（六个数贴进结果段）；且**结构断言**：`DRIVER_KINDS` 里加一个假 kind 条目（仅测试内内存构造）后宿主仍为它工作、**未改任何 kind 文件**（⚠️ 若第 2 步选路径 (a)，此断言换成等价形态并写明理由）。
- [ ] AC3: **逐 kind 负控制（halt 只停该 kind，⛔ 不手改 JSON）**：对六个 kind 各发一次 `halt`（经其控制面，带身份 `caller`）⇒ ① 该 kind 的控制态文件 `halted:true` 且 `halted_by` 为发出的身份；② **其余五个 kind 的控制态文件 sha256 前后逐字相同**；③ 逐 kind 复原（`halted:false`）后复归原状。六组前后读数都贴进结果段。这一条是 `rel` 传错（缺省 = worker 的）的唯一机械检出。
- [ ] AC4: **判停真被消费（⛔ 不停生产进程）**：在**独立一次性 driver**（测试缝 / 临时 root 起的该 kind 进程，⛔ 不是生产 driver）上，halt 前该 kind 的 round 记录持续推进、halt 后其下一轮 `stop_reason` 为 `mcp-halt`（Layer 0 `makeStopCondition` 的既有判词，`driver-runtime.ts:554`）⇒ 前后两条记录贴进结果段。若某 kind 的循环结构上无法在测试缝里安全起，写下**是哪个 kind 与为什么**，该 kind 以 AC3 的控制态读数替代并**显式登记为残留**，⛔ 不静默跳过（硬规则 3b：不得让「无法评估」与「合格」同形）。
- [ ] AC5: **零回退**：`node --test plugin/test/driver-runtime.test.mjs`、`plugin/test/worker-driver.test.mjs`、`plugin/test/worker-driver-resident.test.mjs`、`plugin/test/worker-driver-fan-in.test.mjs` 全绿；`node --test packages/quay/test/serve-*.test.mjs` 全绿。⛔ 不实跑 `quay driver stop`（会停生产 driver）。
- [ ] AC6: **生产载体真跑过（硬规则 4 推论三）**：主检出六个 kind 的常驻 driver 在跑时，逐 kind 经其控制面发 halt/复原（AC3 的读数），且该读数时刻**晚于本任务实现落地时刻**；`AC-252` 的 criterion 在同一时刻逐字 exit 0。⛔ 只在测试夹具里起过不算（「只能被 fixture 满足的判据不是测量」）。

## DoD

**真 landed 的判据是「六个 kind 的入站控制面都在跑，且一个 kind 的 halt 不误停另一个」，不是「判据 exit 0」**：`driver-runtime.ts` 是仓库里**唯一**持有 `serveControlPlane` 调用点的地方；六个 kind 各自的控制面各自可达（AC2 的六端口读数）；对任一个 kind 发 halt，只有它自己的控制态文件变（AC3 的 sha256 前后读数在场）、且它自己的下一轮判停报 `mcp-halt`（AC4）；`worker-driver.ts` 不再自带调用点（AC1）。在**这个状态上** AC-252 的 criterion 逐字 exit 0，把 Layer 0 的调用点注释掉则转 exit 1（负控制，两读数都贴）。

⛔ 不接受的替代物：只把 worker 的调用挪进 `driver-runtime.ts` 的私有分支而另外五个 kind 仍不可达；六个 kind 各自直调 `serveControlPlane`（那是六份调用点，不是「从共享骨架获得」）；控制面按缺省 `rel` 起（halting 一个 kind 误写另一个的控制态文件）；端口写死导致六 kind 互撞；把 `--serve` 留成解析了但没人消费的死 flag；只在测试夹具里起过控制面而生产上从未跑过。
