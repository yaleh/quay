---
id: gap-store-commit-action-and-actor
title: store-commit 提交信息无动作语义、无写入者：一次逻辑动作 16 次同文案提交，72h 内 goals/ 4007/4042
  同形，立条者三天后即不可追溯
status: done
labels:
  - gap
  - defect
  - store-commit
parent: null
children: []
extra: {}
depends_on:
  - gap-goal-store-write-surface-semantics
---
**type:** execution

## Proposal

`store-commit` 的提交信息是**固定文案**，既无动作语义、也无写入者 ⇒ `goals/` 的 git 历史对审计不可用。证据采于 2026-09-09，非主张：

- 一次**逻辑动作**（建 1 条 GOAL + 6 条 AC + 6 次 expect 补写 + 3 次激活）产生 **16 次提交**，subject 全部是 `goals: <id> 写盘即提交（store-commit）`。
- 72 小时内 `goals/` 共 **4042** 次提交，其中 **4007（99.1%）** 是这同一句。
- ⇒ create／改判据／改状态／driver 的机械 flip 在 git 历史里**完全同形**，且都不带写入者。

**代价实证**：2026-09-09 追查「GOAL-001 名下那 6 条 draft AC 由谁创建」时正是卡在这里——6 条里只有 AC-180 因是人工提交、带 `Claude-Session` 落款而可追溯；其余 5 条只能证到「经 goal-store CLI 写入」，**证不到是哪个会话**。三天前的记录已经无法归属。

**文案构造点（实测五处；`store-commit.ts` 只收一个 `message` 字符串，文案由各 kind 自己拼）**：

- `packages/quay/src/goal-store.ts:312`
- `packages/quay/src/document-store.ts:174`
- `packages/quay/src/adr-store.ts:237`
- `packages/quay/src/meta-store.ts:84`
- `packages/quay-native/src/store.ts:1131`（task 侧）

**修法**：

1. 提交信息带**动作**：`<create | field:<name> | status <from>→<to>>`
2. 带**写入者**：`by cli:<session|pid>` 或 `by driver:<run-id>`
3. `--batch`：多条写入一次提交（16 次/1 动作 ⇒ 1 次）
4. **五 kind 一起改**——把文案拼装收进 `store-commit.ts` 的单一构造函数，各 kind 只传结构化字段；否则又是「在某处修好 X ≠ X 只在那一处」，而这个面刚被 GOAL-008 统一过一次，不该再分叉。

**依赖与顺序（必须遵守）**：本任务与 `gap-goal-store-write-surface-semantics` 的 Touches 在 `packages/quay/src/goal-store.ts` 上**相交** ⇒ 必然串行，故以顶层 `depends_on` 钉死顺序。⛔ 顺序不可颠倒：那条改的是 `write()` 的语义，本条改的是它产出的提交文案；反过来会让前者带着旧文案落地、再被本条改一次，白做一轮。

**与既有任务的关系（查重按机制，非症状）**：`gap-store-commit-unification-stage1` / `-ac196-four-state-return` / `-ac197-five-kind-wiring`（均 done）建立了单一提交原语与四态返回——本任务是它们的**后继**（给已统一的原语补上动作语义与写入者），不是重复。`gap-goal-gate-timestamp-commit-flood`（done）处理的是 evidence 时间戳导致的提交洪水，机制不同。

## AC

- [x] AC1（动作可辨，双向）：一次 create 与一次 status flip 各产生一条提交，两者 subject **不同形**，且分别含 `create` 与 `status <from>→<to>`；反向：改动作前的历史提交仍能被解析（不破坏既有历史读取）。
- [x] AC2（写入者可辨）：`git log --format=%s -20 -- goals/ | grep -c 'by '` == 20——最近 20 条 store-commit 提交每条都带 `by cli:` 或 `by driver:` 之一。
- [x] AC3（批量）：一次 `--batch` 写 N≥3 条记录 ⇒ 该次操作产生的提交数 == 1（`git rev-list --count` 前后差为 1）。
- [x] AC4（五 kind 单一构造点，按位置判定）：五个 store 文件中**自己拼提交文案字符串**的处数 == 0，全部委托 `store-commit.ts` 的构造函数——`grep -c '写盘即提交' packages/quay/src/{goal,document,adr,meta}-store.ts packages/quay-native/src/store.ts` 合计为 0。
- [x] AC5（不回归）：`goals/` 的提交仍能被 develop→doc 的 ff-only 同步消费——`gap-meta-commitgoalfile` 建立的不变式不破（以 `plugin/test/goal-invariants-standing.test.mjs` 中相关断言跑绿为准）。

## DoD

- 五个 kind 的提交文案全部经**同一个**构造函数产出，⛔ 无各写一份——按位置 grep 可查，不是靠约定。
- 在真实仓库上做一次 create + 一次 status flip + 一次 batch，`git log` 里三者可逐条区分、且都带写入者——⛔ 不是只在单测里成立。
- 全量 `scripts/test.sh` 绿。

## Touches

- `packages/quay/src/store-commit.ts`
- `packages/quay/src/goal-store.ts`
- `packages/quay/src/document-store.ts`
- `packages/quay/src/adr-store.ts`
- `packages/quay/src/meta-store.ts`
- `packages/quay-native/src/store.ts`
- `packages/quay/test/store-commit.test.mjs`
- `tasks/gap-store-commit-action-and-actor.md`