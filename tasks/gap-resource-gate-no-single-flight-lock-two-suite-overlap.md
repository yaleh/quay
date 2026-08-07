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
status: ready
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

- [ ] AC1: **单飞锁落地**——全量套件默认路径获取 flock 锁（`.quay/full-suite.lock`）持有整个运行期；
      第二个并发启动 WAIT/排队（不再双双 GO）
- [ ] AC2: **与资源闸互补**——闸门防「忙机器启动」、锁防「第二个套件加入」；两者叠加
- [ ] AC3: **带锁重测**——wire-suite-cost-reporter 与 serial-recompose 的基线在干净窗口单跑重取
      （并发污染的作废并标注）
- [ ] AC4: **机械验证**——grep flock ≥1；构造两个并发启动 ⇒ 第二个不进入（负控制）
- [ ] AC5: 与 gap-install-suite-cost-instrument-reporter-not-wired（基线参照）、
      gap-serial-group-recompose-nested-runner-criterion（serial 重组验证）交叉标注——锁落地前它们的
      基线不可信

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体（含两并发启动第二个 WAIT 的对照）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）且**同一时刻只有一套**

## Touches
- scripts/test.sh（全量套件默认路径 flock 锁）
- plugin/scripts/full-suite-runner.ts（若 runner 层需要）
- tasks/gap-install-suite-cost-instrument-reporter-not-wired.md（AC5 交叉标注）
- tasks/gap-serial-group-recompose-nested-runner-criterion.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-07T19:2xZ
changed: 管理者 19:1x 时间敏感警告：两个 cc8 全量并发跑、基线被 3× 超订污染；根因 = 资源闸门启动时检查
  无单飞锁（零命中 lock/flock）。今晚第七次「机制在、保证没了」。外层裁定：全量套件单飞锁（flock，
  持有整个运行期），与资源闸互补；带锁重测两个任务的基线（并发污染作废）。
