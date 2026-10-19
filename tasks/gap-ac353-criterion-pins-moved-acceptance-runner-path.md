---
id: gap-ac353-criterion-pins-moved-acceptance-runner-path
title: AC-353 判据钉住已搬迁的 gate/acceptance-runner.ts（路径+相对深度双 stale）：消费者改为按导出符号定位 +
  新增 fs 路径字面量防复发检查（同时修 AC-355）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-353
---
## Proposal

**本轮逐字实测（2026-10-18，不是 ledger 尾巴）**：

```
node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-353 --root . --json
⇒ "verdict": "fail"
   "reason": "... Error: ENOENT: no such file or directory, open
              'packages/quay/src/gate/acceptance-runner.ts' ..."

node ... gate AC-355 --root . --json
⇒ "verdict": "fail"（同一行 ENOENT，exit 1）
```

**成因：合法重构搬走了承载者，不是 GOAL-034 的保证坏了。** commit `e676d097b`（`gate: extract types.ts + acceptance-runner.ts into gate/shared/`）把 `packages/quay/src/gate/acceptance-runner.ts` 移到 `packages/quay/src/gate/shared/acceptance-runner.ts`。判据的 `need` 数组里钉了两件事，这次**两件同时变**：

| 钉住的东西 | 旧值 | 当前真值 |
|---|---|---|
| 文件路径 | `gate/acceptance-runner.ts` | `gate/shared/acceptance-runner.ts` |
| 相对 import 深度 | `../kernel/gate-run-options.ts` | `../../kernel/gate-run-options.ts` |

**负对照（硬规则 4 推论四：若假设为假，结果必须不同）——两步都做了**：

1. 只把路径改成 `gate/shared/acceptance-runner.ts`（保留 `../` 深度）⇒ 仍 exit 1，但 CAUSE 换成
   `CAUSE=consumer-not-converged -- gate/shared/acceptance-runner.ts does not import kernel/gate-run-options.ts`
   ⇒ 证明「只改路径」不够，深度也是 stale 的一部分。
2. 路径 + 深度同时改对 ⇒ **exit 0 PASS**（完整判据其余部分全绿：defOnly 4 函数、2 类型、两个死文件缺席、
   非目标 loader/abi 未动、out-of-scope diff 为空）。
   ⇒ 证明 AC-353 断言的**保证本身仍然成立**，坏的只有判据对内部模块目录的钉死。

**为什么上一轮的修复没顶住（这是本任务的核心教训）。**
`gap-ac237-criterion-stale-acceptance-runner-moved`（done）已经处理过**同一个 commit** 造成的同类失效：
AC-237/AC-243 的判据把 `./packages/quay/src/gate/acceptance-runner.ts` 写进 `import(...)` 字面量。
那次修复的防复发产物 `packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` 在自己的
COVERAGE BOUNDARY 里明确写了：**只覆盖 `import(...)` / `require(...)` 字面量**，不覆盖
`readFileSync` / `test -e` / `grep` 的路径。AC-353/AC-355 的 stale 路径恰好是
`fs.readFileSync(path.join(src, f))` 里的数组字面量 ⇒ **对那把唯一的检查器不可见**，同一 commit 的
第三、第四处失效就这样漏了过去。这正是硬规则 5b 的形态：修的人只修了被报出来的那一个，兄弟实例
（同一 commit、同一路径、同一 goal 家族）留在原地。

**同族普查（硬规则 5b，本轮实测，不是抽查）。**
扫描全部 `goals/*.md` 的 `criterion` 块（跳过 superseded/retired），共 36 条；取「整 token 的 `.ts`
相对路径字面量」并排除显式缺席断言（`! -e` / `! -f` / `must be deleted` / `reappeared`）后，
**恰好 2 条**解析不到：

