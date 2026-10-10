---
id: goal-036-merge-and-postmerge-verify
title: GOAL-036 ③：合并请求 + 机械 fan-in + 并入形态与落地树核验（AC-361，post-merge）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - goal-036-dispatch-exclusion-single-source
  - goal-036-dispatch-exclusion-contract-tests
goal_ac: AC-361
---
**type:** execution

## Proposal

GOAL-036 的第三块（并入 + 并入后核验）：在 AC-359（结构护栏：`computeDispatchExclusion` 是 `{inFlight, retryExhausted}` 在 `driver-filters.ts` 的唯一纯计算点，`worker-driver.ts` 的 `inFlightTasks()` 双调用归零）与 AC-360（函数级可证伪契约 + 两个受影响测试文件全量回归）两个 pre-merge 判据都 achieved 之后，记录一次 goal 合并请求，由 worker-driver 机械 fan-in 把 `goal/GOAL-036` 并入 develop；随后在同一条 develop 尖端上核验 AC-361。

AC-361 的判据**不读**任何冻结的 landedSha，而是现场读 `git rev-parse develop` 并要求 `git merge-base develop HEAD == develop tip` ⇒ 求值树必须是 **develop 尖端本身或其子孙**。branch-mode goal 的 post-merge AC 在主检出（`evaluationRoot=/data/home/yale/work/quay`，分支 `author`）求值，因此并入后**必须先把主检出 ff 同步到 develop**（`git merge --ff-only develop`），否则 merge-base 停在旧的 fork point ⇒ exit 3（NOT-EVALUATED），而这个读数与「尚未并入」同形（硬规则 3b/4b：先看是不是 branch lag，再怀疑没并入 —— 已知形态 `production-carrier-static-red-can-be-branch-lag` / `post-merge-verify-ac-naming-a-live-reading-drifts-false`）。

本任务不改任何 `plugin/scripts/**` 或 `plugin/test/**` 源码；它只负责触发合并、核验形态、把落地树读数与两个测试文件的原始输出落进 `## Evidence`，并如实记录生产生效面。

<!-- dedup-ref --> 立案时读到的两处现场事实，记录于此仅供追溯（本任务的范围=一个 AC；这两点不是本任务要修的）：(a) AC-361 的 goal 文件（`goals/AC-361-*.md`）**没有 `phase:` 行**（`grep -n '^phase:' goals/AC-361-*.md` 无命中）⇒ `readGoalAcs` 缺省 `pre-merge` ⇒ `unmetPreMergeAcs(GOAL-036)` 恒含 AC-361（status active、last verdict not-evaluated）⇒ `quay goal merge GOAL-036` 除 `--override` 外恒被 `pre-merge-ac-unmet` 拒绝；同形先例 AC-358/GOAL-035（`goal-035-merge-and-postmerge-verify`，done，就地修于提交 `61f29eabd`，diff 仅 `+phase: post-merge` 一行）、AC-355/GOAL-034、AC-349/GOAL-032 都在各自的 post-merge 任务里就地修（本任务按同一手法处理，见 Plan 第 2 步）。(b) 本任务的两个兄弟任务 `goal-036-dispatch-exclusion-single-source`（`goal_ac: AC-359`）与 `goal-036-dispatch-exclusion-contract-tests`（`goal_ac: AC-360`）尚未 achieved —— `depends_on` 已在 frontmatter 声明，本任务结构上等它们先落地；这是本任务无法绕过的上游，⛔ 不属本任务范围（一刀一 AC）。

## Plan

1. 前置核验（任一不满足 ⇒ 停在此处、把读数逐字写进任务体，⛔ 不用 `--override` 绕过、⛔ 不自推范围）：
   - `quay goal show AC-359 --json` 与 `quay goal show AC-360 --json` 的最后一条 ledger verdict 均 `pass`（`quay goal merge` 的真实门是 `unmetPreMergeAcs`，它读 ledger 的 `lastGoalVerdict`，不读滞后的 `status` 字段 —— 见 `packages/quay/src/goal-merge.ts`）；
   - `quay goal show AC-361 --json` 的 `phase` 为 `post-merge`（若为 `pre-merge` 先做第 2 步）；
   - `git show-ref refs/heads/goal/GOAL-036` 存在（分支尚未被删）。
