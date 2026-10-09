---
id: gap-goal033-merge-and-postmerge-verify
title: GOAL-033 ③：人工合并请求 + 机械 fan-in + 并入形态与落地树核验（AC-352，post-merge）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal033-selfhost-and-archguard-evidence
goal_ac: AC-352
---
**type:** execution

## Proposal

GOAL-033 的第三块（并入 + 并入后核验）：在 AC-350 / AC-351 两个 pre-merge 判据都 achieved 之后，记录一次人工合并请求，由 worker-driver 机械 fan-in 把 `goal/GOAL-033` 并入 develop；随后核对规定的合并形态与落地树内容，让 post-merge 判据 AC-352 可被判定为真。

AC-352 已声明 `phase: post-merge`（GOAL-031 曾因漏声明而导致 `quay goal merge` 恒被 `pre-merge-ac-unmet` 拒绝；本 goal 创建时已规避）。AC-352 读的是**落地的合并提交树**（`git cat-file` / `git grep <landedSha>`），不是会继续移动的 develop tip，因此不会在之后 develop 前进时漂移成假。

## Plan

1. 前置核验：`quay goal show AC-350 --json` 与 `AC-351` 均为 `achieved`；`quay goal show AC-352 --json` 的 `phase` 为 `post-merge`。任一不满足 ⇒ 停在这里、把读数写进任务体，⛔ 不用 `--override` 绕过。
2. `quay goal merge GOAL-033 --reason "<一句为什么现在并>"`——只追加一条 `goal-merge-request` 事件；真正的 `git merge --no-ff` 由 worker-driver 在加锁的临时 worktree 里执行并跑 anti-drift / typecheck / scoped 门 / 全量 suite（SPEC-goal-branch §4.7）。
3. 等待 `goal-merge-result` 事件。**若 fan-in 红**：先读该事件的 payload 与 suite 日志，在隔离 worktree 里单独跑失败的测试文件，区分「本 goal 的改动造成」与「全量 suite 并发环境伪影」（GOAL-030 曾两次遇到后者并以独立 gap 任务修复）；⛔ 不经诊断就重试，⛔ 不改判据迁就结果。属于本 goal 的回归 ⇒ 回到分支上修；属于环境伪影 ⇒ 另立 gap 任务修根因。
4. 并入之后的核验：
   - 在主检出跑 AC-352 判据（`quay goal gate AC-352 --dry-run`）⇒ exit 0；
   - `git show <landedSha>:packages/quay/src/serve-sessions.ts | grep -n 'driver-control'` 与 `serve.ts | grep -n 'driver-vocab'` 有命中、`git show <landedSha>:packages/quay/src/cli/driver-vocab.ts` 报不存在；
   - 在主检出（追平 develop 之后）跑 `packages/quay/test/driver-control.test.mjs` 与 `packages/quay/test/server.test.mjs` 全绿；
   - `quay goal check --staleness` 对 GOAL-033 不报分歧。
5. ⛔ 本任务不重启任何生产 driver / serve 进程。若判断生产进程需要重启才能加载新代码，只在任务体里写清「哪个进程、为何需要、重启后可观测变化是什么、当前读数」，交回人裁定。预期结论：本 goal 不改任何运行时行为（CLI / web / `quay server` 三个表层输出逐字不变），故无需重启——但要用读数说明，不要只下结论。

## Acceptance Criteria

- [x] `.quay/gate-events.jsonl` 含一条 GOAL-033 的 `goal-merge-request` 事件，未使用 `--override`（事件 id、tipSha、`unmetAcs` 读数进 `## Evidence`）
- [x] 同一文件含一条 GOAL-033 的 `goal-merge-result`，`outcome: landed`，记录 `landedSha` 与 `tipSha`
- [x] AC-352 判据在主检出 exit 0（`quay goal gate AC-352 --dry-run` 的 JSON 原文进 `## Evidence`）——即 merge shape 恰为一个合并提交、第二父 = goal tip、无分支提交泄漏到 first-parent，且落地树 core-root 零 `./cli/` import
- [x] 主检出追平 develop 之后 `packages/quay/test/driver-control.test.mjs` 与 `packages/quay/test/server.test.mjs` 全绿
- [x] `quay goal check --staleness` 对 GOAL-033 无分歧（读数原文进 `## Evidence`）
- [x] 生产生效面已按 Plan 第 5 步以读数说明；本任务未调用任何 `quay driver start|stop|restart` 或重启 serve

