---
id: gap-criterion-side-effect-unguarded-at-write-and-execution-surface
title: criterion 可隐式触发真实外部写入：goal-store 两处 runAcceptance 调用点均无执行前能力判断（ADR-004 未硬化）
status: ready
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

**来源（跨项目实证，非推测）**：2026-10-12 在 **quay-fleet** 项目查清的一场真实会话风暴。Fleet 侧已就**本地产物**立案两条（`fleet-p0-criterion-side-effect-lock`、`fleet-p0-realcheck-explicit-optin-and-caps`）；**本任务只承担其中属于 Quay 通用 Driver/Policy 的那一半**，⛔ 不重复 Fleet 侧的本地修复。

**缺陷类别**：`criterion` 是**自由文本 shell**，而 `goal check --stale-pass --sweep` 会**无限期、无人值守地周期性重跑每一条 criterion（含 `achieved` 的）**。因此**任何带副作用的 criterion 都等价于一台永久的、无人值守的副作用发生器**。这不是"某个项目写错了一条判据"，而是 **criterion 通道把「读数」与「动作」混为一谈**——通道设计缺口。

**执行面现状（已核对源码，两处调用点，均无任何执行前能力判断）**：

- `packages/quay/src/goal-store.ts:2033` — `const res = runAcceptance({ command: criterion, cwd, timeoutMs: resolveAcceptanceTimeoutMs() });`
- `packages/quay/src/goal-store.ts:2310` — 同上（另一条路径）
- 唯一的界是 `timeoutMs`。`runAcceptance` 内部就是 `spawnSync`（`goal-store.ts:62` import），**命令照跑**。

**实测证据（quay-fleet 侧，出处完整）**：`AC-020`（status=`achieved`）的 criterion 为 `node bin/quay-fleet.mjs cloudcli delegate-smoke --json | node -e …`；被调命令的真实副作用由其自身源码头注释写明（"`session_create` IS CALLED WITHOUT `message` ON PURPOSE"）。该 AC 在 `.quay/goal-round.jsonl` 的 **112 个 goal round** 中被评估过。现场抓到的**进程链**（父子关系实测，非推断）：

```
3314402 /bin/sh -c node bin/quay-fleet.mjs cloudcli delegate-smoke --json | node -e …
  └─ 3314363  quay.js goal check --stale-pass --sweep --store …
       └─ 2738045  driver-anchor __anchor --root /data/home/yale/work/quay-fleet
```

同项目另一次复发更说明"搬文件不是修复"：把带副作用的文件移出 `test/` 之后，有人把 criterion 改指向 `node --test realchecks/<file>.mjs`（**显式路径永远真执行**），风暴**立刻重新上膛**（改判据 `08:22:48Z` → 复现 `08:23:46/08:24:01`、`08:25:40/08:25:55`，两对，时刻精确对应）。

**与 ADR-004 的关系（本条的立案依据，不是我的偏好）**：**ADR-004（status: accepted）**规定：load-bearing 规则**必须**变成**可执行检查**、**fail closed on drift**；散文只是 rationale，**⛔ 绝不能是规则的唯一存放处**。今天「criterion 必须是读数而非动作」这条规则**只活在 Fleet 的证据文档散文里**——按 ADR-004，这**不够**。本任务即把它 Π_{S→E} 硬化。

**与 ADR-028 同族**：ADR-028（判据 vs 现实轴）问"一条报绿的检查漏了什么"。这里漏的正是**这条判据自己有没有副作用**——一个从没红过的检查，与一个每次都在真实建会话的检查，从判决输出上看**完全一样**。

**同族已有正解（同一原则只落实到了它被发现的那一处）**：store 早已在**写入面**对其它 intent 类做过 fail-closed 拒绝——`gap-goal-store-write-no-create-vs-update-intent-guard`（done）为 `write()` 加了意图声明闸，`task_write` 早有 `expectedStatus` CAS。**说明"在执行/写入面 fail-closed 拒绝"是本代码库已有的范式**，只是**没有覆盖 criterion 的副作用这一维**。本任务补这一维，⛔ 不发明新范式。

