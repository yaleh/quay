---
id: gap-ready-pool-unknown-flag-fail-open
title: ready-pool-check.ts 未知 flag 静默忽略且 exit 0——fail-open（任何臆造 flag
  都拿正常输出+成功码，「看起来做了其实没做」制造机）；--promote 不存在只在注释，真实路径是 quay promote &lt;id&gt;
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

**`ready-pool-check.ts` 未知 flag 静默忽略且 exit 0——fail-open：任何拼错或臆造的 flag（如 `--this-flag-does-not-exist-xyz`）都拿到正常 JSON + 成功退出码，「看起来做了、其实没做」的通用制造机。且 `--promote` 这个 flag 根本不存在（源码只在注释里提 promote，真实路径是读 `targeted_promotion` 后由调用者跑 `quay promote <id>`），是发现性缺陷。**

### 实证（manager 2026-08-09 实测 + outer 复核）

**① 未知 flag fail-open**：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --this-flag-does-not-exist-xyz
exit: 0
{ "pool": 13, "floor": 12, ... }   ← 正常 JSON，成功退出
```
**期望输出**：未知 flag ⇒ 报错（usage/unknown flag）+ exit 非 0（fail-closed）。
**实际输出**：正常 JSON + exit 0（未知 flag 被静默忽略）。

**② `--promote` 不存在**：`grep -n "promote" plugin/scripts/ready-pool-check.ts` 全文命中只在注释里（line 7/30/62/64/85/107/532/537）；flag parser（line 934-943）处理 `--root/--json/--apply/--cap/--floor-mult/--top/--targeted/--develop/--integration/--master` 但**无 else 分支**处理未知 flag ⇒ 静默忽略。真实 promote 路径：脚本报告 `targeted_promotion` 字段，调用者自己跑 `quay promote <id>`。

**③ 同类先例**：与今晚 no-action 零成本、1/4 抄成标签、last-pane 死文件同一族——「看起来做了、其实没做」。绕过它 = 把制造机留给下一个人。

### 规则（manager 裁定，写进核）

**绕过不是罪，不留痕才是。** 撞上本项目工具的缺陷 ⇒ 最低线是立案（带复现命令 + 期望输出 + 实际输出），然后可以继续绕过把手上的活干完；但不立案就绕过，缺陷永久化。CLAUDE.md 对 archguard/meta-cc 已有同形原则「report/fix issues rather than working around them」——对本仓库自己的工具只会更强。

### 修的方向（实现归内层）

- 候选 A：**未知 flag fail-closed**——flag parser 加 else 分支：未知 flag ⇒ stderr 报「unknown flag: X」+ exit 非 0（与 task-contract-check 等的 `unknown flag` 行为一致）。
- 候选 B：**`--promote` 实现或文档化**——若 `--promote` 语义上自然，实现它（等价于 `--apply` 对单任务）；否则在 `--help` 明确「promote 由 `quay promote <id>` 执行，本脚本只报告 `targeted_promotion`」。

**验证锚**：修后，(a) `--this-flag-does-not-exist-xyz` ⇒ 报错 + exit 非 0；(b) 既有已知 flag（--apply/--targeted/--cap）行为不回归；(c) `--help`（或文档）明确 promote 的正确入口。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实证（未知 flag exit 0 + `--promote` 不存在只在注释 + fail-open 本质）（本任务 Proposal 已含；内层补：直接跑复现）
- [x] AC2: **未知 flag fail-closed**——`--this-flag-does-not-exist-xyz` ⇒ stderr 报 unknown flag + exit 非 0（不再静默忽略 + exit 0）
- [x] AC3: **`--promote` 明确**——实现它（等价 --apply 单任务）或在 `--help`/文档明确「promote 由 quay promote <id> 执行，本脚本只报告 targeted_promotion」
- [x] AC4: **既有 flag 不回归**——--apply/--targeted/--cap/--json 行为不变（构造回归跑）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 ready-pool 契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：未知 flag ⇒ 报错+exit 非 0；--apply/--targeted 正常；--help 明确 promote 入口（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**AC1 复现**：`node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --this-flag-does-not-exist-xyz` → 旧行为 **exit 0 + 正常 JSON**（`{pool:14, floor:12, ...}`）——未知 flag 被静默忽略。

**AC2 修**（`plugin/scripts/ready-pool-check.ts` flag parser 加 `else` 分支）：未知 flag ⇒ `ready-pool-check: unknown flag: <X> (run with --help...)` + **exit 2**。实跑：`--this-flag-does-not-exist-xyz` → exit 2 + stderr 报 unknown flag ✓。

**AC3 修**（`--promote` 分支）：`--promote` 是臆造 flag——真实入口是 `quay promote <id>`。加显式 fail-closed 分支：`ready-pool-check: --promote is not a flag. Use \`quay promote <id>\` (or --targeted <id> to query, then run quay promote).` + exit 2。头部 usage 注释已含 `--targeted <id>` → `quay promote <id>` 路径（AC3 文档化满足）。

**AC4 回归**：`--apply --cap 4` → exit 0，JSON 正常（pool:14, applied_promotions:0）——既有 flag 行为不变 ✓。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-ready-pool-unknown-flag-fail-open --allow-thin` → **exit 0，55 pass / 0 fail，violations 0**。

## Touches

- plugin/scripts/ready-pool-check.ts（flag parser 加 else fail-closed 分支 + --promote 实现/文档化）
- plugin/test/（新增：未知 flag ⇒ 非 0；--promote 行为）
- orchestration/orchestrator-tick-core.md（「绕过不是罪不留痕才是」规则——立案最低线，已写外层文档待内层核实）
- tasks/gap-ready-pool-unknown-flag-fail-open.md（自身：勾 AC + 贴证据）

## Contract

measure   unknown_flag_exit = `node plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --this-flag-does-not-exist-xyz` 的 exit code
band      unknown_flag_exit = 非 0（fail-closed：未知 flag 报错）
invariant known_flags_unchanged = 1（--apply/--targeted/--cap 行为不回归）
invariant promote_entrance_documented = 1（--help/文档明确 quay promote 入口）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --this-flag-does-not-exist-xyz`（贴回）
control   未知 flag ⇒ 非 0；已知 flag 不回归；promote 入口明确
resume    flag parser fail-closed + --promote 实现/文档分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 实测：ready-pool-check 未知 flag 静默忽略 exit 0——fail-open；--promote 不存在只在注释；我调了不存在的动作工具假装成功。规则「绕过不是罪不留痕才是」——最低线立案。实现归内层）
