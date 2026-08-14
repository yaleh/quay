---
id: gap-in-flight-resolve-by-task-id-not-worktree-name
title: --in-flight 传 worktree 目录名被截断致在飞少算 1 ⇒ slots_free 虚高 ⇒ AC53 闸误拒心跳（jsonl 56→57 恢复实证）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（--in-flight 传 worktree 目录名而非真任务 id，目录名截断 ⇒ 在飞少算 ⇒ slots_free 虚高 ⇒ 闸误拒写入——2026-08-14 12:4xZ inner 实证 + manager 定位，立案归 outer）**。

**根因链（实测）**：
```
inner 的 slot-refill --in-flight 传 worktree 目录/分支名（非真任务 id）
worktree 目录名被截断：gap-workflows-dual-copy-drift（真任务 id 缺 -unchecked）
                      gap-test-isolation-backlog-44（真 id 缺 -violations-unmeasured）
⇒ 在飞识别少 1 ⇒ slots_free 虚高
⇒ AC53 结束不变式闸（should_refill ∧ slots_free>0 拒写）误拒心跳写入
⇒ inner 传真任务 id 后：in_flight=5/slots=0/should_refill=false ⇒ 闸放行 ⇒ jsonl 56→57
```

**代价链**：`--in-flight` 少算 ⇒ `slots_free` 虚高 ⇒ `should_refill=true` 误导派发评估；且 AC53 闸（对 should_refill 诚实）因此拒写心跳，心跳追加恢复被延迟到「传真 id」这一刻。**根在【在飞集合的构成来源】——用 worktree 目录名（可截断的派生量）冒充任务 id（真量）**（4b：代理量优先 vs 直接量）。

**⚡ 同一时刻三种写法给出三个不同 `in_flight_count`（manager 12:3xZ 独立复核读数）**：
```
worktree 目录名 → 3      分支名 → 4      真任务 id → 5（真值）
```
**⇒ 这个量对「怎么写 id」敏感，而它本不该敏感。** (b)（只改这条分支名）修的是症状——下次建树再截断就再犯。

**一般形态（三层今天各中一次，写进理由）**：「一个正确的闸/检查，喂给它的量不准 ⇒ 它正确地拒了一个不该拒的」——inner 传目录名差点停在「等重跑」错答案；manager 同调查先传目录名(3)再传分支名(4)第三次才对；而答案从「等重跑」翻成「有个名字截断了」，两个结论行动完全不同。**⇒ 核任何「闸为什么拒」之前，先确认喂给它的量是不是它期望的那个形态。**

**判据1**：`--in-flight` 解析按【任务 id 匹配】——任何传入的在飞标识（worktree 目录名 / 分支名 / task id）先归一到任务 id（如按 `tasks/<id>.md` 存在性 + 目录名前缀匹配），**截断的目录名也能解析到真 id**——一次修所有截断（manager 裁定 (a)）。**⊢ 传入目录名/分支名与传入任务 id 得到的 `in_flight_count` 不一致 ⇒ 红**。
**判据2（能取假·真样本不构造）**：现状传 `gap-workflows-dual-copy-drift`（截断目录名）⇒ 在飞少算 ⇒ slots_free 虚高（**真样本=本次实证**，jsonl 56→57 前；回放它判据1 必须红）；修后传截断名也能解析到真 id、in_flight 不偏。
**判据3 边界**：**不改 AC53 闸**（闸本身是对的，立条实证与实现都核过）；**改的是喂给它的量**（在飞集合）。
**判据4（问项）**：**分支名为什么会截断？**——若建树路径对任务 id 做长度截断，**每一条长 id 任务都会中**。落地时查「是否只此一例」还是系统性（建树路径的截断逻辑），并在 Evidence 记录。
**判据5**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改 AC53 闸的判据（闸对 should_refill 诚实是正确行为）；不改 worktree 命名约定（截断本身不是缺陷，解析不认截断才是）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 slot-refill.ts 的 `--in-flight` 解析 + inner tick doc 的在飞集合构成（fast-mode-loop-tick.md:338）+ 建树路径（分支名截断来源，判据4 问项）。
2. 判据1：`--in-flight` 解析按任务 id 匹配（worktree 目录名/分支名/task id 归一，截断可解）；⊢ 三种写法 in_flight_count 不一致 ⇒ 红。
3. 判据2 能取假：截断目录名回放红（在飞少算）+ 修后绿（解析到真 id）。
4. 判据3：不改 AC53 闸（改喂给它的量）。
5. 判据4：查分支名截断是否系统性（建树路径），Evidence 记录「只此一例 or 每长 id 都中」。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：`--in-flight` 解析按任务 id 匹配，截断 worktree 名归一到真 id；三种写法 in_flight_count 一致。
- [x] AC2 判据2 能取假：截断目录名（gap-workflows-dual-copy-drift）回放红（在飞少算）。
- [x] AC3 判据3：不改 AC53 闸（只改喂给它的量）。
- [x] AC4 判据4：分支名截断是否系统性已查（建树路径），Evidence 记录。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] `--in-flight` 按任务 id 解析（截断 worktree 名归一到真 id），在飞读数不再少算，AC53 闸不再误拒心跳追加；分支名截断系统性已查证。

