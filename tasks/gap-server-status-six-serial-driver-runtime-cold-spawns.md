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

**修法裁定（已选定，不再留给实现时判断）**：选方案1——把 `DRIVER_SERVICE_KINDS.map(...)` 的 6 次同步 `spawnSync` 改成
并发（`spawn`/`execFile` + `Promise.all`），理由：6 个 kind 的 status 读取彼此独立（各自读自己的 carrier 文件，无共享
可变状态），并发后墙钟时间趋近单次最慢的那个 kind（~1s 量级）而不是 6 次之和；相比"让 driver-runtime.ts 一次进程算完
6 个 kind"的方案2，方案1不改变 `driver-runtime.ts` 既有的单 kind CLI 调用契约（该契约还被 `goal-driver.ts`/
`observation.ts`/`capability-manifest-check.ts` 等其它消费点使用），风险更低、改动面更小。方案2留作记录，不在本任务
实施：若未来需要进一步压缩（并发后仍有 ~1s 的单次冷启动+转译成本），再单独立案。

该轴仍暗，理由：本任务改动范围限于把 `cli/server.ts` 里 6 次同步 `spawnSync` 调用改成并发 `Promise.all`，不改变
`driver-runtime.ts` 的既有 CLI 契约、不新增模块、不改变包间依赖结构，L_D/L_G（依赖结构/重复抽象）轴对此类并发化改动
不提供信号。

## Touches
- `packages/quay/src/cli/server.ts`
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`
- `tasks/gap-server-status-six-serial-driver-runtime-cold-spawns.md`

## AC
- [ ] 复现基线：本仓库 `.quay/plugin/bin/quay server status --json` 实测耗时（当前基线量级 ~4-5s），把真实读数贴进完成记录。
- [ ] 改动后（6 个 kind 并发 spawn）同一命令的墙钟耗时显著下降，把改动前后两组真实耗时数字都贴进完成记录（不是估算；预期量级接近单个最慢 kind 的耗时，不是6个之和）。
- [ ] 新增/修改用例断言 6 个 kind 的 status 读取并发形态下仍各自返回正确、互不污染的读数（每个 kind 的 pid/carrier/declaration 字段与改动前逐一比对一致），`node --experimental-strip-types --test plugin/test/driver-runtime-loaded-version-drift.test.mjs` 退出 0。
- [ ] 任一 kind 的子进程/读取失败时（例如该 kind 从未启动过），`server status --json` 的该 kind 行为与改动前一致（`liveness.evaluated:false`/`unevaluated(...)`，不因为改了调用方式而让一个 kind 的失败拖垮或污染其它 5 个 kind 的读数）——补一个显式失败注入的测试用例。
- [ ] `bash scripts/test.sh --for-task gap-server-status-six-serial-driver-runtime-cold-spawns` 退出 0，且执行了 ≥1 个测试文件。

## DoD
真实落地：在本仓库真实工作区（6 个 kind 的 carrier 文件都是真实存在的生产数据，不是 fixture）上，实跑改动后的
`quay server status --json`，耗时相比改动前基线有实测的、数量级上的下降，且 6 个 kind 的字段值与改动前逐一核对一致。
