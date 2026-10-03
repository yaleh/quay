# SPEC：goal 独立分支（goal branch）—— 让成熟度不同的开发方向互不阻塞发布

**作者**：会话 `goal branch discussion`｜**日期**：2026-10-03｜
**状态**：**ruled**（设计点全部裁定；§9.2 只剩实现期残留，不需人裁定）——人 2026-10-01→10-02 裁定 §1 ①–⑨；2026-10-03 裁定 §5 的 B1/B2 方案、
最终 fan-in 红后的修复路径、历史形态、以及「并入后判 + 人工触发并入」（§1 ⑩–⑭）；同日人追加两个约束（⑮⑯），引出预览实例（§4.10）；同日裁定 Q6–Q12（§1 ⑰–㉓）。
**来源**：人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论后人要求成文。
**前置阅读**：
- `SPEC-release-and-hotfix-branching-2026-09-15.md`（现行分支拓扑：`master` / `develop` / `author` / `task/<id>` / `release/*`——**本 SPEC 在它之上增加一条临时线**，不改其它任何线的角色）
- `SPEC-per-task-suite-verification-2026-08-13.md` + `orchestration/archive/AC58-retired-clauses.md#R22/R23`（integration 分支的退役理由——§2 逐条对照）
- `adr/ADR-015-…`（driver 分支退役）、`adr/ADR-034-fan-in-workflow-driver-holder.md`（fan-in 锁生命周期 = 进程生命周期）
- `SPEC-goal-mechanism-2026-09-06.md`（goal 数据模型；§3.4「派生量一律不存储」）

**证据标注**：【读码】= 起草时读当前源码（2026-10-03，主检出 `author`）；【转引】= 引自其它 SPEC/ADR；【人裁定】= 本次讨论中人的原话或选项。⛔ 未标注来源的断言不得进入本文件。

---

## 0. 一句话

**一个 goal 可以 opt-in 一条 `goal/<GOAL-NNN>` 分支：为它服务的任务（以 `goal_ac` 识别）从该分支开 worktree、fan-in 回该分支，
每次落地时顺带把 `develop` 追平进来；人在 goal 的预览实例上试用，pre-merge AC 也在那里求值；pre-merge AC 全部达成后由人触发并入（`--no-ff` 一个合并提交），worker-driver 经一次全量验证把整条分支 fan-in 到 `develop` 并删除分支；
之后 goal 按现有机制（含只能在 develop 上判的 post-merge AC）走到 `achieved`。
放弃的 goal 直接丢弃分支。**

⚠️ **按现有代码直接实现会死锁**：goal 判据在主检出上求值（§5 B1），任务状态翻转落在 mergeTarget 上（§5 B2）——
只接上 `mergeTarget` 而不解决这两点，goal 永远不会 `achieved`，任务会被反复派发。**这两点是本 SPEC 的核心设计内容，不是实现细节。**

---

## 1. 人的裁定（本文件其余部分都是它们的展开）

| # | 日期 | 裁定 | 来源 |
|---|---|---|---|
| ① | 10-01 | goal 可选一个自己的 branch；为该 goal 开发的 task 均先 fan-in 到该 branch；goal 完成后整个 goal branch 再 fan-in 到 develop | 【人裁定】原话 |
| ② | 10-02 | 动机：「会有一些较大的改进，需要足够成熟后才适合 merge 到 develop 和发布。但当前的机制，几个开发方向（如 goals）并行时，任务会交替 fan-in，无法区分。甚至一个方向的实现有问题，会堵着所有的发布。」 | 【人裁定】原话 |
| ③ | 10-02 | 漂移控制：**每个任务落地时顺带追平 develop**（不是只在 goal 完成时一次性合并） | 【人裁定】选项 |
| ④ | 10-02 | **opt-in**：每个 goal 显式开启；未开启的 goal 行为不变 | 【人裁定】选项 |
| ⑤ | 10-02 | 「成熟」= AC 达成只是必要条件；**断言者沿用当前判断 goal 完成的元语**（不新造 gate 类型）——落点见 §4.7 | 【人裁定】选项 + 原话 |
| ⑥ | 10-02 | 每个 goal branch 有自己独立的 fan-in 锁 | 【人裁定】原话 |
| ⑦ | 10-02 | `target-identity-literal-check.ts` 从字面量集合改为「模式匹配 + 存在性校验」 | 【人裁定】同意 |
| ⑧ | 10-02 | `goal_ac` 标注成为强依赖，是采用期最大的人为失误面，须在文档/校验里强调 | 【人裁定】同意 |
| ⑨ | 10-02 | goal 被放弃/supersede：**分支废弃**；如需救出变更，由人工提出并单独驱动执行 | 【人裁定】原话 |
| ⑩ | 10-03 | B1：接受「每个 branch-mode goal 一个 detached 判据 worktree」 | 【人裁定】 |
| ⑪ | 10-03 | B2：接受「`done` = 已落到 mergeTarget」的语义改变与状态双写 | 【人裁定】 |
| ⑫ | 10-03 | 最终 fan-in 红后：走现有 gap-filing 立任务，落 goal 分支 | 【人裁定】 |
| ⑬ | 10-03 | 历史形态：「历史上发生的形态不是堵住发布，而是多个 goal 的变更混在 develop 里」——读数见 §2.1 | 【人裁定】原话 |
| ⑭ | 10-03 | Q5 取 c（并入后判）：「现在看来也只有 Check after merge 可行了。当然，这会要求在 Goal 进入 Done 之前就 merge。那么，这一 merge 就必须人工触发。」——落点 §4.7 | 【人裁定】原话 |
| ⑮ | 10-03 | 「提出这一机制的目的之一就是为了在 merge 到 develop 之前可以试用和验证。这一目的如何实现？」——**并入前必须能试用**，⛔ 不能把试用推到并入之后 | 【人裁定】原话 ⇒ §4.10 |
| ⑯ | 10-03 | 「在 goal branch merge 到 develop 后继续检查一些 AC 问题不大」，问题在于「如果需要继续修改，是在 goal branch 还是 develop？」 | 【人裁定】原话 ⇒ §4.11 |
| ⑰ | 10-03 | Q6：维持 §4.9（报告 `goal-branch-untagged-overlap` 读数，攒发生率），首个 branch-mode goal 跑起来后再看 | 【人裁定】⇒ §4.9 |
| ⑱ | 10-03 | Q7：必拦 goal 非 active / 非 branch-mode / 分支不存在 / 已并入；pre-merge AC 未全部 achieved ⇒ 拒绝，允许 `--override "<理由>"`、理由进 GateEvent；sufficiency 判据只展示不拦 | 【人裁定】⇒ §4.7 |
| ⑲ | 10-03 | Q8：`--no-ff` 产生一个合并提交，再把 develop ff 到它（develop 仍只做 ff） | 【人裁定】⇒ §4.7 |
| ⑳ | 10-03 | Q9：**自动重试**——「重要的是 goal 的业务目标，不是单个 task 的描述。」 | 【人裁定】原话 ⇒ §4.7 |
| ㉑ | 10-03 | Q10：不允许同一 goal 重开分支；需要隔离就立新 goal、`supersedes` 旧 goal | 【人裁定】⇒ §4.1、§4.11 |
| ㉒ | 10-03 | Q11：goal-driver 负责刷新预览 worktree；serve 由人用 `quay goal preview <GOAL> start\|stop` 起停；没起 serve ⇒ live-probe AC 判不出 ⇒ 不能并入，「人确实试用过」成为并入前置条件 | 【人裁定】⇒ §4.10 |
| ㉓ | 10-03 | Q12：复制主检出 `.quay/` 只读快照，预览内写操作随刷新丢弃；⛔ 预览代码不读写生产数据 | 【人裁定】⇒ §4.10 |