2. 若 AC-361 的 `phase` 仍是 `pre-merge`（声明缺陷，见 Proposal）：就地修 `quay goal write AC-361 --phase post-merge --root /data/home/yale/work/quay`，`git show <提交> --stat` 核 diff **仅 `+phase: post-merge` 一行**（未动 `origin`/`status`/`criterion`）。先例 AC-358 ⇒ `61f29eabd`、AC-355 ⇒ `c1bfb8f1d`、AC-349 ⇒ `3723086fd`。**只改求值相位、不跳过验证** —— AC-361 仍须在并入后被判定（第 6 步）。
3. `quay goal merge GOAL-036 --reason "<一句为什么现在并>" --root /data/home/yale/work/quay` —— 只追加一条 `goal-merge-request` 事件；真正的 `git merge --no-ff` 由 worker-driver 在加锁的临时 worktree 里执行并跑 anti-drift / typecheck / scoped 门 / 全量 suite。
4. 等待 `goal-merge-result` 事件。**若 fan-in 红**：读该事件 payload 与 suite 日志，在隔离 worktree 里单独跑失败文件，区分「本 goal 的改动造成」与「全量 suite 并发环境伪影」。属于本 goal 的回归 ⇒ 回分支修；属于环境伪影 ⇒ 另立 gap 任务修根因。⛔ 不经诊断就重试、⛔ 不改判据迁就结果。（先例：GOAL-035 第 1 次 fan-in 的 `ff` 红是 develop 在快照与 ff 之间前进 ⇒ 非快进、非回归，经诊断后重请求；见 `goal-035-merge-and-postmerge-verify` 的 Evidence。）
5. 并入后在**主检出**追平 develop：`git merge --ff-only develop`（非 ff ⇒ 停下诊断，不要 force）。核 `git merge-base develop HEAD` == `git rev-parse develop`，且 `git rev-list --count develop..HEAD` 期望为 0。
6. 在主检出跑 AC-361 判据：`quay goal gate AC-361 --dry-run --json --timeout 900000 --root /data/home/yale/work/quay` ⇒ exit 0；原文进 `## Evidence`。判据自身已覆盖：`plugin/scripts/driver-filters.ts` 含 `computeDispatchExclusion`；`grep -c "inFlightTasks()" plugin/scripts/worker-driver.ts` ≤ 1；`plugin/test/driver-filters.test.mjs` 与 `plugin/test/worker-driver.test.mjs` 全绿。
   - exit 3 ⇒ 求值树不是 develop 子孙（先查主检出是否落后 develop，branch lag 不是「没并入」）；exit 1 ⇒ 判据同行给 `CAUSE=`，逐字记下并交回实现/读数任务，不在本任务内改源码。
7. 并入形态核验（AC-361 判据**不含**此项，但它是本 goal 的退出条件：「GOAL-036 以恰好一个合并提交进入 develop」）：
   - `develop` tip == `landedSha`，且是 `git rev-list --first-parent develop` 首行；
   - `git rev-list --parents -n1 <landedSha>` 恰两个父：`^1` = 并入前 develop tip、`^2` = goal tip（记 tipSha）；
   - `git rev-list <landedSha>^1..<tipSha>` 与 first-parent 链无交集（无分支提交泄漏到 first-parent）。
8. 两个测试文件的**原始输出**另存：在主检出并排跑 `node --no-warnings --experimental-strip-types --test --test-timeout=900000 plugin/test/driver-filters.test.mjs plugin/test/worker-driver.test.mjs`，记 `tests/pass/fail` 行；与判据内置那次互为第二来源（硬规则 4/4c）。⚠️ `worker-driver.test.mjs` 较大，评估时显式传一个较大的 `--timeout`（如 900000ms），避免把真实超时误判为回归。
9. 生产生效面（读数，非结论）：记 `ps -eo pid,etimes,args` 里的 `serve` 与 driver anchor 行。本 goal 改的是**常驻 worker-driver** 的派发环（`runResidentLoop` 的 ready-pool→apply-filters 窗口）——它已把旧代码载入内存，改动要等下一次 driver 重启才生效；而 goal body 明令**不重启任何生产进程**。⛔ 本任务不调用任何 `quay driver start|stop|restart`、不重启 `serve`；只如实记录「已落地到 develop、待下次重启生效」这一读数。
10. 自查：`node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/goal-036-merge-and-postmerge-verify.md` exit 0；`quay task check goal-036-merge-and-postmerge-verify --json` 的 `ok:true` 且 `acChecked == acTotal`。

