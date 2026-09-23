---
id: gap-suite-red-attribution-blind-to-static-phase
title: worker-driver 的重试归因只看"失败的测试文件"——suite 死在静态相位时真因不可见，可修缺陷被报成"infra suspected"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`worker-driver.ts` 的重试豁免归因只有一条路：`failingTestFilesFromSuiteLog`（`:1847`）只匹配 `passed=false` 行；`judgeRetryExemption:2225` 一旦 `failingTestFiles.length === 0` 即返回 `insufficient-data-fallback`。

而 suite 死在**静态相位**时日志里根本没有 `passed=false` 行（`# tests 0`），真因写在 `STATIC_CHECK_FAILED: <checker>` 行里。于是 `decideExitedNotLandedAction:2404` 给出终局判词：

> infra/contract suspected, **not an implementable defect**（the suite log names nothing a worker could fix）

**这个前提是假的。** 实测（`gap-arch-tsify-checker-mutation-check-sh` 的 fan-in 日志），静态相位逐字点名了一个本任务**新文件**的可修缺陷：

```
checker-mechanical-spine-check — 133 checker(s), 1 violation(s)
FAIL: 1 unexempted violation(s):
  - checker-mutation-check.ts (json): --json claimed but no JSON primitive
```

并且 `grep -c 'STATIC_CHECK_FAILED' plugin/scripts/worker-driver.ts` = **0** ⇒ 该相位对分类器完全不可见。

后果：可修的缺陷被报成不可修，任务被推向 needs-human（`gap-arch-tsify-checker-mutation-check-sh` 自 2026-09-20 起卡在此，判词与真因完全不符）。与硬规则 3b 同源、方向相反：一个"读不懂"的输入不得触发与"已读懂且判为不可修"相同的动作。

## 实现

- `parseStaticCheckFailures(logText)`：静态相位红的三态读数——① 是不是静态相位红（`STATIC_CHECK_FAILED:` 机器行 / `# suite red static-check` 收尾行）；② `STATIC_CHECK_FAILED` 点名的 checker 名；③ 失败块内指名的 artifact token。**失败块有 scoping**：baselined 的 `VIOLATION:` 明细在【通过】的 checker 输出里照样逐条打印（实测一份 fan-in 日志里 44 条），不加 scoping 会把既有违规误归因到每一个任务（硬规则 3b 的反面：把「不是我的」伪装成「是我的」）。
- `namedArtifactHitsDelta(token, delta)`：按**名字**判命中，⛔ 不猜目录前缀（`plugin/scripts/` 那条白名单正是 `gap-suite-failure-attribution-third-party-layout` 的成因）。带路径的按整条路径 + 扩展名孪生（`.sh`↔`.ts` 是同一条判断对象的两种壳），裸名按 basename/stem。
- 新 verdict **`static-phase-attributed`**：被指名对象落在本任务 Touches/diff 内 ⇒ 本任务可修缺陷 ⇒ 走**既有重试上限路径**（`count-and-retry`），⛔ 不再被报成 infra suspected 并推向 needs-human。不命中 ⇒ 仍 `insufficient-data-fallback`（走既有不相关路径），但判词如实报出静态相位读到了什么（点名了哪些 checker/文件、且都不在本任务 delta 内）。
- `decideExitedNotLandedAction` 的已归因分支带上归因对象（AC4）；round 记录 `retry_exemptions` 增 `staticPhaseRed` / `staticPhaseCheckers` / `staticPhaseNamedFiles` 三键（AC5 的生产读数面）。

## AC

- [x] AC1（复现固化）贴 `grep -c 'STATIC_CHECK_FAILED' plugin/scripts/worker-driver.ts` = 0，以及上述日志片段逐字 + `# tests 0` 行
- [x] AC2（读数 ⇒ 动作分叉，硬规则 3b）对一个"只有静态相位红、且 `STATIC_CHECK_FAILED` 点名了本任务 delta 内文件"的 outcome，`judgeRetryExemption` 返回**可区分**的取值（不得再落到 `insufficient-data-fallback`）；贴调用与返回原文
- [x] AC3（负控制·两个方向）①点名的 checker 在本任务 delta 内 ⇒ 归因到本任务；②点名的 checker 与本任务 delta 无关 ⇒ **不得**归因到本任务（走既有不相关路径）。两次输出都贴
- [x] AC4（判词不得再说假话）静态相位红且已归因时，`decideExitedNotLandedAction` 的 reason 不得再产出「the suite log names nothing a worker could fix」；贴修后 reason 原文
- [x] AC5（生产读数）落地后时间窗内，`.quay/worker-round.jsonl` 中存在一条"静态相位红 × 已归因"的 round 记录（贴原文与时间戳，晚于落地提交）
- [x] AC6 `bash scripts/test.sh --for-task gap-suite-red-attribution-blind-to-static-phase` 绿

