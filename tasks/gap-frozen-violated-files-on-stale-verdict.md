---
id: gap-frozen-violated-files-on-stale-verdict
title: 「此刻为假」实读【最多 4 小时前】的轮转 verdict：frozen-violated 在「修复已落地、台账尾未及轮转」的窗口内为同一 AC
  反复立案（今日 3 例：AC-162 ×1、AC-194 ×2），且 prompt 断言「没有别的机制重跑它」已被有界轮转证否
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-194
---
## Proposal

<!-- dedup-ref --> 关联（**仅溯源**）：`tasks/gap-ac194-frozen-verdict-predates-fix.md`（done）与 `tasks/gap-ac162-frozen-verdict-predates-fix.md`（done）是同形态的**读数侧**先例（它们只核实「真值已恢复」并落痕）；`tasks/gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass.md`（done）是**反方向**的缺口（陈旧 `pass` 尾掩盖腐烂），正是它引入了有界轮转。本任务不依赖任何一条落地，也不重复它们的范围——它是**立案侧**（frozen-violated 的立案谓词本身）的第一条。

正本：`goals/AC-194-no-direct-to-develop-bypass.md`（判据）+ `goals/GOAL-007-done-fixture.md`（题面：achieved 判据变假而无人重评）。

**① 判据此刻为真（逐字跑，主检出 `/home/yale/work/quay`，2026-09-15T09:59Z–10:05Z）**：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts \
    --root . --baseline develop~100 --json
{ "evaluated": true, "ok": true, "reason": "no-direct-commits-in-range",
  "unclassifiableCommits": 0,
  "classification": { "classified": 100, "total": 100, "ratio": 1, "firstParent": 100 } }
