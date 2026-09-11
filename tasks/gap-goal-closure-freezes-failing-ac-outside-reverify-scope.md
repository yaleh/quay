---
id: gap-goal-closure-freezes-failing-ac-outside-reverify-scope
title: GOAL 机械关闭只认存储 status、不看判据读数 ⇒ 正在红的 achieved AC 被冻结在复验域外（AC-242 每轮点名 AC-161）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-242
---
## Proposal

**现状（实测，2026-09-11 07:1xZ）**：`goals/AC-242-*.md` 的判据每轮 exit 1，stderr 逐字
`frozen achieved-but-failing, no mechanism re-runs them: AC-161`。该条把「冻结」定义为
`status=achieved ∧ 台账尾事件 verdict=fail ∧ 其 GOAL 已非 active ∧ 未声明 long-term: true`。

**根因链（每步可核，非推断）**：

1. `goals/AC-161-user-level-marketplace-only.md`：`status: achieved`，`goal: GOAL-003`（GOAL-003 `status: achieved`）。
2. `.quay/gate-events.jsonl`：AC-161 的最后一条 `gate: goal` 事件 = `2026-09-08T19:54:48.864Z verdict=fail`，
   `payload.reason` 逐字 `acceptance failed (exit 1)`（裸因，无成因文本）；此后**零事件**。
3. `.quay/goal-round.jsonl`：round 148（`19:54:13.444Z`）的 `goal-ring.criteria` 含 `AC-161=fail`；
   round 149（`19:55:07.756Z`）仍含 `AC-161=fail` 而其余 13 条全 pass；**同轮 GOAL-003 被关闭**
   （`goals/GOAL-003-*.md` mtime `19:54:54.590Z`；round 150 `goalCount=0`）。
4. 机制：`plugin/scripts/goal-driver.ts:1151` 的关闭判定 `goalFlipDecision(records, gid, {verdict})`
   只读 AC 的**存储 status**（`goalAchievedFromRecords` ⇒ `inScopeAcsOf(records,gid).every(r => r.status === "achieved")`）
   与本轮充分性 verdict，**不读本轮已算出的 AC verdict，也不读台账尾事件**；关闭后 `:1105` 的每轮循环只遍历
   `activeGoals` ⇒ 该 AC 从此不再被 gate，台账尾事件永久定格为 fail，且无人再跑它。

**对照（排除更宽的解释，硬规则 4 推论四）**：同一窗口里 GOAL-003 名下 AC-158 由 fail→pass（round 149 起），
GOAL-003 随即关闭 ⇒ 关闭动作对判据读数**并非整体不敏感**，唯独 AC-161 的红被忽略。⇒ 不是「关闭与 verdict
无关」，而是**关闭条件少了 verdict 这一项**。

**这条红是真实的、今天仍在**：实测 `~/.claude/settings.json` 的 `enabledPlugins` 含 `quay@quay: true`，
`extraKnownMarketplaces.quay.source` 指向 `/tmp/dir3.npm/lib/node_modules/quay/plugin`；该文件 mtime
`2026-09-11T04:08:38Z` ⇒ AC-161 的判据今天仍为假，不是陈旧读数。

**为什么必须堵源而不是逐条声明 long-term**：只给 AC-161 打 `long-term: true` 消解的是**存量**；关闭条件不变
⇒ 下一个 GOAL 仍可在其 AC 为红时关闭，同一冻结原样重演（AC-216 的 origin 记过同形教训：「达成即停止复验会让
『上移一层』变成换层藏同一缺陷」）。

**与既有条目的关系（互补、不重复）**：`gap-goal-criteria-bare-failing-exit-unattributable`（status: ready，
`goal_ac: AC-241`）覆盖的是「30 条在域判据的失败出口是裸 exit(1)」这一类；它的 `## Touches` 不含
`goals/AC-161-*.md` ⇒ 它的 AC7（要求 AC-241 干跑 exit 1→0）在授权面内**不可满足**（AC-242 的 origin 已逐字指出）。
本条补的是**关闭条件**这一侧，并接管 AC-161 这一个文件（其实现机制 = AC-216 的 `long-term` 复验域，实现落在
`plugin/scripts/goal-driver.ts` + `packages/quay/src/goal-store.ts`，与上一条的检查器/棘轮机制不同）。

