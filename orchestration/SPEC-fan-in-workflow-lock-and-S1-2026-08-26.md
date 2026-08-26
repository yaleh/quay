# SPEC：fan-in workflow 锁 + S=1 —— 锁住 merge 阶段、消除 ff-race 整份作废

**作者**：manager｜**日期**：2026-08-26｜**状态**：proposal，**待 outer 立案、待人裁定排期**
**来源**：人 2026-08-26 18:5xZ 提出方案（逐字见 §0.1），manager 检查现有锁机制后出五点分析（§3），
奉命「整理成 SPEC 投 outer 立案」。前置数据见同日 manager 的 24h fan-in 统计（52 suite / 28 任务 /
46% 次数 / 62% 墙钟由 ff-race 整份作废，已投 outer 并补进 `gap-fan-in-failure-semantic-subagent`）。

---

## 0. 一句话

**把 fan-in 的「merge 锁」从毫秒级 `git merge --ff-only` 扩大到「整个 fan-in workflow（merge develop
→ 全量 suite → ff）」，使 develop 在有锁任务 fan-in 期间【不前进】、ff 结构上不输；suite 单飞锁 S
改为 1（fan-in 锁已串行化 fan-in 内的 suite）；两把锁都挂 driver 看门狗。**

### 0.1 人的方案（逐字，⛔ 不得意译）

```
* 为整个 fan-in workflow 加锁，保障有锁的任务不会被别的任务的 merge 干扰。
* 显然这个 fan-in workflow 锁和上述 suite/bucket 测试锁两个锁一起工作有风险。
  * 但这是必要的：它们锁的对象不一样。suite/bucket 测试锁是为了保护算力资源。
    在 fan-in workflow 外仍有可能运行 suite/bucket 测试。
  * 应当为 fan-in workflow 锁也应用包括进程和 driver 的看门狗机制。
* 显然应用这一机制后，应当将 S 改为 1。
```

---

## 1. 现状：ff-race 是「merge 阶段无锁」的直接后果（实测，非推演）

### 1.1 ff-race 的窗口

`fan-in-execute.js` 注释原文：「ff 失败（develop 前进，窗口 = **merge 到 ff 之间的整个 suite 时长**）」。

现有 fan-in 流程：
```
无锁段（caller，task worktree 内）：merge develop → delta 断言面判定 → ts-typecheck → scoped 门 + 全量 suite + doc
持锁段（fan-in-ff-merge.sh）：acquire merge lock → git merge --ff-only → release（毫秒级）
```

**merge 锁只覆盖「ff 这个毫秒级动作」，不覆盖「全量 suite 的 19+ 分钟」**。在这 19 分钟里，
别的任务可以 merge 到 develop（毫秒级 merge 锁挡不住，因为它只锁 ff 那一瞬），于是本任务的
`git merge --ff-only` 撞上「develop 已前进」→ `Diverging branches` → 整份作废重跑。

### 1.2 24h 实测代价

| 指标 | 数值 |
|---|---|
| fan-in 任务数 / suite 总运行 | 28 / 52 |
| suite 真红（测试自身失败）| **0 次**（52 全绿）|
| ff-race 失败 | 27 次（27/28 = 96.4% 任务撞上）|
| 额外 suite 运行（=ff-race 重跑）| 24/52 = **46.2%** |
| 白费墙钟 | 11.02h / 17.80h = **61.9%** |
| 终局样本 | load-sampler-orphan 8 次 suite 全绿、ff 输 7 次 → needs-human（白费 5.1h）|

### 1.3 现有机制已「部分治本」，本 SPEC 是「彻底治本」

`fan-in-ff-merge.sh` 已有 **inert-increment 分类**（`--classify-delta`）：ff 失败时若 develop 增量是
INERT（tasks/doc/telemetry）→ 持锁 re-ff（不重跑 suite）；NON-inert（code）→ 写 retry 重跑。

**24h 的 27 次 ff-race 全是 NON-inert**（code 增量，别的任务 merge 代码）。inert 分类只救 doc 增量，
**救不了 code 增量**——而那正是 46%/62% 的来源。本 SPEC 的 fan-in 锁让「code 增量」也**不发生**
（develop 在 fan-in 期间不前进）。

