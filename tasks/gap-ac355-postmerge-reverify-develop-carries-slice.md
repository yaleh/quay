---
id: gap-ac355-postmerge-reverify-develop-carries-slice
title: AC-355 post-merge 判据转假：goal-store.ts 因 411bb34c7 的合法重构不再直连
  kernel/gate-run-options.ts —— 承接 AC-353 在飞修复，在 develop 尖端复验结构臂 +
  七个测试文件（含可证伪负对照）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac353-goal-store-deadline-resolver-not-kernel
goal_ac: AC-355
---
**type:** execution

## Proposal

AC-355（GOAL-034 post-merge 生产验证）的判据本轮**直接重跑**为假（不是台账尾巴）：`CAUSE=post-merge-regression -- goal-store.ts no longer imports kernel/gate-run-options.ts on develop`（`.quay/gate-events.jsonl` `2026-10-12T21:09:39.014Z` goal-cli pre-filing 复核；同轮 sweep `2026-10-12T21:08:43.720Z` 同 CAUSE）。这是判据的**单点**转假：本轮把全部断言逐条复跑，除 `need` 八元组的第一条 `goal-store.ts` 外**全部通过**（读数见 `## Evidence`）。

根因是机械事实，不是求解：`git log -S'./kernel/gate-run-options.ts' -- packages/quay/src/goal-store.ts` 恰回两条 —— `56ba0b61b`（GOAL-034 的落地提交，**加入** `import { resolveAcceptanceTimeoutMs } from "./kernel/gate-run-options.ts"`）与 `411bb34c7`（**移除**它）。`411bb34c7` 把 goal-store 的判据 deadline 解析从 kernel 的 `resolveAcceptanceTimeoutMs` 换成了 record-aware 的 `resolveAcceptanceTimeout`（定义在 `gate/acceptance-runner.ts`）——**该重构的意图正确**（record 自身的 `timeoutMs` 必须继续被尊重），但 goal-store.ts 从此不再是 kernel 模块的直接消费者。

转假的时间线（同一 `criterionHash=5d784080cca767d4`，即**判据没被改过**）：

- `2026-10-12T17:26:18.369Z` sweep **pass**；
- `2026-10-12T17:32:43Z` develop 首父链首次持有 `411bb34c7`（提交 `1dfc42b2a`，其 `^1` = `5987f5610` 不含它）；
- `2026-10-12T21:08:43.720Z` sweep **fail**。

⇒ 树变了，判据没错。**本任务不回退 `411bb34c7` 的行为**，也**不重锚 AC-355 的判据来凑绿**：该臂是**可恢复的**结构性事实（不是 stale pin），恢复它有一条 ownership 正确的修法 —— 把 record-aware 的 `ACCEPTANCE_TIMEOUT_ENV` / `AcceptanceTimeout` / `resolveAcceptanceTimeout` / `timeoutKnobHint` 四者与既有底座 `resolveAcceptanceTimeoutMs` / `DEFAULT_ACCEPTANCE_TIMEOUT_MS` 合回同一 kernel leaf（同一个「acceptance 超时解析」族不该被劈在两个文件里）。该修法正由在飞的 `gap-ac353-goal-store-deadline-resolver-not-kernel`（`goal_ac: AC-353`）在**任务分支树**上执行，而 AC-353 的判据里**同一条臂、同一个正则、同一个文件**也一起转假 —— 两 AC 是同一次结构转假的两半。

本任务持有的是它的 **post-merge 那一半**：peer 的落地进入 develop 之后，在 **develop 尖端**复验同一结构事实 + 七个受影响测试文件回归，并给出**可证伪**的读数（不是把判据跑绿就算）。

