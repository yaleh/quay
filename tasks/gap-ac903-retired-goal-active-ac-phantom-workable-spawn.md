---
id: gap-ac903-retired-goal-active-ac-phantom-workable-spawn
title: AC-903 判据已 exit 0 却被 goal-driver 每轮判 workable 并空转 spawn：GOAL-903 已
  retired 而 AC-903 仍 active ⇒ 从不被 gate（verdict 缺值）⇒ 文本回落 workable；修分类器（缺值≠为假）+ 把
  AC-903 收尾为 achieved
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-903
---
## Proposal

**AC-903 判据此刻为真；被 spawn 的不是「判据为假」，是分类器对【缺值】的回落。**（立案轮直接量，2026-10-03，主检出 `/data/home/yale/work/quay`）

```
$ set -u
$ git log --fixed-strings --grep="翻 T-903-drill done（driver 机械 fan-in）" --format=%H develop | grep -q . || { echo "CAUSE=goal903-drill-landing-missing" >&2; exit 1; }
PASS: GOAL-903 drill landing present
$ echo $?
0
$ quay goal gate AC-903 --json   ⇒   "verdict":"pass","reason":"acceptance passed (exit 0)"
```

翻 done 提交 `e3b52327fe1aa9576621136116239313e62b1b61` 于 `2026-10-03T12:37:36Z` 已 ff 进 develop（`git reflog show develop` 该时刻条目 tip 即该提交）。⇒ gap-filing prompt 的「still FALSE」前提与实况相反。

**真正的缺陷（机制）**：AC-903 仍 `status: active`，其 GOAL-903 已 `retired`。每轮 gate 的 pass 1 只遍历 **active goal** 的 AC（`activeGoalIdsOf`，`plugin/scripts/goal-driver.ts`）⇒ AC-903 **从不被 gate** ⇒ 本轮 `verdicts.get("AC-903")` **缺值**。`computeGoalGaps` 的 ① active-AC 分支（`plugin/scripts/goal-driver.ts:2312-2349`）：

```
status=active ∧ allAssociated=2（T-903-drill、gap-goal903-drill-landing-missing，均 done）
              ∧ traction=0 ∧ roundVerdict=缺值（verdicts 无该键）
  ⇒ roundVerdict !== "not-evaluated" ⇒ state = classifyCriterionKind(criterion)
  ⇒ criterion 正文无 `.quay/` token ⇒ "workable" ⇒ isFilingGapState=true ⇒ 每轮 spawn
```

本轮轮记录逐字（`.quay/goal-round.jsonl`，round 5，ts `2026-10-03T13:01:10.369Z`）：

```
fact goal-gaps  {"goal":"GOAL-903","ac":"AC-903","state":"workable","taskCount":2}
```

`workable` 的**前提**本该是「判据仍未达成」，而判据此刻 exit 0。这是硬规则 6 的形态：**缺值（verdict 从未产生）与 `fail` 共用同一回落**（`:2337-2349` 注释明写 `fail`/读不到 回落文本分类）⇒ 一条为真的判据被当成假，每轮派一个产不出任何东西的 worker（本形态当前唯一命中：AC-903）。

**为什么上一次修没有覆盖它**：

<!-- dedup-ref -->
已 done 的 `gap-goal-active-ac-gap-classification-ignores-round-verdict`（其 goal_ac: AC-327）只给**显式 `not-evaluated` verdict** 开了专属取值（`:2343`），**未处理 verdict 缺失**（AC 从未被 gate）。两者同族但机制不同：那条修的是「判据自陈无法评估」；本条修的是「判据**根本没被问过**」——后者在 `verdicts` 里是**没有这个键**，不是值为 `not-evaluated`。逐文件扫 `goals/*.md`：`status=active` 而所属 GOAL 非 active 的 AC **仅 AC-903 一条**（已枚举）。

**本任务做什么**（两件，缺一不可）：

① **修分类器（class）**：`computeGoalGaps` 的 ① active-AC 分支里，对「**所属 GOAL 非 active ⇒ 本轮从不被 gate ⇒ verdict 缺值**」的 AC，**不得**回落文本分类产出可立案的 `workable`。按硬规则 6/3b 给「从未评估」一个与 `fail` **不同形**的落点，最小改动二选一：(a) 该形态落 `not-evaluated`（taskCount null，不 spawn）；(b) 把这类 AC 纳入 gate 使 verdict 真实产生（则 pass ⇒ 驱动 pass 1 自行翻 achieved）。⛔ 只针对该形态、⛔ 不改其它 population 的语义；必配单测。