## Touches

- plugin/scripts/slot-refill.ts（--in-flight 解析按任务 id 匹配）
- plugin/test/slot-refill.test.mjs（补截断名解析测试）
- tasks/gap-in-flight-resolve-by-task-id-not-worktree-name.md（自身）

## Test-Files

- plugin/test/slot-refill.test.mjs（已有文件，补 4 个测试：resolveInFlightId 纯函数单元（exact/branch/truncated/ambiguous-unresolved）+ CLI 判据1 三形式一致 + CLI 判据2 真实样本截断名解析）

## Evidence

（落地后回填 — 2026-08-14 12:5xZ inner 实现）

**实现**：`plugin/scripts/slot-refill.ts` 新增纯函数 `resolveInFlightId(tasksDir, input)` —— 把 `--in-flight`/`--closed-but-live` 的每个标识（worktree 目录名 / 分支名 `task/<id>` / 真任务 id）归一到【真任务 id】：①剥 `task/` 前缀；②`tasks/<名>.md` 存在 ⇒ exact；③恰好一个任务 id 以该名为严格前缀 ⇒ truncated-prefix 解析到真 id；④多个/零个 ⇒ 原样返回 `unresolved`（保持原 advisory-skip，**绝不猜**——猜错的 id 污染 touches-disjointness 比缺 id 更糟）。`main()` 的 `readTasks` 先经 `resolveInFlightId` 再读文件，解析出的**真 id** 同时进 touches-disjointness 集合。**AC53 闸零改动**（判据3）。

**判据4 问项：分支名为什么截断？（只此一例 or 系统性）**
**结论：非机械截断 —— 是 `<slug>` 约定的代理方缩写，风险弱系统性（任何长 id 都处代理方裁量之下），但无确定性长度上限。**
证据（对真实 `git worktree list` 的 5 棵在飞树逐一量度）：
```
29 gap-ac63-judgment2-no-carrier                         （dir=branch=真 id）
38 gap-fan-in-flip-no-ac-completion-check                （dir=branch=真 id）
32 gap-in-flight-resolve-by-task-id                      （dir=branch=真 id）
29 gap-test-isolation-backlog-44                         （dir 截断；branch=task/gap-test-isolation-backlog-44-violations-unmeasured 全名）
29 gap-workflows-dual-copy-drift                         （dir 与 branch 均截断；真 id …-unchecked，全名 39 字符）
```
- **无机械长度上限**：未被截断的树是 38/32 字符（比两个 29 字符的截断树更长），故不是某固定字符截断位。
- **`git worktree add` 不截断**；grep 全仓建树路径（`fast-mode-loop-tick.md:976/:1043` 的 `git worktree add $WORKTREE_ROOT/<slug> -b task/<id>`）无任何 `slice/substr/length` 截断逻辑 —— `<slug>` 由派发代理自由缩写。
- **系统性判定**：**弱系统性** —— 约定本身邀请缩写，任何长 id 任务建树时都可能被代理缩写，且截断的缩写是前缀 ⇒ 本次修复（按任务 id 前缀解析）对所有同类生效；但**非确定性机制**（无代码路径强制截断），故不能靠「修建树逻辑」根除，只能靠解析侧容忍截断。

**判据2 能取假回放 + 判据1 三形式一致（对真实 store 实跑，`--root`=本 worktree）**：
```
真任务 id 形式（5 个）            → in_flight_count = 5 | slots_free = 0
截断 worktree 目录名形式（5 个）   → in_flight_count = 5 | slots_free = 0   （修复前=3 ⇒ slots_free 虚高 2）
分支名形式（task/<id>，混合截断）  → in_flight_count = 5 | slots_free = 0
```
（截断目录名形式修复前对 `gap-test-isolation-backlog-44`、`gap-workflows-dual-copy-drift` 两个 `tasks/<名>.md` 不存在 ⇒ 静默跳过 ⇒ 3；与任务体实证「目录名→3」吻合。）

**scoped 门**：`bash scripts/test.sh --for-task gap-in-flight-resolve-by-task-id-not-worktree-name --allow-thin` → **EXIT=0**（slot-refill.test.mjs 全量 79 tests / 0 fail，含新增 4 条）。
**ts-typecheck**：`fan-in-ts-typecheck-gate.ts` → **ADMITTED (exit 0)**（Touches 无新增/移动 .ts）。
**既有测试全绿**：slot-refill.test.mjs 79/79；`--for-task` scoped 门绿。
