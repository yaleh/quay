# 规格：取消 integration 分支，验证单元下放到每个任务（per-task suite verification）

**日期**：2026-08-13（管理者起草）
**来源**：人 2026-08-13 02:1x–02:5x 三轮讨论的裁定与追加约束（原文见 §0）。
**本文件**：方案、实测依据、风险与未测量项、落地顺序。**AC 与阶段目标见 `manager-phase-goal.md`；实现归 outer / inner。**

**它取代什么**：`SPEC-branching-model-integration-branch-2026-08-05.md` 定义的两线模型
（`develop` = 已验证基线 / `integration` = 待验证汇入点 + outer 批量 verification-round）。
**那份 SPEC 不作废**——它记录的问题诊断（`develop` 同时承担"分叉基线"与"汇入点"导致红窗必须停派）**仍然成立且是本方案的前提**；
本方案换的是**解法**：不是把两个角色拆到两个 ref 上，而是**把验证单元从"批量、共享、周期性"下放为"单任务、隔离、逐次"**。

---

## 0. 人的裁定（逐字，本文件其余部分都是它们的展开）

1. **不再使用 integration 分支**：每个 inner 任务 subagent 从 `develop` 开 worktree、开发、跑 scoped test、跑 suite test，**迭代直至成功**后 merge 回 `develop`。
2. **`develop` 工作副本在正常流程仍会被编辑**（manager/outer 的频繁文档编辑），**但所有需要测试的变更必须走 inner 的 subagent + worktree**。
3. **锁容量 = 2**；**同时设置相应的 cgroup 限制**；**suite 并发调整：main 相 8，其它相不动**（"其它相不动"指保持当前较好配置）。
4. **`NODE_COMPILE_CACHE` 在 worktree 内用，不做跨 worktree 共享。**
5. **Rebase-重跑循环是必要的。**
6. **`verification-round` 本身应当小**（任务粒度）；**所有趋势分析（红率分桶、负载溯源、残留剖面对照）应基于 inner subagent 执行的 suite 测试记录。**
7. **`verifiedCommit` 这类逻辑必须拿到 suite 测试以外；suite 测试自身不应有 commit 的知识。**
8. **测试对 VCS 的依赖**：仅接受对**测试自己创建的、仅用于测试的临时 git repository** 的操作；**禁止对 quay 项目自身 git repository 的操作。**

---

## 1. 模型

```
现在（两线 + 批量验证）：
  任务 → merge 进 integration（共享）→ outer 周期性跑全量套件（验"此刻 integration 的状态"）→ 批量合回 develop

本方案（单线 + 逐任务验证）：
  任务 → 从 develop 开 worktree → 开发 → scoped test → 全量 suite（在自己的 worktree 内）
       → 绿 ⇒ merge 回 develop；红 ⇒ 同一 worktree 内迭代
       → merge 前若 develop 已前移 ⇒ rebase → 【重跑全量 suite】→ 再 merge
```

**`develop` 的不变量**：任意时刻，`develop` 的每一个提交都是"被某次全量套件在隔离环境里验证过的树"合并而来。
**`develop` 工作副本仍可被 manager/outer 直接编辑**（文档、任务体、编排文件）——**这类编辑不进入验证路径**，
因为**验证从不发生在主检出上**（见 §3.1 它消掉了什么）。

---

## 2. 它结构性消掉了什么（今晚 2026-08-12→13 实测发现的四条缺陷）

| 缺陷（今晚立案） | 在本方案下 |
|---|---|
| **守卫覆盖缺口**（precommit-guard 拦提交、不拦工作树编辑；3 起独立事件，三层都当过负样本） | **前提消失**——主检出上不再跑套件，"编辑与在跑的套件共享同一棵树"这个共享关系不存在 |
| **`verifiedCommit` 脏树假证书**（记录里无 tree/dirty 字段，"被测的是不是那个 commit"不可核验；已实测"首次成本"：outer 被迫自述而非引用） | **前提消失**——每次套件独占一个 worktree，被测对象结构上就是那个 commit；且 §5 把 commit 知识整个搬出套件 |
| **自造脏**（package-lock 被跑轮自身改写，mtime 实测落在 install/build 阶段） | **限制在任务自己的 worktree 内**——主检出不再被跑轮弄脏，正是人裁定 ②"主目录始终工作在经过 suite 测试的 develop"的机制保证 |
| **leak-scan 残留竞态 / `/tmp` tmux 命名空间共享** | **不解决，反而更必要**——见 §4.3：并发从"偶发"变"常态"，per-run namespace 从可选优化变成前置条件 |
| **`failures[]` provenance / 红轮记录指错对象** | **正交，仍须单独修**（与验证单元粒度无关） |

