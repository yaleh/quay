---
id: gap-server-status-six-serial-driver-runtime-cold-spawns
title: quay server status --json 串行冷启动 6 个 driver-runtime 子进程，单条只读命令占了 3.9-5s
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**现象（另一会话在 claudecodeui 侧定位、本会话在 quay 仓库复现确认）**：`.quay/plugin/bin/quay server status --json`
本仓库实测 ~5.07s（对照另一会话给的生产读数 3.9-4.65s，同量级）。该命令只读、响应体仅 ~3KB，不是网络慢（`curl /health`
16ms）也不是 git 慢（`git worktree list` 单次仅 ~4ms）。

**根因（已读代码确认）**：`packages/quay/src/cli/server.ts:362`
```
const drivers = DRIVER_SERVICE_KINDS.map((kind) => driverServiceReport(workspaceRoot, kind));
```
`DRIVER_SERVICE_KINDS` 固定 6 个 kind（promotion/worker/outer/quality/meta/goal），`.map()` 是同步串行调用——`
driverServiceReport`（同文件第195行起）本身是**同步**函数，内部调用 `runDriver("status", kind, [...], workspaceRoot)`
（`packages/quay/src/cli/driver.ts:344`），其第 402 行：
```
const r = spawnSync(process.execPath, spawnArgs, { encoding: "utf8" });
```
其中 `spawnArgs` 在开发树上是 `["--experimental-strip-types", <driver-runtime.ts 路径>, "status", "--kind", kind,
"--json", "--root", root]`——**每个 kind 都是一次全新的 Node 冷启动 + `--experimental-strip-types` 转译**，6 次严格串行、
互相等待，累加成 3.9-5s（另一会话逐条实测：525+465+471+233+1023+935 ≈ 3.65s）。

**两个值得记录的反直觉点（避免下一个读这段代码的人走弯路）**：①这 3-4 秒不是网络或磁盘 I/O——它是 6 次 Node 进程
启动 + TS 转译的纯 CPU/启动开销；②`--page-size`/输出体积与此无关——`server status --json` 的响应体本身只有几 KB，
慢在"算出这几 KB 之前串行跑了 6 个子进程"，不是在传输或序列化。

**消费方风险（claudecodeui 侧，仅记录供其跟进，不在本任务范围内处理）**：`QUAY_COMMAND_TIMEOUT_MS=8000`；该命令已经
在 3.9-5s 量级，store/环境更重时会逼近 8s 超时，超时后在 claudecodeui 侧被 `readJsonQuietly` 静默吞掉（dashboard 外链
无声消失，不报错）。

**修法裁定（已选定，不再留给实现时判断）**：选方案1——把 `DRIVER_SERVICE_KINDS.map(...)` 的 6 次同步 `spawnSync`
改成并发（`spawn`/`execFile` + `Promise.all`），理由：6 个 kind 的 status 读取彼此独立（各自读自己的 carrier 文件，无共享
可变状态），并发后墙钟时间趋近单次最慢的那个 kind（~1s 量级）而不是 6 次之和；相比"让 driver-runtime.ts 一次进程算完
6 个 kind"的方案2，方案1不改变 `driver-runtime.ts` 既有的单 kind CLI 调用契约（该契约还被 `goal-driver.ts`/
`observation.ts`/`capability-manifest-check.ts` 等其它消费点使用），风险更低、改动面更小。方案2留作记录，不在本任务
实施：若未来需要进一步压缩（并发后仍有 ~1s 的单次冷启动+转译成本），再单独立案。

该轴仍暗，理由：本任务改动范围限于把 `cli/server.ts` 里 6 次同步 `spawnSync` 调用改成并发 `Promise.all`，不改变
`driver-runtime.ts` 的既有 CLI 契约、不新增模块、不改变包间依赖结构，L_D/L_G（依赖结构/重复抽象）轴对此类并发化改动
不提供信号。