---

## 2. 它与两次已退役的「中间分支」有什么不同

本仓库两次退役过「任务先汇入中间分支、再进 develop」的形状（ADR-015 driver 分支；2026-08 的 `develop + integration` 两线）。
本 SPEC **不是**第三次重来，区别必须逐条成立：

| 退役根因【转引 R22/R23、per-task SPEC §2】 | integration 分支 | goal branch |
|---|---|---|
| 共享面：所有方向的任务汇入同一条线 | 全局唯一 | **按方向分片**；未 opt-in 的任务照旧直落 develop |
| 漂移：`integration..develop = 187`，从不追平 | 无追平机制 | **每次任务落地都把 develop 合入**（裁定③，§4.4），漂移上界 = 该 goal 两次落地的间隔 |
| 脏树假证书：被测的树 ≠ 被合的树 | 批量、周期性、在共享树上验证 | **验证单元仍是单任务隔离 worktree**；最终 goal→develop 也是一次隔离的全量验证，且在锁内 ff-only（§4.7） |
| 合入频率 | 持续 drip | goal→develop **只发生一次** |

**⊢ 仍然继承的风险**：一个长期不落地的 goal 分支会变旧（追平只在落地时发生）。§4.4 末给出补救；不作为前置（硬规则 12，无发生率读数）。

### 2.1 历史读数：多个 goal 的变更在 develop 上混在一起（裁定⑬，硬规则 12b）

【git 实测 2026-10-03】窗口：`develop` 上 2026-09-03 起的机械 fan-in 翻 done 提交（`翻 <id> done（driver 机械 fan-in）`），
每条在**该提交时刻**用 `git show <sha>:tasks/<id>.md` 读 `goal_ac`，再经 `goals/AC-*.md` 的 `goal:` 映射到 GOAL。脚本 `/tmp/gb-interleave.mjs`（临时，未入库）。

| 量 | 值 |
|---|---|
| 翻 done 提交数 / 去重任务数 | 882 / 754 |
| 其中带 `goal_ac` 的提交数 / 去重任务数 | 305 / 270 |
| **不带 `goal_ac` 的提交数** | **577（65%）** |
| 涉及的 GOAL 数 | 23（最多：GOAL-009 65、GOAL-024 48、GOAL-003 32、GOAL-020 19） |
| 305 条带 goal 落地按时间排序后的「同 goal 连续段」数 | **138**（平均连续段长 2.2） |
| 有落地的天数 / 其中 ≥2 个 goal 同日落地的天数 | 22 / **17** |

**读法**：一个 goal 的落地平均每 2.2 条就被别的 goal 打断一次；23 天里 17 天有多个方向同日混入。
这就是裁定⑬说的「混在 develop 里」的实测形态——**它是常态，不是偶发**。
**本机制上线后的对照量**：对 branch-mode goal，它在 develop 上的连续段数应恰为 **1**（一次并入）。

**⊢ 同一读数暴露的第二件事**：65% 的落地不带 `goal_ac`。这些任务在本机制下一律直落 develop——裁定⑧的风险量级由此可见，见 §4.9（已裁定⑰：先报告、攒读数）。

---

## 3. 现状盘点（读码，2026-10-03）

| 事实 | 位置 | 对本 SPEC 的意义 |
|---|---|---|
| goal 是独立记录类型，schema 无 branch 字段；task 只经 `goal_ac` 单向指向 AC | `goal-store.ts:643-671`；`docs/references/task-schema-canonical.md:99-122` | 需要新增 opt-in 字段；任务→goal 的解析链 `goal_ac → AC.goal → GOAL` 已存在 |
| goal status 枚举 `draft/active/achieved/superseded/retired/needs-human` | `abi.ts:103` | 生命周期挂钩点现成，无需新增状态 |
| goal `achieved` 唯一机械写入点；判据 = I2 ∧ sufficiency `covered` ∧ 无 close-block | `goal-driver.ts:3407,3421`；`goalFlipDecision` `:869` | 裁定⑤的落点（§4.7） |
| fan-in `mergeTarget` 全链路已支持，但生产派发从不传，永远落默认 `develop` | `worker-fan-in.ts:1557`；`worker-driver.ts:4238` | 主要接线点；**不是新机制** |
| `?? "develop"` 形态的默认值共 **20 处 / 17 个文件**（前 3 条：`defect-latency-pair.ts:755`、`anti-drift-touches-check.ts:405`、`quay-init.sh:1927` 注释） | 起草时 grep（ERE，已对已知实例 `worker-fan-in.ts:1557` 干跑命中） | 影响面上界；不是每一处都需要改（§6） |
| ff-merge 的源分支硬编码 `refs/heads/task/${task}` | `fan-in/ff-merge.ts:562,825,911,980` | goal→develop 的最终合入不能直接复用，须参数化源分支 |
| fan-in 锁 `acquireFanInLock` 已接受可选 `lockFile` | `worker-fan-in.ts:980-988` | 裁定⑥的 N+1 锁域只需按分支派生锁文件名 |
| worktree 开设脚本已有 `--base <ref>`（默认 develop）及 fork-point 自检 | `dispatch-worktree-setup.sh:61,84` | 从 goal 分支开 worktree 已有入口 |
| 分支模型只有 `develop` 一个落地基线角色 | `branch-model.ts:67` `LANDING_BASELINE_ROLE` | 需新增 goal 角色 |
| 身份字面量封闭枚举 | `target-identity-literal-check.ts:67` | 裁定⑦ |
| goal 判据 `cwd` = 主检出的 git root（3 个求值点） | `goal-store.ts:1789-1799, 2069, 2450` | **§5 B1** |
| 任务 `done` 翻转提交在任务分支上，随 ff 进 mergeTarget；落地判断读 mergeTarget | `worker-fan-in.ts` `flipTaskDone`（:1106 起） | **§5 B2** |
| suite-red 刹车 `consecutive_red` 结构上恒为 0（读的账本只有绿记录写入者） | `ready-pool-check.ts` `computeSuiteBlocking`；见 memory `suite-red-brake-reads-a-ledger…` | ⛔ 不能把「方向内红污染隔离」寄托在这个刹车上（§4.5） |

---

## 4. 设计

### 4.1 数据模型

- goal frontmatter 新增 **`branch: true`**（opt-in，缺省 = false = 现状）。字段只表达「开不开」。
- **分支名是派生量，不存储**：`goal/<GOAL-NNN>`（`SPEC-goal-mechanism §3.4`、硬规则 4b）。不允许人填任意分支名——这正是裁定⑦能做成「模式 + 存在性」校验的前提。
- 任务侧**不新增字段**：任务归属哪个 goal 分支 = `goal_ac → AC 所属 GOAL → 该 GOAL 的 branch 字段`，派发时解析（§4.3）。
- `branch` 只能在 goal 处于 `draft`/`active` 且分支尚不存在时改动；分支存在后改为 false ⇒ 拒绝（否则在飞任务的 mergeTarget 中途改变）；**并入后同样锁定，⛔ 不得重开**（已裁定㉑）。

### 4.2 分支生命周期

