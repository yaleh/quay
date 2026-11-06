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

### 相关但不同机制（traceability）

<!-- dedup-ref --> 立案前用 `task_list` search 做过 dedup（needs-human / park / task_write / status 覆盖 / 挂起 / inflight / markNeedsHuman / whole-body replacement），无同名机制任务。相关但不同：`QN-015`（done，引入 `expectedStatus` CAS 原语本身，本条消费它却未被 worker 路径采用）、`gap-mark-needs-human-commit-after-write`（done，needs-human 翻转的 write-then-commit，本条的成因不是缺提交而是提交内容覆盖了他人的 park）、`gap-meta-needs-human-parking-recheck`（done，停放理由失效的只读探测器，不管停放的持久性）。粒度决策：**separate**——独立验收（一条可执行断言证明 park 在有在飞 worker 时存活），且三条相关任务均已 done。merge-candidate 扫描（`task-granularity-advice.ts`）本轮未运行：本 agent 只有 quay MCP verbs 与 `Read`，无 Bash。

## AC

- [ ] AC1（能取假，核心）：fixture 中把一个任务在磁盘上置为 `status: needs-human`，再让 worker/fan-in 的 task_write 路径写入它先前读到的整份任务体（status `ready`/`todo`）⇒ 写后该任务 `status:` 仍为 `needs-human`（写被拒或 status 被保留），`quay task get <id> --json` 的 status 字段为 `needs-human`；该断言的测试文件 `node --test <path>` exit 0。
- [ ] AC2（能取假，负控制）：human-authorized unpark 仍可用——同一 fixture 上 `quay task edit <id> --status ready` 成功且 `status:` 变为 `ready`（贴实际输出）；并且把修复 revert 掉之后 AC1 的测试必须变红、恢复后复绿（贴两次 pass/fail 计数）。
- [ ] AC3（能取假，同轮晋升）：把任务置 `needs-human` 后跑一轮 promotion 判定，任务仍为 `needs-human`，且不是「先被 promote 再被 retreat」的往返（贴该轮的 task status 事件/判据输出）。
- [ ] AC4（live 证据）：对一个**确有在飞 worker** 的任务执行 park，证明 status 在 ≥2 个 driver 轮次后仍为 `needs-human`，把轮次、时间戳与 `git log --oneline -- tasks/<id>.md` 写入本任务的 Evidence；该项需要真实在飞 worker 现场（待外部）。
- [ ] AC5（不回归）：`bash scripts/test.sh --for-task gap-needs-human-park-overwritten-by-inflight-worker` exit 0，且 `plugin/test/driver-filters.test.mjs`、`plugin/test/worker-driver.test.mjs`、`packages/quay-native/test/cas-write.test.mjs` 全绿。

## DoD

- [ ] AC1–AC5 全部勾上（AC4 的证据到位后方可勾）
- [ ] 修复落在机制上（⛔ 不是只在文档或注释里写一句）：worker/fan-in 的整份写回不得覆盖它并不拥有的 status
- [ ] 取假证明已贴：revert 修复后 AC1/AC3 的断言变红、恢复后复绿（两次运行的实际计数）
- [ ] 负控制已实跑并贴出：人授权的 unpark 仍能生效
- [ ] 全量 `bash scripts/test.sh` 绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- packages/quay-native/src/store.ts（task_write 的写面：整份写回与 status 保留/CAS）
- packages/quay/src/kernel/task-transition.ts（已声明的 edge 表：`todo|ready→needs-human` = escalate / `needs-human→todo` = retreat）
- plugin/scripts/worker-driver.ts（在飞 worker 侧的写回/派发路径）
- plugin/scripts/driver-filters.ts（`markNeedsHuman` 与 `notNeedsHuman` 谓词）
- plugin/scripts/promotion-driver.ts（同轮晋升判定）
- plugin/test/driver-filters.test.mjs
- plugin/test/worker-driver.test.mjs
- packages/quay-native/test/cas-write.test.mjs
- tasks/gap-needs-human-park-overwritten-by-inflight-worker.md（自身：勾 AC + 贴证据）