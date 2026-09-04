---
id: gap-tmux-leak-scan-pattern-unnchored-self-match-phantom-red
title: "full-suite-runner FAILURE_PATTERNS `tmux-leak-scan: FAIL` 未锚定——round-167
  幻影红（self-match 家族第 3 例，c83ce4be/a1b78104 锚了 ✖/__PERFILE__ 漏了它），全量实际全绿"
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

**round-167（df5accde，2026-08-09 11:23-11:32）幻影红（家族第 3 例）：`state=red reason=failed`，`failures[]` 唯一条目是 runner 自己的**通过**测试名 `✔ AC5 e2e — a \`tmux-leak-scan: FAIL\` residual line (candidate C) flips red with failures non-empty (leak is a real residual) (396ms)`——`✔` 前缀证明它通过了。根因：`full-suite-runner.ts:271` 的 `/tmux-leak-scan: FAIL/` **未锚定**——与 c83ce4be（`^✖`）和 a1b78104（`^__PERFILE__`）同一 self-match 家族，内层锚了前两个、漏了 `tmux-leak-scan: FAIL`。全量套件实际全绿。**

### 实证（outer 2026-08-09 11:32 红窗分诊）

- **state.failures[]** = `✔ AC5 e2e — a \`tmux-leak-scan: FAIL\` residual line (candidate C) flips red with failures non-empty (leak is a real residual) (396.686255ms)`——runner 自己的 e2e 测试名，`✔` 前缀证明通过。
- **pattern 现状**（full-suite-runner.ts:271）：`/tmux-leak-scan: FAIL/` 未锚定。真实 leak-scan 行**从列 0 起**是 `tmux-leak-scan: clean — ...` / `tmux-leak-scan: FAIL: ...`（log 实测）；通过的测试名以 `✔` 起并内嵌模式文本 ⇒ 未锚定必误配。
- **同家族已修对照**：c83ce4be 锚 `^✖`、a1b78104 锚 `^__PERFILE__\s+duration_ms=...passed=false\b`——理由都写死在注释里（REAL reporter line starts column-0；PASSING test whose NAME quotes the shape is `✔`-prefixed）。**`tmux-leak-scan: FAIL` 是第三处漏锚。**
- **全量实际绿**：失败明细只有这一条幻影；per-file 全绿（95+ 文件无 passed=false）。

**为什么重要**：这是 red 判定器 self-match 家族的**第三例**——同一模式（runner 的 e2e 测试名内嵌自己的 FAILURE_PATTERN 文本，未锚定则必自误配）。**每轮全量都必幻影红**，批量合 freshness gate 读 `state=red ⇒ 不 merge`，硬卡 28 提交。同一家族三连说明内层修这类缺陷时**只锚了当轮触发的那条 pattern，没有全量扫描 FAILURE_PATTERNS 里所有未锚定的条目**——本次修复应顺手检查整张 FAILURE_PATTERNS 表有没有别的漏锚。

**修的方向（实现归内层）**：
- 候选 A（正道）：`/tmux-leak-scan: FAIL/` → `/^tmux-leak-scan: FAIL/`，加与 c83ce4be 相同的锚定注释（真实 leak-scan 行从列 0 起；通过测试名 `✔` 起不匹配）。
- 候选 B：**全表锚定扫描**——顺手把 FAILURE_PATTERNS 里所有未 `^` 锚定的条目过一遍，确认没有第 4、5 处（`not ok` 已锚、`❯` vitest 行、`Test Files` 行、`FULL-SUITE-EXIT` 都要核实）。
- **负控制必加**：full-suite-runner.test.mjs 新增一条——`✔ AC5 e2e — a \`tmux-leak-scan: FAIL\`...` 形态的通过行（引号内嵌模式文本）**不得**触发 red（与 `^✖`/`^__PERFILE__` 负控制同型）。