| 事件 | 动作 |
|---|---|
| goal 转 `active` 且 `branch: true` | 从当前 `develop` tip 懒创建 `goal/<id>`（⛔ 不在建档时创建——draft goal 可能长期不激活） |
| 该 goal 的任务落地 | 分支前进（§4.4） |
| pre-merge AC 全部 achieved ∧ 人触发 `quay goal merge` | worker-driver 执行 goal→develop fan-in（§4.7）；成功后删除分支与其判据 worktree；goal 仍 active，之后按现有机制走到 achieved |
| goal 转 `superseded` / `retired` | **丢弃分支**（裁定⑨）；删除前把分支 tip SHA 写入该 goal 的 `statusLog` reason，供人工救援时 `git branch <name> <sha>` 恢复——这是唯一的留痕，不另建机制 |
| goal 转 `needs-human` | 分支保留不动，等人 |

### 4.3 派发：mergeTarget 解析

- 在 `worker-driver.ts:4238` 的 `spawnMechanicalFanIn` 调用前，以及开 worktree 前，解析一次：
  `resolveTaskMergeTarget(task) = goal_ac 指向的 GOAL 为 active ∧ branch:true ∧ 分支存在 ? "goal/<id>" : "develop"`。
- 同一结果同时用于：`dispatch-worktree-setup.sh --base`、fan-in 的 `mergeTarget`、fan-in 锁文件选择。**单一解析函数，三处共用**——否则 fork 点与落点可能不一致。
- 解析结果写进派发记录（`dispatch-record.ts`），使「这个任务落到了哪条线」事后可查（直接回答裁定②的「无法区分」）。

### 4.4 任务 fan-in 到 goal 分支（含追平）

现有机械 fan-in 五步不变，只把「合入 mergeTarget」这一步扩为两次合并，**都在任务自己的 worktree 里做**：

1. `git merge goal/<id>`（同今天 merge develop）
2. **`git merge develop`**（裁定③的追平——放在任务 worktree 里，被该任务自己的全量 suite 一并验证）
3. anti-drift / typecheck / scoped gate / 全量 suite（不变）
4. 持 **goal 分支锁** → flip done → ff `goal/<id>` 到任务 tip

**为什么追平放在任务 worktree 而不是单独对 goal 分支做**：goal 分支没有自己的工作树可以做 merge commit；放进任务 worktree 后，「追平后的树」恰好就是被全量 suite 验证过、随后被 ff 的那棵树——没有一棵未经验证的中间树。

**anti-drift 的 diff 基准**：仍取 `mergeTarget...HEAD`（`anti-drift-touches-check.ts:405`）。追平合入的 develop 变更会出现在这个 diff 里 ⇒ **基准必须改为「goal 分支与 develop 两者合并基的并集」**，否则每个追平都会被判越界。这是实现期必须先做的一处改动。

**长期无落地的 goal**（§2 继承风险）：观察项。若出现「goal 分支落后 develop 超过 N 提交」的实测读数再加周期追平，⛔ 不作为首版前置（硬规则 12）。

### 4.5 方向内出错不传染 develop

隔离来自拓扑本身：goal 分支上的提交在 goal 完成前**不进入 develop**，所以一个方向的缺陷不会出现在 develop 上，也就不会堵 release（release 只从 develop 切，`SPEC-release-and-hotfix §4`）。
⛔ **不依赖** suite-red 刹车：它在 develop 上本身就不会触发（§3 末行）。按分支参数化刹车只在它先被修好之后才有意义，记为后续项。

### 4.6 每个 goal 分支独立 fan-in 锁（裁定⑥）

- 锁文件：`<git-common-dir>/fan-in.goal-<GOAL-NNN>.lock`，经 `acquireFanInLock({ lockFile })` 获取；develop 的锁不变。持有者仍是 driver 的非分离子进程（ADR-034 约束原样适用）。
- **加锁顺序固定为「goal 锁 → develop 锁」**：只有 §4.7 的最终合入同时持两把；任务 fan-in 只持一把。固定顺序避免死锁。
- 锁事件仍写 `.quay/fan-in-lock-events.jsonl`，增加 `lock` 字段区分锁域，供 `readFanInLockHold` 按锁域分别读。

### 4.7 goal → develop 的最终 fan-in

> **2026-10-03 改写**（裁定⑭）：原稿把触发挂在 `goal-driver.ts:3421` 的 `achieved` 写入上、由 goal-driver 执行。
> 两处都不成立：①裁定⑭ 要求并入**先于** achieved；②原稿的执行者本身就违反 DIR-131（人 2026-09-07：「task 落地由 task 机制驱动，goal 机制负责 task 以外的生命周期」，
> 由 `goal-driver-task-boundary-check.ts` 按位置强制，goal-driver 里出现 fan-in 载体引用即 RED）——起草时漏查。

**生命周期顺序（裁定⑭）**：

```
pre-merge AC 全部 achieved（在判据 worktree 上求值）
  → 人触发并入请求（quay goal merge）
  → worker-driver 执行 goal→develop fan-in
  → 分支删除，goal 变回普通 goal（仍是 active）
  → 全部 AC（含 post-merge）在主检出上照常求值
  → 现有 goalFlipDecision（I2 ∧ sufficiency ∧ 无 close-block）写 achieved
```

**⊢ I2 不需要改**：achieved 仍然要求**全部** AC achieved（裁定⑤ 的「现有元语」原样管 achieved）。变的只是**并入的前置条件**用一个子集（pre-merge AC）——
这比 §9.2 原 Q5-c 的描述代价小：原描述说「要改 I2」，在「并入先于 achieved」的顺序下不成立。

**⊢ 关闭前置多一条分支前置（2026-10-04 增补；来源：GOAL-904 合并演练直接量）**：上面的顺序图里「全部 AC
在主检出上照常求值 → 写 achieved」在**一个 AC 全是 pre-merge 的 branch-mode goal** 上会**先于并入**发生——
它并入之前就满足 I2 ∧ sufficiency `covered` ⇒ `goalFlipDecision` 把它提前翻成 `achieved` ⇒ `quay goal merge`
因 `goal-not-active`（只允许 active 的 goal 可并入）被拒 ⇒ **分支永远并不进去的死结**；人手工重开 `achieved →
active`，下一轮又被翻回。实测读数（GOAL-904）：statusLog `from: active to: achieved actor: goal-driver
reason: "I2: all ACs achieved + sufficiency covered"`，而同一时刻 `git merge-base --is-ancestor goal/GOAL-904
develop` 为假。
⇒ `goalFlipDecision` 的**调用处**多一条 close-block：goal 的 `branch: true` ∧ `goal/<id>` 仍存在 ∧ 又不是
`develop` 的祖先 ⇒ **不翻**，本轮读数在 `closeBlocks` 记一条 `blocked-unmerged-branch`（点名 goal 与分支 tip）；
分支不存在（从未创建 / 并入后已删）或已是 `develop` 的祖先 ⇒ 不拦（行为与现状一致）。
⛔ 不动 I2、⛔ 不动 sufficiency 判据、⛔ 非 branch-mode 的 goal 行为逐字不变；⛔ goal-driver 只读 git 引用，不读本仓落地载体（DIR-131）。
判据：`plugin/test/goal-driver-criterion-worktree.test.mjs` 的「并入 develop 之前不得被翻 achieved」用例
（三臂：并入前 `blocked-unmerged-branch` ∧ 仍 active；并入后下一轮才翻 `achieved`；同夹具里非 branch-mode
的同条件 goal 照常翻——负控制证明拦截只针对 branch-mode 的未并入分支）。

