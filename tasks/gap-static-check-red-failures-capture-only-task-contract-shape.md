---
id: gap-static-check-red-failures-capture-only-task-contract-shape
title: verification-round failures[] 在 static-check 红时只抓 task-contract
  形状——真因（fail-closed 检查器）零条进记录
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

> **降级理由（人 08:0xZ 分支模型指令 + manager 审计）**：对即将取消的 integration-as-checkout 结构的优化——人裁吞吐/编排暂不动，本任务降回 todo，不派。

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

- [x] AC1: failures[] 在 static-check 红时记录【真因】（fail-closed 的检查器名 + 退出码），不只 task-contract 形状
- [x] AC2: 「哪条检查失败」与「哪些违规行」在记录里分开
- [x] AC3: 负控——round 84 形态（threshold-scope fail-closed）在记录里出现真因
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿（scoped gate EXIT=0，122 tests pass；负控新测通过）

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 负控样例贴出（见 Evidence：round 84 形态的真因出现在 failures[]）
- [ ] 全量套件绿（worktree 内未跑全量 —— outer 的职责）

## Evidence（负控样例，2026-08-13 工作树实测）

fake-suite 复现 round 84 形态：threshold-scope-check fail-closed（checker-cost-lib 的机器行 `STATIC_CHECK_FAILED: threshold-scope-check exit=1`）
+ task-contract --no-block 的非阻塞 VIOLATION 行。修复后 `full-suite-runner` 的 `failures[]`：

```json
{
  "state": "red",
  "reason": "static-check",
  "failures": [
    { "line": "VIOLATION: tasks/gap-foo.md — contract-line-unknown: Contract block missing invariant line",
      "file": "tasks/gap-foo.md", "staticCheck": true },
    { "line": "STATIC_CHECK_FAILED: threshold-scope-check exit=1", "staticCheck": true }
  ],
  "staticCheck": {
    "details": [
      { "file": "tasks/gap-foo.md", "code": "contract-line-unknown",
        "what": "Contract block missing invariant line",
        "line": "VIOLATION: tasks/gap-foo.md — contract-line-unknown: ..." }
    ],
    "failedCheckers": [ { "name": "threshold-scope-check", "exitCode": 1,
        "line": "STATIC_CHECK_FAILED: threshold-scope-check exit=1" } ]
  }
}
```

- AC1：`failures[]` 第 2 条 = `STATIC_CHECK_FAILED: threshold-scope-check exit=1`（真因，fail-closed 检查器名 + 退出码）——不再只有 task-contract 形状。
- AC2：`staticCheck.details`（哪些违规行）与 `staticCheck.failedCheckers`（哪条检查失败）分开两个字段。
- AC3：round 84 形态的真因（threshold-scope fail-closed）出现在 `failures[]` 与 `verification-round.jsonl` 的 `failures[]`（round record: `reason=gate-failed gate=static-check` + `failures[]` 含 threshold-scope-check）。
- 机件变更：`checker-cost-lib.sh` 的 `run_checker_parallel_wait` 为每个 fail-closed 检查器输出机器可解析行
  `STATIC_CHECK_FAILED: <name> exit=<rc>`（原人类可读摘要保留）；`full-suite-runner.ts` 的
  `isStaticCheckFailureLine`/`extractFailClosedChecker`/`buildStaticCheckFailures` 捕获之。
- 新测试：`full-suite-runner.test.mjs`（AC1/AC2 负控 e2e + extractFailClosedChecker/buildStaticCheckFailures 单测）、
  `checker-cost.test.mjs`（机器行断言）。

## Touches

- plugin/scripts/full-suite-runner.ts（failures[] 捕获）
- plugin/scripts/checker-cost-lib（fail-closed 检查器名传递）
- tasks/gap-static-check-red-failures-capture-only-task-contract-shape.md（自身）