## Touches
- `packages/quay/src/cli/server.ts`
- `packages/quay/src/cli/driver.ts`
- `packages/quay/test/server.test.mjs`
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`
- `tasks/gap-server-status-six-serial-driver-runtime-cold-spawns.md`

## AC
- [x] 复现基线：本仓库 `.quay/plugin/bin/quay server status --json` 实测耗时（当前基线量级 ~4-5s），把真实读数贴进完成记录。
- [x] 改动后（6 个 kind 并发 spawn）同一命令的墙钟耗时显著下降，把改动前后两组真实耗时数字都贴进完成记录（不是估算；预期量级接近单个最慢 kind 的耗时，不是6个之和）。
- [x] 新增/修改用例断言 6 个 kind 的 status 读取并发形态下仍各自返回正确、互不污染的读数（每个 kind 的 pid/carrier/declaration 字段与改动前逐一比对一致），`node --experimental-strip-types --test plugin/test/driver-runtime-loaded-version-drift.test.mjs` 退出 0。
- [x] 任一 kind 的子进程/读取失败时（例如该 kind 从未启动过），`server status --json` 的该 kind 行为与改动前一致（`liveness.evaluated:false`/`unevaluated(...)`，不因为改了调用方式而让一个 kind 的失败拖垮或污染其它 5 个 kind 的读数）——补一个显式失败注入的测试用例。
- [x] `bash scripts/test.sh --for-task gap-server-status-six-serial-driver-runtime-cold-spawns` 退出 0，且执行了 ≥1 个测试文件。

## 完成记录
**改动**（3 个源码/测试文件，实现在 task 分支 `task/gap-server-status-six-serial-driver-runtime-cold-spawns`）：
`cli/driver.ts` 新增 `runDriverAsync`（异步 twin）+ 抽出两条 spawn 路径共用的 `resolveDriverInvocation`；
`cli/server.ts` 的 `driverServiceReport` 改 async、第 362 行改 `await Promise.all(...)`。

**AC1 基线读数**（本机 2026-10-07，同一条命令，真实生产工作区 `/data/home/yale/work/quay`）：
- 已装构建 `.quay/plugin/bin/quay server status --json`：**4.07 / 3.97 / 3.92 s**（3 次），响应体 3155 字节。
- 同一源码入口（串行态，`node --experimental-strip-types packages/quay/bin/quay.ts server status --json`）：**4.08 / 4.07 / 4.18 / 4.05 / 4.02 s**（5 次）。
- 对照：CLI 自身启动（`quay --version`，不 spawn 内核）= 0.05–0.07 s ⇒ 4 秒几乎全是 6 次内核冷启动。

**AC2 改动后读数**（同一源码入口、同一工作区，5 次）：**1.35 / 1.33 / 1.33 / 1.94 / 1.29 s**。
≈ 3.1× 下降，量级落在「单个最慢 kind」而非「6 个之和」。逐 kind 冷启动实测（解释这个地板）：
promotion 0.52 / worker 0.65 / outer 0.60 / quality 0.29 / meta 1.07 / goal 1.11 s —— 和 = 4.24s（正是串行墙钟），max = 1.11s（正是并发墙钟的下限）。

**AC3 用例**：`node --experimental-strip-types --test plugin/test/driver-runtime-loaded-version-drift.test.mjs`
→ **exit 0，22/22 pass**（原有 19 条全绿 + 新增 3 条）。新增 AC3a 用**逐 kind 互不相同**的夹具（6 个载体文件名与时间戳各不相同、
声明态横跨 `declared`/`not-declared`/`stopped-explicitly` 三值），并**逐字段与「直接单 kind 反问内核」的读数比对**（pid /
declaration / `liveness.source` 指名的载体），且断言 `drivers[].kind` 次序 = 词表次序。promotion/worker 另写了 registry 中
排前的 outcome 载体（更旧的 ts），用来钉住「ts 的来源是 round 载体、不是 outcome 载体」。

**AC4 失败注入（两条独立用例）**：
- 真实内核：夹具里 `goal` 一个载体都不写 ⇒ 该行 `liveness.evaluated:false`、`alive:null`、
  detail = `no round heartbeat carrier record yet (carrier=null)`；其余 5 行照旧 `alive:true` 且各自 `source` 仍指自己的载体。
- 桩内核（`QUAY_PLUGIN_ROOT` 指向夹具）：`meta` 的 status 子进程 exit 3 且不输出 JSON ⇒ 该行
  `evaluated:false`、`alive:null`、detail 含 `no JSON frame (exit 3)`，且 pid/declaration 均为 `null`（不臆造），
  其余 5 行不受影响。

**AC5**：`bash scripts/test.sh --for-task gap-server-status-six-serial-driver-runtime-cold-spawns` → **exit 0**；
选中 **9 个测试文件**（3/5 Touches 解析成功，coverage 0.60 ≥ 0.5，非 thin），**115 tests / 0 fail**。

**DoD 真实落地**：在真实工作区 `/data/home/yale/work/quay`（6 个 kind 的 carrier 都是真实生产数据，非夹具）上实跑，
改动前后两组 JSON 的 `drivers[]` **逐字段一致**（name / pid 4122569 / declaration / `liveness.source` 指名的载体 /
alive / evaluated 全等，只有心跳 age 是活数据），非 driver 部分响应体亦逐字段相同：
before `4.02–4.18s` → after `1.29–1.94s`。

**并发性的负控制**（AC4 用例真的能取假）：把上述两处改动临时回退（`cp` 备份 → 还原）后，同一条 AC4 用例 **FAIL**，
报 `all six windows must share a common instant`，六个内核调用窗口首尾相接（各 ~36ms 间隙）、耗时 12.4s ≈ 6×2s ——
即串行实现下该判据恒假，证明它测的是并发本身而不是别的。

**Touches 变更说明**：立案时 Touches 只列 `cli/server.ts` + 内核漂移测试文件 + 任务文件本身；实现过程中改动落在
`cli/driver.ts`（异步 twin 与共用前置）与新增的 `packages/quay/test/server.test.mjs`（`cli/server.ts` 按仓库主流
`<dir>/foo.ts` → `*/test/foo.test.mjs` 约定本来就缺的配对测试，`select-tests-for-touches.ts` 报「no */test/server.test.mjs found」，
补上后该任务不再是 `test-selection-thin`），故 Touches 相应扩到 5 项 —— 反映真实改动面，不是为了让选择器好看。

## DoD
真实落地：在本仓库真实工作区（6 个 kind 的 carrier 文件都是真实存在的生产数据，不是 fixture）上，实跑改动后的
`quay server status --json`，耗时相比改动前基线有实测的、数量级上的下降，且 6 个 kind 的字段值与改动前逐一核对一致。