## Definition of Done

GOAL-033 以恰好一个合并提交进入 develop，落地树的 core-root 不再 import `cli/`，AC-350/351/352 全部可判定为真；fan-in 若出现红灯已诊断归因而非盲目重试；全程未重启生产进程。

## Touches

- tasks/gap-goal033-merge-and-postmerge-verify.md

## Evidence

### 前置核验（Plan 1）

- `AC-350` status `achieved`（phase `pre-merge`），判据 worktree @`7658cecb4` 最后一次实测 `pass`（2026-10-09T07:25:07.677Z）
- `AC-351` status `achieved`（phase `pre-merge`），实测 `pass`（2026-10-09T07:25:10.494Z）——依赖任务 `gap-goal033-selfhost-and-archguard-evidence` 先把 `.quay/goal-033-evidence/archguard-before-after.json` 落到 goal 分支，goal-driver 刷新判据 worktree 后判据转 pass
- `AC-352` 并入前 status `active` / phase `post-merge`
- 全程未使用 `--override`

### AC1 — 人工合并请求

`.quay/gate-events.jsonl`（主检出）事件：

    id        = 7439550c-273d-4e1f-b8c2-a28e7008f968
    gate      = goal-merge-request     item_id = GOAL-033     actor = human
    timestamp = 2026-10-09T07:25:35.369Z
    payload   = { tipSha: "7658cecb46d53e7a65f7f1423314f2ec418b0e9d",
                  override: null, unmetAcs: [] }

命令：`quay goal merge GOAL-033 --reason "…" --root /data/home/yale/work/quay`。它只记录请求、不合并。
`override: null` 且 `unmetAcs: []` ⇒ 未使用 `--override`（两个 pre-merge AC 当时都已是 `pass`）。

### AC2 — 机械 fan-in 结果

    id        = c4fbdb64-4c9b-4c40-957c-771c307f427c
    gate      = goal-merge-result    item_id = GOAL-033    actor = quay-driver    verdict = pass
    timestamp = 2026-10-09T07:31:42.772Z
    payload   = { outcome: "landed",
                  landedSha: "ddb9c6ac04c3b88fb982f1b805721ac739af5127",
                  tipSha:    "7658cecb46d53e7a65f7f1423314f2ec418b0e9d",
                  requestEventId: "7439550c-273d-4e1f-b8c2-a28e7008f968" }

fan-in step 痕迹（`.quay/fan-in-step-trace.jsonl`，goal=GOAL-033）：`read-develop ok` → `worktree-add ok` → `merge`（`--no-ff`，临时 worktree `/tmp/goal-merge-GOAL-033-izzg3o/wt`）→ anti-drift / typecheck / scoped 门 / 全量 suite → `ff ok=true (125ms)` → `branch-delete ok=true`（皆 07:31:42）。并入后 `goal/GOAL-033` 已删除（`git show-ref refs/heads/goal/GOAL-033` 无此 ref）。无红灯，无需诊断归因。

### AC3 — AC-352 判据（主检出）

`quay goal gate AC-352 --dry-run --json --root /data/home/yale/work/quay` ⇒ `EXIT=0`，原文：

    { "id": "AC-352", "verdict": "pass", "cause": null,
      "reason": "acceptance passed (exit 0)", "timeoutMs": 60000,
      "timestamp": "2026-10-09T07:32:15.351Z", "dryRun": true,
      "event": { "item_id": "AC-352", "gate": "goal", "verdict": "pass",
                 "payload": { "evaluationRoot": "/data/home/yale/work/quay",
                              "treeSha": "0b0ec16a3896aa339f54fa796962f6ca87ad3b10" } } }

随后 goal-driver 在并入后的主检出上自行求值并记 `pass`（事件 `e6de34fd-084b-4e00-8971-0b30b9604ff9`，2026-10-09T07:36:39.062Z，`evaluationRoot=/data/home/yale/work/quay`），`AC-352` 状态 → `achieved`（AC-350/351 亦 `achieved`，三者 last verdict 均为 `pass`）。