**AC 分类**（新字段，AC 记录上）：`phase: pre-merge | post-merge`，缺省 `pre-merge`。
**⑮ 之后的分界（10-03 修订）**：pre-merge AC 在**预览实例**（§4.10）上求值——预览实例有在跑的 serve，**live-probe AC 因此回到 pre-merge**。
post-merge 只留给「必须由**真实生产**跑过一段时间才产生读数」的 AC（典型：生产账本在落地后时间窗内记录数 ≥ N，硬规则 4 推论三）。
这类 AC 测的不是「新代码能不能用」，而是「上线后生产确实在用」——**它本来就是发布后的确认，不是试用**。
- **由立 AC 的人/agent 显式声明，⛔ 不按判据文本关键词自动判**（硬规则 2）。§5 B1′ 的 grep 只用来估量级，不用来分类。
- **缺省取 pre-merge 的理由（误分类的两个方向不对称）**：
  - 本该 post-merge 却标成 pre-merge ⇒ 在判据 worktree 上恒为 `not-evaluated` ⇒ **并入前置条件永远不满足 ⇒ 卡住且可见**（人会来看为什么）；
  - 本该 pre-merge 却标成 post-merge ⇒ 跳过隔离验证直接并入 ⇒ **静默丢掉隔离**。
  ⇒ 缺省选「出错时可见」的那一边。辅助读数：pre-merge AC 在判据 worktree 上以载体缺席（exit 3）收场 ⇒ goal-round 记一条 `maybe-post-merge` 提示。
- 只对 `branch: true` 的 goal 有意义；普通 goal 忽略该字段。

**goal-driver 在并入前对 post-merge AC 的行为**：不求值，读数记为 `not-evaluated`（理由 `pre-merge-phase`）；**⛔ 不进 gap 计算**——否则 gap-filing 会对一个结构上还不可能通过的 AC 立任务。

**触发：人工，CLI 动词** `quay goal merge <GOAL-NNN> --reason "<为什么现在够成熟>" [--override "<理由>"]`（goal 目前只有 CLI 面，无 MCP goal 工具）：
- 它**只记录请求**，不执行合并：向 `.quay/gate-events.jsonl` 追加一条 `goal-merge-request` GateEvent（actor / reason / 请求时的 `goal/<id>` tip SHA）。人的动作因此留下产物（硬规则 9），且不会在人的终端里阻塞一次 20 分钟的全量 suite。
- 拒绝条件（fail-closed，已裁定⑱）：
  - **必拦，不可越过**：goal 非 active / 非 branch-mode / 分支不存在 / 已并入。
  - **pre-merge AC 未全部 achieved ⇒ 拒绝**；带 `--override "<理由>"` 时放行，理由与当时未达成的 AC 清单写进请求事件——人能越过，越过留痕（硬规则 9）。
  - **sufficiency 判据只展示不拦**：动词输出里打印当前 verdict（`covered` / `insufficient` / `not-evaluated`）供人参考；它仍在并入后拦 `achieved`。

**执行者：worker-driver**（task 落地机制的所有者，ADR-034 的锁持有者就在这里）。每轮读「待执行请求」——
**派生，不存储**：存在 `goal-merge-request` 事件 ∧ `goal/<id>` 存在 ∧ 非 develop 祖先 ⇒ 待执行。

**步骤**（复用机械 fan-in，源分支参数化）：
1. 持 goal 锁（挡住新的任务落地）→ 持 develop 锁（固定顺序，§4.6）
2. 临时 worktree 检出 develop（detached），`git merge --no-ff goal/<id>`（已裁定⑲：产生一个合并提交，提交信息含 GOAL id 与请求事件 id）
3. anti-drift（基准 develop）/ typecheck / scoped gate / **全量 suite**
4. 绿 ⇒ ff-only `develop` 到该合并提交（锁内 develop 不会动，ff-only 必然可行）；释放锁；删除 `goal/<id>` 与判据 worktree
5. 红或冲突 ⇒ 不落地，释放锁；请求仍「待执行」

**为什么是 `--no-ff`（⑲）**：整个 goal 经**一个合并提交**进入 develop ⇒ §7 庚可由祖先关系直接读（该合并提交的第二父含全部并入前落地、第一父不含）；需要整体撤出时 `git revert -m 1 <合并提交>` 一步完成（§4.11）。develop 本身仍只做 ff——合并提交是在锁内、在临时 worktree 里造好并经全量 suite 验证后，develop 再 ff 到它，「develop 上每个提交都是被验证过的树」不变。
**实现代价**：`fan-in/ff-merge.ts` 今天只会「把目标分支 ff 到 `task/<id>` tip」（`:911`），需要支持「源 = 临时 worktree 里造出的合并提交」。

**落地与否读直接量**：`git merge-base --is-ancestor goal/<id> develop`（或分支已删除）。⛔ 不新增 `landed` 之类的自维护字段（硬规则 4b）。

**失败升级（已裁定⑫）**：一次执行红只落痕；把「有并入请求 ∧ 最近一次执行红」作为一个新的 gap 形态交给现有 gap-filing 语义 agent 立一个任务。该任务的 `goal_ac` 指向本 goal 的某个 AC ⇒ 按 §4.3 解析到 goal 分支，修复落 goal 分支。

**修复落地后自动重试（已裁定⑳）**：请求事件一直有效，直到分支并入或 goal 离开 active。worker-driver 在 `goal/<id>` tip **前进之后**的下一轮再执行一次——⛔ tip 没变就不重跑（同一棵树再跑一遍全量 suite 只是在赌 flake）。
- **人批准的是 goal 的业务目标，不是某一棵树**（⑳ 原话：「重要的是 goal 的业务目标，不是单个 task 的描述」）⇒ 请求事件里的 tip SHA 只记录「人当时试用的是哪棵树」，⛔ 不作为执行条件。
- **重试时重新套用请求时的前置条件**：pre-merge AC 在新 tip 上仍须全部 achieved；若原请求带 `--override`，override 只对它当时列出的那几个 AC 有效——修复期间若有**别的** pre-merge AC 由 achieved 变为失败，重试不执行，等人再次请求。理由：override 是人对具体缺口的知情放行，不是空白支票。
**gap 计算的归属**：「最近一次执行红」是 worker-driver 的 fan-in 读数，goal-driver 不得读（DIR-131）⇒ 这个 gap 形态**由 worker-driver 侧立案**，或 worker-driver 把结果写成 goal 侧可读的事件（`goal-merge-result`，不含 fan-in 载体路径）——实现期二选一，须先过 `goal-driver-task-boundary-check.ts`。

**并入之后、achieved 之前**：见 §4.11（修改落在哪里）。

**人的并入请求 = 「试用通过」的断言**（⑮）：`quay goal merge` 的 `--reason` 应写明试用了什么。请求事件记录的 tip SHA 是人试用过的那棵树；按⑳，修复后自动重试并入的树可以比它新——人对业务目标负责，自动重试只是把修复带进去。
**须注意的去重陷阱**：现有 frozen-violated gap-filing 只按 `goal_ac` 去重（memory `frozen-violated-dedup-keys-on-goal-ac-only`）——新 gap 形态必须带自己的去重键（如 `kind: goal-branch-unmerged` + GOAL id），否则会被同一 AC 上已有的任务吞掉，或反复立同一个任务。

### 4.8 身份检查（裁定⑦）

`target-identity-literal-check.ts`：保留现有 5 个字面量；另加一条规则——token 匹配 `^goal/GOAL-\d{3,}$` **且**该 GOAL 记录存在、`branch: true`、状态非 `superseded/retired` ⇒ 合法。读不到 goal store 时输出 `not-evaluated`，⛔ 不当作合法（硬规则 3b）。

### 4.9 `goal_ac` 纪律（裁定⑧）

