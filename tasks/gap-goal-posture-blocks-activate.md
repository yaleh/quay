---
id: gap-goal-posture-blocks-activate
title: goal-driver 分诊尊重 GOAL 层 posture——measure-only 名下 draft AC 不得判 activate，只落
  re-anchor/needs-human/hold
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-driver-draft-ac-triage
goal_ac: AC-215
---
## Proposal

正本：`goals/AC-215-分诊尊重-goal-层-posture-人已声明-只测量不激活-的-goal-driver-不得越权-activate.md`（GOAL-010 名下 criterion），判据 = `node --no-warnings --experimental-strip-types --test plugin/test/goal-posture-blocks-activate.test.mjs`。

**现状（实测，非主张）**：
- goal 记录**读不回** posture：`packages/quay/src/goal-store.ts` 的 `toViewModel`（`:349-379`）只投影命名字段、`OWNED_KEYS`（`:98-101`）不含 `posture`。goal 文件 frontmatter 里写 `posture: measure-only` 会被 `write` 的保序循环（`:814-823` 的 `!OWNED_KEYS.has(k)` 分支）原样保留，但 `list`/`get` 读回时被 `toViewModel` 丢弃 ⇒ `listGoalRecords`（`plugin/scripts/goal-driver.ts:147-155`）拿不到该字段。
- `plugin/scripts/goal-driver.ts` 全文无 posture / measure-only 处理（grep 0 命中）。
- 五态 draft-AC 分诊决策函数本体尚未落地——由 sibling `gap-goal-driver-draft-ac-triage`（`goal_ac: AC-210`，ready）引入，其形状 `纯函数：record + goal posture + taskFacts ⇒ decision`，且其边界已明言「measure-only 不 activate 归 AC-215」。故本任务 `depends_on` 它。
- 立条实测冲突（AC-215 origin，已复核）：GOAL-009 status=active、其 AC-201..207 + AC-214 共 8 条全部 status=draft，人已刻意只激活 goal 层、把 AC 留 draft（先测量后承诺）。AC-210 一落地，这 8 条可能被判 activate 并翻转；每条激活后无在飞任务即成缺口（`goal-driver.ts:345`）⇒ 自动派 8 个任务 ⇒ 人的裁定被静默推翻。选 GOAL 层 posture 而非 per-AC hold 标记：AC-214 是姿态决定**之后**新建的，per-AC 标记必然漏掉后来新增的 AC，GOAL 层声明自动覆盖。

**修法（两处源码 + 一处新测试）**：
1. `packages/quay/src/goal-store.ts`：goal 记录支持显式 posture 声明——`posture` 进 `GoalFrontmatter` / `GoalViewModel` / `OWNED_KEYS` / `toViewModel` 投影 / 保序写列表，使 `goal-store list` 返回该字段、`listGoalRecords` 能在 GOAL 记录上读到。⛔ quay-native 的 goal-store 是 Core 的 re-export shim（`packages/quay-native/src/goal-store.ts` 只 re-export），无需改动。
2. `plugin/scripts/goal-driver.ts`：分诊决策函数尊重 posture——当 GOAL 的 posture 声明 measure-only，其名下 draft AC 不得判 `activate`，判决只能落在 `re-anchor` / `needs-human` / `hold` 三态。（决策函数本体归 AC-210，本任务只接 posture 执行面。）
3. 新建 `plugin/test/goal-posture-blocks-activate.test.mjs`：双向负控制——未声明 posture 的 GOAL ⇒ activate 可达；已声明 ⇒ activate 被拒且判决落在其余三态之一。

⛔ 范围外（各自另有 AC，本任务不碰）：五态分诊函数本体（AC-210）；retire→needs-human 写面（AC-211）；needs-human 进词表/计入在域/阻塞 GOAL（AC-209）；充分性闸与 not-evaluated（AC-212/AC-213）；draft→active 激活本身（裁定 3，人/manager 手动）。

## AC

- [x] `node --no-warnings --experimental-strip-types --test plugin/test/goal-posture-blocks-activate.test.mjs` 退出码 0（AC-215 criterion 逐字）
- [x] 方向一（负控制①，activate 可达）：测试断言未声明 posture 的 GOAL 名下 draft AC ⇒ 分诊决策可为 `activate`——证明「堵 activate」不是无条件恒真（`grep -n "activate" plugin/test/goal-posture-blocks-activate.test.mjs` 命中该断言点）
- [x] 方向二（负控制②，activate 被拒）：测试断言声明 measure-only 的 GOAL 名下 draft AC ⇒ 决策 `!== "activate"` 且 `∈ {re-anchor, needs-human, hold}`——`grep -n "re-anchor\|needs-human\|hold" plugin/test/goal-posture-blocks-activate.test.mjs` 命中该断言点
- [x] posture 读回（expect 前半）：`packages/quay/src/goal-store.ts` 的 `OWNED_KEYS` 与 `toViewModel` 投影含 `posture`（`grep -n "posture" packages/quay/src/goal-store.ts` 命中 ≥2 处：类型 + 投影/OWNED_KEYS）
- [x] scoped 门 `bash scripts/test.sh --for-task gap-goal-posture-blocks-activate --allow-thin` 退出码 0

## DoD

AC-215 criterion 两半都满足：①goal 记录可显式声明并读回 posture（`goal-store list` 对带 `posture` 的 GOAL 记录返回该字段，非仅在写路径原样保留）；②双向负控制单测证明「未声明 ⇒ activate 可达、已声明 ⇒ activate 被拒且落 re-anchor/needs-human/hold 三态之一」——两条负控制各带一条「改坏 ⇒ 测试红」的取假路径（硬规则 4 推论三），实跑输出贴本任务体供 fan-in 复核。`plugin/test/goal-posture-blocks-activate.test.mjs` 退出码 0；改动经 fan-in 落地 develop，`git show develop:plugin/test/goal-posture-blocks-activate.test.mjs` 可见该文件。

## Touches

- `packages/quay/src/goal-store.ts`
- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-posture-blocks-activate.test.mjs`
- `tasks/gap-goal-posture-blocks-activate.md`
