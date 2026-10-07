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

**修法方向（留给实现时判断，两条互不排斥）**：
1. **最小改动、风险最低**：把 `DRIVER_SERVICE_KINDS.map(...)` 的 6 次同步 `spawnSync` 改成并发（`spawn`/`execFile` +
   `Promise.all`）——6 个 kind 的 status 读取彼此独立（各自读自己的 carrier 文件，无共享可变状态），并发后墙钟时间趋近
   单次最慢的那个 kind（~1s 量级），而不是 6 次之和。
2. **更彻底、收益更大**：6 次 Node 冷启动本身才是大头（每次都要重新加载 `--experimental-strip-types` 转译整个
   `driver-runtime.ts`），并发只是把等待重叠、不消除这个代价。更彻底的修法是让 `driver-runtime.ts` 自己支持"一次
   进程、循环全部 6 个 kind、吐一次 JSON（或 6 行 JSON 帧）"的调用形态（例如 `status --kind all`），`server.ts` 侧
   只 `runDriver` 一次而不是 6 次——这样把 6 次冷启动降到 1 次，而不只是把等待重叠。
   **已知架构约束（实现前需确认，不在本任务预判范围）**：Core（`packages/quay/src`）不得静态 import `plugin/**`
   （`loaded-version.ts` 头部注释已记载这条方向性限制），所以"把 driver-runtime.ts 的状态计算函数直接 import 进
   server.ts 同进程跑"可能违反这条既有边界；而"driver-runtime.ts 自己内部一次进程算完 6 个 kind、仍以子进程形态被
   server.ts 调用一次"不违反这条边界。实现时按既有边界选方案，不要假定方案 2 等同于"合并进 Core 进程"。

## Touches
- `packages/quay/src/cli/server.ts`
- `packages/quay/src/cli/driver.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`
- `tasks/gap-server-status-six-serial-driver-runtime-cold-spawns.md`

## AC
- [ ] 复现基线：本仓库 `.quay/plugin/bin/quay server status --json` 实测耗时（当前基线量级 ~4-5s），把真实读数贴进完成记录。
- [ ] 改动后同一命令的墙钟耗时显著下降，把改动前后两组真实耗时数字都贴进完成记录（不是估算；若走方案1并发，预期量级接近单个最慢 kind 的耗时，不是6个之和；若走方案2合并冷启动，预期量级接近1次 Node 启动）。
- [ ] 新增/修改用例断言 6 个 kind 的 status 读取在并发或单次调用形态下仍各自返回正确、互不污染的读数（每个 kind 的 pid/carrier/declaration 字段与改动前逐一比对一致），`node --experimental-strip-types --test plugin/test/driver-runtime-loaded-version-drift.test.mjs` 退出 0。
- [ ] 任一 kind 的子进程/读取失败时（例如该 kind 从未启动过），`server status --json` 的该 kind 行为与改动前一致（`liveness.evaluated:false`/`unevaluated(...)`，不因为改了调用方式而让一个 kind 的失败拖垮或污染其它 5 个 kind 的读数）——补一个显式失败注入的测试用例。
- [ ] `bash scripts/test.sh --for-task gap-server-status-six-serial-driver-runtime-cold-spawns` 退出 0，且执行了 ≥1 个测试文件。

## DoD
真实落地：在本仓库真实工作区（6 个 kind 的 carrier 文件都是真实存在的生产数据，不是 fixture）上，实跑改动后的
`quay server status --json`，耗时相比改动前基线有实测的、数量级上的下降，且 6 个 kind 的字段值与改动前逐一核对一致。