<!-- dedup-ref -->
与 `gap-ac353-goal-store-deadline-resolver-not-kernel`（`goal_ac: AC-353`，status todo）是两条**独立保证**、两片**不相交**的 Touches：那条改 `packages/quay/src/{kernel/gate-run-options.ts,gate/acceptance-runner.ts,goal-store.ts}` 与一个测试文件，判据在**分支树**上 exit 0；本任务只写自己的任务体，判据在 **develop 尖端** exit 0。`depends_on` 指向它 —— 结构臂的真值来自它，本任务**不自带源码改动**。另两条 done 任务（`goal-034-merge-and-postmerge-verify`、`gap-ac355-criterion-false-from-goal-acceptance-active-guard`）虽同为 `goal_ac: AC-355`，但不是可替代的重复，理由见下方「上一次修复为什么没保住」。

### 上一次修复为什么没保住（两条 done 均 `goal_ac: AC-355`，故不构成重复）

- `goal-034-merge-and-postmerge-verify`（done）：它做的是一次性的「触发合并 + 并入后核验」，只在**干净 shell** 里跑过 `quay goal gate AC-355 --dry-run` ⇒ exit 0。它**从未在 driver 的求值环境里验过**，因此从未观测到机制给自己下毒的形态（这一点后来由下一条指出）。
- `gap-ac355-criterion-false-from-goal-acceptance-active-guard`（done）：它修的是**测试那一臂**的环境污染 —— driver 在跑判据前置位 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`，被判据末尾的 bare `node --test` 继承 ⇒ `goal-store.test.mjs` 8 红。它**没有、也不可能**护住**结构那一臂**；结构臂随后被 `411bb34c7` 一次合法重构打断 ⇒ 判据再次转假。

⇒ AC-355 的保证有**两条彼此独立的腿**（结构臂 / 测试臂），历史两次修复各只覆盖了其中一条的**当时形态**。本任务承接结构腿的 post-merge 复验；测试腿本轮实测已绿（含 driver 求值环境，见 Evidence 读数 4），复验时仍须一并重跑 —— 结构修复本身可能把它碰红。

## Plan

1. **前置确认**（任一不满足 ⇒ 把实测读数写进 `## Evidence` 并如实收尾，⛔ 不勾 AC、⛔ 不放宽判据）：peer 的落地已在 develop 尖端 —— `git show develop:packages/quay/src/goal-store.ts | grep -nE 'from "\./kernel/gate-run-options\.ts"'` 命中；且在主检出上 `git merge-base develop HEAD` == `git rev-parse develop`。branch lag 会让后一条不成立，而它与「没落地」**同形**（硬规则 4b；已知形态 `production-carrier-static-red-can-be-branch-lag`）⇒ 先查 `git rev-list --count develop..HEAD`，再怀疑没落地。
2. **在 develop 尖端跑 AC-355 判据原文**：`quay goal gate AC-355 --dry-run --json --root /data/home/yale/work/quay` ⇒ **exit 0**；逐字贴 stdout（`verdict` / `cause` / `event.payload.evaluationRoot` / `treeSha`）。exit 3 ⇒ 求值树不是 develop 子孙（先查 branch lag）；exit 1 ⇒ 把同行 `CAUSE=` 逐字记下，⛔ 不改判据迁就结果、⛔ 不把求值树换成 peer 分支（那会换掉被验对象）。
3. **第二来源：七个测试文件独立重跑两遍** —— ⛔ 只跑一遍干净 shell 不算（这正是上一条 done 未保住的形态）。干净 shell 与 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`（driver 求值环境的前置变量）各跑一次 `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --no-warnings --experimental-strip-types --test <七个文件>` 与 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1 node …`，两次都要 `fail 0`，逐字贴 `ℹ tests / pass / fail` 三行。
4. **可证伪负对照（本任务的核心价值，硬规则 2 / 4 / 4c）**：证明判据的 `goal-store.ts` 那一臂是**真实测量**，不是恒真、也不是空转。在 scratch 副本上做**双向**变异，各跑判据的该臂并贴读数：
   - 正控：把 `import { … } from "./kernel/gate-run-options.ts";` **前置**到 `goal-store.ts` 的 scratch 副本 ⇒ 该臂必须变 **OK**（证明正则能命中，不是恒假）；
   - 负控 A：把同一行**注释掉**（`// import …`）⇒ 该臂必须仍 **MISS**（证明按位置判定，注释不算命中，硬规则 2）；
   - 负控 B：整棵树上该 import **消失**（若 peer 的落地已进 develop，则在 scratch 分支上 revert 那一行）⇒ 判据必须 exit 1 且 `CAUSE=post-merge-regression -- goal-store.ts no longer imports kernel/gate-run-options.ts on develop`。
   ⛔ 只贴「我改了文本」不算 —— 要贴**跑出来的红绿**。（立案轮已做过前两条的等价读数，见 Evidence 读数 6；复验时在**转真之后**重做，才证明这次是测量。）
