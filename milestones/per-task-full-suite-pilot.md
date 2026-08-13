# SPEC §11 阶段 2 — per-task 全量试点（测量报告）

> 任务：`gap-spec-11-stage-2-per-task-full-suite-pilot`（status ready）
> 测量窗口：2026-08-13 11:20–11:52（32 min），模式 **(b) 如实记账**（人 2026-08-13 裁定采用：「可接受被污染而慢些的 suite」，读数标注「含全局轮干扰」；(a) 静默窗口未启用——人未点头，.halt 决定权在人）
> 执行：worktree 子代理（`task/gap-spec-11-stage-2-per-task-full-suite-pilot` 分支），**无生产脚本改动**

## 1. 试点协议（依任务 AC/DoD）

- AC1：试点任务在**自有 worktree** 跑**全量套件**（非 scoped），scope=worktree + state=green 记录。
- AC2：N（≥2）个试点任务 per-task 全量绿 + A6 fan-in。
- AC3/AC3b：≥3 并发下 per-task 全量**端到端吞吐** ≥ 同窗基线（不设数值阈值；基线同窗重算）。
- AC4：成立 ⇒ 全局轮停跑 + AC43/AC45 cancelled；不成立 ⇒ 回退（仅 (a) 静默窗口不达标触发）。
- DoD：全局轮占墙钟比 + 红轮率前后对照；成立/不成立结论 + AC43/AC45 处置。

## 2. 全局轮基线（试点前，2026-08-13 rounds 119–148）

| 量 | 读数 |
|---|---|
| 轮数 n | 30（green 11 / red 19） |
| 红轮率 | **63%**（历史基线 76%） |
| 全局轮占墙钟比 | **62%**（251.0 min / 6.74 h 窗口；历史 59%） |
| 单轮墙钟 | avg 502s（min 21s abort / max 1335s） |
| fan-in 吞吐（同窗重算） | 25 A6 fan-in / 11.3 h ≈ **2.21 任务/h**（近 6h 历史 2.33/h） |

## 3. 试点读数

### Run 1 — 未 provision 的裸 worktree 全量（机件发现 / AC1 反证）

- 位置：任务自有 worktree（`git worktree add` 创建，**未跑 `worktree-include.sh`**）
- 起止：11:20:11Z → 11:26:11Z，**durationMs=360213（6.0 min）**，state=**red**（reason=failed）
- laneCount=16, scope=worktree, verifiedCommit=b2f26003
- **机件发现 ①（裸 worktree 不可直接跑全量）**：裸 task worktree **缺 `.quay/config.yml`**（gitignore，`git worktree add` 不复制）。全量套件 6 个测试因此失败，**全部根因 = `Cannot find repo root: no .quay/config.yml found upward`**：M52 A1×2 / A2 / D1（delivery-standalone-smoke gate）、AC11（test.sh explicit-file smoke）、monitor-mount-check.test.mjs。
- **对照**：全局轮 one-shot verify worktree 经 `worktree-include.sh`（`/.quay/config.yml` + `/plugin/vendor/*/dist/*.js`）provision，故全局轮绿、裸 task worktree 红。⇒ **per-task 全量的前置 = 任务 worktree 必须经 `worktree-include.sh` provision**（后续改造输入；本试点只记录，不改生产脚本）。
- 干扰：11:22:39Z–11:32:10Z 全局轮 round 149 并发跑（16 lanes 抢核），run 1 后半程**含全局轮干扰**（round 149 durationMs=570850，明显被 run 1 拉长）。

### Run 1b — provision 后隔离全量（AC1 正向证据 + 隔离基线）

- 位置：同一任务 worktree（`worktree-include.sh` provision：config.yml + 2 vendor dist）
- 起止：11:32:27Z → 11:39:27Z，**durationMs=375998（6.3 min）**，state=**green**
- laneCount=16, scope=worktree；**# tests 4271 / cancelled 0 / suite green，0 failures**
- 窗口内无全局轮（main 全程 green）→ **隔离基线，无全局轮干扰**
- **AC1 达成**：任务自有 worktree、全量（非 scoped）、scope=worktree + state=green 记录存在（/tmp/pilot-run1b.json）

### Run 2 — 3 个 per-task 全量同时启动（AC3b 并发测量；决定性发现）

- 3 个 worktree 同时启动全量（各 16 lanes，均 develop HEAD b2f26003，均 provision）：任务 worktree + pilot-measure-a + pilot-measure-b
- 起止：11:39:41Z → 11:52:29Z

| suite | worktree | 结果 | durationMs | 实际测试墙钟 | 说明 |
|---|---|---|---|---|---|
| run2-pilot | 任务 wt | **green** | 401217（6.7 min） | ~6.7 min | 拿到 single-flight lock，独占运行 |
| run2-a | measure-a | **red/aborted** | 604561（10.1 min） | **0 tests** | 锁被 run2-pilot 持有 → flock 等 600s → 超时 abort |
| run2-b | measure-b | **green** | 767946（12.8 min wall） | ~6.1 min（11:46:22 后才开始） | 锁等 run2-pilot 释放后取得，才真正开跑 |

