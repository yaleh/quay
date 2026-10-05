---
id: gap-goal-merge-execution-writes-no-step-trace
title: goal→develop 的并入执行不写 fan-in 步骤轨迹——真实大小的并入慢在哪一步、红在哪一步都读不到，只有请求→结果的整段时间戳
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-325
---
## Proposal

**机制**（2026-10-05/06，GOAL-905 第二次合并演练读到）：任务 fan-in 经 `appendFanInStepTrace`（`plugin/scripts/worker-fan-in.ts:596` 起）把每一步写成 `step-begin` / `step-end`（`step-end` 自带 `durationMs`）到 `.quay/fan-in-step-trace.jsonl`；而 goal→develop 的并入执行 `runGoalMergeFanIn`（`:2513` 起）**不写这条轨迹**。GOAL-905 的并入前后共 6 次尝试，`grep GOAL-905 .quay/fan-in-step-trace.jsonl` 零行；能读到的只有 `goal-merge-request` 与 `goal-merge-result` 两条事件的时间戳，所以只能反推「请求→结果」的整段耗时（如 2026-10-05T16:17:51Z → 16:23:36Z 约 5 分 45 秒；18:22:52Z → 18:26:02Z 约 3 分 10 秒），**读不到 merge、typecheck、scoped 门、suite、ff 各自用了多久**，红了也只有最终那个 `step` 字段。

**后果**：真实大小的并入（本例 24 个文件、60 个新提交）到底慢在哪一步，没有直接量；并入因资源红（例如根分区 ENOSPC，2026-10-06 同一批尝试里读到）时，无法从轨迹上看出是哪一步开始写盘失败。

**修法（方向，实现者可调）**：并入执行的每个步骤（读 develop、建临时 worktree、合并、anti-drift、typecheck、scoped 门、suite、ff、清理）都经同一个 `appendFanInStepTrace` 写 begin/end，`step-end` 带 `durationMs`。`task` 字段放 GOAL id，并加一个可 grep 的判别键（如 `kind: "goal-merge"`），使以 `task` 为键的聚合不会把 goal 当成任务。⚠️ 该载体的现有读者必须先核对、必要时加跳过：`plugin/scripts/instrument-decay-check.ts`、`plugin/scripts/runner-static-gate.ts`（`goal-driver.ts` 的命中是否只在注释里，也请确认，DIR-131 不允许 goal-driver 读本仓落地载体）。

## AC

