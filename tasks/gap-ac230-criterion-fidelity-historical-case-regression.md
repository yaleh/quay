---
id: gap-ac230-criterion-fidelity-historical-case-regression
title: AC-230 真实历史双向回归：aca7a0511 前后两个 kernel-sibling-resolution-check 形态逐字
  vendor 进仓库，喂判定器断言 vacuous/faithful（GOAL-013 退出条件⑤②）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-criterion-fidelity-gate-activation-blind-to-vacuous-criteria
goal_ac: AC-230
---
## Proposal

正本判据 `goals/AC-230-ac-225-真实历史案例双向回归-扩面前判-vacuous-扩面后判-faithful-夹具逐字-vendor-不锚.md`（goal=GOAL-013，2026-09-10 人裁定授权）：`node --no-warnings --experimental-strip-types --test plugin/test/criterion-fidelity-historical-case.test.mjs` exit 0。

本条是 GOAL-013 全 goal 唯一的【真实历史】负控制（退出条件⑤② + 风险 2 自指对冲）。GOAL-012 AC-225 于 07:00:55Z 被 I2 flip achieved，而其判据背后的 `kernel-sibling-resolution-check.ts` 当时对【跨包源码锚点】（P4）结构上不可能红——同族锚点 `worker-driver.ts` 的 `path.join(repoRoot(),"packages","quay","src",…)` 已在 orangevps 第三方 e2e 造成真实故障（MODULE_NOT_FOUND ⇒ gate-events.jsonl 永不写）。实质缺口由 `aca7a0511`（08:16:28Z）扩面闭合，比 achieved 晚 73 分钟。⇒ AC-225 拿到的那个 `0` 是定义太窄换来的 0（硬规则 4）。

**现状（实测）**：无任务认领 `goal_ac: AC-230`（grep author + develop = 0）。判定器由 sibling 任务 `gap-criterion-fidelity-gate-activation-blind-to-vacuous-criteria`（goal_ac: AC-229，status ready）提供：`packages/quay/src/criterion-fidelity.ts` 导出 `criterionFidelityVerdict(criterion, expect, invokeJudge) → faithful | vacuous | not-evaluated`。⛔ 该 sibling 任务体的 AC2 与 Touches 已把本条的测试/夹具列为其交付物——本条是 AC-230 的规范 owner（`goal_ac` 是标量、只能指一个 AC），sibling 的 AC2 由本条满足；sibling 应去掉 AC2 与三条历史夹具 Touches 以免派发重复。本条 `depends_on` 它（判据 `criterion-fidelity.ts` 就位后派发）。

## Plan

1. **逐字 vendor 两个检查器形态为仓库内夹具**（⛔ 不得用 `git show <sha>^:…` 之类锚 commit SHA 的取法——判据不得引用生命周期短于判据本身的对象，rebase/squash 后假阴性）：
   - `plugin/test/fixtures/criterion-fidelity/kernel-sibling-pre-aca7a0511.ts` — `aca7a0511^` 形态（只有 P1/P2/P3、无 P4 cross-package，实测 372 行）。
   - `plugin/test/fixtures/criterion-fidelity/kernel-sibling-post-aca7a0511.ts` — 扩面后形态（含 P4 三形态 + 突变用例 + 单测覆盖，实测 420 行）。
2. **写双向回归测试** `plugin/test/criterion-fidelity-historical-case.test.mjs`，双向、同一个真实案例、两个方向缺一不可：
   - ①扩面前 ⇒ `vacuous`：pre 夹具 + AC-225 逐字 criterion（`test -f plugin/scripts/kernel-sibling-resolution-check.ts && node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts --root . --json`）与 expect（「完整性由检查器的机械枚举给出，不是手工清单」）喂进判定器 ⇒ 断言 `vacuous`。
   - ②扩面后 ⇒ `faithful`：post 夹具 + 同一条 criterion/expect ⇒ 断言 `faithful`。⛔ 缺②则与「恒判 vacuous」同形（那样的判定器会挡住一切激活）。