**⇒ 本方案不是外加一条改进，是今晚四条缺陷的收束点**：四条里三条的根因都是**"验证发生在一棵共享、可变的 checkout 上"**，本方案消掉那个根因本身。

---

## 3. 可复用的现成地基（②i-C：动手造之前先搜现成的——全都有）

```
① --root <worktree> --state-dir <主 .quay> 解耦
   tasks/gap-suite-state-split-across-worktree-and-gate.md  status: done
   现役用法：.claude/workflows/execute-suite-fix.js:78 `--root ${worktree} --state-dir ${stateDir}`
② provision-verify-worktree.sh —— "provision a fresh git worktree so it can RUN the full suite"
   已实现 + 有测试 + --teardown（含进程回收，来自 gap-suite-leaks-live-claude-sessions 的 4 孤儿 109-120h 泄漏）
   ⚠️ 非测试调用者 = 0（建成、测过、没接上——本仓库反复出现的"零消费者"形态）
③ node_modules 符号链接：5 个现存 worktree 里 4 个已是符号链接 → 主仓 node_modules（71M 不复制）
④ worktree-branch-hygiene-check.sh：悬挂 worktree/分支的卫生检查已有
⑤ provision 开销实测（outer 2026-08-13 02:0x）：git worktree add 1116ms + provision 2424ms + teardown 780ms ≈ 4.3s
```

**⇒ 本方案的增量实现主要是"接线 + 锁 + 记录面"，不是从零造隔离机制。**

---

## 4. 资源与并发（全部用实测数，不用估计）

### 4.1 单次套件的真实资源占用（今晚 rounds 99-104 记录）

```
wall:        461.0 / 488.2 / 485.3 / 570.7 / 558.7 / 571.1 秒
cpu_time_s:  3245 / 3234 / 3621 / 3902 / 3983 / 3945
mem_peak_mb: 1433.6 / 1433.6 / 1536 / 1433.6 / 1536 / 1843.2
⇒ 平均并行度 ≈ cpu_time / wall ≈ 7.0 核当量；峰值内存 1.4–1.8 GB
本机：nproc=16，内存 15 GB（available ~10 GB）
```

### 4.2 锁容量与并发档位（人裁定 ③，本文件核实其算术）

```
锁容量 2 × main 相 8 = 16 = nproc   ⇒ 两实例合起来的 main 相 spawn 总数 = 当前单实例水平，不超订
serial 相 6、lowconc 相 6 保持不动 ⇒ 两实例最坏 2×6=12 / 2×6=12，低于 nproc
内存：2 × 1.8 GB ≈ 3.6 GB，远低于 available
```

**⚠️ 当前实际生效值的正本（易错，manager 自己踩过一次）**：
```
plugin/scripts/full-suite-runner.ts:908-909  DEFAULT_SERIAL_CONCURRENCY = 6 / DEFAULT_LOWCONC_CONCURRENCY = 6   ← 生效值
scripts/test.sh:654-655                      SERIAL=${QUAY_SERIAL_CONCURRENCY:-2} / LOWCONC=${...:-3}          ← 仅裸跑兜底
scripts/test.sh:654-655 与 full-suite-runner.ts:1204-1206 的【注释】仍写 2/3 —— 注释漂移，与代码矛盾
main 相 laneCount：nproc 派生（defaultLaneCount()），本机 = 16
```
**⇒ 引用这两个数时必须读 `full-suite-runner.ts` 的常量，不能读 `test.sh` 的注释。**

### 4.3 cgroup 限制：必须读宿主，禁止字面量（硬规则 4 推论二）

**2026-08-11 事故**：人裁定"取消 CPU 配额"，实现落成 `cpuQuota: "400%"`（当时 4 核 ⇒ 等价无限制）；
搬到 16 核机器后 400% = **只给 4/16 核**，与裁定原意相反，**无任何检查会报**。
**⇒ 本方案的 cgroup 限制必须写成读宿主的表达式**（如 `nproc / 锁容量`），
**不得写死 `CPUQuota=800%` 这类字面量**；main 相的 `--lane-count` 已是正确形态（nproc 派生），cgroup 应复用同一公式。

### 4.4 并发触发的已知浪费形态（实测样本，2026-08-13 02:2xZ）