## Acceptance Criteria

- [x] 前置核验读数已记录（`quay goal show AC-359 --json` / `AC-360 --json` 的最后 ledger verdict 均 `pass`；`git show-ref refs/heads/goal/GOAL-036` 非空）；任一不满足则停在 Plan 第 1 步并如实记录读数。
- [x] AC-361 的 `phase` 声明已就地修/确认：`quay goal show AC-361 --json` 的 `phase` 为 `post-merge`；若是本轮修为，`git show <提交> --stat` 显示 diff **仅一行 `+phase: post-merge`**，未动 `origin`/`status`/`criterion`。
- [x] `.quay/gate-events.jsonl`（主检出）含一条 GOAL-036 的 `goal-merge-request` 事件，payload `override: null`、`unmetAcs: []`（事件 id、tipSha 进 `## Evidence`），未使用 `--override`。
- [x] 同一文件含一条 GOAL-036 的 `goal-merge-result`，`outcome: landed`，记录 `landedSha` 与 `tipSha`。
- [x] 并入形态：`develop` tip == `landedSha` 且为 first-parent 首行；`git rev-list --parents -n1 <landedSha>` 恰两父（`^1`=并入前 develop tip、`^2`=goal tip）；`comm -12 <(git rev-list <landedSha>^1..<tipSha>) <(git rev-list --first-parent develop)` 为空。
- [ ] 主检出已 ff 追平 develop（`git merge-base develop HEAD` == `git rev-parse develop`，`git rev-list --count develop..HEAD` = 0），AC-361 判据在其上 `--dry-run` exit 0，JSON 原文进 `## Evidence`。
- [ ] 落地树结构读数逐字进 `## Evidence`：`grep -q computeDispatchExclusion plugin/scripts/driver-filters.ts` 命中；`grep -c "inFlightTasks()" plugin/scripts/worker-driver.ts` ≤ 1。
- [x] `plugin/test/driver-filters.test.mjs` 与 `plugin/test/worker-driver.test.mjs` 在主检出全绿，`tests/pass/fail` 原始行进 `## Evidence`（大文件用大 `--timeout`）。
- [x] 生产生效面已按 Plan 第 9 步以读数说明；本任务未调用任何 `quay driver start|stop|restart`、未重启 `serve`。
- [x] 本任务未改动任何生产源码（`git diff --name-only develop...HEAD` 不含 `plugin/scripts/**` 与 `plugin/test/**`）。

## Definition of Done

GOAL-036 以恰好一个合并提交进入 develop，落地树持有本刀全部结构改动（`computeDispatchExclusion` 是 `{inFlight, retryExhausted}` 在一轮调度内的唯一计算点，`worker-driver.ts` 内 `inFlightTasks()` 调用数 ≤ 1），AC-361 判据在主检出 exit 0、两个受影响测试文件实测全绿；fan-in 若出现红灯已诊断归因而非盲目重试；全程未重启生产进程、未用 `--override` 跳过任何验证。

## Evidence

### 前置核验（Plan 1，AC1）

- `AC-359`：最后一条 ledger `gate:"goal"` verdict = **`pass`**（`2026-10-10T19:14:46.790Z`，event id `a80c6a8d-cf3d-400d-8355-1ff38bbd3f56`）；`status = achieved`。7 条 goal-gate 事件，末条即此。
- `AC-360`：最后一条 ledger `gate:"goal"` verdict = **`pass`**（`2026-10-10T19:15:21.219Z`，event id `d9d8597d-3a0b-4c5c-8a53-73b05919a4cb`）；`status = achieved`。7 条 goal-gate 事件，末条即此。
- `AC-361`：请求时刻 `phase = "pre-merge"`、`status = active`、最后一条 ledger verdict = `not-evaluated`（`2026-10-10T19:15:38.500Z`，id `9b375624-3a98-4d20-aca4-c9bf0dd1ce65`，exit 3，`merge-base=69e672ecc` / `develop=5a67888e6`）。
- `git show-ref refs/heads/goal/GOAL-036` = `e5a2b7a2e9bc7bb1be886c2ee472bdfac0a6c529`（非空，尚未被删）。
- 全程未使用 `--override`（见下文 AC3 的 `override: null`）。

### AC2 — AC-361 的 `phase` 声明就地修正（post-merge）

