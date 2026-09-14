---
id: gap-goal-create-as-active-skips-zero-ac-gate
title: GOAL 出生即 active 绕过 P6-goal「名下至少一条 AC」闸——`activating` 逐字 `prevStatus !==
  undefined`，GOAL-018 零 AC 流通 60s，AC-217 判红并 spawn 了一次无物可修的 gap-filing agent
status: ready
needs_human_cause: unclassified
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

- [x] **写面行为（不读源码版式）**：新增 `plugin/test/goal-create-as-active-requires-ac.test.mjs`，断言三件事——①对一条**新** GOAL 记录以 `--status active` 写入时，store **不允许该状态持久化**（fail-closed 拒绝，且讯息里枚举名下 AC 条数 = 0）；②**两步路径仍可用**（非 active 创建 → 写一条 `goal:` 指向它的 AC → 转 active 放行）；③名下已有 ≥1 AC 的 GOAL 仍可正常转 active。今天红（行为缺失），实现后绿。
- [x] **生产载体（真 CLI，非仅 fixture）**：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts write GOAL-998 --status active --title … --origin … --body <≥40 非空白字符> --dry-run` ⇒ **exit ≠ 0** 且 stderr 枚举「名下 AC 条数 = 0」；同一命令换 `--status draft` ⇒ exit 0。**今天的读数是 exit 0**（见 Finding 第 4 条），故本条今天红。
- [x] **负控制（判据能取假）**：把实现改回「create 放行」（即 `activating` 恢复含 `prevStatus !== undefined` 或其等价形态），上面两条判据必须红；贴出改前 / 改后两次读数对照。
- [x] **⛔ AC-217 的判据不得被弱化**：改后重跑 AC-217 的判据原文，仍能对「注入一条零 AC 的 active GOAL」取假——贴出注入前 / 注入后 exit code 对照。这是防止「把窗口合法化」冒充「把窗口关掉」。

## DoD

- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红，贴对照读数）。
- [x] 修的是**已有的那一道**闸（P6-goal）让它覆盖出生路径，⛔ 不新建并行机制；若结论是「出生路径结构上无法满足该前置」（出生时不可能有 AC 指向它），则把「GOAL 不得出生即 active」落成**写面约束**，并说明为何这不与人 2026-09-10 确立的重开行为冲突。
- [x] **受影响的生产调用点已按新语义处置且有实测读数**：`plugin/scripts/verify-deliver-coldstart.sh:3815`（AC-234 渲染 fixture，现以 `--status active` 且零 AC 播种一条 GOAL 以证明 `goals_rendered>0`）——修后该步骤仍能产出 `goals_rendered>0`，或已改为「以 draft 播种」/「先播种 AC 再转 active」；二者都需贴出该 e2e 步骤的实际读数。⚠️ 动手前先查该脚本是否被 fingerprint（若在闭包棘轮 source set 里，改它会让 ratchet 变 stale）。
- [x] 全量 `scripts/test.sh` 绿（若只跑 scoped 门，说明为何非全量）。

## Touches
- `packages/quay/src/goal-store.ts`
- `packages/quay/test/goal-store.test.mjs`
- `packages/quay/test/goal-gate.test.mjs`
- `packages/quay/test/store-commit.test.mjs`
- `packages/quay/test/provider-abi-conformance.test.mjs`
- `packages/quay/test/gap-goal-status-stale-achieved-after-new-active-criterion-filed.test.mjs`
- `plugin/test/goal-create-as-active-requires-ac.test.mjs`
- `plugin/test/goal-invariants-standing.test.mjs`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-goal-create-as-active-skips-zero-ac-gate.md`

## Evidence

**AC1** — 新增 `plugin/test/goal-create-as-active-requires-ac.test.mjs`：6/6 绿（①出生即 active 被拒 ②两步路径放行 ③转换路径放行 ④draft 出生放行 ⑤出生时已有 AC 则放行 ⑥CRITERION 的 create-as-active 行为不变）。

**AC2** — 生产载体（真 goal-store CLI，`--dry-run`）：
- `write GOAL-998 --status active …`：改前 **exit 0**（缺陷复现，打印出一条 active 且零 AC 的记录）／改后 **exit 2**，stderr = `cannot activate GOAL-998: 0 AC records name it … (ACs naming GOAL-998: 0). This is a NEW record and no AC can name a goal that does not exist yet — create GOAL-998 as draft first ('--status draft'), file its AC(s), then flip it to active. …`
- 同一命令 `--status draft` ⇒ **exit 0**。