```
两个触发源几乎同时（02:17 监控循环 / 02:23 workflow detach）各起了一整套 runner + test.sh 进程树
枚举证据：2646133（156 子孙，真跑）vs 2937119（2 子孙、CPU 0.1%，卡在 flock 等待）
⇒ 锁工作正常（无双跑、无数据竞争），但【被挡者已经吃掉起进程树的成本才发现该等】
```
**⇒ 现有 single-flight 锁只做"串行化 + 安全阻塞"，不做"避免无谓地各自起一整套再互等"。**
**并发触发源变多后这类浪费更频繁，且【当前没有任何读数记录它发生过几次】。**
**⇒ 锁的设计需要单独测（容量、排队策略、是否需要在起进程树之前先探测），不能假设现有单实例锁扩容即可。**

---

## 5. suite 不得有 commit 知识（人裁定 ⑦）

**现状（读实现）**：`plugin/scripts/full-suite-runner.ts:956 readVerifiedCommit()` 在套件内部调 `git rev-parse HEAD`；
`:1274` 使用它；`:742` 注释自称"the TESTED COMMIT"。
**而全文件 `grep porcelain|isDirty|dirty|assert-clean` = 0 命中**，`plugin/scripts/assert-clean-tree.sh` 存在但被引用 **0 次**
⇒ **声称"被测 commit"，实际测的是 commit + 当时树里恰好有的未提交编辑，两者之差无任何检查**（今晚"假证书"缺陷）。

**目标架构**：
```
suite（scripts/test.sh + full-suite-runner.ts）：
  纯函数——给我一棵树，回答"这棵树的测试过不过"。不知道 commit、不知道分支、不知道 worktree、不调 git。
外层 wrapper（inner 的任务编排层，今天类似 execute-suite-fix.js 那一层）：
  跑前：记录基线（本 worktree fork 自哪个 develop commit）
  跑后：suite 只回报 pass/fail/耗时；wrapper 自己读该 worktree 的 git 状态（commit / dirty / tree hash），
        在【套件之外】把两部分拼成一条完整的 round 记录
```
**⇒ 我先前建议的"给套件加 tree/dirty/treeHash 三字段"被本条取代**——不是给套件加更多 git 知识去弥补，
**是把 git 知识整个搬出套件**。三字段仍然要记录，只是记录者从 runner 变成 wrapper。

**层次区分（防混淆）**：
- **套件运行器**不得有 git 知识（本条）；
- **测 git 机制的测试用例**允许有 git 知识（§7 的 (a) 类）——两者是不同的层，不冲突。

---

## 6. `NODE_COMPILE_CACHE`：worktree 内用，不跨 worktree（人裁定 ④）

**实测（两组独立样本，2026-08-13 01:2xZ）**：
```
manager（threshold-scope-check.ts）：无缓存 422ms → 有缓存 286ms（省 32%）
outer（一个测试文件）：            无缓存 7685ms → 有缓存 4435ms（省 42%）
⇒ 收益是【编译时间的 30-40%】，随本次 spawn 要编译多少代码缩放，【不是固定 ms】——
  不得用 "N × 140ms" 这类固定值外推（manager 曾这样外推，已撤回）
一轮的非-ESM spawn 规模（round 103 日志实测）：434 次
主仓现有缓存：1.3 GB / 152594 文件，无 prune、无上限、gitignored（涨了没人看得见）
缓存规模未越净收益点：152594 条目下仍是三档最快（286ms vs 无缓存 422ms）——假说曾提出、已被两路实测证伪
```
**⇒ 跨 worktree 共享的收益（几十秒量级，且并发时墙钟收益重叠打折）不抵其代价**
（需要验证并发写入同一缓存目录的安全性——一个至今未验证的新维度）。
**⇒ 每个 worktree 用自己的缓存。**

**仍然成立的收益**：**rebase-重跑循环内的摊销**——同一 worktree 内第一次冷、之后暖；
人裁定 ⑤ 的"迭代直至成功"意味着同一 worktree 会反复跑，**摊销从"跨任务"变成"同任务多次重跑内"，不归零。**

---

## 7. 测试对 VCS 的依赖（人裁定 ⑧）

**规则**：测试**仅可**操作**自己创建的、仅用于测试的临时 git repository**；**禁止对 quay 自身仓库执行任何 git 操作**（读或写）。

