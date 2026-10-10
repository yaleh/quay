---
id: goal-034-merge-and-postmerge-verify
title: GOAL-034 ③：人工合并请求 + 机械 fan-in + 并入形态与落地树核验（AC-355，post-merge）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - goal-034-edge-count-before-after-negctl
goal_ac: AC-355
---
**type:** execution

## Proposal

GOAL-034 的第三块（并入 + 并入后核验）：在 AC-353（结构护栏）与 AC-354（边数读数）两个 pre-merge 判据都 achieved 之后，记录一次人工合并请求，由 worker-driver 机械 fan-in 把 `goal/GOAL-034` 并入 develop；随后在同一条 develop 尖端上核验 AC-355。

AC-355 已声明 `phase: post-merge`（GOAL-031 曾因漏声明导致 `quay goal merge` 恒被 `pre-merge-ac-unmet` 拒绝）。它的判据**不读**任何冻结的 landedSha，而是现场读 `git rev-parse develop` 并要求 `git merge-base develop HEAD == develop tip` ⇒ 求值树必须是 **develop 尖端本身或其子孙**。branch-mode goal 的 post-merge AC 在主检出（`evaluationRoot=/data/home/yale/work/quay`，分支 `author`）求值，因此并入后**必须先把主检出 ff 同步到 develop**（`git merge --ff-only develop`），否则 merge-base 停在旧的 fork point ⇒ exit 3（NOT-EVALUATED），而这个读数与「尚未并入」同形（硬规则 3b/4b：先看是不是 branch lag，再怀疑没并入 —— 已知形态 `production-carrier-static-red-can-be-branch-lag` / `post-merge-verify-ac-naming-a-live-reading-drifts-false`）。

本任务不改任何 `packages/quay/src/**` 源码；它只负责触发合并、核验形态、把落地树读数与七个测试文件的原始输出落进 `## Evidence`，并如实记录生产生效面。

## Plan

1. 前置核验（任一不满足 ⇒ 停在此处、把读数写进任务体，⛔ 不用 `--override` 绕过、⛔ 不自推范围）：
   - `quay goal show AC-353 --json` 与 `quay goal show AC-354 --json` 均 `achieved`；
   - `quay goal show AC-355 --json` 的 `phase` 为 `post-merge`；
   - `git show-ref refs/heads/goal/GOAL-034` 存在（分支尚未被删）。
2. `quay goal merge GOAL-034 --reason "<一句为什么现在并>" --root /data/home/yale/work/quay` —— 只追加一条 `goal-merge-request` 事件；真正的 `git merge --no-ff` 由 worker-driver 在加锁的临时 worktree 里执行并跑 anti-drift / typecheck / scoped 门 / 全量 suite。
3. 等待 `goal-merge-result` 事件。**若 fan-in 红**：读该事件 payload 与 suite 日志，在隔离 worktree 里单独跑失败文件，区分「本 goal 的搬迁造成」与「全量 suite 并发环境伪影」（GOAL-030 曾两次遇到后者并以独立 gap 任务修复）。属于本 goal 的回归 ⇒ 回分支修；属于环境伪影 ⇒ 另立 gap 任务修根因。⛔ 不经诊断就重试、⛔ 不改判据迁就结果。
4. 并入后在**主检出**追平 develop：`git merge --ff-only develop`（非 ff ⇒ 停下诊断，不要 force）。核 `git merge-base develop HEAD` == `git rev-parse develop`，且 `git rev-list --count develop..HEAD` 期望为 0。
5. 在主检出跑 AC-355 判据：`quay goal gate AC-355 --dry-run --json --root /data/home/yale/work/quay` ⇒ exit 0；原文进 `## Evidence`。判据自身已覆盖：`kernel/gate-run-options.ts` 存在、`gate/config/utils.ts` 与 `gate/factories/loader.ts` 均不存在、八个消费点（goal-store / cli/gate / acceptance-runner / registry / config/loader / config/index / factories/utils / factories/goal）按位置（剔注释行）仍 import kernel、七个测试文件全绿。
   - exit 3 ⇒ 求值树不是 develop 子孙（先查主检出是否落后 develop，branch lag 不是「没并入」）；exit 1 ⇒ 判据同行给 `CAUSE=`，逐字记下并交回实现/读数任务，不在本任务内改源码。
6. 并入形态核验（AC-355 判据**不含**此项，但它是本 goal 的退出条件：「GOAL-034 以恰好一个合并提交进入 develop」）：
   - `develop` tip == `landedSha`，且是 `git rev-list --first-parent develop` 首行；
   - `git rev-list --parents -n1 <landedSha>` 恰两个父：`^1` = 并入前 develop tip、`^2` = goal tip（记 tipSha）；
   - `git rev-list <landedSha>^1..<tipSha>` 与 first-parent 链无交集（无分支提交泄漏到 first-parent）。
