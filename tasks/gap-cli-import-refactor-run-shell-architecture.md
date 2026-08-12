---
id: gap-cli-import-refactor-run-shell-architecture
title: CLI import 改造（run()/shell 架构）——派生地板主杠杆
status: ready
labels:
  - gap
  - mechanism
  - product
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 架构查证 + 人裁定方向）**：

- 套件耗时大头 = 派生次数 × 进程启动地板（~180-245s，上界）。派生目标：**CLI 调用 227 处**（nativeBin 60 / quayBin 32 / binPath 14 / coreBin 5 …）+ **git 105 处**（另一类，import 化不适用）。
- `packages/quay/bin/quay.ts` **1838 行，main() 独占 1194 行（64%），export 数 = 0** —— 命令实现锁在不导出的 main() 里，**物理上只能靠派生测**。17 个辅助纯函数里 parseVerbless / resolveJsonFlag / resolvePageSize / relativeTimeCli 各自 **0 测试覆盖**。
- **现状是又慢又漏**，不是"用派生换了更好覆盖"。
- 已有正面样板：119 个测试文件直接 import src/scripts 测纯函数（既定原则）。`bin/quay.ts` 是从没被改造的例外。
- **头号靶子（manager 2026-08-12 execve 实测）**：`packages/quay/test/cli.test.mjs` = **286 execve（测过最高）**、隔离墙钟 **35.7s（占 main 相 1/4-1/3）**、1806 行 / 7 静态派生点 / @test-group product。**它测的就是 CLI 本身 ⇒ run()/shell 改造收益直接兑现**。7 静态点 → 286 execve = **1:40 比例**（静态计数估算法不可用的直接实证——AC 的「按 execve 实测」由此坐实）。

**人裁定方向（原话）**：「用更少的进程用 import 的形式覆盖更多测试，而仅执行少量命令行测试？这样保障覆盖面但优化性能？提供实现一个尽可能薄的 CLI 最外层，而保障尽可能多的 CLI 功能都可以用 import 形式测试。」

**选定架构**：
```
core:  run(argv, ctx) → { code, stdout, stderr }   // 返回值而非副作用；ctx 注入 cwd/env/streams/clock/provider
shell: bin/*.ts ≈ 30 行                            // argv → run() → process.exit/write
```
**测试分层**：
- 命令行为/分支/错误消息/JSON 形状 ⇒ **import 直调 run()**，零派生
- 壳契约（argv 透传、exit code 映射、stdout/stderr 分流、stdin、信号、shebang）⇒ **保留派生**（显式清单）

**四条约束**：
1. **省时数字不静态推**——按调用点实际执行次数测（manager 前车之鉴：全机 fork 计数器外推被负控制推翻）。
2. **真需要进程的显式列壳契约清单**：--version（import.meta/package.json）、stdin 管道、TTY 检测、信号处理、shebang 行本身。
3. **1194 行 main() 整体搬迁有行为漂移风险**——**逐命令搬 + golden-replay 等价性证据**（execute-milestone 先例 byte-for-behavior），不要一次性重写。
4. **105 处 git 派生另一条线**（要测真实 git 行为）——方向是共享 fixture 仓库，不与本条混。

**验证锚**：(a) 覆盖 CLI 命令的测试可从 import 直调 run()（零派生）；(b) 壳契约派生测试显式清单；(c) 逐命令搬迁有 golden-replay 等价证据；(d) 全量套件绿 + 耗时下降（按实际执行次数测）。

## Plan

1. 拆 bin/quay.ts：导出 `run(argv, ctx)` 核心 + 薄 shell。
2. **逐命令搬**（非一次性）：每命令从 main() 迁到 run() 的 command dispatch + golden-replay 等价性验证。
3. 测试分层：命令行为 → import 直调（新增零覆盖纯函数测试）；壳契约 → 派生清单。
4. 按调用点实际执行次数测省时（不静态推）。
5. 回归：--for-task scoped + 全量套件。

## AC

- [ ] AC1: `bin/quay.ts` 导出 `run(argv, ctx)`，shell 薄（argv→run→exit/write）
- [ ] AC2: 命令行为测试从 import 直调 run()（覆盖 parseVerbless 等原零覆盖纯函数）
- [ ] AC3: 壳契约派生测试显式清单（--version/stdin/TTY/信号/shebang）
- [ ] AC4: 逐命令搬迁有 golden-replay 等价证据（无行为漂移）
- [ ] AC5: 全量套件绿 + 实际执行耗时下降（按调用点计数测，不静态推）；--for-task scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] run()/shell 架构 + 逐命令搬迁的 golden-replay 证据 + 实际耗时贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/bin/quay.ts（main() → run(argv, ctx) 抽出，shell 薄壳）
- packages/quay/src/（命令实现迁入的可测纯函数）
- packages/quay/test/cli.test.mjs（命令行为 → import 直调 run()，零派生）
- tasks/gap-cli-import-refactor-run-shell-architecture.md（自身：勾 AC + 贴证据）
