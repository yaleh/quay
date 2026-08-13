# 规格：引入 integration 分支，把「分叉基线」与「汇入点」拆开

**🚫 退役（2026-08-13，AC48 判据2）**：integration 分支已退役——per-task 验证模型
（`SPEC-per-task-suite-verification-2026-08-13.md`）取代了它：每个任务从 develop fork、worktree 内跑全量、
绿后直接 merge 回 develop，**不再使用 integration 分支**。退役证据：`develop..integration = 0`（无独有内容）、
`integration..develop = 187`（落后）、无生产路径写它（fork 恒 develop / fan-in 恒 develop）。本文件保留为
**理由档案**（为什么当初要两线、实测如何否定了 FF-only 假设），不删；AC/DoD 与是否立案由外层判断。

**日期**：2026-08-05（管理者）
**来源**：人提出参考 git-flow（nvie.com/posts/a-successful-git-branching-model/）并扩展——
inner 从 develop 分叉、合并回另一分支、经 outer 验证后再批量合回 develop。
**本文件**：讨论结论 + 实测数据。**AC/DoD 与是否立案由外层判断。**

---

## 1. 它解决的是结构，不是启发式

管理者先前提的「红落在共享闸门才停派发」是**启发式**（判断这次的红会不会影响新任务）。
本方案是**结构性的**：**新任务永远不从未验证的树上分叉**，问题不再需要判断。

**根因**：现在 `master` 同时承担两个角色——「新工作的分叉基线」与「已完成工作的汇入点」。
红窗必须停派发，正是因为这两个角色被压在同一个 ref 上。拆开即无此冲突。

---

## 2. 实测数据：新模型的 develop 吞吐**高于**现在的 master

管理者最初判断「develop 更新频率更低 ⇒ 是代价」，**人指出这个判断错了，实测支持人**：

```
今晚 22:00 起 master 的落地类提交：97 次
间隔：中位 3 分钟 / 最大 38 分钟 / 最小 0 分钟
>20 分钟的空档：4 次 / 共 96
```

那 4 段空档正是**红窗停派**造成的——当前模型下 master 在红窗期**完全不更新**。
新模型下 integration 照常接收合并，这些空白会被填上。
⇒ **更新事件更少（批量）≠ 吞吐更低**；每次带的工作量更大，且管线永不停摆。

---

## 3. 「基线陈旧」与「触摸集不相交」是同一个约束，不是两个

人的论证：「总有任务可以从较早的 develop 分支出来做」。它与既有机制正好咬合：

- 分叉基线陈旧**只对触摸集相交的任务造成麻烦**
- 触摸集相交的任务**本来就该串行**——`checkTouchesPair` + 已落地的 disjointness 排序在做这件事
- ⇒ **能并发的任务，恰好就是不在乎基线陈旧的那些**

---

## 4. 成本：merge 复杂度，且有上界

**`integration → develop`：不复杂**。integration 只从 develop 长出、只往 develop 合回
⇒ 永远是 develop 的后代 ⇒ **fast-forward**，无冲突。

> **反例（2026-08-06 23:48，60 秒实证）**：外层完成对齐 merge、恢复 FF（integration..develop=0）
> 后，**一分钟内** develop 又领先 3 个提交——第一条正是记录这次对齐的那个 commit。⇒ "永远后代"
> 的前提是【develop 在 integration 存活期间不接受任何直接提交】，而 develop 实测收 271 个直接提交
> （inner 88 / outer 61 / manager 26 / tasks 25 / fix 16，merge-base e846cedd 14:10 起各走 9.5h）。
> **不是"长期漂移导致假设失效"，是假设在一分钟内就不成立**——记录对齐本身的提交就打破了它刚恢复
> 的不变量。方向裁定（2026-08-06 23:4x 外层）：承认 develop 前进，integration → develop 从 FF
> 改真 merge（每次量小可能有冲突）；"勤合并维持 FF"不可行。

**`task/<id> → integration`：成本在此**。今天 B rebase 到 master（线性、一次面对一个前序）；
新模型下 B 合进 integration 时可能同时面对并发任务的改动——**冲突总量不变，一次面对的分歧更宽**。

**但有上界**：并发上限 3、且派发前已按 disjointness 筛过 ⇒ B 最多面对 2 个并发任务，
而那 2 个已被机械判定与 B 触摸不相交。**剩余冲突只可能来自「触摸集声明不准」**——
那是既有缺陷（实例：`retirestate` 括号注记混进路径、`scoped-runs` 用目录级声明），非本方案引入。

