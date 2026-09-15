---
id: gap-ac194-frozen-verdict-predates-fix
title: AC-194 台账 fail 早于修复 40 分 10 秒：真值已恢复，差额是【读数】——重取并落账，⛔ 勿再找不存在的缺陷
status: done
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

- [x] AC1 判据逐字跑（`goals/AC-194-no-direct-to-develop-bypass.md` 的 criterion 原文，⛔ 不改写）→ **exit 0**，且两次取样（间隔 ≥25 min）读数一致
- [x] AC2 负控制：`.quay/gate-events.jsonl` 中存在满足 `pipeline_id=AC-194 ∧ gate="goal" ∧ actor="goal-sweep" ∧ timestamp > 2026-09-15T02:45:30Z` 且 `payload.criterionHash="d3eb8d7a6165b156"` 的事件（**无此事件则 AC3 可能是靠 4h 老化掉出去的，不算过**）
- [x] AC3 `node packages/quay/src/goal-store.ts check --stale-pass` → **exit 0**，且 stdout 的 `.failing` **不含** `AC-194`
- [x] AC4 钉子仍在且被套件覆盖：`grep -c 'Reset to' plugin/scripts/direct-to-develop-bypass-check.ts` ≥1 **且** `grep -c 'Reset to' plugin/test/direct-to-develop-bypass-check.test.mjs` ≥1；该测试路径匹配 `scripts/test.sh:867` 的 `plugin/test/*.test.mjs`
- [x] AC5 本轮读数（命令行原文 + 取样时间戳 + AC2 事件 timestamp 与 criterionHash）已写入 `## Resolution`

## DoD

- AC-194 的 criterion 在主检出逐字跑 exit 0（非改写），且其**行为**保证亦成立：`plugin/scripts/direct-to-develop-bypass-check.ts` 对 ref-level 落地**按结构**判定（`branch: Reset to` 走 `classifyLandingMode` 的 `refMove` 分支），`unclassifiableCommits=0 ∧ classification.ratio=1`。
- `check --stale-pass` 退出码 0、`.failing` 不含 `AC-194`，**且 AC2 的负控制事件真实存在**（时间戳晚于 `69f608384` 落于 `develop` 的 `2026-09-15T02:45:30Z`）——即真的重取了一次并落账，不是靠 `maxAgeMs` 老化。
- `## Resolution` 留有可复核的命令原文与时间戳，下一轮无需重新推导。⛔ 不改判据、不改 `goals/`、不改 AC 记录去「让读数变绿」；⛔ 不去找「修复没生效」的缺陷——它已生效并被套件钉住。

## Touches

- tasks/gap-ac194-frozen-verdict-predates-fix.md

## Resolution

**结论：本任务无代码改动。** 立案描述的「真值与读数分叉」逐字复现，且**在 worker 轮内被生产 goal 环自己的轮转消除**——消除它的不是本 worker，是一次 `actor=goal-sweep` 的落账。立案的 ⛔ 边界全程遵守：未改判据、未改 `goals/`、未改 AC 记录去「让读数变绿」，也未去找「修复没生效」的缺陷。

### 一、基线（主检出 `/home/yale/work/quay`，逐字跑）

**① 真值——判据逐字跑，两次取样（间隔 ≥25 min）**

判据自 `goals/AC-194-no-direct-to-develop-bypass.md` 的 `criterion: |-` 块逐字提取（提取件 `sha256=46d48e74e6ae77249072feca9c102f2c7706874ab7c54930261da6b9588e0faa`），
`criterionFingerprint(提取件) = d3eb8d7a6165b156`，**与台账事件里的 `criterionHash` 逐字相同** ⇒ 提取无损（⛔ 不是改写版）。

```
$ sh -c "$(cat /tmp/ac194-criterion.sh)"      # = criterion 原文，逐字
# 取样 1  2026-09-15T03:47:07Z → 03:47:09Z
exit=0   stdout: no direct-to-develop bypass in recent window (evaluated)   stderr: (empty)
# 取样 2  2026-09-15T04:12:19Z → 04:12:22Z
exit=0   stdout: no direct-to-develop bypass in recent window (evaluated)   stderr: (empty)
```

两次间隔 **25 min 12 s**，读数一致；取样 2 前**重算**提取件 `sha256` 与 fingerprint ⇒ 与取样 1 逐字同值
（`46d48e74…` / `d3eb8d7a6165b156`）⇒ 两次读的是**同一份判据字节**（⛔ 不是「改了判据再跑一遍」）。

**② 读数——差异侧基线（生产自己记的，⛔ 不是我重跑的）**

`check --stale-pass` 的**纯读**判定每轮被 goal 环记进 `.quay/goal-round.jsonl`：

