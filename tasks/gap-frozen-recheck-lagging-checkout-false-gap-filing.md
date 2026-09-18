---
id: gap-frozen-recheck-lagging-checkout-false-gap-filing
title: 冻结AC的立案前复核在【滞后 develop 的主检出】上执行判据——已落 develop 的修复被读作仍为假 ⇒ 假 gap
  立案（2026-09-18T14:42:07Z 实测一例）；改落独立取值 checkout-lagging-develop
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: plan
goal_ac: AC-221
---
**type:** plan

## Proposal

**本轮的直接量（先于任何结论）**：AC-221 的判据此刻为**真** —— 在主检出 `/home/yale/work/quay` 逐字跑 AC 记录里的 criterion：

```
$ QUAY_GOAL_CRITERION_LIVE=1 node --no-warnings --experimental-strip-types \
    --test plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs
ℹ tests 7   ℹ pass 7   ℹ fail 0            (2026-09-18T14:44:37Z 实测, exit 0)
```

⇒ **AC-221 不需要再修一次**。本任务不修判据，修的是**让本轮立案发生的那条通道**：它把一条已经为真的判据读成「此刻为假」，并据此 spawn 了一个断言「the earlier fix did not hold」的 gap worker（就是本任务）。

**因果链（全部直接量，逐条可复核）**

| 时刻 (UTC) | 事实 | 来源 |
|---|---|---|
| 13:48:25 | 修复提交 `9ea5aa869` 在任务 worktree 中产生 | `git log -1 --format=%cI 9ea5aa869` |
| 14:42:06 | fan-in 把它推到 develop（`develop@{14:42:06}: push → ad8f371a2`；`9ea5aa869 ∈ ad8f371a2`） | `git reflog show develop` + `git merge-base --is-ancestor` |
| 14:42:06.342 | 修复任务翻 `ready→done`（该 AC 的 taskCount 1→0） | `.quay/gate-events.jsonl` gate=complete |
| **14:42:07.914** | 冻结复核**执行判据**（`actor=goal-cli`, `gate=goal`）⇒ verdict **fail**，`actual 1 / expected 0` | `.quay/gate-events.jsonl` |
| 14:43:13 | 主检出（author）才 ff 到 `ad8f371a2`，**首次拿到**修复 | `git reflog show author` |
| 14:44:37 | 同一条判据在主检出上 **7/7 绿** | 本轮实测 |

**根因**：`runPrefilingRecheck`（`plugin/scripts/goal-driver.ts:568`）经 `gateCriterion`（`:274`）→ `goalStoreArgv`（`plugin/scripts/meta-driver.ts:209`，拼 `... goal gate <id> --store --root <dataRoot>`）执行判据 ⇒ **判据的 cwd/根 = goal-driver 的 dataRoot = 主检出工作树（author 分支）**。而修复落在 `develop`，主检出要等下一次 ff 同步才拿到它（本例 67 秒）。⇒ 复核量的**不是 develop 上的实况，而是主检出工作树上的实况**；当修复任务恰在这段窗口内翻 done（taskCount 1→0），③ 冻结分支就把一条**已修复**的判据立案成 `frozen-violated`。

**判据对照（硬规则 4 推论四 —— 能区分）**：`git merge-base --is-ancestor 9ea5aa869 <author@14:28:17>` = **NO**（复核当刻主检出没有修复）；`... ad8f371a2` = **YES**（修复确在 develop）。同一条判据、同一时刻、两个根给出相反结论 ⇒ 差异由**根**造成，不是判据本身。

<!-- dedup-ref -->
**与既有修法的关系**：本条**不是**重复立案，而是同一个缺陷的**第二个通道**。`gap-frozen-violated-files-on-stale-verdict`（done）加的正是这道立案前复核，其理由写在 `goal-driver.ts:465-479`——台账尾最长 4h 陈旧；`gap-ac259-resident-kernel-never-runs-landed-prefiling-recheck`（done）保证它在常驻内核里真的被跑。那两条管的是「**读数（台账尾）**陈旧」；本条管的是「**复核自己的执行根**陈旧」——复核跑起来了，量的仍是旧世界。`gap-ac162-frozen-verdict-predates-fix`（done）是同族的第三例（读数早于修复 9 分 12 秒），其处置是重取读数并落账，与本条要改的机制不同。

**发生率（硬规则 12：先给读数，并标明界）**
- 已逐条复核的实例（**下界**）= **1**：本轮，见上表。
- **上界（代理量，⛔ 不等于发生率）**：`.quay/goal-round.jsonl` 中 `gap_spawns` 非空的轮次共 **217**；其中该 AC 的**下一次**判据执行为 `pass` 的有 **23** 次（与 `.quay/gate-events.jsonl` 联算）。这 23 次**既有**真修复（worker 修完 ⇒ 下一次复核转绿），**也可能含**本通道的假立案 ⇒ 它是上界。要把它变成读数，判据须能回答「那次失败的执行，其根当时是否已经含修复」，这只能逐例核（本条给了 1 例）。

## Plan