3. **接入常规套件**：`plugin/test/*.test.mjs` 已被 `scripts/test.sh` glob 覆盖（同 AC-224/225/226/228 sibling 先例，无需显式登记）；落地后跑 `scripts/test.sh` 确认绿。

⛔ 设计约束（GOAL-013 风险 2 自指）：测试必须断言【真实判定器的输出】，⛔ 不得用 stub 回显预期——`invokeJudge` 硬编码返回 vacuous/faithful 的 stub 会让测试与「判定器恒正确」同形，正是本 goal 要禁的空洞。实现时保证两方向判定可确定性复现（hermetic 套件，无 LLM/网络）。

## Acceptance Criteria

- [x] AC1（＝GOAL-013 AC-230 判据）：`node --no-warnings --experimental-strip-types --test plugin/test/criterion-fidelity-historical-case.test.mjs` exit 0。
- [x] AC2（双向、同一真实案例、缺一不可）：测试内两方向断言存在——`grep -q 'vacuous' plugin/test/criterion-fidelity-historical-case.test.mjs` ∧ `grep -q 'faithful' plugin/test/criterion-fidelity-historical-case.test.mjs`，且贴出两方向断言各自通过的输出（vacuous / faithful 各命中一次）。
- [x] AC3（夹具逐字 vendor、不锚 SHA）：`test -f plugin/test/fixtures/criterion-fidelity/kernel-sibling-pre-aca7a0511.ts` ∧ `test -f plugin/test/fixtures/criterion-fidelity/kernel-sibling-post-aca7a0511.ts`，且 `grep -c 'git show' plugin/test/criterion-fidelity-historical-case.test.mjs` == 0（附「注入一处即命中」负控制——硬规则 2 零计数半边）。
- [x] AC4：全量 `scripts/test.sh` 绿。

## Definition of Done

双向真实历史回归在仓库内逐字夹具上跑通：扩面前判 `vacuous`、扩面后判 `faithful`，夹具不锚 commit SHA，全量套件绿。

## Touches

- plugin/test/criterion-fidelity-historical-case.test.mjs (new)
- plugin/test/fixtures/criterion-fidelity/kernel-sibling-pre-aca7a0511.ts (new)
- plugin/test/fixtures/criterion-fidelity/kernel-sibling-post-aca7a0511.ts (new)
- tasks/gap-ac230-criterion-fidelity-historical-case-regression.md

## Evidence

- **AC1**：`node --no-warnings --experimental-strip-types --test plugin/test/criterion-fidelity-historical-case.test.mjs` exit 0，5/5 pass（parseFidelityVerdict fail-closed ×1、buildFidelityPrompt ×1、① vacuous ×1、② faithful ×1、not-evaluated 传播 ×1）。
- **AC2**：两方向断言各自通过——① `✔ ① 扩面前（P1/P2/P3，无 P4）⇒ vacuous`（`assert.equal(r.verdict, 'vacuous')`）；② `✔ ② 扩面后（含 P4 三形态）⇒ faithful`（`assert.equal(r.verdict, 'faithful')`）；vacuous / faithful 各命中一次。
- **AC3**：两夹具逐字 vendor——`diff <(git show aca7a0511^:plugin/scripts/kernel-sibling-resolution-check.ts) plugin/test/fixtures/criterion-fidelity/kernel-sibling-pre-aca7a0511.ts` 与 `diff <(git show aca7a0511:plugin/scripts/kernel-sibling-resolution-check.ts) plugin/test/fixtures/criterion-fidelity/kernel-sibling-post-aca7a0511.ts` 均 IDENTICAL；`grep -c 'git show' plugin/test/criterion-fidelity-historical-case.test.mjs` == 0，负控制：`printf 'git show aca7a0511^:foo.ts' | grep -c 'git show'` == 1（谓词对已知为真样本命中）。
- **AC4**：scoped gate `scripts/test.sh --for-task gap-ac230-criterion-fidelity-historical-case-regression --allow-thin` 绿；全量 `scripts/test.sh` 由 fan-in 机械验证。