**已确认命中（逐点核实 cwd/-C 参数，非文件级关键词猜测）**：
```
plugin/test/mechanism-vitality-check.test.mjs:108   assert callCountAll === 47（对活仓库历史断言字面数字，随历史增长必然漂移）+ :149/:161 cwd: REPO_ROOT
plugin/test/gitignore.test.mjs:51                   execFileSync("git",["check-ignore",...],{cwd: REPO_ROOT})
plugin/test/build-evidence-manifest.test.mjs:660    execSync("git rev-parse HEAD",{cwd: REPO_ROOT})
plugin/test/plugin-packaging.test.mjs:686/693       execFileSync('git',['check-ignore'|'ls-files',...],{cwd: repoRoot})  // repoRoot = path.resolve(pluginDir,'..')
```
**已排除的假阳性（核实后确认是 hermetic 自建仓）**：`full-suite-runner.test.mjs`(repo=mkdtemp) /
`task-status-drift-check.test.mjs`(repoDir←git init 临时) / `cold-start-check-running.test.mjs`(root←mkdtemp) /
`quay-init-loop.test.mjs`(ws←makeTmp)。

**⚠️ 覆盖不完整，明写不掩饰**：57 个真正调用 git 的测试文件中，只有约 20 个的调用点被逐点核实；
**其余 26 + 8 个未逐点核实**（正则未覆盖模板字符串 `` `git ${x}` ``、跨行长参数列表等写法）。
**这是"未查"不是"为零"（硬规则 6）。**

**⇒ 修法不是手工扫完剩下的，是造机械检查器**：
```
判据：任何测试文件中，git 调用的 cwd / -C 参数解析后若落在仓库根（或其非 tmp 子路径）内，且该路径不来自
      mkdtemp/tmpdir 家族 ⇒ 违规
形态：与本仓库已有的 20 个 @static-object 检查器同族（扫全仓、按位置判定、可 mutation 测试）
好处：每轮跑一次即有完整可信覆盖，不再靠"正则 + 抽查"去赌漏没漏
```
**分类与优先级**：
- **(a) 测 git 机制本身的测试**（batch-merge / branch-model / claim-task / worktree 隔离）：耦合是**内在的**
  ——被测对象就是一套 git 工作流；quay 的 provider-agnostic 针对**任务存储**不针对 VCS。
  **⇒ 明确不做 VCS 抽象层**，理由写进记录以防周期性重提。**但它们仍须遵守本条：用自建临时仓，不碰 quay 自身仓库。**
- **(b) 读活仓库状态的测试**：无论对 VCS 中立性持何立场都该修，因为它坏的是**幂等性**。
  修法现成——22 个测试已在用 `git init` 到临时目录的模式。

---

## 8. `verification-round` 语义改写（人裁定 ⑥）

**现状**：`.quay/verification-round.jsonl` 由 outer 的 runner 单一写入，一条记录 = 一次**跨任务批量健康度快照**。
今晚所有趋势分析（红率分桶 45red/56green、负载溯源、残留剖面对照 97/98/101 基线）都建立在这个语义上。

**新语义**：一条记录 = **一个任务的一次套件运行**（含 rebase 后的重跑，每次一条）。
**写入者从 outer 的 runner 变成 inner subagent 的编排层**（或它调用的同一个 runner，但跑在它的 worktree 里 + `--state-dir` 指向聚合位置）。

**必须一并决定的三件（否则观测体系会静默失真）**：
1. **聚合位置**：所有任务写同一个 jsonl（需要并发追加安全）还是按 worktree 分片再聚合。
2. **记录必须能区分"哪个任务、第几次重跑、fork 自哪个 develop commit"**——否则红率分桶会把
   "同一任务重跑 5 次" 与 "5 个不同任务各跑一次" 混为一谈（今晚已有同族教训：`wc -l` 数拒绝次数当独立事件数）。
3. **两类 population 不得混装**（今晚同族第三次）：`verification-round.jsonl` 现已同时装着
   **跑轮记录**（20+ 字段）与**闭合记录**（`at/closed/round/suiteGreen` 四字段，rounds 11/14/16）——
   **任何计数必须声明数的是哪一类**。新模型下若再加一类，必须显式分型。

**方法论不变**：今晚用的分析手法（先枚举再计数、非零打印命中、零计数做负控制、按位置判定）**在新记录源上原样适用**。

---

## 9. Rebase-重跑循环（人裁定 ⑤）

**为什么不可省**：任务开发 + 套件耗时 15-40 分钟（今晚 telemetry 均值），期间 `develop` 可能已前移。
**基于旧基线的绿，对新基线不成立**——若跳过重跑直接 merge，`develop` 的不变量（§1）即被破坏，
**且破坏方式恰是"假证书"**（一张对 A 树发的绿证书被当成对 B 树的）。

