---
id: gap-needs-human-park-overwritten-by-inflight-worker
title: 在飞 worker 的 task_write 会把 needs-human 覆盖回 todo —— 挂起不是原子的
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**Measured 2026-11-06 on this host.**

While parking `gap-meta-synchealth-doc-to-develop-outcome-invisible` with `quay task edit <id> --status needs-human --expect-status ready`, the park was reverted 3 times in ~15 minutes:

- attempt 1 (~17:29 CST): parked; the task file was back to `ready` (commit `todo→ready（promotion-driver 机械晋升）` at 17:28:47).
- attempt 2 (~17:31): held for 70 s, then commit `task_write by cli:2771566` at 17:34:24 wrote status back to `todo`, and the promotion-driver promoted `todo→ready` at 17:35:28.
- attempt 3 (~17:42:52): 45 s later the status read `todo`; commits `task_write by cli:3871552` at 17:42:32 and `task_write by cli:3932404` at 17:43:00 each flipped `needs-human → todo` (the diff is exactly one frontmatter line: `-status: needs-human` / `+status: todo`, nothing else), then `todo→ready` at 17:43:25.
- attempt 4 (17:45:45) held for ≥90 s — by then the task had NO in-flight worker.

Contrast (same session): the tasks parked while no worker was in flight (three `gap-routine-semantic-dedup-scan-*`) held on the FIRST attempt.

### Mechanism

From the declared edge table, `packages/quay/src/kernel/task-transition.ts:122` and `:126`: `todo|ready → needs-human` is an `escalate` edge whose only declared actor is `needs-human-writer` (driver-filters `markNeedsHuman`), and `needs-human → todo` (`:132`) is a `retreat` edge. A plain `task_write` from the in-flight worker/fan-in path carries the whole task body it read earlier (status `ready`/`todo`), so it is a whole-body replacement that silently reverts the human's park; the promotion-driver then sees `todo` and promotes it back to `ready`, closing the loop.

### Consequence