`goals/AC-361-*.md` 无 `phase:` 行 ⇒ `readGoalAcs` 缺省 `pre-merge`（`packages/quay/src/goal-merge.ts:138`）⇒ `unmetPreMergeAcs(GOAL-036)` 恒含 AC-361（status active、last verdict not-evaluated）⇒ `quay goal merge` 除 `--override` 外恒被 `pre-merge-ac-unmet` 拒绝。就地修正：

    $ node --experimental-strip-types packages/quay/bin/quay.ts goal write AC-361 --phase post-merge --root /data/home/yale/work/quay
    ⇒ exit 0；author 提交 b2fb6830ba3d50c5897f92253c7f07ece59ad02a
      ("goals: AC-361 update by cli:2880244", 2026-10-11 03:20:54 +0800)

`git show b2fb6830b --stat` ⇒ `1 file changed, 1 insertion(+)`；diff 逐字：

    @@ -72,4 +72,5 @@ fidelity:
       verdict: not-evaluated
       reason: no judge configured
       at: 2026-10-10T18:35:03.665Z
    +phase: post-merge
     ---

`origin` / `status` / `criterion` / `title` / `goal` / `expect` 均未动（改后重读：`phase = "post-merge"`、`status = "active"`、`origin = "用户 2026-10-11 批准三轨①"`、`criterion` 与改前逐字节相同）。**只改求值相位、不跳过验证** —— AC-361 仍须在并入后被判定（见 AC6/AC7：本轮实测它 **未通过**，如实记录，未回改相位）。

### AC3 — goal-merge-request 事件（`.quay/gate-events.jsonl`，主检出）

    id        = 7667e142-1b23-4257-99fc-8b2fb8a69b6f
    gate      = goal-merge-request   item_id = GOAL-036   actor = human   verdict = request
    timestamp = 2026-10-10T19:21:10.342Z
    payload   = { tipSha: "e5a2b7a2e9bc7bb1be886c2ee472bdfac0a6c529",
                  override: null, unmetAcs: [], eventId: "7667e142-…" }

`override: null` + `unmetAcs: []` ⇒ **未使用 `--override`**，且未被 `pre-merge-ac-unmet` 拒绝（相位修正生效）。

### AC4 — 机械 fan-in 结果（`outcome: landed`）

    id        = 5a406b99-f92b-4241-958c-3e1c521cb08b
    gate      = goal-merge-result   item_id = GOAL-036   actor = quay-driver   verdict = pass
    timestamp = 2026-10-10T19:27:53.410Z
    payload   = { outcome: "landed", step: null, reason: null,
                  tipSha: "e5a2b7a2e9bc7bb1be886c2ee472bdfac0a6c529",
                  requestEventId: "7667e142-1b23-4257-99fc-8b2fb8a69b6f",
                  landedSha: "eb89d042e3799de07f9d1a3c3a73cbbc291f0c31" }

fan-in step trace（`.quay/fan-in-step-trace.jsonl`，runId `gm-GOAL-036-1791660244969`）：`acquire-goal-lock` ok 32ms → `acquire-develop-lock` ok 26ms → `read-develop` ok 7ms → `worktree-add` ok 596ms → `merge` ok 15382ms → `quay-snapshot` ok 7020ms (`state=copied`) → `suite` **ok**（全量 suite 绿 ⇒ 无红步）。目标合并机制**本轮一次通过**，无需像 GOAL-035 那样重请求。

### AC5 — 并入形态（develop first-parent 恰好一个合并提交）

- `git rev-parse develop` = `eb89d042e3799de07f9d1a3c3a73cbbc291f0c31` = `landedSha`；
- `git rev-list --first-parent develop | head -1` = `eb89d042e…`（first-parent 首行）；
- `git rev-list --parents -n1 eb89d042e` = `eb89d042e b2fb6830b e5a2b7a2e` ⇒ **恰两个父**：`^1` = `b2fb6830ba3d50c5897f92253c7f07ece59ad02a`（并入前 develop tip，= 本任务的相位修正提交）、`^2` = `e5a2b7a2e9bc7bb1be886c2ee472bdfac0a6c529`（goal tip = 请求事件的 `tipSha`）；
- 泄漏检查 `comm -12 <(git rev-list eb89d042e^1..e5a2b7a2e | sort) <(git rev-list --first-parent develop | sort)` ⇒ **0 行**（无 goal 分支内部提交混入 first-parent）；
- 合并提交 subject：`merge: goal/GOAL-036 into develop (request 7667e142-1b23-4257-99fc-8b2fb8a69b6f)`；
- 并入后 `git show-ref refs/heads/goal/GOAL-036` ⇒ 空、exit 1（驱动已删分支）；
- 本刀落地 delta（`git diff --stat eb89d042e^1 eb89d042e`）：`plugin/scripts/driver-filters.ts` +19、`plugin/scripts/worker-driver.ts` +10/-2、`plugin/scripts/direct-to-develop-bypass-check.ts` +17/-3、`plugin/test/driver-filters.test.mjs` +38、`plugin/test/direct-to-develop-bypass-check.test.mjs` +17/-3。