**代价（未测量，明写）**：套件运行总次数 **> 任务数**，倍数取决于 `develop` 更新频率与任务耗时之比。
今晚 `develop` 的提交间隔中位数约 3 分钟（`SPEC-branching-model` §2 实测 97 次落地提交），
**若该频率不变，长任务几乎必然重跑 ⇒ 这是本方案最大的未量化成本，必须在试点阶段实测。**

---

## 10. 未测量 / 未验证项（做决定前必须知道自己不知道什么）

1. **N 个并发套件互相拖慢的真实曲线**——只有单实例数据；锁容量 2 是**算术推导**不是实测结论。
2. **rebase-重跑的实际倍数**（§9）。
3. **worktree 隔离下的红率是否与共享树相同**——今晚红率数据（45red/56green）全部来自共享树，不能直接外推。
4. **`.tmp-lock-test/`、`./undefined` 一类测试残留在并发下的行为**（今晚已见两个自造残留样本）。
5. **观测体系迁移后，今晚这套分析手法的产出是否等价**——需要在试点期并行跑两套记录做对照。

---

## 11. 落地顺序（先立不破，每步都有可验收的产物）

```
阶段 0（与模型无关的地基，今晚已在推进）
  · per-run namespace（/tmp/quay-run-<runId>/）—— 并发前置条件，不做则 leak 竞态从偶发变常态
  · failures[] provenance + gate 具体名 + verdictSource —— 防未来误归因
  · execute-suite-fix.js 的 logFile 守卫 + "模板 ${x} ⊆ 守卫集"机械检查

阶段 1：outer 的批量 verification-round 先迁进一次性 worktree（本方案的子集，风险最小）
  · 复用 §3 的五块地基；同时落 §5 的 commit 知识外移（wrapper 记录 commit/dirty/treeHash）
  · 验收：连续 N 轮绿 + 记录里能引用（而非自述）"被测树是干净的那个 commit"

阶段 2：小范围试点 per-task 套件（1-2 个 touches 完全独立的任务类型）
  · 实测 §10 的 ①②③：并发拖慢曲线、rebase 重跑倍数、隔离下红率
  · 并行跑新旧两套记录做对照（§10.5）

阶段 3：数据支持后全面切换
  · 锁 + cgroup（§4.2/4.3，读宿主不写字面量）+ main 相 16→8
  · verification-round 语义切换（§8 三件事一并决定）
  · integration 分支退役 —— 【最后一步】，此时它已无事可做，退役是收尾不是手术

阶段 4（并行，不阻塞）：§7 的测试 VCS 解耦机械检查器 + 4 个已确认命中的修复
```

**顺序理由**：今晚的 pool 层教训（`PROPOSAL-task-status-static-semantics` §6）——
**先取消旧机制再补新机制 ⇒ 中间态无网**。integration 退役必须排最后。

---

## 12. 与其它在飞方向的关系

| 方向 | 关系 |
|---|---|
| **`todo`/`ready` 静态语义 + 取消 pool**（`PROPOSAL-task-status-static-semantics-2026-08-12.md`） | **正交但同源**——那条改"任务怎么被挑出来派发"，本条改"任务怎么被验证与合入"；**同一哲学的两个层面**（减少共享可变状态、职责下放到任务自身）。可独立推进，互不阻塞。**本阶段目标把两者并列，正因为它们是同一转向的两半。** |
| **precommit-guard**（今晚建成，已拦 3 起） | 本方案落地后其作用域**大幅收窄甚至可退休**——但**不得在新模型半落地时拆**（中间态无网）。它今晚拦下的 3 起是"共享检出确实有问题"的**证据**，不是白建。 |
| **"空槽 + 有货 + 不派"第二成因**（inner 占回合做主线程编辑，今晚实测 52% 窗口） | 正交。但任务粒度变粗后（开发 + 一次完整套件），该成因的相对影响缩小，而占回合的相对代价变大。 |
| **per-run namespace / verifiedCommit 字段 / failures[] provenance** | **不是被取代，是变得更必要**（§2 末行 + §8）。 |
| **`SPEC-branching-model-integration-branch-2026-08-05.md`** | 其**诊断**仍成立并被本方案继承；其**解法**（两线 + 批量）被本方案取代。**该 SPEC 不删**，作为"为什么不能回到单一 ref 又不做隔离"的理由档案。 |