- [x] `plugin/test/worker-driver.test.mjs` 的 goal 并入端到端用例（临时仓库，注入可控的 suite 结果）新增断言：一次成功的并入在 `.quay/fan-in-step-trace.jsonl` 里为每个实际执行的步骤各写一对 `step-begin` / `step-end`，`step-end` 带数值型 `durationMs`，且这些条目带 `kind: "goal-merge"`；一次 suite 红的并入，轨迹里最后一个 `step-end` 是 suite 且 `ok: false`。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 5b 邻近扫描：`grep -rln 'fan-in-step-trace' plugin/scripts packages/quay/src` 目前命中 `plugin/scripts/instrument-decay-check.ts`、`plugin/scripts/goal-driver.ts`、`plugin/scripts/runner-static-gate.ts`、`plugin/scripts/worker-fan-in.ts`；逐个判断：它按什么键读、写入 goal 条目后会不会被计成任务（贴出会话里实际跑过的验证：喂一份含 goal 条目的轨迹，其输出与不含时一致）；需要且在 Touches 内的一并改。
- [x] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（DIR-131；⚠️ 注释里出现该类字样也会被判红）。
- [x] `node --test plugin/test/worker-driver.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，一次真实的 goal 并入在 `.quay/fan-in-step-trace.jsonl` 里留下各步骤的 `durationMs`，可以直接读出并入慢在哪一步；既有以任务为键的轨迹读数不变。生产读数需要一次真实的 goal 并入才能取到；落地时可能没有，完成记录里须写明该读数是否已取得。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/instrument-decay-check.ts
- plugin/scripts/runner-static-gate.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-goal-merge-execution-writes-no-step-trace.md

## Evidence

2026-10-06，worktree `/data/home/yale/work/quay-worktrees/gap-goal-merge-execution-writes-no-step-trace`，
分支 `task/gap-goal-merge-execution-writes-no-step-trace`，实现提交 `d4708cdb2`（其后 merge develop `4c66a8ff1`）。

### AC1 — 每个实际执行的步骤恰一对 begin/end，`step-end` 带数值 `durationMs`，条目带 `kind:"goal-merge"`

两个 goal 并入端到端用例（临时仓库 + 注入可控 suite 结果）新增断言：green 臂断言 8 个实际执行的步骤各
**恰一对** begin/end、`typeof durationMs === "number"`、`task === "GOAL-901"`、`kind === GOAL_MERGE_TRACE_KIND`；
red 臂断言轨迹里**最后一条** `step-end` 是 `suite` 且 `ok:false`。判别键从写手 `worker-fan-in.ts` 的
`GOAL_MERGE_TRACE_KIND` **import**（⛔ 不在测试里重打一份字面量——改了取值而测试仍绿就是测一个不存在的形态）。

会话里另真跑一次并入（临时仓库，注入 `exit 0` / `echo boom; exit 1`），载体原始行：

```
===== green 并入: outcome=landed step=null =====
{"event":"step-begin","step":"acquire-goal-lock","task":"GOAL-905","kind":"goal-merge"}
{"event":"step-end","step":"acquire-goal-lock","task":"GOAL-905","kind":"goal-merge","ok":true,"durationMs":12}
{"event":"step-begin","step":"acquire-develop-lock","task":"GOAL-905","kind":"goal-merge"}
{"event":"step-end","step":"acquire-develop-lock","task":"GOAL-905","kind":"goal-merge","ok":true,"durationMs":10}
{"event":"step-begin","step":"read-develop","task":"GOAL-905","kind":"goal-merge"}
{"event":"step-end","step":"read-develop","task":"GOAL-905","kind":"goal-merge","ok":true,"durationMs":3}
{"event":"step-begin","step":"worktree-add","task":"GOAL-905","kind":"goal-merge"}
{"event":"step-end","step":"worktree-add","task":"GOAL-905","kind":"goal-merge","ok":true,"durationMs":7}
{"event":"step-begin","step":"merge","task":"GOAL-905","kind":"goal-merge"}
{"event":"step-end","step":"merge","task":"GOAL-905","kind":"goal-merge","ok":true,"durationMs":6}
{"event":"step-begin","step":"suite","task":"GOAL-905","kind":"goal-merge"}
{"event":"step-end","step":"suite","task":"GOAL-905","kind":"goal-merge","ok":true,"durationMs":2}
{"event":"step-begin","step":"ff","task":"GOAL-905","kind":"goal-merge"}
{"event":"step-end","step":"ff","task":"GOAL-905","kind":"goal-merge","ok":true,"durationMs":31}
{"event":"step-begin","step":"branch-delete","task":"GOAL-905","kind":"goal-merge"}
{"event":"step-end","step":"branch-delete","task":"GOAL-905","kind":"goal-merge","ok":true,"durationMs":3}

===== red-suite 并入: outcome=red step=suite =====
（前 5 步同形，末两步是：）
{"event":"step-begin","step":"suite","task":"GOAL-905","kind":"goal-merge"}
{"event":"step-end","step":"suite","task":"GOAL-905","kind":"goal-merge","ok":false,"durationMs":3}
```

两处刻意的取舍（代码内均有注释，此处只记结论）：① 未接线的可选步（anti-drift / typecheck 缺省）**一条都不写**
——该载体每条 `step-end` 必须带布尔 `ok` 与数值 `durationMs`，补一条 `ok:null` 的「未评估」记录会让目标项目
健康探针（`goal-driver.ts` 的 `HEALTH_PROBE_SCRIPT`：`ok` 非布尔 ⇒ 判 `trace-unparseable`）把「这一步没跑」
读成「这个载体读不懂」（硬规则 3b 的反面）；② `finally` 里的收尾（删临时 worktree + mkdtemp 父目录）**刻意不成一步**
——它在 `red()` 之后才跑，若也写 end 则「suite 红的并入」的最后一条 `step-end` 会是收尾而不是失败步（AC1 判据
正是「末条 = suite 且 ok:false」）。

### AC2 — 取假：cp 回退核心改动 ⇒ 新增断言变红；恢复 ⇒ 绿

```
$ cp <wt>/plugin/scripts/worker-fan-in.ts /tmp/wfi-backup-ac2b.ts
$ node /tmp/gm-ac2-mutate.mjs        # 1 处【精确】替换：goal 并入的 traceStep 整体 no-op，签名与参数逐字保留
mutated: goal-merge traceStep is now a no-op (1 exact replacement)

