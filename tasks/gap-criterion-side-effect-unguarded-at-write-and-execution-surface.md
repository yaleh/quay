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

## Implementation

**新增 `packages/quay/src/gate/criterion-capability.ts`** —— 纯判定器（⛔ 自己什么都不 spawn，与 `criterion-fidelity.ts` 同形：纯判定 + 三态）。

**判定轴（⛔ 只有能力，没有拼写）**：

| 轴 | 规则 | 为什么它不是"按名字判" |
|---|---|---|
| 显式声明（产物） | 判据**执行到**的产物在自己头部带 `@real-infra` pragma ⇒ side-effecting | 结论来自**产物自己的字节**，与它叫什么/写在哪无关 |
| 显式声明（工作区） | `.quay/criterion-capabilities.json` 声明「写能力命令面」正则 / 「真实端点」字面量 ⇒ side-effecting | 是**数据**，Core ⛔ 不装别的项目的 API 表 |
| 无法评估 | 判据**执行到**的产物在它将要运行的树里不存在 ⇒ not-evaluated（fail-closed） | 结论来自**能否读到产物**，`x/y.mjs`/`./x/y.mjs`/`a/../x/y.mjs` 结论相同 |

**⛔ 为什么「按名字/拼写」判会漏（Fleet 侧实测反例，逐字）**：那把锁第一版按「文件里有没有 `callTool` 方法」判，而**事故文件自己就有一个转发壳**——直通真实客户端的方法，名字上完全看不出来。第二次更彻底：把带副作用的文件**移出 `test/`** 之后，一条把判据改指向**显式路径** `node --test realchecks/wake-real-reachability.mjs` 的提交让风暴 13 分钟后重新上膛——**"文件在哪、叫什么"从来不是能力**。

**三条按拼写判的轴被本仓库自己的 227 条现存判据实测否掉**（这就是"不按拼写"的量化依据）：

- 「写动词」（`create|send|commit|push|post|…` 作为 token）：**87 次命中，全是数据**——`store-writes-raw-commit`、`post_upgrade_task_count`、`commit_sha`、`merge-base`。含写词的字符串不是动作。
- 「端点字面量」（任意 `scheme://…`、`host:port`）：**21 次命中，全是只读 live probe**（`curl -sf … http://$a$ROUTE`），本仓库有意为之。
- 「按路径/文件名拼写」：见上，Fleet 两侧实测都漏。

⇒ 判据的文本只被用来**解析可达产物**（一个 quote-aware 的 shell 分词器，含 here-doc 体排除与注释排除——两者都是被实测逼出来的：Python docstring 里的散文一度被读成一条 `/manager` 命令），**⛔ 从不用来下结论**。

**四条调用点全部过闸**（`⛔ 只修一处＝把同一原则重新留给下一个发现者`）：

| 调用点 | 路径 | 旁路 |
|---|---|---|
| `goal-store.ts` I5 `checkAchievedFailing` | 无人值守（goal-driver 每轮） | **无** |
| `goal-store.ts` `sweepFrozen`（冻结轮转） | **无人值守（事故现场）** | **无** |
| `goal-store.ts` 激活写面（P6） | 写入面，`--force` 也⛔ 不能越过 | **无** |
| CLI `quay goal gate <id>` | 显式、单条、有人在键盘前 | **`--allow-side-effects`** |

**旁路的两条性质**（AC7）：**按次**（flag 只作用于这一次调用，⛔ 无人值守的两条路径上没有任何参数可传 ⇒ 不可能"设一次、永久生效"）；**落痕不同形**（`payload.capabilityBypass` 记进账本，一次被旁路的执行与一次常规执行在账本上可区分）。

**稳定错误码**（调用方 branch on `code`，⛔ 不解析 message）：`criterion-side-effect`（已声明会写）、`criterion-capability-unevaluable`（读不懂）。两者**必须分开**：硬规则 3b——「已声明危险」与「无法评估」是两个不同的事实。

**保护是机制不是约定**：拒绝发生在 `runAcceptance` **之前**，且它是 `runAcceptance` 在这四条路径上的**唯一入口**（`capabilityRefusal` / `capabilityRefusalAt`）。一个**完全不知道该机制存在**的调用方写入带副作用的 criterion，仍然会在**执行前**被拒——这由 §Evidence 的 ARM B 机械证明（真跑就会写出的痕迹不存在）。

## Evidence

### 真实重放（⛔ 非 mock、⛔ 非 fixture 注入：真 goal store + 真 CLI）