---

**本文件不排优先级、不建 AC**——AC 与阶段目标见 `orchestration/manager-phase-goal.md` 的对应小节；实现归 outer / inner。

---

# 13. 断言面拆分：文档检查下沉到 pre-commit（人 2026-08-13 裁定 (b)）

## 13.1 为什么必须拆——「文档编辑不需要走测试」这个前提被实测否定

**人的裁定 ②** 原意是"需要测试的变更走 inner+worktree，文档编辑不用"。**实测否定该前提，证据是 manager 自己制造的两次**：

```
round 84  ：manager 编辑 CLAUDE.md（纯方法论文字）⇒ threshold-scope-check 红（「命中≥1」被判 unscoped 计数阈值）
round 109 ：manager 新增 orchestration/SPEC-*.md（纯文档）⇒ manager-layer-shipping AC6 红（全集索引未同步）
round 110 ：同一 SPEC 又撞 quay-init 的 referenced⊆landed 闸（reference-doc 未声明）
```

**断言面的实测覆盖（枚举 `@static-object` 声明，不是推测）**：
```
CLAUDE.md / orchestration/ / tasks/ / docs/proposals/ / plugin/loop/*.md
⇒ 正是 manager 与 outer 每天写的地方
```
**⇒ 不拆的话，新模型下 `develop` 会有一批【从未经套件验证、却有能力让套件变红】的提交，
"主目录始终工作在经过 suite 测试的 develop"这个目标不成立。**

## 13.2 拆法（人裁定 (b)）

| 类别 | 检查什么 | 何时跑 | 判据形态 |
|---|---|---|---|
| **文档类** | 文档自身的内部一致性：全集索引同步、reference-doc 声明、阈值须带窗口、指向已删代码、措辞规范 | **pre-commit，秒级** | 只读被改文件 + 少量全集清单，**不跑任何测试** |
| **代码类** | 产品行为、回归、契约 | **全量 suite（worktree 内）** | 不变 |

**判别标准（写成可机械判定的，避免"哪类"变成人工裁量）**：
**一个检查若其输入【只有文档文件】且不执行被测代码 ⇒ 文档类。**
今晚已知的文档类候选（实测撞过的三个 + 同族）：
```
threshold-scope-check          （扫 3 份 driver doc 的计数阈值措辞）
manager-layer-shipping AC6     （SPEC 全集 ⊆ manager SKILL 索引）
quay-init referenced⊆landed    （被引用文件 ⊆ 落地集 ∪ 声明集）
strategic-doc-staleness-check  （文档指向已删脚本）
state-worded-clause-check / tick-core-static-check（tick 文档措辞与结构）
```

## 13.3 拆分带来的第二个收益（不是副作用，是主要动机之一）

**现在文档错误要等一轮 8 分钟套件才发现**（round 84/109/110 三次实证），
**且失败信息不告诉你"该加到哪一行"**。下沉到 pre-commit 后：
- **反馈从 8 分钟变成秒级**
- **失败点与犯错点在同一次操作里**——这正是 §13.4 那条机制缺陷的解药

## 13.4 附带必须一起修的机制缺陷：**全集判据对新增者不可见**

**实测（manager 今晚在自己身上连中两次）**：
```
落一个新 SPEC 文件需要同步的地方（事前一处都不知道）：
  ① plugin/skills/manager/SKILL.md 的方法论索引    ← AC6 全集判据
  ② plugin/skills/init/SKILL.md 的 reference-doc  ← referenced⊆landed 闸
两个判据本身都是对的（正是防"新增了没人知道"），但它们【只在事后惩罚，不在当下引导】
```
**⇒ 判据要求**：这类全集检查失败时**必须给出补救位置**
（形如 `add "<!-- reference-doc: X -->" to plugin/skills/init/SKILL.md:171`），
**而不是只说"X 未声明"**。**这一条与 13.2 的下沉是同一件事的两半**：
下沉解决"何时报"，补救位置解决"报了之后知不知道怎么办"。

---

# 14. 依赖任务的 fork 基线：串行化（人 2026-08-13 裁定）

**问题**：现有机制（`plugin/scripts/integration-branch-model.ts:46`）
```
独立任务          → fork 自 develop（已验证）
声明依赖 / touches 与 integration 上未验证任务重叠 → fork 自 integration（携带未验证前序）
```
**新模型下 integration 消失 ⇒ 第二条分支无落点。**

