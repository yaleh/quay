---
id: gap-ac162-frozen-verdict-predates-fix
title: AC-162 的台账 fail 早于修复 9 分 12 秒：真值已恢复，差额是【读数】——重取并落账，⛔ 勿再找不存在的缺陷
status: todo
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

- [ ] AC1 判据逐字跑 `bash -c "grep -vE '^[[:space:]]*(//|\*|#)' packages/quay/scripts/register-plugin.mjs | grep -q 'enabledPlugins' && { echo 'AC-162 fail' >&2; exit 1; }; exit 0"` → **exit 0**，且两次取样（间隔 ≥25 min）读数一致
- [ ] AC2 `node --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass > /tmp/sp.out 2> /tmp/sp.err; echo $?` → **0**，且 `/tmp/sp.out` 的 `.failing` 不含 `AC-162`
- [ ] AC3 **负控制**：`.quay/gate-events.jsonl` 里存在满足 `pipeline_id=AC-162 ∧ gate=goal ∧ actor=goal-sweep ∧ timestamp > 2026-09-15T00:08:07Z` 的事件（**无此事件则 AC2 可能是靠 4h 老化掉出去的，不算过**）
- [ ] AC4 钉子仍在且被套件覆盖：`grep -c 'AC-162' packages/quay/test/npm-pack-e2e.test.mjs` ≥ 1，且该路径匹配 `scripts/test.sh` 的 `packages/*/test/*.test.mjs` glob
- [ ] AC5 本轮读数（命令行原文 + 取样时间戳 + AC3 事件 timestamp）已写入 `## Resolution`

## DoD

- AC-162 的判据在主检出与 `git show develop:` 两份上均 exit 0（逐字、非改写），且脚本的行为保证亦成立（全文件无 `enabledPlugins` 写点）。
- `check --stale-pass` 退出码 0；`failing` 不含 `AC-162`；**且 AC3 的负控制事件真实存在**（时间戳晚于 `60680c112`）——即真的重跑了一次并落账，不是靠 `maxAgeMs` 老化。
- `## Resolution` 里留有可复核的命令原文与时间戳，下一轮无需重新推导。

## Touches

- tasks/gap-ac162-frozen-verdict-predates-fix.md