$ node --test plugin/test/worker-driver.test.mjs
✖ goal-merge e2e — green suite: develop gets exactly ONE goal/GOAL-901 merge commit ... (177.493372ms)
✖ goal-merge e2e — red suite: all refs unchanged, a goal-merge-result is written, ... (143.085647ms)
ℹ tests 121   ℹ pass 119   ℹ fail 2
  AssertionError [ERR_ASSERTION]: acquire-goal-lock: 恰一条 step-begin（实测 0）
  AssertionError [ERR_ASSERTION]: suite 红的并入也在共享载体上留了 step-end（实测零条）

$ cp /tmp/wfi-backup-ac2b.ts <wt>/plugin/scripts/worker-fan-in.ts     # 恢复（⛔ 非 git checkout --）
$ node --test --test-name-pattern="goal-merge e2e" plugin/test/worker-driver.test.mjs
ℹ tests 5   ℹ pass 5   ℹ fail 0        # 恢复后绿
```

⚠️ 记一次被丢弃的对照：第一次用 `sed` 做的变异把箭头函数体切断了（`=> void step;` 之后剩 `phase` 在函数体作用域），
5 条用例全红但报的是 `ReferenceError: phase is not defined` —— 那是**变异引入的崩溃**，不是新增断言命中，
故它的「红」不作证据（硬规则 4 推论四：对照必须只在我声称的那个维度上不同）。上表是改成精确替换后的重跑，
红的是**恰好这 2 条**、报的是断言消息。

### AC3 — 5b 邻近扫描：载体的每个命中逐个判定

```
$ grep -rln 'fan-in-step-trace' plugin/scripts packages/quay/src
plugin/scripts/instrument-decay-check.ts
plugin/scripts/capability-catalog-declarations.json
plugin/scripts/runner-static-gate.ts
plugin/scripts/goal-driver.ts
plugin/scripts/checker-mutation-cases/instrument-decay-check.sh
plugin/scripts/checker-mutation-cases/goal-driver-task-boundary-check.sh
plugin/scripts/worker-fan-in.ts
```

（AC 里写的「命中 4 个文件」是立案时的读数；本条命令现在返回 **7** 个——多出的 3 个是此后新增的声明表与夹具。
按硬规则 5 如实记：以立案清单为准会漏判这 3 个，故逐个过。）

**② `instrument-decay-check.ts` —— 唯一的真读者，已改。** 它按 `step` 分组；`expected` 词表与 Shape B 都是按
任务 fan-in 步骤链定的。不跳过的两个方向都坏：并入步若与任务步同名（ff/typecheck/suite…），会把**任务侧写手已停写**
的分组刷成「仍在写」⇒ 真腐烂被掩盖；若另起名，低频的 goal 并入会被 Shape B 判成 rate-stopped ⇒ 误报。
新增 `CarrierSpec.skipKind`，判据是**精确等于** `"goal-merge"`（⛔ 不是「有 kind 就跳过」——历史记录都没有该字段，
宽松谓词会把全部历史一起过滤掉，那是把「读不懂」伪装成「零腐烂」）。实跑：

```
$ node /tmp/gm-trace-ac3-decay-verify.mjs      # 同一份轨迹的两种形态（只含任务记录 / 追加 goal 记录）
── 不含 goal 条目 ──  {"ok":true,"evaluated":true,"decayedCount":0,...,"totalRecords":12,"groupCount":12,...}
── 含 goal 条目 ──    {"ok":true,"evaluated":true,"decayedCount":0,...,"totalRecords":12,"groupCount":12,...}
outputs identical: true        # 逐字一致（goal 的 18 条记录整体不计入：totalRecords/groupCount/companions 全不变）
```

负控制（把 skip 判据改成恒假后再跑同一脚本）：`outputs identical: false` —— 该判据不是空转，它确实在做那件事。

**③ `runner-static-gate.ts` —— 不是读者，不改。** 4 处命中全是以 `#` 开头的注释行（静态门自述的 `@static-object` 清单
与 P5 成因说明），按位置判（剥掉注释行）后命中 0：

```
$ grep -vE '^\s*(#|//)' plugin/scripts/runner-static-gate.ts | grep -c 'fan-in-step-trace'
0
```