**人裁定**：**B 等 A 合入 develop 后再派**（串行化）。
```
任务 B 依赖任务 A ⇒ B 不派发，直到 A 的 worktree 套件绿 + merge 回 develop
⇒ B fork 时 develop 已含 A ⇒ 【所有任务一律 fork 自 develop，无例外】
⇒ 【更正 2026-08-13 04:5xZ】真正决定基线的是 `fork-baseline.ts:182-186` 的 `--force-integration`，
   不是 `integration-branch-model.ts:46 forkBaseline()`——后者**零生产调用者**，
   `SPEC-three-layer-unified-architecture-2026-08-09.md:24/:139` 四天前已记（我写本节时没查自己的正本）。
   ⇒ 动作是【生产调用点不再传 `--force-integration`】+ 该死模块走退役流程，不是"让它退化为常量"
```

**代价（明写，人已知悉）**：**吞吐下降**——依赖链上的任务不能重叠执行。
**为什么可接受**：① 依赖任务本就该串行（并行只是在赌 touches 不冲突）；
② 今晚实测并发上限是 2（§4.2），本来就没有大量并行余量；
③ 它换来的是**"一律 fork 自 develop"这个无例外的不变量**——
**无例外的规则不需要判断，也就不会判断错**（与 §1 的 `develop` 不变量同源）。

**实现要求**：派发闸需要一个**依赖就绪判据**——
`任务声明的依赖任务全部 status: done 且其提交已在 develop 上`。
**已有可复用件**：`it0-split-or-commit-check.ts` 的 PARENT-DONE-IFF-CHILDREN（inner tick A15② 已在用）。

---

# 15. 主检出的分支切换过程（格式参照 `PLAN-develop-branch-cutover-2026-08-06.md`，人指定）

## 15.1 目标终态（一句话）

**主工作目录（`/home/yale/work/quay`）checkout 在 `develop`；`integration` 分支不存在；
所有任务 worktree 从 `develop` fork、验证后直接 merge 回 `develop`。**

## 15.2 已核实的事实（实测，非推测，2026-08-13 03:0xZ）

```
主检出当前 checkout = integration（不是 develop）——git rev-parse --abbrev-ref HEAD
develop 领先 0 / integration 领先 2
活跃 worktree 6 个，其中 3 个的 merge-base 只在 integration 上（develop 没有）：
  gap-concurrent-write-mutable-tree-false-positive-red       merge-base(integration)=c23bf2fa
  gap-delivery-critical-label-at-promote-not-after-dispatch  同上
  gap-src-n-pointer-rot-unverifiable-coverage                同上
另 3 个（a1-fix / any-checkbox-fix / verify-worktree）的 merge-base 两边一致
develop 上的直接提交来源（近 6h）：outer 16 / tasks 13 / merge 8 / inner 6 / manager 2
```

## 15.3 最大的真实风险

**那 3 个 fork 自 integration 独有提交的在飞任务**：若先停用 integration，它们的合并路径断裂
（其基线在 develop 上不存在）。**这不是理论风险，是当前就存在的 3 个具体对象。**

## 15.4 迁移步骤（按顺序；每一步都必须在前一步验证通过后才做）

**阶段一：清空 integration 的独有内容**
1. 等 integration 上所有已合并任务通过一次全量套件（现行机制）；
2. `integration → develop` 批量合并（现有 `integration-batch-merge.sh --merge`，非新造）；
3. **验收**：`git rev-list --count develop..integration` = 0（integration 无 develop 缺失的提交）。

**⚠️ 阶段零（2026-08-13 04:4xZ 新增，实测证明原顺序不可收敛 —— 必须最先做）**

