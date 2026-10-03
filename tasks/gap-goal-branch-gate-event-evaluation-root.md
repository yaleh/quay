---
id: gap-goal-branch-gate-event-evaluation-root
title: goal gate 事件记录判据在哪棵树上求值——payload 增加 evaluationRoot 与 treeSha
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-328
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §7 辛、§9.2 残留 2，硬规则 4c）：goal gate 事件（`.quay/gate-events.jsonl`，`gate: "goal"`）今天只有 `id/item_id/pipeline_id/gate/actor/verdict/timestamp/payload.reason`（实测 2026-10-03 `AC-272` 事件）。goal 分支方案里 pre-merge AC 要在 goal 的判据 worktree 上求值，「这次 pass 是在哪棵树上得到的」今天读不出来 ⇒ GOAL-028 的 AC-328 在缺这个字段时只能读 exit 3。

**修法（方向）**：所有追加 goal gate 事件的路径在 payload 里加 `evaluationRoot`（判据 cwd 的 **realpath**——本机 `/home/yale` 是符号链接，⛔ 不记未解析路径）与 `treeSha`（该 cwd 下 `git rev-parse HEAD^{tree}`，读不到记 null）。账本位置不变（仍是主 root 的 `.quay/gate-events.jsonl`）。

## AC

- [ ] `packages/quay/test/goal-store.test.mjs` 新增用例：在临时 workspace 对一个 AC 跑 `goal gate`，断言追加的事件 `payload.evaluationRoot` 等于 git root 的 realpath、`payload.treeSha` 等于 `git rev-parse HEAD^{tree}`，verdict 与修改前相同。
- [ ] `node --test packages/quay/test/goal-gate-verdict-mapping.test.mjs` 退出 0。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 5b 邻近扫描：grep 其它追加 `gate: "goal"` 事件的写入点，命中数与前 3 条贴进 Evidence，逐条确认已带上两个字段或写明为何不需要。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-gate-event-evaluation-root` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：落地后生产账本里新增的 goal gate 事件带有 evaluationRoot 与 treeSha（可用 `tail .quay/gate-events.jsonl` 直接读到）。GOAL-028 的 AC-328 由此从「载体缺字段 ⇒ exit 3」变为可判。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- tasks/gap-goal-branch-gate-event-evaluation-root.md