**验证锚**：修后，(a) 构造「`✔` 前缀内嵌 `tmux-leak-scan: FAIL` 文本的通过行」⇒ 不触发 red；(b) 真实 `tmux-leak-scan: FAIL: ...` 列 0 行仍触发 red + failures[] 带内容；(c) FAILURE_PATTERNS 全表无其它漏锚；(d) 全量套件回归绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-167 幻影红实证（`state.failures[]`=通过测试名 + 全量实际全绿）（本任务 Proposal 已含；内层补：构造 `✔` 内嵌模式文本的行复现）
- [x] AC2: **`tmux-leak-scan: FAIL` 模式锚定**——`/^tmux-leak-scan: FAIL/`，与 c83ce4be `^✖` / a1b78104 `^__PERFILE__` 同族处理
- [x] AC3: **负控制**——新增测试：`✔` 前缀通过行内嵌 `tmux-leak-scan: FAIL` 文本 ⇒ 不触发 red（与 TASK-67 bare-✖ 负控制同型）
- [x] AC4: **真实失败不回归**——真实列 0 `tmux-leak-scan: FAIL: ...` 行仍触发 red + failures[] 带内容（既有 AC5 e2e 测试仍绿）；**FAILURE_PATTERNS 全表无其它未锚定条目**（`not ok`/`❯`/`Test Files`/`FULL-SUITE-EXIT` 逐一核实）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 runner / FAILURE_PATTERNS 契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构造「`✔` 内嵌模式文本」⇒ 不红；构造「真实列 0 leak-scan FAIL」⇒ 红 + failures[] 带内容；FAILURE_PATTERNS 全表核对（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`，无幻影红）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**AC2 修**（`plugin/scripts/full-suite-runner.ts:271`）：`/tmux-leak-scan: FAIL/` → `/^tmux-leak-scan: FAIL/`（`^` 锚定），注释写明与 c83ce4be `^✖` / a1b78104 `^__PERFILE__` 同一 self-match 家族。

**AC4 全表扫描——不只是当轮 pattern**：`FAILURE_PATTERNS` 原本有 **4 处未锚定**条目（家族第 3 例暴露内层「只锚当轮触发那条」的教训），本次**全部锚定**：
- `/❯\s+...(N tests | M failed).../` → `/^ ?❯\s+...(N tests | M failed).../`（`^ ?`：真实 vitest spec-reporter 行是 ` ❯ <file> ...`，带 1 个可选前导空格，fixture 钉死）
- `/Test Files\s+[1-9]\d*\s+failed/` → `/^Test Files\s+[1-9]\d*\s+failed/`
- `/FULL-SUITE-EXIT=[^0]/` → `/^FULL-SUITE-EXIT=[^0]/`
- `/tmux-leak-scan: FAIL/` → `/^tmux-leak-scan: FAIL/`
锚定后 `python3` 扫描确认 **FAILURE_PATTERNS 全表零未锚定条目**。

**AC3 负控制**（`plugin/test/full-suite-runner.test.mjs` AC2 unit 负控制表新增 4 条）：round-167 幻影行 `✔ AC5 e2e — a \`tmux-leak-scan: FAIL\` residual line ... (396ms)` ⇒ `isFailureLine=false`；另加家族 #4/#5 预防——`✔` 前缀通过名内嵌 `❯ <file> (N tests | 1 failed)` / `Test Files 1 failed` / `FULL-SUITE-EXIT=1` 形状同样不触发。

**AC4 实跑验证**：`isFailureLine("tmux-leak-scan: FAIL — NEW residual ...")` → `true`（真实列 0 仍红）；`isFailureLine("✔ AC5 e2e — a \`tmux-leak-scan: FAIL\` ...")` → `false`（幻影不红）；` ❯ test/foo.test.ts (3 tests | 1 failed)` → `true`；`Test Files  1 failed | 10 passed` → `true`；`FULL-SUITE-EXIT=1` → `true`。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-tmux-leak-scan-pattern-unnchored-self-match-phantom-red --allow-thin` → exit 0，violations 0，full-suite-runner.test.mjs 60 pass / 0 fail（含既有 `✔ AC5 e2e — a \`tmux-leak-scan: FAIL\` residual line ... flips red` 与 `✔ AC2/AC3 e2e — a \`__PERFILE__ ...\`` e2e 仍绿）。

## Touches

- plugin/scripts/full-suite-runner.ts（`/tmux-leak-scan: FAIL/` 加 `^` 锚定 + 全表漏锚扫描）
- plugin/test/full-suite-runner.test.mjs（新增负控制：`✔` 内嵌 `tmux-leak-scan: FAIL` 不触发 red）
- tasks/gap-runner-perfile-pattern-unnchored-self-match-phantom-red.md（交叉标注——同家族第 1 例 `__PERFILE__`）
- tasks/gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak.md（交叉标注——runner 缺陷族）
- tasks/gap-tmux-leak-scan-pattern-unnchored-self-match-phantom-red.md（自身：勾 AC + 贴证据）

## Contract

measure   phantom_red_after_fix = 构造「`✔` 内嵌 `tmux-leak-scan: FAIL` 通过行」后 runner 的 `state`
band      phantom_red_after_fix = green（不触发 red）
invariant real_leak_scan_failure_still_red = 1（真实列 0 `tmux-leak-scan: FAIL: ...` 行仍 state=red + failures[] 带内容）
invariant no_other_unanchored_pattern = 1（FAILURE_PATTERNS 全表无其它未锚定条目）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/full-suite-runner.test.mjs`（负控制 + 既有 e2e 全绿贴回）
control   构造 `✔` 内嵌 ⇒ 不红；真实列 0 ⇒ 红；全量绿
resume    锚定 + 全表扫描 + 负控制分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-167 幻影红——self-match 家族第 3 例：`tmux-leak-scan: FAIL` unanchored 自误配自身通过测试名；c83ce4be/a1b78104 锚了 ✖/__PERFILE__ 漏了它；全量实际绿但每轮必幻影红卡批量合。实现归内层）
