---
id: gap-goal-branch-human-merge-verb-and-execution
title: quay goal merge 人工并入请求 + worker-driver 以 --no-ff 合并提交执行 goal→develop
  并入、失败后在 tip 前进时自动重试
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-ff-merge-source-param
  - gap-goal-branch-dispatch-wiring-and-task-fan-in
  - gap-goal-branch-ac-phase-field-and-split-evaluation
goal_ac: AC-325
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.7，裁定⑭⑱⑲⑳⑫）：goal 并入 develop 先于 achieved，且必须由人触发；执行者是 worker-driver（task 落地机制的所有者），⛔ 不是 goal-driver（DIR-131）。

**修法**：
1. **动词** `quay goal merge <GOAL-NNN> --reason "<为什么现在够成熟>" [--override "<理由>"]`：只记录请求，不执行合并——向主 root 的 `.quay/gate-events.jsonl` 追加 `gate: "goal-merge-request"`、`item_id: <GOAL>` 的事件（actor、reason、当时 `goal/<id>` 的 tip SHA，带 override 时还有 override 理由与当时未达成的 AC 清单）。必拦且不可越过：goal 非 active / 非 branch-mode / 分支不存在 / 已并入。pre-merge AC 未全部 achieved ⇒ 拒绝，除非 `--override`。sufficiency 判据只打印、不拦。
2. **执行**（worker-driver）：待执行 = 存在请求事件 ∧ `goal/<id>` 存在 ∧ 非 develop 祖先（派生，不存储）。持该 goal 的锁 → 再持 develop 的锁（固定顺序）；临时 worktree 检出 develop（detached），`git merge --no-ff goal/<id>`，提交消息含 `goal/<GOAL-NNN>` 与请求事件 id；跑 anti-drift（基准 develop）/ typecheck / scoped 门 / 全量 suite；绿 ⇒ 用 ff-merge 的源参数把 develop ff 到该合并提交，删除 `goal/<id>`；红或冲突 ⇒ 不动 ref，释放锁，追加 `goal-merge-result` 事件。
3. **自动重试**（裁定⑳）：请求一直有效，直到并入或 goal 离开 active；只在 `goal/<id>` tip 前进之后的下一轮重试（tip 不变不重跑）；重试前重新检查 pre-merge AC，原请求的 override 只覆盖它当时列出的 AC。
4. **失败立案**（裁定⑫，§9.2 残留 1）：「有请求 ∧ 最近一次执行红」作为新 gap 形态交给现有 gap-filing，去重键为 `kind: goal-branch-unmerged` + GOAL id（⛔ 不能只按 goal_ac 去重）。由 worker-driver 侧立案，或写一条 goal 侧可读的事件由 goal-driver 立案——实现者选一，须通过 `goal-driver-task-boundary-check.ts`。

## AC

