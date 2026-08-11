---
id: gap-measure-trend-relative-trigger-lacks-hist-variance-exemption
title: "measure-trend 相对 ≥2× 触发器缺历史方差豁免——高方差大测试低点后回到自身正常带被判「翻倍」假阳性（round-199:
  task-check-passthrough 9575→21293ms 2.22x、acceptance-env 10304→20974ms 2.04x，均
  ≤ 各自历史 max 23183/21445）；d83916e4 只豁免了 absolute 触发器，relative 仍无 withinHistMax
  守卫"
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**`measure-trend-check.ts` 的 `compareLastTwoRounds` 只给 absolute 触发器加了历史方差豁免，relative ≥2× 触发器没有——高方差大测试在低点轮（round-35）后回到自身正常带（round-36）会被判「翻倍」假阳性，round-199 全量套件静态检查红。**

### 实证（outer 2026-08-09 21:10 红窗分诊）

- **round-199 静态检查 red**（0 测试失败，2 个 measure-trend flag + 1 个 CLAUDE.md ratchet——后者 outer 已修 e87187be）：
  - `task-check-passthrough.test.mjs 9575.659 -> 21293.539 ms (+11717.88 ms, 2.22x, relative)`
  - `acceptance-env.test.mjs 10304.329 -> 20974.198 ms (+10669.869 ms, 2.04x, relative)`
- **两文件历史方差**（.quay/measure-history.jsonl rounds 1-36）：
  - task-check-passthrough：min 9079 / **max 23183**（round-32）；round-36 的 21293 ≤ 23183
  - acceptance-env：min 9166 / **max 21445**（round-32）；round-36 的 20974 ≤ 21445
  - round-35（19:02）恰是两文件的低点（9575/10304），round-36 回到正常带 ⇒ 相对 2× 假阳性
- **根因（代码定位）**：`measure-trend-check.ts` line 261 `const rel = !isSmallTest && prevMs > 0 && ratio >= relativeFactor;` —— relative 触发器**没有 `withinHistMax` 守卫**；只有 line 265 的 absolute 触发器有（`abs = growthMs > absoluteMs && !withinHistMax`）。d83916e4（gap-measure-trend-large-test-load-noise AC2，历史方差感知）只豁免了 absolute，relative 漏了。

**为什么重要**：全量套件每轮有概率红在 measure-trend 假阳性上（round-172 曾 13 个 flag 全负载噪声、round-173b it0-dod-check +33s）。历史方差豁免治了 absolute（round-173b 场景），但 high-variance 大测试「低点后回到正常带」的 relative 场景仍误报——套件被静态检查 gate 卡住，0 测试失败就 abort。

### 选定机制方向（实现归内层，接法留执行时）

1. **relative 触发器加 withinHistMax 守卫**：`rel = !isSmallTest && prevMs > 0 && ratio >= relativeFactor && !withinHistMax` —— 与 absolute 同构。真实回归（超出历史 max）relative/absolute 任一仍触发（负控制保留）。
2. **与 d83916e4 的 AC2/AC3 对齐**：该任务 AC3「历史 max 110s + 当前 150s ⇒ flag」本意是「超出历史 max = 真回归，absolute/relative 任一触发」——修后两触发器都应在历史带内被豁免、带外触发。
3. **测试**：measure-trend-check.test.mjs 加「历史 max 内 relative 2× 不 flag」（round-199 场景：prev 低点 9575、curr 正常带 21293、histMax 23183 ⇒ 0 flag）与「超出历史 max 仍 flag」负控制。

**验证锚**：修后 (a) round-199 两文件（task-check-passthrough/acceptance-env）不再 flag（带内）；(b) 超出历史 max 仍 flag（负控制）；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-199 实证（2 文件 relative flag、各自历史方差带、根因代码定位 relative 无 withinHistMax 守卫）（本任务 Proposal 已含）
- [x] AC2: **relative 豁免**——历史带内（currMs ≤ histMax）的 relative ≥2× 不再 flag（与 absolute 同构）
- [x] AC3: **负控制保留**——超出历史 max 的 relative/absolute 任一仍 flag（真实回归不吞）
- [x] AC4: **既有不回归**——measure-trend 既有测试（小测试豁免、历史方差 absolute）仍绿；`--for-task` scoped 门绿
- [ ] AC5: **全量套件绿**——round-199 类场景不再静态检查红（fail 0 且 cancelled 0 且 FULL-SUITE-EXIT=0）——外层 verification-round 验证

## Definition of Done

- [ ] AC1–AC5 全部勾上（AC5 待外层 verification-round 全量套件验证）
- [x] 修后实跑：round-199 两文件带内不 flag（贴任务体）；超出历史 max 仍 flag
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**AC2 修（relative 触发器加 withinHistMax 守卫，与 absolute 同构）**：`plugin/scripts/measure-trend-check.ts` `compareLastTwoRounds` 的 `rel` 由 `!isSmallTest && prevMs > 0 && ratio >= relativeFactor` 改为 `!isSmallTest && prevMs > 0 && ratio >= relativeFactor && !withinHistMax`。`withinHistMax` 计算移到 `rel` 之前（避免 TDZ）；`abs` 不变（`growthMs > absoluteMs && !withinHistMax`）。真实回归（超出历史 max）relative/absolute 任一仍触发。