EXIT=0
```

**窗宽对照**（可区分「恰好 100 才绿」这一竞争假设）：`--baseline develop~100 / 150 / 200 / 300` 四条**全清**（unclassifiable 各 0，classified = total）。⇒ 该 checker 此刻在整个可达窗上都是 evaluated，不是窗口边缘的偶然。

**② 前一次修复【保持住了】（⛔ 与立案 prompt 的「the earlier fix did not hold」相反）**：`de263fede`（括注准入由 `spineSet.has(T)` 改为 `windowAncestors.has(T)`）09:32 提交、09:43/09:55 入 develop；主检出 `plugin/scripts/direct-to-develop-bypass-check.ts` 的 md5 = `4921d40574c30e913c36c5b3e48e2bc9`，与 `git show develop:` 同文件 md5 逐字相同；`git rev-list --count author..develop` = 0。

**③ 台账尾是修复【之前】的读数**：`.quay/gate-events.jsonl` 中 AC-194 最后一条 `actor=goal-sweep` 事件 = `2026-09-15T09:07:25.159Z`、`verdict=fail`、`criterionHash=d3eb8d7a6165b156` ⇒ **早于修复落地 25 分钟**。⇒ 红的是读数，不是判据，也不是产物。

**④ 缺口（本条要修的）**：`plugin/scripts/goal-driver.ts:1692` 起的 frozen-violated 分支，把 `check --stale-pass` 的 **tail verdict** 直接当作「此刻为假」立案。该读数的新鲜度界是 `DEFAULT_STALE_PASS_MAX_AGE_MS = 4h`（`packages/quay/src/goal-store.ts`），而轮转周期实测 **13–101 min** ⇒ 一次修复落地后，台账尾最长数小时仍写 `fail`，driver 每轮据此立案。⚠️ 且 prompt（`buildGapWorkerPrompt`，`goal-driver.ts:1905`）逐字告诉 worker「⚠️ … it is evidence the earlier fix did not hold … file a NEW task that makes it true again」——**把一个不存在的缺陷指给下游**；本仓库已有一条任务标题逐字写着「⛔ 勿再找不存在的缺陷」，正是这一形态的代价。

**⑤ prompt 里的假前提（逐字）**：同一函数写「No other mechanism re-runs it, so without a task it stays false forever」。自 AC-242 successor 引入有界轮转后，冻结population **正是**被别的机制每 ~1h 抽 subset 重跑的那一群——这句与 `checkStalePass` 自己的设计注释（「the tail stops being frozen and starts meaning 'the last time we actually looked'」）**互相矛盾**。

**⑥ 发生率（硬规则 12b：查历史，⛔ 不等下一轮）**：`.quay/gate-events.jsonl` 全量、`actor=goal-sweep` 的 fail→pass 翻转对 = **9 对 / 7 条 AC**（AC-162 / 169 / 172 / 179×3 / 194 / 203 / 228），窗口 **13–101 min**。已确证产生立案的 **3 例**：AC-162（2026-09-15T00:2xZ → `gap-ac162-frozen-verdict-predates-fix`）、AC-194（03:3xZ → `gap-ac194-frozen-verdict-predates-fix`）、AC-194（10:0xZ = 本轮）。

**⑦ 可证伪对照（硬规则 4 推论四，动作而非提醒）**：若成因是「陈旧 verdict 冒充此刻为假」，则把**直接量**（真跑一次该 AC 的 criterion）放进立案前，同一 AC 在同一时刻的读数应翻成「不为假」；而一条**真的**为假的 AC（负控制）仍应立案。两向都必须跑。

## Plan

1. 在 `computeGoalGaps` 的 frozen 分支（`plugin/scripts/goal-driver.ts:1692` 起）加**立案前直接量复核**：对 `frozenReading.failing` 命中的那条 AC，在产出 `frozen-violated` 之前真跑一次它的 `criterion`（复用 goal-store 既有的 acceptance 执行路径 + 既有重入闸 `GOAL_ACCEPTANCE_ACTIVE_ENV`，⛔ **不新增无闸的 criterion 调用**——2026-09-07 递归事故，host load 41.89，边界就写在该闸的注释里）。只有**复核后仍非 0** 才产 `frozen-violated`。成本有据：`goal-store.ts` 的设计注释实测 avg **1.31s/criterion**，且只对命中的（通常 0–1 条）跑。
2. 复核**不可评估**（超时 / 读不出 / 闸拒绝）⇒ 取独立值（`not-evaluated` 或保守立案），⛔ **绝不与「复核通过」同形**（硬规则 3b）。
3. 更正 prompt 的假前提：`buildGapWorkerPrompt` 的 frozen 分支去掉「No other mechanism re-runs it」，改为可核的表述（冻结population 由有界轮转抽 subset 重跑；本次立案已在本轮复核过 criterion）。
4. 负控制两条（判据能取假）：① 一条**真的**为假的 AC（criterion 临时改成 `exit 1`）仍产 `frozen-violated` ⇒ 立案；② 一条 tail=`fail` 但 criterion 此刻 `exit 0` 的 AC ⇒ **不**立案——本任务的实测形态（AC-194，09:07:25Z fail / 10:0xZ exit 0）。
5. 走 fan-in 落地 develop；落地后核 `git merge-base --is-ancestor <commit> develop` 为真。

## AC

- [ ] AC1 立案前直接量复核已接入 frozen 分支，并贴出**同一时刻同一 AC** 的改前 / 改后读数对照（改前：产 `frozen-violated`；改后：不产）
- [ ] AC2 负控制①（真为假仍立案）：criterion 为 `exit 1` 的 AC 仍产 `frozen-violated`，贴出读数
- [ ] AC3 负控制②（陈旧 fail 不立案）：tail=`fail` 而 criterion 此刻 `exit 0` 的 AC（本任务的实测形态）**不**产 `frozen-violated`，贴出读数
- [ ] AC4 复核不可评估时取独立值，且与「复核通过」可区分（贴出该分支的读数）
- [ ] AC5 prompt 的假前提已改：`buildGapWorkerPrompt` 的 frozen 分支不再出现 `No other mechanism re-runs it`
- [ ] AC6 发生率读数（9 对 / 7 条 AC / 13–101 min）与 3 例立案已落进任务体或代码注释（可复核）

## DoD

- [ ] `plugin/scripts/goal-driver.ts` 的改动已 land 到 `develop`（`git merge-base --is-ancestor <commit> develop` → 真）。（待外部）
- [ ] 负控制②在**生产形态**下成立：本轮这种情形（修复已落地、台账尾尚未轮转）在下一轮不再产生 gap 立案——以下一轮 goal-driver 的**实际落痕**复核，⛔ 不以手搓调用为准。（待外部）
- [ ] AC-194 的台账尾在下一轮轮转后 `verdict=pass`，贴出该条事件原文与时间戳（即本轮三条终态之 (a)：ledger tail flips to pass）。（待外部）
- [x] ①–⑦ 的读数（命令行原文 + 时间戳 + md5 + 翻转对统计）已写进任务体，⛔ 无凭记忆字面量
- ⛔ 红线：不改判据、不改 `goals/`、不为「让读数变绿」而改 AC 记录；⛔ 不去找「修复没生效」的缺陷——它已生效并被窗宽对照钉住。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- tasks/gap-frozen-violated-files-on-stale-verdict.md
