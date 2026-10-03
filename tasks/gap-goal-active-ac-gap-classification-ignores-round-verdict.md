---
id: gap-goal-active-ac-gap-classification-ignores-round-verdict
title: ① active-AC 缺口分类须读本轮判据读数：declared NOT-EVALUATED 的 AC 不得被当 workable 每轮空转
  spawn（AC-327 实测）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-327
---
## Proposal

**机制**：goal-driver 的缺口分类（`computeGoalGaps`，`plugin/scripts/goal-driver.ts:2094`）对 ① active AC population（有 `goal_ac` 关联任务、但全部非牵引 done/superseded、判据仍未达成）在 `count === 0` 分支（`:2266`）**只按判据文本**分类：`state = classifyCriterionKind(r.criterion)`（`:2275`）——该分类器只做一件事：判 criterion 文本里有没有 `.quay/<file>` 生产载体 token，有 ⇒ `world-gated`（不 spawn），无 ⇒ `workable`（spawn）。**它从不读本轮刚跑出来的判据读数**（pass 1 的 `criteria[]`，构造于 `:3231/3253/3360`），而 ②（AC-216 复验域）与 ③（冻结population）两个 population 都有这道「立案前直接量复核」。`isFilingGapState`（`:2623`）把 `workable` 当可立案态、把 `not-evaluated` 排除在 spawn 之外——分类错一格，spawn 就错一格。

**实测**（2026-10-03 主检出，本轮）：AC-327 的判据读 git 提交图 + `goals/*.md` frontmatter（无 `.quay/` token），本轮 pass 1 判它 `verdict: "not-evaluated"`（exit 3；其 `expect` 自陈「尚无 branch-mode goal 并入」，GOAL-028 §判据形态/退出条件写明「在第一个试点 goal 跑起来之前，读 exit 3 是正确输出，不是缺陷」，且试点是**人的动作**）。同一轮 `.quay/goal-round.jsonl` 末行：`criteria` 里 AC-327 `verdict: "not-evaluated"`，但 `gaps` 里 AC-327 `state: "workable"`、`gap_spawns: [{"ac":"AC-327","timedOut":true}]`、`spawned: 1`。即 **driver 在判据【自陈无法评估】的同一轮，仍把它当 workable spawn 了一个 gap-filing worker**——该 worker 无论产出什么都改不了 AC-327 的真值（真值 = 人跑完试点后 develop first-parent 上出现恰一个 `goal/<id>` 合并提交）。旁证：AC-321/324/325/328 都有在飞承载任务 ⇒ `stalled`/`in-progress` ⇒ 不 spawn；AC-327 是唯一承载任务已完成者，也是唯一每轮空转 spawn 者。

**为什么上一个 done 任务没让判据成立**：`gap-goal-branch-ff-merge-source-param`（done，`goal_ac: AC-327`）交付的是 ff-merge 的源参数——AC-327 的一条必要组成（develop 能被 ff 到一个合并提交）。它不会、也不能让 AC-327 取到 exit 0：真值还需要人跑完整个试点（GOAL-028 退出条件①）。driver 把这条「等人/等世界」的判据按文本误判成「还有 worker 能改」的 `workable`，于是每轮派一个空转 worker，而判据本身永远诚实停在 exit 3。

<!-- dedup-ref -->
**与既有任务的关系**：`gap-done-unresolved-conflates-workable-with-world-gated`（done）把旧的 `done-unresolved` 拆成 `workable`/`world-gated`/`unclassified`，但它只加了**文本载体探测**（`.quay/` token）。本任务补的是它的另一格：① population 需要读**本轮判据读数**，因为一条判据可以在文本里没有任何 `.quay/` token 的情况下【自陈无法评估】（exit 3）。

