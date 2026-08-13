---
id: gap-static-check-red-failures-capture-only-task-contract-shape
title: verification-round failures[] 在 static-check 红时只抓 task-contract 形状——真因（fail-closed 检查器）零条进记录
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12，round 84）**：红轮权威记录 `verification-round.jsonl` round 84：
`reason=gate-failed gate=static-check failures=25`——25 条【全部】是 tasks/*.md 的
contract-line-unknown / invoke-evidence-missing / dispatch-review-missing；提到 threshold-scope 或 CLAUDE.md 的 0 条。
**真因（threshold-scope-check fail-closed）在记录里一条都没有**（谓词负控制确认谓词没坏）。

**读实现（不从现象倒推）**：
- `full-suite-runner.ts:405` `STATIC_CHECK_VIOLATION_RE = /^VIOLATION:\s*(\S+)\s*[—-]\s*([^:]+):\s*(.*)$/`
  （注释原文：三种形状是【task-contract-check 的】VIOLATION / summary / ratchet 行）
- `task-contract-check.ts:635` 输出 "ratchet ceiling: N; recorded (non-blocking): …"；`:649` `process.exit(block ? 1 : 0)`
  ——这 25 条是【非阻塞】噪声
- **调用点事实（②i-F：手动跑生产工具前查调用点实参，2026-08-12）**：`scripts/test.sh:297` 调 task-contract-check 传
  `--no-block`——非阻塞噪声行是调用点【明确要求】的输出形态（只增不减记账、exit 0），不是检查器毛病；
  手动裸跑（不带 --no-block，checker DEFAULT 模式仍阻塞）会得到 18 条假违规（near-misreport 成因，manager 查调用点后拦截）。
- 真红那行 `checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): threshold-scope-check`
  不匹配正则 ⇒ **零条进 failures[]**

⇒ **failures[] 在 static-check 红时只认 task-contract 输出形状。别的检查器 fail-closed 挂掉，记录里一条都不会出现；
而恰好该检查器的非阻塞噪声会被整批收进去。**

**后果（与 `./undefined` 同族，比守卫缺口更隐蔽）**：做事后复盘的人打开权威记录，看到 25 个具体文件名 + 缺陷码，
全读起来合理 → 去修 25 个无关任务体，真因在记录里不存在。**记录存在、可读、内容像对、指向非真因。**
守卫缺口至少表现为「拒绝晚一步」，这条不表现为任何异常。

**修法方向（manager 约束）**：「哪条检查失败」与「日志里出现过哪些违规行」是两个不同的量，记录里应当分开——
现在是用后者冒充前者。谁 fail-closed 是 runner 自己知道的（它据此判红），不必靠正则从流里猜。

**与守卫覆盖缺口案（gap-precommit-guard-blocks-commits-not-working-tree-edits）互引**：同持久记录面——
若加「轮起跑断言面快照」，这条记录缺陷决定快照证据被不被人看见。

## AC

- [ ] AC1: failures[] 在 static-check 红时记录【真因】（fail-closed 的检查器名 + 退出码），不只 task-contract 形状
- [ ] AC2: 「哪条检查失败」与「哪些违规行」在记录里分开
- [ ] AC3: 负控——round 84 形态（threshold-scope fail-closed）在记录里出现真因
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 负控样例贴出（见 Evidence：round 84 形态的真因出现在 failures[]）
- [ ] 全量套件绿

## Touches

- plugin/scripts/full-suite-runner.ts（failures[] 捕获）
- plugin/scripts/checker-cost-lib（fail-closed 检查器名传递）
- tasks/gap-static-check-red-failures-capture-only-task-contract-shape.md（自身）
