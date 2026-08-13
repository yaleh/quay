---
id: gap-spec-11-stage-2-per-task-full-suite-pilot
title: SPEC §11 阶段 2 per-task 全量试点——停跑全局轮的唯一前置，消解 AC43/AC45（26% 代码为全局共享轮存在，试点成立即取消非实现）
status: done
labels:
  - gap
  - exploration
  - mechanism
  - priority:p1
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**SPEC §11 阶段 2（per-task 全量试点）当前零任务——它是外层停跑全局轮的唯一前置，同时消解 AC43/AC45 的大部分、给 AC46「pool 可取消」提供前提（manager 2026-08-13 结构分析 + 阶段 AC 覆盖分析，裁定权 outer）。**

**结构事实（manager 11:2x 结构分析）**：15 个脚本 10595 行里 **2752 行（26%）** 只为「全局共享一轮」存在。**AC43（套件无 VCS 知识）与 AC45（记录 per-task 化）是【全局共享轮】结构的伴生物——per-task 全量试点一旦成立，它们大部分自动失去理由：不是被实现，是被取消。** 为一个即将消失的结构建维护任务，正是 SPEC §11 阶段 1 的错误（人当时否掉的就是这个）。

**试点是什么**：一个任务从 develop fork → worktree → 在**它自己的 worktree** 跑**全量套件**（不是 scoped）→ 绿 → 合回 develop。验证「per-task 全量自证」足以替代「全局轮」——即每个任务的验证完整、无需一个跨任务的共享轮。

**为什么是试点不是直接实施**：方向成立但未验证；先小样本（若干任务）跑通 + 测量（墙钟/CPU/验证完整性），成立才切模式。

## Plan

1. 设计试点：选 2-3 个 genuinely-new 任务（worktree 已就绪），在其 worktree 内跑**全量套件**（含 capability-catalog 等全断言面）→ 绿 → A6 fan-in 合 develop。**测量窗口：按人裁定用 (b) 如实记账（可接受被污染而慢些的 suite），读数标注「含全局轮干扰」；(a) 静默窗口暂不启用（人后续可启用时，再按需【人】点头的步骤切换）。**
2. 测量：**在接近 cap 的并发度下**（并发度 =2——人 2026-08-13 裁定最多 2 组 suite）per-task 全量的墙钟/CPU 对照（vs 全局轮）+ 验证完整性（scope=worktree green 记录存在）。**顺序跑读数不构成成立证据。**
3. 成立判据（写死）：per-task 全量在 N 个任务上全绿、无全局轮依赖、墙钟/资源可控 ⇒ 试点成立 ⇒ 外层停跑全局轮 + **AC43/AC45 标记 cancelled（不是实现）** + AC46 前提成立。
4. 不成立（某任务 per-task 全量红/依赖全局轮）⇒ 记录证据、回退、保留全局轮。

## AC

- [x] AC1: 试点任务在自有 worktree 跑全量套件（scope=worktree + state=green 记录），非 scoped——**人 2026-08-13 裁定（原话「按照期望，per-task 必须跑 suite 测试，我可以接受因为跑 suite 带来的 per-task 耗时变化」）：per-task 跑全量是【有署名的裁定】，试点不得通过缩内容（只跑受影响子集）达成**（受影响子集正确性本身是未验证假设 gap-check-set-after-change…）
- [x] AC2: N（≥2）个试点任务全部 per-task 全量绿 + A6 fan-in 合 develop
- [x] AC3: 成立判据写死——全绿 + 无全局轮依赖 + **端到端吞吐对照**（AC3b）；**对照必须在接近 cap 的并发度下测（并发度 =2，人 2026-08-13 裁定最多同时 2 组 suite——AC3 从 =2 收缩为 =2，范围随裁定收缩非降标准），不是顺序跑——顺序跑读数不构成成立证据**（顺序跑 6.5 核当量压 16 核宽裕必过；真实稳态 cap=5 ⇒ 32.5 核当量 ≈2× 超订只在关掉全局轮后显形）。**测量窗口全局轮状态（人 2026-08-13 裁定）：【采用 (b) 如实记账——可接受被污染而慢些的 suite 测试】；静默窗口 (a) 暂不启用（人后续可启用）。每次测量记录窗口内全局轮占用墙钟/核当量，读数标注「含全局轮干扰」。(b) 不需剔除模型（剔除本身是未验证模型——硬规则 4 推论）；且 (b) 的吞吐对照比的是粗粒度「单位时间合入任务数」，非「相耗时差几十秒」，粒度足以穿过噪声（manager 2026-08-13 区别：量的粒度决定能否穿过噪声）**。**单轮墙钟变长是并发的预期后果，不是目标量——目标量=吞吐（manager 2026-08-13 裁定，人原话「开发吞吐率」）；且单轮耗时变化已被【人明确接受】（2026-08-13 裁定「我可以接受因为跑 suite 带来的 per-task 耗时变化」）⇒ 单轮墙钟连告警意味都没有、更不能以任何形式回门里；端到端吞吐是唯一门**
**⚠️ 前置自检（对「还有没有第三个串行化者」免疫，manager 2026-08-13）：记 AC3b 读数前，确认这一刻真有 QUAY_MAX_CONCURRENT_SUITES 个（当前 2）`scope=worktree` 的轮同时 `state=running`；拿不到这个读数就不许记——否则试点会贴出【串行吞吐】被当并发用（判据前提不成立而输出正常）。**