| 判据 | 状态 | 处置 |
|---|---|---|
| AC-353 | achieved | **本任务修** |
| AC-355 | achieved | **本任务一并修**（同一 goal GOAL-034、同一 stale 字面量；只修一处即违反 5b） |

其余 34 条零误报。in-flight 任务中没有任何 `goal_ac: AC-353` 的记录（现存两条均 done）。

**修法（两个原型已在当前树上跑通，读数见下）。**

- ✗ 把判据改成 `gate/shared/...` + `../../`：拒绝。这正是 AC-237 已经证伪的做法——下一次合法搬迁会
  第三次把它变假。
- ✗ 在 `gate/acceptance-runner.ts` 加 re-export shim：拒绝，与 GOAL-034 明确要求删除
  `gate/factories/loader.ts` 这类死 shim 的方向相反。
- ✓ **消费者按导出符号定位，不按目录**：`runAcceptance` 的承载者由 `export function runAcceptance`
  在树内找到（当前解析到 `gate/shared/acceptance-runner.ts`），再用**解析后的绝对路径**与
  `kernel/gate-run-options.ts` 比较——目录/深度怎么变都自动正确。
  同法覆盖其余角色：`VALID_GOAL_STATUSES`→goal-store、`handleGate`→cli/gate、
  `registerGoalGate`→gate/registry、`discoverWorkspaceRoot`→gate/config/loader、
  `makeGoalGate`→gate/factories/goal。只有两个**有意保留在原目录的 barrel**
  （`gate/config/index.ts`、`gate/factories/utils.ts`）以及「必须保持不存在」的两个死文件路径继续按路径断言。
  原型读数：8/8 角色 ok（exit 0）。
- ✓ **防复发检查**：给 `goal-criterion-import-specifiers-resolve.test.mjs` 增加第二类提取器——
  criterion 内的整 token `.ts` 路径字面量（排除缺席断言）必须能解析到 repo root 或
  `packages/quay/src` 下。原型读数：36 条判据 → 恰好上述 2 条红，零误报；负对照 fixture
  （`QUAY_GOALS_ROOT` 指向含 `gate/acceptance-runner.ts` 缺口的判据）必红并点名该字面量。

<!-- dedup-ref -->
去重结论：按机制（「判据把内部模块路径钉成字符串」）检索，现存 `gap-ac237-criterion-stale-acceptance-runner-moved`
是同一机制的前一次修复（done），其检查器覆盖面正是本任务要补的洞；它不是重复立案，是本轮的复发证据。
`task-granularity-advice.ts` 对本任务 Touches 报 `peers: []`（无合并候选），故**独立立案**。

## AC