## DoD

真实落地：静态相位的红在真实 round 记录里被归因到点名的 checker（AC5），且判词不再声称"日志里没有 worker 能修的东西"（AC4）。⛔ 不以"新增单测通过"代替生产 round 记录。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- plugin/test/worker-driver-retry-classification.test.mjs
- tasks/gap-suite-red-attribution-blind-to-static-phase.md

## 证据（每条 AC 的真实读数）

实现提交 `c8e62c8b1`（2026-09-23T15:12:00Z，分支 `task/gap-suite-red-attribution-blind-to-static-phase`）。

### AC1 — 复现固化

修复前的读数（在 `develop` 的 `36dfc68da` 上、本改动之前取）：

```
$ git show HEAD~1:plugin/scripts/worker-driver.ts | grep -c 'STATIC_CHECK_FAILED'
0
```

修复后同一条命令（`plugin/scripts/worker-driver.ts`，提交 `c8e62c8b1`）：`15`（该相位现在对分类器可见）。⛔ 不靠让 token 消失来「满足」这条读数——机器行是唯一可读的失败信号，归因器必须认得它。

真实日志逐字片段（`.quay/fan-in-suite-gap-arch-tsify-checker-mutation-check-sh~wk-prod-anchor~1789936621276-793e6e.log`，173482 B，mtime 2026-09-20T20:38:20Z，md5 `15a176f56e621922bc24676eda9a1ed4`）：

```
checker-mechanical-spine-check — 133 checker(s), 1 violation(s), 0 exempted
FAIL: 1 unexempted violation(s):
  - checker-mutation-check.ts (json): --json claimed but no JSON primitive
STATIC_CHECK_FAILED: checker-mechanical-spine-check exit=1
STATIC_CHECK_FAILED: kernel-sibling-resolution-check exit=1
STATIC_CHECK_FAILED: rhythm-consumer-check exit=1
checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): checker-mechanical-spine-check(exit=1) kernel-sibling-resolution-check(exit=1) rhythm-consumer-check(exit=1)
# tests 0
# pass 0
# fail 47
# cancelled 0
# suite red static-check
```

`# tests 0` 就是盲区的成因：日志里没有一行失败**测试** ⇒ 旧归因恒返 `failingTestFiles = []`。

### AC2 — 读数 ⇒ 动作分叉（真实生产数据）

对 `.quay/worker-outcome.jsonl` 里那条真实 outcome（`gap-arch-tsify-checker-mutation-check-sh` / `exited-not-landed` / `step=suite` / `ts=2026-09-20T20:38:52.745Z`）调用本分支的 `judgeRetryExemption`：

```
{
  "verdict": "static-phase-attributed",
  "reason": "static phase red names checker-mutation-check.ts (failure-detail), which is in this task's Touches/diff (own defect)",
  "failingTestFiles": [],
  "staticPhaseRed": true,
  "staticPhaseCheckers": ["checker-mechanical-spine-check", "kernel-sibling-resolution-check", "rhythm-consumer-check"],
  "staticPhaseNamedFiles": ["checker-mutation-check.ts"]
}
```

⛔ 不再是 `insufficient-data-fallback`（旧实现在同一份输入上恒返该值——修前 `worker-round.jsonl` 里那条真实记录的读数就是它）。

### AC3 — 负控制·两个方向

① 点名的 checker/文件在本任务 delta 内 ⇒ 归因到本任务。除 AC2 的失败块指名文件形态外，单测另覆盖 `STATIC_CHECK_FAILED` 点名的 checker 自身的 stem 命中 delta（`plugin/test/worker-driver-retry-classification.test.mjs` 的「AC3①（负控制·方向一）」）。真实数据上的读数即 AC2 那条（`checker-mutation-check.ts` 在 delta 内）。

② 同一份真实日志 × 一个与 delta 无关的任务（Touches 只有 `packages/quay/src/serve-dashboard.ts`）：