---

## 2. 设计：fan-in workflow 锁 + S=1

### 2.1 fan-in 锁的粒度与语义

- **粒度**：从「merge develop」到「ff 完成」的整个 fan-in workflow（含全量 suite 的 19+ 分钟）。
- **语义**：同一时刻最多一个任务持有 fan-in 锁；持锁期间任何其它任务不得 merge 到 develop。
  ⇒ 持锁任务的 ff 时，develop 自其 merge develop 起【未前进】，ff-only 结构上成功。
- **与 suite 锁的关系（两把正交锁）**：
  - suite 单飞锁（`full-suite.lock.0/.1`，S 槽）：保护**算力**——回答「几个 suite 同时跑」。
  - fan-in 锁（新）：保护 **merge 不被干扰**——回答「谁此刻能 merge develop」。
  - **在 fan-in workflow 外仍可跑 suite/bucket**（verification round、非 fan-in 的测试），这些只用
    suite 锁、不拿 fan-in 锁。

### 2.2 S=1 的推导

fan-in 锁串行化了「fan-in 内的 suite + merge」⇒ fan-in 内的 suite 已经一次一个。suite 锁 S 只需
覆盖「fan-in 外的 suite 测试」与「fan-in 内持锁前的 suite」⇒ S=1 足够。**S=2 的并行吞吐收益在
fan-in 锁串行化后本就拿不到**（suite 被 fan-in 锁串行），保留 S=2 只会留下「fan-in 外的 suite 并行」
这一个小口，收益极低、还保留 lane 预算除以 S 的复杂度 ⇒ 干脆 S=1。

### 2.3 确定性 vs 吞吐（本 SPEC 的核心权衡，数据摊开）

| | 现状 S=2（无 fan-in 锁）| 本 SPEC S=1 + fan-in 锁 |
|---|---|---|
| suite 并行 | 2 并行 | 1 串行 |
| ff-race | 27/28 任务撞上，46%/62% 白费 | 结构上不发生 |
| 落地时间 | 不可预测（1～8 次～needs-human）| 可预测（1 次 suite 即落地）|
| 墙钟（等效）| 52/2 ≈ 26×时长 | 28×时长 |
| CPU 浪费 | 46% | 0 |

**⊢ 墙钟吞吐几乎打平（26 vs 28，慢 7.7%），但确定性完全不同**：现状有「8 次 suite 全绿却 ff 输 7 次、
最终 needs-human」的尾部风险（24h 已 2 个 needs-human）；本 SPEC 把尾部风险整个消掉。
**本 SPEC 不是「更快」，是「更确定 + 少烧 CPU」**。

---

## 3. 五个必须落地的约束（manager 检查后提出）

**约束 1：先确认「确定性 > 吞吐」是当前阶段需求。** 本质是用 7.7% 墙钟换「消除 5.1h 级尾部风险 +
零 CPU 浪费」。判据：24h 内 needs-human 反复出现（load-sampler + ac143）即证明尾部风险真实、值得换。

**约束 2：显式修订 AC4（`SPEC-fan-in-ff-merge-lock-2026-08-14`）。** 现有 AC4 逐字要求 merge 锁
「never overlaps a suite run」「两把锁覆盖范围不得交叉」。本 SPEC 的 fan-in 锁覆盖 suite + merge，
**与 suite 锁覆盖范围重叠**。⛔ 落笔前必须修订 AC4（fan-in 锁允许 overlap suite run），否则协议检查器
（`fan-in-ff-protocol-check.ts`）恒红——那不是「新约束」，是「旧协议与新设计的冲突点」。

**约束 3：规定两把锁的固定获取顺序，消除死锁。** 持有顺序若不一致就死锁（fan-in 锁持有者 A 等
suite 锁，而 fan-in 外的 suite 占着 suite 锁又等 fan-in 锁）。**必须规定「先 fan-in 锁 → 再 suite 锁」，
任何路径不得反向**，且 fan-in 外的 suite 测试不得请求 fan-in 锁。

