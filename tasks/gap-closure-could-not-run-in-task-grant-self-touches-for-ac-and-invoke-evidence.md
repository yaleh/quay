---
id: gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence
title: closure could not run in-task because of two hard dispatch constraints (①
  Touches 'only these' excludes the task's own file — measured 0 hits on
  own-task-file for init-ships/eighty-one/load-sensitive; ② SCOPED ONLY forbids
  the full suite while DoD requires it) — grant each task its own tasks/<id>.md
  in Touches so the agent self-checks AC boxes + invoke evidence at completion;
  closure shrinks to one DoD line per task (the only true timing dependency),
  making it too small to be a sync point (implements the human's closure-async
  ruling)
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者查清的**收尾为什么没在任务过程内做**（承接人的收尾异步化裁定，这是可执行的下一层）。不是没给
引用——派发提示词第一段就是「Task file — READ FIRST (single source of truth)」带完整路径。真正拦住
的是**两条硬约束**：

1. **Touches 授权**：任务的 `## Touches` 声明里**不含它自己的任务文件**（实测 init-ships /
   eighty-one / load-sensitive 三个全部 0 命中自己文件），派发词明写「Touches (only these)」⇒ 改自己
   任务文件属越界。
2. **SCOPED ONLY**：派发词明令只跑 scoped 测试、不跑全量 suite（怕污染 sibling 基准），而 **DoD 判据
   恰是全量绿** ⇒ 任务代理**没资格知道这条满不满足**。

**三项记账性质不同**（管理者的分解）：
- **勾 AC 复选框 + 加 invoke 实跑证据**：任务代理**本来就有全部事实**（自己实现的、scoped 测试自己
  跑的），**只差 Touches 授权**。
- **勾 DoD（全量绿）**：**唯一真时序依赖**（SCOPED ONLY 下任务内不可知）。

**实测数据（管理者）**：收尾子代理 21 Bash / 12 Read / 16 Edit，**跑测试命令数 0**——它纯文本编辑，
一次测试都不跑。

**管理者意见**：把 `tasks/<id>.md` 加进每个任务的 Touches 声明，前两项（AC 勾框 + invoke 证据）下放给
任务代理自己做，收尾从「5 个任务勾所有框+贴所有证据」缩到「每任务勾一行 DoD」，量小到构不成任何
同步点——正好落实人的收尾异步化裁定。

### 选定机制（外层裁定：**同意**，含两条边界）

1. **每个任务的 `## Touches` 增加自身文件 `tasks/<id>.md`**——**不带 `(new)` 标注**（它是已存在的
   任务文件；带 `(new)` 会误触 `taskWorkLanded` 的 new-touch 路径，把一切任务判成「工作已落地」，
   破坏就绪池）。**只允许自己文件，禁止碰其他任务文件**。
2. **派发词约定更新**：任务代理**完成时**编辑自己任务文件——勾 AC 复选框 + 贴 invoke 实跑证据（它
   自己 scoped 测试的输出）。**仍 SCOPED ONLY**（不跑全量 suite）；**不翻 status**、**不勾 DoD 行**。
3. **收尾（外层异步）只剩 DoD 行**：每任务核对 DoD（全量绿，对照外层 verification-round 的全量结果）
   + 翻 done + 关遥测括号 + 写记录。收尾每任务 = 一行，量小到不是同步点。

**checkTouchesPair 并发资格判定（外层裁定，已核代码）**：**不受影响**。`checkTouchesPair` 判
`expanded 文件集重叠`（`touches-orthogonality-check.ts` `filesDisjoint`：`overlaps.length === 0`）；
自身文件是每任务唯一的（A.md ≠ B.md），A 触 `tasks/A.md`、B 触 `tasks/B.md` ⇒ 仍 disjoint:true。
**唯一要求**：self-file 行不带 `(new)`（带则 `taskWorkLanded` new-touch 路径误判——已核
`hasAnyLandedNewTouch` 只认 `(new)`/`（新）` 标注）。共享同一文件的真实冲突仍被 disjoint:false 拦下。