- 文档：`docs/references/task-schema-canonical.md` 的 `goal_ac` 段加一条「对 `branch: true` 的 goal，漏标 = 变更直落 develop、绕过隔离」。
- 校验（首版为**报告，不阻塞**）：派发时若任务无 `goal_ac`、而其 `## Touches` 与某个 branch-mode goal 在飞任务的 Touches 重叠 ⇒ 在派发记录里写一条 `goal-branch-untagged-overlap` 读数。累计出实测发生率后再决定是否升级为阻塞（硬规则 12）。
- **复核时点（已裁定⑰）**：第一个 branch-mode goal 并入后，读该 goal 存续期内 `goal-branch-untagged-overlap` 读数的条数与前 3 条，再决定是否升级。


### 4.10 预览实例：并入前的试用与验证（⑮）

**一个 branch-mode goal = 一个预览实例** = ⑩ 的判据 worktree（detached 于 `goal/<id>` tip）+ 一个以该 worktree 为 workspace root 的 `quay serve`。
人在这里试用（Web UI 打开预览端口；CLI 用 `node <预览 worktree>/packages/quay/bin/quay.js …`），pre-merge AC 也在这里求值——**人试用的和判据验的是同一个实例、同一棵树**。

**为什么能与生产实例共存**【读码 2026-10-03】：
- `quay serve` 的准入锁按 workspace root 分（`serve.ts:375-403`，`.quay/server.lock` 在 root 下）⇒ 预览 root ≠ 主检出 ⇒ 互不排斥。
- serve 默认只托管 `web`、`control`（`cli/driver-vocab.ts:44` `HOSTED_SERVICE_NAMES`），**不带 driver** ⇒ 预览实例不会派发任务、不会抢生产 worker
  （memory `second-resident-worker-driver-adopts-production-workers`：第二个以生产 root 为 `--root` 的 worker-driver 会接管生产 worker——预览实例结构上不是这个形态）。
- live-probe 判据按「`cwd` = `git rev-parse --show-toplevel`」找 serve（例 `AC-288`）⇒ 在预览 worktree 里求值时自然匹配到预览 serve，**判据文本不用改**。

**起停归属（已裁定㉒）**：
- **预览 worktree**：goal-driver 负责创建、刷新、删除（它本来就要在这棵树上求值）。
- **预览 serve**：人用 CLI 起停——`quay goal preview <GOAL-NNN> start|stop|status`。`start` 以预览 worktree 为 workspace root、显式 `--port N≥1`、`node --watch` 启动；`status` 读预览 root 下的 `.quay/server.json`。
- **没起 serve ⇒ live-probe AC 读 `not-evaluated` ⇒ pre-merge AC 不全 achieved ⇒ `quay goal merge` 拒绝**（除非 `--override` 并留痕）。「人确实试用过」由此成为并入前置条件，不需要另设一个「已试用」标志。
- goal 并入或废弃时，goal-driver 删除预览 worktree 前先停掉其上的 serve（读该 root 的 `.quay/server.json` 取 pid）——否则留下一个 cwd 已消失的孤儿进程。

**预览实例读什么数据**：
（已裁定㉓）
- 任务/goal 记录：预览 worktree 自己检出的 `tasks/`、`goals/`（goal 分支带着每次追平进来的 develop 状态）。
- `.quay/` 运行时状态（gitignored）：新 worktree 里没有 ⇒ 每次刷新时**复制一份主检出 `.quay/` 的只读快照**进去（排除 `server.lock`/`server.json` 等实例身份文件——否则预览 serve 会读到生产实例的登记）（先例：任务 worktree 的 gate ledger 就是主检出 ledger 的快照，memory `task-worktree-gate-ledger-is-not-durable`）。
- **⛔ 不让预览代码读写生产数据**：预览里的 UI 写操作（改任务等）落在预览副本上，随刷新丢弃。goal 若改了数据格式，旧格式的生产数据不会被新代码写坏。（已裁定㉓）

**刷新**：任务落 goal 分支后，预览 worktree `git checkout --detach goal/<id>`；serve 以 `node --watch` 运行（CLAUDE.md 已有的开发模式入口，import 变更自动重启），不需要额外的重启逻辑。刷新与判据求值串行，避免判据跑在半更新的树上。

**已知冲突，必须先处理**：
- **孤儿 serve 回收器会杀它**：`worktree-process-reaper.ts --orphan-serves`（`:504`）回收「父进程已死 ∧ 不是主检出登记宿主」的 serve。后台启动的预览 serve 两条都满足 ⇒ 被当泄漏杀掉。须让回收器同时认可「pid 与其自身 root 下 `.quay/server.json` 登记一致」的 serve，或让预览 serve 由一个存活的父进程持有。
- **资源**：每个预览实例是一个常驻 node 进程；本机 cgroup 上限 6G，2026-09-17 全局 OOM 正是泄漏 serve 堆积所致。预览实例只在 goal active ∧ 分支存在时运行，并入/废弃时与 worktree 一起删除。
- **serve 无 supervisor**（memory `serve-has-no-supervisor…`）：预览 serve 死掉 ⇒ live-probe AC 读 `not-evaluated` ⇒ 并入前置条件不满足 ⇒ **卡住且可见**，不会误放行。

**试用不到的部分（如实记账）**：预览实例不跑 driver。goal 若改的是 driver / 循环机制本身，「试用」就等于让新 driver 处理真实工作——那就是生产。
⇒ **这类 goal 用 branch 模式得不到试用价值**，只得到「混入度 = 1」与可整体 revert。建议它们默认不开 branch（④ opt-in 已允许）；若要真试用，需要一个独立 clone 的影子工作区跑全套 driver（⛔ 不能用 worktree——worktree 共享 refs，影子 driver 的 fan-in 会推动真的 `develop`），**本 SPEC 不做**（§8）。

### 4.11 修改落在哪里（⑯）

**规则：由分支是否存在决定，任一时刻只有一个答案，不由人或任务声明。**
- 并入前：修改落 `goal/<id>`（§4.3 解析：goal_ac → goal 分支存在 ⇒ goal 分支）。
- 并入后：分支已删除 ⇒ 同一解析自动回到 `develop`。⛔ 不重开分支（已裁定㉑）：`branch` 字段在分支创建后锁定，并入后仍锁定；需要再隔离开发就立新 goal 并 `supersedes` 旧 goal——一个 goal 只有一段分支历史，「develop 上一个合并提交」才成立。

**⑮ 让「并入后还要改」变成少数情况**：试用与 live-probe 验证都发生在并入前，并入后只剩 post-merge AC（生产积累类）。
这类 AC 失败说明的是「上线后生产没按预期产生读数」——它与普通任务落地后发现的问题同性质，在 develop 上修与现状一致。

**仍可能出现的坏情况**：post-merge AC 失败暴露的是大问题，而 goal 代码已在 develop 上。两个出口：
- 小问题：普通任务修在 develop。
- 大问题：`git revert -m 1 <goal 合并提交>` 把整个 goal 撤出 develop（依赖⑲ 的 `--no-ff`），再立一个新 goal、`supersedes` 旧 goal，重新开分支开发。这是⑨「废弃」在并入后的对应形态，同样由人发起。

---

## 5. 起草时发现的两个阻塞问题（方案已裁定：B1 → ⑩，B2 → ⑪）

### B1：goal 判据在主检出上求值 ⇒ branch-mode goal 永远不会 achieved（**ruled ⑩**）

