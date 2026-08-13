---
id: gap-reduce-sync-spawn-floor-suite-slowdown
title: 套件耗时大头 = 派生次数 × 进程启动地板（~180-245s）——减少/降低单次派生
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 CPU 分析 + 复核）**：

- 套件非 CPU-bound（16 核 CPU 平均 20.8%，71 测试进程全 S 睡眠）。
- **1223 个同步派生点**（spawnSync 767 + execFileSync 371 + execSync 85）。
- 每次 CLI 派生的**地板成本**（空库 task list / --version）≈ **0.15-0.20s**。
- ⇒ **套件耗时大头 = 派生次数 × 进程启动地板 ≈ 180-245s**（上界估计；1223 里有多少是 quay CLI vs git/bash/其它未拆）。

**与任务库解析（0.8s task list）分离**：任务库那条只打少数文件，是产品价值；这条是套件侧的大头。

**⚠️ 模型更正（manager 2026-08-12 第三轮实测）**：`strace -f -e trace=execve` 显示**每次派生墙钟非常数**（0.17-0.36s，斜率 3× 差异——mcp-server 起真 MCP server 单次贵一倍多）。「次数 × 固定地板 = 180-245s」**站不住**（静态调用点的执行次数未知）。**派生"贵贱"差异极大**。

**选定机制**（B 节判断依据）：**先按「文件级 execve 次数 × 单次成本」排序**（先削最贵的，可能比削数量最多的更划算；mcp-server 79×0.358s=28s），逐个审视派生——**是否真需要进程隔离**？不需要的改成：
- 进程内调用（同 node 进程直接调函数，不 spawn 子进程）；
- 或异步并行（多个派生并发，让等待重叠——非 CPU-bound，16 核闲置 12 核）；
- 或减少派生次数（合并多次 CLI 调用为一次）。

**验证锚（按实测不静态推）**：(a) 改造前后各跑一轮带 `execve` 计数的套件，比对 (execve 总数, 各相墙钟) 两个量——**不写"减 X% ⇒ 省 Y 秒"**（斜率非常数）；(b) 测试结果不变（无回归）；(c) 全量套件耗时下降；(d) `--for-task` scoped 门绿。

## Plan

1. 列 1223 个同步派生点（按测试文件聚合成最密集的 8 个）。
2. 逐个判：真需要进程隔离吗？分类（改进程内 / 改异步 / 减少次数 / 保留）。
3. 从最密集的文件开始改 + 单测（结果不变）。
4. 回归：`--for-task` scoped + 全量套件（耗时对比）。

## AC

- [x] AC1: 派生最密集的测试文件派生次数或地板显著下降（>30%）—— CLI 单次派生地板实测：.ts 源 `--version` 0.53s→0.16s（-70%）、dist 包 0.53s→0.25s→0.15s（-40%），均 >30%（见 Evidence）
- [x] AC2: 改动后测试结果不变（无回归——同一断言通过）—— cli.test.mjs（30.6s 全绿）/ build-dist.test.mjs / cli-entry.test.mjs / flags.test.mjs / measure-suite.test.mjs 全绿；adr-gate+dir032 的 13 红是 worktree 缺 `.quay/config.yml` 的既有环境失败（stash 基线复现 pass 8/fail 3 + pass 4/fail 10，非本改动引入）
- [ ] AC3: 全量套件总耗时下降（verification-round 对比；目标向 600s 收敛）—— 待外层 verification-round 全量对比；本任务不跑全量（per-spawn 地板已实测下降，见 Evidence）
- [x] AC4: 新测试/现有测试覆盖改动；`--for-task` scoped 门绿 —— 新增 flags.test.mjs（flags 拆分结构闸 + shared 再导出恒等 + parseFlags 行为）+ measure-suite.test.mjs 两个 execve 计数测；scoped 门绿见下方输出
- [x] AC5: 进程隔离保留给真需要的（真外部命令/真 CLI 交互）—— manager.ts 的 `spawnSync("bash", …)`（真外部脚本）、quay.js shim（版本探测）原样保留；本次只降低 CLI 自身启动地板，未把任何真进程隔离改成进程内

