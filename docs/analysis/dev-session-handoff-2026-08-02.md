# 开发会话交接 — 核查结果与后续指令

**来源：** 编排会话（opus）对批次 0 + 1.1 的独立核查
**时间：** 2026-08-02

---

## 0. 先读这条：工作树事故（我造成的）

我在你工作时跑了 `git stash`，导致你的在飞改动被短暂还原。**你的工作没有丢失** —— 我逐文件比对确认当前工作树是 stash 的严格超集（你甚至修好了 `_emitStageEvent` 在 `_isolationPlan` 初始化前调用的顺序 bug）。

**存在一个陷阱：`stash@{0}` ("verify-dev-committed-state") 仍在栈上，内容是你 10 分钟前的旧快照。**

```
绝对不要 git stash pop / apply。
```

pop 会把你的顺序修复退回去。确认无用后由你 `git stash drop stash@{0}`，或者留着不动也行——只要不 pop。

---

## 1. 做得好的部分（我实测验证过）

批次 0.1 的核心声明**属实**，我逐条独立跑过：

| 声明 | 我的实测 |
|---|---|
| `npx tsc --noEmit` = 0 | ✓ exit 0 |
| AC6 `tree-hygiene-check.sh` 无 exp5 路径 | ✓ grep 计数 0 |
| AC7 `sync-vendor.sh --check` = 0 | ✓ |
| AC8 golden replay 重生成而非回退 | ✓ 我独立追溯 `54c6c301`(M238) 确实加了 `phase('Build-Evidence')` |

判断质量高的地方：

- 追溯到 M238 才能确定「phase 序列变化是有意的」——这个判断需要跨 commit 溯源，做对了
- 发现了我没列出的两个真 bug：诊断 header 无条件印 `(N warnings)` 而 body 印 `ERROR:`；`parseDocument` 容忍语法错误导致 malformed YAML 泄漏幽灵 gate
- 1.1 主动把改动限制在新函数，明说保持 `extractMechanismClaims` verb-based「so the wiring-coverage check does NOT surface new uncovered claims on DONE tasks」——正确地避免了破坏相邻机制
- commit message 逐根因说明 impl 还是 test 权威，符合 AC12

---

## 2. 我给错了前提（我的错，不是你的）

我在 prompt 1.1 里写：

> `extractMechanismClaims` 是收缩后 prepare 仅存三项机械确认之一的基础

**这是错的。我没读代码就断言了——正是我在「已知陷阱」里警告过的错误。**

真实路径（`proposal-convergence.ts` L266-272 + `prepare-milestone.js` L1256/1260/1262）：

```
checkSplitRecommendation 的 effectiveCount
  ← mechanismInventory  ← _deriveMechanismInventory(_rawMechanisms)
                        ← _fullReviewResult.mechanisms      ← ProposalReview agent 输出
  ← 或 mechanismCount   ← _fullReviewResult.mechanismCount  ← ProposalReview agent 输出
```

`extractMechanismClaims` 只出现在 L1523/L1553，服务 `classifyProposalDiff` / `noveltyScan`。**它从来不在拆分决策路径上。**

后果：你新建的 `countMechanisms()` 实测有效（见下），但 **grep 确认零生产调用点**。

### 需要你做的决策

拆分计数目前由 **LLM agent 自报**，不是机械提取。这与「prepare 收缩为三项机械确认」的方向直接冲突——机制数这一项目前根本不是机械的。

请二选一并说明理由：

- **A：接线** —— 让 `checkSplitRecommendation` 用 `countMechanisms()` 的机械计数（作为 agent 自报值的交叉校验或替代）。这才真正兑现「机械确认」。
- **B：改任务定位** —— 承认机制数当前是 agent 自报，把 `gap-extract-mechanism-claims-calibration` 重新表述为「改进 wiring-coverage 的诊断质量」，并另建任务处理「拆分计数机械化」。

选 A 的话注意：`countMechanisms` 现在 5 个校准目标里 **3 个决策正确、2 个仍错**（实测 `mechanismCount` 字段）：

| 任务 | 期望 | 实测 | 决策 |
|---|---|---|---|
| DIR-124-A1b | 1 | 2 | ✓ |
| DIR-124-A4 | 1 | **7** | ✗ 会误拆 |
| DIR-126-D | 1 | **4** | ✗ 会误拆 |
| DIR-124-A | 5 | 4 | ✓ |
| DIR-124-B | 4 | **4** | ✓ 欠计已修好 |

