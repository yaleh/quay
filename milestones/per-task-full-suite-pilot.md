# SPEC §11 阶段 2 — per-task 全量试点（测量报告）

> 任务：`gap-spec-11-stage-2-per-task-full-suite-pilot`（status ready）
> 测量窗口：2026-08-13 11:20–11:52（32 min），模式 **(b) 如实记账**（人 2026-08-13 裁定采用：「可接受被污染而慢些的 suite」，读数标注「含全局轮干扰」；(a) 静默窗口未启用——人未点头，.halt 决定权在人）
> 执行：worktree 子代理（`task/gap-spec-11-stage-2-per-task-full-suite-pilot` 分支），**无生产脚本改动**

## 1. 试点协议（依任务 AC/DoD）

- AC1：试点任务在**自有 worktree** 跑**全量套件**（非 scoped），scope=worktree + state=green 记录。
- AC2：N（≥2）个试点任务 per-task 全量绿 + A6 fan-in。
- AC3/AC3b：**=2 并发下**（人 2026-08-13 裁定并发度 =2，最多同时 2 组 suite）per-task 全量**端到端吞吐** ≥ 同窗基线（不设数值阈值；基线同窗重算）。⚠️ 前置自检：记 AC3b 读数前须确认 2 个 scope=worktree 轮同时 state=running。
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
- **⇒ 这是试点的核心输出**：per-task 全量的并发前提**当前机制下结构上不可达**——single-flight lock 把并发串行化并把落败者 abort（600s 后）。后续 full-suite-runner per-task 改造必须重设计这把锁（per-task 作用域 / 去全局锁改 resource-gate-only），否则 per-task 全量只能顺序跑。

### Run 3 — 锁配方机械验证 + 人裁定（=2、配方作废、2 槽锁方向）

- **背景**：011b1469 后 outer/manager relay 给测量配方（`FULL_SUITE_LOCK_FILE=<per-wt 路径>` + `QUAY_TEST_SKIP_RESOURCE_GATE=1`），要求重测 AC3b 并先确认 ≥3 同时 state=running。本子代理按配方在 3 个 provision worktree（任务 wt + pilot-measure-a/b，develop HEAD 4d6cbc40）同时启动全量（run 3）。
- **前置自检（≥3 同时 running）**：11:59:40 三个 state 文件**同时 state=running**（startedAt 11:59:35.058/.095/.081，scope=worktree）——**配方机械上生效**（锁与资源闸均被绕过，3 个并发启动全部进入 running）。
- **run 3 结果**：全部 suite 在静态检查阶段 red/aborted——根因是**外层 worktree 清理在 run 中途删除了未注册的测量 worktree**（`getcwd: cannot access parent directories` + `checker-mutation-cases/*.sh: No such file`，即整棵 worktree 树在 suite 下消失），非测试失败（# tests 0）。这是**第二个结构障碍**：未注册/已合并分支的 worktree 会被外层 fan-in 清理中途移除。
- **⚠️ 人 2026-08-13 裁定（覆盖配方）**：**配方作废**——「不是测量绕锁，是把安全约束上界从 1 槽提到 2 槽（产品能力）」。两个串行化者都改：①单飞锁 1→2 槽（两把锁文件 `full-suite.lock.0/.1` 依次 `flock -n` 试、都占满则阻塞等任一释放——无新依赖、保留 flock 崩溃自动释放）；②资源闸预算按 2 槽算（只改锁第 2 个会撞闸 exit 1）。**相预算 = hostParallelism() ÷ 并发槽数**（1 套件⇒16、2 套件⇒各 8——8 是 16÷2 的实例非字面量）。AC3 并发度从 ≥3 **收缩为 =2**（人裁定最多 2 组 suite）。
- **⇒ run 3 数据仅作配方机械生效的证据（前置自检通过），不作 AC3b 吞吐读数**：配方已被裁定作废，吞吐读数必须以 2 槽产品能力（follow-on 改造后）为准。

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
| AC3 | ❌ **未达成（机制阻塞）** | =2 并发（人 2026-08-13 裁定）当前 1 槽 single-flight lock **同样不可达**（run 2 实证：并发启动被串行化 + 落败 abort + 饿死全局轮 round 150）；人已裁定修复方向 = 2 槽锁（产品能力，follow-on） |
| AC3b | ⚠️ **未定（含干扰）** | 窗口吞吐 1.88/h < 2.21/h 基线；且 =2 并发读数须以 2 槽产品能力（follow-on 改造）为基准（配方已被裁定作废） |
| AC4 | ⚠️ 未触发 | 模式 (b) 未定 ⇒ 不回退；但试点未成立 ⇒ **全局轮不停跑，AC43/AC45 不标 cancelled** |
| AC5 | ✅ **达成** | 既有测试全绿（run1b/run2 全量 4271 tests 绿）；`--for-task gap-spec-11-… --allow-thin` scoped 门 exit 0 |