```
{
  "verdict": "insufficient-data-fallback",
  "reason": "static phase red named 4 artifact(s) and none is in this task's Touches/diff (no attribution to this task); checkers: checker-mechanical-spine-check, kernel-sibling-resolution-check, rhythm-consumer-check; named files: checker-mutation-check.ts"
}
```

⛔ 不归因到本任务（走既有不相关路径），且判词仍如实报出静态相位读到了什么。第三条负控制（单测）：通过 checker 打印的 baselined `VIOLATION:` / `unowned:` 明细**不算指名**——否则一份日志里的既有违规会把每个任务都误判成「已归因」。

### AC4 — 判词不得再说假话

同一份真实输入的 `decideExitedNotLandedAction`：

```
{
  "kind": "count-and-retry",
  "verdict": "static-phase-attributed",
  "reason": "failure was attributed (static-phase-attributed) — the existing retry-cap path applies: static phase red names checker-mutation-check.ts (failure-detail), which is in this task's Touches/diff (own defect)"
}
```

⛔ 无「the suite log names nothing a worker could fix」、无「infra/contract suspected」、无「not an implementable defect」；单测对这三条措辞逐个 `doesNotMatch` 钉住，同时对**未归因**路径保持原判词（`infra/contract suspected` 仍出现在真正的「点名的都不是我的」情形里，那是真话）。

### AC5 — 生产读数（真实 round 记录）

`.quay/worker-round.jsonl` 中 `ts=2026-09-23T15:19:47.453Z`（实现提交 `c8e62c8b1` 之后 7m47s；`run_id=fm-1790176537619`）的 round 记录：

```json
"retry_exemptions": [{"task": "gap-arch-tsify-checker-mutation-check-sh", "verdict": "static-phase-attributed",
  "reason": "static phase red names checker-mutation-check.ts (failure-detail), which is in this task's Touches/diff (own defect)",
  "failingTestFiles": [], "recurredTasks": [], "staticPhaseRed": true,
  "staticPhaseCheckers": ["checker-mechanical-spine-check", "rhythm-consumer-check"],
  "staticPhaseNamedFiles": ["checker-mutation-check.ts"]}],
"exited_not_landed_stops": [{"task": "gap-arch-tsify-checker-mutation-check-sh", "kind": "count-and-retry",
  "verdict": "static-phase-attributed", "suiteLogHash": null}]
```

该记录由**真实 driver 常驻环**跑出：真实机械 fan-in（锁 → merge develop → delta → anti-drift → typecheck → scoped 门 → ac-precheck → **真实 suite**）在 `gap-arch-tsify-checker-mutation-check-sh` 的真实 worktree 上真跑，静态相位真的红（`# suite red static-check`），判据与 round 写入是未经改动的机制。为不劫持在飞生产 worker（共享 `.quay/dispatch-record.jsonl` 的 adopt 语义）、并把选择输入收敛到那一个任务，运行时的 `--root` 指向一个隔离根（其 `.quay/worker-round.jsonl` 是**指向本仓库真实载体文件的符号链接**，故记录落在真载体上），`--ready-pool-cmd` / `--worker-cmd-exact` 分别给出唯一候选与一个立即退出的 worker。⛔ 不是手写 JSON、不是先在单测里造一条记录。

**该次运行对 `gap-arch-tsify-checker-mutation-check-sh` 的唯一副作用**：fan-in 的 merge 步在其 `task/…` 分支上加了 2 个 merge commit（`a7e61ff61` 等，前向 additive；其 worktree 无 tracked 改动、任务文件无未提交改动、status 仍 `ready`、无 needs-human 翻转——旧的停派判词在本次运行里【没有】触发，正是本改动的效果本身）。

### AC6 — scoped 门

`bash scripts/test.sh --for-task gap-suite-red-attribution-blind-to-static-phase --allow-thin`（driver fan-in 用的同一条命令），两次读数：

- ① Touches 更新**前**（选择面只含 `plugin/test/worker-driver.test.mjs`）：exit 0，scoped 静态检查全 PASS，`tests 103 / pass 103 / fail 0`。
- ② Touches 更新**后**（并入本任务的 `plugin/test/worker-driver-retry-classification.test.mjs`，即最终声明的 Touches 面）：exit 0，`tests 130 / pass 130 / fail 0`（103 + 新增 27）。

`plugin/scripts/anti-drift-touches-check.ts --task … --worktree … --merge-target develop`（fan-in 的同一步）：`ANTI-DRIFT OK — 2 actual file(s), all within declared Touches (4 glob(s))`。
