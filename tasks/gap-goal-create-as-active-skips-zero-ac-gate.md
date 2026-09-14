---
id: gap-goal-create-as-active-skips-zero-ac-gate
title: GOAL 出生即 active 绕过 P6-goal「名下至少一条 AC」闸——`activating` 逐字 `prevStatus !==
  undefined`，GOAL-018 零 AC 流通 60s，AC-217 判红并 spawn 了一次无物可修的 gap-filing agent
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-217
---
## Finding

`packages/quay/src/goal-store.ts:2017` 的 `activating` 逐字 `prevStatus !== undefined`：

```ts
const activating = nextStatus === "active" && prevStatus !== undefined && prevStatus !== "active";
```

create（新记录）时 `prevStatus === undefined`（`:1987` 由文件是否存在决定）⇒ `activating === false` ⇒ **挂在同一个布尔上的 P6-goal 闸（`:2178`，由 `gap-meta-goal-store-activation-gate` 落地）在「出生即 active」这条路径上一次都不执行**。

**实测（2026-09-14，本仓库生产 store；非推断）**：

1. GOAL-018 于 `2026-09-14T04:01:57Z` 被**直接以 `active` 创建**（commit `1a83bfe7a`，单条提交）。**其 frontmatter 无 `statusLog`**——`:2265-2272` 规定任何状态转换都追加一条 statusLog ⇒ 无 statusLog 即「从未转换过」，这是「出生即 active」的确证。创建时名下 **0 条 AC**。
2. AC-257 / AC-258 / AC-259 分别落于 `04:02:57Z` / `04:03:20Z` / `04:03:21Z`。⇒ 存在一个 **`04:01:57Z`–`04:02:57Z` 的 60 秒窗口**，其间 GOAL-018 处于 active（在流通）而**零退出条件**——正是 AC-217 不变式禁止的状态。
3. 该窗口内 goal-driver 的一轮 I5（`goal-store.ts:1551 checkAchievedFailing`）跑到了常设 AC-217 的判据（其判据逐字就是「draft/active 的 GOAL 中无一条 AC 条数为 0」）⇒ exit 1 ⇒ AC-217 进 `achievedButFailing` ⇒ `plugin/scripts/goal-driver.ts:1641 computeGoalGaps` 产出 `standing-violated` ⇒ `spawnGapWorker` 起了本次 gap-filing agent。**这条 spawn 本身就是「读数落在窗口内」的证据**：`standing-violated` 仅在该 AC ∈ `achievedButFailing` 时产生。当前证据：本 agent 是 goal-driver pid 4041369 的直系子进程，该进程阻塞在 `spawnGapWorker`。
4. **负控制（dry-run，不落盘）**：`goal-store write GOAL-999 --status active --title … --origin … --body <≥40 非空白字符> --dry-run` ⇒ **exit 0**，打印出一条 `active` 且零 AC 的 GOAL 记录。对照：同一状态若经**转换**到达，被 `:2193` 以 `cannot activate X: 0 AC records name it` 拒绝。⇒ 两条路径结论相反，判别子恰是 `prevStatus !== undefined`。

**为什么「修 X ≠ X 只在那一处」（硬规则 5b，同族第三次）**：

- `gap-meta-goal-store-activation-gate`（done）补上了 P6-goal 闸，但它加在同一个 `activating` 上 ⇒ 只覆盖 **draft→active**（其自身实证案例 GOAL-014 正是这条路径）。
- `gap-activation-gates-bypassed-on-reopen-path-non-draft-to-active`（done）把口径从 `prevStatus === "draft"` 放宽为 `prevStatus !== undefined && prevStatus !== "active"`，覆盖了**重开**路径（achieved / needs-human / superseded / retired → active），**并把 create-as-active 作为其 AC4 逐字锁定为「不设闸」**。
- ⇒ 两条修正各自成立，合起来仍留下**出生路径**无人覆盖——而 GOAL-018 走的正是这一条。

**该排除是「有理由，但理由不迁移」**：`:2007-2016` 逐字记录 `create-as-active is NOT gated — a new record's criterion is validated by the create completeness contract`。该理由针对的是**判据闸**（P6/P6b：「这条 criterion 经 YAML 往返后还跑得动 / 取得假吗」），对 create 确实不适用，是成立的。但 P6-goal 问的是**另一个量**（名下 AC 条数），而 create 完整性契约只管 title/origin/body≥40——它对「有没有 AC 指向这条新 GOAL」一字未提；且**出生时不可能有 AC 指向它**（AC 是独立记录，通过 `goal:` 指向一条已存在的 GOAL）。