| 轮 | ts | `goal-ring.frozenFailing` |
|---|---|---|
| 10 | `2026-09-15T03:41:40.308Z` | `{"failing":["AC-194"],"judgment":"violated","cause":null,"frozenScope":86}` |
| 11 | `2026-09-15T03:48:27.258Z` | `{"failing":[],"judgment":"clean","cause":null,"frozenScope":86}` |

⇒ 第 10 轮判断的那一刻（`03:41:40`）判据本身已为真（§一①同一份字节、同一版本：修复 `02:45:30Z` 早已落地），
而**台账尾读数仍判 `violated`**——这就是立案说的那条差额，且这是**生产载体上的一手读数**，不是我的复述。

**③ 差额成因（逐字核过，非推断）**：修复提交

```
$ git log -1 --format='%H %cI %s' 69f608384
69f608384627865eaa831d52fe8ded284a4524df
2026-09-15T02:45:30+00:00
gap-ac194: 落地词汇表按结构判定 + 未分类 action 形点名
$ git merge-base --is-ancestor 69f608384 develop; echo $?   → 0（是 develop 祖先）
```

该 AC 在台账里最后一条 `actor=goal-sweep` verdict 是 `2026-09-15T02:05:20.826Z` 的 **fail**（`criterionHash=d3eb8d7a6165b156`）
⇒ **fail 早于修复 40 分 10 秒**。台账该 AC 事件尾部逐字：

```
2026-09-15T01:46:43.569Z  goal-sweep  fail  d3eb8d7a6165b156
2026-09-15T01:58:22.028Z  goal-cli    fail  (none)
2026-09-15T02:05:20.826Z  goal-sweep  fail  d3eb8d7a6165b156   ← 立案引的那条
2026-09-15T03:46:13.075Z  goal-sweep  pass  d3eb8d7a6165b156   ← 本轮的翻转（§二）
```

### 二、AC2 负控制：重取**真的发生了**（⛔ 不是靠 4h 老化掉出去的）

```json
{"id":"45fdaab9-d8d6-4153-95b7-32bb7aa14741","item_id":"AC-194","pipeline_id":"AC-194",
 "gate":"goal","actor":"goal-sweep","verdict":"pass",
 "timestamp":"2026-09-15T03:46:13.075Z",
 "payload":{"reason":"acceptance passed (exit 0)","criterionHash":"d3eb8d7a6165b156"}}
```

逐字谓词求值，五条全中 = **true**：`pipeline_id=AC-194` ∧ `gate="goal"` ∧ `actor="goal-sweep"`
∧ `timestamp(2026-09-15T03:46:13.075Z) > 2026-09-15T02:45:30Z`（③ 修复落于 develop 的时刻）∧ `criterionHash="d3eb8d7a6165b156"`。

- **修复 → 落账间隔 = 60 分 43 秒**（`02:45:30Z → 03:46:13.075Z`）。
- `criterionHash` 与当前盘上 criterion 的 fingerprint **逐字相同** ⇒ 这条 verdict 说的是**当前这一版**判据（未被修订门拦下）。
- **老化不产生新事件** ⇒ 这条事件本身就是「重取过」与「什么都没做、等它自己绿」的**区分对照**。

**写者归属（可核，非推断）**：`actor=goal-sweep` 的唯一生产调用者是 `plugin/scripts/goal-driver.ts:2347`
（`sweepFrozenAcs` → `goal-driver.ts:385` 的 `check --stale-pass --sweep`）。该进程为
`pid 4014875 / run_id gl-prod-anchor`（`driver-anchor.js __anchor --root /home/yale/work/quay`）——即**生产 goal 环**，⛔ 不是本 worker。

**⛔ Plan step 2 那条命令未执行**：`check --stale-pass --sweep --min-age-ms 0` 把全部 86 条冻结 AC 变成合格者，
AC-194 因**最年轻**排位靠后，默认 `--budget 6` **取不到它** ⇒ 只会扫走 6 条**别的** AC，
产出「绿了但不是它绿的」假证据。本 worker 未执行它（与 `gap-ac162-frozen-verdict-predates-fix` 的 `## Resolution` §四 同一裁定）。

### 三、AC3 复核（`2026-09-15T03:47:12Z`）

```
$ node --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass
exit=0
stderr: (empty)
stdout: {"frozenScope":86,"evaluated":true,"failing":[],"staleUnverified":[],"notEvaluated":[],
         "amendedUnverified":[],"neverGated":[],
         "rotation":{"sweptEver":86,"lastSweepAt":"2026-09-15T03:46:18.709Z","minAgeMs":3600000,"maxAgeMs":14400000}}
```

`verifiedFresh` 枚举中含 `AC-194`；`failing.includes("AC-194") = false`。
`verifiedFresh` 的成立条件是「**轮转** verdict 在 4h 内**且为 pass**」⇒ 它**只能**由 §二 那条落账满足（老化产生不了它）。

**两条独立读数同值**（⛔ 不是同一个量的两次叙述）：
① 本 worker 的 `check --stale-pass`（`03:47:12Z`，`failing=[]`）；
② 生产 goal 环第 11 轮 `goal-ring.frozenFailing`（`03:48:27.258Z`，`judgment=clean`）。

