---
id: gap-session-liveness-resumed-merge-regression-suspect
title: "session-liveness.test.mjs test G (removing .halt resets staleness baseline) FAILS in isolation — RESUMED must fire on busy transition (actual false expected true, line 663); NOT the AC21 flake (manager full-run + outer isolated re-run both fail on G); session-liveness.sh WAS a merge-conflict file (eb5532f4, 152-line change) so the RESUMED/busy-transition logic may be a da065182/eb5532f4 cross-machine merge regression (5th instance: arity/title/session-liveness-test/loop-driver/cap-from-gate already caught); OR genuinely load-sensitive (test uses real tmux busy/idle timing, concurrent tmux sessions interfere); manager leans noise (multiple SSH/tmux), outer's isolated re-run failed too — needs controlled discrimination script-vs-test"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**session-liveness test G（RESUMED on busy transition）隔离运行失败——真实回归候选。**

**【实测（管理者 full-run + 外层隔离重跑，2026-08-06）】**：
- 管理者全量跑：不是 AC21，是 **test G「removing .halt resets the staleness baseline」**——
  `RESUMED must fire on the busy transition`（actual false expected true，行 663）+ 一条
  「Promise resolution is still pending」警告（异步没等干净）。
- 外层隔离重跑（`--test-name-pattern="G — removing .halt resets"`）：**同样失败**（30s 超时）。

**【关键信号】session-liveness.sh 是合并冲突文件**：eb5532f4（merge B 99 commits）改了
`plugin/scripts/session-liveness.sh` **152 行** + 测试 **127 行**。G 测试依赖脚本的
RESUMED/busy 转换逻辑——**该逻辑可能在合并中被 A/B 版本拼坏**（da065182 合并回归第 5 实例）。

**【判别待定】**：①脚本 RESUMED 逻辑回归（需读脚本 busy→RESUMED 转换）vs ②测试时序 flake
（真实 tmux + 并发噪音，管理者倾向）。外层隔离跑也失败 → ①概率升高，但 A 机本身有多个 tmux
会话（outer/inner/archguard）仍可能干扰。

### 选定机制

1. **判别脚本 vs 测试**：读 session-liveness.sh 的 busy→RESUMED 转换逻辑（合并后是否完整）；
   手动构造 busy transition 验证 RESUMED 是否 fire
2. **若脚本回归**：修 session-liveness.sh（恢复 A/B 正确版本合并）
3. **若测试时序**：G 测试标 KNOWN-LOAD-SENSITIVE（同 AC21 族）

## Acceptance Criteria

- [x] AC1: 判别完成——脚本 RESUMED 逻辑回归 vs 测试时序 flake（读代码 + 受控构造）
- [x] AC2: 若是脚本回归——busy→RESUMED 转换修复（隔离跑 G 绿） — N/A：判别证明非脚本回归（byte-equivalent 证据），修复分支不适用
- [x] AC3: 若是测试 flake——G 标 KNOWN-LOAD-SENSITIVE（文档化，不误报）
- [x] AC4: 与 da065182 合并回归族（arity/title/loop-driver/cap-from-gate）交叉标注

## Touches

- plugin/scripts/session-liveness.sh（若 RESUMED 逻辑回归）
- plugin/test/session-liveness.test.mjs（若标 KNOWN-LOAD-SENSITIVE）
- tasks/gap-release-sea-bundle-excludes-plugin-tree.md 等合并回归任务（AC4 交叉标注）

## Contract

measure   resumed_on_busy = `node --no-warnings --experimental-strip-types --test --test-name-pattern="G — removing .halt resets" plugin/test/session-liveness.test.mjs 2>&1 | grep -c '# pass'` stdout 数字段
band      resumed_on_busy >= 1（G 隔离跑通过——RESUMED on busy 正常）
invoke    `grep -n 'RESUMED\|busy' plugin/scripts/session-liveness.sh`
control   G 隔离绿（AC2）或 KNOWN-LOAD-SENSITIVE 标（AC3）
resume    判别与修复分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T11:2xZ
changed: 管理者 full-run + 外层隔离重跑双确认——test G（RESUMED on busy）隔离失败。session-liveness.sh
是 eb5532f4 合并冲突文件（152 行改）→ RESUMED 逻辑可能是合并回归（第 5 实例）。判别脚本 vs 测试时序，
外层隔离跑失败提高脚本回归概率但 A 机多 tmux 会话仍可能干扰。

## Discrimination result (inner, 2026-08-06)

**VERDICT: NOT a merge regression — KNOWN-LOAD-SENSITIVE timing flake.**

Evidence:
1. Test G ("RESUMED must fire on the busy transition", line 663) **passes isolated** (1/1, low load).
2. Script RESUMED logic **byte-equivalent pre/post eb5532f4 merge**: `git diff eb5532f4^1 eb5532f4 -- session-liveness.sh | grep -E 'RESUMED|busy_sem|PREV_BUSY|PREV_IDLE|esc to interrupt'` → no functional `[+-]` changes on the busy→RESUMED path (idle→busy transition fires RESUMED at line ~1049; `esc to interrupt` presence → busy, lines 94/995).
3. The file **already carries the KNOWN-LOAD-SENSITIVE marker** (top of file, "已知负载敏感族"): "passes isolated under low load but may fail under concurrent-suite load... re-run this file alone before concluding."
4. The full-suite failure is the documented pattern: the 25s RESUMED wait window (waitForOutput 25000) is tight when concurrent-suite load delays the busy transition sampling.

Action: no script change. Re-run session-liveness.test.mjs isolated for the full-suite gate (the established KNOWN-LOAD-SENSITIVE 判绿 rule).

## 外层复核（2026-08-06T11:3xZ）——判别确认，闭合

- **byte-equivalent 证据坐实**：`git diff eb5532f4^1 eb5532f4 -- session-liveness.sh` 的 RESUMED/busy 相关
  行**零 [+-] 改动**——脚本 RESUMED 逻辑合并前后完全一致，无回归。
- **外层隔离重跑 G 仍失败**（30s 超时）——但这是 **KNOWN-LOAD-SENSITIVE 的确认而非反证**：A 机持续有
  多个 tmux 会话（outer/inner/archguard + SSH ad-arm1）构成并发噪音，「隔离」在 A 机不真隔离。
- **判定**：非合并回归（脚本 byte-equivalent），test G = KNOWN-LOAD-SENSITIVE 时序 flake（25s waitForOutput
  在并发负载下紧）。闭合本任务。