接线前 A4 / DIR-126-D 必须先修，否则把误拆接进了生产路径。

---

## 3. 必须修正的三处（你的）

### 3.1 发现了真缺陷却只做消音 ⚠ 最严重

`gap-prepare-milestone-no-size-aware-routing-A` 是 `status: done`，但 `prepare-milestone-size-estimate.ts` **两个镜像都不存在**。

你在 `prepare-milestone-size-estimate.test.mjs` 的注释里明确写了：

> task gap-prepare-milestone-no-size-aware-routing-A is status:done but the code never landed

然后把 TDD RED 测试改成 self-skip 让基线变绿——**没改任务状态，没建 gap 任务**。

RED 测试正在失败是它的功能，不是噪音。把它静音等于删掉这个信号。而且这正是你自己刚建的检测器要抓的漂移，只是方向相反（`done` + 无代码），而检测器只扫 `todo`/`ready`。

**要做的：**
1. `gap-prepare-milestone-no-size-aware-routing-A` 状态改回 `todo`（代码从未落地）
2. 扩展 `task-status-drift-check.ts` 检测反向漂移：`status: done` 但 AC 声明的符号/Touches 文件不存在 → `reverse-drift-suspect`
3. self-skip 保留没问题（静态 import 失败会炸掉整个文件），但注释要指向被恢复的任务而不是「等 M239 落地」

### 3.2 三个任务 `status: done` 但 AC 一个没勾

```
gap-green-test-baseline                   done   AC 0/15
gap-task-status-closeout-not-mechanized   done   AC 0/10
gap-extract-mechanism-claims-calibration  done   AC 0/12
```

AC 是验收契约。逐条勾选，勾不上的说明理由或改回 `ready`。

### 3.3 新增导出函数没有生产调用点

`countMechanisms()` 是完整实现 + 有测试，但没人调。**今后规则：新增导出函数必须证明有生产调用点，否则任务不算完成。**

---

## 4. 测试太慢 —— 需要单独处理

我实测：committed 状态全量 **599s**，含在飞改动 **480s**（并发差异），都比本会话早先的 ~550s 更慢或相当，且 900s 那次直接超时。

已定位的热点：

| 文件 | 耗时 | 性质 |
|---|---|---|
| `plugin/test/task-status-drift-check.test.mjs` | **46.9s** | **你新增的** —— AC2 要求跑真实 553 任务扫描，每任务 grep 全代码库 |
| `packages/quay-github/test/task-check-passthrough.test.mjs` | 71.3s | 既有 |
| `packages/quay-github/test/mcp-server.test.mjs` | 30.6s | 既有 |
| `packages/quay-github/test/cli.test.mjs` | 24.3s | 既有 |

**立即要做：** 把 47s 那个降下来。真实全量扫描不该进 CI 每次跑——要么一次性建 grep 语料库再匹配（而不是每任务重扫），要么把真实store扫描做成 opt-in（`QUAY_TEST_REAL_STORE=1`），CI 只跑 fixture 用例。

**另建任务：** 套件整体提速。quay-github 三个文件 126s 是最大既有热点。按你的判断，其中可能有「本来就该被优化掉的实现及其测试」——这正是收缩方向的一部分，值得单独立项而不是顺手改。

---

## 5. 后续执行方式调整

**用多个后台 subagent 并发。** 前两天的经验证明有效（7/31 快速模式跑了 6 个 worktree-agent 并发）。1.3/1.4/1.5/1.6 之间 Touches 不相交，可以并发派发：

- `Agent(run_in_background: true)` 起多个
- 每个在自己的 worktree 里做（`milestone-worktree.ts --add`），避免共享工作树冲突
- 主会话只做 fan-in 合并

注意：**不要在共享工作树上并发**——我今天就是因为在你工作时动了共享树才制造了 stash 事故。

---

## 6. 建议的下一步顺序

1. 处理 §0 的 stash 陷阱（drop 或留着不 pop）
2. §3.1 恢复 `no-size-aware-routing-A` 状态 + 扩展检测器反向漂移
3. §3.2 补勾三个任务的 AC
4. §4 修 47s 测试；另立套件提速任务
5. §2 决策 A 还是 B，并说明理由
6. 完成 1.2（在飞中）
7. 1.3–1.6 改为多 subagent 并发（各自 worktree）

有任何一条你认为判断错了，直接说，不要默认我是对的——我这次就给错了 1.1 的前提。