5. **台账留痕**：`.quay/gate-events.jsonl` 出现 `item_id=AC-355` / `gate=goal` / `verdict=pass` 的新事件（贴 `timestamp` 与 `payload.criterionHash`；若 hash 与 `5d784080cca767d4` 相同即再次证明「判据未改、是树变了」）；`quay goal show AC-355 --json` 的 `evidence.verdict` 由 `fail` 转 `pass`。
6. **不越界**：本任务**零源码改动** —— `git diff --name-only develop...HEAD -- packages/quay/src packages/quay/test plugin goals` 输出为空；Touches 只含本任务体。⛔ 不 `quay goal write` 改 AC-355 的 `criterion`；⛔ 不重启任何 driver / `serve`。
7. **自查**：`node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/<id>.md` exit 0；`node packages/quay/bin/quay.ts task check <id> --json` 为 `ok:true` 且 `acChecked == acTotal`。

## AC

- [x] **AC1（判据在 develop 尖端转真）**：`quay goal gate AC-355 --dry-run --json --root /data/home/yale/work/quay` ⇒ **exit 0**，stdout 原文进 `## Evidence`；且 `git merge-base develop HEAD` == `git rev-parse develop`。—— 一条命令 + 退出码。
- [x] **AC2（七个测试文件双向实测，含 driver 求值环境）**：干净 shell 与 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 下各跑七个文件，**两次都 `fail 0`**，逐字贴两次的 `ℹ tests / pass / fail` 三行。—— 两条命令 + 退出码。
- [x] **AC3（负对照双向，硬规则 2 / 4 / 4c）**：① 前置该 import（scratch）⇒ 该臂 OK；② 该 import 被注释（scratch）⇒ 该臂 MISS；③ 该 import 从树上消失 ⇒ 判据 exit 1 且 `CAUSE=post-merge-regression -- goal-store.ts no longer imports kernel/gate-run-options.ts on develop`。三次均贴命令 + 逐字读数。
- [x] **AC4（台账留痕）**：`.quay/gate-events.jsonl` 新增 `item_id=AC-355` / `verdict=pass` 事件，贴 `timestamp` + `payload.criterionHash`；`quay goal show AC-355 --json` 的 `evidence.verdict` = `pass`。—— 命令 + 读数。
- [x] **AC5（结构读数）**：`packages/quay/src/kernel/gate-run-options.ts` 存在；`packages/quay/src/gate/config/utils.ts`、`packages/quay/src/gate/factories/loader.ts` 不存在；`need` 八元组本轮实测 **8/8 OK**（逐条列出命中）。—— `ls` / `grep` + 读数。
- [x] **AC6（不越界，且判据文本零改动）**：`git diff --name-only develop...HEAD -- packages/quay/src packages/quay/test plugin goals` 输出为空。—— 命令 + 空输出。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本没被改、dry-run 绿了」，而是：