**成立判断：试点【未成立】（=2 并发维度被 1 槽 single-flight lock 机制阻塞；人已裁定修复方向）。**
- 顺序维度成立：per-task 全量在任务自有（provision 后）worktree 全绿（AC1 ✅），验证完整、无需全局轮。
- 并发维度不成立：AC3 的 =2 并发（人 2026-08-13 裁定）当前 1 槽锁**同样不可达**——run 2 实证串行化 + abort 落败者 + 饿死全局轮（round 150 被 abort 是实害）；run 3 配方机械上可达 3 同时 running（前置自检通过）但配方已被人裁定作废。
- 吞吐门（AC3b）为**未定（含干扰）**：窗口 1.88/h < 2.21/h；且 =2 并发读数须以 2 槽产品能力为基准（follow-on 改造，非测量绕锁）。
- **人裁定的修复方向（覆盖测量配方）**：单飞锁 1→2 槽（`full-suite.lock.0/.1` 双文件 `flock -n`）+ 资源闸预算按 2 槽算 + 相预算 = hostParallelism() ÷ 并发槽数。此即 follow-on（full-suite-runner per-task 语义）的锁重设计输入。

## 5. AC43/AC45 处置建议

**保持 OPEN（不标 cancelled）**：试点未成立 ⇒ 停跑全局轮的前提未达成 ⇒ AC43（套件无 VCS 知识）/AC45（记录 per-task 化）继续存在。
**给后续改造的关键输入**：single-flight lock（`test.sh` 全量路径的跨 worktree 排他 flock + 600s-fail-closed）是 per-task 全量并发的结构阻塞。**人 2026-08-13 已裁定锁方向**（覆盖测量配方）：不是绕锁，是把安全约束上界从 1 槽提到 2 槽（产品能力）——①单飞锁 1→2 槽（`full-suite.lock.0/.1` 依次 `flock -n` 试、都占满阻塞等任一释放）；②资源闸预算按 2 槽算；③相预算 = hostParallelism() ÷ 并发槽数。full-suite-runner per-task 语义改造还必须解决：
1. 锁的作用域（按人裁定改 2 槽，非 per-task 独立锁；锁本来是 2026-08-07 双 cc8 事故的防回归，2 槽保留等价保护）。
2. 任务 worktree 的 provision 前置（`worktree-include.sh` 跑进任务 worktree 创建流程，否则裸 worktree 全量 6 测红）。
3. **未注册/已合并分支 worktree 会被外层 fan-in 清理中途移除**（run 3 实证：并发 suite 中整棵 worktree 树消失）——per-task 全量跑在已注册任务 worktree 上即不触发此问题，但测量/并发场景需注意。
4. 并发下每 task 的 lane 预算（人裁定相预算 = host÷槽数；AC3b 稳态模型 6.5 核当量/task）。

## 6. 测量方法备注（诚实记账）

- 模式 (b) 如实记账（人裁定采用）：未暂停全局轮；窗口内全局轮活动逐 run 记录（round 149 并发、round 150 被本试点 abort）。
- (b) 单向有效性：达标 ⇒ 成立方向强证据；不达标 ⇒ 未定（含干扰），不进 AC4。本窗口吞吐不达标 ⇒ 记未定。
- 吞吐 = 单位时间合入 develop 的任务数；同窗基线 2.21/h 为试点期重算（非历史常量）。
- 运行器：`plugin/scripts/full-suite-runner.ts --root <wt>`；state/log 写入各 run 独立 /tmp 路径，不污染主 checkout gate 信号。
- 一次性测量环境准备：`worktree-include.sh` provision 各被测 worktree（非生产脚本改动）；测量后已清理 2 个 detached 测量 worktree。
- **实害记录（本试点对生产的影响）**：run 2 的 3 个并发启动使 round 150 的全局轮被 single-flight lock 饿死并 abort（0 tests）。此影响本身就是 AC3 未成立的证据；恢复由下一轮全局轮自动完成。

