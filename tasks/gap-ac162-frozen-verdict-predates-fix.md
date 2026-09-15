---
id: gap-ac162-frozen-verdict-predates-fix
title: AC-162 的台账 fail 早于修复 9 分 12 秒：真值已恢复，差额是【读数】——重取并落账，⛔ 勿再找不存在的缺陷
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-162
---
## Proposal

**实测现状（2026-09-15T00:2xZ，主检出；判据逐字跑、非推断）——真值与读数分叉**：

- **真值 = 真**：`goals/AC-162-register-plugin-no-user-enabled.md` 的 criterion 逐字跑 → **exit 0**；`git show HEAD:` 与 `git show develop:` 两份同。
- **读数 = 假**：`node --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass` → **exit 1**，`failing: ["AC-162"]`（77 条冻结population 里**唯一**一条；其余 76 条落 `verifiedFresh`）。
- **差额的成因（可核，不是推断）**：台账 `.quay/gate-events.jsonl` 里 AC-162 最后一条轮转 verdict 是 `2026-09-14T23:58:55.429Z` 的 **fail**（`actor=goal-sweep`、`criterionHash=33794dab4e04ac2b`），而修复提交 `60680c112` 落于 `2026-09-15T00:08:07Z` —— **读数比修复早 9 分 12 秒**。

**为什么早先的修复「没保持住」——它保持住了。** `gap-ac162-console-guidance-line-reddens-criterion` 的修复成立且至今成立；它落的钉子（`packages/quay/test/npm-pack-e2e.test.mjs` 里**逐字**复跑同一条 ERE，并把「无法评估」独立取值，不与之共享输出形）已接线进套件（`scripts/test.sh:867` 的 `packages/*/test/*.test.mjs` glob；该文件 `@test-group product`）。AC 的**行为**保证亦成立：`register-plugin.mjs:114` 只写 `extraKnownMarketplaces`，全文件无 `enabledPlugins` 写点（`:30` 的散文亦声明「Nothing in this file hand-edits any other settings key」）。⇒ **红的是读数，不是判据，也不是产物。**

**为什么这条读数不会自己翻**：轮转有 1h 最小年龄门（`DEFAULT_SWEEP_MIN_AGE_MS`）⇒ AC-162 在 `2026-09-15T00:58:55Z` 前不可被重扫。而判定面孔径（`checkStalePass`）是「轮转 verdict 在 `DEFAULT_STALE_PASS_MAX_AGE_MS`(4h) 内 ⇒ 直接取它；否则回落**最后一条 verdict**（含 fail）」⇒ 4h 内 `failing` 恒含它，4h 之后因最后一条仍是 fail 也**仍**含它（`tail.verdict === "fail"` 是常驻回落，无年龄上限）⇒ **只靠老化不会自愈，必须有新 verdict 落账**。

**⚠️ 一条读数，未归因（硬规则 4c 推论四：给不出区分对照就降为观察项，勿据此立论）**：台账里另有 **5 条** AC 出现过「sweep fail → 更晚的 sweep pass」，间隔 28.1/44.7/45.9/50.4/65.3 分钟（AC-169、AC-228、AC-172、AC-203、AC-179）。**本任务不为这些成因立论**：「verdict 早于修复」与「判据本身 flaky」是两种假设，本任务未造能区分它们的对照。

**⛔ 边界（写给下一位 worker，省一轮返工）**：不要去找「修复没生效」的缺陷——它已生效且已被套件钉住；也不要为让读数变绿去改判据或改 AC 记录（那是另一件事，且需 owner 授权）。本任务的**全部**差额是那一条**读数**。

## Plan

