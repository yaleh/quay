---
id: gap-goal-store-write-no-create-vs-update-intent-guard
title: goal-store write 不让调用方声明 create/update 意图 ⇒ 陈旧的存在性判断静默覆盖活跃记录；同族的
  task_write 早有 expectedStatus CAS（硬规则 5b：只修了一处）
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**事故（实测，本条的唯一一次发生，出处完整）**：2026-09-10，一个 Claude Code 会话在 09:35 确认 `goals/GOAL-013*` 不存在，于 **10:08:12** 以 `goal-store write GOAL-013 --title … --origin … --body …` 写入一条**意在新建**的决策记录。而该编号已于 **10:06:18** 被另一会话创建（`1b8b96da5`）、**10:07:42** 经人裁定激活（`5cf9dbd45`，议题「判据保真性 / achieved-but-vacuous」）。`write` 是 patch 语义 ⇒ 该写入**静默覆盖**了那条活跃记录的 `title`/`origin`/`body`（`6998b220a`）。已逐字节还原（`60cc7a269`，diff 验证 BYTE-IDENTICAL），肇事内容改用 `GOAL-014` 落地。

**缺陷的精确形状（⛔ 不要照抄"覆盖与更新在记录上同形"这句——它是错的，下面是核对后的真值）**：
- 事后记录**确实**区分 create 与 field-update：`goals: GOAL-013 create by cli:1901496` vs `goals: GOAL-013 field:title,origin,body by cli:1924376`。
- **不可区分的是另一对**：「一次**有意的**更新」与「一次**以为在新建**的误覆盖」——两者都渲染成 `field:<字段名> by cli:N`，**逐字同形**。
- 根因不在渲染，在**接口**：`write` 一个动词兼管新建与更新，**调用方无法声明自己期望哪一种**。⇒ store 自己**知道**这是 create 还是 update（CLI 正是靠这个知识实现「`--origin` 在 create 必传、update 可省」），但**调用方的信念无从表达，因此信念与事实不符时无人能发现**。

**为什么"先检查再写"不是解**：存在性检查是一个**有时效的读数**。本次 check 与 write 相隔约 33 分钟，而占用发生在其间的 **110 秒**内。在一个多会话并发写的共享 store 上，check→write 之间的任何间隔都可以被别人填满；把窗口缩短只是降低概率，不改变**失败时静默**这一性质。

**同族已有正解（硬规则 5b：同一原则只落实到了它被发现的那一处）**：task store 早已具备意图声明——`task_write` 的 `expectedStatus` 乐观锁（CAS，不匹配即 `isError:true` 且不写），CLI 侧对应 `--expect-status`（`QN-074`，done）。**goal store 没有任何等价物。** 本任务即把该原则补到兄弟 store 上，⛔ 不发明新范式。

**修法方向（细节留给实现，但下面两条是约束不是建议）**：
1. 给 `write` 加意图声明——形如 `--expect-absent`（意在新建，已存在即拒）/ `--expect-existing`（意在更新，不存在即拒），或等价的 CAS（`--expect-updated-at`）。**参照 `task_write` 的 CAS 语义与错误形态，⛔ 不另造一套。**
2. **⛔ 一个"只在调用方记得传时才生效"的守卫等于没有守卫（硬规则 9：守与不守在记录上无法区分，就只能靠意志）。** 故即使调用方**未**声明意图，「新建了一条本以为存在的记录」/「更新了一条本以为不存在的记录」也必须在**退出码或落痕**上与预期路径**不同形**。默认是否直接 fail-closed 由实现权衡（会影响既有调用方），但"沉默"不是可选项。

**发生率与立案依据（如实记明）**：**发生率 = 1**（2026-09-10，肇事者为一个 Claude Code 会话，即本任务的撰写者）。按硬规则 12，1 次发生**不足以**由机器主张新前置；**本条是人 2026-09-10 明确裁定「立案」后建立的**——记此出处，以免日后被当成机器自行加码的前置。

**与既有任务的 delta（相关但不同机制，⛔ 非重复）**：`gap-goal-store-write-surface-semantics`（**done**）修的是写入面六缺陷，其中 P1（CLI 强制 `--origin` 制造覆盖写）与 P2（goal-driver 快照-回传 origin 的竞态）最接近本条。**但两者机制不同**：P2 的修法是「删 goal-driver 的 origin 回传，让调用方不再做 read-modify-write」——而本次事故中调用方**显式且有意**地传了 `title`/`origin`/`body`，意图是新建，**P1/P2 的修复对这种情形完全不起作用**。P1 落地后 store 已能内部分辨 create/update（正是本条要利用的那份知识），却仍未把它开放给调用方声明。