## 7. 2-slot 并发重测（gap-spec11-stage2-retest-with-concurrency，2026-08-13 15:17–15:29）

> 任务：`gap-spec11-stage2-retest-with-concurrency`（status ready）。2-slot 锁已落地（91327d37，QUAY_MAX_CONCURRENT_SUITES 进代码 + 相预算 H÷S + 资源闸按槽记账），本段按任务 AC/DoD 重测试点 AC3b 门：per-task 全量在 =2 并发下的端到端吞吐 + 前置自检。模式 (b) 如实记账继承试点（人 2026-08-13 裁定）。

### 测量设置
- 被测 commit：**7486cc87**（任务 worktree HEAD，含 2-slot 锁 91327d37）
- 并发度：`QUAY_MAX_CONCURRENT_SUITES`=2（旋钮名非字面量；实现 = 两把共享锁文件 `<git-common-dir>/full-suite.lock.0/.1`，git-common-dir 指向主仓库 .git ⇒ 跨全部 worktree 争同一组锁）
- 相预算：hostParallelism(16) ÷ 2 = **8 lanes/suite**（实测锁日志 `concurrent_suite_slots=2 per_suite_lane_budget=8`）
- 2 个 scope=worktree 全量：**Suite A（任务 wt gap-spec11-stage2-retest-with-concurrency）** + **Suite B（measure-spec11-stage2-b 新建 wt）**，各 8 lanes，同 commit
- 运行器：`plugin/scripts/full-suite-runner.ts --root <wt> --state-dir /tmp/spec11-retest/{a,b}`（state/log 独立 /tmp，不污染主 gate 信号）
- 前置：两 wt 均 `worktree-include.sh` provision（config.yml + vendor dist）+ node_modules 符号链接

### AC1 前置自检（2 scope=worktree 轮同时 running）—— ✅ 通过

| suite | worktree | startedAt | state | scope | laneCount | 2-slot 锁槽位 |
|---|---|---|---|---|---|---|
| A | 任务 wt | 15:17:40 | running | worktree | 8 | **slot .0**（full-suite.lock.0） |
| B | measure-spec11-stage2-b | 15:17:43 | running | worktree | 8 | **slot .1**（full-suite.lock.1） |

- watcher 15:18:22 确认「both A and B running」；锁日志逐条确认 A 持 `.0`、B 持 `.1`（**不同槽位，非排队**）。
- **⇒ AC1 前置自检通过**：读数窗口内确有 2 个 scope=worktree 轮同时 running、各持独立槽位。**1-slot 锁时代的结构性阻塞（试点 run2：并发启动被串行化 + 落败 abort）已被 2-slot 锁移除。**

### 结果

| suite | worktree | 结果 | durationMs | 测试数 | 说明 |
|---|---|---|---|---|---|
| A | 任务 wt | **green** | 661422（11.0 min） | 4336 / 0 fail / 0 cancelled | 8 lanes |
| B | measure-spec11-stage2-b | **green** | 663325（11.1 min） | 4336 / 0 fail / 0 cancelled | 8 lanes |

两套同 commit（7486cc87）全量 **4336 tests / 0 fail / 0 cancelled** 全绿 —— 与主轮参考 4336 一致。低并发阶段 main_phase_ms≈273s、lowconc_phase_ms≈132s（8 lanes 的预期墙钟）。

### 全局轮干扰（模式 b 如实记账）

- **round 164 于 15:18:56 启动（runner），被 2-slot 锁阻塞等待 ~10 min**（15:19:23 state=flip 至 running，log 只见锁横幅；两槽均被我的 suite A/B 持有）。
- **round 164 于 ~15:28:42 在 suite A 释放 slot .0 后取得槽位并开跑 —— 延迟未 abort**（log 确认 `acquired full-suite single-flight slot 0`）。
- **与试点对照**：试点 round 150 被 1-slot 锁**饿死并 abort（0 tests）**；本次 round 164 在 2-slot 锁下**等待后正常开跑**。2-slot 锁的 fail-closed（600s 等待，非 3-GO）按设计工作：第 3 套件等槽、槽空即进。
- 恢复：round 164 后续正常完成（下一轮观测）。