1. **取基线并落痕**：判据逐字跑（应 exit 0）；`node --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass > /tmp/sp.out 2> /tmp/sp.err; echo $?`（应 exit 1 且 `failing` 含 `AC-162`）。两条命令原文与取样时间戳写进 `## Resolution`。
2. **让轮转重取一次该 AC 的 verdict**：`node --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass --sweep --min-age-ms 0`（`--sweep` / `--min-age-ms` 都是轮转自身的、已在 `KNOWN_CHECK_FLAGS` 登记的入参；若届时 1h 门已自然过，等自然轮转亦可）。⛔ **以「台账出现新事件」为准，不以「这次没报红」为准**。
3. **复核**：`check --stale-pass` exit 0，且 stdout 的 `.failing` 不含 `AC-162`。
4. **负控制（区分「重跑落账」与「靠 4h 老化掉出去」）**：台账里必须存在 `pipeline_id=AC-162 ∧ gate="goal" ∧ actor="goal-sweep" ∧ timestamp > 2026-09-15T00:08:07Z` 的事件。老化**不产生**新事件，故这一条能区分两者——这正是本任务与「什么都没做、等它自己绿」的差别。
5. **核实钉子仍在且被套件覆盖**（防本形态再发生）：`npm-pack-e2e.test.mjs` 的 AC-162 guard 存在且仍断言 verbatim 谓词；该文件落在 `scripts/test.sh` 的 glob 内。
6. **落痕**：把命令行原文、取样时间戳、AC3 那条台账事件的 timestamp 写进 `## Resolution`，供下一轮独立复核。

## AC

- [x] AC1 判据逐字跑 `bash -c "grep -vE '^[[:space:]]*(//|\*|#)' packages/quay/scripts/register-plugin.mjs | grep -q 'enabledPlugins' && { echo 'AC-162 fail' >&2; exit 1; }; exit 0"` → **exit 0**，且两次取样（间隔 ≥25 min）读数一致
- [x] AC2 `node --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass > /tmp/sp.out 2> /tmp/sp.err; echo $?` → **0**，且 `/tmp/sp.out` 的 `.failing` 不含 `AC-162`
- [x] AC3 **负控制**：`.quay/gate-events.jsonl` 里存在满足 `pipeline_id=AC-162 ∧ gate=goal ∧ actor=goal-sweep ∧ timestamp > 2026-09-15T00:08:07Z` 的事件（**无此事件则 AC2 可能是靠 4h 老化掉出去的，不算过**）
- [x] AC4 钉子仍在且被套件覆盖：`grep -c 'AC-162' packages/quay/test/npm-pack-e2e.test.mjs` ≥ 1，且该路径匹配 `scripts/test.sh` 的 `packages/*/test/*.test.mjs` glob
- [x] AC5 本轮读数（命令行原文 + 取样时间戳 + AC3 事件 timestamp）已写入 `## Resolution`

## DoD

- AC-162 的判据在主检出与 `git show develop:` 两份上均 exit 0（逐字、非改写），且脚本的行为保证亦成立（全文件无 `enabledPlugins` 写点）。
- `check --stale-pass` 退出码 0；`failing` 不含 `AC-162`；**且 AC3 的负控制事件真实存在**（时间戳晚于 `60680c112`）——即真的重跑了一次并落账，不是靠 `maxAgeMs` 老化。
- `## Resolution` 里留有可复核的命令原文与时间戳，下一轮无需重新推导。

## Touches

- tasks/gap-ac162-frozen-verdict-predates-fix.md

## Resolution

**结论：本任务无代码改动；那一条差额（读数）已消除 —— 但消除它的不是本任务，是生产 goal 环自己的轮转；而立案给出的「它为什么不会自己翻」的成因，被实测证伪。**

### 一、基线复现（Plan step 1，主检出 `/home/yale/work/quay`，逐字跑）

```
# ① 真值（取样 2026-09-15T00:36:27Z）
$ bash -c "grep -vE '^[[:space:]]*(//|\*|#)' packages/quay/scripts/register-plugin.mjs | grep -q 'enabledPlugins' && { echo 'AC-162 fail' >&2; exit 1; }; exit 0"
exit=0        # 该文件 sha256 = 9d0a18a7da1b84cb2da63f233c6b75849c84560ff63d1224447202064ee5de33

# ② 读数（取样 2026-09-15T00:36:30Z）
$ node --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass > /tmp/sp.out 2> /tmp/sp.err; echo $?
exit=1
stderr: stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: AC-162
stdout: frozenScope=77  failing=["AC-162"]  verifiedFresh=76  staleUnverified=[]  notEvaluated=[]  amendedUnverified=[]
```