- **机件发现 ②（决定性）——single-flight lock 使 ≥3 并发 per-task 全量不可能**：`scripts/test.sh` 全量路径持有**跨全部 worktree 的排他 flock**（`<git-common-dir>/full-suite.lock`，git-common-dir 指向主仓库 .git，全部 worktree 争同一把锁），**整个全量 run 持有**（acquire 于 test.sh:1033，release 于 :1207）。第二个并发全量启动 flock 阻塞最多 600s，超时 fail-closed（`not starting … waited 600s`）。实测：3 个并发启动被**串行化成 2 个顺序全量 + 1 个 abort**，无真正并发。
- **并发 per-task 全量直接饿死全局轮（模式 b 如实记账的实害）**：round 150（11:42:11 触发）的 one-shot suite 同样要抢这把锁，被 run2-pilot/run2-b 持有 → 等 600s → **aborted，0 tests**（`# suite red aborted`）。即：per-task 并发全量与全局轮**互斥**，同时存在时全局轮被 abort。
- 并发期负载：load1 采样 5–20（3×16 lanes 启动时尖峰 14.6/20.3/17.9），后回落；资源 gate 全程 GO（budget 超订但 PSI/load 未触 WAIT 线）。
- **⇒ 这是试点的核心输出**：per-task 全量的并发前提（≥3 同时在跑）**当前机制下结构上不可达**——single-flight lock 把并发串行化并把落败者 abort（600s 后）。后续 full-suite-runner per-task 改造必须重设计这把锁（per-task 作用域 / 去全局锁改 resource-gate-only），否则 per-task 全量只能顺序跑。

### 吞吐（试点窗口 11:20–11:52，32 min = 0.53 h）

| 量 | 读数 |
|---|---|
| develop 提交 | 5（1 个 A6 fan-in + supply/outer/manager 例程） |
| A6 fan-in | **1 / 0.53 h ≈ 1.88/h** |
| 同窗基线 | 2.21/h |
| 对照 | **1.88 < 2.21 ⇒ 未定（含干扰）**（模式 b 单向有效性：不达标不构成不成立，不进 AC4） |
| 窗口内全局轮 | round 149 green（9.5 min，被 run1 拖慢）；**round 150 aborted（10.1 min，0 tests，被锁饿死）** |

## 4. 结论（AC 状态 + 成立/不成立判断）

| AC | 状态 | 证据 |
|---|---|---|
| AC1 | ✅ **达成** | run 1b green：自有 worktree、全量非 scoped、scope=worktree + state=green（4271 tests / 0 fail） |
| AC2 | ⚠️ 部分（机制达成，fan-in 未做） | 3 个 worktree 全量 green（run1b/run2-pilot/run2-b，同 commit b2f26003）；**A6 fan-in 未执行**（本子代理禁 merge；试点任务自身未合回 develop） |
| AC3 | ❌ **未达成（机制阻塞）** | ≥3 并发被 single-flight lock 串行化 + 落败 abort + 饿死全局轮 —— 结构上不可达，非噪声 |
| AC3b | ⚠️ **未定（含干扰）** | 窗口吞吐 1.88/h < 2.21/h 基线；模式 (b) 单向有效性 ⇒ 不构成不成立，不进 AC4 |
| AC4 | ⚠️ 未触发 | 模式 (b) 未定 ⇒ 不回退；但试点未成立 ⇒ **全局轮不停跑，AC43/AC45 不标 cancelled** |
| AC5 | ✅ **达成** | 既有测试全绿（run1b/run2 全量 4271 tests 绿）；`--for-task gap-spec-11-… --allow-thin` scoped 门 exit 0 |

**成立判断：试点【未成立】（并发维度被 single-flight lock 机制阻塞）。**
- 顺序维度成立：per-task 全量在任务自有（provision 后）worktree 全绿（AC1 ✅），验证完整、无需全局轮。
- 并发维度不成立：AC3 要求的 ≥3 并发当前机制下**不可达**——single-flight lock 串行化 + abort 落败者 + 饿死全局轮（round 150 被 abort 是实害）。
- 吞吐门（AC3b）为**未定（含干扰）**，按模式 (b) 不触发回退，但也不支持「成立 ⇒ 停跑全局轮」。

## 5. AC43/AC45 处置建议

**保持 OPEN（不标 cancelled）**：试点未成立 ⇒ 停跑全局轮的前提未达成 ⇒ AC43（套件无 VCS 知识）/AC45（记录 per-task 化）继续存在。
**给后续改造的唯一关键输入**：single-flight lock（`test.sh` 全量路径的跨 worktree 排他 flock + 600s-fail-closed）是 per-task 全量并发的结构阻塞。full-suite-runner per-task 语义改造必须先解决：
1. 锁的作用域（per-task 独立锁 / 去全局锁改 resource-gate-only）；锁本来是 2026-08-07 双 cc8 事故的防回归，去掉要有等价保护。
2. 任务 worktree 的 provision 前置（`worktree-include.sh` 跑进任务 worktree 创建流程，否则裸 worktree 全量 6 测红）。
3. 并发下每 task 的 lane 预算（默认 16 lanes × N 并发 = 严重超订；AC3b 稳态模型 6.5 核当量/task）。

## 6. 测量方法备注（诚实记账）

- 模式 (b) 如实记账（人裁定采用）：未暂停全局轮；窗口内全局轮活动逐 run 记录（round 149 并发、round 150 被本试点 abort）。
- (b) 单向有效性：达标 ⇒ 成立方向强证据；不达标 ⇒ 未定（含干扰），不进 AC4。本窗口吞吐不达标 ⇒ 记未定。
- 吞吐 = 单位时间合入 develop 的任务数；同窗基线 2.21/h 为试点期重算（非历史常量）。
- 运行器：`plugin/scripts/full-suite-runner.ts --root <wt>`；state/log 写入各 run 独立 /tmp 路径，不污染主 checkout gate 信号。
- 一次性测量环境准备：`worktree-include.sh` provision 各被测 worktree（非生产脚本改动）；测量后已清理 2 个 detached 测量 worktree。
- **实害记录（本试点对生产的影响）**：run 2 的 3 个并发启动使 round 150 的全局轮被 single-flight lock 饿死并 abort（0 tests）。此影响本身就是 AC3 未成立的证据；恢复由下一轮全局轮自动完成。