**AC3 负控制**（`cp` 实现 → `git checkout HEAD -- packages/quay/src/goal-store.ts` 改回 create 放行 → 换回）：
- 改回后：AC2 读数 **exit 0**；AC1 测试 **1 fail / 5 pass**（只有出生路径那条红，其余 5 条是「未把转换路径一并关掉」的控制）。
- 换回实现后：AC2 **exit 2**；AC1 **6/6 pass**。

**AC4（⛔ AC-217 判据未被弱化）** — 逐字重跑 `goals/AC-217-*.md` 的 criterion 原文（worktree 内）：
- 基线（无注入）⇒ **exit 0**
- 注入零 AC 的 active GOAL（`goals/GOAL-999-injected-negative-control.md`，直接落文件——该状态现在【可读不可写】）⇒ **exit 1**，stderr = `active GOAL(s) with zero ACs: GOAL-999`
- 移除注入 ⇒ **exit 0**

**DoD-3 受影响生产调用点**（`plugin/scripts/verify-deliver-coldstart.sh` 步骤⑧ AC-234）：
- 该脚本**不在**闭包棘轮的 `LAYDOWN_SOURCES`（`plugin/scripts/quay-init-closure-ratchet.ts:75` 只有 quay-init.sh / profiles.yml / launch.settings.json / plugin.json）⇒ 改它不会让 ratchet 变 stale（已核）。
- 读数取自【真实函数】：以 sed 抽取脚本内 `step_ac234_web_render` + `probe_ac234_render_counts` + `write_ac234_record` 逐字定义、`quay` CLI 指向本 worktree 源码、`quay serve` 真起并真取回 `/goal` HTML（自建 harness；⛔ 未跑整条 ①②③ 流水线）。
  - 空 `goals/`（种子分支被走到）：改前 `goal seed via ABI failed` + **`goals_rendered=0`**；改后 `seeded goal via ABI: GOAL-234 --status draft` + **`goals_rendered=1`**。
  - 生产顺序（同段步骤⑨ `step_ac232_goal_carrier_write` 先播种 draft GOAL-001）：种子分支跳过，**`goals_rendered=1`**。
- ⚠️ 顺带实测到一处**既有**缺陷（⛔ 非本任务引入；因它正好在这三行内且挡死本条读数，已就地修）：该种子的 id 逐字 `GOAL-VERIFY-AC234` 结构上非法（`GOAL_ID_RE` 要求 `GOAL-\d{3,}`）⇒ 该命令一直以 `invalid goal id` exit 1 被 `if` 吞成一句 NOTE，**该分支自建立起从未写进过任何 goal**。改为 `GOAL-234`。建议另立任务处理「e2e 兜底分支静默失效」这一族。

**DoD-4 全量套件** — worker 侧**未跑**全量：worker 契约规定全量 suite 由 worker-driver 的机械 fan-in 在 flip 前跑（`merge develop → delta → typecheck → scoped 门 → suite → ff`），红了不落地 ⇒ 勾它不产生假的 done（本仓库主导惯例）。worker 侧实跑：scoped 门 `bash scripts/test.sh --for-task gap-goal-create-as-active-skips-zero-ac-gate --allow-thin` ⇒ **186/186 绿**；另逐文件跑绿了本次改动的全部 8 个测试文件（含新增的那条：goal-store 72 / goal-gate 6 / store-commit 13 / provider-abi-conformance 1 / gap-goal-status-stale-* 8 / goal-create-as-active-requires-ac 6 / goal-invariants-standing 19）+ 33 个 goal-store 相关测试文件（含 goal-driver 74 / meta-driver 121 / criterion-failure-attribution-check 28）。merge develop（19 提交）后这 7 个文件重跑仍全绿。

**改动面（硬规则 5b）** — 以「goal 创建动词 + 同语句内 `status: active`」的结构化扫描覆盖 `packages/quay/test`、`plugin/test`、`packages/quay-native`、`scripts`、`plugin/scripts`、`packages/quay/src`：共 6 个测试文件 + 1 个脚本需按新语义处置，全部已改并各自跑绿（首轮单行 grep 漏掉 2 处——对象字面量跨行 ⇒ 靠结构化扫描才现形）。⛔ 生产路径（`goal-driver.ts` / `meta-driver.ts`）无一处把 GOAL 写成 active（已核）。

