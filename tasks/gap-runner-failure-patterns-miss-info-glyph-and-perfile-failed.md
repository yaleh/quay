---
id: gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed
title: "full-suite-runner 的 FAILURE_PATTERNS 漏 `ℹ fail N`/`✖`/`__PERFILE__ passed=false`——真实失败红 state=red reason=failed 但 failures=[] redAt=null（第三种路径，42aad5fe 只修了 testsSeen 没修 FAILURE_PATTERNS）"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**round-149 全量套件（b4a90390，2026-08-09 05:50-06:08）红：`state=red reason=failed` 但 `failures=[]`、`redAt=null`——红有结论却不携带失败明细。根因：runner 的 `FAILURE_PATTERNS` 只认 `not ok` / `# fail [1-9]` / vitest `❯`，而本仓 measure-suite-reporter 输出的是 `ℹ fail 1`、`✖ <testname>`、`__PERFILE__ ... passed=false`——三个真实失败形态全漏。**

### 实证（outer 2026-08-09 06:1x 核实）

**真实失败**（round-149 主相位，line 7127/7373/7701）：
- `__PERFILE__ duration_ms=3580.991183 .../verify-delivery-surface.test.mjs passed=false`
- `✖ AC1/AC2 — the real bundle inventory matches the outline §6 snapshot (--inventory exits 0)`（TAP 失败明细块 `✖ failing tests:` 也在 line 7707）
- TAP 汇总 `ℹ fail 1`（line 7701，info 字形）

**runner 的表现**：
- `FAILURE_PATTERNS`（full-suite-runner.ts:251-258）：`/^not ok\b/`、`/^#\s*fail\s+[1-9]/`、`/^#\s*cancelled\s+[1-9]/`、vitest `❯` 形态、`Test Files`、`FULL-SUITE-EXIT`——**没有任何一条匹配 `ℹ fail 1` 或 `✖` 或 `passed=false`**。
- 于是 `redDetected` 恒 false → 终态走「exit 非 0 且无任何标记」的 fail-closed catch-all → `reason=failed` 但 `failures=[]`、`redAt=null`。
- **同一族缺陷的未修残留**：42aad5fe 把 `testsSeen`/`tapPass`/`tapFail`/`tapCancelled` 的正则改成了 `[#ℹ]` 双前缀（full-suite-runner.ts:1014-1019），**但 `FAILURE_PATTERNS`（红判定）没有同步加 `[#ℹ]`**——所以汇总统计能看到 `fail 1`，红判定却看不到。
- **连锁第二缺陷**：`if [ "$code" -eq 0 ] && ! bash tmux-leak-scan.sh --check`（scripts/test.sh:948）——主相位非 0 ⇒ `&&` 短路 ⇒ **tmux-leak-scan 被跳过**（snapshot 未被删，本可报出泄漏类残留，也被吞掉）。

**后果**：真实测试失败被标成 reason=failed 却 `failures=[]`（看不出哪个文件失败）+ `redAt=null`（看不出何时红）——「红有结论却不携带失败明细」正是 e1f34338/42aad5fe 想消灭的缺陷类，本任务是该族的**第三种路径**（前两种：static-check 明细、testsSeen 正则）。

**修的方向（实现归内层）**：
- 候选 A：**FAILURE_PATTERNS 认 reporter 字形**——`# fail`/`# cancelled` 加 `[#ℹ]` 前缀；新增 `✖\s+`（TAP 失败明细块首行）与 `__PERFILE__.*passed=false`（measure-suite-reporter 每文件行）形态；`not ok` 保留（仍有 TAP 直连场景）。
- 候选 B：**红判定复用汇总统计**——`tapFail > 0 || tapCancelled > 0` 且没有对应 `#/ℹ pass` 覆盖时即 redDetected（汇总统计与红判定同源，不双写 pattern）。
- 候选 C：**tmux-leak-scan 不被短路吞**——`&&` 短路导致 code≠0 时 scan 不跑；改为无条件跑 scan、泄漏类残留合并进 failures[]（泄漏=真实残留，独立于测试失败报告）。

**验证锚**：修后，(a) 构造 `ℹ fail 1` + `✖ x` + `__PERFILE__ passed=false` 的 fake suite ⇒ state=red reason=failed 且 failures[] 非空（至少一个文件/测试名）；(b) 真实静态违规仍 reason=static-check（不回归）；(c) 泄漏类残留即使测试红也报出（scan 不短路）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 round-149 实证（`ℹ fail 1`/`✖`/`passed=false` 三形态 + failures=[] + redAt=null + leak-scan 被短路吞）（本任务 Proposal 已含；内层补构造复现 fixture）
- [ ] AC2: **FAILURE_PATTERNS 认 reporter 字形**——`ℹ fail N`/`ℹ cancelled N`/`✖ <name>`/`__PERFILE__ passed=false` 至少一条触发 redDetected（或候选 B 的汇总统计等效判定）
- [ ] AC3: **红带明细**——真实失败红 state=red reason=failed 且 failures[] 非空（含文件/测试名），redAt 有值
- [ ] AC4: **不回归**——静态违规仍 reason=static-check；`not ok` 直连 TAP 仍触发；既有 full-suite-runner 测试全绿
- [ ] AC5: **tmux-leak-scan 不被短路吞**——测试红时 scan 仍跑（泄漏残留独立报告，或候选 C 落地的合并语义）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：构造「`ℹ fail 1` fake suite」⇒ failures[] 非空；构造「真实违规」⇒ reason=static-check 不回归；构造「测试红 + 泄漏残留」⇒ 两者都报（贴任务体）
- [ ] 既有 full-suite-runner 测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（FAILURE_PATTERNS 认 reporter 字形 / 候选 B 汇总判定 / 候选 C 不短路）
- plugin/test/full-suite-runner.test.mjs（新增：ℹ fail / ✖ / passed=false 触发 red + failures 非空 + scan 不短路）
- scripts/test.sh（候选 C 时：tmux-leak-scan 从 `&&` 短路改为无条件跑）
- tasks/gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed.md（自身：勾 AC + 贴证据）

## Contract

measure   failures_nonempty_on_info_red = 构造 `ℹ fail 1` fake suite 后 runner 的 `failures.length`
band      failures_nonempty_on_info_red = ≥ 1（真实失败红 failures[] 非空）
invariant static_check_reason_preserved = 1（真实静态违规仍 reason=static-check）
invariant leak_scan_not_short_circuited = 1（测试红时 tmux-leak-scan 仍跑，残留报出）
invoke    `node plugin/scripts/full-suite-runner.ts --static-check-check`（真实静态违规链仍 PASS）+ scoped 测试
control   `ℹ fail 1` ⇒ red + failures 非空；`✖` ⇒ red；`passed=false` ⇒ red；静态违规 ⇒ static-check 不回归
resume    pattern 修正 + 汇总判定 + 不短路分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-149 全量套件红：真实失败 verify-delivery-surface.test.mjs 但 failures=[]/redAt=null——FAILURE_PATTERNS 漏 `ℹ`/`✖`/`passed=false` 三字形，42aad5fe 只修了 testsSeen 没修红判定；连锁：code≠0 短路吞掉 tmux-leak-scan。实现归内层）