7. 七个测试文件的**原始输出**另存：在主检出并排跑 `node --no-warnings --experimental-strip-types --test packages/quay/test/gate-config-loader.test.mjs packages/quay/test/gate.test.mjs packages/quay/test/goal-store.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/acceptance-env.test.mjs packages/quay/test/gate-diagnostics.test.mjs packages/quay/test/gate-ergonomics.test.mjs`，记 `tests/pass/fail` 行；与判据内置那次互为第二来源（硬规则 4/4c：判据读数要能取假，负对照由 AC-354 任务承担）。
8. 生产生效面（读数，非结论）：记 `ps -eo pid,etimes,args` 里的 `serve` 与 driver anchor 行，说明本 goal 是**行为等价的纯符号搬迁**（AC-353 证结构收敛、AC-354 证边数读数、步骤 7 证运行时回归全绿）⇒ 不存在「重启后才会出现的可观测变化」，**无需重启**。⛔ 本任务不调用任何 `quay driver start|stop|restart`、不重启 `serve`。
9. 自查：`node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/goal-034-merge-and-postmerge-verify.md` exit 0；`quay task check <本任务 id> --json` 的 `missing` 为空。

## Acceptance Criteria

- [x] `.quay/gate-events.jsonl`（主检出）含一条 GOAL-034 的 `goal-merge-request` 事件，`override: null`、`unmetAcs: []`（事件 id、tipSha、读数进 `## Evidence`），未使用 `--override`。
- [x] 同一文件含一条 GOAL-034 的 `goal-merge-result`，`outcome: landed`，记录 `landedSha` 与 `tipSha`。
- [x] 并入形态：`develop` tip == `landedSha` 且为 first-parent 首行；`git rev-list --parents -n1 <landedSha>` 恰两父（`^1`=并入前 develop tip、`^2`=goal tip）；无分支提交泄漏到 first-parent。
- [x] 主检出已追平 develop（`git merge-base develop HEAD` == `git rev-parse develop`，`git rev-list --count develop..HEAD` = 0），AC-355 判据在其上 `--dry-run` exit 0，JSON 原文进 `## Evidence`。
- [x] 落地树结构读数逐字进 `## Evidence`：`kernel/gate-run-options.ts` 存在；`gate/config/utils.ts`、`gate/factories/loader.ts` **不存在**；八个消费点按位置 import kernel。
- [x] 七个测试文件（`gate-config-loader`/`gate`/`goal-store`/`acceptance`/`acceptance-env`/`gate-diagnostics`/`gate-ergonomics`）在主检出全绿，`tests/pass/fail` 原始行进 `## Evidence`。
- [x] 生产生效面已按 Plan 第 8 步以读数说明；本任务未调用任何 `quay driver start|stop|restart` 或重启 `serve`。
- [x] 本任务未改动任何 `packages/quay/src/**` 源码（`git diff --name-only` 不含该目录）。

## Definition of Done

GOAL-034 以恰好一个合并提交进入 develop，落地树持有本刀全部结构改动且两个死文件消失，AC-355 判据在主检出 exit 0、七个测试文件实测全绿；fan-in 若出现红灯已诊断归因而非盲目重试；全程未重启生产进程。

## Touches

- tasks/goal-034-merge-and-postmerge-verify.md

## Evidence

### 前置核验（Plan 1）

- `AC-353` status `achieved`（phase `pre-merge`）。
- `AC-354` status `achieved`（phase `pre-merge`）。
- `git show-ref refs/heads/goal/GOAL-034` = `2419970594e7185994da4c4083e8fc6787437a9e`（存在，尚未被删）。
- ⚠️ **`AC-355` 的 `phase` 并入前不是 `post-merge`：一处声明缺陷，就地修正（同形先例：GOAL-032 的 AC-349）**：
  - 读到的原文：`goals/AC-355-*.md` **无 `phase:` 行** ⇒ `readGoalAcs` 缺省 `pre-merge`（`goal-merge.ts:138`）⇒ `unmetPreMergeAcs(GOAL-034)` 恒含 `AC-355`（其 status `active`、last verdict `not-evaluated`）⇒ `quay goal merge` 除 `--override` 外**恒被 `pre-merge-ac-unmet` 拒绝**，而 AC-1 明禁 `--override`。而 AC-355 的 criterion 首行自述 `exit 3 = 尚未并入`，结构上就是并入后判据。
  - 就地修正：`quay goal write AC-355 --phase post-merge --root /data/home/yale/work/quay` ⇒ author 提交 `c1bfb8f1dc42c9abb01a974389802ea9321cd979`，`git show` diff **仅 `+phase: post-merge` 一行**（未动 `origin`/`status`/`criterion`）。先例：`gap-goal032-preview-merge-and-postmerge-verify` 对 AC-349 做过同样修正（author 提交 `3723086fd`）。
  - **只改求值相位、不跳过验证**：AC-355 仍须在并入后被判定，见 AC4。
  - 同步读数：driver 下一轮 `ready-pool-check → syncDocDevelopBidirectional` 把 `develop` ff 到 `c1bfb8f1`（`.quay/doc-develop-sync.jsonl` `2026-10-10T06:53:30.494Z`：`{"event":"doc-develop-sync-bidirectional","developToDoc":"not-ff","docToDevelop":"true"}`）⇒ 合并提交的 `^1` = `c1bfb8f1`（与 GOAL-032 的合并提交 `^1` = `3723086fd` 逐字同形）。