工作区：临时目录内**真实** `.quay/` + `goals/`，用 `packages/quay/src/goal-store.ts` 的**真 CLI** 写入并求值。判据用 **AC-020 的原文**，`status: achieved`。

**ARM A（fresh-workspace 形态：产物不在树里）** — `check --stale-pass --sweep --budget 5`：

```json
{"evaluated": true, "refused": false, "eligible": 1,
 "ran": [{"id": "AC-020", "verdict": "not-evaluated", "ms": 0,
   "reason": "criterion-capability-unevaluable: criterion refused BEFORE execution — it is not a reading. uncertifiable-executed-artifact: bin/quay-fleet.mjs (does not resolve under the criterion's cwd, so its capability cannot be established). …"}],
 "capabilityRefused": [{"id": "AC-020", "code": "criterion-capability-unevaluable"}],
 "stoppedBy": "exhausted"}
```

**ARM B（产物真的在、且**真的会写**；由工作区声明）** — 先造一个**真的会写文件**的 `bin/quay-fleet.mjs`，并在 `.quay/criterion-capabilities.json` 声明 `cloudcli delegate-smoke`：

```
{"id":"AC-020","verdict":"not-evaluated","capabilityCode":"criterion-side-effect",
 "reason":"criterion-side-effect: criterion refused BEFORE execution — it is not a reading. declared-write-capable-command: cloudcli-delegate-smoke (src/delegate-smoke.mjs requires createCloudcliClient({readOnly:false}) and reaches session_create/session_send). …"}
SPAWNED.txt created? NO     ← ⛔ 机械读数：真跑就会写出的痕迹不存在
```

**ARM B2（同一次调用 + 显式旁路）**：

```
{"id":"AC-020","verdict":"pass","capabilityBypass":{"code":"criterion-side-effect","rules":["declared-write-capable-command"]}}
SPAWNED.txt created? YES    ← 旁路下真的执行了（⛔ 不是"换个说法拒绝"）
```

### 正控 / 负控（⛔ 真实历史件）

| 控制 | 输入 | 判定 |
|---|---|---|
| 正控 A | AC-020 criterion **原文**（`node bin/quay-fleet.mjs cloudcli delegate-smoke --json \| node -e …`） | **拒**（`criterion-capability-unevaluable`；产物在场时 `criterion-side-effect`） |
| 正控 B | 复发那一条 `node --test realchecks/wake-real-reachability.mjs` | **拒**（产物不在树里 ⇒ unevaluable；产物在场且带 `@real-infra` ⇒ side-effecting，**同一方言两个消费者**） |
| 负控 | Fleet 退化为只读的 `node -e` 证据文档结构检查 | **放行**，且**真的被执行**（记入 `achievedButFailing`，因为证据文档不在临时树里） |

### 不回归（AC8）：改动前后同一只读判据集的逐字读数

用**fork 点的 pristine 检出**跑 BEFORE、本改动跑 AFTER（两个**独立**的只读 store，各转一次）：

```
before.sweep = {"evaluated": true, "refused": false, "eligible": 1,
  "ran": [{"id": "AC-900", "verdict": "pass", "reason": "acceptance passed (exit 0)", "ms": 22}], "stoppedBy": "exhausted"}
after .sweep = {"evaluated": true, "refused": false, "eligible": 1,
  "ran": [{"id": "AC-900", "verdict": "pass", "reason": "acceptance passed (exit 0)", "ms": 24}], "stoppedBy": "exhausted"}
```

去掉**新增字段** `capabilityRefused`（= `[]`）后逐字同；两处差异只有 `ms`（该次判据的实测耗时）与 `rotation.lastSweepAt`（墙钟）——**都是"这次运行"的读数，不是行为**。归一化后**两处 IDENTICAL**，`check --stale-pass --sweep` 与 `check --stale-pass` exit 均为 0。

### 生产面零误报（AC8 的 ratchet）

对**本仓库真的 227 条 criterion**（`goals/*.md`）跑同一判定器：**判定为非只读的 = 0**。这条同时是"这把闸不是无差别拒绝"的负控，测试 `能力闸 AC8(生产面)` 会在真 goals 树上重跑它。

### 保护是怎么被保证的（DoD「机制不是约定」）

