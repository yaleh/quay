---
id: gap-ac252-control-plane-hoist-to-layer0
title: GOAL-017/AC-252：控制面上收进 Layer 0 —— serveControlPlane 调用点由 worker-driver 移入
  driver-runtime，六个 kind 全部从共享骨架获得入站控制面（SPEC 阶段 A1）
status: done
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

- [x] AC1: 在 repo root 逐字跑 `goals/AC-252-控制面上收进-layer-0-六个-kind-全部从共享骨架获得入站控制-spec-阶段-a1.md` 的 criterion ⇒ **exit 0**（立案当轮实测 exit 1，报 `driver-runtime.ts (Layer 0) has 0 serveControlPlane call site(s)`）。判据同时要求 `worker-driver.ts` 非注释调用点数 = 0；两条读数（改前 / 改后）都贴进结果段。
- [x] AC2: **六个 kind 各自可达（结构控制，⛔ 不是逐一手工接线）**：`serveKindControlPlane`（或等价命名）是 `driver-runtime.ts` 的导出；在带完整 `DRIVER_KINDS` 条目的临时 root 上，六个 kind 的宿主各起一次，`port:0` 回读实际端口 ⇒ 六次都拿到非零端口且**互不相同**（六个数贴进结果段）；且**结构断言**：`DRIVER_KINDS` 里加一个假 kind 条目（仅测试内内存构造）后宿主仍为它工作、**未改任何 kind 文件**（⚠️ 若第 2 步选路径 (a)，此断言换成等价形态并写明理由）。
- [x] AC3: **逐 kind 负控制（halt 只停该 kind，⛔ 不手改 JSON）**：对六个 kind 各发一次 `halt`（经其控制面，带身份 `caller`）⇒ ① 该 kind 的控制态文件 `halted:true` 且 `halted_by` 为发出的身份；② **其余五个 kind 的控制态文件 sha256 前后逐字相同**；③ 逐 kind 复原（`halted:false`）后复归原状。六组前后读数都贴进结果段。这一条是 `rel` 传错（缺省 = worker 的）的唯一机械检出。
- [x] AC4: **判停真被消费（⛔ 不停生产进程）**：在**独立一次性 driver**（测试缝 / 临时 root 起的该 kind 进程，⛔ 不是生产 driver）上，halt 前该 kind 的 round 记录持续推进、halt 后其下一轮 `stop_reason` 为 `mcp-halt`（Layer 0 `makeStopCondition` 的既有判词，`driver-runtime.ts:554`）⇒ 前后两条记录贴进结果段。若某 kind 的循环结构上无法在测试缝里安全起，写下**是哪个 kind 与为什么**，该 kind 以 AC3 的控制态读数替代并**显式登记为残留**，⛔ 不静默跳过（硬规则 3b：不得让「无法评估」与「合格」同形）。
- [x] AC5: **零回退**：`node --test plugin/test/driver-runtime.test.mjs`、`plugin/test/worker-driver.test.mjs`、`plugin/test/worker-driver-resident.test.mjs`、`plugin/test/worker-driver-fan-in.test.mjs` 全绿；`node --test packages/quay/test/serve-*.test.mjs` 全绿。⛔ 不实跑 `quay driver stop`（会停生产 driver）。
- [ ] AC6: **生产载体真跑过（硬规则 4 推论三）**：主检出六个 kind 的常驻 driver 在跑时，逐 kind 经其控制面发 halt/复原（AC3 的读数），且该读数时刻**晚于本任务实现落地时刻**；`AC-252` 的 criterion 在同一时刻逐字 exit 0。⛔ 只在测试夹具里起过不算（「只能被 fixture 满足的判据不是测量」）。 ⛔ 本任务未达成（原因与精确接手步骤见「结果」段的 AC6 残留） ——（待外部）

## DoD