### AC6 — 主检出 ff 追平 develop ✅ ／ **AC-361 判据 `--dry-run` exit 0 ✗（未通过，如实记录）**

    $ git -C /data/home/yale/work/quay merge --ff-only develop
    ⇒ "Already up to date."（exit 0）—— post-merge 的 doc 同步已把主检出（分支 `author`）快进到 develop
    $ git merge-base develop HEAD   ⇒ eb89d042e3799de07f9d1a3c3a73cbbc291f0c31
    $ git rev-parse develop         ⇒ eb89d042e3799de07f9d1a3c3a73cbbc291f0c31      （两者相等）
    $ git rev-list --count develop..HEAD ⇒ 0
    $ git rev-parse --abbrev-ref HEAD    ⇒ author

**AC-361 判据（主检出，`--dry-run --json --timeout 900000`）⇒ EXIT 1，未通过。JSON 原文：**

```json
{ "id": "AC-361", "verdict": "fail", "cause": null,
  "reason": "acceptance failed (exit 1) — CAUSE=post-merge-regression -- worker-driver.ts still has 4 inFlightTasks() call(s) on develop, expected at most 1 (or 0 if the closure itself was removed)",
  "timeoutMs": 900000, "timestamp": "2026-10-10T19:35:32.067Z", "dryRun": true,
  "event": { "id": "56a55ebb-13ca-40ae-8bf6-3d768a1e925e", "item_id": "AC-361",
             "pipeline_id": "AC-361", "gate": "goal", "actor": "goal-cli", "verdict": "fail",
             "payload": { "reason": "…同上…", "evaluationRoot": "/data/home/yale/work/quay",
                          "treeSha": "1d758ddf3bbcfeeaaef93acebcd0cc2c23d2e088" } } }
```

（`treeSha 1d758ddf3` 与立案前用 `git merge-tree --write-tree develop goal/GOAL-036` 预演的合并树**逐字节相同** ⇒ 判据确实跑在并入后的树上，不是回放缓存。）

### AC7 — 落地树结构读数（主检出工作树，develop 尖端 `eb89d042e`）：**与判据声明的期望不一致，如实记录**

    grep -q computeDispatchExclusion plugin/scripts/driver-filters.ts          ⇒ 命中（exit 0）
    grep -c computeDispatchExclusion plugin/scripts/driver-filters.ts          ⇒ 1
    grep -c "inFlightTasks()" plugin/scripts/worker-driver.ts                  ⇒ 4   ⚠️ 判据要求 ≤ 1