**AC1/AC3 验证（CLI 端到端，round-199 实证数字）**：
- 带内不 flag：构造历史 rounds 1-4 = task-check-passthrough 9079→23183(histMax)→9575(低点)→**21293**、acceptance-env 9166→21445(histMax)→10304(低点)→**20974** —— `--json --no-land` 输出 `slowFiles: 0`，`grep -c growth` = **0**（round-199 两文件带内相对 2.22×/2.04× 不再误判翻倍）。
- 带外仍 flag：构造 a.test 10000→16000(histMax)→**33000**（2.06× 相对、超历史 max、绝对 +17s < +30s）—— 输出 1 条 growth，`reason: "relative"`（超出历史 max 的真实回归不被吞）。

**AC4 不回归**：measure-trend-check.test.mjs **13/13 pass / 0 fail / 0 cancelled**（新增 2 个测试：带内 relative 2× 不 flag（round-199 场景）、带外 relative 2× 仍 flag 负控制）；既有小测试豁免 + 历史方差 absolute 测试仍绿。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-measure-trend-relative-trigger-lacks-hist-variance-exemption --allow-thin` → **exit 0，13 pass / 0 fail / 0 cancelled，task-contract-check no violations，violations 0**。

**注**：本 worktree 从 stale `origin/develop`（2e7ccc5a，缺 d83916e4/c5cb083f 两个同族修复）fork，已将 `measure-trend-check.ts`/`measure-trend-check.test.mjs`/两个同族任务文件同步到当前 develop（b80478db）状态后施加本次修复。

## Evidence（2026-08-11 re-dispatch 重验证）

**重派发背景**：本任务落点提交 `93f87930`（develop 祖先）已含 AC2 修（`rel = !isSmallTest && prevMs > 0 && ratio >= relativeFactor && !withinHistMax`，`withinHistMax` 先于 `rel` 声明避免 TDZ）与 AC3 负控制测试。本次 worktree 从当前 develop（2be095ae）fork，代码即已满足 AC2/AC3，无新增源码 diff——重验证确认实现在场。

**AC2/AC3 重验证（scoped 门）**：`bash scripts/test.sh --for-task gap-measure-trend-relative-trigger-lacks-hist-variance-exemption --allow-thin` → **exit 0，13 pass / 0 fail / 0 cancelled，task-contract-check no violations，violations 0**。两个新增用例绿：`AC2 — in-band relative ≥2× on a large test is NOT flagged (round-199 hist-variance scenario)`（task-check-passthrough 9575→21293 ≤ histMax 23183、acceptance-env 10304→20974 ≤ histMax 21445 ⇒ 0 flag）、`AC3 — relative ≥2× EXCEEDING the historical max still flags (real regression not swallowed)`（a.test 10000→16000→33000 ⇒ 1 growth，reason=relative）。既有 11 用例（小测试豁免、历史方差 absolute 带内/带外、exact-2× control、NO-growth）仍绿 ⇒ AC4 不回归确认。

**AC5**：仍待外层 verification-round 全量套件验证（本内层不勾）。

## Touches

- plugin/scripts/measure-trend-check.ts（compareLastTwoRounds：relative 触发器加 withinHistMax 守卫，与 absolute 同构）
- plugin/test/measure-trend-check.test.mjs（AC2-AC3 fixture：历史带内 relative 2× 不 flag；带外仍 flag）
- tasks/gap-measure-trend-large-test-load-noise.md（交叉标注——同族：历史方差豁免的 relative 缺口）
- tasks/gap-measure-trend-load-noise-false-positive.md（交叉标注——同族：小测试豁免的后续缺口）
- tasks/gap-measure-trend-relative-trigger-lacks-hist-variance-exemption.md（自身：勾 AC + 贴证据）

## Contract

measure   measure_trend_relative_red_after_fix = `grep -c "measure-trend growth" .quay/full-suite.log` 的 stdout 数字（round-199 类场景）
band      measure_trend_relative_red_after_fix = 0（历史带内 relative 2× 不再 flag）
invariant beyond_hist_max_still_flags = 1（超出历史 max 仍 flag）
invariant existing_tests_green = 1（measure-trend 既有测试不回归）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/measure-trend-check.test.mjs`
control   带内不 flag；带外仍 flag；既有测试绿
resume    relative 守卫 + 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 红窗分诊（round-199 静态检查 red）——相对 ≥2× 触发器缺历史方差豁免，高方差大测试低点后回到正常带被误判翻倍（task-check-passthrough 9575→21293 ≤ histMax 23183、acceptance-env 10304→20974 ≤ histMax 21445）。根因代码定位 line 261 rel 无 withinHistMax 守卫。同族 gap-measure-trend-large-test-load-noise。实现归内层