**与 closure-async 的关系**：`gap-closure-sync-is-the-true-batch-boundary-...` 是机制根（inner 循环删
收尾步 + 外层加收尾例程）；本条是**细化层**（AC/证据下放任务代理，收尾只剩 DoD 行）。依赖前者（收尾
例程形态定了，本条才定收尾只剩什么）。

## Acceptance Criteria

- [ ] AC1: 每个任务 `## Touches` 含自身文件 `tasks/<id>.md`（**不带 `(new)`**）；静态检查/脚本验证
      ready+可派任务的 Touches 引用自己文件
- [ ] AC2: 派发词约定更新——任务代理完成时编辑自己文件：勾 AC 复选框 + 贴 invoke 实跑证据（自己
      scoped 测试输出）；**仍 SCOPED ONLY**、**不翻 status**、**不勾 DoD 行**
- [ ] AC3: 收尾（外层异步）每任务只剩 DoD 行核对 + 翻 done + 关遥测括号——**不再做 AC/证据工作**
      （收尾对已完成任务的 AC 勾框/证据是 no-op，因代理已自勾）
- [ ] AC4: **checkTouchesPair 不受影响**——单元验证：A 触 `tasks/A.md`、B 触 `tasks/B.md` ⇒
      disjoint:true；共享文件 ⇒ disjoint:false（两向 fixture）
- [ ] AC5: **self-file 不带 `(new)`**——单元验证：`tasks/<id>.md` 无 `(new)` 标注 ⇒
      `hasAnyLandedNewTouch` 不触发（就绪池不被误判清空）
- [ ] AC6: **真实使用**——至少一个任务：代理自勾 AC + 自贴 invoke 证据，收尾只勾 DoD + 翻 done，
      实跑证据贴任务体
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC4/AC5/AC6 实跑输出贴任务体
- [ ] 收尾量级实证：一次收尾只做 DoD 行（代理已自勾 AC/证据），收尾不再同步点
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/loop/fast-mode-loop-tick.md（派发词约定：任务代理完成时自勾 AC + 贴证据，SCOPED ONLY 不变）
- plugin/scripts/touches-orthogonality-check.ts（或新增静态检查：ready 任务 Touches 含自身文件）
- plugin/test/（AC4/AC5 两向 fixture 单测）
- tasks/gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async.md（交叉标注：
  本条是 AC/证据下放的细化层）

## Contract

measure   task_agent_self_checked = 完成时由任务代理自勾 AC + 自贴证据的任务数
band      task_agent_self_checked >= 1（真实使用至少一个）
invariant closure_work_per_task = 1 DoD 行（收尾对每任务不再做 AC/证据）
invoke    checkTouchesPair 两向 fixture（AC4）+ hasAnyLandedNewTouch 负控制（AC5）
control   共享文件两任务 ⇒ disjoint:false（真实冲突仍拦）；各自 self-file 仅 ⇒ disjoint:true
resume    派发词约定与静态检查分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T02:3xZ
changed: 外层受管理者查清的根因 + 意见裁定立案（同意 + 两条边界）：
(1) **同意分解**——AC 勾框 + invoke 证据是任务代理已有事实、只差 Touches 授权；DoD 全量绿才是真时序
    依赖；收尾缩到每任务一行 DoD = 落实人收尾异步化裁定的可执行层；
(2) **checkTouchesPair 裁定：不受影响**——自身文件每任务唯一，A.md≠B.md 仍 disjoint；已核
    touches-orthogonality-check.ts 的 filesDisjoint（重叠=0）；
(3) **边界 1：self-file 不带 `(new)`**——已核 hasAnyLandedNewTouch 只认 (new)/（新），带标注会把
    一切任务误判「工作已落地」破坏就绪池；
(4) **边界 2：代理不翻 status、不勾 DoD**——翻 status 仍是收尾（verification-round 全量绿后）的活。
status: todo——排在 closure-async 机制根之后；这是收尾异步化的细化层。
