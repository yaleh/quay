---
id: gap-resource-gate-no-single-flight-lock-two-suite-overlap
title: "Seventh 'mechanism-exists-guarantee-gone' instance: the resource gate
  only checks at STARTUP with NO single-flight lock (grep full-suite-runner.ts +
  scripts/test.sh for lock/flock/single-flight = ZERO hits) — two full
  concurrency-8 suites both saw GO in a low-load window and started, then
  created the congestion the gate was meant to prevent (4 cores, two cc8 = 16
  workers + subprocesses, 3x+ oversubscription, PSI cpu 86); worst case: BOTH
  are cost-baseline-measuring tasks (wire-suite-cost-reporter's first per-file
  baseline becomes the reference; serial-recompose verifying under another cc8's
  load), so the numbers would be silently-wrong baselines; the gate prevents
  'starting into a busy machine' but not 'becoming that busy machine'; fix:
  full-suite single-flight flock held for the whole run, complementary to the
  resource gate, re-measure both tasks' baselines in a clean single window"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**资源闸门只做启动时检查、无单飞锁——两个全量套件能在低负载窗口各自看到 GO、双双放行，然后自己制造出
闸门本要阻止的拥塞。今晚第七次「机制在、保证没了」。**

### 实测（管理者 19:1x）

- worktree task/serial-recompose-nested-runner：node --test --test-concurrency=8（~4 分钟）+ worktree
  task/wire-suite-cost-reporter：node --test --test-concurrency=8（~2 分钟）**同时跑**；
- 机器 nproc=4 / load1=13.07 / 33 node 进程；PSI cpu some avg10=**86.22**（闸门 limit 40）；
- ⇒ 4 核上两个 cc8 = 16 worker + 子进程，3 倍以上超订。

**为什么特别糟**：两个任务产出【就是耗时基线】——wire-suite-cost-reporter 正在装 per-file 墙钟仪器
（第一组基线成后续判断参照）；serial-recompose 正在重组 serial 组（全部理由 = 不能与并发负载竞争，却
在另一个 cc8 负载下验证）。此刻测的数在 3 倍超订下取，若写进 AC/证据会是错的基线且【看不出来是错的】。

**根因**：`scripts/test.sh` 的 resource_gate_check 在全量默认路径前调
`resource-gate.sh --for full-suite`——但 grep full-suite-runner.ts 与 scripts/test.sh 的
lock/flock/single-flight：**零命中**。两个套件在低负载窗口各自看到 GO 双双放行。
**闸门防的是「启动进入一台忙机器」，防不了「自己变成那台忙机器」。**

### 第七次同一形状

group_of 组名在/隔离没了；派生并发公式在/约束没了；prefriction 触发器在/分辨率没了；assert-clean-tree
断言在/前提没了；reporter 写好了/没接线；认错的话在/计数不在；现在是【资源闸门在/互斥没有】。

### 修复方向（外层裁定：全量套件单飞锁）

1. **单飞锁**：全量套件默认路径在资源闸前/后获取 `flock` 锁（如 `.quay/full-suite.lock`，持有整个
   运行期）——同一时刻只有一个全量套件在跑；第二个 WAIT（不启动）或排队；
2. **锁的语义**：不是资源闸的替代——闸门防「忙机器启动」，锁防「第二个套件加入」；两者叠加才完整；
3. **带锁重测**：锁落地后，wire-suite-cost-reporter 与 serial-recompose 的基线要在**干净窗口单跑**重取
   （当前并发污染的数作废——已标注「测量时机器有另一个 cc8 套件在跑」）；
4. **机械验证**：全量套件路径有 flock 引用（grep ≥1）；构造两个并发启动 ⇒ 第二个 WAIT/排队不进入。

## Contract

measure suite_lock = `grep -c "flock\|single.flight\|full-suite.lock" scripts/test.sh plugin/scripts/full-suite-runner.ts 2>/dev/null` stdout 数字段（锁实现后应 ≥1）
measure concurrent_suites = `pgrep -af "test-concurrency=8" | grep -v pgrep | grep -v "bash -c" | wc -l` stdout 数字段（锁生效后应 ≤1）
band suite_lock = ≥1 且 concurrent_suites = ≤1（单飞锁 + 同一时刻最多一个 cc8 套件）
invoke `grep -n "flock\|full-suite.lock\|single-flight" scripts/test.sh plugin/scripts/full-suite-runner.ts`
control 两个并发全量启动 ⇒ 第二个 WAIT/排队（不双双 GO）；锁持有期另一个被拒；释放后可再启动
resume 若中断，先跑 measure 读锁存在性 + 并发套件数

## Acceptance Criteria

- [x] AC1: **单飞锁落地**——全量套件默认路径获取 flock 锁（`<git-common-dir>/full-suite.lock`，共享于
      所有 worktree + 主 checkout，持有整个运行期）；第二个并发启动 WAIT/排队（不再双双 GO）
      — 证据：scripts/test.sh flock 引用 17 处；负控制 Phase 1 第二个被拒、Phase 2 阻塞后放行
- [x] AC2: **与资源闸互补**——is_default_set 分支先 `full_suite_lock_acquire` 后
      `resource_gate_check`（先串行化再查负载）；闸门防「忙机器启动」、锁防「第二个套件加入」
- [x] AC3: **带锁重测**——两个任务的并发污染基线已**作废并标注**（见下方两任务文件的 cross-annotation
      块）；干净窗口单跑重取排定在锁落地后、由它们自己的干净窗口执行（scoped 验证不跑全量 cc8）