**真 landed 的判据是「六个 kind 的入站控制面都在跑，且一个 kind 的 halt 不误停另一个」，不是「判据 exit 0」**：`driver-runtime.ts` 是仓库里**唯一**持有 `serveControlPlane` 调用点的地方；六个 kind 各自的控制面各自可达（AC2 的六端口读数）；对任一个 kind 发 halt，只有它自己的控制态文件变（AC3 的 sha256 前后读数在场）、且它自己的下一轮判停报 `mcp-halt`（AC4）；`worker-driver.ts` 不再自带调用点（AC1）。在**这个状态上** AC-252 的 criterion 逐字 exit 0，把 Layer 0 的调用点注释掉则转 exit 1（负控制，两读数都贴）。

⛔ 不接受的替代物：只把 worker 的调用挪进 `driver-runtime.ts` 的私有分支而另外五个 kind 仍不可达；六个 kind 各自直调 `serveControlPlane`（那是六份调用点，不是「从共享骨架获得」）；控制面按缺省 `rel` 起（halting 一个 kind 误写另一个的控制态文件）；端口写死导致六 kind 互撞；把 `--serve` 留成解析了但没人消费的死 flag；只在测试夹具里起过控制面而生产上从未跑过。

## Result

实现落在任务分支 `task/gap-ac252-control-plane-hoist-to-layer0`（实现提交 `36606d117`，pre-merge 提交 `80b778bd7`）。
改动面 = `plugin/scripts/driver-runtime.ts` + `plugin/scripts/worker-driver.ts` + `plugin/test/driver-runtime-control-plane.test.mjs`(new)。
Touches 里点名的 `driver-shared.ts` 与六个 kind 文件 **一个都没改**（Plan 第 2 步选路径 (a)，理由见下）。

### Plan 第 2 步的路径裁定：(a) 由 Layer 0 的 `runSupervisor` 统一起服
判据是「新 kind 加进 `DRIVER_KINDS` 时不需要改任何 kind 文件就能获得控制面」。只有 (a) 满足：六个 kind 全部经
`runSupervisor`（registry 表驱动）拉起，控制面在 Layer 0 这一侧起 ⇒ 加一行 registry 即自动获得。(b) 要在六个
kind 文件里各加一次调用，正是该判据排除的形态。实测佐证见 AC2 的结构断言（内存构造假 kind ⇒ 宿主自动为它工作，
且**未改任何 kind 文件**）。

实现要点（逐条对应 Plan）：
1. `serveKindControlPlane(kind, root, opts)` —— 仓库里**唯一**的 `serveControlPlane` 调用点（AC-252 的 criterion
   实测 rt_n=1 / wk_n=0）。`rel` 恒取 `path.posix.join(".quay", DRIVER_KINDS[kind].controlFile)`，⛔ 绝不回落
   `driver-shared.ts` 的缺省（那是 worker 的）；未知 kind **抛**（硬规则 3b：⛔ 不返回与「合格」同形的句柄）。
   `serveControlPlane` 的实现仍只在 `driver-shared.ts` 一份（⛔ 没有第二份 MCP 控制面）。
2. `runSupervisor` 起控制面（`port: 0` 由内核分配，⛔ 不写死）+ 写**结构化运行时回读面**
   `statePaths().controlPlaneFile` = `<root>/.quay/<prefix>-control-plane.json`（`{kind,url,port,pid,rel,at}`，
   `statePaths` 新增字段）+ supervisor 日志一行。SIGTERM/SIGINT 关闭并**摘掉回读面**（⛔ 不让「已停」与「在跑」同形）。
3. `worker-driver.ts` 删掉自带调用点与 `--serve`/`--host`/`--port` 三个 argv 入口 + 帮助行 + 头部 Run 段。
   `--serve` 的去留**显式裁定为【删除】**：控制面宿主已不在该 kind 的进程里，保留只会剩一个「解析了但没人消费」
   的死 flag（硬规则 3b）。re-export 面保留（`driver-runtime.test.mjs:196` 的 `worker.serveControlPlane` 断言不变）。