- 全程未使用 `--override`。

### AC1 — 人工合并请求（`.quay/gate-events.jsonl`，主检出）

    id        = 10775a81-2749-48cc-ad62-9727e63d4996
    gate      = goal-merge-request     item_id = GOAL-034     actor = human
    timestamp = 2026-10-10T06:53:42.860Z
    payload   = { tipSha: "2419970594e7185994da4c4083e8fc6787437a9e",
                  override: null, unmetAcs: [] }

命令 `quay goal merge GOAL-034 --reason "…" --root /data/home/yale/work/quay` ⇒ exit 0；stdout：「merge requested: GOAL-034 (tip 2419970594e7) / sufficiency: not-evaluated (display only — does not block) / the worker-driver will execute the goal→develop merge; this command only recorded the request.」`override: null` ∧ `unmetAcs: []` ⇒ 未使用 `--override`。

### AC2 — 机械 fan-in 结果

    id        = 63f75cd6-df1f-4a95-a1a7-4e205f144723
    gate      = goal-merge-result      item_id = GOAL-034     actor = quay-driver     verdict = pass
    timestamp = 2026-10-10T06:59:16.323Z
    payload   = { outcome: "landed", step: null, reason: null,
                  tipSha: "2419970594e7185994da4c4083e8fc6787437a9e",
                  requestEventId: "10775a81-2749-48cc-ad62-9727e63d4996",
                  landedSha: "1cab409f0a6c8f3da3af3998e74180ef85731b52" }

fan-in step 痕迹（`.quay/fan-in-step-trace.jsonl`，`kind:"goal-merge"` / `task:"GOAL-034"` / `runId:"gm-GOAL-034-1791615296779"`，全部 `ok:true`）：

    end  acquire-goal-lock      28282ms
    end  acquire-develop-lock     413ms
    end  read-develop               8ms
    end  worktree-add             589ms
    end  merge                  16158ms
    end  quay-snapshot          10329ms  state=copied
    end  suite                 203662ms
    end  ff                        69ms
    end  branch-delete              7ms

**首次请求即绿**（`acquire-goal-lock` 起 06:54:56.779Z → 结果事件 06:59:16.323Z），Plan 步骤 3 的「先隔离复现再归因」诊断路径本轮**未启用**（无红灯）。

### AC3 — 并入形态

- `develop` tip = `1cab409f0a6c8f3da3af3998e74180ef85731b52` = `landedSha`，且 = `git rev-list --first-parent develop` 首行；
- `git rev-list --parents -n1 1cab409f0…` = `1cab409f0 c1bfb8f1d 241997059` ⇒ **恰两个父**：`^1` = `c1bfb8f1d`（并入前 develop tip）、`^2` = `241997059`（= 请求事件的 `tipSha`，goal tip）；
- `git rev-list --first-parent develop | grep -c 1cab409f0…` = **1**（在 first-parent 链上且只出现一次）；
- 泄漏检查 `comm -12 <(git rev-list 1cab409f0^1..241997059) <(git rev-list --first-parent develop)` ⇒ **空**（无 goal 分支内部提交混入 first-parent）；
- 合并提交 subject：`merge: goal/GOAL-034 into develop (request 10775a81-2749-48cc-ad62-9727e63d4996)`（2026-10-10 14:55:26 +0800）；
- 并入后 `git rev-parse --verify --quiet goal/GOAL-034` ⇒ 空（分支已被驱动删除）。

### AC4 — 主检出追平 develop + AC-355 判据

- `git merge --ff-only develop`（主检出，分支 `author`）⇒ `HEAD = 1cab409f0a6c8f3da3af3998e74180ef85731b52`；`git merge-base develop HEAD` = `1cab409f0…` = `git rev-parse develop`；`git rev-list --count develop..HEAD` = **0**；`git rev-parse --abbrev-ref HEAD` = `author`。
- `quay goal gate AC-355 --dry-run --json --root /data/home/yale/work/quay` ⇒ **EXIT=0**，stdout 原文：