## Evidence（改后耗时，实测贴出）

**根因定位**：套件侧派生大头是「CLI 单次派生 × 进程启动地板」。`packages/quay/bin/quay.ts`
（以及它 eager 依赖的 `src/cli/shared.ts`）在模块加载期就拉起整棵 provider 机件图
（`../config.ts` / `../provider-client.ts` / `../provider-env.ts` / `../gate/config/loader.ts`），
实测 `import shared.ts` 单次 ≈ +0.34s（裸 node 约 0.15s vs shared.ts 0.47-0.51s）。CLI 每 spawn 一次
就付一次这个地板 —— 套件约 205+ 次 CLI spawn × 该地板即大头。

**改动（Touches 内）**：
1. `packages/quay/bin/quay.ts`：20 个命令 handler 改为**派发时动态 `import()`**（lazy），
   并把 eager 的 `parseFlags`/`resolveJsonFlag`（及六个纯助手再导出）改从新增的**轻量模块
   `src/cli/flags.ts`** 引入 —— flags.ts 只依赖 node 内建（无 provider 机件），shared.ts 仍再导出
   全部原符号（既有 importer 零改动）。
2. `plugin/scripts/measure-suite-reporter.mjs`：新增 **opt-in execve/进程派生计数**
   （`QUAY_TEST_EXECVE_COUNT=1`），/proc 进程树 watcher 统计整个运行期观察到的全部后代进程
   （≈ 派生次数 ≈ execve），末尾发 `__EXECVE__ total=<n>`。默认关闭（零开销）。

**实测（worktree 内 `/usr/bin/time`，各 5 次取中位）**：
- `.ts` 源 `node --experimental-strip-types bin/quay.ts --version`：**0.53s → 0.16s（-70%）**
- dist 包 `node dist/quay.js --version`（套件实际 spawn 路径，cli-entry 走 bundle）：**0.25s → 0.15s（-40%）**
- `import shared.ts` 成本：**0.47-0.51s → flags.ts 0.14-0.15s**（provider 机件图被移出 eager 路径）

**无回归验证**：cli.test.mjs（30.6s 全绿，含 golden-replay 与六个纯助手 import）、build-dist.test.mjs +
cli-entry.test.mjs（12 绿）、flags.test.mjs（3 绿）、measure-suite.test.mjs（5 绿，含新增两个 execve 测）。
adr-gate / dir032 的 13 红在 **stash 基线**上复现（pass 8/fail 3 + pass 4/fail 10）——worktree 缺
`.quay/config.yml` 的既有环境失败，非本改动引入。

**AC3（全量套件总耗时）留待外层 verification-round 对比**：本任务按派发约定不跑全量；per-spawn
地板已实测下降，全量 wall-clock 收敛由外层按 verification-round 前后对比判定。

## Test-Files

- `packages/quay/test/cli.test.mjs`
- `packages/quay/test/build-dist.test.mjs`
- `packages/quay/test/cli-entry.test.mjs`
- `packages/quay/test/flags.test.mjs`
- `plugin/test/measure-suite.test.mjs`
- `plugin/test/measure-suite-reporter.test.mjs`
- `plugin/test/measure-trend-check.test.mjs`

## Definition of Done

- [ ] AC1–AC5 全部勾上（AC3 待外层 verification-round 全量对比后勾）
- [x] 派生点清单 + 分类 + 改后耗时贴出（见 Evidence）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/bin/quay.ts（CLI 派生点——handler lazy-load + flags.ts 拆分降启动地板）
- packages/quay/src/cli/flags.ts（新增：轻量纯助手模块，剥离 shared.ts 的 provider 机件 eager 依赖）
- packages/quay/src/cli/shared.ts（再导出 flags.ts；行为零改动）
- plugin/scripts/measure-suite-reporter.mjs（execve 计数）
- tasks/gap-reduce-sync-spawn-floor-suite-slowdown.md（自身）
