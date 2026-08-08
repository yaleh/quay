---
id: gap-adr016-md5-ban-violated-in-shipped-md-and-checker-scope-gap
title: ADR-016 的 md5(capture-pane) 禁令在出货的 plugin/loop/*.md 里被违反、检查器扫不到—— ① 检查器
  SHELL_EXT 只扫 .sh/.bash（:79），.md 有意豁免（散文）、但 .ts 也不扫（漏，非设计）； ②
  plugin/loop/orchestrator-loop-tick.md:309-310 与 manager-loop-tick.md:85
  是【指令】不是散文的 md5(capture-pane) bash 块，外层照着做即违规，run_static_checks 不拦； ③
  漂移：plugin/loop/manager-loop-tick.md（318 行）vs
  orchestration/manager-loop-tick.md（527 行） 同文档两副本分叉（CLAUDE.md 点名的 drift 形态）；管理者
  2026-08-08 实测报告（7c1ef5f3 只改了 orchestration/ 那份，plugin/ 归外层）；一般形态：机械检查器作用域边界 =
  同规则散文副本能安静违规处， 出货 .md 的 bash 块是【指令】与 .sh 同权，不该按散文豁免
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

**ADR-016 的 md5(capture-pane) 禁令在出货的 `plugin/loop/*.md` 里被违反，检查器作用域扫不到。**

### 管理者 2026-08-08 实测报告（未修，不越界）

**① 检查器作用域**：`plugin/scripts/adr016-screen-use-check.ts:79`
`const SHELL_EXT = new Set([".sh", ".bash"])`（:150 唯一用法）⇒ 只扫 .sh/.bash。
.md 不扫（第 16-17 行注释是【有意】如此，为放过 ADR 自己的散文），但 **.ts 也不扫**——
这一条注释里没提，像是漏的，不像是设计的。

**② 违规点（都在 plugin/ 出货内容里）**：
- a) `plugin/loop/orchestrator-loop-tick.md:309-310`——可执行 bash 块：
  ```
  tmux capture-pane -p -t "$TMUX_SESSION" | md5sum; sleep 25
  tmux capture-pane -p -t "$TMUX_SESSION" | md5sum      # 两次相同 = 空闲
  ```
  正是 ADR-016:121-123 点名禁止的 md5(capture-pane) 族，且它是**指令**不是散文——
  外层照着做就会违规，而 run_static_checks 不会拦。
- b) `plugin/loop/manager-loop-tick.md:85`——同一形态（「两次 md5sum 相同 = 空闲」）。

**③ 附带发现（drift）**：`plugin/loop/manager-loop-tick.md` 318 行 vs
`orchestration/manager-loop-tick.md` 527 行，md5 不同——同一份 tick 文档两个副本已分叉。
CLAUDE.md 点名的形态：「content living in two places…fix the SOURCE, not just the artifact」。
管理者 2026-08-08 这一轮只改了 `orchestration/` 那份（7c1ef5f3），`plugin/` 那份没动——归外层/内层。

### 合规替代形态（管理者已实测可用）

底部区域 + 枚举态（ADR-016 Amendment 允许）：
```bash
tmux capture-pane -p -t <pane> | tail -3 | grep -q 'esc to interrupt' && echo busy || echo idle
```
实测判别力真实存在：inner 命中=1（busy）、outer 命中=0（idle）。
注意别写成 `-S -3`——`-S` 是【起始行】不是行数，负值进历史缓冲，取到的是「历史往前 3 行 → 屏幕
底部」一大段，首行是正文，取不到状态行 ⇒ 忙闲判别恒为「闲」。管理者自己两处文档都踩了这个，已改。

### 一般形态（值得进 ADR 或检查器注释）

**机械检查器的作用域边界，就是同一条规则的散文副本能安静违规的地方。**
出货的 `.md` 里的 bash 块是【指令】，与 `.sh` 同权，不该按散文豁免。

## Contract

```
measure md5_capture_pane_in_md = `grep -rnE "capture-pane.*md5sum|md5sum.*capture-pane" plugin/loop/ packages/quay/plugin/loop/ 2>/dev/null | wc -l` stdout 数字段
band md5_capture_pane_in_md = 0（修复后出货 .md 无 md5(capture-pane) 指令块；当前=2：orchestrator-loop-tick.md:309-310 + manager-loop-tick.md:85）
invoke `grep -rn "capture-pane" plugin/loop/*.md | grep md5sum`
control 负控制：ADR 自身散文（adr/ADR-016*.md 提到 md5(capture-pane)）不计数；合规替代形态（tail -3 | grep 'esc to interrupt'）不误报
resume 若中断，先跑 measure 确认当前违规数，不要假设已修
```

## Acceptance Criteria

- [ ] AC1: **两处违规修复**——`plugin/loop/orchestrator-loop-tick.md:309-310` 与
      `plugin/loop/manager-loop-tick.md:85` 的 md5(capture-pane) 指令块改为合规替代形态
      （`tail -3 | grep -q 'esc to interrupt'`），外层照做不再违规
- [ ] AC2: **检查器作用域补 .ts**——`adr016-screen-use-check.ts` SHELL_EXT 补 `.ts`（若 .ts 里
      确有同形态），或注释明确为何不扫 .ts（决策记录，非静默漏）
- [ ] AC3: **.md 指令块判定**——检查器是否扩展为扫描出货 .md 里的 bash 块（区分指令 vs 散文），
      写设计说明；若扩展，ADR 自身散文仍豁免
- [ ] AC4: **drift 修复**——`plugin/loop/manager-loop-tick.md` 与 `orchestration/manager-loop-tick.md`
      同步（修 SOURCE 非 artifact）；确认 plugin/loop/orchestrator-loop-tick 与 orchestration/ 的
      关系（模板 vs 部署位，还是同一份的副本）
- [ ] AC5: 与 `gap-adr016-*` 既有任务族交叉标注

## Definition of Done

- [ ] AC1-AC5 实跑输出贴任务体（违规改前后对照 + 检查器作用域 + drift 同步）

## Touches
- plugin/loop/orchestrator-loop-tick.md（:309-310 改合规形态）
- plugin/loop/manager-loop-tick.md（:85 改合规形态 + drift 同步）
- plugin/scripts/adr016-screen-use-check.ts（AC2/AC3：.ts 作用域 + .md 指令块判定）
- orchestration/manager-loop-tick.md（若 drift 需同步）
- tasks/gap-adr016-*（AC5 交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-08T07:5xZ
changed: 管理者 2026-08-08 实测报告（检查器 SHELL_EXT 只扫 .sh/.bash、.md 有意豁免但 .ts 是漏；
  plugin/loop 两处 md5(capture-pane) 指令块；plugin/orchestration 两副本漂移）。外层独立复核：
  SHELL_EXT:79 确认 + 两处违规行确认 + 漂移 md5 确认（318 vs 527 行、cdc95626 vs bd1ac6f5）。