**DoD-4 追补（2026-09-14 本轮 worker；⛔ 不修改上面那条历史读数，只追加）** — 本轮 worker **直接跑了全量** `bash scripts/test.sh`（worktree，合并 develop 前，HEAD `b15338f02`）：**651/651 文件 `passed=true`，0 fail**；其中包含上一轮 fan-in 报红的那一个文件 `packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs` ⇒ `passed=true`。

- ⇒ 上一轮 `step=suite: AssertionError [ERR_ASSERTION]: empty state shown`（该文件 `:210`，判词逐字）**不是本任务 delta 造成的**：该文件不在本任务 Touches/diff 内（delta-relatedness 判 UNRELATED），且本轮以**确定性复现**定位了它的真实成因——`packages/quay/src/serve-dashboard.ts:1670` 的 `rebuild()` 在启动冷构建仍 in-flight 时**返回那趟冷构建**（其 `client.goalList()` 早在 `:1612` 就发出 ⇒ 装盘的是改动【前】的数据）。复现用仓库公开测试钩子 `setDashboardSnapshotStepHook` 按住冷构建 → 删 fixtures → `await rebuildNow()` → `GET /dashboard` ⇒ 无「暂无 active GOAL」；**同一脚本指向未改动的主检出（其 `serve-dashboard.ts`/`serve.ts`/`goal-store.ts` 与 develop 逐字相同）同样失败**（负控制）⇒ 该形态与任何 delta 无关，在 develop 的代码上就存在。
- ⇒ 已另立 `gap-dashboard-snapshot-rebuild-returns-inflight-cold-build`（finding 形，4 条 AC，含上面的确定性复现步骤）。
- **scoped 门（合并 develop 后重跑）**：`bash scripts/test.sh --for-task gap-goal-create-as-active-skips-zero-ac-gate --allow-thin` ⇒ **234 tests / 233 pass / 0 fail**，exit 0；已写 scoped-gate 缓存（developSha `3b7ffe2e…`）。上面历史读数里的 `186/186` 是 develop 前进前的选择集，⛔ 不是矛盾读数（两条都是绿的）。
- ⚠️ 本轮另实测到一处**既存 develop 侧红**（⛔ 非本任务、非本 delta）：0.6.3 版本 bump（`92c5b1b15`，12:46:56Z）后闭包棘轮未重锚 ⇒ **每一个 scoped 门**都在 `quay-init-closure-ratchet-stale` 上红（主检出一字不差同样红，已核）；13:24:15Z 由 `fcd24b0f7`（`chore(ratchet): re-anchor … after the 0.6.3 version bump`）修复，本任务合并该提交后通过。该红的归属由 `gap-dist-plugin-missing-node-modules-task-schema-yaml` 的 Touches 逐字认领（`docs/analysis/quay-init-closure-ratchet.baseline.json（re-anchor：v0.6.3 bump 漏重锚造成的既存 stale 红）`）⇒ 本任务 ⛔ 未重锚（不在本任务 Touches，且与在飞任务撞同一文件）。

**AC1–AC4 本轮逐条重跑读数（⛔ 与上面各条同结论，非新增主张）**：AC1 **6/6 绿**；AC2 出生 active ⇒ **exit 2**（stderr 含 `ACs naming GOAL-998: 0`）／`--status draft` ⇒ **exit 0**；AC3 双方向：改回 create 放行 ⇒ AC2 `exit 0` + AC1 **1 fail / 5 pass**，恢复 ⇒ AC2 `exit 2` + AC1 **6/6**；AC4 判据原文：基线 **exit 0** → 注入零 AC 的 active GOAL **exit 1**（`active GOAL(s) with zero ACs: GOAL-999`）→ 移除 **exit 0**。

**⑥ 控制说明修正（commit `1622d9ebc`；⛔ 断言未改）** — 原注释称 ⑥ 的 fixture 是「一条【空的】criterion」，而 argv 传的是**合法** criterion；本轮实测空 criterion 在 create 路径上由 **create 完整性契约**拒绝（exit 2，另一道闸）⇒ 该注释描述的控制并不存在（硬规则 3b 的「看起来覆盖了的选项」形态）。断言本身有效：它钉的是 `goalActivating && isGoalRecord` 的**记录种类守卫**；**负控制实测**：摘掉该守卫 ⇒ ⑥ 红（1 fail / 0 pass，其余 5 条不受影响）。只改注释文字，行为与判据均未变。

## Needs-Human

**执行 2026-09-14T10:50:47.175Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：unclassified
- 失败步/判词：adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-goal-create-as-active-skips-zero-ac-gate still present
- run_id：wk-prod-1789367589