② **收尾 AC-903（instance）**：其判据 exit 0 ⇒ 经 **goal store CLI** 写为终态 `achieved`（即驱动 pass 1 本会写下的那个值）：`quay goal write AC-903 --origin "<一句为什么>" --status achieved`。写两处根（本任务 worktree + 主检出），使本轮驱动即读不到该缺口，且变更随本任务 fan-in 落到 develop。⛔ 不手改 `goals/AC-903-*.md`；⛔ 不改判据文本；⛔ 不碰其它 AC/GOAL 记录。

## AC

- [ ] AC1（复现：判据为真 + 被分类为 workable，两条直接量并列）。逐字跑 `goals/AC-903-*.md` 的判据 ⇒ `PASS: GOAL-903 drill landing present` 且 `$?`=0；`quay goal gate AC-903 --json` ⇒ `"verdict":"pass"`、exit 0；并贴 `.quay/goal-round.jsonl` 中 AC-903 的 `goal-gaps` 记录（`"state":"workable"`）。三者原始输出并列。
- [ ] AC2（根因直接量 + 对照）。以 `node --experimental-strip-types` 直接 import `computeGoalGaps`（`plugin/scripts/goal-driver.ts`），喂最小输入：AC-903 记录 `status:active`、其 GOAL 非 active、`verdicts` 不含 AC-903、两条 `goal_ac: AC-903` 的 done 关联任务 ⇒ 该条 `state === "workable"`；对照：同一输入但 `verdicts.set("AC-903","not-evaluated")` ⇒ `state === "not-evaluated"`。贴两次调用与逐字输出，并引 `goal-driver.ts` 的分支行号。
- [ ] AC3（class 修复 + 变异对照）。`computeGoalGaps` 对「所属 GOAL 非 active 的 active AC 且 verdict 缺值」不再产出可立案的 `workable`（新落点与 `fail` 不同形）；单测覆盖该形态（修复前该断言红、修复后绿）；另用 `cp` 备份把修复临时回退（⛔ 不用 `git checkout --`）⇒ ≥1 条断言转红，恢复 ⇒ 回绿。贴单测输出与变异读数。
- [ ] AC4（instance 收尾）。`quay goal show AC-903 --json` 的 `status` 为 `achieved`（经 `quay goal write AC-903 --origin "…" --status achieved` 写入，⛔ 非手改 `goals/*.md`）；贴 `git diff -- goals/AC-903-*.md` 证明 `criterion` 文本逐字未动、仅 `status`/`statusLog` 变更。
- [ ] AC5（可观察地关闭）。用**修复后**的 `computeGoalGaps` 重算 AC-903 ⇒ 输出里没有 filing-state 的该条（`workable`/`gap`/`standing-violated`/`frozen-violated` 皆非，取到 `not-evaluated` 或该条根本不入 `gaps`）；并贴 `quay goal list --status active --kind criterion --json` 证明 AC-903 已不在 active AC 清单。贴两条原始输出。
- [ ] AC6（scoped 门绿且非空转）。`bash scripts/test.sh --for-task gap-ac903-retired-goal-active-ac-phantom-workable-spawn --allow-thin` 退出 0，且**确实执行了** ≥1 个测试文件；按 `scoped-log-per-file-line-is-not-how-you-tell-a-file-ran` 的教训，用 `--paths-only`/`--json` 或按 case 名确认后贴被执行文件名。
- [ ] AC7（不越权、无残留）。`git diff develop --stat` 仅含本任务 `## Touches` 声明的文件；`quay goal list --json` 逐条对比证明除 AC-903 外无任何 AC/GOAL 记录变更；`git branch --list 'goal/*'` 仍为空。

## DoD

真实落地 = **机制上不再产生这条假缺口 + AC-903 的记录与实况一致**，两件均可被下一轮独立复算（DIR-026 Reading A）：

1. **落地对象（code）**：`plugin/scripts/goal-driver.ts` 的分类器改动随本任务落到 develop，且用修复后的 `computeGoalGaps` 对 AC-903 重算不再产出 filing-state 条目（AC5）。
2. **落地对象（store）**：AC-903 经 goal store 写为 `achieved`（AC4），使 `goal-gaps` 里不再出现 AC-903 的 filing 条目。
3. **可被打红**：AC2 的根因对照读数、AC3 的变异对照读数都在；删掉修复 ⇒ AC3 的断言转红。
4. **文本不动**：AC-903 的 `criterion` 逐字未改（AC4 的 diff 证明）；⛔ 不是靠改判据 / retire 掉 AC 来「消红」。
5. **证据留痕**：上述读数写进 `## Evidence` 或 `.quay/ac903-*`，可被下一轮复算。

⛔ 不算数：只把 AC-903 从 active 清单移走而机制仍会把同类 AC 判 `workable`（未修 class）；或反过来只改判据文本让检测不到。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-s01.test.mjs
- goals/AC-903-goal-903-演练落地存在.md
- tasks/gap-ac903-retired-goal-active-ac-phantom-workable-spawn.md