**事实**【读码】：AC criterion 的 `cwd` = goal 目录所在 git root，即主检出（`goal-store.ts:1789` 注释「Criterion cwd = the git root」，求值点 `:1799`、`:2069`、`:2450`）。主检出跟随 `develop`（`syncDevelopToDoc`）。
**后果**：goal 的代码只在 `goal/<id>` 上 ⇒ 判据看不到 ⇒ AC 不 achieved ⇒ goal 不 achieved ⇒ §4.7 永不触发 ⇒ 分支永不并入。**是死锁，不是延迟。**
**连带**：I5 sweep（`:1789` 所在函数）若在 goal 并入前对已 achieved 的 AC 复测，同样在主检出上跑 ⇒ 全部报 fail ⇒ 触发 gap-filing 立出一批假任务。

**方案（已裁定⑩）**：为每个 branch-mode goal 维护一个判据 worktree `quay-worktrees/goal-<GOAL-NNN>`，**detached HEAD** 于 `goal/<id>` tip（不检出该分支本身——若检出，`git push . task:goal/<id>` 的 ff 可能因「分支已在别的 worktree 检出」被拒，**需实测确认**），每次求值前 `git checkout --detach goal/<id>`。三个求值点按「AC 所属 goal 是否 branch-mode」选择 `cwd`。goal 并入 develop 后回到主检出。
#### B1′：live-probe 类 AC —— ⑩ 解决不了的那一部分（已裁定⑭⑮：并入后判 + 预览实例）

**定义**：live-probe AC = 判据不读仓库文件、而去**探测一个正在运行的进程**的 AC。本仓库的典型是 Web UI 类 AC：
判据先找 `cwd` 等于本仓库根的 `quay.ts serve` 进程，从它的 `/proc/<pid>/cmdline` 推出 host:port，再 `curl` 页面断言内容。
例：`AC-288`（zh/en 语言切换的 cookie 持久化）——判据首行 `root=$(git rev-parse --show-toplevel)`，再
`pgrep -f 'quay.ts serve'` 并要求 `readlink /proc/$p/cwd = $root`。

**存量**【读码 2026-10-03】：205 个 goal 记录中，判据含 `pgrep -f 'quay.ts serve'` / `live-web-address` / `curl` 的 AC **18 个**
（放宽到 `ss -l`/`lsof -i`/`/proc/*/cmdline` 为 23 个）；状态 21 achieved / 1 retired / 1 superseded，**当前 0 个 active**。
贡献最多落地的 goal 之一 GOAL-024（48 次，zh 导航）正是这类——**会开 branch 的「较大改进」恰恰最可能带 Web UI AC**，不是假设场景。

**为什么 ⑩ 不够**：判据 worktree 里没有在跑的 `quay serve`（`cwd` = worktree 路径）⇒ 判据走「载体缺席」分支，按约定 exit 3 = `not-evaluated`。
I2 要求**所有** in-scope AC 为 achieved ⇒ **只要 goal 带一个 live-probe AC，它在并入前就永远到不了 `achieved` ⇒ 回到 B1 的死锁**。
**⊢ 不只是 live-probe**【读码 2026-10-03，关键词估量，⛔ 不用于分类】：178 个带判据的 AC 中，另有 **46 个**读**生产载体**
（`.quay/*.jsonl` 等 gitignored 账本，前 3 条：`AC-177`（`.quay/goal-round.jsonl` verdict 记录数 ≥3）、`AC-181`、`AC-183`（`.quay/doc-develop-sync.jsonl`））。
这些账本只由**从主检出运行的生产 driver** 写入——goal 分支上的新代码在并入前根本没有在生产跑过，判据 worktree 里要么没有该账本、要么是主检出的旧快照。
⇒ 它们和 live-probe 同属「只能在并入后判」，合计约 **63 / 178（35%）**。这是硬规则 4 推论三（AC 必须读生产载体）在 goal 分支下的直接后果：**越是好的 AC，越只能并入后判**。

处理：已裁定⑭（并入后判，人工触发并入），机制见 §4.7 的 `phase` 字段。**⑮ 后修订**：live-probe 类（17）由预览实例（§4.10）在并入前求值，回到 pre-merge；只有生产载体类（46）中「需要生产跑一段时间」的那部分留在 post-merge。

### B2：任务状态 `done` 只落到 goal 分支 ⇒ 任务被反复派发（**ruled ⑪**）

**事实**【读码】：`flipTaskDone` 在任务 worktree 里提交 `status: done`，随 ff 进 mergeTarget；「已落地」判读 mergeTarget 的任务文件（`worker-fan-in.ts:1103-1106,1131-1133`）。而派发/晋升读的是主检出盘上的 `tasks/*.md`（CLAUDE.md 硬规则 11b），主检出跟 `develop`。CLAUDE.md 分支同步节：`develop` 是「任务状态唯一正源」。
**后果**：任务落到 goal 分支后，develop 上仍是 `ready`；worktree 回收后不再被排除 ⇒ **重新派发**。

**方案（已裁定⑪）**：把「代码落地」与「状态落地」分开——
- 代码：照 §4.4 进 `goal/<id>`。
- 状态：ff goal 分支成功后，经现有文档面写路径（主检出 `author` 上提交 + `propagateDocBranchToDevelop`）把同一个 `done` 翻转写到 develop。
- **`done` 的语义因此改为「已落到它的 mergeTarget」**，不再是「已在 develop 上」。所有以 develop 判落地的读者（§3：20 处 `?? "develop"` 中的落地类读者）要么改为按任务解析 mergeTarget，要么明确只对非 goal 任务生效。
- goal→develop 合入时 `tasks/*.md` 两侧都是 `done`；若仍冲突，按现有分支同步规则「develop 权威、`done>needs-human>ready>todo`」解决。

---

## 6. 影响面

| 面 | 改动 | 量级 |
|---|---|---|
| `goal-store.ts` | `branch` 字段 + 改动约束；3 个判据求值点选 cwd（B1） | 中 |
| `goal-driver.ts` | pre-merge/post-merge 分相求值；post-merge AC 并入前不进 gap；判据 worktree 维护。⛔ **不触发、不执行 fan-in**（DIR-131） | 中 |
| `cli/goal.ts` | 新动词 `goal merge`（前置条件 + `--override` + 追加 `goal-merge-request` GateEvent）与 `goal preview start\|stop\|status` | 小 |
| 预览实例（§4.10） | 预览 worktree 刷新 + `.quay/` 只读快照 + `node --watch` serve 的起停 | 中 |
| `worktree-process-reaper.ts` | `--orphan-serves` 认可「与自身 root 下 `.quay/server.json` 登记一致」的预览 serve | 小，但必须先做 |
| `worker-driver.ts`（goal 并入） | 读待执行请求、持两把锁执行 §4.7 步骤、失败留痕 | 中 |
| goal AC schema | `phase: pre-merge \| post-merge` 字段（`goal-store.ts` `OWNED_KEYS`） | 小 |
| `branch-model.ts` | goal 角色：创建 / 删除 / 枚举 | 小 |
| `worker-driver.ts` | `resolveTaskMergeTarget` + 三处共用（§4.3） | 小 |
| `worker-fan-in.ts` | 两次合并（§4.4）；锁文件选择；状态双写（B2） | 中 |
| `fan-in/ff-merge.ts` | 源分支参数化（今天硬编码 `task/`） | 小 |
| `anti-drift-touches-check.ts` | diff 基准改为两线合并基并集（§4.4） | 小，但必须先做 |
| `target-identity-literal-check.ts` | 模式 + 存在性（§4.8） | 小 |
| `?? "develop"` 其余默认值（20 处 / 17 文件） | 逐一分类：落地类读者改按任务解析；统计/历史类保持 develop | 需在实现期逐条列表，⛔ 不整体替换 |
| `SPEC-release-and-hotfix` | **不改**。release 只从 develop 切，未并入的 goal 自然不在 release 里——这正是裁定②要的 | 无 |
| author↔develop 同步 | **不改**。goal 分支与文档面无关 | 无 |