**④ `goal-driver.ts` —— 不读本仓这份载体，不改。** 唯一非注释命中在 `HEALTH_PROBE_SCRIPT` 模板字符串里
（`const tracePath = path.join(q, 'fan-in-step-trace.jsonl')`，`q = path.join(root, '.quay')`，`root = process.argv[2]`
= **目标项目**的根）；本工作区 `plugin/scripts/drivers.yml` 声明 `kinds.goal.target_host: ad-arm1` /
`target_root: /home/yale/work/archguard` ⇒ 它读的是那台机器上那个项目的同名文件。

⚠️ **实测偏离 AC 的预期，如实记**：探针是「窗口内 `step-end` 行的原样转储」（只滤 `event`/`step`/`task`/`epoch`/`ok`，
**不按 `task`/`kind` 归类**），所以喂含 goal 条目的轨迹后它的 `fanInSteps` **确实会变**：

```
$ node --experimental-strip-types /tmp/gm-trace-ac3-goaldriver-verify.mjs     # 跑探针原载荷（node - <root> <carriers>）
── without-goal ── fanInSteps: [merge-develop, typecheck, scoped-gate, ff]   （4 行，全 ok:true）
── with-goal ──    fanInSteps: [ ...同上 4 行..., acquire-goal-lock(GOAL-905), ff(GOAL-905), suite(GOAL-905,ok:false) ]
fanInParseErrors: 0   traceTruncated: false
```

判定**不改**，两个理由：(a) 它读的是**目标项目自己的**载体，DIR-131 管的是「goal 侧不得以**本仓自身**的落地载体为输入」，
这条不构成反例（AC4 的边界检查据同一口径 exit 0）；(b) 目标项目自己的 goal→develop 并入**本来就是那个系统的 fan-in**，
它的失败正是这条外部视角读数（`fan-in-failing`）应当报出来的东西，加一条跳过反而会把真失败藏起来。该文件也不在 Touches 内。

**⑤ `capability-catalog-declarations.json` —— 声明面，不是读者，不改。** 其 QUESTION（「载体某分组停写而伴生分组仍在写」）
与 INVALIDATION（「写手不退役不改名、载体仍承担跨任务聚合」）描述的行为与前提本次改动都没有触及。

**⑥⑦ `checker-mutation-cases/{instrument-decay-check,goal-driver-task-boundary-check}.sh` —— 夹具，不是读者。**
前者实测仍绿（它注入的形态是「抽掉 4 个 suite 决策步」，夹具记录**没有** `kind` 字段 ⇒ 与 `skipKind` 正交）：

```
$ bash plugin/scripts/checker-mutation-cases/instrument-decay-check.sh <tmpdir>; echo $?
0
```

### AC4 / AC5 — 两条退出码

```
$ node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts; echo $?
goal-driver-task-boundary-check: PASS — goal-driver.ts has no task-write call sites (task_write/lifecycle_*/fs.write-to-tasks) and no OWN-REPO fan-in/落地率 carrier reads outside the target-probe exempt span
0

$ node --test plugin/test/worker-driver.test.mjs; echo $?
ℹ tests 121   ℹ pass 121   ℹ fail 0
0
```

### DoD — 生产读数是否已取得：**未取得**（如实记录）

本次落地时**没有可执行的 goal 并入请求**，故拿不到「真实大小的并入」的时长读数：`.quay/gate-events.jsonl` 里最近一条
`goal-merge-result` 是 `2026-10-05T21:05:57.882Z`（GOAL-905，`outcome: landed`）；`git branch --list 'goal/*'` 为空
（分支已随落地删除）；且生产 worker-driver 从主检出加载代码，本改动此刻只在任务分支上。

⇒ 上表 AC1 的读数是**注入 suite 结果的端到端用例真跑 `runGoalMergeFanIn`** 得到的——走的是真实的
`mkdtemp → git worktree add → git merge --no-ff → suite → ff-merge → branch -D` 路径，⛔ 不是 fixture 自证。
真实大小的并入时长读数据需**下一次真实并入**（人 `quay goal merge` 之后由 worker-driver 执行）才能取到，
届时 `grep '"kind":"goal-merge"' .quay/fan-in-step-trace.jsonl` 即可直读各步 `durationMs`。

DoD 的另一半「既有以任务为键的轨迹读数不变」**本轮已取到**：instrument-decay-check 在含 / 不含 goal 条目两种输入下
输出逐字相同（见 AC3②），且该检测器的既有 15 条用例与 mutation case 均绿。