**修法（方向）**：
1. `computeGoalGaps` 增加一个**可选末位参数**（形如 `verdicts: Map<string, "pass" | "fail" | "not-evaluated"> | null = null`）——缺省 `null` 时逐字节保持今日行为（既有调用方与既有单测不传）。
2. 在 `count === 0` 分支（`:2266`）内先看该 AC 本轮 verdict，再决定 state：
   - `not-evaluated` ⇒ `state: "not-evaluated"`、`taskCount: null`（**独立取值**；`isFilingGapState` 为 false ⇒ 不 spawn。硬规则 3b：查不成不得冒充 `workable`）。
   - `fail` ⇒ 维持今日的 `classifyCriterionKind` 三分，逐字不变。
   - verdict 读不到（`null` / map 无此项）⇒ **回落今日行为**（按文本分类）——⛔ 缺值 ≠ 为假（硬规则 6），不得静默变成「查不成 ⇒ 不立案」。
   - `pass` 到不了此分支：pass 1 已把 `verdict === "pass" && status === "active"` 的 AC 机械翻 achieved 并就地改写 `ac.status`（`:3254`），故 `:2246` 的 `status !== "active"` 已跳过它。
3. 生产调用点 `:3465` 由 pass 1 已构造的 `criteria[]` 投影出该 map 传入。
4. ⛔ 不新增 spawn 面、不改 `isFilingGapState`、不改 `worldGatedRoutes`；该 AC 仍每轮在 pass 1 的 gate 集合里被复读（试点一跑，下一轮读数自然转绿）。

## AC

- [x] `plugin/test/goal-driver-s01.test.mjs` 新增用例：同一条 active AC 的 criterion 文本无 `.quay/` token（故文本分类为 workable）、其唯一关联任务 `done`：① 传 verdict=not-evaluated ⇒ `state === "not-evaluated"` 且 `taskCount === null`、`isFilingGapState(state) === false`；② 传 verdict=fail ⇒ `state === "workable"`；③ **不传 verdict（缺省 null）⇒ `state === "workable"`**（负控制：缺值不伪装成 not-evaluated）。
- [x] `runGoalRound` 端到端用例（临时仓库，一条 active AC 的 criterion 自陈 exit 3、其唯一关联任务 `done`）：该轮 `goal_spawns` 不含该 AC、`spawned` 不因它 +1，且 `gaps` 里它 `state === "not-evaluated"`；在 `## Evidence` 贴该轮 `goal-round.jsonl` 末行的 `gaps`/`gap_spawns` 片段。
- [x] 取假：用 `cp` 备份把本任务的核心改动（新参数的 verdict 分支）临时回退（⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] `bash scripts/test.sh --for-task gap-goal-active-ac-gap-classification-ignores-round-verdict` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：本任务落地后 goal-driver 在本工作区跑出的下一轮（`.quay/goal-round.jsonl` 末行）里，AC-327 的 `state` 为 `not-evaluated`（不再是 `workable`），且 `gap_spawns` 不含 AC-327——即一条【判据自陈无法评估】的 active AC 不再每轮消耗一个必空转的 gap worker 名额。判据本身仍诚实停在 exit 3（试点是人的动作，GOAL-028 退出条件①）；本任务只消除「把它误判成有人能做的工作」这一空转面。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-s01.test.mjs
- tasks/gap-goal-active-ac-gap-classification-ignores-round-verdict.md

## Evidence

### AC1 — 单测（`plugin/test/goal-driver-s01.test.mjs`）
用例：`AC1: count===0 分支先读本轮 verdict——not-evaluated 独占一态（taskCount null、不立案）；fail / 缺值回落文本分类`
- ① `new Map([['AC-X','not-evaluated']])` ⇒ `state === 'not-evaluated'`、`taskCount === null`、`isFilingGapState(state) === false`
- ② `'fail'` ⇒ `state === 'workable'`、`taskCount === 1`、`isFilingGapState === true`；②b `'fail'` 且 criterion 读 `.quay/ci-runs.jsonl` ⇒ 仍 `world-gated`（文本三分逐字不变）
- ③ 不传 verdict（缺省 null）⇒ `state === 'workable'`、`taskCount === 1`（负控制：缺值不伪装成 not-evaluated）；③b 传了 map 但不含该 AC ⇒ 同上（逐项读，不整表化）
实跑（scoped 门内）：`✔ AC1: count===0 分支先读本轮 verdict… (0.276134ms)`