- [x] 新增 `packages/quay/test/goal-merge.test.mjs`：四类必拦各一条用例被拒且不写事件；pre-merge AC 未全达成时无 override 被拒、带 override 时写出的事件含 override 理由与未达成 AC 清单；成功时事件含 tip SHA。
- [x] `plugin/test/worker-driver.test.mjs` 新增端到端用例（临时仓库，注入可控的 suite 结果）：有请求时 develop first-parent 上出现一个 subject 含 `goal/GOAL-901` 的合并提交、develop 被 ff 到它、`goal/GOAL-901` 被删除；suite 红时所有 ref 不变并写出 `goal-merge-result`；tip 不变时下一轮不重试；tip 前进后重试。
- [x] 用上面成功场景生成的临时仓库，运行 GOAL-028 的 AC-325 与 AC-327 判据文本（从 `goals/AC-325-*.md` / `goals/AC-327-*.md` 的 criterion 字段取出，用 `sh` 执行），均退出 0；输出贴进 Evidence。
- [x] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-human-merge-verb-and-execution` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：人对一个已试用的 branch-mode goal 执行 `quay goal merge` 后，develop 上出现恰好一个合并提交，goal 分支消失，goal 之后才走到 achieved。生产读数由 GOAL-028 的 AC-325 与 AC-327 在第一个试点 goal 并入后取得。

## Touches

- packages/quay/src/goal-merge.ts
- packages/quay/src/cli/goal.ts
- packages/quay/src/cli/help.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in.ts
- plugin/test/worker-driver.test.mjs
- packages/quay/test/goal-merge.test.mjs
- tasks/gap-goal-branch-human-merge-verb-and-execution.md

## Evidence

worktree `gap-goal-branch-human-merge-verb-and-execution`；提交 `88c8283c0`（实现）+ `3bf6c92dd`（help 反引号修复）+ `1c058e644`（merge develop，带入 ABI 勾选的 task 文件）；2026-10-03。

### AC1 — `packages/quay/test/goal-merge.test.mjs`（9 例全绿）
四类必拦各一条（non-active / not-branch-mode / branch-missing / already-merged）均被拒且 ledger 无 `goal-merge-request`；pre-merge AC 未达成无 override 被拒、带 override 写出的事件含 override 理由与 `unmetAcs: ["AC-901"]`；成功事件含 tip SHA。`ℹ tests 9 / pass 9 / fail 0`。

### AC2 — `plugin/test/worker-driver.test.mjs` 端到端（3 例全绿）
```
✔ goal-merge e2e — green suite: develop gets exactly ONE goal/GOAL-901 merge commit on its first-parent chain, develop is ff'd to it, the goal branch is deleted
✔ goal-merge e2e — red suite: all refs unchanged, a goal-merge-result is written, and it retries only after the tip advances
✔ goal-merge e2e — GOAL-028's AC-325 and AC-327 criteria pass on the success-scenario repo (the real criterion text, run with sh)
```

### AC3 — GOAL-028 AC-325 / AC-327 判据在成功场景临时仓库上实跑（exit 0）
```
--- AC-325 exit=0 ---
PASS: 1 goal-branch merge(s), each preceded by a human merge request and not preceded by achieved
--- AC-327 exit=0 ---
PASS: 1 merged goal(s), each exactly one commit on develop's first-parent chain
```
（判据文本取自 `goals/AC-325-*.md` / `goals/AC-327-*.md` 的 criterion 字段，用 `sh -c` 在临时仓库内执行。）

### AC4 — boundary check（exit 0）
```
goal-driver-task-boundary-check: PASS — goal-driver.ts has no task-write call sites (task_write/lifecycle_*/fs.write-to-tasks) and no OWN-REPO fan-in/落地率 carrier reads outside the target-probe exempt span
exit=0
```

### AC5 — 取假（`cp` 备份 → 回退核心 → 红；`cp` 恢复 → 绿）
回退：`cp packages/quay/src/goal-merge.ts /tmp/goal-merge.ts.bak`（md5 `3b09586e25967218cbd746054d8ee1e4`），把 `recordGoalMergeRequest` 的 `appendGateEvent(...)` 前置为 `if (false)`（即不再落事件）：
```
✖ goal merge refuses when a pre-merge AC is not achieved; --override records the reason + the unmet AC list
✖ a successful request records exactly one goal-merge-request event carrying the goal/<id> tip sha
✖ pendingGoalMerges derives the request, and stops reporting it once merged / once the branch is gone
✖ readGoalMergeRequests reads back the recorded request
ℹ tests 9 / pass 5 / fail 4
```
恢复：`cp /tmp/goal-merge.ts.bak packages/quay/src/goal-merge.ts`（md5 同 `3b09586e…`）：
```
ℹ tests 9 / pass 9 / fail 0
```

### AC6 — scoped 门（非 thin）exit 0；确实执行了测试文件
`bash scripts/test.sh --for-task gap-goal-branch-human-merge-verb-and-execution`（无 `--allow-thin`）退出 0，`ℹ tests 219 / pass 219 / fail 0`；执行的测试文件含：
- `packages/quay/test/goal-merge.test.mjs`（9 例，含上面 8 条 goal merge 用例）
- `plugin/test/worker-driver.test.mjs`（含 `goal-merge e2e` 3 例）

驱动侧同一门（`--allow-thin`）退出 0；scoped-gate 缓存已写（`--write-scoped-gate-cache --develop-sha 90c1921ef61f534289970e51a33772c043342bfc`，= 合并时 develop tip）。