形状补充读数（均在主检出）：

- `develop` tip = `ddb9c6ac0…` = `landedSha`，且它是 `git rev-list --first-parent develop` 的首行；
- `git rev-list --parents -n1 ddb9c6ac0…` = `ddb9c6ac0 7a50437df 7658cecb4` ⇒ **恰两个父**：`^1` = 并入前的 develop tip，`^2` = goal tip `7658cecb4`；
- 落地树：`packages/quay/src/driver-control.ts` **存在**；`packages/quay/src/cli/driver-vocab.ts` **不存在**；`packages/quay/src/driver-vocab.ts` 存在；
- `git show ddb9c6ac0:packages/quay/src/serve-sessions.ts | grep -n driver-control` ⇒ `20:import { runDriver } from "./driver-control.ts";`
- `git show ddb9c6ac0:packages/quay/src/serve.ts | grep -n driver-vocab` ⇒ `47:`（注释行）与 `51:import { ALL_SERVICE_NAMES } from "./driver-vocab.ts";`
- AC-352 判据自身另查「无分支提交泄漏到 first-parent」（`git rev-list <landedSha>^1..<tip>` 与 first-parent 链无交集）与 core-root 零 `./cli/` import，两部分都在上面这次 exit 0 里通过。

### AC4 — 落地树上的两个测试文件（主检出）

- 主检出（`author`）追平 develop：`git merge --ff-only develop` ⇒ `HEAD = ddb9c6ac04c3b88fb982f1b805721ac739af5127`（= develop tip），`author..develop = 0`；
- `node --experimental-strip-types --test packages/quay/test/driver-control.test.mjs` ⇒ `tests 3 / pass 3 / fail 0`
- `node --experimental-strip-types --test packages/quay/test/server.test.mjs` ⇒ `tests 3 / pass 3 / fail 0`

（`server.test.mjs` 运行时打印两行 `fatal: not a git repository` 是其子进程在临时 cwd 下的既有噪声，与本次改动无关；`fail 0`。）

### AC5 — staleness

`quay goal check --staleness --root /data/home/yale/work/quay` 原文：

    { "fresh": ["GOAL-033"], "stale": [], "notEvaluated": [], "divergent": [],
      "scopeSize": 1, "evaluated": true, "cap": 5, "staleMs": 604800000 }

GOAL-033 在 `fresh`，`divergent: []` ⇒ 无分歧。

### AC6 — 生产生效面（读数，非结论）

本工作区（root=`/data/home/yale/work/quay`）生产进程读数（`ps -eo pid,etimes,args`）：

    pid 1769873  etimes 522941  node --no-warnings --experimental-strip-types /data/home/yale/work/quay/packages/quay/bin/quay.ts serve
    pid 3515777  etimes   5163  node --experimental-strip-types /data/home/yale/work/quay/plugin/scripts/driver-anchor.ts __anchor --root /data/home/yale/work/quay --takeover
    （pid 2913800 / 2914068 属另一任务的 worktree `gap-serve-host-spawned-…`，不是本工作区生产面）

**无需重启**，理由（读数支撑，非断言）：

- 本 goal 是**行为等价的搬迁**：`AC-350` 证明边/定义/消费者结构收敛（core-root 零 `cli/` import、`driver-control.ts` / `driver-vocab.ts` 单一定义、五个消费者改口），`AC-351` 在被求值树上**现场重算** CLI status 面语义不变；
- `driver-control.test.mjs` (c) 组在主检出实测钉住 CLI 展示契约不变：本次直接读数 `quay driver status --kind worker --json` 带 `instruments`（读得 `instruments=true`），`--kind promotion` 不带（读得 `instruments=false`）；
- 运行中的 `serve`(1769873) 加载搬迁前的代码，但它经过的 `runDriver` / 词表在搬迁前后语义一致（上两条），故其行为读数与搬迁后无差异 ⇒ **不存在「重启后才会出现的可观测变化」**，无需重启。同理 driver anchor(3515777) 无需重启。

本任务**未**调用任何 `quay driver start|stop|restart`，**未**重启 `serve`（本轮执行的命令集合中不含它们）。
