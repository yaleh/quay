---
id: gap-meta-writegoalstatus
title: goal-driver 的 activate 判决被能力闸拒绝时必须落一个具名阻塞读数——否则同一条 draft AC
  每轮重判、永不进入缺口环，其缺失载体也永不被委托
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
AC-920/AC-922 已连续 10/9 轮停在 draft+cause=capability（判据的被执行载体 plugin/test/unencapsulated-state-admission.test.mjs 不存在）；goal-driver 第⑧步每轮对它们调 writeGoalStatus(…, active) 被能力闸拒绝后只留 flips{ok:false, reason:<散文>}，没有任何消费者读 ok:false、载体路径埋在自由文本里 ⇒ 这两条 AC 既不进 computeGoalGaps（只数 active）、也永远不会被委托造载体，而 GOAL-911 的退出条件④要求 AC-920 achieved ⇒ 该 goal 结构上不可达；已 done 的 gap-goal-triage-activate-executed 只断言 flips 含 to==active，对被拒的 ok:false 同样成立

本轮读数（criteria.AC-920.cause）= `"capability"`，采于 2026-10-22T11:44:13Z，由 meta-driver 机械采集。
⚠️ 机制词 `writeGoalStatus` 命中【已完成】任务：gap-cross-project-replay-verify-goal-timeout-and-anti-drift-fixes-on-claudecodeui-and-quay-fleet.md[done]、gap-fidelity-judge-unwired-in-production-and-verdict-stubbed-in-tests.md[done]、gap-goal-branch-goal-flips-achieved-before-its-branch-merges.md[done]、gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics.md[done]、gap-goal-driver-draft-ac-invisible-yet-blocking.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

### 「先查那些 done 任务」的结论（落地前先做的核查）
五条 done 任务各自修的是**别的半边**，没有一条覆盖本缺口：
- `gap-goal-triage-activate-executed` 接线了 ⑧ 的**判决消费**，判据只断言 `flips` 含 `to=="active"`——对**被拒**的那次（`ok:false`）同样成立，故它结构上看不见本缺口；
- `gap-goal-driver-draft-ac-invisible-yet-blocking` 落的是 `unreachableDrafts`（**draft GOAL** 名下的 draft AC），本缺口是 **active GOAL** 名下的 draft AC，对象集不相交；
- `…ac-activation-gated-on-traction…` 改的是**判决口径**（牵引不再是激活前提），不是被拒时的读数；
- `…fidelity-judge-unwired…` 接的是 P6b 保真性判定器；`…goal-branch-goal-flips-achieved-before-its-branch-merges` 接的是 achieved 翻转的并入前置。
⇒ 结论：**已有机制在管、只是失败**（⑧ 的 activate 消费就是那个机制），故按 DoD 第 2 条**修它**，⛔ 不新建并行机制。

## AC
- [x] `node --test plugin/test/goal-driver-activation-blocked.test.mjs` ⇒ 新测试驱动一轮 goal-driver（夹具，非自述）：一条 draft AC 的激活被能力闸拒绝时，轮记录的 goal-ring fact 必须带具名 activationBlocked 条目（ac 名 + cause=criterion-capability-unevaluated + 缺失载体路径）；负控制——同一 AC 的判据变为可认证并激活成功后，该条目消失

## DoD
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence

### 改动（worktree `/data/home/yale/work/quay-worktrees/gap-meta-writegoalstatus`，分支 `task/gap-meta-writegoalstatus`，提交 `af5d0ac68`）
- `plugin/scripts/goal-driver.ts` —— goal-ring fact 新增 `activationBlocked: ActivationBlockedReading[]`，由 ⑧ 的失败半边填充：`{ac, goal, cause, storeCode, missingCarriers, rules, carrierReading, reason}`；轮 fact 摘要行补 `activationBlocked=N`（同 `closeUnmergedBranch` 那次「拦截发生了却在一行摘要里读不出来」的 5b 教训）。
- `plugin/scripts/goal-driver.ts` —— `classifyActivationRefusal(root, {ac, goal, criterion}, reason)`：**只有**能力闸造成的写失败才落条目（锁/usage/其它失败返回 `null`，⛔ 不被伪装成「判据能力有问题」）。缺失载体路径由 Core `criterion-capability.ts` 的**同一份**判定器在本进程复判得到（`reasons[].detail`），⛔ 不从散文里抠。
- `plugin/scripts/driver-runtime.ts` —— 该判定器经 Layer 0 的单一导入面 surfacing（`judgeCriterionCapability` / `readCapabilityDeclaration`），⛔ goal-driver 不写 Core 源码树字面量（AC-262，`goal-driver-s06` 的源文本硬检查守着）。
- `plugin/test/goal-driver-activation-blocked.test.mjs` —— 新测试（真 goal-store CLI 夹具，⛔ 不注入 seam）。

