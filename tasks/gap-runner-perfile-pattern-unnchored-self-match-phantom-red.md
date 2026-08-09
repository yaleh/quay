---
id: gap-runner-perfile-pattern-unnchored-self-match-phantom-red
title: full-suite-runner FAILURE_PATTERNS `__PERFILE__.*passed=false`
  未锚定——round-163 幻影红：匹配到自身通过测试名（`✔ AC2/AC3 e2e — a __PERFILE__ ... passed=false
  per-file line flips red...`），全量套件实际全绿（ℹ fail 0），批量合被卡
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

**round-163（e6cb7232，2026-08-09 10:03-10:18）幻影红：`state=red reason=failed` 但全量套件实际全绿。`state.failures[]` 的唯一条目是 runner 自己的**通过**测试名 `✔ AC2/AC3 e2e — a \`__PERFILE__ ... passed=false\` per-file line flips red and carries the failed file in failures[] (336ms)`——`✔` 前缀证明它通过了。根因：`full-suite-runner.ts:270` 的 `/__PERFILE__.*passed=false/` **未锚定**，与 c83ce4be 刚为 `✖` 修的 self-match 家族同源——inner 锚了 `✖`（`^✖`）但漏了 `__PERFILE__`。**

### 实证（outer 2026-08-09 10:18 红窗分诊）

- **真实结果全绿**：serial `tests 63 / pass 63 / fail 0`；lowconc `tests 202 / pass 201 / cancelled 0 / skipped 1`（1 差是 skip 非 fail）；三处 `ℹ fail 0`。
- **唯一 `not ok 1 - boom`（line 7334）是 runner 自身 fake-suite e2e fixture 的模拟输出**（`full-suite-runner: FINAL state=red ... not ok 1 - boom` 是 fakeCommand 回显），非真实失败。
- **state.failures[]** = `✔ AC2/AC3 e2e — a \`__PERFILE__ ... passed=false\` per-file line flips red and carries the failed file in failures[] (336.35913ms)`。
- **pattern 现状**（full-suite-runner.ts:270）：`/__PERFILE__.*passed=false/` 未锚定。真实 reporter 行**从列 0 起**是 `__PERFILE__ duration_ms=<d> <path> passed=false`（log 实测）；通过的测试名以 `✔` 起并内嵌模式文本 ⇒ 未锚定必误配。
- **同家族已修的对照**：c83ce4be（2026-08-09 10:01）把 `/✖\s+\S.*\(\d+ms\)/` 和 `/✖\s+failing tests?/` 都加 `^` 锚定，理由写死在注释里——「a REAL reporter failure starts the line; a PASSING test whose NAME quotes the shape is ✔-prefixed and must not match」。**`__PERFILE__` 是同一家族唯一漏锚的。**

**为什么重要**：这是 red 判定器的自误配。**每轮全量套件都必幻影红**（runner 的 e2e 测试名恒定在套件里），批量合 freshness gate 读 `state=red ⇒ suiteGreen=false ⇒ 不 merge`——硬卡 21 提交的 integration→develop 推进。不修无法绿。

**修的方向（实现归内层）**：
- 候选 A（正道）：`/__PERFILE__.*passed=false/` → `/^__PERFILE__.*passed=false/`，加与 c83ce4be 相同的 `^` 锚定注释（真实 reporter 行从列 0 起；通过测试名 `✔` 起不匹配）。
- 候选 B：收紧为 `/^__PERFILE__\s+duration_ms=.*\s+passed=false\b/`——匹配真实 reporter 的完整形状（`__PERFILE__ duration_ms=<d> <path> passed=false`），把误配面再收窄。
- **负控制必加**：full-suite-runner.test.mjs 新增一条——`✔ AC2/AC3 e2e — a \`__PERFILE__ ... passed=false\` per-file line flips red...` 形态的通过行（引号内嵌模式文本）**不得**触发 red（与现有 TASK-67 bare-✖ 负控制同型）。