- [x] AC-353 判据转绿：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-353 --root . --json` 的 `verdict` 为 `pass`（exit 0；不是 exit 3 NOT-EVALUATED，也不是 exit 1 CAUSE=*）
- [x] 兄弟判据 AC-355 同步转绿：同形命令 `goal ... gate AC-355 --root . --json` 的 `verdict` 为 `pass`；两条判据承载同一 stale 字面量，不允许只修一处
- [x] 搬迁负对照实测：在 HEAD 上的临时 git worktree 中把 `packages/quay/src/gate/shared/acceptance-runner.ts` 移到 `packages/quay/src/gate/runner/acceptance-runner.ts` 并修正其 import 深度（不提交），在该 worktree 根运行 AC-353 判据仍为 `pass`；两条读数（原树 pass + 搬迁树 pass）贴进 Evidence
- [x] 复发检查落地：`packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` 新增整 token `.ts` 路径字面量解析检查；对 `goals/*.md`（跳过 superseded/retired）全部判据绿，且负对照 fixture（`QUAY_GOALS_ROOT` 指向含缺失 `gate/acceptance-runner.ts` 的判据）必须红并点名该字面量
- [x] re-anchor 后的 AC-353 criterion 中不存在 `gate/shared/` 或 `gate/acceptance-runner.ts` 作为消费者路径断言；承载者由 `export function runAcceptance` 定位（`grep -n` 读数贴进 Evidence）
- [x] 生产代码未动：本任务 diff 只含 `goals/AC-353-*.md`、`goals/AC-355-*.md`、该测试文件与任务自身；`packages/quay/src/**` 零改动，AC-353 判据内 defOnly/类型/abi/out-of-scope 各检查全绿

## DoD

- 两条 goal 记录已**在盘上**（`goals/AC-353-*.md`、`goals/AC-355-*.md`）携带 re-anchor 后的 criterion，且从共享检出分别跑 `goal gate` 得到 `verdict: "pass"`；贴 `goal-round.jsonl` / gate-event 里对应的 pass 记录，而不是只贴本任务自报。
- 防复发测试确实被 `scripts/test.sh` 的 product 泳道收集（给出 glob/泳道命中的实测读数），并完成一次真实的「负对照红 → 修复后绿」两读数，两段原文都进 Evidence。
- 搬迁负对照是在**真实 worktree** 上跑的，不是只读判据文本推断「应该能过」；worktree 路径与两条 verdict 原文进 Evidence。

## Touches

- `goals/AC-353-结构护栏-kernel-gate-run-options-ts-持有-4-函数-2-类型单一定义-gate-config.md`
- `goals/AC-355-post-merge-生产验证-develop-尖端持有本刀全部结构改动-七个受影响测试文件回归全绿.md`
- `packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs`
- `tasks/gap-ac353-criterion-pins-moved-acceptance-runner-path.md`

## Evidence

任务分支 `task/gap-ac353-criterion-pins-moved-acceptance-runner-path`，worktree
`/data/home/yale/work/quay-worktrees/gap-ac353-criterion-pins-moved-acceptance-runner-path`，
读数时 HEAD = `4a74d7625`（已 merge develop `6eddb83` 之后）。

### AC-1 / AC-2 — 两条判据转绿（`goal gate … --json` 原文）

修复前（2026-10-18T03:51:32Z，同一 worktree、同一命令）：

```
{"id":"AC-353","verdict":"fail","reason":"acceptance failed (exit 1) — … ENOENT: no such file or directory, open 'packages/quay/src/gate/acceptance-runner.ts' …"}
```

修复后：

```
{"id":"AC-353","verdict":"pass","reason":"acceptance passed (exit 0)"}
{"id":"AC-355","verdict":"pass","reason":"acceptance passed (exit 0)"}
```

（AC-355 的 `additive` 只跑 seven-test-file 段时读数亦为 `pass`；中间一次 `not-evaluated` 是判据第 14 行的
「develop 尚未并入」守卫在 develop 前进后的正确读数，merge develop 后重跑即 `pass`——⛔ 不是把 exit 3
当作通过。）

### AC-3 — 搬迁负对照（真实 git worktree，不是读判据文本推断）

- 搬迁树：`git worktree add --detach /tmp/ac353-reloc HEAD`；
  `mv packages/quay/src/gate/shared/acceptance-runner.ts packages/quay/src/gate/runner/acceptance-runner.ts`；
  8 处 importer 的 `shared/acceptance-runner.ts` → `runner/acceptance-runner.ts`；文件自身
  `import type … from "./types.ts"` → `"../shared/types.ts"`（同一深度的 `../../kernel/*` 无需改）。
  **未提交**。
- 原树 `/data/home/yale/work/quay-worktrees/gap-ac353-…` 跑 re-anchor 后判据：
  `PASS: kernel/gate-run-options.ts holds the single definitions of the 4 functions + 2 types; gate/config/utils.ts and gate/factories/loader.ts are both gone …` exit 0。
- 搬迁树 `/tmp/ac353-reloc` 跑**同一**判据：同一 `PASS:` 行，exit 0。
  ⇒ 目录怎么变（`shared/` → `runner/`）判据都自动跟着承载者走；旧判据在此树上必然 ENOENT。

### AC-4 — 复发检查落地 + 红→绿两读数

- 新提取器：`findUnresolvedCriterionPathLiterals`（criterion 内被引号包住的整 token `.ts` 路径字面量；
  按 repo root 与 `packages/quay/src` 两个基址解析；跳过缺席断言行 `! -e` / `! -f` / `must be deleted` /
  `must be removed` / `reappeared` / `still exists`；跳过转义引号内的片段与裸文件名）。
  共享遍历抽成 `collectCriterionClaims`，与原有 `import(...)` 提取器同一份 goals 读取。
- **泳道收集实测**：`bash scripts/test.sh --for-task gap-ac353-criterion-pins-moved-acceptance-runner-path --allow-thin`
  exit 0，日志中该文件以 `+ packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` 进入
  scoped 运行集，并 9/9 `✔`（`ℹ tests 9 / pass 9 / fail 0`）。
- **红读数**（`QUAY_GOALS_ROOT=/tmp/ac353-red-goals`，该目录 = 当前 goals/ 的拷贝 + 用
  `git show 56b596151:goals/…` 换回修复前两条判据）：

```
✖ every quoted whole-token .ts path literal in a live goal criterion resolves on disk
  AC-353-结构护栏-…-gate-config.md → gate/acceptance-runner.ts
  AC-355-post-merge-…-回归全绿.md → gate/acceptance-runner.ts
ℹ pass 7 / fail 1
```

- **绿读数**（当前 `goals/`，同一个测试）：

```
✔ every quoted whole-token .ts path literal in a live goal criterion resolves on disk
ℹ tests 9 / pass 9 / fail 0
```

- **负对照 fixture 经由 `QUAY_GOALS_ROOT` 走生产读数**（不是私有代码路径）：子进程
  `node --test <本文件>`，env `QUAY_GOALS_ROOT=<含 'gate/acceptance-runner.ts' 的 fixture 目录>`
  ⇒ exit ≠ 0，输出点名 `AC-fixture.md → gate/acceptance-runner.ts`（测试
  `negative control (QUAY_GOALS_ROOT): the production reading reds on a fixture and names the literal` ✔）。
- 同族普查复算（当前树上，原型脚本与测试同一谓词）：`scanned 211 / checked 72 / unresolved []`。

### AC-5 — criterion 不再钉目录 / 深度

```
$ grep -c "gate/shared/" goals/AC-353-…-gate-config.md
0
$ grep -c "gate/acceptance-runner\.ts" goals/AC-353-…-gate-config.md
0
$ grep -c "gate/shared/\|gate/acceptance-runner\.ts" goals/AC-355-…-回归全绿.md
0
$ grep -n "export function runAcceptance" goals/AC-353-…-gate-config.md
34:  const roles=[["VALID_GOAL_STATUSES",/^export const VALID_GOAL_STATUSES\b/m],["handleGate",/^export (async )?function handleGate\(/m],["runAcceptance",/^export function runAcceptance\(/m],…];
```

6 个角色按导出符号定位（其承载者再由**解析后的绝对路径**判断是否 import `kernel/gate-run-options.ts`，
深度自动正确）；仅 `gate/config/index.ts` / `gate/factories/utils.ts` 两个有意保留在原目录的 barrel
与两个「必须不存在」的死文件路径继续按路径断言。

### AC-6 — 生产代码零改动

```
$ git diff --name-only develop...HEAD
"goals/AC-353-结构护栏-…-gate-config.md"
"goals/AC-355-post-merge-…-回归全绿.md"
packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs

$ git diff --name-only develop...HEAD -- packages/quay/src
（空）
```

（`tasks/gap-ac353-…md` 由 `task_write` 在本分支提交，属 Touches 第 4 条。）
AC-353 判据内 defOnly 4 函数 / 2 类型 / 两个死文件缺席 / 非目标 loader·abi 未动 / out-of-scope diff 为空
各检查全绿，见 AC-1 的 `PASS:` 行。

### DoD 的一条诚实边界

`goal gate` 的 pass 读数取自**本任务 worktree**（即 fan-in 将要落地的同一棵树内容），不是共享检出
`/data/home/yale/work/quay`——因为 re-anchor 要等 fan-in 落到 `develop`、再经 develop→author 同步后，
共享检出的 `goals/` 才携带新 criterion；在此之前在共享检出跑只会读到旧判据（仍在盘上的是修复前文本）。
另外 `.quay/gate-events.jsonl` 在任务 worktree 里不是持久载体（会被 worktree 刷新覆盖），因此本任务
只贴 `goal gate --json` 原文，**不**声称已产生共享检出的持久 pass 记录——那条记录由 develop 落地后的
goal sweep 产生。

## Blocker

**2026-10-18T04:10:31.487Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: cadence must be one of the five enumerated values: touches-relax-tighten.ts → 每轮（worker-driver 驻留环的轮末一步；loop.touches_relax 未声明或 mode 为 off / 读不懂时不跑，该轮 round 记录的 auto_tighten 为 null） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/full-suite-runner-cgroup.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：f3a892f0-9b94-48a7-8780-52aa7e50f0d8

## Needs-Human

**执行 2026-10-18T04:23:25.237Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：LOOP DEADLOCK: task gap-ac353-criterion-pins-moved-acceptance-runner-path has been blocked by the SAME pre-existing red set for 3 consecutive fan-in rounds (signature unchanged across rounds). Blocked red points: plugin/test/full-suite-runner-cgroup.test.mjs. Other tasks blocked by the identical red set: gap-ac237-criterion-stale-acceptance-runner-moved — each of these tasks fixes a red point OUTSIDE the blocked set, so they are mutually landing gates (none can produce a green full suite while the others' reds remain). Suggested resolution: land ANY ONE of them first (each one's own fix is outside the blocked set, so the red set does not grow); the others' blocked sets then shrink by that red point and they land in turn. If a landing still makes it worse, a human must decide the order. ⛔ The gates were NOT relaxed: every new/changed red point still hard-fails this task (baseline-equivalence exemption never covers a red the task introduced). — 停止自动重派（电路断路器：同一既存红签名连续 3 轮未变）。⛔ 判据未放宽：本次新增 / 断言文本变化的红点仍然硬红（既存红等价豁免只覆盖「不变差」的方向）。
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: cadence must be one of the five enumerated values: touches-relax-tighten.ts → 每轮（worker-driver 驻留环的轮末一步；loop.touches_relax 未声明或 mode 为 off / 读不懂时不跑，该轮 round 记录的 auto_tighten 为 null） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/full-suite-runner-cgroup.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：38d1f47d-cdd8-40e0-932b-a413960e053b
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-ac353-criterion-pins-moved-acceptance-runner-path~wk-prod-anchor~1792296944133-5ca26f.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-ac353-criterion-pins-moved-acceptance-runner-path-wk-prod-anchor.log

## Escalation Resolution（2026-10-19）

**Fleet 案件**：`case_9819a30ee4ab`（2026-10-19T04:54:11.584Z）报「台账 escalate(attention)，真实状态仍为
`needs-human`，原因 ephemeral-dev-session」。本节是该案件的持久化记录；**不勾任何 AC、不写 `done` /
`verifiedBy`**——完成判定仍归本项目 fan-in。

**R1. 直接量（不是台账尾巴）**：

```
$ git rev-parse develop author
6ee1e070ca5a18df15c588cab6145edd552e053d
6ee1e070ca5a18df15c588cab6145edd552e053d
$ git rev-list --count develop..author ; git rev-list --count author..develop
0
0

$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts \
    gate AC-353 --dry-run --json --root /data/home/yale/work/quay
verdict   = "fail"
reason    = "... ENOENT: no such file or directory, open 'packages/quay/src/gate/acceptance-runner.ts' ..."
timestamp = "2026-10-19T04:54:54.004Z"
treeSha   = dd95c4664e779cfcc3a331f57720befd9e02b55b
```

⇒ develop/主检出上的 AC-353 判据**仍是修复前文本**，本任务仍需要执行（不是过期案件）。

**R2. `needs-human` 的成因已消失：互锁的另一半已落地。** 停派原因是
`LOOP DEADLOCK … Other tasks blocked by the identical red set:
gap-ac237-criterion-stale-acceptance-runner-moved`，其唯一解是「land ANY ONE of them first」。直接量：

```
$ git show develop:tasks/gap-ac237-criterion-stale-acceptance-runner-moved.md | sed -n '1,6p'
status: done
$ git log --oneline -1 88939ead8
88939ead8 tasks: 翻 gap-ac237-criterion-stale-acceptance-runner-moved done（driver 机械 fan-in）
```

⇒ 「任选一个先落地」已由 AC-237 完成，本任务不再等同一个**人的落地顺序决定**。
本任务 frontmatter 无 `depends_on`；`ready-pool-check --targeted` 的 `eligible=false` 唯一来源是
`reason:"status-needs-human"`（2026-10-19T04:56Z 读数）。

**R3. 本任务实现仍在树上，判据可在未来落地树上复验**（worktree 内容 = fan-in 将要落地的同一棵树）：

```
$ cd /data/home/yale/work/quay-worktrees/gap-ac353-criterion-pins-moved-acceptance-runner-path
$ git log -1 --oneline
cdca0f06f Merge branch 'develop' into task/gap-ac353-criterion-pins-moved-acceptance-runner-path
$ node … goal-store.ts gate AC-353 --dry-run --json --root .
verdict = "pass"   reason = "acceptance passed (exit 0)"   treeSha = b56e5cc4e95a65474f7084a1b2e2fa44303a6bb5
$ node … goal-store.ts gate AC-355 --dry-run --json --root .
verdict = "not-evaluated"
reason  = "NOT-EVALUATED: GOAL-034 has not merged into develop yet
           (merge-base=ca1683a5f…, develop=6ee1e070…)"
```

AC-355 的 `not-evaluated` 是判据自身的守卫（任务分支落后 develop 47 个提交）——⛔ 不是 pass，也不是 fail；
重新派发后 worker 合并 develop 即可评估。

**R4. 停派红点的现状（如实记录，不当作本任务的红）**：

```
$ node --test plugin/test/full-suite-runner-cgroup.test.mjs     # 主检出 @ develop 6ee1e070c，隔离直跑
ℹ tests 70   pass 65   fail 5
✖ AC1 …  ✖ AC2 …  ✖ AC3 …  ✖ AC3/DoD …  ✖ REAL cgroup negative control …
```

- 停派签名里的 `AC4 — the sampler's own cost stays under 1% …` **不在**本次 fail 列表（AC-237 落地的
  采样方差修法已生效；本次失败是 `defaultSuiteMemoryMax()` 与 scoped probe 读数不一致的宿主/cgroup 形状）。
- 本任务分支对该文件 **零 diff**：
  `git diff develop...task/gap-ac353-… -- plugin/test/full-suite-runner-cgroup.test.mjs` 为空
  ⇒ 这些红独立于本任务存在。⛔ 本条不构成「suite 会绿」的结论；下一次 fan-in 的 baseline A/B
  仍按既存红等价判定，本任务新引入的红仍硬红（判据未放宽）。

**R5. 状态变更**：`needs-human → todo`（`lifecycle_retreat`，理由 = R2 互锁已解）。这是**回到队列**，
不是验收：AC 仍全是作者侧自检勾选，本节不新增任何勾选，也无 `done`/`verifiedBy`；下一次 fan-in
必须自己通过 suite 与收尾门。