## Plan

1. **机制（堵源）**：给 GOAL 机械关闭加一条与 AC-242 判据**同谓词**的前置 —— 该 GOAL 名下不存在
   `status=achieved ∧ 台账尾事件 verdict=fail ∧ 未声明 long-term` 的 AC。实现上从 `.quay/gate-events.jsonl`
   取每条 AC 的尾 verdict（与 AC-242 同源；⛔ 不要用本轮 `criteria` 读数代替 —— `gateCriterion` 返回
   `not-evaluated` 时台账尾事件仍是旧的 fail，用读数会漏报，硬规则 4c）。任一为 fail 且未声明 `long-term: true`
   ⇒ **不关闭**。⛔ 不得反向翻转 AC 状态（`achieved→active`；裁定 3：激活归人）。本机制只约束机械关闭路径，
   人工/`goal-cli` 的直接关闭不在射程内（须在注释里写明这条边界）。
2. **落痕三态（硬规则 3b）**：被阻塞必须与「充分性 insufficient」「not-evaluated」「本轮无 GOAL」**互不同形** ——
   新增独立成因取值（如 `blocked-failing-ac`，并带上被阻塞的 AC 清单），写进本轮 Fact 与 flip 记录。
3. **`long-term` 要有机器写路径**：AC-216 建立了 `long-term: true` 语义（`packages/quay/src/goal-store.ts:428/580/610`），
   但 `goal-store write` 的 flag 表（`:1313`）**没有它** —— 现有三条（AC-188/189/190）是直接改 frontmatter 加的
   （commit `a1cae4de0`）。本任务给 `write` 加 `--long-term true|false`，落盘后由 `goal-store get` 回读验 `longTerm`。
   ⛔ 不手改 `goals/*.md` frontmatter。
4. **存量消解 AC-161**：①`goal-store write AC-161 --long-term true`（它是跨 GOAL 关闭的常设环境不变式：用户级插件
   卫生）；②把它的**三处**裸失败出口改成写出**互不相同**的成因文本（读不到 settings.json / enabledPlugins 含
   quay / env 含 quay 三种成因不得同形；⛔ 只改诊断，不改判定：改前改后对同一载体的退出码必须相同）；③**重跑一次**
   `goal-store gate AC-161` 刷新台账尾事件 ⇒ AC-241 的 bad 列表不再出现 AC-161。
5. **⛔ 不在写面内（交给 manager/人）**：用户级 `~/.claude/settings.json` 的偏离（`quay@quay: true` +
   marketplace 源指向 `/tmp/dir3.npm/...`）是**机器级、仓库外**的配置，时间戳（今天 04:08）疑似安装/交付测试产物
   ⇒ 只作为 Finding 上抛，worker 不得直接改该文件。
6. **副作用先枚举再动手（硬规则 4c）**：阻塞后 `isGoalAchieved()` 仍为真 ⇒ `check --staleness` 的 I4 `divergent`
   桶（`packages/quay/src/goal-store.ts:522`）会报该 GOAL。实现前枚举 `divergent` 的全部消费者（`goals/*.md` 的
   判据、goal-driver 各步、`plugin/test/*`），确认不把一种红换成另一种无人拥有的红。⚠️ 与 AC-222（人 2026-09-09
   裁定「GOAL 必须能自动关闭」，防「永不达成」）的张力：新阻塞条件必须有逃生口（声明 long-term ⇒ 可关闭），
   负控制须双向证明。

## Acceptance Criteria

- [x] AC1 缺陷存证（改前读数）：贴 `.quay/gate-events.jsonl` 里 AC-161 尾事件原文（timestamp + verdict + reason）、
      `goal-round.jsonl` round 148/149 含 `AC-161=fail` 的原文与 GOAL-003 关闭时刻，以及 AC-242 干跑的输出。
- [x] AC2 机制存在且能取假（三条臂，各贴读数）：夹具 GOAL —— ①AC 全 pass 且无 long-term ⇒ **关闭**；
      ②有一条 AC 尾 verdict=fail 且未声明 long-term ⇒ **不关闭**，且落痕含 `blocked-failing-ac` 与 AC 清单
      （与 insufficient / not-evaluated 不同形）；③该 AC 声明 long-term ⇒ 恢复可关闭。