### 为什么必须复判、⛔ 不能解析拒绝文本（硬规则 4c）
`writeGoalStatus` 把子进程 stderr `slice(0, 200)` 后回传：`cannot activate AC-NNN: <code>: criterion refused BEFORE execution — … uncertifiable-executed-artifact: <path> …` 的首段就占 ~150 字符 ⇒ **缺失载体路径正好落在截断点之外**。这不是「解析麻烦」，是「这个量穿不过中间层」（4c 的恒假/空转两种失败形态都在这里）。

### cause 词表与 store 机读码（近形但⛔ 不合并，已记录）
`cause` 是**轮记录词表**（`criterion-capability-unevaluated` / `criterion-side-effect`，本任务 AC 契约钉死）；store 的稳定机读码 `criterion-capability-unevaluable`（-able）逐字存在 `storeCode` 字段里。两者改任一都会静默打断读另一边的消费者（5b），故**两个字段各存一种**，代码里有逐字注释。

### 实跑读数（本机，worktree 内，Node v24.21.0）
```
$ node --test plugin/test/goal-driver-activation-blocked.test.mjs
✔ ① 能力闸拒绝的激活 ⇒ goal-ring fact 落具名 activationBlocked 条目（ac + cause + 缺失载体路径） (1894.9ms)
✔ ② 负控制：载体造出来（判据可认证）后同一 AC 激活成功，该条目消失 (3527.2ms)
✔ ③ 取假半边：工作区声明了写能力 ⇒ cause 是 criterion-side-effect，且 missingCarriers 为空 (1626.8ms)
ℹ tests 3  ℹ pass 3  ℹ fail 0
```
- **取假验证（DoD 1，实测，⛔ 非自述）**：临时把 `if (blocked !== null) activationBlocked.push(blocked);` 改成 `&& false` ⇒ 同一命令 **3 条全红**（`ℹ pass 0 / fail 3`），改回后全绿。
- **回归面**：`goal-triage-activate-executed` / `goal-triage` / `goal-driver-s06`（AC3 Core 字面量硬检查）/ `goal-posture-blocks-activate` / `goal-driver-s09` 共 27 条全绿。

### 本任务**没有**做的事（如实记录，⛔ 不要读成已完成）
本任务只落 AC 契约要求的**具名读数**；把 `activationBlocked` 接进 `runGapSpawnPass` / `computeGoalGaps`（即真正把「缺载体」那条 draft AC 委托出去）**未做**——那需要新增一个缺口态并改 `GoalGapState` 词表与既有消费方，超出本任务 `## Touches`。⇒ AC-920 类缺口现在**读得出来**，但**仍不会被自动立案**；消费半边是后续独立任务的对象。

## ADR-007 暗轴读数
- L_D: docLines=0 codeLines=299 ratio=0.000（`git diff --numstat develop...HEAD` = 10+133+156，本任务全部改动；无 .md 变更 ⇒ 0 是「没有文档改动」而非未测量）
- L_G：该轴仍暗,理由:本任务复用 Core 既有的 criterion-capability 判定器（经 Layer 0 导入面取符号），未新增第二份抽象/重复实现，故未触发 detect_duplicates 复算；唯一新增 import 边是 plugin/scripts → core/criterion-capability.ts，方向与既有 kernel 依赖一致。

## Touches
- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/test/goal-driver-activation-blocked.test.mjs`
- `tasks/gap-meta-writegoalstatus.md`

## Blocker

**2026-10-22T12:16:55.761Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: at least one bin is under-sampled (otherwise the rule is vacuous) [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/full-suite-runner-cgroup.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：eb498ffa-e65f-41b5-81f9-66ae3a959c61