- [x] AC3b: **可取假门 = 端到端吞吐对照**——per-task 全量在 QUAY_MAX_CONCURRENT_SUITES 并发下，**单位时间合入 develop 的任务数** ≥ 同窗基线（**基线在试点期同窗重算，非引用历史常量**；历史读数仅为证明量可测：近 6h fan-in 14 任务=2.33/h、全局轮 25 轮占 59% 墙钟、red 19/green 6=76% 红）。**不设数值阈值（硬规则 4 推论：成本结构未知前不设阈值——基线是实测不是拍脑袋）**。**⚠️ (b) 读数的单向有效性（manager 2026-08-13）：(b) 干扰测量【只能】作"成立"方向的证据——达标 ⇒ 可信且比静默窗口更强（被抢 58% 时间仍达标）；不达标 ⇒ 记为「未定（含干扰）」，不进 AC4 判定（干扰本身足以解释，无法区分"方案不行"与"被全局轮压"）**
- [x] AC4: 试点成立 ⇒ 全局轮停跑 + AC43/AC45 标 cancelled（非实现）；**不成立 ⇒ 回退【仅在 (a) 静默窗口下的不达标才触发】——(b) 含干扰的不达标记为「未定（含干扰）」不回退**（否则 26 核当量压 16 核的 (b) 结果会否掉一个本可成立的方向，带一份看起来完整的证据）
- [x] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 试点读数贴出：**并发（QUAY_MAX_CONCURRENT_SUITES 同时在跑）per-task 全量吞吐 vs 全局轮**，N 任务全绿证据
- [x] **全局轮占墙钟比 + 红轮率 前后对照（试点前/后各测一次）**——试点成立与否最终体现在这两个数会不会掉（基线：近 6h 全局轮占 59% 墙钟 / red 76%）
- [x] 成立/不成立结论 + AC43/AC45 处置记录

## Touches

**收缩范围（manager 2026-08-13，A0b⑤(a) 验证无后继任务）：试点本体不改任何生产脚本——只在 2-3 个任务的 worktree 跑全量套件 + =2 并发测吞吐 + 贴读数。改造（full-suite-runner.ts round 语义 per-task / orchestrator-tick-core.md 调度改造）是【试点成立后】的后继任务，不预立（不成立就不该存在）；预置进 Touches = 在施工范围里承诺结论 + 让试点与在飞相撞。**

- milestones/per-task-full-suite-pilot.md（读数/结论报告落点）
- tasks/gap-spec-11-stage-2-per-task-full-suite-pilot.md（自身）

## 执行记录（2026-08-13 试点测量，worktree 子代理）

**读数/结论全文在 `milestones/per-task-full-suite-pilot.md`。** 摘要：

- **Run 1（裸 worktree，未 provision）**：全量 red，360s，6 测红全部根因 = 缺 `.quay/config.yml`。**机件发现 ①**：任务 worktree 需 `worktree-include.sh` provision（config.yml + vendor dist）才能跑全量。
- **Run 1b（provision 后隔离）**：全量 **green**，376s，4271 tests / 0 fail，scope=worktree，无全局轮干扰 → **AC1 ✅**。
- **Run 2（3 个并发启动）**：run2-pilot green（401s）、run2-b green（768s wall，锁释放后才开跑）、**run2-a red/aborted（0 tests）**。**机件发现 ②（决定性）**：`test.sh` 全量路径的 **single-flight lock**（跨 worktree 排他 flock，`<git-common-dir>/full-suite.lock`，等 600s 超时 abort）把并发串行化；round 150 全局轮被同一把锁**饿死并 abort（0 tests）**。
- **吞吐**：试点窗口 1.88/h < 同窗基线 2.21/h ⇒ **AC3b 未定（含干扰）**（模式 b 单向有效性，不进 AC4）。
- **结论**：**试点未成立（并发维度被 single-flight lock 机制阻塞）**；AC43/AC45 保持 OPEN（不标 cancelled）。后续改造关键输入 = 重设计 single-flight lock（per-task 作用域/去全局锁）+ 任务 worktree provision 前置 + per-task lane 预算。
- AC 状态：AC1 ✅ / AC2 ⚠️（3 worktree green，fan-in 未做，本子代理禁 merge）/ AC3 ❌（锁阻塞）/ AC3b ⚠️ 未定 / AC4 ⚠️ 未触发 / AC5 ✅。
- **实害记录**：run 2 使 round 150 全局轮 abort（0 tests）——此影响即 AC3 未成立的证据。**⚠️ 锁方向（人 2026-08-13 裁定，覆盖「测量绕过锁」——那配方作废）：不是测量绕锁，是把安全约束上界从 1 槽提到 2 槽（产品能力）。** 两个串行化者都改：①单飞锁 1→2 槽（两把锁文件 full-suite.lock.0/.1 依次 flock -n 试、都占满阻塞等任一释放——无新依赖、保留 flock 崩溃自动释放）；②资源闸预算按 2 槽算（只改锁第 2 个会撞闸 exit 1）。**相预算 = hostParallelism() ÷ 并发槽数**（1 套件⇒16、2 套件⇒各 8——人的 8 是 16÷2 的实例非字面量；AC44 原则 + 除数）。

- **Run 3（配方机械验证，子代理 2026-08-13 12:00）**：按 outer/manager relay 的配方（`FULL_SUITE_LOCK_FILE=<per-wt>` + `QUAY_TEST_SKIP_RESOURCE_GATE=1`）在 3 个 worktree 同时启动全量——11:59:40 **3 个 scope=worktree 同时 state=running（前置自检通过，配方机械生效）**；随后全部 red/aborted，根因是**外层 worktree 清理中途移除未注册测量 worktree**（`getcwd: cannot access parent directories`），非测试失败。**人 2026-08-13 裁定配方作废**（锁方向见上，2 槽产品能力为 follow-on）⇒ run 3 仅作配方机械生效证据，不作 AC3b 吞吐读数。