**为什么这不只是注释里的设计意图**：AC-217 是人的常设裁定所立的**不变式**，其 expect 逐字要求「任何无 AC 的 GOAL 一旦进入 draft/active 即报红」——判据本身是正确的、**不得弱化**。窗口期间该保证为假；它没有升级成不可逆的伪 `achieved`，只是因为 `goal-driver.ts:466` 的 `if (inScope.length === 0) return false;` 这一道守卫（GOAL 无反向翻转，见 `goal-driver.ts:183-187`）。⇒ **该窗口距一次不可逆的伪达成只差一道守卫。**

**代价（实测）**：每次经此路径创建 GOAL，都会烧掉一次 gap-filing subagent（预算 `GAP_WORKER_TIMEOUT_MS_DEFAULT = 900_000`），而**它没有任何可修的东西**——agent 到场时 AC 已存在、判据已为真。这正是代码自身已在提防的「DoD 结构上无法关闭」形态（见 `goal-driver.ts:1716-1726` 的 `derived-routed` 分支注释）。

<!-- dedup-ref --> **相关但不同形（不重复）**：`gap-criterion-attribution-write-gate-at-birth` 管的是**出生时 criterion 的内容**（裸失败出口）；本条管的是**出生时 GOAL 名下的 AC 条数**。两条挂在同一行注释揭示的同一个 `create-as-active NOT gated` 上，但被改的是不同的量，需分别处置。

**立案时顺带实测到的一处分叉（⛔ 不扩大本任务范围，仅记录）**：本任务的首版用了 `## AC（draft）` / `## DoD（draft）` 标题（照抄同族 done 任务），`quay task check` 报 `ok:false, reason:"AC section has no checkboxes"`——因为**形状判定**（`plugin/scripts/shape-sections.ts:57`）认识 draft 变体，而**复选框闸**（`packages/quay-native/src/store.ts:1686`）逐字只传 `["AC","Acceptance Criteria"]` 给 `sectionAfterHeading`（`:167` 为整行精确匹配 `^##\s+AC\s*$`）⇒ `## AC（draft）` 对它不可见。本任务因此改用**平标题**`## AC` / `## DoD`（同时满足两处）。该分叉若需修，应另立任务。

## AC

- [ ] **写面行为（不读源码版式）**：新增 `plugin/test/goal-create-as-active-requires-ac.test.mjs`，断言三件事——①对一条**新** GOAL 记录以 `--status active` 写入时，store **不允许该状态持久化**（fail-closed 拒绝，且讯息里枚举名下 AC 条数 = 0）；②**两步路径仍可用**（非 active 创建 → 写一条 `goal:` 指向它的 AC → 转 active 放行）；③名下已有 ≥1 AC 的 GOAL 仍可正常转 active。今天红（行为缺失），实现后绿。
- [ ] **生产载体（真 CLI，非仅 fixture）**：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts write GOAL-998 --status active --title … --origin … --body <≥40 非空白字符> --dry-run` ⇒ **exit ≠ 0** 且 stderr 枚举「名下 AC 条数 = 0」；同一命令换 `--status draft` ⇒ exit 0。**今天的读数是 exit 0**（见 Finding 第 4 条），故本条今天红。
- [ ] **负控制（判据能取假）**：把实现改回「create 放行」（即 `activating` 恢复含 `prevStatus !== undefined` 或其等价形态），上面两条判据必须红；贴出改前 / 改后两次读数对照。
- [ ] **⛔ AC-217 的判据不得被弱化**：改后重跑 AC-217 的判据原文，仍能对「注入一条零 AC 的 active GOAL」取假——贴出注入前 / 注入后 exit code 对照。这是防止「把窗口合法化」冒充「把窗口关掉」。

## DoD

- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红，贴对照读数）。
- [ ] 修的是**已有的那一道**闸（P6-goal）让它覆盖出生路径，⛔ 不新建并行机制；若结论是「出生路径结构上无法满足该前置」（出生时不可能有 AC 指向它），则把「GOAL 不得出生即 active」落成**写面约束**，并说明为何这不与人 2026-09-10 确立的重开行为冲突。
- [ ] **受影响的生产调用点已按新语义处置且有实测读数**：`plugin/scripts/verify-deliver-coldstart.sh:3815`（AC-234 渲染 fixture，现以 `--status active` 且零 AC 播种一条 GOAL 以证明 `goals_rendered>0`）——修后该步骤仍能产出 `goals_rendered>0`，或已改为「以 draft 播种」/「先播种 AC 再转 active」；二者都需贴出该 e2e 步骤的实际读数。⚠️ 动手前先查该脚本是否被 fingerprint（若在闭包棘轮 source set 里，改它会让 ratchet 变 stale）。
- [ ] 全量 `scripts/test.sh` 绿（若只跑 scoped 门，说明为何非全量）。

## Touches
- `packages/quay/src/goal-store.ts`
- `packages/quay/test/goal-store.test.mjs`
- `plugin/test/goal-create-as-active-requires-ac.test.mjs`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-goal-create-as-active-skips-zero-ac-gate.md`
