---
id: gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite
title: ready-pool-check 占全仓 checker 成本 97.8%（212.7h，与整个测试套件同量级）且三周涨 5
  倍——每次轮询重解析全部 2123 个任务，同根已让 MCP task_list 超时
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

**`ready-pool-check` 单个检查器占全仓 checker 成本的 97.8%，与整个测试套件同量级，且三周内
涨了 5 倍——它是 O(任务库规模) 的全量轮询，而任务库只会继续增长。**

实测（`.quay/checker-cost.jsonl`，窗口 2026-08-11 → 09-14，145 个 checker 累计 217 小时）：

| checker | 调用次数 | 中位 | 累计 | 占比 |
|---|---|---|---|---|
| **`ready-pool-check`** | **75,571** | 9.5 s | **212.7 h** | **97.8%** |
| 其余 144 个合计 | ~19,000 | — | 4.3 h | 2.2% |

作为对照，同期 `.quay/verification-round.jsonl` 里**整个测试套件**累计约 **231 小时**——
**晋升闸的开销和跑完所有测试一样贵**，而没有任何判据在盯它。

### 增长曲线（调用数与单次时长在同时涨）

| 时期 | 调用/天 | 中位 | 累计/天 |
|---|---|---|---|
| 08-12 ~ 08-22 | ~300 | 2.7 s | 0.1 – 0.7 h |
| 08-23（driver 化） | 2,520 | 4.7 s | 3.7 h |
| 09-11 | 6,316 | 11.4 s | **19.0 h** |
| 09-13 | 4,780 | 13.0 s | **17.3 h** |

单次时长从 2.7 s 涨到 13 s，**因为它是 O(池大小)**，而池从约 1,500 涨到 2,123。
两个因子相乘 ⇒ 三周内累计成本涨 5 倍。可并发，所以不等于占满单核，但已是约 1 核持续占用。

### 热路径（具体位置，不是猜测）

`plugin/scripts/ready-pool-check.ts:2311` `analyzeTasks()`：
- `:2315` `fs.readdirSync(tasksDir).filter(f => f.endsWith(".md"))` —— 全量目录（当前 2,123 个）
- `:2322` `readTaskFilesAtRefBatch(...)` —— 从 git ref 批量读**全部**任务文件
- `:2326-2333` 对**每一个**文件 `parseTask(raw)` + 逐字段解析

即每次调用都重读并重解析整个任务库。按 75,571 次调用估算，本月累计约 **1.6 亿次**
任务文件读取与解析。

⚠️ **从 git ref 读是有意设计，不是缺陷**（`:2318-2321` 注释：单源派发读，避免读到陈旧的
工作树盘面，`gap-dispatch-reads-stale-main-checkout-task-status` / 硬规则 4b）。
**修法不是绕开 ref 读，而是不要在每次轮询都重解析整个库。**

### 同根的生产故障（已经打到路径上了）

`tasks/gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp.md`：同一个根因
（任务库规模）已经让 MCP 上的 `task_list` 超时并队头阻塞整条 ABI 读面——CLI 全量
`task list` 实测 37.7 s。再往前还有 `tasks/gap-serve-search-timeout-all-body-fetch.md`
（**已 done**，当时 1,572 个任务，web 搜索面全量取 body 致 MCP -32001）。
**⊢ 这是同一个机制的第三个实例（硬规则 5b：缺陷成簇，兄弟实例常在同一层）。**

完整读数与方法见 `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §4。

## Touches

- `plugin/scripts/ready-pool-check.ts`
- `plugin/test/ready-pool-check.test.mjs`
- `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md`
- `tasks/gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite.md`

## Acceptance Criteria

- [ ] **规模无关性（核心判据，可取假）**：对同一份真实任务库，分别在 N≈500 与 N≈2,100 两个
      子集上测 `analyzeTasks()` 的单次耗时，修复后两者之比应显著小于修复前的同一比值；
      两次比值（修复前/修复后）都要贴进任务体。修复前的比值即负控制——在 pre-fix 提交上
      重跑同一脚本取得，**不接受只给修复后的数**。
- [ ] **生产成本下降**：修复落地后连续 ≥3 天，`.quay/checker-cost.jsonl` 里
      `ready-pool-check` 的**累计 h/天**相对落地前 7 天的中位显著下降，并给出两段的实际读数。
      ⛔ 不预设具体百分比阈值（成本结构已测但改法未定，按硬规则 4 推论不凭空设数值目标），
      但必须给出前后对照，且下降不显著时如实报「未达成」。
- [ ] **正确性不回退**：单源 ref 读语义保持（`gap-dispatch-reads-stale-main-checkout-task-status`
      的不变量不得破坏）——给出一个对照：让工作树盘面与 develop 上的任务状态不一致，
      验证晋升判定仍以 ref 为准。这是修法的硬约束，不是可选项。
- [ ] **枚举兄弟实例（硬规则 5b）**：grep 出仓库内所有「每次调用都全量读+解析任务库」的路径
      （命中数 + 前 3 条实际内容 + 文件:行号），逐条说明是否同样受影响、是否一并修复；
      至少要覆盖 `gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp` 指出的
      `task_list` 路径。写不出这个清单视为只修了被报出来的那一个。
- [ ] **回归判据**：新增测试断言在 N≥2,000 的任务库上 `analyzeTasks()` 单次耗时低于阈值；
      该测试在修复前的代码上必须红（贴出红的输出）。
- [ ] `bash scripts/test.sh --for-task gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite`
      全绿，且新测试在该轮被实际选中执行（按**测试名**核对，不是按文件名推测）。

## Definition of Done

成本读数取自**生产载体** `.quay/checker-cost.jsonl`，不接受 fixture 或注入数据满足
（反例判据：把注入 seam 关掉后，成本对照 AC 仍应成立）。
修复必须经过 ≥3 天真实生产运行再判完成——只在实现当轮测到的加速不算数
（硬规则 4 推论三：实现了、测试绿了、但生产没跑过 ⇒ 与没实现同形；本仓库已有
`gap-phase-boundary-differential-accounting` 的前车之鉴）。
若最终结论是「这个成本是必要的、无法降低」，同样要落地一个**可见性**产物：
一条盯住 `ready-pool-check` 累计 h/天 的判据，使它再涨时有人知道——
当前的状态是「全仓最贵的单个机件，且没有任何判据在看它」，这一点必须被改变。