### 四、AC4 钉子仍在且被套件覆盖

```
$ grep -c 'Reset to' plugin/scripts/direct-to-develop-bypass-check.ts      → 18   (≥1)
$ grep -c 'Reset to' plugin/test/direct-to-develop-bypass-check.test.mjs   → 14   (≥1)
```

**按位置判定（硬规则 2）——命中的是不是我要的？**

- `direct-to-develop-bypass-check.ts:445`（**代码**，非注释）：`if (/^branch:\s*(?:Reset to|Created from)\b/.test(s)) return "refMove";`
  —— 即立案点名的**按结构**判 refMove 的那一支。
- `direct-to-develop-bypass-check.test.mjs:1001`（**断言**，非注释）：`assert.equal(classifyReflogAction("branch: Reset to HEAD"), "refMove", "git branch -f <已存在 b> HEAD（本任务的生产拼法）")`；
  `:1002` 同形第二条（`branch: Reset to <sha>`）。
- `…test.mjs:1419` 的 AC5 CLI 测试用**真 reflog 夹具**（`:1427` `assert.match(reflog, /^branch: Reset to /, …)`）断言 GREEN 且 `refMoveIntroduced` 可见。

**套件覆盖**：`plugin/test/direct-to-develop-bypass-check.test.mjs` 逐字匹配 `scripts/test.sh:867` 的 glob
`(packages/*/test/*.test.mjs plugin/test/*.test.mjs experiments/quay-perpetual-stream/test/*.test.mjs)` 的第二项。

**DoD 的行为保证（复跑，`2026-09-15T03:48:15Z`）**：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts \
    --root /home/yale/work/quay --baseline develop~100 --json
evaluated=true   ok=true   reason=no-direct-commits-in-range
unclassifiableCommits=0
classification={"classified":100,"total":100,"ratio":1,"firstParent":100,"offSpine":600,"refMoveIntroduced":[…]}
```

⇒ `unclassifiableCommits=0 ∧ classification.ratio=1` 逐条成立（`refMoveIntroduced` 里可见 develop 现行 tip 是按 refMove 落地的，非直投）。

### 五、AC 逐条

- **AC1** ✅ 逐字判据（提取件 fingerprint `d3eb8d7a6165b156` == 台账 `criterionHash`）两次取样：`03:47:07Z` exit=**0** / `04:12:19Z` exit=**0**，间隔 **25 min 12 s**（≥25 min），读数一致；两次读的是**同一份判据字节**（`sha256=46d48e74e6ae77249072feca9c102f2c7706874ab7c54930261da6b9588e0faa`，取样 2 前重算同值）。
- **AC2** ✅ 事件 `45fdaab9-…`（`03:46:13.075Z > 02:45:30Z`，`criterionHash=d3eb8d7a6165b156`），五条谓词全中。详见 §二。
- **AC3** ✅ exit=**0**，`failing=[]`，`AC-194 ∈ verifiedFresh`。详见 §三。
- **AC4** ✅ 两条 `grep -c` 分别 **18 / 14**（≥1）；命中的是**代码**（`:445`）与**断言**（`:1001-1002`、`:1419`）；测试路径逐字匹配 `scripts/test.sh:867` 的 `plugin/test/*.test.mjs`。详见 §四。
- **AC5** ✅ 本节。

### 六、⛔ 本任务**没有**做的事

- ⛔ 没有改判据、没有改 `goals/`（`git status --porcelain -- goals/` 为空，实测）。
- ⛔ 没有改 `plugin/scripts/direct-to-develop-bypass-check.ts` 或它的测试（`git diff --exit-code --stat develop -- <both>` 空 ⇒ 与 develop 逐字相同）。
- ⛔ 没有改 AC 记录 / 翻状态去「让读数变绿」——翻它的是生产 goal 环（§二 写者归属）。
- ⛔ 没有执行 Plan step 2 那条 `--min-age-ms 0` 命令（理由见 §二）。
- ⛔ 没有去找「修复没生效」的缺陷（立案的 ⛔ 边界）；修复成立（`69f608384` 是 develop 祖先）、钉子仍在（§四）。

### 七、观察项（硬规则 12：不构成本任务判据，不作阻塞）

同形态今日第 2 例（AC-162 于 `2026-09-15T00:2xZ`、AC-194 于 `03:4xZ`）。
**「修复落地 → 轮转重取」窗口内基于陈旧读数派发立案**这一形态是否值得独立机制，本任务**不立论**
——未造能区分「队列排空延迟」与「轮转故障」的对照。本次实测窗口 = **60 分 43 秒**
（`02:45:30Z → 03:46:13.075Z`），落在 `gap-ac162-frozen-verdict-predates-fix` 记录的 28.1–65.3 分钟区间内。