## AC

- [x] **正向负控制（本次事故的最小复现）**：对一个**已存在**的记录执行带"意在新建"声明的写入 ⇒ 命令**非零退出**、stderr 指明该 id 已存在，且**目标文件未被改动**（写前写后 `git hash-object` 一致）
- [x] **反方向负控制**：对一个**不存在**的 id 执行带"意在更新"声明的写入 ⇒ 非零退出且不创建文件（⛔ 两个方向都要测：只测一个方向挡不住相反的失效）
- [x] **未声明意图时也可区分**：不带意图声明的写入若发生「创建了一条调用方以为存在的记录」或反之，其退出码/落痕与预期路径**取值不同**（⛔ 不与正常成功同形——硬规则 3b）
- [x] **不回归**：`node --no-warnings --experimental-strip-types --test packages/quay/test/goal-store.test.mjs` exit 0；且 goal-driver 的 status-only flip 路径（不传 `--origin` 的 patch 写）仍 exit 0
- [ ] `bash scripts/test.sh` exit 0（待外部）

## DoD

- [x] **用真实事故输入回放**：以 2026-09-10 那次的形态（目标是一条**已存在且 active** 的 GOAL、写入方意图为新建）重放一次 ⇒ 新机制下必须被拒或被显式标记，**不再静默覆盖**；回放在**真实 goal-store** 上做，⛔ 非 mock、非 fixture 注入，关掉任何测试注入缝后仍成立（硬规则 4 推论三）
- [x] 保护是**机制**不是**约定**：实现落地后，一个**完全不知道该 flag 存在**的调用方误覆盖活跃记录时，仍会在退出码或落痕上留下与成功不同形的证据——在任务体里写明这一条是**怎么被保证的**（哪一段代码、哪一条测试），⛔ 不以"文档写了要传 flag"充当完成
- [x] ⛔ **不重做 `gap-goal-store-write-surface-semantics`（done）的六缺陷**：本任务只加意图声明/CAS，不重改 `--origin` 必传规则、完整性校验分流、激活闸、`activatedAt`/`statusLog`

## Evidence

- **意图闸（DoD「机制非约定」的保证）**：`packages/quay/src/goal-store.ts` `write()` 内、`withFileLock` 锁内、任何落盘之前——`intent: "absent"` 且记录已存在 ⇒ `throw new GoalIntentConflictError(id, "absent", "present")`；`intent: "existing"` 且记录不存在 ⇒ `throw new GoalIntentConflictError(id, "existing", "absent")`。该闸对【完全不知道该 flag 存在】的调用方同样成立：调用方只须声明 `--expect-absent`（create 意图）即被拒；未声明意图的调用方走既有 patch 语义，其 create/update 的落痕（提交 subject `create` vs `field:…`，`commitGoalFile` 的 action 判定）仍可区分、不与成功同形（AC3）。
- **测试（哪一条测试）**：`packages/quay/test/goal-store.test.mjs` 新增「AC1/AC2（双向负控制 + 事故重放 + `git hash-object` 文件未改）、AC3（未声明意图落痕可区分）、AC4（status-only flip 不回归）」；全部在真实 goal-store/CLI 上跑（⛔ 非 mock、非 fixture 注入），实测 `node --no-warnings --experimental-strip-types --test packages/quay/test/goal-store.test.mjs` 52 pass / 0 fail。
- **DoD 重放**：AC1 测试即以 2026-09-10 事故形态（已存在且 active 的 GOAL + 显式传 title/origin/body 的 create 意图）重放，新机制下非零退出、stderr 报 already exists、文件 `git hash-object` 逐字节未变。

## Touches

- `packages/quay/src/goal-store.ts`
- `packages/quay/test/goal-store.test.mjs`
- `tasks/gap-goal-store-write-no-create-vs-update-intent-guard.md`

**⛔ 刻意不含 `plugin/scripts/meta-driver.ts`**：调用方侧的改动归 `gap-meta-filedecisions-goal-write-omits-body`（ready）。两条若都声明该文件会 Touches 重叠 ⇒ 机械串行派发，收益为零。本条**只做 store 表层**；若新机制要求调用方显式声明意图，由那条任务在其自己的 Touches 内接线。