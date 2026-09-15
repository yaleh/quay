---
id: gap-ac194-frozen-verdict-predates-fix
title: AC-194 台账 fail 早于修复 40 分 10 秒：真值已恢复，差额是【读数】——重取并落账，⛔ 勿再找不存在的缺陷
status: ready
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

正本：`goals/AC-194-no-direct-to-develop-bypass.md`（判据）+ `goals/GOAL-007-done-fixture.md`（题面：achieved 判据变假而无人重评）。本任务是该题面的**读数侧**实例——与 `tasks/gap-ac162-frozen-verdict-predates-fix.md`（2026-09-14/15 夜间，AC-162）**同形态、不同主体**。

<!-- dedup-ref --> 关联（**仅溯源，非前置、非阻塞**）：`gap-ac162-frozen-verdict-predates-fix`（done）是同一形态在 AC-162 上的先例；本任务不依赖它落地，也不重复它的范围。

**立案前提逐字核过：一条成立，一条被实测证伪。**

- ✅ **成立**：台账尾确为 `fail`。`.quay/gate-events.jsonl` 中 AC-194 最后一条 item 事件 = `2026-09-15T02:05:20.826Z`、`actor=goal-sweep`、`verdict=fail`、`payload.reason` = `acceptance failed (exit 1) — AC-194 fail - plugin/scripts/direct-to-develop-bypass-check.ts did not pass (--baseline develop~100) unclassifiable-commits-in-range`、`payload.criterionHash` = `d3eb8d7a6165b156`。`node packages/quay/src/goal-store.ts check --stale-pass`（2026-09-15T03:33Z 取样）→ `frozenScope=86`、`failing=["AC-194"]`（**唯一**一条）、`verifiedFresh=85`、`notEvaluated=[]`、`amendedUnverified=[]`。
- ❌ **证伪：「早先的修复没保持住」**。**它保持住了。** 判据逐字跑（主检出 `/home/yale/work/quay`，2026-09-15T03:2x–03:33Z 共 4 次取样，同一批字节）→ **exit 0**；`--json` 读数 `evaluated=true / ok=true / reason="no-direct-commits-in-range" / unclassifiableCommits=0 / classification.ratio=1.0`（`classified=100, total=100, firstParent=100`）。⇒ **红的是读数，不是判据，也不是产物。**

**差额的成因（可核，非推断）**：修复提交 `69f608384`（「gap-ac194: 落地词汇表按结构判定 + 未分类 action 形点名」）改 `plugin/scripts/direct-to-develop-bypass-check.ts` 的 `classifyLandingMode`，把第四种 ref-level 拼法 `branch: Reset to` 按**结构**判为 refMove（`:445` `if (/^branch:\s*(?:Reset to|Created from)\b/.test(s)) return "refMove";`），落于 `2026-09-15T02:45:30Z`，且已是 `develop` 的祖先（`git merge-base --is-ancestor 69f608384 develop` → 真）。而台账那条 `fail` 写于 `02:05:20.826Z` —— **早于修复 40 分 10 秒**。⇒ 台账记的是**修复之前**的真值。

**为什么它不会靠「老化」自愈**：`checkStalePass`（`packages/quay/src/goal-store.ts`）对冻结population 取「轮转 verdict 在 `DEFAULT_STALE_PASS_MAX_AGE_MS`（4h）内 ⇒ 取它；否则回落**最后一条** verdict」，而 `tail.verdict === "fail"` 是**常驻回落、无年龄上限** ⇒ 只靠老化不会自愈，**必须有新 verdict 落账**。让它翻的那次重取**不是本任务该做的事**：它是生产 goal 环的轮转（`actor=goal-sweep` 的唯一生产写者 = `plugin/scripts/goal-driver.ts:385` 的 `sweepFrozenAcs`）。本任务只**核实它发生了**并留下可复核痕迹。

**⚠️ 一条观察（不构成本任务判据；硬规则 12：给不出发生率即不作阻塞）**：同形态今日已第 2 例（AC-162 于 00:2xZ、AC-194 于 03:3xZ）；`gap-ac162-frozen-verdict-predates-fix` 的 `## Resolution` 另记了 5 条「sweep fail → 更晚 sweep pass」、间隔 28.1–65.3 分钟的同类读数。**「修复落地 → 轮转重取」窗口内基于陈旧读数派发立案**这一形态是否值得独立机制，本任务**不立论**（未造能区分「队列排空延迟」与「轮转故障」的对照），只留作观察项。

## Plan