⇒ 立案描述的「真值与读数分叉」在基线时刻**成立且逐字复现**。

### 二、立案给的两条成因：一条成立，一条**被实测证伪**

- ✅ **成立**：分叉确实存在；AC-162 最后一条轮转 verdict 是 `2026-09-14T23:58:55.429Z` 的 `fail`。
- ❌ **证伪**：「轮转有 1h 最小年龄门（`DEFAULT_SWEEP_MIN_AGE_MS`）⇒ AC-162 在 `2026-09-15T00:58:55Z` 前不可被重扫」。
  真实门是 **`minAgeMs / DEFAULT_FAIL_RECHECK_DIVISOR`**（`packages/quay/src/goal-store.ts:199`，除数 6；消费点 `:1811` 的 `eligibleAt`）——
  **最后一条 verdict 为 `fail` 的 AC，10 分钟即可重扫**。AC-162 自 **`2026-09-15T00:08:55Z`** 起就已合格。
  ⇒ 立案所设的那个 1h 窗**不存在**。

**区分对照（硬规则 4c 推论四：两假设须给出相反预测）**

| 假设 | 对「窗口 `(2026-09-15T00:08:07Z, 2026-09-15T00:58:55Z)` 内 AC-162 `actor=goal-sweep` 事件数」的预测 |
|---|---|
| H1 = 立案前提（1h 门） | **0** |
| H2 = fail 除数（10 min 门） | **≥1** |

实测 = **1** ⇒ **H1 被证伪** —— 那条 `pass` 正落在 H1 断言必空的窗口内。

### 三、差额实际如何消除（两条独立读数互校）

**AC3 的负控制对象，逐字**（`.quay/gate-events.jsonl`）：

```json
{"id":"55fa8810-b7ac-434c-aae6-7577527e3bac","item_id":"AC-162","pipeline_id":"AC-162",
 "gate":"goal","actor":"goal-sweep","verdict":"pass",
 "timestamp":"2026-09-15T00:36:48.907Z",
 "payload":{"reason":"acceptance passed (exit 0)","criterionHash":"33794dab4e04ac2b"}}
```

- AC3 谓词逐字求值 = **true**；**修复 → 落账 28.70 min**；旧的 fail → 落账 37.89 min。
- `criterionHash=33794dab4e04ac2b` 与**当前盘上** criterion 的 `criterionFingerprint` **逐字相同** ⇒ 这条 verdict 说的是**当前这一版**判据（未被修订门拦下）。
- **我的 AC2 基线（`00:36:30Z`，exit=1）比这条落账早 32 秒** ⇒ 基线取到的是**修好之前**的真读数；修复不是本 worker 做的。

**写者归属（可核，非推断）**：`actor=goal-sweep` 的**唯一生产调用者**是 `plugin/scripts/goal-driver.ts:385`
（`sweepFrozenAcs` → `check --stale-pass --sweep`），每轮由 `:2347` 调用 ⇒ 写者是**生产 goal 环**（pid 910338），不是本 worker。

**两条独立读数同值（⛔ 不是同一个量的两次叙述）**

| 读法 | 读数 |
|---|---|
| ① 台账重放：以 `00:36:48.907Z` 为切点、按代码 `eligibleAt`/oldest-first 口径对真实冻结population（N=77）重放 | 合格者 **1** 条（就是 AC-162，rank 0） |
| ② driver 自己的轮记录 `.quay/goal-round.jsonl` 第 76 轮 `goal-ring.reason` | 逐字含 **`frozenSweep=1/1`**（前几轮为 6/7、5/6、6/7、6/7） |

⇒ 成因是**队列排空**：前几轮各按 `--budget`（默认 6）取走最久未验的 5–6 条，到第 76 轮只剩 AC-162 这一条合格者。
AC-162 之所以最后被取到，是因为它**最年轻** —— fail 除数只把它提前到 10 分钟，仍远新于整批积压。

### 四、⚠️ Plan step 2 给的那条命令**达不到它声称的目的**（附读数，供下一位省一轮）

同一重放口径：

```
默认 --min-age-ms 3600000 : eligible=1   AC-162 rank=0   budget-6 取到？true
Plan 的 --min-age-ms 0    : eligible=77  AC-162 rank=28  budget-6 取到？false
```