### 吞吐（窗口 15:17:40 → 15:28:47，11.1 min = 0.185 h）

| 量 | 读数 |
|---|---|
| 窗口内 develop 提交 | 2（全为 manager 例程提交，非任务 fan-in） |
| 窗口内 A6 fan-in（合入 develop 任务数） | **0** ⇒ 0/h |
| 同窗基线（fresh 重算，非历史常量） | last 2h **2.50/h** · last 4h **4.25/h** · last 6h **4.83/h** · last 8h **3.62/h**（A6 fan-in 率） |
| 对照 + 单向有效性 | **0 < 基线 ⇒ 未定（含干扰）**，不进 AC4 判定 |
| 备注 | **窗口结构不足（manager 2026-08-13 归因修正）**：11.1 min=0.185 h × 基线 2.50–4.83/h ⇒ 期望 fan-in 0.46–0.89 个（<1）——即使方案完美，最可能观测就是 0 或 1 ⇒ **观测 0 零信息**（与「完美」和「很差」都一致）；非「低活动期」（那是外生时序描述，真正原因是窗口长度使期望计数 <1）。AC3b 最小窗口条件（manager 裁定）：窗口须使「同窗基线 × 窗口」期望计数 ≥ N（N>1），例：基线 2.5/h 要期望 ≥5 ⇒ 窗口 ≥2h。本次违反此条件 ⇒ AC3b 读数**结构上无信息** |

### 结论（AC 状态）

| AC | 状态 | 证据 |
|---|---|---|
| AC1 | ✅ **通过** | 2 个 scope=worktree 轮同时 running、各持独立槽位（15:17:40/43 + watcher 15:18:22 + 锁日志 slot .0/.1） |
| AC2 | ✅ **读数贴出** | 并发 per-task 全量吞吐读数见上表（0/h vs 基线 2.50–4.83/h） |
| AC3 | ✅ **单向有效性应用** | 0 < 基线 ⇒ **未定（含干扰）**（不构成成立方向证据，也不构成不成立） |
| AC4 | ✅ **路由正确** | 未定 ⇒ **保持 OPEN**（不停全局轮，AC43/AC45 不标 cancelled）；本子代理无停轮/标 cancelled 权限，路由作为建议记录 |
| AC5 | ✅ **达成** | 2 套全量 4336/0/0 全绿（既有测试全绿）；`--for-task gap-spec11-stage2-retest-with-concurrency --allow-thin` scoped 门 exit 0 |

**成立判断：AC3b 吞吐门【未定（含干扰）】**。
- **机制维度成立**：AC1 前置自检通过 + 2 套 scope=worktree 全量并发全绿 —— **1-slot 锁的结构性并发阻塞已被 2-slot 锁移除**（试点 run2 的串行化+abort 不再发生；round 164 第 3 套件等待后正常开跑而非被 abort）。
- **端到端吞吐门未定（含干扰）**：窗口 0 A6 fan-in < 基线 2.50–4.83/h。**归因修正（manager 2026-08-13）**：不是「管道低活动期」——是**窗口结构不足**：11.1 min=0.185 h × 基线 ⇒ 期望计数 0.46–0.89 个（<1），观测 0 与「完美」和「很差」都一致，**零信息**。AC3b 最小窗口条件未满足（须期望 ≥N>1，例：基线 2.5/h ⇒ 窗口 ≥2h）⇒ 本次读数结构上不足以定案，非并发测量的否定。
- **⇒ 停全局轮的前提（AC3b 成立）未达成**；机制证据（AC1+2 全绿）是成立方向的强证据，需在管道活跃期/静默窗口（(a) 模式）重测吞吐以定案。

## 5b. AC43/AC45 处置建议（重测后）

**保持 OPEN（不标 cancelled）**：AC3b 吞吐门未定（含干扰）⇒ 停跑全局轮前提未达成 ⇒ AC43（套件无 VCS 知识）/AC45（记录 per-task 化）继续存在。**机制层面已获强证据**：per-task 全量并发（2 套同时跑）结构上可行且全绿 —— AC43/AC45 的取消只差吞吐门的定量确认（需管道活跃期/静默窗口重测）。