1. **取基线并落痕**：判据逐字跑（与 `goals/AC-194-no-direct-to-develop-bypass.md` 的 criterion 逐字同；应 exit 0，两次取样间隔 ≥25 min 读数一致）；`node packages/quay/src/goal-store.ts check --stale-pass > /tmp/ac194-sp.out 2> /tmp/ac194-sp.err; echo $?`（基线时刻应 exit 1 且 `failing` 含 `AC-194`）。两条命令原文与取样时间戳写进 `## Resolution`。
2. **核轮转重取（以台账新事件为准，⛔ 不以「这次没报红」为准）**：`.quay/gate-events.jsonl` 中出现满足 `pipeline_id=AC-194 ∧ gate="goal" ∧ actor="goal-sweep" ∧ timestamp > 2026-09-15T02:45:30Z ∧ payload.criterionHash="d3eb8d7a6165b156"` 的事件。⛔ **不要执行** `check --stale-pass --sweep --min-age-ms 0`：它把全部 86 条冻结 AC 变成合格者，AC-194 因**最年轻**排位靠后，默认 `--budget 6` 取不到它，只会扫走 6 条**别的** AC，产出「绿了但不是它绿的」假证据（先例的逐字读数见 `gap-ac162-frozen-verdict-predates-fix` 的 `## Resolution` §四）。
3. **复核**：`node packages/quay/src/goal-store.ts check --stale-pass` → exit 0，且 stdout 的 `.failing` 不含 `AC-194`。
4. **核钉子仍在且被套件覆盖**：`plugin/scripts/direct-to-develop-bypass-check.ts` 仍按结构判 `branch:` 的 `Reset to`/`Created from`；`plugin/test/direct-to-develop-bypass-check.test.mjs` 仍含该词的钉子；两条 `grep -c` 均 ≥1，且该测试路径匹配 `scripts/test.sh:867` 的 `plugin/test/*.test.mjs` glob。
5. **落痕**：命令行原文、取样时间戳、step 2 那条台账事件的 timestamp 与 criterionHash 写进 `## Resolution`，供下一轮独立复核。

## AC

- [ ] AC1 判据逐字跑（`goals/AC-194-no-direct-to-develop-bypass.md` 的 criterion 原文，⛔ 不改写）→ **exit 0**，且两次取样（间隔 ≥25 min）读数一致
- [ ] AC2 负控制：`.quay/gate-events.jsonl` 中存在满足 `pipeline_id=AC-194 ∧ gate="goal" ∧ actor="goal-sweep" ∧ timestamp > 2026-09-15T02:45:30Z` 且 `payload.criterionHash="d3eb8d7a6165b156"` 的事件（**无此事件则 AC3 可能是靠 4h 老化掉出去的，不算过**）
- [ ] AC3 `node packages/quay/src/goal-store.ts check --stale-pass` → **exit 0**，且 stdout 的 `.failing` **不含** `AC-194`
- [ ] AC4 钉子仍在且被套件覆盖：`grep -c 'Reset to' plugin/scripts/direct-to-develop-bypass-check.ts` ≥1 **且** `grep -c 'Reset to' plugin/test/direct-to-develop-bypass-check.test.mjs` ≥1；该测试路径匹配 `scripts/test.sh:867` 的 `plugin/test/*.test.mjs`
- [ ] AC5 本轮读数（命令行原文 + 取样时间戳 + AC2 事件 timestamp 与 criterionHash）已写入 `## Resolution`

## DoD

- AC-194 的 criterion 在主检出逐字跑 exit 0（非改写），且其**行为**保证亦成立：`plugin/scripts/direct-to-develop-bypass-check.ts` 对 ref-level 落地**按结构**判定（`branch: Reset to` 走 `classifyLandingMode` 的 `refMove` 分支），`unclassifiableCommits=0 ∧ classification.ratio=1`。
- `check --stale-pass` 退出码 0、`.failing` 不含 `AC-194`，**且 AC2 的负控制事件真实存在**（时间戳晚于 `69f608384` 落于 `develop` 的 `2026-09-15T02:45:30Z`）——即真的重取了一次并落账，不是靠 `maxAgeMs` 老化。
- `## Resolution` 留有可复核的命令原文与时间戳，下一轮无需重新推导。⛔ 不改判据、不改 `goals/`、不改 AC 记录去「让读数变绿」；⛔ 不去找「修复没生效」的缺陷——它已生效并被套件钉住。

## Touches

- tasks/gap-ac194-frozen-verdict-predates-fix.md