⇒ `--min-age-ms 0` 把全部 77 条变成合格者，AC-162 因最“年轻”排 **28** 位，默认 `--budget 6`
**取不到它**；那条命令只会扫走 6 条**别的** AC，然后给出一个「没报红但不是它」的轮转
——**照抄会得到「绿了但不是它绿的」的假证据**。本 worker 因此**没有执行它**：它对差额零贡献
（差额已由生产轮转消除），而「全量重扫」是 `DEFAULT_SWEEP_MIN_AGE_MS` 的代价注释明确警示的一次性尖峰。

### 五、AC 逐条

- **AC1** ✅ 两次取样 `00:36:27Z` exit=0 / `01:02:00Z` exit=0，**间隔 25 min 33 s**（≥25 min），读数一致；两次读的是同一份字节（sha256 `9d0a18a7…`）。另在 `01:02:27Z` 核 `git show HEAD:`（`20e8b3b4a`）与 `git show develop:`（`20e8b3b4a`）两份内容同 sha、判据同 exit 0。
- **AC2** ✅ `01:02:00Z` 逐字跑 → exit=**0**，stderr 空，`failing=[]`，`failing.includes("AC-162") = false`；`frozenScope=77 / verifiedFresh=77`（全population 新鲜）。另在 `00:37:22Z`、`00:41:53Z` 两次复核同值。
- **AC3** ✅ 事件 `55fa8810-…`，`2026-09-15T00:36:48.907Z > 2026-09-15T00:08:07Z`，逐字谓词求值 `true`。
- **AC4** ✅ `grep -c 'AC-162' packages/quay/test/npm-pack-e2e.test.mjs` = **9**（≥1；guard 在 `:200`，经真实 `grep -E` 跑同一条 ERE，并给「无法评估」独立取值）；路径匹配 `scripts/test.sh:867` 的 `packages/*/test/*.test.mjs`；该文件 `@test-group product`，而 `scripts/test.sh:1177` 的默认集合 = `product,engine,serial,lowconc` ⇒ **在默认跑集内**。
- **AC5** ✅ 本节。

**DoD 的行为保证（复跑）**：`register-plugin.mjs` 唯一的 settings 写点是 `settings.extraKnownMarketplaces`（`:114-115`，落盘于 `:123`）；`enabledPlugins` 的全部出现都在注释行（`:13/:21/:25/:147/:155/:173`）⇒ **无该键写点**。

### 六、⛔ 本任务**没有**做的事

- ⛔ 没有改判据、没有改 `goals/`（`git diff --exit-code -- goals/` 为空，实测）。
- ⛔ 没有改 `register-plugin.mjs`（其内容自 `60680c112` 起未动，sha 见 AC1）。
- ⛔ 没有改 AC 记录 / 翻状态去「让读数变绿」。
- ⛔ 没有去找「修复没生效」的缺陷（立案的 ⛔ 边界）；修复成立、钉子仍在（AC4）。
- ⛔ 没有执行 Plan step 2 那条命令（理由见 §四）。
- ⚠️ **未执行**：`npm-pack-e2e.test.mjs` 本身（`@load-sensitive real-install`，`before` 钩子跑真 `package.sh` + `npm pack` + tarball 安装，属 serial 相）。AC4 只要求「钉子存在且被套件覆盖」，两条均为静态核实；**「该文件此刻整份绿」不在本任务证据范围内**。

### 七、下游侧证（观察项，⛔ 非本任务判据）

读数的一个消费者 AC-242（其 criterion 即 `check --stale-pass`）本轮先红后绿：其台账尾 `2026-09-15T00:36:39.020Z`
仍是 `fail`（**比 AC-162 的落账早 9.9 s**），下一轮 `00:40:21.114Z` 落 `pass`；`goal-round.jsonl` 第 77 轮 `AC-242 = pass`。
本 worker 另在 `00:40:21Z` 逐字跑 AC-242 的 criterion → exit 0，其 `verifiedFresh` 枚举中含 `AC-162`。
⛔ 本节是**侧证**：本任务不为 AC-242 立论，其台账尾与判据均已自洽。
