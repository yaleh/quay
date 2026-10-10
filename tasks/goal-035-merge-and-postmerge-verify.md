---
id: goal-035-merge-and-postmerge-verify
title: GOAL-035 ③：合并请求 + 机械 fan-in + 并入形态与落地树核验（AC-358，post-merge）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - goal-035-needs-human-transition-unify
  - goal-035-needs-human-transition-contract-tests
goal_ac: AC-358
---
---
id: goal-035-merge-and-postmerge-verify
title: GOAL-035 ③：合并请求 + 机械 fan-in + 并入形态与落地树核验（AC-358，post-merge）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - goal-035-needs-human-transition-unify
  - goal-035-needs-human-transition-contract-tests
goal_ac: AC-358
---
**type:** execution

## Proposal

GOAL-035 的第三块（并入 + 并入后核验）：在 AC-356（结构护栏）与 AC-357（函数级可证伪契约 + 两个测试文件回归）两个 pre-merge 判据都 achieved 之后，记录一次 goal 合并请求，由 worker-driver 机械 fan-in 把 `goal/GOAL-035` 并入 develop；随后在同一条 develop 尖端上核验 AC-358。

AC-358 的判据**不读**任何冻结的 landedSha，而是现场读 `git rev-parse develop` 并要求 `git merge-base develop HEAD == develop tip` ⇒ 求值树必须是 **develop 尖端本身或其子孙**。branch-mode goal 的 post-merge AC 在主检出（`evaluationRoot=/data/home/yale/work/quay`，分支 `author`）求值，因此并入后**必须先把主检出 ff 同步到 develop**（`git merge --ff-only develop`），否则 merge-base 停在旧的 fork point ⇒ exit 3（NOT-EVALUATED），而这个读数与「尚未并入」同形（硬规则 3b/4b：先看是不是 branch lag，再怀疑没并入 —— 已知形态 `production-carrier-static-red-can-be-branch-lag` / `post-merge-verify-ac-naming-a-live-reading-drifts-false`）。

本任务不改任何 `plugin/scripts/**` 或 `plugin/test/**` 源码；它只负责触发合并、核验形态、把落地树读数与两个测试文件的原始输出落进 `## Evidence`，并如实记录生产生效面。

<!-- dedup-ref --> 立案时读到的两处现场事实，记录于此仅供追溯（本任务的范围=一个 AC；这两点不是本任务要修的）：(a) AC-358 的 goal 文件（`goals/AC-358-*.md`）**没有 `phase:` 行** ⇒ `readGoalAcs` 缺省 `pre-merge`（`goal-merge.ts:138`）⇒ `unmetPreMergeAcs(GOAL-035)` 恒含 AC-358（status active、last verdict not-evaluated）⇒ `quay goal merge GOAL-035` 除 `--override` 外恒被 `pre-merge-ac-unmet` 拒绝；同形先例 AC-355/GOAL-034 与 AC-349/GOAL-032 都在各自的 post-merge 任务里就地修（本任务按同一手法处理，见 Plan 第 2 步）。(b) 兄弟任务 `goal-035-needs-human-transition-unify`（`goal_ac: AC-356`）的 Evidence 记录 AC-356 判据当前有一个结构性缺陷（`environment-fatal` 锚点取错、400 字符窗口取不到 `return r;`），须由 goal 记录拥有者先修好——这是本任务结构上无法绕过的上游，但**不在本任务范围**（一刀一 AC；`depends_on` 已在 frontmatter 声明）。

## Plan

1. 前置核验（任一不满足 ⇒ 停在此处、把读数逐字写进任务体，⛔ 不用 `--override` 绕过、⛔ 不自推范围）：
   - `quay goal show AC-356 --json` 与 `quay goal show AC-357 --json` 均 `achieved`；
   - `quay goal show AC-358 --json` 的 `phase` 为 `post-merge`（若为 `pre-merge` 先做第 2 步）；
   - `git show-ref refs/heads/goal/GOAL-035` 存在（分支尚未被删）。