1. 给复核读数补上**执行根的新鲜度**：复核前读 `git -C <dataRoot> rev-list --count HEAD..develop` 与该根的 `HEAD` sha，落进 `PrefilingRecheckEntry`（旁证量；⛔ 不设阈值、不参与判据语义）。
2. 复核结论为 `fail` **且**复核根落后 develop（计数 > 0）时，**不**落 `confirmed-failing`，改落**独立取值** `outcome: "not-evaluated"` + `cause: "checkout-lagging-develop"`（硬规则 3b：⛔ 不与 `cleared` 同形，也⛔ 不与 `confirmed-failing` 同形）⇒ 本轮不立案，等下一次复核（届时主检出已同步）。
3. ⛔ **不得**做成一律放过：复核根与 develop 齐平时，`fail` 仍必须落 `confirmed-failing` 并照常立案（正控制，AC2）——否则是把「读不懂」变成「永远放过」，即 3b 的镜像错误。
4. **非 git 根 / 无 `develop` ref 时行为不变**：现有 s10 端到端夹具的根是一个裸 tmp 目录（无 git），其两条既有断言（第 1 轮 `frozen-violated` + spawn、第 2 轮 `cleared` + 不 spawn）必须逐条仍绿 —— 读不到 develop 就不是「根滞后」，⛔ 不得把「读不到」当成「滞后」。
5. 复现夹具：造一个「develop 上已有使判据转绿的提交、而复核根落后 develop」的临时 git 仓库，断言走 ② 且**不产生** `frozen-violated`（AC1）；把同一夹具的复核根同步到 develop 后，断言走 `confirmed-failing` 且**产生**立案（AC2）。两臂都实测。
6. `bash scripts/test.sh --for-task gap-frozen-recheck-lagging-checkout-false-gap-filing` 绿。

## Acceptance Criteria

- [x] AC1（本通道被挡住）：夹具「复核根落后 develop、且 develop 上已有使判据转绿的提交」下，`runPrefilingRecheck` 对该 AC 的 entry 为 `outcome: "not-evaluated"` + `cause: "checkout-lagging-develop"`，且该轮 `computeGoalGaps` **不产出**该 AC 的 `frozen-violated`（`gaps` 无该条、`gap_spawns` 为空）。⛔ 若仍落 `confirmed-failing` ⇒ 假。
- [x] AC2（正向控制，⛔ 不得一律放过）：同一夹具、复核根**与 develop 齐平**且判据真为假时，entry 为 `outcome: "confirmed-failing"` + `cause: "still-false"`，该轮**照常**产出 `frozen-violated` 且 `gap_spawns` 含该 AC。两臂缺一不算。
- [x] AC3（既有行为不被削弱）：`node --no-warnings --experimental-strip-types --test plugin/test/goal-driver-s10.test.mjs` exit 0，两条既有断言（裸 tmp 根：第 1 轮 `confirmed-failing`+立案、第 2 轮 `cleared/now-true`+不立案）逐条仍绿。
- [x] AC4（独立取值，⛔ 不布尔化）：存在断言逐条区分 `checkout-lagging-develop` 与 `cleared`(now-true) / `confirmed-failing`(still-false) / `guard-refused` / `unreadable` 五个取值，且互为不等。
- [x] AC5（留痕可复核）：`PrefilingRecheckEntry` 里能读到本次复核执行根的 `HEAD` sha 与「落后 develop 的提交数」，使事后可区分「查过且合格」「查过且违反」「根滞后没查成」。
- [x] AC6：`bash scripts/test.sh --for-task gap-frozen-recheck-lagging-checkout-false-gap-filing` 绿。

## Definition of Done

- 机制落地并 fan-in 到 develop；AC1–AC6 全勾。
- **生产读数（读生产载体、且只计落地之后的时间窗 —— 硬规则推论三）**：落地后的时间窗内，`.quay/goal-round.jsonl` 的 `frozenRecheck.entries`（或 `.quay/gate-events.jsonl` 对应事件）中存在至少一轮 `not-evaluated` + `checkout-lagging-develop` 的真实记录，且该轮**没有**为该 AC 产出 gap。若该窗口内生产恰无此形状（复核根一直齐平），如实记录实测为零，并给出该窗口内 `git rev-list --count HEAD..develop` 的最大值。⛔ 不得以夹具冒充生产读数。
- **AC-221 的台账闭环**：下一次 goal-driver 复核 AC-221 后 ledger tail 翻 pass（AC-221 由「当前为假」翻回真）；本任务不动 AC-221 的判据文本。

## 落地读数（worker 实测，供 DoD 复核；⛔ 不是夹具读数）

- **生产窗口尚未开始**：本读数在 worker 退出前采集，此刻代码**尚未 fan-in 到 develop**（落地在退出后由 driver 机械 fan-in 完成）⇒ 「落地之后的时间窗」为空，`.quay/goal-round.jsonl` 中 `checkout-lagging-develop` 命中数实测 = **0**（⛔ 这是「窗口为空」，不是「窗口内确实没有」——两者不同形，硬规则 3b）。
- 同一时刻主检出（author，HEAD `e8cf1eb80b21`）与 `develop` **齐平**：`git rev-list --count HEAD..develop` = **0**（`origin/develop` 同为 `e8cf1eb80b21`）⇒ 若窗口此刻开始，本机制不会被触发（触发条件是计数 > 0）。
- ⇒ 上述第二条 DoD 的「最大值」需在落地后的真实窗口里由 goal-driver 复核；worker ⛔ 不以任何夹具读数代替它。

## Touches
- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-s10.test.mjs
- plugin/test/helpers/goal-driver-harness.mjs
- tasks/gap-frozen-recheck-lagging-checkout-false-gap-filing.md