### AC1 读数（改前 / 改后 / 负控制）
criterion **不手抄**——经 `.quay/ac252-run-criterion.mjs` 从 `goals/AC-252-*.md` 的 frontmatter 取，用生产同一个
执行器 `runAcceptance({command, cwd})` 跑（⛔ 不自己拼 bash；AC 记录里的 `worker-driver.ts:4955` 已被实测证为旧读数，
手抄正是它警告的失效形态）。

改前（`git show develop:` 取原始两文件放临时 root，逐字跑）：
```
[AC-252 criterion] cwd=/tmp/ac252-baseline exit=1 ok=false reason=acceptance failed (exit 1) — AC-252: driver-runtime.ts
(Layer 0) has 0 serveControlPlane CALL site(s) with definitions excluded => control plane not hoisted; the five
non-worker kinds still get none
```
改后（worktree 内，同一脚本）：
```
[AC-252 criterion] cwd=/home/yale/work/quay-worktrees/gap-ac252-control-plane-hoist-to-layer0 exit=0 ok=true
reason=acceptance passed (exit 0)
```
DoD 负控制（把 Layer 0 那一行调用注释掉，其余一字不动，跑完即还原）：
```
[AC-252 criterion] ... exit=1 ... has 0 serveControlPlane CALL site(s) ...
```
还原后与备份 `diff` **逐字节一致**，再跑 ⇒ exit 0。⇒ 这条判据在本任务上**双向取假**，不是恒真判据。

第三个读数来自**生产侧同一个消费机件**（不经过我写的任何 helper）：`goal-store gate` 是 goal-driver / meta-driver
真用的那个入口（`packages/quay/src/goal-store.ts:2548`），它自己取 criterion、经同一个 `runAcceptance` 跑：
```
$ node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-252 --dry-run   # cwd = worktree
{ ... "verdict": "pass", "payload": { "reason": "acceptance passed (exit 0)" } }          exit=0
```
（`--dry-run` = 跑 criterion 但不写 GateEvent、不翻状态。）

### AC2 读数（六 kind 各自可达 + 结构断言）
宿主函数层（六个 kind 各 `port:0` 起一次，回读实际端口，六个数互不相同）：
```
promotion 33577 · worker 35457 · outer 41773 · quality 41485 · meta 43143 · goal 46175
```
生产路径层（六个 kind 各自的 **supervisor** 起一次，读各自的 `<prefix>-control-plane.json`，六个数互不相同）：
```
promotion 41597 · worker 33635 · outer 36871 · quality 38189 · meta 40351 · goal 39963
```
该测试同时断言 `cp.pid === supervisor 自己的 pid`（PROOF：控制面宿主在 Layer 0 进程里，⛔ 非 driver 私产）、
`cp.rel === DRIVER_KINDS[kind].controlFile`（逐 kind 自派生）、`cp.kind === kind`。
**结构断言**：`DRIVER_KINDS` 里**内存构造**一个假 kind（`ac252-fake-kind`）⇒ 宿主为它工作、落
`.quay/ac252-fake-control.json`，而 `.quay/worker-control.json` **不存在**（⛔ 未回落缺省 rel）；再把该条目的
`controlFile` 改名 ⇒ 落点跟着改（证明读的是 `DRIVER_KINDS`，不是第二张硬编码表）。未知 kind ⇒ 抛
`unknown driver kind`（fail-closed）。
⚠️ Plan 第 2 步选路径 (a) 时的「等价形态」：AC2 字面要求的「假 kind ⇒ 未改任何 kind 文件」在本实现下**直接成立**
（宿主是 registry 派生的纯函数，六个真 kind 文件本次一个都没改），故无需替换形态。