1. **对象**：AC-355 的判据**原文未改**地在 **develop 尖端** exit 0（`--dry-run` stdout 原文 + 退出码留痕，`treeSha` 指向的树即 develop 尖端）。
2. **第二来源**：七个测试文件在**两个**环境（干净 shell / driver 求值环境变量）各实测 `fail 0` —— ⛔ 单跑一次干净 shell 不算，这正是上一次 done 未保住的形态。
3. **可证伪**：三条定向变异（前置 / 注释 / 移除）各自的红绿如实留痕 —— 证明该臂既不是恒真，也不把注释当命中。
4. **台账**：`.quay/gate-events.jsonl` 新增 `verdict=pass` 事件，AC-355 的 `evidence.verdict` 由 `fail` 转 `pass` —— 一条 `--dry-run` 输出**不算**。
5. **不越界**：`packages/quay/src`、`packages/quay/test`、`plugin`、`goals` 零改动；AC-355 的 `criterion` 文本零改动；未重启 driver / `serve`。
6. 本任务自身 `done` 并随 fan-in 落地。

## Touches

- tasks/gap-ac355-postmerge-reverify-develop-carries-slice.md

（本任务零源码/测试改动：它是一条 **post-merge 验证**任务，deliverable 是读数、可证伪负对照与台账留痕；durable guard 归 AC-353 那条任务的载体。同形先例：`goal-034-merge-and-postmerge-verify`，Touches 同为 self-touch-only。）

## Evidence

（filing 轮读数，全部本轮实测，供 worker 复核起点）

**1. 判据转假的确切形态** —— `.quay/gate-events.jsonl` 里 `AC-355` 的末三条：

```
2026-10-12T17:26:18.369Z  goal-sweep  pass  criterionHash=5d784080cca767d4  "acceptance passed (exit 0)"
2026-10-12T21:08:43.720Z  goal-sweep  fail  criterionHash=5d784080cca767d4  CAUSE=post-merge-regression -- goal-store.ts no longer imports kernel/gate-run-options.ts on develop
2026-10-12T21:09:39.014Z  goal-cli    fail                                        （pre-filing 复核，同行同 CAUSE）
```

同一 `criterionHash` ⇒ **判据未变，是它所读的树变了**。

**2. 树变在哪一刻** —— `git log -S'./kernel/gate-run-options.ts' -- packages/quay/src/goal-store.ts` 恰回两条：`56ba0b61b`（GOAL-034 落地，加入）/ `411bb34c7`（作者时间 2026-10-13T01:01:16+08:00，移除）。develop 首父链首次持有 `411bb34c7` 的是 `1dfc42b2a`（2026-10-12T17:32:43Z），其 `^1` = `5987f5610`（不含它，`git merge-base --is-ancestor` 报非零）⇒ 比 17:26:18Z 那次 pass 晚 6 分钟，正是 21:08:43Z 那次 sweep 判红的时刻。

**3. 当前 develop 尖端读数** —— HEAD `ca3e9a0a5`，`git merge-base develop HEAD` == `git rev-parse develop` == `ca3e9a0a57d6aeb554b42fe939f48d353141dacd`；`git diff develop HEAD` 为空（故在本检出测得即 develop 尖端测得）。

**4. 七个测试文件本轮实测 —— 两个环境都全绿**（这条必须记下，上一条 done 的成因正是「只在干净 shell 里验」）：

```
干净 shell                              : EXIT=0  ℹ tests 219  ℹ pass 219  ℹ fail 0
QUAY_GOAL_ACCEPTANCE_ACTIVE=1           : EXIT=0  ℹ tests 219  ℹ pass 219  ℹ fail 0
```

⇒ `gap-ac355-criterion-false-from-goal-acceptance-active-guard` 给 `goal-store.test.mjs` 加的自净（模块加载时保存并删除该变量、`test.after` 还原）**仍然有效**；本次转假与它无关。

**5. `need` 八元组逐条**（在当前 develop 尖端，剔注释行后按位置判）：

```
OK   cli/gate.ts                 -> ../kernel/gate-run-options.ts
OK   gate/acceptance-runner.ts   -> ../kernel/gate-run-options.ts
OK   gate/registry.ts            -> ../kernel/gate-run-options.ts
OK   gate/config/loader.ts       -> ../../kernel/gate-run-options.ts
OK   gate/config/index.ts        -> ../../kernel/gate-run-options.ts
OK   gate/factories/utils.ts     -> ../../kernel/gate-run-options.ts
OK   gate/factories/goal.ts      -> ../../kernel/gate-run-options.ts
MISS goal-store.ts               -> 现为 from "./gate/acceptance-runner.ts"
```