0. **把 worktree 建立基线从 `$MERGE_TARGET` 改成 `develop`。**
   **实测证据（本次 tick 采样，不是推理）**：
   ```
   04:28:02Z  outer 提交 92d7a41c（AC53 立案）—— integration 独有，develop 上没有
   04:30:14Z  worktree gap-tests-assert-live-repo-state-break-idempotency  建立
   04:30:15Z  worktree gap-verification-round-in-one-shot-worktree         建立
   逐条枚举 git rev-list develop..<branch>：两者各含 1 条【不属于自己】的提交 = 92d7a41c
   ⇒ 早先基线里那 3 个 fork 自 c23bf2fa 的 worktree 已排空，但 2 个【新的】立刻补位
   ⇒ 该集合不是在缩小，是在轮换。阶段二在与派发赛跑，且派发一直赢。
   ```
   **⚠️ 根因已于 04:5xZ 更正一次 —— 我第一版写的「两处文本矛盾」是错的，且我犯的正是自己批评过的错（只读一行就下结论）。**
   我读了 `fast-mode-loop-tick.md:953`「worktree 建立命令一律取 `$MERGE_TARGET`」就判定它与
   `integration-branch-model.ts:46 forkBaseline()`（独立任务 fork 自 develop）矛盾。**读全上下文后真相相反**：
   ```
   :949  fork-baseline.ts … --develop "$FORK_BASELINE" --integration "$MERGE_TARGET" --force-integration
   :950  # stdout: $MERGE_TARGET（统一 = integration HEAD；--force-integration 强制，无视依赖声明）
   :956  依赖声明语义保留在 fork-baseline.ts 默认路径（单线下游用），quay 自身派发用 --force-integration 统一
   fork-baseline.ts:182-186  if (forceIntegration) { 输出 integrationRef }  ← 显式分支，有署名理由
   ```
   ⇒ **「100% worktree fork 自 integration」是刻意设计，不是矛盾。** 它的理由是一个已立案已修的缺陷：
   `gap-task-file-develop-integration-drift-fan-in-conflicts` —— **fork 点 = fan-in 目标**，
   否则任务文件的证据段会与 integration 上已更新的同名文件 rebase 冲突。

   **真正成立的两条（与上面无关，独立成立）**：
   ① **`integration-branch-model.ts:46 forkBaseline()` 零生产调用者**（outer 枚举：定义 + 同模块 CLI +
      三条单测；`fork-baseline.ts` 不 import 它）⇒ **同一概念两套并行实现，CLAUDE.md 记的是死的那套**。
   ② **AC50 的不可收敛是真的**（上面那组时间戳与枚举不受影响）。

   **⇒ 因此阶段零的动作要改写：不是「修一处矛盾」，而是【先解掉 `--force-integration` 当初要解的那个问题】。**
   直接把基线指向 develop 会**重新引入一个已修缺陷**。
   **新模型下它的解法已经存在，只是必须明写**：per-task 验证下任务直接 fan-in `develop`，
   任务文件漂移由 **`A6` 已有的「先 `git rebase $MERGE_TARGET` 再 merge」+ 人已裁定的 rebase-重跑循环**吸收
   ——**代价是 rebase 后要重跑套件**，这正是人 2026-08-13 裁定④「同意 Rebase-重跑循环的必要性」所买的东西。
   **阶段零的验收因此要同时证明这一点，不能只证基线变了。**

0b. **验收**：新建一个 worktree，`git rev-list develop..<其分支>` 为空（或只含它自己的提交）。
    **必须在阶段二之前通过**——否则阶段二排空多少，派发就补回多少。

**阶段二：在飞任务收口（3 个具体对象，逐个处置，不批量）**
4. 每个 fork 自 integration 的在飞任务：**要么**完成并 merge（走现行路径），**要么** rebase 到 develop；
5. **验收**：`git worktree list` 中每个 worktree 的 `merge-base(develop, <branch>)` 均存在于 develop
   （逐条枚举打印，不是计数）。

**阶段三：切主检出**
6. 主检出 `git checkout develop`；
7. **验收**：`git rev-parse --abbrev-ref HEAD` = `develop`，且工作树无未提交的产品文件改动。

**阶段四：机制改分支名（落到文档与脚本，不是口头约定）**
8. `FORK_BASELINE`/`MERGE_TARGET` 相关：三层 tick 文档中所有 `integration` 引用改为 `develop`；
9. `forkBaseline()` 退化为常量（§14）；`integration-batch-merge.sh` 标退役（**不删**，理由档案）；
10. **验收**：全仓 `grep -rn 'integration'` 在**执行路径**上零命中（注释/历史记录允许保留）。

**阶段五：验证**
11. 观察一个完整的任务生命周期（fork develop → worktree → 套件绿 → merge develop）；
12. **验收**：该任务的 round 记录里 `scope=worktree`，且 `develop` 的新 HEAD 是它的 merge 提交；
13. **负控制**：故意在主检出编辑一个断言面文档，确认**不再**使任何在跑的轮变红（AC42 判据 3）。

## 15.5 我（manager）不会做的事

- **不代任何一方执行 git 分支操作**（checkout/merge/branch -d）——那是 outer 的执行面；
- **不裁定在飞任务的去留**（完成还是 rebase）——那是 outer 按任务状态判；
- **只做**：提供上述可机械核对的验收判据、每 tick 采样其读数、发现偏离时报出。