4 处逐行（`grep -n`）：

    1666:  /** 本轮在飞的 task id（… = inFlightTasks() 的返回值）…       ← 注释
    5229:      const ids = inFlightTasks();                                  ← 冷启动读数（computeGoalBranchReading）
    5269:      inFlightTasks: inFlightTasks(),                               ← writeRound 记录字段
    5317:      inFlightTasks: inFlightTasks(),                               ← writeErrorRound 记录字段

同树的**窗口读数**（AC-359 判据的语义面：`step = "ready-pool"` → `step = "apply-filters"` 窗口内）：
`computeDispatchExclusion(` = **1**、`inFlightTasks()` = **0** ⇒ 即本刀的结构改动**确在落地树上**。

**⇒ 这是 AC-361 判据自身的一处结构缺陷（恒假），不是落地树缺了改动。** 依据（逐条可复核）：

1. GOAL-036 记录自己的 `## AC` 一节把 AC-361 定义为「**`develop` 尖端（`merge-base` 一致性核验）重跑 AC-359 的结构检查** + 两个测试文件全量回归」——即**窗口范围**的检查，不是全文件计数。
2. GOAL-036 的「退出条件」写的是「`computeDispatchExclusion` 是 `{inFlight, retryExhausted}` **在一轮调度内**的唯一计算点」——**无**「全文件 `inFlightTasks()` ≤ 1」这一条。
3. 兄弟任务 `goal-036-dispatch-exclusion-single-source` 的 `## Plan` 第 3 步**明文要求保留**闭包与那三处非派发调用点（"Do NOT remove the `inFlightTasks()` closure itself if it's used elsewhere … leave those call sites alone, they're not part of this slice's scope; only the two dispatch-path call sites at ~5740/~5753 are in scope"）；第 4 步明写 "it may still appear elsewhere in the file … that's fine, out of scope"。
4. AC-359（pre-merge 判据）本身就是**窗口范围**的，且已在 goal 分支 `exit 0`、记录 `achieved`（ledger 末条 `pass`）。

⇒ AC-361 判据里 `grep -c "inFlightTasks()" … ≤ 1` 这一子句**与 goal 自身的规格冲突**（应「重跑 AC-359 的结构检查」），在任何满足本 goal 范围的实现上都恒假。按硬规则 4c（判据必须测量它自己声明的性质）与既有处置纪律（`unsatisfiable-ac-requiring-authoring-loops-the-worker-driver`：**Leave the AC unchecked, the AC text unedited, and `status:` untouched**；reword/re-scope 是 **authoring 决定，不是 executor 的决定**），本任务**不**改写判据文本、**不**勾选依赖它的 AC6/AC7，只如实记录并把决定交回。

### 《待裁定 —— 让 AC-361 可满足所需的一行决定》

AC-361 `criterion` 里的

    callCount=$(grep -c "inFlightTasks()" plugin/scripts/worker-driver.ts || true)
    [ "${callCount:-0}" -le 1 ] || { echo "CAUSE=post-merge-regression -- …" >&2; exit 1; }

应由**拥有 goal 记录的 filer**（非本 worker）改写成与上面第 1/2/3/4 条一致的**窗口检查**（即「重跑 AC-359 的结构检查」），例如：

    s=$(grep -n 'step = "ready-pool"'   plugin/scripts/worker-driver.ts | head -1 | cut -d: -f1)
    a=$(grep -n 'step = "apply-filters"' plugin/scripts/worker-driver.ts | head -1 | cut -d: -f1)
    w=$(sed -n "${s},$((a+40))p" plugin/scripts/worker-driver.ts)
    [ "$(printf '%s' "$w" | grep -c 'computeDispatchExclusion(')" = 1 ] || { echo "CAUSE=…" >&2; exit 1; }
    [ "$(printf '%s' "$w" | grep -c 'inFlightTasks()')" = 0 ]        || { echo "CAUSE=…" >&2; exit 1; }

（改判据有**已知副作用**：`amending-a-goal-criterion-reds-tests-that-extract-it-verbatim` —— 落笔前必须先 `grep -rln "AC-361\|goals/AC-361" packages/*/test plugin/test` 并跑命中的测试。建议按先例 `gap-ac356-criterion-environment-fatal-window-check-unsatisfiable`（`done`）**独立立案**，`goal_ac: AC-361`，Touches = goal 记录 + 该任务自身文件，并要求**负控制**证明修好的检查仍有判别力。）

### AC8 — 两个受影响测试文件（主检出，原始输出）

    $ node --no-warnings --experimental-strip-types --test --test-timeout=900000 \
        plugin/test/driver-filters.test.mjs plugin/test/worker-driver.test.mjs
    ⇒ EXIT=0，原始 summary（Node v24 输出用 `ℹ` 前缀）：
      ℹ tests 203
      ℹ suites 0
      ℹ pass 203
      ℹ fail 0
      ℹ cancelled 0
      ℹ skipped 0
      ℹ todo 0
      ℹ duration_ms 29881.695736
      （`grep -c '^not ok'` ⇒ 0）
    （两文件分计：driver-filters.test.mjs 74 + worker-driver.test.mjs 129 = 203，与先例 AC-360 的读数一致。）

⚠️ **AC-361 判据没有覆盖到这一步**：其 `criterion` 在 `inFlightTasks() ≤ 1` 子句处先 `exit 1`，**未**执行内置的两次 `--test` 调用（因此内部 `/tmp/goal036-ac361-*.txt` 本轮不存在）。「两文件全绿」这一半由本任务在主检出独立实测（上表），判据内置那一次本轮**不可得**（硬规则 4c：判据声称的两半，只有一半真的跑了）。

### AC9 — 生产生效面（读数，非结论）

`ps -eo pid,etimes,args`（2026-10-10T19:25:10Z）：

    pid 1769873  etimes 652068  node --no-warnings --experimental-strip-types /data/home/yale/work/quay/packages/quay/bin/quay.ts serve
    pid 1869201  etimes  23614  node --experimental-strip-types /data/home/yale/work/quay/plugin/scripts/driver-anchor.ts __anchor --root /data/home/yale/work/quay --takeover 1966288
    pid 3112037… etimes      0  /tmp/goal-merge-GOAL-036-oBMn57/wt/plugin/scripts/worker-driver.ts …   ← 本 goal 并入 fan-in 的临时 worktree 子进程（跑全量 suite），非本任务所起

本 goal 改的是**常驻 worker-driver** 的派发环（`runResidentLoop` 的 ready-pool→apply-filters 窗口）。已在内存里跑了很久的进程（`serve` pid 1769873 / driver anchor pid 1869201）加载的是改动之前的代码；改动**已落到 develop，但要等下一次 driver 重启才在生产上生效**。⛔ 本任务**未**调用任何 `quay driver start|stop|restart`，**未**重启 `serve`；只记录「已落地到 develop、待下次重启生效」这一读数。

### AC10 — 未改动生产源码

本任务在任务分支（`task/goal-036-merge-and-postmerge-verify`，worktree `/home/yale/work/quay-worktrees/goal-036-merge-and-postmerge-verify`）上零源码 delta：`git diff --name-only develop...HEAD` ⇒ **空**；worktree 已 `git merge --no-edit develop` 快进到 `eb89d042e`，`git rev-list --count develop..HEAD` = 0。`goals/AC-361-*.md` 的 `+phase: post-merge` 一行是本任务 AC2 的就地声明修正（该文件在本任务 `## Touches` 之内）。落地树里的 `plugin/scripts/**`、`plugin/test/**` 改动来自 GOAL-036 本身的合并提交 `eb89d042e`，**不是本任务所改**。