---

## 7. 判据草案（⛔ 本 SPEC 不写 goal store；编号与归属由立案时决定）

每条都必须读**生产载体**、且只计实现落地之后的时间窗（硬规则 4 推论三）：

- **甲**（隔离）：存在一个 `branch: true` 且未放弃的 goal，其至少 1 个任务落地后：未并入时该任务的翻 done 提交是 `goal/<id>` 的祖先而不是 develop 的祖先；已并入时它经合并提交的第二父可达、不经第一父可达。
- **乙**（追平）：同上 goal 的每次任务落地后，`git merge-base --is-ancestor develop@{落地时刻} goal/<id>` 为真。
- **丙**（状态不重派）：该任务落地后 24h 内，`orchestration/dispatch-record.jsonl` 中该任务 id 的派发记录数 = 1。
- **丁**（判据可见，B1）：该 goal 的至少 1 个 pre-merge AC 在 goal 并入 develop **之前**被 goal-driver 写为 `achieved`（gate-events 中有对应 pass，且时间早于并入提交）。
- **戊**（人工并入）：gate-events 中存在该 goal 的 `goal-merge-request`，其后 `develop` 包含该分支 tip，`goal/<id>` 已删除；且**不存在**无请求事件的 goal 并入（develop 上每个 subject 形如 `merge: goal/GOAL-NNN into develop` 的合并提交都能对上一条先于它的请求；⛔ 按祖先关系查找，不用 `--first-parent`，见 §7 末「判据的拓扑前提」）。
- **戊′**（顺序）：该 goal 的 `achieved` 写入时刻晚于并入提交时刻。
- **己**（放弃）：一个 `branch: true` 的 goal 被 `retired` 后，分支不存在，其 `statusLog` 含被删 tip 的 SHA。
- **庚**（混入度，§2.1 的对照量）：一个 branch-mode goal 并入后，develop 上恰有 1 个提到 `goal/<id>` 的合并提交，该 goal 并入前的全部任务落地都只经它进入 develop。
- **辛**（并入前试用，⑮）：至少 1 个 live-probe AC 的 pass GateEvent 早于其 goal 的并入提交，且该次求值的 `cwd` 是预览 worktree（不是主检出）。
  ⚠️ **现有 goal GateEvent 不记录 cwd**【实测 2026-10-03，`.quay/gate-events.jsonl` 的 `AC-272` 事件：字段只有 `id/item_id/gate/actor/verdict/timestamp/payload.reason`】⇒ 按硬规则 4c，这个量今天穿不过载体。实现须在 payload 里加 `evaluationRoot`（及求值时的 tree SHA），否则辛无法判。
- **判据的拓扑前提（2026-10-03 更正）**：⛔ 判据**不得**依赖 `git log --first-parent develop`。真实 fan-in 的形状是「任务分支先 merge develop 再 ff」，develop 的 first-parent 链因此会走进任务分支自己的历史，develop 一侧的提交落到第二父上——实测 2026-10-02 以来 32 个机械 fan-in 翻 done 提交中 **22 个（69%）不在 first-parent 链上**；goal 合并提交也会被后续落地挤出该链。本 SPEC 初稿的甲/戊/庚就是按 first-parent 写的，只在线性历史的合成夹具上验证过，所以：AC-321 对直落 develop 的演练任务误判通过，AC-325/327 在合并提交被挤出后会读成未评估。修订后判据一律用祖先关系（`merge-base --is-ancestor`），夹具一律按真实 fan-in 形状造（任务分支合 develop、后续落地挤出合并提交），并必须含「直落 develop 的任务后来被挤出 first-parent」这一反例臂。
- **反例检查**：关掉 §4.3 的解析（强制 mergeTarget=develop）后甲、庚必须变红——否则它们是回声。

---

## 8. 非目标

- ⛔ 不做嵌套（goal 分支下再开子分支）；compound 任务的父子关系仍不对应分支。
- ⛔ 不做影子工作区（独立 clone + 全套 driver）。改 driver/循环机制的 goal 在本 SPEC 下得不到并入前试用（§4.10 末）。
- ⛔ 不做 goal 分支之间的相互合并或依赖；两个方向若需要彼此的代码，先让其中一个并入 develop。
- ⛔ 不做自动救援 cherry-pick（裁定⑨）。
- ⛔ 不改 release / hotfix / master 的任何规则。
- ⛔ 不改未 opt-in goal 与无 `goal_ac` 任务的任何行为。

---

## 9. 裁定汇总与残留

### 9.1 已裁定（2026-10-03）

| Q | 裁定 | 落点 |
|---|---|---|
| 1 B1 方案 | 接受 detached 判据 worktree | §1 ⑩、§5 B1 |
| 2 B2 方案 | 接受 `done` = 已落到 mergeTarget + 状态双写 | §1 ⑪、§5 B2 |
| 3 最终 fan-in 红后谁修 | 现有 gap-filing 立任务、落 goal 分支 | §1 ⑫、§4.7 |
| 4 发生率 | 历史形态是「混在 develop 里」，不是「堵住发布」 | §1 ⑬、§2.1（实测：138 个连续段 / 17 of 22 天多 goal 混入） |
| 5 live-probe AC | c 并入后判、人工触发并入；⑮ 后 live-probe 由预览实例在并入前求值 | §1 ⑭⑮、§4.7、§4.10 |
| 6 未标注任务 | 先报告、攒读数，首个 branch-mode goal 并入后复核 | §1 ⑰、§4.9 |
| 7 `goal merge` 前置条件 | 必拦四项；pre-merge 未全达成拒绝、可 `--override` 留痕；sufficiency 只展示 | §1 ⑱、§4.7 |
| 8 提交形态 | `--no-ff` 合并提交，develop 仍只 ff | §1 ⑲、§4.7 |
| 9 失败后重试 | 自动重试（tip 前进后），tip SHA 只记录不作条件；override 只覆盖当时列出的 AC | §1 ⑳、§4.7 |
| 10 重开分支 | 不允许；立新 goal 并 supersedes | §1 ㉑、§4.11 |
| 11 预览起停 | worktree 归 goal-driver；serve 归人（`quay goal preview`） | §1 ㉒、§4.10 |
| 12 预览数据 | 主检出 `.quay/` 只读快照，写操作随刷新丢弃 | §1 ㉓、§4.10 |

### 9.2 实现期残留（不需人裁定，实现时就地决定并记入任务）

1. **goal 并入失败的 gap 由谁立案**：worker-driver 侧直接立案，或写一条 goal 侧可读的 `goal-merge-result` 事件由 goal-driver 立案——须先过 `goal-driver-task-boundary-check.ts`（§4.7）。
2. **goal GateEvent 加 `evaluationRoot` 与 tree SHA**：否则 §7 辛无法判（硬规则 4c）。
3. **孤儿 serve 回收器认可预览 serve**（§4.10）：`worktree-process-reaper.ts --orphan-serves` 认可「pid 与其自身 root 下 `.quay/server.json` 登记一致」的 serve。
4. **`?? "develop"` 的 20 处默认值逐一分类**（§6）：落地类读者按任务解析 mergeTarget，统计/历史类保持 develop。
5. **验证「分支在别的 worktree 检出时 `git push .` 是否被拒」**（§5 B1）：决定判据 worktree 是否必须 detached——现设计已取 detached，实测只用于确认这一选择的必要性。