**验证锚**：修后，(a) 构造「`✔` 前缀内嵌 `__PERFILE__ ... passed=false` 文本的通过行」⇒ 不触发 red；(b) 真实 `__PERFILE__ duration_ms=... passed=false` 行仍触发 red + failures[] 带文件路径；(c) 全量套件回归绿（无幻影红）。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-163 幻影红实证（`state.failures[]`=通过测试名 + 全量全绿 + 唯一 not ok 是 fake fixture）（本任务 Proposal 已含；内层补：全量跑一次复现，或构造 `✔` 内嵌模式文本的行复现）
- [x] AC2: **`__PERFILE__` 模式锚定**——`/^__PERFILE__.*passed=false/`（或候选 B 完整形状），与 c83ce4be `^✖` 同族处理
- [x] AC3: **负控制**——新增测试：`✔` 前缀通过行内嵌 `__PERFILE__ ... passed=false` 文本 ⇒ 不触发 red（与 TASK-67 bare-✖ 负控制同型）
- [x] AC4: **真实失败不回归**——真实 `__PERFILE__ duration_ms=... passed=false` 行仍触发 red + failures[] 带文件路径（既有 AC2/AC3 e2e 测试仍绿）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 runner / FAILURE_PATTERNS 契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构造「`✔` 内嵌模式文本」⇒ 不红；构造「真实 per-file 失败」⇒ 红 + failures[] 带路径（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`，无幻影红）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**AC2 修**（`plugin/scripts/full-suite-runner.ts:270`）：`/__PERFILE__.*passed=false/` → `/^__PERFILE__\s+duration_ms=.*\s+passed=false\b/`（候选 B：`^` 锚定 + 完整 reporter 形状）。真实 reporter 行从列 0 起 `__PERFILE__ duration_ms=<d> <path> passed=false`；通过测试名 `✔` 起、内嵌模式文本 ⇒ 不匹配。注释写明与 c83ce4be `^✖` 同族。

**AC3 负控制**（`plugin/test/full-suite-runner.test.mjs` AC2 unit 负控制表新增）：round-163 幻影行 `✔ AC2/AC3 e2e — a \`__PERFILE__ duration_ms=336 ... passed=false\` per-file line flips red... (336ms)` ⇒ `isFailureLine=false`（不触发 red）。

**AC4 实跑**：`isFailureLine("__PERFILE__ duration_ms=3580.991183 ... verify-delivery-surface.test.mjs passed=false")` → `true`（真实 per-file 失败仍红 + 路径在行上进 failures[]）；`__PERFILE__ ... passed=true` → `false`。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-runner-perfile-pattern-unnchored-self-match-phantom-red --allow-thin` → exit 0，violations 0，full-suite-runner.test.mjs 57 pass / 0 fail。

## Touches

- plugin/scripts/full-suite-runner.ts（`/__PERFILE__.*passed=false/` 加 `^` 锚定或收紧形状）
- plugin/test/full-suite-runner.test.mjs（新增负控制：`✔` 内嵌模式文本不触发 red）
- tasks/gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed.md（交叉标注——f4333674 引入的 unanchored 残留，本任务是它族第二路径）
- tasks/gap-runner-perfile-pattern-unnchored-self-match-phantom-red.md（自身：勾 AC + 贴证据）

## Contract

measure   phantom_red_after_fix = 构造「`✔` 内嵌 `__PERFILE__ ... passed=false` 通过行」后 runner 的 `state`
band      phantom_red_after_fix = green（不触发 red）
invariant real_perfile_failure_still_red = 1（真实 `__PERFILE__ ... passed=false` 行仍 state=red + failures[] 带路径）
invariant full_suite_no_phantom_red = 1（全量套件绿，无幻影红）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/full-suite-runner.test.mjs`（负控制 + 既有 e2e 全绿贴回）
control   构造 `✔` 内嵌 ⇒ 不红；真实 per-file ⇒ 红；全量绿
resume    锚定 + 负控制分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-163 幻影红红窗分诊：`__PERFILE__.*passed=false` unanchored 自误配自身通过测试名——与 c83ce4be `^✖` 同族漏锚；全量实际全绿但每轮必幻影红卡批量合。实现归内层）