### 自查（Plan 10）

- `node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/goal-036-merge-and-postmerge-verify.md` ⇒ `SELFCHECK_SCHEMA`
- `quay task check goal-036-merge-and-postmerge-verify --json` ⇒ `SELFCHECK_TASKCHECK`
- **scoped 门（Plan 2b）本轮跳过**：依 `unsatisfiable-ac-requiring-authoring-loops-the-worker-driver` 的实测纪律，AC 未全勾时 worker-driver 在 fan-in **之前**即以 `short_circuit: "ac-not-checked"` 短路，scoped 门与 scoped-gate 缓存写入**不改变任何结果**；本轮把预算花在记录与升级（此偏离已在任务体说明）。
- **写入面（本任务体自身的两次正文写入）**：`tasks/<id>.md` 是**全量替换**语义的正文，本次正文含约 10 KB 既有文本 + 约 8 KB 新增 Evidence。为**不重打字**（`task-write-body-is-full-replacement-verify-by-section-diff`、`unsatisfiable-ac-grep-matching-its-own-text` 明写 "you must retype ~16 KB of exact text — corrupting the record is worse"），正文由 `node /tmp/goal036/compose.mjs` **机械合成**（按子串定位 8 条 AC 逐条翻 `- [x]`；Evidence 段插在 `## Touches` **之前**，避开 `append-notes-injects-into-the-trailing-touches-section` 的解析陷阱），再经 **provider ABI** 的 `quay-native task edit <id> --body-file` 落盘（CLAUDE.md 明列 body write 可用 "the native provider's own richer `quay-native task edit`"）。⛔ 未手改任何 checkbox 字符、未用 Read/Edit/Write 触碰任务文件。

### 本轮的升级动作（不在本任务 `## Touches` 内，仅记录）

AC6/AC7 的两项未勾是**结构性**的（判据恒假），不是实现缺口。按纪律本 worker 不自行改写判据；已把「待裁定」一节写明所需的一行决定，并另行投递升级（`meta_write` META 记录 + 跨会话 `SendMessage` 给本 goal 的立案会话 + `PushNotification`）。


## Touches

- tasks/goal-036-merge-and-postmerge-verify.md
- goals/AC-361-post-merge-生产验证-develop-尖端持有本刀全部结构改动-两个受影响测试文件回归全绿.md