### AC2 — runGoalRound 端到端 + `goal-round.jsonl` 末行
用例：`AC2（端到端）: criterion 自陈 exit 3 的 active AC ⇒ 该轮 gaps 落 not-evaluated、gap_spawns 不含它、spawned 不因它 +1`
fixture（临时仓库）：GOAL-001 active；AC-001 active、`criterion: echo "NOT-EVALUATED: 试点未跑" >&2; exit 3`（无 `.quay/` token）；唯一关联任务 `gap-a` status=done、`goal_ac: AC-001`。
该轮 `.quay/goal-round.jsonl` 末行 `goal-ring` fact 摘录：
```
criteria=[{"id":"AC-001","verdict":"not-evaluated"}]
gaps=[{"goal":"GOAL-001","ac":"AC-001","state":"not-evaluated","taskCount":null}]
gap_spawns=[]
spawned=0
```
同一 fixture 另由真 CLI 跑出（exit 0）：
`node --experimental-strip-types plugin/scripts/goal-driver.ts --root <tmp> --script-root <wt> --once --gap-worker-cmd true --resource-gate-cmd true --round-log <tmp>/.quay/goal-round.jsonl`
⇒ 末行 `goal-ring.value`：`criteria` AC-001 `verdict: "not-evaluated"`；`gaps` AC-001 `state: "not-evaluated"`、`taskCount: null`；`gap_spawns: []`；`spawned: 0`。

### AC3 — 取假（cp 备份回退核心改动，⛔ 未用 `git checkout --`）
- 回退前 md5：`03121a963cb6d8529fd297e9585a8768  plugin/scripts/goal-driver.ts`
- `cp plugin/scripts/goal-driver.ts /tmp/ac327-goal-driver.ts.bak`；再把 `count===0` 分支的 verdict 分支精确还原为改动前两行 ⇒ 回退后 md5：`0cd1df4e412cf4cd73a4b3c716f79f38`
- `node --experimental-strip-types --test plugin/test/goal-driver-s01.test.mjs` ⇒ **exit 1**，`ℹ tests 23 / ℹ pass 21 / ℹ fail 2`。两条新用例均红：
```
✖ AC1: count===0 分支先读本轮 verdict…
  AssertionError [ERR_ASSERTION]: 判据自陈无法评估 ⇒ 不得被当 workable（硬规则 3b）
  + actual - expected
  + 'workable'
  - 'not-evaluated'
✖ AC2（端到端）: criterion 自陈 exit 3 的 active AC …
  AssertionError [ERR_ASSERTION]: 自陈无法评估 ⇒ state=not-evaluated（不再误判 workable）
  + actual - expected
  + 'workable'
  - 'not-evaluated'
```
- `cp /tmp/ac327-goal-driver.ts.bak plugin/scripts/goal-driver.ts` 恢复 ⇒ md5 回到 `03121a963cb6d8529fd297e9585a8768` ⇒ `ℹ tests 23 / ℹ pass 23 / ℹ fail 0`（exit 0）。

### AC4 — scoped 门
`bash scripts/test.sh --for-task gap-goal-active-ac-gap-classification-ignores-round-verdict --allow-thin` ⇒ **exit 0**。
被执行的测试文件（`--paths-only` 选择器输出；选择器唯一解析出的一条）：
```
plugin/test/goal-driver-s01.test.mjs
```
该文件实跑 `ℹ tests 23 / ℹ pass 23 / ℹ fail 0`。选择器自报 `test-selection-thin: resolved tests for 1/3 Touches entries (0.33)`——另两条 Touches（`plugin/scripts/goal-driver.ts` 实现文件、`tasks/*.md`）本身不是测试文件；`--allow-thin` 即 fan-in/worker 的同款调用（worker 步骤 2b）。