- [x] AC4: **机械验证**——grep flock/single-flight/full-suite.lock = 17（≥1）；两个并发启动负控制
      ⇒ 第二个 WAIT/排队不进入（Phase 1 拒绝 + Phase 2 排队，实跑输出见下方）
- [x] AC5: 与 gap-install-suite-cost-instrument-reporter-not-wired（基线参照）、
      gap-serial-group-recompose-nested-runner-criterion（serial 重组验证）交叉标注——两文件已加
      cross-annotation：锁落地前基线不可信

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（含两并发启动第二个 WAIT 的对照）——见下方 Execution evidence
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）且**同一时刻只有一套**——scoped 验证只跑
      变更相关测试（任务指令），全量 cc8 连跑 2 次排到 fan-in / 外层验证门

## Touches
- scripts/test.sh（全量套件默认路径 flock 锁）
- plugin/scripts/full-suite-runner.ts（若 runner 层需要）
- tasks/gap-install-suite-cost-instrument-reporter-not-wired.md（AC5 交叉标注）
- tasks/gap-serial-group-recompose-nested-runner-criterion.md（AC5 交叉标注）

## Execution evidence (2026-08-07)

**Implementing change:** `scripts/test.sh` — additive flock on the full-suite default path
(`full_suite_lock_acquire` before the resource gate in the `is_default_set` branch;
`full_suite_lock_release` before the full-suite exit). Lock file = `<git-common-dir>/full-suite.lock`
(git `--git-common-dir` resolves to `/home/yale/work/quay/.git` from BOTH the primary checkout and
every worktree — verified — so all checkouts of this repo contend on the SAME inode, covering the
2026-08-07 cross-worktree incident shape). Fallback: `<repo_root>/.quay/full-suite.lock`. Nested
runners skip via `QUAY_TEST_SKIP_RESOURCE_GATE=1` + the same-root `QUAY_TEST_NESTED` guard (a nested
test.sh inside the running suite must not deadlock against the suite's own lock).

**Contract measures:**
- `grep -c "flock\|single-flight\|full-suite.lock" scripts/test.sh` = **17** (≥1 ✓)
- `grep -n "flock\|full-suite.lock\|single-flight" scripts/test.sh` — 17 hits incl.
  `full_suite_lock_acquire`/`full_suite_lock_release` + `flock -w` in `full_suite_lock_acquire`
- `pgrep -af "test-concurrency=8" | wc -l` during the harness = 0 (no other cc8 suite held the new
  lock yet; the two in-flight tasks run the OLD test.sh without the lock)

**AC4 negative control (two concurrent full-suite startups; real test.sh code, verbatim-extracted):**

```
── PHASE 1 (mutual exclusion): A holds the lock; a REAL test.sh full-suite startup is refused ──
[A] lock acquired; holding 6s (simulating a running full suite)...
[B] starting REAL: bash scripts/test.sh --group product,engine (FULL_SUITE_LOCK_TIMEOUT=3) while A holds for 6s...
[B] exit code: 1 (expect 1 = REFUSED, NOT started)
[B] output:
scripts/test.sh: another full suite holds /tmp/...lock — not starting (single-flight lock; waited 3s). Re-run when it finishes.
[PASS] B was REFUSED while A held the lock (did not both-GO)

── PHASE 2 (WAIT/queue): B blocks while A holds; after A releases, B acquires ──
[A] lock acquired; holding 3s...
[B] attempting acquire (FULL_SUITE_LOCK_TIMEOUT=15) while A holds — should BLOCK...
[observer] t+2s: B is still ALIVE and blocked (not entered) while A holds the lock ✓
[A] released
[B] acquired after 3s wait (A released at ~3s) — queued, not both-GO
```

**Structural pin** (`plugin/test/resource-gate.test.mjs`, new AC1/AC4 test): flock ref ≥1,
`full_suite_lock_acquire` in the `is_default_set` branch BEFORE `resource_gate_check`, release before
the full-suite exit, nested escape hatches present. **16/16 pass** (incl. pre-existing AC5/AC7 pins).

**Scoped verification (`scripts/test.sh --for-task <id> --allow-thin`):** scoped static tier clean
(task-contract-check no violations; adr016-screen-use-check PASS; dead-code-after-return-check PASS);
full-suite-runner.test.mjs **25/25 pass**; select-tests-for-touches.test.mjs **19/19 pass**;
resource-gate.test.mjs **16/16 pass**.

**Pre-existing failures NOT caused by this change (verified byte-diff: 0 `mark_nested` lines added):**
`suite-speed-nested-skip.test.mjs` expects 5 `mark_nested` call sites but develop HEAD's test.sh has
6 — a develop/integration drift predating this task (the serial/lowconc five-group phase flow lives
on INTEGRATION, not develop; this change is additive and does not touch `mark_nested`).

**AC3/AC5 cross-annotations (baselines VOIDED + re-measure scheduled):** added to
`tasks/gap-install-suite-cost-instrument-reporter-not-wired.md` and
`tasks/gap-serial-group-recompose-nested-runner-criterion.md` — both baselines measured during the
two-cc8-overlap window are voided; re-measure in a clean single window after the lock lands.

## Dispatch review

reviewer: outer
at: 2026-08-07T19:2xZ
changed: 管理者 19:1x 时间敏感警告：两个 cc8 全量并发跑、基线被 3× 超订污染；根因 = 资源闸门启动时检查
  无单飞锁（零命中 lock/flock）。今晚第七次「机制在、保证没了」。外层裁定：全量套件单飞锁（flock，
  持有整个运行期），与资源闸互补；带锁重测两个任务的基线（并发污染作废）。