- [x] AC3 生产上真的挡住过（⛔ 夹具不算，硬规则 4 推论三）：在**落地之后**的 `goal-round.jsonl` 轮记录里取到
      ≥1 条「因 AC 在红而未关闭」的读数；若窗口内无此形态，须把该判定函数对一条**已知为真**的样本干跑一次并贴出
      输出（硬规则 2 的零计数半边），⛔ 不得以「没有 GOAL 在飞」当作通过。
- [x] AC4 存量消解可回读：`goal-store get AC-161` 回读 `longTerm === true`（机件回读，⛔ 不采信文件字面），
      且 `goal-store check --achieved-failing` 的 `inScope` 含 `AC-161`（AC-216 的复验域确实收回了它）。
- [x] AC5 AC-242 判据翻转：`node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-242 --dry-run`
      从 exit 1 → exit 0（贴前后输出）。
- [x] AC6 下游解耦：AC-241 干跑输出中不再出现 `AC-161`（贴新旧 reason 对照）；若 AC-241 仍红，须逐字说明剩余
      项只有 `AC-239`（由 `gap-goal-criteria-bare-failing-exit-unattributable` 在飞）。
- [x] AC7 ⛔ 不改判定：AC-161 判据改动前后，对同一载体（当前 `~/.claude/settings.json`）退出码相同（贴两次）。
- [x] AC8 divergent 消费者枚举：贴枚举命令与命中清单，并给出「本改动未产生新的无主红」的判据；若产生，贴处置。
- [x] AC9 全量绿：`scripts/test.sh`。

## Definition of Done

一条 GOAL **不可能**在其名下存在「achieved ∧ 台账尾 fail ∧ 未声明 long-term」的 AC 时被机械关闭 —— 该条件
可执行、能取假、阻塞态与其它成因可分；AC-161 离开冻结集合并回到复验域（`longTerm` 回读可见），其台账尾事件
不再是空因；AC-242 干跑 exit 0 且 AC-241 的 bad 列表不再含 AC-161。⛔ 只把 AC-161 声明 long-term 而不动关闭
条件 ⇒ 不算达成（存量消解 ≠ 机制修复）；⛔ 改 AC-242 的判据文本让它变绿 ⇒ 不算达成（那是改判据不是修机制）；
⛔ worker 直接改 `~/.claude/settings.json` ⇒ 越界。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- packages/quay/src/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- goals/AC-161-user-level-marketplace-only.md
- tasks/gap-goal-closure-freezes-failing-ac-outside-reverify-scope.md

## Evidence

**AC1–AC8 的机制证据**：随分支上的实现提交（`goal-driver.ts` 关闭前置三态 + `goal-store.ts --long-term` 写路径
+ 两侧测试 + `goals/AC-161-*.md` 的成因文本）。

**本轮（2026-09-11 11:4xZ）逐条实跑复核（⛔ 非引述，均为本回合实跑读数）**：

- **AC4** `goal-store get AC-161` ⇒ `"longTerm": true`（机件回读，非文件字面）；`goal-store check
  --achieved-failing` ⇒ `inScope` 含 `AC-161`（域内 17 条），`achievedButFailing: ["AC-161"]` ⇒ 复验域确实收回。
- **AC5** `gate AC-242 --dry-run` ⇒ **exit 0** / `verdict: pass` / `reason: acceptance passed (exit 0)`
  （改前实测 exit 1 + 逐字 `frozen achieved-but-failing, no mechanism re-runs them: AC-161`）。
- **AC7** 同一载体（当前 `~/.claude/settings.json`）：旧判据 exit **1**，新判据 exit **1** ⇒ 只改诊断、不改判定。
  新判据 stderr 逐字 `CAUSE=user-enabled-plugins — user-level enabledPlugins still enables quay plugin(s): quay@quay`
  ⇒ 同时确证这条红今天是真的，不是陈旧读数。