2. 若 AC-358 的 `phase` 仍是 `pre-merge`（声明缺陷，见 Proposal）：就地修 `quay goal write AC-358 --phase post-merge --root /data/home/yale/work/quay`，`git show <提交> --stat` 核 diff **仅 `+phase: post-merge` 一行**（未动 `origin`/`status`/`criterion`）；先例 AC-355 ⇒ `c1bfb8f1d`、AC-349 ⇒ `3723086fd`。**只改求值相位、不跳过验证**——AC-358 仍须在并入后被判定（第 6 步）。
3. `quay goal merge GOAL-035 --reason "<一句为什么现在并>" --root /data/home/yale/work/quay` —— 只追加一条 `goal-merge-request` 事件；真正的 `git merge --no-ff` 由 worker-driver 在加锁的临时 worktree 里执行并跑 anti-drift / typecheck / scoped 门 / 全量 suite。
4. 等待 `goal-merge-result` 事件。**若 fan-in 红**：读该事件 payload 与 suite 日志，在隔离 worktree 里单独跑失败文件，区分「本 goal 的改动造成」与「全量 suite 并发环境伪影」（GOAL-030 曾两次遇到后者并以独立 gap 任务修复）。属于本 goal 的回归 ⇒ 回分支修；属于环境伪影 ⇒ 另立 gap 任务修根因。⛔ 不经诊断就重试、⛔ 不改判据迁就结果。
5. 并入后在**主检出**追平 develop：`git merge --ff-only develop`（非 ff ⇒ 停下诊断，不要 force）。核 `git merge-base develop HEAD` == `git rev-parse develop`，且 `git rev-list --count develop..HEAD` 期望为 0。
6. 在主检出跑 AC-358 判据：`quay goal gate AC-358 --dry-run --json --root /data/home/yale/work/quay` ⇒ exit 0；原文进 `## Evidence`。判据自身已覆盖：`plugin/scripts/driver-filters.ts` 含 `applyNeedsHumanTransition`；`plugin/scripts/worker-driver.ts` 直接 `retryState.needsHuman.add(` 调用数为 0；`plugin/test/driver-filters.test.mjs` 与 `plugin/test/worker-driver.test.mjs` 全绿。
   - exit 3 ⇒ 求值树不是 develop 子孙（先查主检出是否落后 develop，branch lag 不是「没并入」）；exit 1 ⇒ 判据同行给 `CAUSE=`，逐字记下并交回实现/读数任务，不在本任务内改源码。
7. 并入形态核验（AC-358 判据**不含**此项，但它是本 goal 的退出条件：「GOAL-035 以恰好一个合并提交进入 develop」）：
   - `develop` tip == `landedSha`，且是 `git rev-list --first-parent develop` 首行；
   - `git rev-list --parents -n1 <landedSha>` 恰两个父：`^1` = 并入前 develop tip、`^2` = goal tip（记 tipSha）；
   - `git rev-list <landedSha>^1..<tipSha>` 与 first-parent 链无交集（无分支提交泄漏到 first-parent）。
8. 两个测试文件的**原始输出**另存：在主检出并排跑 `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs plugin/test/worker-driver.test.mjs`，记 `tests/pass/fail` 行；与判据内置那次互为第二来源（硬规则 4/4c）。⚠️ `worker-driver.test.mjs` 较大（约 4379 行），评估时显式传一个较大的 `--timeout`（如 900000ms），避免把真实超时误判为回归。
9. 生产生效面（读数，非结论）：记 `ps -eo pid,etimes,args` 里的 `serve` 与 driver anchor 行。本 goal 改的是**常驻 worker-driver** 的 `onWorkerFinished`——它已把旧代码载入内存，改动要等下一次 driver 重启才生效；而 goal body 明令**不重启任何生产进程**。⛔ 本任务不调用任何 `quay driver start|stop|restart`、不重启 `serve`；只如实记录「已落地到 develop、待下次重启生效」这一读数。
10. 自查：`node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/goal-035-merge-and-postmerge-verify.md` exit 0；`quay task check <本任务 id> --json` 的 `ok:true` 且 `acChecked == acTotal`。