### 9.3 起草时的选项与理由（档案，⛔ 不再是待裁定项）

**Q5（已裁定⑭ = c，保留选项表为理由档案）：带 live-probe AC 的 branch-mode goal 怎么到达 `achieved`**（§5 B1′）。起草时的三个选项：

| 选项 | 做法 | 代价 |
|---|---|---|
| a 禁止 | branch-mode goal 不允许有 live-probe AC；`branch: true` 写入时若已有此类 AC ⇒ 拒；给此类 goal 立 AC 时 ⇒ 拒 | 最简单；但 Web UI 类改进（最可能需要 branch 的那一类）只能用静态判据（读源码/渲染函数单测）代替真实页面探测，损失「真产品面」验证（ADR-010 的 `L_T`） |
| b 判据 worktree 起 serve | goal-driver 在判据 worktree 里起一个 worktree-local `quay serve`（显式 `--port N≥1`），判据按 `cwd` 匹配到它 | 最忠实；但多一个常驻进程 / goal，且有已知坑：`--port 0` 会走另一条载体分支（memory `worktree-local-serve-port0-forces-carrier-branch`）、本机 serve 无 supervisor（memory `serve-has-no-supervisor…`）——需要谁负责起停 |
| c 并入后判 | live-probe AC 标为「并入后判据」：并入前不计入 I2；goal 在其余 AC 全 achieved 时即触发并入；并入后在主检出上照常求值，失败则走现有 I5 | 不新增进程；但「并入 develop 时这些 AC 还没验过」——等于对这一类 AC 放弃了隔离的意义，且要改 I2 的定义（goal-mechanism SPEC 的不变式，需显式记账） |

起草者原倾向 b。**b 被否的原因**（裁定后补记）：b 只能救 live-probe 一类；§5 B1′ 的生产载体类（46 个）要求生产 driver 跑过新代码，worktree 里起一个 serve 解决不了 ⇒ 只有 c 对两类都成立。c 原表中「要改 I2」的代价在「并入先于 achieved」的顺序下不成立（§4.7）。

**Q6：65% 的落地不带 `goal_ac`**（§2.1）。§4.9 首版只报告不阻塞。但这些未标注任务里有多少「其实属于某个 goal」，现在**无法测量**（没有载体记录这种归属）。两个方向：
- 维持 §4.9（报告 `goal-branch-untagged-overlap` 读数，攒发生率），首个 branch-mode goal 跑起来后再看；
- 或在 `branch: true` 的 goal 存在期间，要求 goal-driver 自己立的 gap 任务**必带** `goal_ac`（这部分是机器立的，可强制；人工立的仍只报告）。需先查现有 gap-filing 是否已总带 `goal_ac`。

**Q7：`quay goal merge` 的前置条件有多严**（§4.7）。人已经是成熟度的判断者，机器还要拦什么？
- 必拦（无争议）：goal 非 active / 非 branch-mode / 分支不存在 / 已并入。
- **pre-merge AC 未全部 achieved 时**：起草者建议**拒绝**，但允许 `--override "<理由>"`，理由进 GateEvent——人能越过，但越过留痕（硬规则 9）。
- **sufficiency 判据**（现有 LLM judge，判「AC 集是否覆盖退出条件」）：起草者建议**只展示不拦**——它在并入后仍会拦 achieved；并入时再拦一次等于让机器替人判成熟度，与⑭ 的「人工触发」意图冲突。

**Q8：并入的提交形态**。建议 `--no-ff` 产生一个合并提交（再把 develop ff 到它，develop 仍只做 ff）：
- 整个 goal 经**一个合并提交**进入 develop ⇒ §7 庚（单一入口）可由祖先关系直接读；
- post-merge AC 失败、要把整个 goal 撤出时，`git revert -m 1 <合并提交>` 一步完成——Q5-c 丢掉的隔离由此部分补回；
- 代价：与现有 task fan-in「纯 ff、无合并提交」的形态不一致；`ff-merge.ts` 需支持「先造合并提交再 ff」。

**Q9：并入执行红、修复任务落地后，是否自动重试并入**。
- 自动：请求事件仍在 ⇒ worker-driver 下一轮再试。省事，但人批准的是「请求时的那个 tip」，重试时分支已经多了修复提交——**人批准的树 ≠ 并入的树**（与 integration 退役的「被测 ≠ 被合」同形，只是换成了「被批 ≠ 被合」）。
- 人再触发：每次并入都对应一次人对当前 tip 的批准；请求事件已记 tip SHA，worker-driver 只在 `goal/<id>` tip == 请求 SHA 时执行，否则请求失效。
- 起草者倾向**后者**：⑭ 让人触发的意义正是「人对这棵树负责」。

**Q10：并入之后到 achieved 之间，goal 能否再开分支**。⑭ 之后 goal 变回普通 goal，post-merge 修复直落 develop。若 post-merge 失败暴露的是一个大问题、又需要隔离开发——
建议**不允许**同一 goal 重开分支（§4.1 已约束 `branch` 字段在分支存在后不可改；并入后同样锁定）；需要隔离就立新 goal、`supersedes` 旧 goal。理由：一个 goal 的分支历史只有一段，§7 庚与 Q8 的「一个合并提交」才成立。

**Q11：预览实例由谁起停**（§4.10）。
- goal-driver：它已经维护判据 worktree，顺带起停 serve 最省事；DIR-131 管的是 task 写路径与 fan-in 载体，起 serve 不在其禁止范围内，但会让 goal-driver 多一个常驻子进程的生命周期责任。
- 人用 CLI 起停（`quay goal preview <GOAL> start|stop|status`）：只在人要试用时才跑，资源最省；代价是没人起它时 live-probe AC 读 `not-evaluated`、并入前置条件不满足（卡住且可见）。
- 起草者倾向：**goal-driver 负责刷新 worktree，serve 由 CLI 起停**——试用本来就是人的动作，而「没起 ⇒ 不能并入」正好把「人试用过」变成并入的前置条件之一。

**Q12：预览实例的数据来源**（§4.10）。起草者建议「主检出 `.quay/` 只读快照 + 预览内写操作随刷新丢弃」。备选「预览代码直接读写生产数据」能试到真实数据上的写操作，但 goal 若改了数据格式，新代码会在 develop 尚未接受它时写坏生产数据——与⑮「并入前试用」的初衷相反。

---

## 10. 落地顺序

1. 先修前提：`anti-drift` diff 基准（§4.4）、`ff-merge.ts` 源分支参数化（含「源 = 合并提交」，⑲）、孤儿 serve 回收器认可预览 serve（§4.10）、goal GateEvent 加 `evaluationRoot`——四者对现有路径零行为变化，可独立落地。
2. 数据模型 + 分支生命周期（§4.1/4.2）+ 身份检查（§4.8）。
3. **B1、B2**（⑩⑪ 已裁定）——没有它们，后面的接线会立刻产生死锁与重复派发，⛔ 不得先接线。B1′ 已由⑭ 裁定，`phase` 字段须与派发接线同批或更早落地。
4. 派发接线 + 任务 fan-in（§4.3/4.4/4.6）。
5. AC `phase` 字段 + goal-driver 分相求值；预览 worktree 维护 + `quay goal preview`（§4.10）；`quay goal merge` 动词；worker-driver 执行 goal 并入与自动重试（§4.7）。
6. 选一个真实的较大改进（建议带 Web UI 面，能用上预览实例）开 `branch: true` 跑通，按 §7 甲–辛读生产载体验收；并入后按⑰ 复核未标注读数。