### AC3 读数（逐 kind 负控制，halt 只停该 kind）
预置六个 kind 的缺省控制态文件 ⇒ 对每个 kind 经**它自己的**控制面发 `halt{caller:"manager"}`：
```
promotion .quay/promotion-control.json  halted_sha256=6647387a84e5af6d  restored_sha256=51439d545c15246a
worker    .quay/worker-control.json     halted_sha256=cba7ec2e2efff9cb  restored_sha256=51439d545c15246a
outer     .quay/outer-control.json      halted_sha256=adf551eb1386f238  restored_sha256=51439d545c15246a
quality   .quay/quality-control.json    halted_sha256=d0698fea3d9b472c  restored_sha256=51439d545c15246a
meta      .quay/meta-control.json       halted_sha256=77c195e44e3e5126  restored_sha256=51439d545c15246a
goal      .quay/goal-control.json       halted_sha256=f40d4b94a28a947c  restored_sha256=51439d545c15246a
```
每一步都断言：① 目标文件 `halted:true` ∧ `halted_by:"manager"`；② **其余五个文件的 sha256 与操作前逐字相同**；
③ 复原（`halted:false`）后目标文件 sha256 **逐字节回到原值**。六个 `restored_sha256` 相同 = 同一份缺省态（正是
「复归原状」的读数），而六个 `halted_sha256` **互不相同**（各带自己的 `halted_at`）⇒ 对照确实在动，不是恒真比对。
**生产路径复跑**：经六个 **supervisor 的**控制面各 halt/复原一次，同样的「其余五个逐字不变」断言全绿。
⇒ 这是 `rel` 传错（回落缺省 = worker 的）的**唯一机械检出**：若传错，第 ① 步读到的是 worker 的文件，断言立刻取假。

### AC4 读数（判停真被消费）
独立一次性 worker driver（临时 root、测试缝、空池 ⇒ 零 LLM 零 worker）：
```
halt 前： round 1 action=stop stop_reason="pool-empty (no dispatchable candidate in the ready pool)"
         round 2 action=stop stop_reason="pool-empty (no dispatchable candidate in the ready pool)"
halt 后： round 4 action=stop stop_reason="mcp-halt (control state halted — no new dispatch; in-flight workers untouched)"
```
且 halt 后常驻循环退出（`mcp-halt` 是终态 latch）⇒ 判停被**真消费**，⛔ 不是只写了个文件。

**⚠️ AC4 的显式残留登记（⛔ 不静默跳过，硬规则 3b；AC4 逐字要求登记）**：端到端取到 `stop_reason=mcp-halt` 的只有
**worker** 一个 kind。另外五个 kind 的**判停消费侧**读的是同一族控制态文件（`promotion-driver.ts:702` /
`outer-driver.ts:427` / `quality-gate-driver.ts:1057`（meta 经 `runResidentQualityGateLoop`）/ `goal-driver.ts:2378`，
各自经 `isHalted(root, env, <KIND>_CONTROL_STATE_REL)`）——但把它们的常驻循环在单测里真跑起来会真跑 goal/meta 的
criterion 与 LLM 派发、promotion 会真 apply 到任务库，**结构上不安全**，故按 AC4 的要求以 **AC3 的控制态读数替代**
并显式登记为残留。残留面 = 「driver 循环消费」这一环只在 worker 上被直接观测到；控制面**送达侧**（六个 kind 各自的
控制面真实存在、写到各自文件、互不误停）由 AC2/AC3 **全量**覆盖。

### AC5 读数（零回退，均在本 worktree 实测）
```
plugin/test/driver-runtime.test.mjs                    tests 25  pass 25  fail 0
plugin/test/worker-driver.test.mjs                     tests 97  pass 97  fail 0
plugin/test/worker-driver-resident.test.mjs            tests 43  pass 43  fail 0
plugin/test/worker-driver-fan-in.test.mjs              tests 90  pass 90  fail 0
packages/quay/test/serve-*.test.mjs                    tests 183 pass 182 skipped 1 fail 0
plugin/test/driver-runtime-control-plane.test.mjs(new) tests 6   pass 6   fail 0（连跑 3 次稳定，零进程泄漏）
```
scoped 门 `scripts/test.sh --for-task gap-ac252-control-plane-hoist-to-layer0 --allow-thin` ⇒ **exit 0**（415 tests,
0 fail）。⛔ 未实跑 `quay driver stop`（主检出六个 kind 的 supervisor 在验证前后**逐个 ALIVE**，已数过）。