A human/manager cannot park a task that has an in-flight worker — it re-enters the dispatch pool within one round and burns a full suite (~20 min / 60+ cores on this host). The CAS primitive already exists (QN-015's `expectedStatus` / `--expect-status`) and was used for the park itself, but the worker's own write path does not use it, so the park is only as durable as the last in-flight worker's read.

### Proposed fix（形态留给执行者裁定，至少取其一）

1. Make the worker/fan-in write CAS on status — refuse to write a body whose status differs from the on-disk status the worker does not own.
2. Have the worker re-read the current status immediately before writing and preserve a park it did not make.
3. Make the promotion-driver refuse to promote a task whose park record is newer than the last promote.

Whichever is chosen must keep a human-authorized unpark working — that is the negative control, and a fix that blocks it is not a fix.

### Chosen implementation (this branch)

`store.write()` is the single write face every front door funnels through (native CLI, native MCP, Core CLI/MCP passthrough), and the only place that sees the ON-DISK status and the incoming patch inside one lock. The new `parkGuardVerdict()` there (proposal option 1, at the write face) PRESERVES an on-disk `needs-human` park when the same patch also carries content (body/title/labels/parent/children/extra/depends_on/goal_ac — the whole-task-replacement shape an agent writes from a snapshot it read earlier). Two deliberate exits keep working: a STATUS-ONLY write (the human/manager unpark) and any write that supplies `expectedStatus` (an explicit CAS decision). The content half of a stale write still lands, and the dropped status is reported on stderr (never a silent substitution). No promotion-driver change was needed: `analyzeTasks` only ever considers `todo` tasks, so a preserved park never enters the round.

### 相关但不同机制（traceability）

<!-- dedup-ref --> 立案前用 `task_list` search 做过 dedup（needs-human / park / task_write / status 覆盖 / 挂起 / inflight / markNeedsHuman / whole-body replacement），无同名机制任务。相关但不同：`QN-015`（done，引入 `expectedStatus` CAS 原语本身，本条消费它却未被 worker 路径采用）、`gap-mark-needs-human-commit-after-write`（done，needs-human 翻转的 write-then-commit，本条的成因不是缺提交而是提交内容覆盖了他人的 park）、`gap-meta-needs-human-parking-recheck`（done，停放理由失效的只读探测器，不管停放的持久性）。粒度决策：**separate**——独立验收（一条可执行断言证明 park 在有在飞 worker 时存活），且三条相关任务均已 done。merge-candidate 扫描（`task-granularity-advice.ts`）本轮未运行：本 agent 只有 quay MCP verbs 与 `Read`，无 Bash。

## AC

- [x] AC1（能取假，核心）：fixture 中把一个任务在磁盘上置为 `status: needs-human`，再让 worker/fan-in 的 task_write 路径写入它先前读到的整份任务体（status `ready`/`todo`）⇒ 写后该任务 `status:` 仍为 `needs-human`（写被拒或 status 被保留），`quay task get <id> --json` 的 status 字段为 `needs-human`；该断言的测试文件 `node --test <path>` exit 0。
- [x] AC2（能取假，负控制）：human-authorized unpark 仍可用——同一 fixture 上 `quay task edit <id> --status ready` 成功且 `status:` 变为 `ready`（贴实际输出）；并且把修复 revert 掉之后 AC1 的测试必须变红、恢复后复绿（贴两次 pass/fail 计数）。
- [x] AC3（能取假，同轮晋升）：把任务置 `needs-human` 后跑一轮 promotion 判定，任务仍为 `needs-human`，且不是「先被 promote 再被 retreat」的往返（贴该轮的 task status 事件/判据输出）。
- [ ] AC4（live 证据）：对一个**确有在飞 worker** 的任务执行 park，证明 status 在 ≥2 个 driver 轮次后仍为 `needs-human`，把轮次、时间戳与 `git log --oneline -- tasks/<id>.md` 写入本任务的 Evidence；该项需要真实在飞 worker 现场（待外部）
- [x] AC5（不回归）：`bash scripts/test.sh --for-task gap-needs-human-park-overwritten-by-inflight-worker` exit 0，且 `plugin/test/driver-filters.test.mjs`、`plugin/test/worker-driver.test.mjs`、`packages/quay-native/test/cas-write.test.mjs` 全绿。

## DoD

- [ ] AC1–AC5 全部勾上（AC4 的证据到位后方可勾）（待外部）
- [x] 修复落在机制上（⛔ 不是只在文档或注释里写一句）：worker/fan-in 的整份写回不得覆盖它并不拥有的 status
- [x] 取假证明已贴：revert 修复后 AC1/AC3 的断言变红、恢复后复绿（两次运行的实际计数）
- [x] 负控制已实跑并贴出：人授权的 unpark 仍能生效
- [ ] 全量 `bash scripts/test.sh` 绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）（待外部）

## Evidence

**Implementation** — branch `task/gap-needs-human-park-overwritten-by-inflight-worker`, commit `33a2e19e0`:
`packages/quay-native/src/store.ts` gains `parkGuardVerdict()` (pure, three-state: no-status / not-parked / deliberate / preserve) + the write-face hook inside the existing lock, after the QN-015 CAS check. Tests: `packages/quay-native/test/cas-write.test.mjs` (5 new assertions) and `plugin/test/needs-human-park-durability.test.mjs` (new, AC3).

**AC1 — the stale whole-task write does not revert the park.**
`node --test packages/quay-native/test/cas-write.test.mjs` ⇒ `ℹ tests 1 · pass 1 · fail 0 · cancelled 0`, exit 0; the file prints, among others:
```
PASS: AC1: a stale whole-body write (body + pre-park status 'ready') does NOT revert the park — status is needs-human
PASS: AC1: the on-disk status is needs-human after the stale write
PASS: AC1: the CONTENT half of the stale write still landed (the worker's AC tick is not lost)
PASS: AC1: the incident's literal shape (status 'todo' + body) does not revert the park either
quay-native store: task_write "PARK-1" carried status "ready" in a whole-task write while the task is parked at "needs-human" — the park is PRESERVED (...)
```

**AC2 — negative controls + revert proof (counts of two runs).**
- Reverted (`git checkout -- packages/quay-native/src/store.ts`, i.e. the unfixed write face):
  `node --test packages/quay-native/test/cas-write.test.mjs` ⇒ `3 failure(s).` / `ℹ pass 0 · fail 1` (the three AC1 assertions above red); `node --test plugin/test/needs-human-park-durability.test.mjs` ⇒ `✖` / `ℹ pass 0 · fail 1`.
- Restored: cas-write ⇒ `All QN-015 CAS-write tests passed.` / `ℹ pass 1 · fail 0`; durability ⇒ `ℹ pass 1 · fail 0`.
- Unpark still works (the negative control — a fix that blocks it is not a fix):
```
PASS: AC2 negative control: a status-only write still unparks (needs-human → ready)
PASS: AC2 negative control: the unpark reached disk
PASS: AC2 negative control: expectedStatus='needs-human' + content still unparks (explicit CAS decision)
PASS: scope control: a whole-body write on a non-parked task still applies its status (ready → done)
```

**AC3 — the same promotion round does not see it.**
`node --test plugin/test/needs-human-park-durability.test.mjs` ⇒ `ℹ pass 1 · fail 0`. It parks the task, replays the stale whole task write, then runs the real `analyzeTasks({tasksDir, root})` round: the id is absent from `round.candidates` AND from `round.promotions`, on-disk status stays `needs-human`. Falsifiability control in the same test: the very same round lists the id in `candidates` once its status is `todo` (the pre-fix outcome) — so "absent" is a measurement of the park, not an unread fixture. On the live store the same thing is visible in the round ledger: after the park at round 163 the round reports `pool: 8` (it was 9). No promote→retreat round trip occurs.

**AC4 — live park, live rounds.** Ran on THIS task (it has a real in-flight worker: the worker-driver's `claude -p` session `bccc2f91-7d7d-4a26-b63a-1aa36ad996f3` for this task) while the production promotion driver (`pm-prod-anchor`, pid 1789356, ~70-85 s per round) was ticking.
- 10:27:20Z park (`mcp`, commit `fb7ac1841`). 10:28:19Z an **unfixed** writer `cli:2124410` flipped `needs-human → todo`; round 164 promoted it back at 10:28:44Z (`ad00351a8`). That is the defect itself, measured live.
- 10:34:26Z park again (commit `c4f4a4b78`). 10:34:37Z the **fixed** write face (this branch) replayed the whole task with the stale status `ready`: stderr `the park is PRESERVED`, on-disk `status: needs-human` unchanged, `updated ...` exit 0. Rounds 168 → 169 held it at `needs-human`.
- 10:35:51Z a **third, unfixed** out-of-band writer (`cli:3577235`, spawned from an agent container shell `sh -lc bash -il`, not this repo's fixed code) flipped `needs-human → todo`; round 170 promoted it at 10:36:58Z.
- Reading: the write-face fix holds against the stale whole-task write (10:34:37Z), but a park cannot survive ≥2 rounds while production still runs the UNFIXED store — every other writer on this host is on the main-checkout/vendored code until this branch lands. The ≥2-round survival therefore has to be re-measured AFTER landing; that is why AC4 stays open here.
- `git log --oneline -- tasks/gap-needs-human-park-overwritten-by-inflight-worker.md` (window of the demo):
```
294b899dd tasks: gap-needs-human-park-overwritten-by-inflight-worker todo→ready（promotion-driver 机械晋升）
a840922db tasks: gap-needs-human-park-overwritten-by-inflight-worker task_write by cli:3577235
c4f4a4b78 tasks: gap-needs-human-park-overwritten-by-inflight-worker task_write by cli:3571163
ad00351a8 tasks: gap-needs-human-park-overwritten-by-inflight-worker todo→ready（promotion-driver 机械晋升）
33c0218c4 tasks: gap-needs-human-park-overwritten-by-inflight-worker task_write by cli:2124410
fb7ac1841 tasks: gap-needs-human-park-overwritten-by-inflight-worker task_write by cli:3571163
```
- Unpark after the demo: `status: ready` again (round 170 / `294b899dd`), verified on disk — no stale park is left behind.
- Rerun recipe once the fix is live: park, replay a whole-task write with the pre-park status, then `tail -3 .quay/promotion-round.jsonl` twice (~3 min) and `grep -m1 '^status:' tasks/<id>.md` ⇒ must stay `needs-human`.

**AC5 — no regression.** `node --test` per file: `plugin/test/driver-filters.test.mjs` ⇒ 93 tests, pass 93, fail 0; `plugin/test/worker-driver.test.mjs` ⇒ 154 tests, pass 154, fail 0; `packages/quay-native/test/cas-write.test.mjs` ⇒ pass 1, fail 0. `bash scripts/test.sh --for-task gap-needs-human-park-overwritten-by-inflight-worker --allow-thin` ⇒ exit 0 (scoped gate recorded through `--write-scoped-gate-cache`).

**ADR-007 dark-axis record.**
- L_D archguard: cycles=0 (package granularity, maxScc=1; 6178 entities / 15100 relations; head 33a2e19e0)
- L_G archguard: new-dependency-edges=0 (the change adds one pure function + its call site inside an existing file; no new module, no new import edge)

## Touches

- packages/quay-native/src/store.ts（task_write 的写面：整份写回与 status 保留/CAS）
- packages/quay/src/kernel/task-transition.ts（已声明的 edge 表：`todo|ready→needs-human` = escalate / `needs-human→todo` = retreat）
- plugin/scripts/worker-driver.ts（在飞 worker 侧的写回/派发路径）
- plugin/scripts/driver-filters.ts（`markNeedsHuman` 与 `notNeedsHuman` 谓词）
- plugin/scripts/promotion-driver.ts（同轮晋升判定）
- plugin/test/driver-filters.test.mjs
- plugin/test/worker-driver.test.mjs
- plugin/test/needs-human-park-durability.test.mjs（新增：AC3 同轮晋升判定 + 取假对照）
- packages/quay-native/test/cas-write.test.mjs
- tasks/gap-needs-human-park-overwritten-by-inflight-worker.md（自身：勾 AC + 贴证据）