**修法方向（约束而非建议）**：
1. **在执行前**判断 criterion 的能力，命中即 **fail-closed 拒绝**并返回**稳定错误码**；⛔ **不是打印警告后继续执行**（警告在无人值守路径上等于没有）。
2. **按能力判定（端点 / 写动词 / 显式声明），⛔ 不按命令名或路径字符串拼写判定。** 这条纪律是被实测逼出来的：Fleet 侧那把锁最初按"文件里有没有 `callTool` 方法"判，结果**事故文件自己就有一个转发壳**，名字证明不了任何事；改成"看端点"之后才抓住。
3. **必须有显式的、有人在场的旁路**——真实 E2E 仍需可执行（Fleet 侧 `realchecks/` 就是干这个的），但旁路本身要**显式、可审计、有上限**，⛔ 不能是"某条路径恰好没被扫到"。
4. **两处调用点都要覆盖**（`:2033` 与 `:2310`）；⛔ 只修一处＝把同一原则重新留给下一个发现者。

**⛔ 明确不做（避免与既有任务重复）**：不改 `--origin` 必传规则、不改完整性校验分流、不改激活闸/`activatedAt`/`statusLog`（属 `gap-goal-store-write-surface-semantics`）；不改保真性判定器（`criterion-fidelity.ts` 是另一条轴）；不改 `task` 侧 gate（`quay gate <task-id>` 是 task 面，本条是 goal criterion 面）。

## AC

- [ ] **执行前闸**：criterion 命中"带真实副作用能力"即 **fail-closed 拒绝**，返回**稳定错误码**（调用方 branch on `code`，⛔ 不 branch on message），且**命令未被 spawn**（给出"未 spawn"的机械读数，⛔ 不接受"跑完发现不该跑"）
- [ ] **判定按能力**：给出能力判定的**具体规则**（端点/写动词/显式声明中的哪一种或哪几种），并在任务体写明**为什么按名字判会漏**（附 Fleet 侧"转发壳"实测反例）
- [ ] **两个调用点都覆盖**：`goal-store.ts:2033` 与 `:2310` 两条路径**各自**有实测读数（⛔ 只测一条即视为未完成）
- [ ] **正控（必须是真实历史件）**：把 `quay-fleet` AC-020 的 criterion 原文喂进判定器 ⇒ **必须拒绝**
- [ ] **正控 B（真实历史件）**：把"指向 `realchecks/` 的显式 `node --test` 路径"那条 criterion 原文喂进判定器 ⇒ **必须拒绝**
- [ ] **负控**：对现存**只读** criterion（如 Fleet 的 `node -e` 证据文档结构检查）⇒ **必须放行**（证明"拒绝"不是"一律拒绝"的同形）
- [ ] **旁路可用且可审计**：显式旁路下真实 E2E 仍能执行；旁路的使用**在落痕上可见**（⛔ 与正常判据执行同形）
- [ ] **不回归**：`goal check --stale-pass --sweep` 在**全只读**的判据集上行为不变（exit 0，逐字与改动前同）
- [ ] `bash scripts/test.sh` exit 0

## DoD

- **用真实事故输入回放**：以 2026-10-12 的形态（criterion = 会真实建/发会话的命令，且 `achieved`）在**真实 goal-store 与 CLI** 上重放 ⇒ 新机制下**必须被拒**，且**命令未被 spawn**；⛔ 非 mock、⛔ 非 fixture 注入
- **保护是机制不是约定**：实现落地后，一个**完全不知道该机制存在**的调用方写入带副作用的 criterion 时，仍会在**执行前**被拒——在任务体写明这**是怎么被保证的**（哪一段代码、哪一条测试），⛔ 不以"文档写了不要这么写"充当完成
- **生产 Manager 唤醒不受影响（Fleet 侧约束，作为本条的验收面之一）**：本改动**不得**改变任何**只读** criterion 的行为；给出改动前后同一条只读 criterion 的逐字读数对比

## Evidence

（待填：两处调用点的改动位置与行号、能力判定规则、正控 A/B 与负控的逐字读数、真实重放的进程级证据"命令未被 spawn"）

## Touches

- `packages/quay/src/goal-store.ts`
- `packages/quay/test/goal-store.test.mjs`
- `tasks/gap-criterion-side-effect-unguarded-at-write-and-execution-surface.md`