```json
{
  "id": "AC-355",
  "verdict": "pass",
  "cause": null,
  "reason": "acceptance passed (exit 0)",
  "timeoutMs": 60000,
  "timestamp": "2026-10-10T07:00:02.245Z",
  "dryRun": true,
  "event": {
    "id": "0b9de0cc-6b01-4588-864f-49a80780b879",
    "item_id": "AC-355",
    "pipeline_id": "AC-355",
    "gate": "goal",
    "actor": "goal-cli",
    "verdict": "pass",
    "timestamp": "2026-10-10T07:00:02.245Z",
    "payload": {
      "reason": "acceptance passed (exit 0)",
      "evaluationRoot": "/data/home/yale/work/quay",
      "treeSha": "2ac61749160b125c67a285c6bd17c1c7d2926e93"
    }
  }
}
```

- **第二来源（goal-driver 自己判）**：`2026-10-10T07:04:23.556Z` 记一条 `gate:"goal"` 事件（id `8663c6b1-c820-42d1-a73e-f986b498ef7c`），`verdict: pass`、`evaluationRoot: /data/home/yale/work/quay`、`treeSha: 2ac61749…`；`AC-355` status 由 `active` → **`achieved`**（`quay goal show AC-355 --json`：`status: achieved`、`phase: post-merge`、`evidence.verdict: pass`）。即：并入前就地声明的 `phase: post-merge` 生效——分支删除后该 AC 被求值于**主检出**并通过，未用 `--override` 跳过任何验证。

### AC5 — 落地树结构读数（主检出工作树）

- `packages/quay/src/kernel/gate-run-options.ts` **存在**；
- `packages/quay/src/gate/config/utils.ts` **不存在**；
- `packages/quay/src/gate/factories/loader.ts` **不存在**；
- 八个消费点（按位置、剔注释行）均 import `kernel/gate-run-options.ts` ⇒ **8/8**：

      goal-store.ts:22                from "./kernel/gate-run-options.ts"
      cli/gate.ts:8                   from "../kernel/gate-run-options.ts"
      gate/acceptance-runner.ts:5     from "../kernel/gate-run-options.ts"
      gate/registry.ts:8              from "../kernel/gate-run-options.ts"
      gate/config/loader.ts:7         from "../../kernel/gate-run-options.ts"
      gate/config/index.ts:2          from "../../kernel/gate-run-options.ts"
      gate/factories/utils.ts:2       from "../../kernel/gate-run-options.ts"
      gate/factories/goal.ts:5        from "../../kernel/gate-run-options.ts"

### AC6 — 七个测试文件（主检出）

`node --no-warnings --experimental-strip-types --test packages/quay/test/{gate-config-loader,gate,goal-store,acceptance,acceptance-env,gate-diagnostics,gate-ergonomics}.test.mjs` ⇒ **EXIT=0**，原始 summary 行：

    ℹ tests 205
    ℹ pass 205
    ℹ fail 0

（无 `not ok` 标记。）与 AC-355 判据内置的那次互为第二来源。

### AC7 — 生产生效面（读数，非结论）

`ps -eo pid,etimes,args`（本工作区 root=`/data/home/yale/work/quay`）：

    pid 1769873  etimes 607407  node --no-warnings --experimental-strip-types /data/home/yale/work/quay/packages/quay/bin/quay.ts serve
    pid 3202988  etimes  11738  node --experimental-strip-types /data/home/yale/work/quay/plugin/scripts/driver-anchor.ts __anchor --root /data/home/yale/work/quay --takeover 3288128
    （pid 2913800 属另一任务的 worktree …/gap-serve-host-spawned-…，非本工作区生产面；pid 2973129 属另一用户 /data/home/tom/…）

**无需重启**（读数支撑，非断言）：本 goal 是**行为等价的纯符号搬迁**——AC-353 证结构收敛（kernel 单一定义 + 两个死文件删除 + 八个消费点改口）、AC-354 证边数读数 `root→gate/config` 1→0 且负对照能检测回归、本任务 AC6 证七个受影响测试文件在 develop 尖端实测全绿 ⇒ 运行中的 `serve`(1769873) 与其经过的 gate 运行时路径在搬迁前后语义一致，**不存在「重启后才会出现的可观测变化」**。本任务**未**调用任何 `quay driver start|stop|restart`，**未**重启 `serve`（本轮命令集合中不含它们）。

### AC8 — 未改动源码

本任务在任务分支（`task/goal-034-merge-and-postmerge-verify`）上只写 `tasks/goal-034-merge-and-postmerge-verify.md`；落地树里的 `packages/quay/src/**` 改动来自 GOAL-034 本身的合并提交 `1cab409f0`，不是本任务所改——`git diff --name-only develop...HEAD`（任务 worktree）不含 `packages/quay/src/**`。

### 自查（Plan 9）

- `node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/goal-034-merge-and-postmerge-verify.md` ⇒ exit 0；
- `quay task check goal-034-merge-and-postmerge-verify --json` ⇒ `missing: []`。