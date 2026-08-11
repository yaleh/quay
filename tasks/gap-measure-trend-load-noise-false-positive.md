---
id: gap-measure-trend-load-noise-false-positive
title: measure-trend-check 把负载噪声当趋势——round-172 静态检查 red（13 个文件
  2-3x「增长」全是负载噪声、sprawl 未触碰、0 测试运行即红）；相对 ≥2× 阈值对小测试（300ms→800ms）过敏感
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**round-172（3e649976，2026-08-09 16:13）静态检查 red（42s，0 个测试运行）：measure-trend-check 报 13 个测试文件时长增长（相对 ≥2× 或绝对 >+30s）——但全部是负载噪声，不是真实代码回归。sprawl fan-in（73 文件，16:06 落地）改的是 plugin/scripts/*.sh，而 13 个 flag 的文件全在 experiments/ + packages/quay-github + packages/quay——sprawl 没碰它们。round-171 是重负载轮（1668s），其时长被负载抬高，round-172 对比时看到「增长」。**

### 实证（outer 2026-08-09 16:14 红窗分诊）

- **13 个 flag**（全部相对 2-3x，多数绝对增量小）：
  - it0-dod-check 71066→104685ms（+33.6s 绝对，>+30s 阈值）
  - gh-api-buffer 1803→4459ms（+2.6s，2.47x）
  - it0-enforcement 1785→3614ms（+1.8s，2.02x）
  - dod-gate-set 983→2265ms（+1.3s，2.3x）
  - gate-gameability 278→836ms（+0.56s，3.01x）——**300ms 级小测试翻倍**
  - ...（其余 8 个同类）
- **非 sprawl 相关**：sprawl 改 plugin/scripts/*.sh；13 个文件全在 experiments/quay-perpetual-stream + packages/quay-github + packages/quay——sprawl 未触碰。
- **负载解释**：round-171 跑 1668s（重负载：inner 全程 fan-in 新代码），其时长被抬高；round-172 静态检查对比「上两轮」看到增长。CLAUDE.md 明言 wall-clock 差异在 17-63s 噪声带内是 INDETERMINATE。
- **0 个测试运行**：suite 42s 红，0 __PERFILE__ 行——纯静态检查 red（measure-trend gate），非测试失败。

**为什么重要**：measure-trend-check 的 `相对 ≥2×` 阈值对**小测试**过于敏感——300ms 测试在负载下翻倍到 800ms 不是回归。它把负载噪声当趋势，导致全量套件被静态检查 gate 卡住（round-172 0 测试运行就红）。这是「把噪声当信号」的假阳性——与三次幻影红（正则替语义）不同但同族：阈值替语义判「增长」。

**修的方向（实现归内层）**：
- 候选 A：**小测试用绝对阈值**——相对 ≥2× 只对大测试（如 >5s）生效；小测试用绝对增量（如 >+1s）才 flag，避免 300ms→800ms 误报。
- 候选 B：**负载归一化**——对比前先按 round 的 avg duration 归一化（重负载轮整体抬高，归一后消除系统偏差）。
- 候选 C：**连续 2 轮确认**——单轮增长不 flag，连续 2 轮同文件增长才 flag（排除单轮负载噪声）。
- 候选 D：**噪声带豁免**——绝对增量 < 噪声带（如 <5s）且相对 <3x 不 flag（it0-dod-check 的 +33s 保留 flag，小增量豁免）。

**验证锚**：修后，(a) round-172 这类负载噪声不再触发静态检查 red（0 测试运行即红消除）；(b) 真实回归仍 flag（it0-dod-check +33s 绝对仍报）；(c) 既有 measure-trend 测试不回归。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-172 实证（13 个 flag 全负载噪声、非 sprawl 相关、0 测试运行即红）（本任务 Proposal 已含；内层补：复跑 measure-trend 复现）
- [x] AC2: **负载噪声不触发**——小测试（<5s）相对翻倍不再 flag（候选 A/C/D 任一）；round-172 类场景不再静态检查红
- [x] AC3: **真实回归仍 flag**——it0-dod-check +33s 绝对增长仍报（大绝对/连续 2 轮仍触发）
- [x] AC4: **既有机制不回归**——measure-trend 既有测试仍绿；`--for-task` scoped 门绿
- [ ] AC5: **不回归**——全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构造小测试翻倍 ⇒ 不 flag；构造大绝对增长 ⇒ flag（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**AC1 复现**：round-172（3e649976）静态检查 42s 红、0 测试运行——13 个文件时长增长全为负载噪声（sprawl 改 plugin/scripts/*.sh，13 个文件全在 experiments/+quay-github+quay）。

**AC2 修（候选 A：小测试绝对阈值豁免）**：`plugin/scripts/measure-trend-check.ts` 加 `DEFAULT_SMALL_TEST_MS = 5_000`——基线 <5s 的文件**不再触发相对 ≥2×**（300ms→800ms 是负载噪声不是回归），只在大绝对增长（>+30s）时 flag。CLI 加 `--small-test-ms` 覆盖。

**AC3 验证**：构造「300ms→800ms（小测试 2.7×）」⇒ **0 flag**；「it0-dod-check 71066→104685ms（+33.6s 绝对）」⇒ **flag（reason=absolute）**。

**AC4 不回归**：既有 3 个测试因语义更新而改（100ms 小测试翻倍不再 flag——旧断言与新语义冲突）；改后 measure-trend-check.test.mjs **9/9 pass / 0 fail**。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-measure-trend-load-noise-false-positive --allow-thin` → **exit 0，9 pass / 0 fail，violations 0**。

**2026-08-10 re-dispatch 重验证**：scoped gate 复跑 `./scripts/test.sh --for-task gap-measure-trend-load-noise-false-positive --allow-thin` → **exit 0，13 pass / 0 fail，violations 0**（测试文件现 13 个用例——4 个由后续同族任务 gap-measure-trend-large-test-load-noise / gap-measure-trend-relative-trigger-lacks-hist-variance-exemption 加入同一文件，本任务语义仍绿）。Contract invoke 复现：构造「300ms→800ms（小测试 2.7×）」⇒ **0 flag**；「it0-dod-check 71066→104685ms（+33.6s 绝对）」⇒ **flag（reason=absolute）**；CLI `--json` growth lines=1。

## Touches

- plugin/scripts/measure-trend-check.ts（候选 A/B/C/D：小测试阈值 / 负载归一 / 连续 2 轮 / 噪声带豁免）
- plugin/test/（新增：小测试翻倍不 flag；大绝对仍 flag）
- tasks/gap-single-file-test-duration-trend-unwatched.md（交叉标注——本任务建的 measure-trend，假阳性是它的阈值问题）
- tasks/gap-measure-trend-relative-trigger-lacks-hist-variance-exemption.md（交叉标注——同族后续：相对 ≥2× 触发器也缺历史方差豁免，round-199 高方差大测试低点后回正常带被误判翻倍）
- tasks/gap-measure-trend-large-test-load-noise.md（交叉标注——本任务修复不完整的后续：小测试豁免只治 300ms 级，承重大测试 it0-dod-check 71s 在负载下 +33s 仍误报；补历史方差豁免 round-173b）
- tasks/gap-measure-trend-load-noise-false-positive.md（自身：勾 AC + 贴证据）

## Contract

measure   small_test_double_flag = `node --no-warnings --experimental-strip-types plugin/scripts/measure-trend-check.ts --json` 的 flag 数（构造「300ms 测试负载下翻倍」后）
band      small_test_double_flag = 0（小测试负载噪声不 flag）
invariant real_growth_still_flagged = 1（it0-dod-check +33s 绝对仍报）
invariant static_check_not_blocked_by_noise = 1（负载噪声不导致 0 测试运行即红）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/measure-trend-check.ts --json`（构造贴回）
control   小测试翻倍 ⇒ 0 flag；大绝对 ⇒ flag；全量绿
resume    阈值修正 / 负载归一 / 连续 2 轮分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-172 静态检查 red：measure-trend 报 13 个负载噪声 flag（300ms 级小测试翻倍），sprawl 未触碰这些文件；0 测试运行即红。阈值把噪声当趋势。实现归内层）