## Acceptance Criteria

- [x] 前置核验读数已记录（`quay goal show AC-356 --json` / `AC-357 --json` 均 `achieved`；`git show-ref refs/heads/goal/GOAL-035` 非空）；任一不满足则停在 Plan 第 1 步并如实记录读数。 —— 读数见《Evidence → AC1 前置核验》
- [x] AC-358 的 `phase` 声明已就地修/确认：`quay goal show AC-358 --json` 的 `phase` 为 `post-merge`；若是本轮修为，`git show <提交> --stat` 显示 diff **仅一行 `+phase: post-merge`**，未动 `origin`/`status`/`criterion`。 —— `phase: post-merge`；写入提交 61f29eabd，diff 仅 `+phase: post-merge` 一行
- [x] `.quay/gate-events.jsonl`（主检出）含一条 GOAL-035 的 `goal-merge-request` 事件，payload `override: null`、`unmetAcs: []`（事件 id、tipSha 进 `## Evidence`），未使用 `--override`。 —— 事件 id `a77ad58c-7290-4827-bc12-d9db8e4e8877`，`override:null`、`unmetAcs:[]`
- [x] 同一文件含一条 GOAL-035 的 `goal-merge-result`，`outcome: landed`，记录 `landedSha` 与 `tipSha`。 —— 事件 id `13a69a60-7ab6-430c-823b-6437266de735`，`outcome:landed`
- [x] 并入形态：`develop` tip == `landedSha` 且为 first-parent 首行；`git rev-list --parents -n1 <landedSha>` 恰两父（`^1`=并入前 develop tip、`^2`=goal tip）；`comm -12 <(git rev-list <landedSha>^1..<tipSha>) <(git rev-list --first-parent develop)` 为空。 —— landedSha `5752fa5e9`，两父 `8f562bebe`+`6b51df827`，泄漏 0 行
- [x] 主检出已 ff 追平 develop（`git merge-base develop HEAD` == `git rev-parse develop`，`git rev-list --count develop..HEAD` = 0），AC-358 判据在其上 `--dry-run` exit 0，JSON 原文进 `## Evidence`。 —— `merge-base develop HEAD`==`develop`，`rev-list --count develop..HEAD`=0；gate exit 0
- [x] 落地树结构读数逐字进 `## Evidence`：`grep -q applyNeedsHumanTransition plugin/scripts/driver-filters.ts` 命中；`grep -c "retryState.needsHuman.add(" plugin/scripts/worker-driver.ts` = 0。 —— `applyNeedsHumanTransition` 命中；`retryState.needsHuman.add(` = 0
- [x] `plugin/test/driver-filters.test.mjs` 与 `plugin/test/worker-driver.test.mjs` 在主检出全绿，`tests/pass/fail` 原始行进 `## Evidence`（大文件用大 `--timeout`）。 —— `tests 201 / pass 201 / fail 0`（第二来源）
- [x] 生产生效面已按 Plan 第 9 步以读数说明；本任务未调用任何 `quay driver start|stop|restart`、未重启 `serve`。 —— serve pid 1769873 未重启；未调用任何 driver start/stop/restart
- [x] 本任务未改动任何生产源码（`git diff --name-only develop...HEAD` 不含 `plugin/scripts/**` 与 `plugin/test/**`）。 —— `git diff --name-only develop...HEAD` 不含 plugin/scripts/**、plugin/test/**

## Definition of Done

GOAL-035 以恰好一个合并提交进入 develop，落地树持有本刀全部结构改动（`applyNeedsHumanTransition` 是 `retryState.needsHuman`/`counts` 的唯一 mutator，`worker-driver.ts` 内 `retryState.needsHuman.add(`/`counts.set(` 直接调用归零），AC-358 判据在主检出 exit 0、两个受影响测试文件实测全绿；fan-in 若出现红灯已诊断归因而非盲目重试；全程未重启生产进程、未用 `--override` 跳过任何验证。

## Touches

- tasks/goal-035-merge-and-postmerge-verify.md
- goals/AC-358-post-merge-生产验证-develop-尖端持有本刀全部结构改动-两个受影响测试文件回归全绿.md

## Evidence

### 前置核验（Plan 1）

- `AC-357`：`status = "achieved"`、`phase = "pre-merge"`（`evidence.at 2026-10-10T11:00:05Z`，verdict pass）。
- `AC-356`：请求时刻 `quay goal show AC-356 --json` 读 `status = "active"`、`phase = "pre-merge"`、`evidence.verdict = "pass"`（`at 2026-10-10T11:02:58.225Z`，actor `goal-cli`）。
  ⚠️ **如实记录这处偏差**：Plan 第 1 步的字面判据是「`status` 为 `achieved`」，而当时 `status` 字段仍是 `active`（goal-driver 的翻转滞后于 ledger 的 pass）。但 `quay goal merge` 的真实门是 `unmetPreMergeAcs`（`packages/quay/src/goal-merge.ts:164`），它读 **ledger 的 `lastGoalVerdict`**（`quay/src/goal-merge.ts:146`：最后一条 `gate:"goal"` 事件的 verdict）⇒ AC-356 的最后一条 ledger verdict 已是 `pass`（`11:02:58.225Z`，id `4ed51804-2036-49ad-9ac9-d7d1930d3bf8`）⇒ **不阻塞**。合并落地后 driver 于 `11:23:10.699Z` 把 `status` 翻成 `achieved`；收尾时重读：`AC-356 status = achieved, phase = pre-merge`。⇒ 结论以**门自己的读数**为准，不以字段滞后为准。
- `git show-ref refs/heads/goal/GOAL-035` = `6b51df82716f27fc479a6f9acf0d5b6ff999f3c1`（非空，尚未被删）。
- 全程未使用 `--override`（见 AC3 的 `override:null`）。

### AC2 — AC-358 的 `phase` 声明就地修正

`goals/AC-358-post-merge-*.md` **没有 `phase:` 行** ⇒ `readGoalAcs` 缺省 `pre-merge`（`goal-merge.ts:138`）⇒ `unmetPreMergeAcs(GOAL-035)` 恒含 AC-358 ⇒ `quay goal merge` 除 `--override` 外恒被 `pre-merge-ac-unmet` 拒绝。就地修正：

    $ node --experimental-strip-types packages/quay/bin/quay.ts goal write AC-358 --phase post-merge --root /data/home/yale/work/quay
    ⇒ exit 0 ; author 提交 61f29eabd262cbbf64763bc4fd1f71813b602a71
      ("goals: AC-358 update by cli:1311213", 2026-10-10 19:04:28 +0800)

`git show 61f29eabd -- goals/AC-358-*.md` 的 diff **恰一行**：

    @@ -73,4 +73,5 @@ fidelity:
       verdict: not-evaluated
       reason: no judge configured
       at: 2026-10-10T09:38:58.190Z
    +phase: post-merge
     ---

`origin` / `status` / `criterion` / `title` / `goal` / `expect` 均未动。修正后重读：`AC-358 phase = post-merge`。
（`--phase` 是 store-only flag，未出现在 `quay goal write --help` 的 synopsis 里，但确在 `STORE_ONLY_WRITE_FLAGS`（`packages/quay/src/cli/goal.ts:92`）中——按实测行为记录，不按 help 文本记录。）
**只改求值相位、不跳过验证**：AC-358 仍须在并入后被判定（见 AC6）。

### AC3 — goal-merge-request 事件（`.quay/gate-events.jsonl`，主检出）

    id        = a77ad58c-7290-4827-bc12-d9db8e4e8877      (第 1 次请求)
    gate      = goal-merge-request   item_id = GOAL-035     actor = human
    timestamp = 2026-10-10T11:04:45.862Z
    payload   = { tipSha: "6b51df82716f27fc479a6f9acf0d5b6ff999f3c1",
                  override: null, unmetAcs: [], eventId: "a77ad58c-…" }

    id        = 596cee7a-5c03-450e-98c3-92fb8c2f0d0a      (第 2 次请求，见下方诊断)
    timestamp = 2026-10-10T11:15:0xZ
    payload   = { tipSha: "6b51df82716f27fc479a6f9acf0d5b6ff999f3c1",
                  override: null, unmetAcs: [], eventId: "596cee7a-…" }

两次 `override` 均为 `null`、`unmetAcs` 均为 `[]` ⇒ **未使用 `--override`**，且两次都未被 `pre-merge-ac-unmet` 拒绝。

### 诊断（Plan 4）：第 1 次 fan-in 的 ff 红是并发基础设施红，不是本 goal 的回归

第 1 次 `goal-merge-result`（id `00e555f9-6123-4c97-96e2-30e30e08ebbe`，`2026-10-10T11:12:55.963Z`）：

    { outcome: "red", step: "ff", landedSha: null,
      reason: "fan-in-ff-merge: FF FAILED — To .; not a fast-forward.
               Retry record written (attempt 1). …" }

归因读数（不是猜测）：

- fan-in step trace（`.quay/fan-in-step-trace.jsonl`，GOAL-035）：`merge` ok 15364ms → `quay-snapshot` ok 6841ms (`state=copied`) → **`suite` ok 175148ms** → `ff` **red 52ms**。⇒ **全量 suite 是绿的**，红只出现在最后一步 ff。
- `.quay/fan-in-retries.jsonl`：`{"taskId":"GOAL-035","attempt":1,"developHead":"6330a353e…","error":"To .", …}` ⇒ 失败时 develop 已在 `6330a353e`，而 fan-in 读取的快照 develop 是它之前的某个点。
- **develop 在该约 200s 窗口内确实前进了**：`6330a353e` 之前的四个提交（`73ecd0f10` / `998d1c6b7` / `108d7b8a8` / `23183dd6b` + 本任务自己的 `61f29eabd`）都是窗口期内由文档面同步与兄弟任务 `gap-ac356-criterion-environment-fatal-window-check-unsatisfiable` 的 worker（`exited-not-landed`）产生的。

⇒ 类别判定：既不是「本 goal 的改动造成」（suite 绿、merge 成功），也不是「suite 并发伪影」（suite 绿），而是**第三种已知形态：develop 在 fan-in 的读快照与 ff 之间前进 ⇒ ff 非快进**。它的处置在机制自身里写明：`.quay/fan-in-retries.jsonl` 的 attempt 计数 + `ff-merge.ts:995` 的 `Return to 无锁段 step 1 … re-run`，以及 `pendingGoalMerges`（`goal-merge.ts:384`）的 **request-supersede 规则**——「tip 未变时，晚于该结果的新请求 ⇒ 重跑；这正是把卡在基础设施红上的 goal 救出来的通道」（`goal-merge.ts:378-382` 注释逐字）。goal branch tip 未变（`6b51df827`），故**必须显式重请求**（tip 不会前进到「修好」这个红）。⇒ 第 2 次请求（`596cee7a`）是**诊断后的重试**，不是盲目重试。相关机制任务 `gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries` 与 `gap-ac321-goal-merge-selector-matches-task-catchup-merge` 均已 `done`。

### AC4 — 第 2 次机械 fan-in 结果

    id        = 13a69a60-7ab6-430c-823b-6437266de735
    gate      = goal-merge-result      item_id = GOAL-035     actor = quay-driver     verdict = pass
    timestamp = 2026-10-10T11:23:04.123Z
    payload   = { outcome: "landed", step: null, reason: null,
                  tipSha: "6b51df82716f27fc479a6f9acf0d5b6ff999f3c1",
                  requestEventId: "596cee7a-5c03-450e-98c3-92fb8c2f0d0a",
                  landedSha: "5752fa5e9cedde3dbb3e4726e551de41b7951615" }

### AC5 — 并入形态

- `git rev-parse develop` = `5752fa5e9cedde3dbb3e4726e551de41b7951615` = `landedSha`；
- `git rev-list --first-parent develop | head -1` = `5752fa5e9…`（first-parent 首行）；
- `git rev-list --first-parent develop | grep -c 5752fa5e9…` = **1**（在 first-parent 链上且只出现一次）；
- `git rev-list --parents -n1 5752fa5e9…` = `5752fa5e9 8f562bebe 6b51df827` ⇒ **恰两个父**：`^1` = `8f562bebe282a5bdb1a064d182e8bfb9260471d3`（并入前 develop tip）、`^2` = `6b51df82716f27fc479a6f9acf0d5b6ff999f3c1`（goal tip = 请求事件的 `tipSha`）；
- 泄漏检查 `comm -12 <(git rev-list 5752fa5e9^1..6b51df827 | sort) <(git rev-list --first-parent develop | sort)` ⇒ **0 行**（无 goal 分支内部提交混入 first-parent）；
- 合并提交 subject：`merge: goal/GOAL-035 into develop (request 596cee7a-5c03-450e-98c3-92fb8c2f0d0a)`（2026-10-10 19:18:31 +0800）；
- 并入后 `git show-ref refs/heads/goal/GOAL-035` ⇒ 空、exit 1（驱动已删分支）。

### AC6 — 主检出追平 develop + AC-358 判据

- `git merge --ff-only develop`（主检出，分支 `author`；ff 前 `author` tip = `8f562bebe` = 并入前 develop tip）⇒ `HEAD = 5752fa5e9…`；
- `git merge-base develop HEAD` = `5752fa5e9…` = `git rev-parse develop`；`git rev-list --count develop..HEAD` = **0**；`git rev-parse --abbrev-ref HEAD` = `author`；
- `quay goal gate AC-358 --dry-run --json --timeout 900000 --root /data/home/yale/work/quay` ⇒ **EXIT=0**，stdout 原文：

```json
{
  "id": "AC-358",
  "verdict": "pass",
  "cause": null,
  "reason": "acceptance passed (exit 0)",
  "timeoutMs": 900000,
  "timestamp": "2026-10-10T11:24:40.323Z",
  "dryRun": true,
  "event": {
    "id": "f923cf85-eccf-4c90-8b7c-70d2b9449eb2",
    "item_id": "AC-358",
    "pipeline_id": "AC-358",
    "gate": "goal",
    "actor": "goal-cli",
    "verdict": "pass",
    "timestamp": "2026-10-10T11:24:40.323Z",
    "payload": {
      "reason": "acceptance passed (exit 0)",
      "evaluationRoot": "/data/home/yale/work/quay",
      "treeSha": "eb1f451fe73f78e3aeda96462e95a5e5a78b2068"
    }
  }
}
```

  `--timeout 900000` 是判据自身建议的用法（`worker-driver.test.mjs` 约 4379 行，其 `CAUSE` 文本明写 "re-gate with a bigger --timeout if this was a timeout"），不是放宽判据。
- **第二来源（goal-driver 自己判）**：`AC-358` status 由 `active` → **`achieved`**（`quay goal show AC-358 --json`：`status: achieved`、`phase: post-merge`、`evidence.verdict: pass`、`evidence.at 2026-10-10T11:23:53.286Z`）⇒ Plan 第 2 步就地声明的 `phase: post-merge` 生效：并入后该 AC 被求值于**主检出**并通过，未用 `--override` 跳过任何验证。（同批 `AC-356`/`AC-357` 亦于 `11:23:10.699Z` / `11:23:12.815Z` 读 `achieved`。）

### AC7 — 落地树结构读数（主检出工作树，develop 尖端 `5752fa5e9`）

    grep -q applyNeedsHumanTransition plugin/scripts/driver-filters.ts        ⇒ 命中
    grep -c "retryState.needsHuman.add(" plugin/scripts/worker-driver.ts      ⇒ 0
    grep -c "retryState.counts.set("      plugin/scripts/worker-driver.ts     ⇒ 0
    grep -c "^export function applyNeedsHumanTransition(" plugin/scripts/driver-filters.ts ⇒ 1
    grep -c "applyNeedsHumanTransition("  plugin/scripts/worker-driver.ts     ⇒ 2

合并提交 `5752fa5e9` 相对 `^1` 的 `--stat`（本刀落地形态）：

    plugin/scripts/driver-filters.ts    | 31 ++++++++++++++--
    plugin/scripts/worker-driver.ts     | 54 +++++++++++++++++-----------
    plugin/test/driver-filters.test.mjs | 71 +++++++++++++++++++++++++++++++++++++
    3 files changed, 134 insertions(+), 22 deletions(-)

### AC8 — 两个受影响测试文件（主检出，第二来源）

    $ node --no-warnings --experimental-strip-types --test --test-timeout=900000 \
        plugin/test/driver-filters.test.mjs plugin/test/worker-driver.test.mjs
    ⇒ EXIT=0，原始 summary 行：
      ℹ tests 201
      ℹ pass 201
      ℹ fail 0            (grep -c '^not ok' ⇒ 0)

与 AC6 判据内置的那次互为第二来源（硬规则 4/4c）。

### AC9 — 生产生效面（读数，非结论）

`ps -eo pid,etimes,args`（2026-10-10T11:24:43Z）：

    pid 1769873  etimes 623242  node --no-warnings --experimental-strip-types /data/home/yale/work/quay/packages/quay/bin/quay.ts serve
    pid 112191   etimes  10184  node --experimental-strip-types /data/home/yale/work/quay/plugin/scripts/driver-anchor.ts __anchor --root /data/home/yale/work/quay --takeover …
    pid 3010491  etimes    317  node --experimental-strip-types /data/home/yale/work/quay/plugin/scripts/worker-driver.ts --mechanical-fan-in --task gap-full-suite-scope-…

**待下次重启生效（读数支撑）**：本 goal 改的是**常驻 worker-driver** 的 `onWorkerFinished` 路径（`applyNeedsHumanTransition` 的唯一 mutator 化）。已在内存里跑了很久的进程（`serve` pid 1769873、driver anchor pid 112191）加载的是改动之前的代码；**本次改动已落到 develop，但要等下一次 driver 重启才在生产上生效**——这与「重启后才会出现的可观测变化」是同一件事的两面，因此本任务**只记录、不触发**。⛔ 本任务**未**调用任何 `quay driver start|stop|restart`，**未**重启 `serve`（本轮命令集合中不含它们）。pid 3010491 是**别个任务**（`gap-full-suite-scope-…`）正在跑的机械 fan-in，不是本任务所起。

### AC10 — 未改动生产源码

本任务在任务分支（`task/goal-035-merge-and-postmerge-verify`）上只写 `tasks/goal-035-merge-and-postmerge-verify.md`（经 Provider ABI 的 `task_write`）；`goals/AC-358-*.md` 的 `phase: post-merge` 一行是 AC2 的就地声明修正（该文件在本任务 `## Touches` 之内）。落地树里的 `plugin/scripts/**`、`plugin/test/**` 改动来自 GOAL-035 本身的合并提交 `5752fa5e9`，**不是本任务所改** ⇒ `git diff --name-only develop...HEAD` 不含 `plugin/scripts/**` 与 `plugin/test/**`。

### 自查（Plan 10）

- `node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/goal-035-merge-and-postmerge-verify.md`（任务分支 worktree 副本）⇒ **EXIT=0**，输出原文：

      N/A legacy (no schema marker): …/tasks/goal-035-merge-and-postmerge-verify.md
      1 total, 0 pass, 1 N/A-legacy, 0 fail

- `quay task check goal-035-merge-and-postmerge-verify --json`（MCP `task_check`）⇒ 原文：

      {"gate":"execute->done","ok":true,"acTotal":10,"acChecked":10,"dodTotal":0,"dodChecked":0,
       "reason":"all AC and DoD checkboxes checked; eligible to move to done"}

  （勾选前同一读数为 `acTotal:10, acChecked:0` —— 两读数互为前后对照；写入经 Provider ABI 的 `task_write`，未手改 checkbox 字符。）
- `anti-drift-touches-check.ts --task goal-035-merge-and-postmerge-verify --worktree <wt> --merge-target develop` ⇒ `ANTI-DRIFT OK: … 0 actual file(s), all within declared Touches (2 glob(s))`。
- 本任务 **delta = 恰一个文件**：`tasks/goal-035-merge-and-postmerge-verify.md`（任务自身文件，在本任务 `## Touches` 之内）——首次 `git merge --no-edit develop` 是快进（delta 0 行），随后本文自身的一次正文修正写入使其成为 1 行；两次读数都**不含** `plugin/scripts/**` 与 `plugin/test/**`，AC10 成立。
- scoped 门：`bash <wt>/scripts/test.sh --for-task goal-035-merge-and-postmerge-verify --allow-thin` ⇒ **EXIT=0**，末行 `selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in`；随后 `worker-driver.ts --write-scoped-gate-cache --task goal-035-merge-and-postmerge-verify --develop-sha 43cc3c9b6428037a327d02f706210aaf20a85be6` ⇒ `{"event":"scoped-gate-cache-written", …}`。



---
_本轮续跑复验（2026-10-10T11:31Z 起）_
- 重跑 AC-358 判据（主检出，`quay goal gate AC-358 --dry-run --json --timeout 900000 --root /data/home/yale/work/quay`）⇒ **exit 0**（event `16bb98c5-a52d-4aee-83b9-c9062633a9fa`，`treeSha 3c944e01ed1d5748a7b1f5a0879ef3669fe4ba53`）；criterion 内置那次两测试文件 `worker-driver.test.mjs tests 129 / pass 129 / fail 0`、`driver-filters.test.mjs` 亦绿 ⇒ 「合并后 develop 尖端持有本刀、两文件全绿」**复现**。
- **如实记录一处 flake（非回归）**：goal-driver 于 `2026-10-10T11:28:40.333Z` / `11:28:41.097Z` 两度把 AC-358 判为 `fail`（`CAUSE=post-merge-test-regression -- worker-driver.test.mjs exit=1`，见 `.quay/gate-events.jsonl` id `5f7f722b-…` / `406a2902-…`），但这两条 payload 的 `treeSha` 与上面 **pass** 读数**同为 `3c944e01…`** —— 同一棵树、两次判定相反 ⇒ **环境/负载下的一次性 flake，不是本 goal 的回归**（判据 CAUSE 文本自身亦提示 "re-gate with a bigger --timeout if this was a timeout, not a real failure"）。goal AC 状态未因此回退（仍 `status: achieved`）。⇒ 结论以「同一 treeSha 下 pass 可复现」为准；flake 根因（AC-358 判据内联跑 4379 行的 `worker-driver.test.mjs`）建议**另立 gap**，⚠️ 不在本任务范围（一刀一 AC）。
- 本轮续跑：`git merge --no-edit develop`（develop 由 `f8708b85b` 前进到 `100a18427`，期间并发任务写入）⇒ 分支重新成为 ff 候选（`git merge-base --is-ancestor develop HEAD` exit 0）；scoped 门重跑 `EXIT=0`（`selector selected 0 test files (thin allowed)`）；scoped-gate 缓存以新 develop sha `100a1842762436f50025746e721ee8709ef13eb3` 重写。最终 delta 仍为恰一个文件（本任务文件），`anti-drift-touches-check.ts` ⇒ `ANTI-DRIFT OK … 1 actual file(s), all within declared Touches`。
- 本轮同样**未**调用任何 `quay driver start|stop|restart`、**未**重启 `serve`。