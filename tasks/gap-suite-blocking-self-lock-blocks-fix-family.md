---
id: gap-suite-blocking-self-lock-blocks-fix-family
title: "suite_blocking 自锁——套件红 ⇒ 拦碰套件文件的任务 ⇒ 而修套件的任务必然碰套件文件 ⇒ 派不出去 ⇒ 套件继续红（与 .halt 裁定同型：停派发好让 outer 修红是死锁，修红要靠派发）；应豁免【Touches 与本次失败文件相交、且任务本身就是修这些失败的】一类，或至少豁免 suite 基础设施族"
status: todo
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

**suite_blocking 自锁：套件红 ⇒ 拦【碰套件文件】的任务 ⇒ 而修套件的任务必然碰套件文件 ⇒ 派不出去 ⇒ 套件继续红。这是 .halt 裁定的同型死锁（当时原话【停派发好让 outer 自己修红】是死锁，因为修红要靠派发）。**

### 实证（manager 2026-08-11 04:3x + outer 复核）

- **现状**：`ready-pool-check` 报 `suite_blocking={consecutive_red:3, min_red_window:3, window_active:TRUE}`，tasks 列表 22 条，与 ready 池交集 7 条 ⇒ ready 19 里 7 条被拦，只剩 12。
- **自锁命中**：被拦的 7 条里包含 `gap-install-family-tests-rotate-flakes-under-full-suite` 与 `gap-serial-phase-install-test-residue-dependency`——**正是修套件的那一族**。套件红 ⇒ 拦修套件任务 ⇒ 修不了 ⇒ 套件继续红。
- **逻辑**：修套件的任务必然碰套件文件（Touches 含 plugin/test/ 或 install 族），`failureFileMatches` 把它们归因为 suite-blocker ⇒ 停派。
- **与 .halt 裁定同型**：人此前裁定「停派发好让 outer 自己修红」是死锁，因为修红要靠派发——本机制把同样的死锁机械化。
- **三次连红**：r268（lane8 对照实验）+ r269（invoke-evidence，已修）+ r270（plugin-packaging，workflow Fix 中）。

### 选定机制方向（实现归 inner，判定归 outer）

**suite_blocking 应豁免【其 Touches 与本次失败文件相交、且任务本身就是修这些失败的】那一类**，或至少豁免 suite 基础设施族：
1. **豁免判据**：任务的标题/Proposal 表明它是修 suite 的（如标题含 fix/修/red/install/suite），且其 Touches 与失败文件相交 ⇒ 不拦（它正是来修红的）。
2. **或至少豁免 suite 基础设施族**：gap-install-family / gap-serial-phase-install / gap-suite-* 等 suite 机件任务不参与 suite_blocking 归因。
3. **防止反向误放**：非修 suite 任务碰套件文件仍拦（不能因为豁免放行无关任务）。

**验证锚**：修后 (a) 套件红时 gap-install-family / gap-serial-phase-install 仍可派；(b) 无关任务碰套件文件仍被拦；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录自锁实证（suite_blocking active + 22 拦 + gap-install-family/gap-serial-phase-install 被拦 + 与 .halt 裁定同型）（本任务 Proposal 已含）
- [x] AC2: **豁免修 suite 任务**——Touches 与失败文件相交且任务本身修 suite ⇒ 不拦（gap-install-family/gap-serial-phase-install 可派）
- [x] AC3: **反向不放行**——无关任务碰套件文件仍被拦
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：构造套件红场景 ⇒ gap-install-family 可派 / 无关任务仍拦（贴输出）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/ready-pool-check.ts（computeSuiteBlocking 豁免修 suite 任务）
- plugin/test/ready-pool-check.test.mjs（新增豁免用例）
- tasks/gap-suite-blocking-directory-glob-overbroad.md（交叉标注——同族判据过宽）
- tasks/gap-suite-blocking-self-lock-blocks-fix-family.md（自身：勾 AC + 贴证据）

## Contract

measure   fix_family_dispatchable = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json` 的 stdout 中 gap-install-family 是否在 dispatchable
band      fix_family_dispatchable = true（修 suite 任务套件红时仍可派）
invariant unrelated_still_blocked = 1（无关任务碰套件文件仍被拦）
invariant deadlock_broken = 1（套件红 ≠ 修套件任务停派）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json`（贴 suite_blocking + dispatchable）
control   修 suite 可派；无关仍拦；死锁破除；既有不回归
resume    豁免判据 / 反向控制 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 04:3x 紧急——suite_blocking 自锁：22 拦含修套件族（gap-install-family/gap-serial-phase-install），套件红 ⇒ 拦修套件任务 ⇒ 修不了 ⇒ 继续红（.halt 裁定同型死锁）。处方：豁免修 suite 任务 + 反向控制。实现归 inner，判定归 outer

## Evidence

**实现**（inner 2026-08-11，分步提交 4 个，全部在 worktree `gap-suite-blocking-self-lock-blocks-fix-family`）：
1. `637eaec9` 豁免判据（AC2）——`isSuiteFixTask`（id/标题/Proposal 识别修 suite 任务），`computeSuiteBlocking` 归因循环跳过
2. `51f19eea` 反向控制（AC3）——`exemptFromSuiteBlocking` 双条件 AND 闸（标记 ∧ 真实失败命中），标记单边永不豁免
3. `7942257e` 测试——单元（AND 闸）+ 集成（analyzeTasks 套件红 ⇒ suite-fix 族可派 / 无关仍拦）
4. `af21a05d` 反向控制加固——实跑暴露「Proposal 单独提 suite」误放，Proposal 臂收紧为 fix-intent 共现

**AC2/AC3 实跑**（合成套件红场景：3 连红窗失败文件 `plugin/test/install-family.test.mjs`）：
`node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /tmp/suitelock-demo-2ikY --cap 5 --json`
```
{
  "suite_blocking": {
    "consecutive_red": 3, "min_red_window": 3, "window_active": true,
    "failure_files": ["plugin/test/install-family.test.mjs"],
    "tasks": ["gap-watchdog-unrelated"]          // ← 只拦无关任务（AC3）
  },
  "ready": ["gap-install-family-tests-rotate-flakes-under-full-suite",
            "gap-serial-phase-install-test-residue-dependency",
            "gap-watchdog-unrelated"],
  "pool": 3
}
```
- AC2（死锁破除，Contract band `fix_family_dispatchable=true`）：`gap-install-family` 与 `gap-serial-phase-install` **不在** `suite_blocking.tasks` ⇒ 套件红时仍可派
- AC3（Contract invariant `unrelated_still_blocked=1`）：无关任务 `gap-watchdog-unrelated`（Touches 碰同一失败文件、无修 suite 标记）**仍被拦**
- Contract invariant `deadlock_broken=1`：window_active 保持 true，失败文件如实报告——豁免只放行修 suite 任务，不放行无关任务

**AC4 既有不回归**（scoped 门）：`bash scripts/test.sh --for-task gap-suite-blocking-self-lock-blocks-fix-family --allow-thin`
- EXIT=0；静态检查全 PASS（test-framework-policy / test-isolation 44 baseline / test-impl-census 328 clean / task-contract-check 0 violations / superseded / tick-core / delivery-inventory drift）
- ready-pool-check.test.mjs：65 pass / 0 fail（含新增 `analyzeTasks: suite red ⇒ suite-fix family dispatchable, unrelated task still blocked` 与 `exemptFromSuiteBlocking / isSuiteFixTask` 单元用例）

**DoD 全量套件绿**：留待外层 verification-round 验证（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）。