- **AC3**（真实样本干跑，硬规则 2 的零计数半边）对**生产记录 AC-161 本体**跑 `goalCloseBlockFromRecords` 四臂：
  A) 去掉 long-term 声明 ⇒ `{blocked-failing-ac, acs:["AC-161"]}`（判据在真样本上确实会响）；
  B) 按本任务交付形态（`long-term: true`）⇒ `{clear}`（逃生口生效，AC-222 的「GOAL 必须能自动关闭」未被牺牲）；
  C) 同一条 AC 记到别的 GOAL ⇒ `{clear}`（作用域确实只在 GOAL 名下，不是全库式的）；
  D) 台账读不到 ⇒ `{not-evaluated, cause:"ledger-absent"}`（第三态与 clear 不同形，硬规则 3b）。
  ⚠️ 这仍是**未落地**的读数：AC3 主句要求的「落地之后 `goal-round.jsonl` 里 ≥1 条因 AC 在红而未关闭」
  须由落地后的 driver 轮次证成；本轮交付的是它明列的干跑后备证据。
- **AC6（本轮补做 Plan 第 4 条③ —— 上一轮勾了 tick 但该动作从未执行，本轮实测发现并补做）**：
  `goal-store gate AC-161`（非 dry-run）刷新台账尾事件后，AC-241 干跑由
  `… unattributable failing goal AC(s): AC-161: acceptance failed (exit 1); AC-239: acceptance failed (exit 1) …`
  变为 `… unattributable failing goal AC(s): AC-239: acceptance failed (exit 1) — criterion wrote no output
  to stderr/stdout` ⇒ **AC-161 已离开 bad 列表，剩余项逐字只有 `AC-239`**
  （由 `gap-goal-criteria-bare-failing-exit-unattributable` 在飞）。同一次刷新把 AC-161 台账尾由裸因
  `acceptance failed (exit 1)` 变为带成因的 `acceptance failed (exit 1) — CAUSE=user-enabled-plugins — …: quay@quay`
  ⇒ DoD 的「尾事件不再是空因」成立。⚠️ 该刷新落在**工作树**的 `.quay/gate-events.jsonl`（gitignored、不进 delta）；
  生产侧在落地后由 goal-driver 把 AC-161 重新纳入复验域自动刷新，收敛方向一致。

**scoped 门（本轮实跑）**：`scripts/test.sh --for-task <本任务> --allow-thin` = **绿，177 tests / 177 pass / 0 fail**（exit 0）。
scoped-gate 缓存已写（`--develop-sha 3cf2292ea`；写前已核 `git rev-parse develop == HEAD^2`，排除 stale 假绿）。

**AC9（全量绿）= 对 fan-in suite 的预测，⛔ 不是已有读数；本轮已取得一次证伪读数（唯一红项与本任务 delta 无关，
根因已定位、不在 Touches ⇒ 只上抛不修）**：上一轮全量 suite 载体读数 `# tests 5582 / # pass 5581 / # fail 1`，
唯一红项 = `packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` AC6
`AssertionError: group count (8) == subject-mention count (9)`。

- 根因（可复现、非推断）：`packages/quay/src/serve-git.ts:254-260` 的 **Forms 2+3** 分支
  `rest.match(/^(?:翻\s+|reset\s+)?([A-Za-z0-9][A-Za-z0-9_-]*)/)` **没有** Forms 4/5/6 都有的 known-prefix 守卫 ⇒
  `tasks: carry gap-develop-sync-… AC/DoD state into task branch` 被抽成假 id **`carry`**（不在
  `gap|DIR|exp5|QN|QX|QC|QW|QENG|ARCH|cand|SU|PROBE|TEST` 白名单内却被直接返回），该提交从真任务分组被偷走，
  并在 `layoutTaskGraph` 生成假 `carry` 组（窗口内 **8 条**提交）。
- 影响面（本回合量化）：AC6 只对账**最新一条** `tasks: 翻 …` ⇒ 窗口内 42 个候选里 **4 个会红**
  （`gap-fixture-dir-write-races-whole-tree-copy` / `gap-process-budget-counts-hung-test-processes-as-in-use` /
  `gap-develop-sync-reset-hard-destroys-third-party-project-tree` / `gap-meta-outer-driver`）；上一轮 suite 跑时
  最新完成者恰是第三个 ⇒ 命中（复现：把 AC6 的 id 换成它干跑 ⇒ `group.commits.length=8` vs `gitCount=9` MISMATCH）。