⇒ **merge 复杂度的增量 = 触摸集声明不准的程度**。声明越准，增量越接近零。
**副产品**：本方案会把「触摸集声明不准」从偶发暴露变成持续暴露，逼着修真缺陷
（与下面全局计数断言那条同理）。

---

## 5. 命名建议：`integration`

| 候选 | 判断 |
|---|---|
| `gate` | ✗ quay 里 gate 已是核心概念（`task check` gate、DoD gate、`gate-events.jsonl`），gate 是「检查」不是「地方」，语义打架 |
| `staging` | ✗ 暗示部署语义，此处无部署 |
| `next` | ✗ 内核惯例，表达不出「待验证」 |
| **`integration`** | ✅ 最准、标准用法、与已有 `verification-round` 词汇不冲突 |

---

## 6. 依赖声明可复用分叉基线，不需要新机制

| 任务性质 | 从哪分叉 |
|---|---|
| 独立任务（默认） | `develop`（已验证，绿） |
| 声明依赖前序任务 | `integration`（含未验证的前序工作） |

**分叉基线即依赖声明**，不必另建依赖字段；且可机械检查——任务体已有 `## Touches`，
若与 integration 上某未验证任务的 touches 相交，就该从 integration 分叉。

---

## 7. 两个需要外层裁定的开放问题

**① 两线还是三线？** git-flow 的 `master` 是**发布线**，而 quay 目前**没有发布流程**
（push 需人显式授权、CI 只在 push 时触发、循环一直直接跑在 master 上）。
- **三线**：`master`(发布) + `develop` + `integration` —— 完整 git-flow，但 master 角色目前是空的
- **两线**：`develop`(已验证基线) + `integration`(待验证汇入) —— 最小改动，正好对应收益

**管理者倾向两线**：现在加一条空转的发布线，是为尚不存在的流程付维护成本；
等真有发布授权时再加 `master`，那时它的语义才是实的。**裁定权在外层。**

**② 已观测风险：全局计数断言会更频繁地红。**
tick 文档已记载：*"worktree 建立时对 master 取了快照…B3-2 就是这样红的——它的 worktree 建于
B3-1 合并前 13 分钟，于是对**全局测试文件计数**的断言过期"*。
新模型下 develop 相对 integration 的滞后更久 ⇒ 这类断言更容易过期。
**这可能是好事**——把一个真实缺陷（全局计数断言本身就脆）从偶发变必现，逼着修掉。
但需要外层判断：先修断言、还是与分支模型同批做。

**③ 另需注意**：仓库现有 **60 个分支**，大量是历史遗留（`experiment-4-iteration-*`、`_master_check` 等）。
引入新分支模型前值得先清一遍，否则新旧并存会让「哪条线是权威」更难看清。

---

**本文件不建 AC/DoD、不排优先级——那是外层的活。**

---

## 落地记录（2026-08-07，gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling）

**§4 的「integration→develop 永远 FF」假设已被实证否证**（2026-08-06 23:48 反例），方向裁定改为
真 merge。落地机制：

- `plugin/scripts/integration-batch-merge.sh` 新增 **`--merge` 真 merge 模式**（默认仍 dry-run 安全）：
  NOT-FF（真分歧）时不再一行 needs-human，而是（AC1）先报告分歧面（develop-only / integration-only
  计数 + would-conflict 文件清单）；（AC2）已知共享文件（`*tick-log.md` / `tasks/*.md` / `*queue-state*`，
  可用 `--shared-file` 追加）的冲突按 **develop-authoritative** 自动解（在一次性 temp worktree 内
  `git merge --no-ff --no-commit` → 分类 → 解析 → `git update-ref` CAS 推进 develop，主 checkout 不动）；
  （AC3 承重负控制）**真实代码冲突仍 fail-closed**——列出冲突文件清单、不盲 `--ours/--theirs`、不动 ref。
- **默认（无 `--merge`）路径保持 fail-closed**：NOT-FF 时输出分歧面 + `NOT-FAST-FORWARD … needs a human`。
- `git merge-base --is-ancestor integration develop`（已吸收）时 no-op 退出 0（measure=0）。
- 测试：`plugin/test/integration-batch-merge.test.mjs`（8/8 绿），`plugin/test/branch-model.test.mjs`（9/9 绿）。

**对两线模型操作者的指引**：外层 verification-round 的批量合在「integration 不是 develop 后代」时应
**传 `--merge`**（每次量小，共享文件冲突自动解；真代码冲突仍停下来等人）。「勤合并维持 FF」不可行——
develop 每分钟都可能被内层/外层/管理者直提。后续若要把 `--merge` 变成外层默认，需一并更新
`orchestrator-loop-tick.md` 的批量合步骤（本任务 Touches 不含 loop 文档，未改）。