**约束 4：fan-in 锁看门狗挂 driver 下。** fan-in 锁持有时间 = suite 时长（19+ 分钟），比毫秒级 merge
锁长 4 个数量级。持有者崩溃/挂死 → 锁泄漏 → 所有 fan-in 永久堵。必须复用现有 suite 锁看门狗模式
（`FULL_SUITE_LOCK_HOLD_MAX_S` + `spawn_suite_lock_hold_watchdog` 的「持锁进程子进程」），且
**「谁保证 fan-in 锁看门狗活着」的递归问题已有答案**——driver 的 respawn 循环监督（同 SPEC-suite-
lifecycle-and-failure-semantics §3 的 suite-driver kind）。

**约束 5：明确与 `gap-fan-in-failure-semantic-subagent` 的取舍——二选一，不是叠加。** 若 fan-in 锁
让 ff-race 归零，语义 subagent 的 AC3（`outcome_class=ff-race-loss` 走 `rebase-and-retry`）就变成
**处理一个 0 发生率的 class**——这是 24h 统计里「advanceRetryCap 为 0 发生率保留整份重跑」的镜像：
反过来为 0 发生率造恢复路径。**落本 SPEC，语义 subagent 的 ff-race 部分应砍掉或降级**（它仍处理
suite-red / infra-hang 的语义分类）。

---

## 4. 与已立案方案的关系（⛔ 防重复，实现方必读）

| 已立案 | 与本 SPEC 的关系 |
|---|---|
| `gap-fan-in-ff-ref-update-detach-develop`（ff 改 ref 更新）| **互补不重复**：它解决「clean tree 阻塞 ff」，不解决「develop 前进」。两者可并存（ref 更新 + fan-in 锁）。 |
| `gap-fan-in-failure-semantic-subagent`（outcome_class 分类）| **部分重叠**：ff-race-loss 这个 class 与 fan-in 锁「二选一」（§3 约束 5）。suite-red / infra-hang 分类仍保留。 |
| `gap-suite-concurrency-S-two-source-divergence`（cd72672e4）| **前置相关**：本 SPEC 的 S=1 会经过同一套「两处读 S」的链，先修分叉（统一读 `.concurrency` 文件）再落地 S=1。 |
| `gap-suite-serial-lowconc-classification-recheck`（AC3 buckets 取锁）| **前置相关**：fan-in 锁假设 suite 锁在 buckets 路径也生效（AC3 已写只差落地），否则 buckets suite 绕过 suite 锁。 |

---

## 5. 建议排期

```
先：gap-suite-concurrency-S-two-source-divergence（统一 S 读取，S=1 才有单一来源可改）
     gap-suite-serial-lowconc-classification-recheck AC3（buckets 取锁，suite 锁才覆盖全路径）
再：本 SPEC 的 fan-in 锁 + S=1（落地时显式修订 AC4 + 固定获取顺序 + driver 看门狗）
并：同步裁决 gap-fan-in-failure-semantic-subagent 的 ff-race-loss 部分去留（§3 约束 5）
```

---

## 6. 本 SPEC 明确不做的事

- ⛔ 不改 detach-develop 的 ref 更新方向（它解决 clean tree，与本 SPEC 正交）。
- ⛔ 不删语义 subagent 的 suite-red / infra-hang 分类（只砍 ff-race-loss 去留，见 §3 约束 5）。
- ⛔ 不为此设「锁持有超时秒数」数值阈值——成本结构未测量前不设（硬规则 4 推论），看门狗阈值沿用
  现有 `FULL_SUITE_LOCK_HOLD_MAX_S` 的实测基准再定 fan-in 锁自己的值。

---

## 7. manager 的边界声明

本 SPEC 由 manager 撰写（`orchestration/SPEC-*` 属人 2026-08-10/14 裁定的 manager 豁免面）。
**manager 未写任何 `tasks/*.md`、未改任何实现代码**。立案形状（拆几条、AC 怎么写、优先级）归 outer；
实现归实现方。文中所有 `file:line` 与 24h 实测数字均为 manager 直接读码/读载体所得，非采信自述。
