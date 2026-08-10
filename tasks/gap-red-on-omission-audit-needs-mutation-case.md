---
id: gap-red-on-omission-audit-needs-mutation-case
title: "red-on-omission-audit 检查器无 mutation case——checker-mutation-check 门
  FAIL（uncovered: 1），静态检查红；gap-ac41-red-on-omission-artifact 的
  fan-in（e532d599）注册了 checker 却没配 mutation case"
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`plugin/scripts/red-on-omission-audit.ts` 是 @static-tier change 检查器（`scripts/test.sh:364-375` 接线、capability-catalog 声明），但 `checker-mutation-check.sh` 报 `uncovered (registered checker with no mutation case): 1 - red-on-omission-audit` ⇒ 静态检查 FAIL（`RESULT: FAIL — a checker stayed green under a defect it should catch, or the manifest is incomplete/broken`）。**

### 实证（outer 2026-08-10 17:4x，restart-readiness-check 事后补跑抓到）

- **触发链**：outer 按 manager 16:3x 事后补跑 `restart-readiness-check.sh`（`.halt` 解除前没跑机械 go/no-go 的规程缺口）→ check 6（全量 `scripts/test.sh`）FAIL → 静态检查 `checker-mutation-check` 报 `uncovered: 1 - red-on-omission-audit`。
- **根因**：`gap-ac41-red-on-omission-artifact` 的 fan-in（`e532d599`, 17:27 落地，在 r251 的 verifiedCommit `de7aa6e3` **之后**）新增了 `red-on-omission-audit` 检查器并接进 `test.sh @static-tier change` + capability-catalog，但**没在 `plugin/scripts/checker-mutation-cases/` 加 mutation case**。checker-mutation 门（`checker-mutation-check.sh:19`「a new checker with no mutation case can never silently slip through」）对每个已注册检查器要求一个「打断它声称检查的东西 → 检查器必须变红」的用例——这是 L_S 仪器（检查器本身能被证伪）的核心。
- **为什么值得修**：r251 的绿**不覆盖** `e532d599`（r251 verifiedCommit 是 de7aa6e3，在它之前）⇒ 这是 r251 之后新落地的未验证改动，静态检查红灯它。不修则全量 suite 必红（静态检查先于 node --test 跑，`set -e` 直接 abort）。
- **同样影响**：本任务就是 readiness check 判「NOT READY」的第二个真实原因（第一个是 outer 自己闭包时漏勾 AC5 导致的 ratchet breach，已修 `3a973405`）。

### 修的方向（实现归 inner，判定归 outer）

给 `red-on-omission-audit` 配 mutation case：在 `plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh`（或既有命名约定）里构造「该检查器声称检查的行为被破坏」的输入，断言检查器变红。参照同目录 sibling（`adr016-screen-use-check.sh` / `drive-contract-check.sh` / `instrument-failure-check.sh`）的写法。

**验证锚**：修后 (a) `checker-mutation-check` 的 `uncovered` 不含 red-on-omission-audit；(b) `--for-task` scoped 门绿；(c) 全量 suite 静态检查绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 readiness check-6 FAIL 链（red-on-omission-audit uncovered + e532d599 在 verifiedCommit 之后落地 + r251 不覆盖它）（本任务 Proposal 已含）
- [ ] AC2: **mutation case 补齐**——`plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh` 构造破坏输入 ⇒ 检查器变红；`checker-mutation-check` uncovered 不含它
- [ ] AC3: **既有不回归**——`--for-task` scoped 门绿（含 checker-mutation-check 自身 selftest + 25 既有 cases）
- [ ] AC4: **全量静态检查绿**——`scripts/test.sh` 静态检查阶段无 checker-mutation FAIL

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：`checker-mutation-check` uncovered 空（贴输出）；mutation case 单独跑变红
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh（新增 mutation case——按 sibling 约定）
- plugin/test/（如 mutation case 有配套测试）
- tasks/gap-ac41-red-on-omission-artifact.md（交叉标注——本任务的检查器缺 mutation case）
- tasks/gap-red-on-omission-audit-needs-mutation-case.md（自身：勾 AC + 贴证据）

## Contract

measure   mutation_uncovered_has_red_on_omission = `bash plugin/scripts/checker-mutation-check.sh --check 2>&1 | grep -c 'red-on-omission-audit'` 的 stdout 数字
band      mutation_uncovered_has_red_on_omission = 0（uncovered 不含它）
invariant checker_mutation_gate_green = 1（checker-mutation-check 不 FAIL）
invariant red_on_omission_still_checks = 1（red-on-omission-audit 本身的检查能力不退化）
invoke    `bash plugin/scripts/checker-mutation-check.sh --check`（贴 uncovered 清单）
control   mutation case 补齐；uncovered 空；checker 能力不退化
resume    mutation case / scoped 门 / 全量静态分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: readiness check 事后补跑抓到 check-6 FAIL 的第二真因——red-on-omission-audit 无 mutation case（e532d599 在 r251 之后落地，r251 不覆盖）。checker-mutation 门是本仓 L_S 仪器的核心，必须补 case。实现归 inner