- **代码**：`packages/quay/src/goal-store.ts` 的 `capabilityRefusal()` / 模块级 `capabilityRefusalAt()` 是四条 `runAcceptance` 调用点**唯一**的入口；拒绝分支 `continue`/`throw`/设 `not-evaluated` 后才可能到达 `runAcceptance`。
- **测试**：`packages/quay/test/goal-store.test.mjs` 的能力闸段——`AC1`（真跑就会写出的痕迹不存在）、`AC3a`/`AC3b`（两条无人值守路径各自的落痕读数）、`AC7(上限)`（旁路⛔ 不得作为参数流进共用判定）。
- **旁路⛔ 不在无人值守路径上**：`capabilityRefusal` 的签名里没有 allow 参数，无人值守的两条路径无从传给它；`AC7(上限)` 直接对源码断言这一点。

## AC

- [x] **执行前闸**：criterion 命中"带真实副作用能力"即 **fail-closed 拒绝**，返回**稳定错误码**（调用方 branch on `code`，⛔ 不 branch on message），且**命令未被 spawn**（给出"未 spawn"的机械读数，⛔ 不接受"跑完发现不该跑"）
- [x] **判定按能力**：给出能力判定的**具体规则**（端点/写动词/显式声明中的哪一种或哪几种），并在任务体写明**为什么按名字判会漏**（附 Fleet 侧"转发壳"实测反例）
- [x] **两个调用点都覆盖**：`goal-store.ts:2033` 与 `:2310` 两条路径**各自**有实测读数（⛔ 只测一条即视为未完成）
- [x] **正控（必须是真实历史件）**：把 `quay-fleet` AC-020 的 criterion 原文喂进判定器 ⇒ **必须拒绝**
- [x] **正控 B（真实历史件）**：把"指向 `realchecks/` 的显式 `node --test` 路径"那条 criterion 原文喂进判定器 ⇒ **必须拒绝**
- [x] **负控**：对现存**只读** criterion（如 Fleet 的 `node -e` 证据文档结构检查）⇒ **必须放行**（证明"拒绝"不是"一律拒绝"的同形）
- [x] **旁路可用且可审计**：显式旁路下真实 E2E 仍能执行；旁路的使用**在落痕上可见**（⛔ 与正常判据执行同形）
- [x] **不回归**：`goal check --stale-pass --sweep` 在**全只读**的判据集上行为不变（exit 0，逐字与改动前同）
- [x] `bash scripts/test.sh` exit 0

## DoD

- **用真实事故输入回放**：以 2026-10-12 的形态（criterion = 会真实建/发会话的命令，且 `achieved`）在**真实 goal-store 与 CLI** 上重放 ⇒ 新机制下**必须被拒**，且**命令未被 spawn**；⛔ 非 mock、⛔ 非 fixture 注入 → **见 §Evidence「真实重放」ARM A/B/B2**
- **保护是机制不是约定**：实现落地后，一个**完全不知道该机制存在**的调用方写入带副作用的 criterion 时，仍会在**执行前**被拒——在任务体写明这**是怎么被保证的**（哪一段代码、哪一条测试），⛔ 不以"文档写了不要这么写"充当完成 → **见 §Evidence「保护是怎么被保证的」**
- **生产 Manager 唤醒不受影响（Fleet 侧约束，作为本条的验收面之一）**：本改动**不得**改变任何**只读** criterion 的行为；给出改动前后同一条只读 criterion 的逐字读数对比 → **见 §Evidence「不回归」**（归一化后逐字 IDENTICAL，exit 0）

### ⛔ 如实披露这笔取舍（残余风险，⛔ 不当成已解决）

1. **「执行不到的产物」是 fail-closed 的后备轴，不是能力轴**。一条判据若执行一个**在树里存在、无 pragma、也无人声明**的产物，本闸会放行。真正关上这个口的是**声明**（产物 pragma / 工作区声明）+ 各工作区**提交期**的静态锁（Fleet 侧 `test/criteria-are-readings.test.mjs`）。本任务交付的是**执行面**这一半。
2. **绝对路径且无脚本后缀的直接执行**（`/usr/local/bin/x`）是这条后备轴的**已知盲点**——为它放行是有意的：`/manager`、`/architecture` 这类 URL 路由会被读成绝对路径，而"以 `/` 开头"正是被禁止的拼写判定。宁可少一个后备情形，也不凭空造一个。

## Touches

- `packages/quay/src/goal-store.ts`
- `packages/quay/src/gate/criterion-capability.ts`
- `packages/quay/test/goal-store.test.mjs`
- `tasks/gap-criterion-side-effect-unguarded-at-write-and-execution-surface.md`