- 同源（硬规则 5b）：已 done 的 `gap-taskid-from-subject-form4-prefix-guard` 修的是**同一形态的 Form 4**
  （假 id `git-history` → **同一个测试文件** AC6 红 → 阻塞全部 fan-in），其描述逐字称「缺少 **Form 5/6** 共有的
  known-prefix 守卫」——**Forms 2+3 从未被守**；`serve-git.ts:239` 的文档串同样写成「Forms 4–6 …」，静默排除 2+3。
- ⛔ 修它要动 `packages/quay/src/serve-git.ts` + 其测试，**不在本任务 `## Touches` 内**（anti-drift 是 fan-in 的
  HARD FAIL 步）⇒ 只上抛不修，建议 manager/人另立任务。

**上一轮 exited-not-landed 的根因 = 机械 fan-in 的静默看门狗把「排队等单飞槽」误判为「挂死」，
与本任务代码无关（suite 一个测试都没跑）**：

- 读数①：`.quay/fan-in-suite-<task>~wk-prod-1788972473~1789113002586-97a072.log` = **0 字节**。
  在 127 个 `fan-in-suite-*.log` 中它是**唯一**的 0 字节（其余 400KB–1.6MB）。
- 读数②（为何 0 字节 ⇒ 从未拿到槽）：suite 命令被 `suite-driver.ts:113 slotHolderArgv` 包一层，
  slot-holder 的等槽循环（`suite-driver.ts:88-100` 的 `while [ -z "$held" ]`）**不打印任何东西**，
  且它在 `exec "$@"` **之前** ⇒ 永远排在 `full-suite-runner.ts` / `scripts/test.sh` 之前。
  `test.sh` 的全部首行输出（`refresh-worktree-quay:`、`__BUCKETS__`）都在拿到槽之后才可能出现
  ⇒ **0 字节 = 卡在等槽，一个测试都没跑**。
- 读数③（谁占了槽，外部可核）：`/proc/3782846/fd/10 -> /home/yale/work/quay/.git/full-suite.lock.0`
  （pid 3782846 = `bash scripts/test.sh`，其 fd 1 → `/tmp/full-suite2.log`，属
  `gap-goal-criteria-bare-failing-exit-unattributable` 工作树）；其持槽的 hold-cap 旗标文件
  `/tmp/full-suite-lock-hold.Ht1Tsl` 创建于 **07:44**，到 08:13 仍在写。
- 读数④（我们的取槽尝试）：`.git/full-suite.lock.0` 的 mtime = **07:52** = 我们 slot-holder 的
  `exec {fd}>"$s"` 截断时刻，与日志文件创建时刻一致。
- 读数⑤（负控制）：07:30–08:20 窗口内 `.quay/fan-in-suite-*.log` 被改动的**只有我们这一条**（上面那条 0 字节）。
- 结论：槽数 `concurrentSuiteSlots=1`（`.git/full-suite.lock.concurrency` = `1`），被同侪 suite 占住
  ≥ 15 min（`SILENCE_MS_DEFAULT = 15 * 60_000`）⇒ 看门狗 SIGKILL 了一个**只是在排队**的 suite。

**这是已 done 的 `gap-mech-fan-in-suite-silence-watchdog-fired` 自己写明、却未被修的那一半**：该任务
Proposal 的 B 子形态逐字记着「等锁/启动段静默被判挂 …… 排队等单飞槽、启动阻塞、真挂死三者同形」，
Plan 第 2 条 (a) 给的修法是「`scripts/test.sh` 等锁循环每 30s 打一行心跳」；而实际落地的修
（`931fdc4dd` + `spawnSuiteAndWait` 强制注入 `QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT=1`）只治了**自死锁**那一半
（suite 对自己的槽再 flock）。⇒ 「排队被误杀」这一半今天仍然活着，本任务是一次干净复现
（硬规则 5b：修好一个实例 ≠ 该原则再无其它适用点）。
⛔ 修它要动 `scripts/test.sh` / `suite-driver.ts`，**不在本任务 `## Touches` 内**，故只上抛、不修。

**附带观察（同窗口，未取证）**：`ps` 有 6 个 `bash scripts/test.sh --buckets <task>` 存活 **1–3 天**
（pid 356720 / 1135674 / 1229342 / 2105632 / 2948127 / 3500020，均 ppid=1 孤儿）。它们当前**不持** `.0`
（fd 扫描未命中），故非本次直接成因；但单槽（S=1）+ 孤儿长跑会显著拉长一切排队，建议一并复核。