其余各臂同轮通过：`kernel/gate-run-options.ts` 存在；`gate/config/utils.ts`、`gate/factories/loader.ts` 均不存在。

**6. 立案轮对该臂的正/负控制读数**（证明它不是恒假、也不把注释当命中；复验时须在**转真之后**重做一次同样三态）：

```
as-is（该 import 不在）                : MISS   <- 与判据今天的 CAUSE 一致
把该 import 前置到 scratch 副本        : OK     <- 正则能命中，该臂不是恒假
把该 import 写成 `// import …`         : MISS   <- 按位置判定，注释不算命中（硬规则 2）
```

**7. 与在飞任务的臂等价性** —— AC-353 判据的 `need` 第一条是**同一个文件 + 同一个正则**（`["goal-store.ts", /from\s*["']\.\/kernel\/gate-run-options\.ts["']/]`）；其立案轮读数同为 `CAUSE=consumer-not-converged -- goal-store.ts does not import kernel/gate-run-options.ts`。⇒ 两条 AC 由**同一次结构转假**共同转假，恢复它的源码改动在 AC-353 那条任务上。

### 复验轮读数（worker，2026-10-13；本节即本任务的交付物，零源码改动）

**R1. 前置确认（Plan 1）—— peer 落地已在 develop 尖端；主检出一度 lag，随后由 driver 追上**

```
$ git show develop:packages/quay/src/goal-store.ts | grep -nE 'from "\./kernel/gate-run-options\.ts"'
83:import { resolveAcceptanceTimeout, timeoutKnobHint } from "./kernel/gate-run-options.ts";   ⇒ HIT
$ git show develop:tasks/gap-ac353-goal-store-deadline-resolver-not-kernel.md | head -3   ⇒ status: done
```

复核起点（21:43Z）主检出滞后：`author=8e7cd49ef  develop=2cbc7f52a`，`git rev-list --count develop..HEAD = 10`
⇒ 该时刻主检出上 `merge-base(develop,HEAD)=8e7cd49ef ≠ develop`，同一判据命令给 **exit 3 `not-evaluated`**。
⇒ 这是 **branch lag，不是「没落地」**（硬规则 4b；已知形态 `production-carrier-static-red-can-be-branch-lag`）：
落地本身 HIT（上一行），`git merge-base --is-ancestor 8e7cd49ef develop` = YES。
21:45Z 起 driver 把 `author` 快进到 develop（`author == develop`，lag=0），此后主检出即 develop 尖端，AC1 的**字面命令**可直接 exit 0（见 R2）。
（⛔ 本任务未自行 sync 主检出、未重启任何 driver —— 快进是 promotion-driver 自己做的。）

**R2. AC1：判据原文在 develop 尖端 exit 0（字面命令，`--root /data/home/yale/work/quay`）**

```
$ node packages/quay/bin/quay.ts goal gate AC-355 --dry-run --json --root /data/home/yale/work/quay
EXIT=0
verdict = "pass"   cause = null   reason = "acceptance passed (exit 0)"
event.payload.evaluationRoot = "/data/home/yale/work/quay"
event.payload.treeSha        = "0630e11b70fe20392d396292c7440a10dcc4761d"

不变式: git merge-base develop HEAD            = 5bd3c9f772f1b0867d7ce2aae1eca5ded8969e51
        git rev-parse develop                  = 5bd3c9f772f1b0867d7ce2aae1eca5ded8969e51   ⇒ 相等
        git rev-parse HEAD^{tree}              = 0630e11b70fe20392d396292c7440a10dcc4761d   ⇒ 即上面 treeSha（求值树 = develop 尖端）
```

同一命令在**任务 worktree**（`git merge develop` 后 == develop 尖端）上另跑一次，读数一致：

```
$ node <main>/packages/quay/bin/quay.ts goal gate AC-355 --dry-run --json --root <worktree>   # worktree HEAD == 2cbc7f52a == develop
EXIT=0  verdict="pass"  evaluationRoot=<worktree>  treeSha=26de88ce0ecfc234dd0b51f26bbca4be9e9034b6
$ git -C <worktree> rev-list --count develop..HEAD  ⇒ 0
```

**滞后期的诚实读数（同一命令、同一时刻、lag 未消时的主检出根）** —— 保留于此，因为它正是本任务要区分的形态：

```
verdict = "not-evaluated"  cause = "declared"
reason  = "... exit 3 — NOT-EVALUATED: GOAL-034 has not merged into develop yet
           (branch=author, merge-base=8e7cd49efe79c6fc723cfba0d3f11aee1b69b55f, develop=2cbc7f52a09364abf0d23da7a1c5b44a7f170d60)"
```

⇒ 判据把「主检出 lag」呈现为 `exit 3`、把「真回归」呈现为 `exit 1 + CAUSE=`，是**两个不同的取值**，没把「无法评估」伪装成「通过」（硬规则 3b）。

**R3. AC2：七个测试文件 × 两个环境（develop 尖端 `2cbc7f52a`）**

```
干净 shell (env -u QUAY_GOAL_ACCEPTANCE_ACTIVE)  : EXIT=0  ℹ tests 219  ℹ pass 219  ℹ fail 0
QUAY_GOAL_ACCEPTANCE_ACTIVE=1                    : EXIT=0  ℹ tests 219  ℹ pass 219  ℹ fail 0
```

（另：R2 两次求值中，判据自带的末段 `node --test <七个文件>` 亦随两个端点各跑一次，均 exit 0。）

**R4. AC3：可证伪三态 —— scratch 副本，四状态各跑判据原文**

scratch = `git worktree add --detach <scratch> develop`（+ `dispatch-worktree-setup.sh` 供 node_modules），逐态改 `packages/quay/src/goal-store.ts` 后
`node <main>/packages/quay/bin/quay.ts goal gate AC-355 --dry-run --json --root <scratch>`；每次改前 `git checkout --` 还原：

| 状态 | `goal-store.ts` 里那一行 | 命令 exit | 逐字读数 |
|---|---|---|---|
| S0 as-is | `import { resolveAcceptanceTimeout, timeoutKnobHint } from "./kernel/gate-run-options.ts";`（line 83） | **0** | `verdict=pass  reason="acceptance passed (exit 0)"` |
| S1 负控A（注释） | `// import { resolveAcceptanceTimeout, timeoutKnobHint } from "./kernel/gate-run-options.ts";` | **1** | `verdict=fail  reason="acceptance failed (exit 1) — CAUSE=post-merge-regression -- goal-store.ts no longer imports kernel/gate-run-options.ts on develop CAUSE=post-merge-structural-scan-red -- the scan above printed the specific CAUSE"` |
| S2 负控B（移除） | （该行不存在） | **1** | 同上，逐字相同 |
| S3 正控（前置到 line 1） | 该行插在文件第一行 | **0** | `verdict=pass  reason="acceptance passed (exit 0)"` |

- S1 与 S2 **同读数** ⇒ 该臂按位置判定，**注释不算命中**（硬规则 2）。
- S3 在「S2 已移除」的副本上把该行前置回树即转 OK ⇒ 该臂**不是恒假**（硬规则 4）。
- 四态 `evaluationRoot` 均为 `<scratch>`；四态 `treeSha` 均为 `26de88ce0ecfc234dd0b51f26bbca4be9e9034b6`
  —— `treeSha` 取的是 `HEAD^{tree}`（**已提交**树），不随工作树变异移动 ⇒ 四态的红绿差异确由**工作树内容**造成，不是 treeSha 变化造成的（这条是负控制本身的自检）。

**R5. AC4：台账留痕** —— `.quay/gate-events.jsonl` 中 `AC-355` filing 之后的新事件：

```
2026-10-12T21:39:51.205Z  goal-cli  pass  treeSha=97352f8b6ea1714a02dde68e0048e9e9f50c6c6b  payload.criterionHash=(absent)
2026-10-12T21:47:14.683Z  goal-cli  pass  treeSha=26de88ce0ecfc234dd0b51f26bbca4be9e9034b6  payload.criterionHash=(absent)
```

`quay goal show AC-355 --json` ⇒ `evidence = {"at":"2026-10-12T21:47:14.683Z","verdict":"pass","reading":"acceptance passed (exit 0)","firstAt":"2026-10-10T06:05:25.459Z"}`
⇒ 由 `fail` **转 `pass`**。

`criterionHash` 只挂在 goal-**sweep** 形状的事件上（goal-cli 形状不带该字段 —— 已知形态 `goal-gate-event-carries-no-criterion-hash`）；带 hash 的末三条为：

```
2026-10-12T13:58:20.668Z  goal-sweep  pass  criterionHash=5d784080cca767d4
2026-10-12T17:26:18.369Z  goal-sweep  pass  criterionHash=5d784080cca767d4
2026-10-12T21:08:43.720Z  goal-sweep  fail  criterionHash=5d784080cca767d4   ← 转假那一次
```

⇒ pass 与 fail 两侧 **同 hash** ⇒ 判据文本未改，变的是它所读的树。

**R6. AC5：结构读数（develop 尖端）** —— `need` 八元组逐条（剔注释行后按位置判；正则原文取自判据本体，未手抄）：

```
OK   goal-store.ts              -> /from\s*["']\.\/kernel\/gate-run-options\.ts["']/
OK   cli/gate.ts                -> /from\s*["']\.\.\/kernel\/gate-run-options\.ts["']/
OK   gate/acceptance-runner.ts  -> 同上
OK   gate/registry.ts           -> 同上
OK   gate/config/loader.ts      -> /from\s*["']\.\.\/\.\.\/kernel\/gate-run-options\.ts["']/
OK   gate/config/index.ts       -> 同上
OK   gate/factories/utils.ts    -> 同上
OK   gate/factories/goal.ts     -> 同上
⇒ 8/8 OK, 0 MISS
```

文件存在性：`packages/quay/src/kernel/gate-run-options.ts` **EXISTS**；`packages/quay/src/gate/config/utils.ts` **ABSENT**；`packages/quay/src/gate/factories/loader.ts` **ABSENT**。
`git show develop:packages/quay/src/goal-store.ts | sed -n '83p'` ⇒ `import { resolveAcceptanceTimeout, timeoutKnobHint } from "./kernel/gate-run-options.ts";`

**R7. AC6：不越界 + 判据文本零改动**

```
$ git diff --name-only develop...HEAD -- packages/quay/src packages/quay/test plugin goals   ⇒ (空，0 行)
$ git diff --name-only develop      -- packages/quay/src packages/quay/test plugin goals   ⇒ (空，0 行)   # 含未提交改动
$ git status --porcelain -- <同四路径>                                                      ⇒ (空)
AC-355 criterion 文本 sha256[:16] = bfa1eb72656b2448（与 filing 轮一致；⛔ 未调用 goal write 改 criterion）
未重启任何 driver / serve（promotion-driver / worker-driver 全程 running=1，pid 4127584 未变）
```

**R8. 复验轮与立案轮的前提差异（必须记，否则读数会被误读）** —— 立案轮的前提是「peer 落地尚未进 develop、`goal-store.ts` 在该尖端仍 MISS」；复验时该前提**已反转**：peer `gap-ac353-goal-store-deadline-resolver-not-kernel` 已 `done` 且其修复已进 develop（`goal-store.ts:83` 命中）。
⇒ 本任务由「等落地」变为「在**已落地**的尖端复验」，Plan 第 3/4 步的红绿形态随之从「as-is MISS → 前置 OK」翻为
「as-is **OK** →（注释）MISS →（移除）exit 1 →（前置）OK」（见 R4）——这正是「在**转真之后**重做，才证明这次是测量」的落点。