### AC6 残留（⚠️ **本任务未达成**，⛔ 不与「合格」同形）
**未达成的直接原因（一条链，每环都可核）**：
1. 六个 kind 的控制面宿主是 **supervisor 进程**（路径 (a) 的必然结果；AC2 生产路径测试已断言 `cp.pid === supervisor pid`）；
2. 主检出 `/home/yale/work/quay` 上六个 kind 的 supervisor 都在跑（`*-supervisor.pid` 逐个 ALIVE），但它们是
   长驻进程，内存里仍是改动前的 `driver-runtime.ts`；
3. `supervisorStale` 只被**报告**、不被消费——全仓 grep 只有 `driver-runtime.ts` 自己的定义/计算/打印点，
   **没有任何自动重启**；
4. 而 `runSupervisor` 只有在 supervisor **重新拉起**时才会起控制面。
⇒ 生产载体上要出现控制面，需要「本实现先落到主检出」+「六个 kind 的 supervisor 重启」两步，两步都在本 worker 的
可见面之外：前者要等 fan-in 落 develop、再经 `syncDevelopToDoc` 快进主检出；后者是 driver 生命周期操作（CLAUDE.md：
本项目后期开发阶段内 manager 持常设授权），且任务体明令「⛔ 实现与验证期间不得实跑 `quay driver stop`」。
⇒ 按 AC4 的既成惯例，本 AC 在 AC 段标注 `（待外部）` 并在此显式登记为残留，⛔ 不伪称为「跑过」。

**接手时的精确步骤（本实现落到主检出之后）**：
```
# ① 逐 kind 重启 supervisor（控制面随 supervisor 重新拉起；⛔ 不碰 worker 的在飞子进程）
for k in promotion worker outer quality meta goal; do quay driver restart --kind $k; done
# ② 逐 kind 读回读面（应逐 kind 出现、端口互不相同、pid = 该 kind 的 supervisor pid）
for f in .quay/*-control-plane.json; do echo "$f: $(cat $f)"; done
# ③ 逐 kind 经其控制面发 halt / 复原（AC3 的读数），并核其余 kind 的控制态文件 sha256 前后不变
# ④ 同一时刻逐字跑 AC-252 的 criterion ⇒ exit 0（用生产侧同一个消费机件；--dry-run = 不写 GateEvent/不翻状态）
node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-252 --dry-run    # verdict 应为 "pass"
```
⚠️ 本任务在 worktree 里用的 `.quay/ac252-run-criterion.mjs` 是**未追踪的运行时辅助**（`.quay/` gitignored），
随 worktree 回收而消失；步骤 ④ 因此写成上面这条**不依赖该辅助**的命令（criterion 原文始终可从
`goals/AC-252-*.md` 的 frontmatter 取）。
`quay driver restart` 只杀 supervisor+driver 自身、⛔ 不碰 worker kind 的在飞子进程（CLAUDE.md 明载的设计），
故 ① 与 ③ 都停在「停止新派发」这一既有边界内。

### 取假形态一览（本任务靠什么保证判据不是恒真）
| 判据 | 取假形态 | 实测 |
|---|---|---|
| AC-252 criterion | 注释掉 Layer 0 那一行调用 ⇒ exit 1 | 双向实测 |
| AC2 端口不撞 | 六个实测端口互不相同（写死固定端口必然六 kind 互撞） | 两处读数 |
| AC2 结构断言 | 改 registry 一行 ⇒ 落点跟着改（⛔ 非第二张表） | 通过 |
| AC3 rel 传错 | 其余五个控制态文件 sha256 逐字不变 | 通过 |
| AC4 判停被消费 | 下一轮 `stop_reason=mcp-halt` + 常驻进程退出 | 通过（仅 worker） |
| AC6 生产载体 | ⛔ **未取到**（见上），已登记残留 | 未达成 |
