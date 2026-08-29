---
id: gap-suite-round-pass-fail-cancel-parser-breaks-under-force-color-ansi
title: suite 轮 pass/fail/cancel 摘要解析器在 FORCE_COLOR=3 ANSI
  下失效——verification-round 缺四字段（成簇缺陷，硬规则 5b 两表面）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`verification-round.jsonl` 最近两轮（#684 2026-08-27T15:20、#685 16:04）记录缺 pass/fail/cancelled/tests 四字段，`/tests` 页渲染 "—/—/—"；#682/#683 正常（3519/0/0）。

**根因（已实测三份 `/tmp/fan-in-suite-*.log`）**：环境有 `FORCE_COLOR=3`（另有 COLORTERM=truecolor），迫使 node:test spec reporter 输出被重定向到文件仍上色。摘要行从 `ℹ pass 3519` 变 `\x1b[34mℹ pass 3523\x1b[39m`（行首 ESC 字节）。解析正则行首锚定且不剥 ANSI → 匹配失败 → `parseTestCounts()` 返回 null → 四字段诚实缺席（缺值=未查，但此处是「明明有摘要却没解析到」）。证据对照：#683 log 摘要行无 ANSI（3 条命中）；#684/#685 log 摘要行被 `^[[34m…^[[39m` 包裹（0 命中）。

**两个受影响表面（硬规则 5b，⛔ 一并修，别只修报出来的那一个）**：
1. `plugin/scripts/pre-verified-round-record.ts:275`（fan-in 分离 suite 路径 writer）→ `TEST_COUNT_RE = /^[#ℹ]\s*(pass|fail|cancelled)\s+(\d+)/` → 字段缺席（"—"）。
2. `plugin/scripts/full-suite-runner.ts:2617-2622` 的 `passM/failM/cancelledM` 三个正则，同为 `^[#ℹ]` 锚定、不剥 ANSI → 无条件写故显示 "0/0/0" 而非缺席，但同样解析失败。

**同族已修先例**：`instrument-failure-check.sh` 已为同一 FORCE_COLOR=3 缺陷修过一次（commit 4173334ab，`env -u FORCE_COLOR`），正好落在 #683→#684 之间——证明这是**成簇缺陷**，suite 摘要解析链是未修表面。

**与既有任务关系**：`gap-suite-round-pass-fail-cancel-fields.md`（done）落地的就是这套 parseTestCounts，但其正则未预见 FORCE_COLOR，本次是它落地后的回归 → **新立案，不是重开**。

## Plan

修法二选一（实现方定，本消息不裁决）：
- **A（治本、一处覆盖全链）**：fan-in 分离 suite 启动点 + full-suite-runner 的 suite 子进程启动处 `env -u FORCE_COLOR`（与 instrument-failure-check.sh 同手法；只剥 runner 子进程，不动人类 shell）。
- **B（更防御、点两处解析器）**：两处解析器先剥 ANSI 再匹配。

## Acceptance Criteria

- [ ] AC1（能取假，生产载体）：在 FORCE_COLOR=3 环境下，`verification-round.jsonl` 每轮记录仍含 pass/fail/cancelled/tests 四字段且值>0（⛔ 缺字段或值=0 ⇒ 假——把 fixture/注入 seam 关掉仍能过才是测量）。（待外部）
- [x] AC2（能取假，两表面都覆盖）：pre-verified-round-record.ts 与 full-suite-runner.ts 两处解析器在 ANSI 摘要行下都能正确解析（⛔ 只修一处 ⇒ 假——硬规则 5b）。
- [x] AC3（能取假，负控制）：FORCE_COLOR=3 下回放 #684/#685 的带色 log，四字段解析出与无 ANSI 时一致的正确值。

## Definition of Done

两处 suite 摘要解析器在 FORCE_COLOR=3 下正确解析；AC1-AC3 全勾；verification-round.jsonl 不再因 ANSI 缺四字段；/tests 页不再 "—/—/—"。

## Touches

- plugin/scripts/pre-verified-round-record.ts（TEST_COUNT_RE 剥 ANSI 或上游 env -u FORCE_COLOR）
- plugin/scripts/full-suite-runner.ts（passM/failM/cancelledM 剥 ANSI 或子进程启动 env -u）
- plugin/test/pre-verified-round-record.test.mjs（ANSI 摘要行解析测试 + 负控制）
- plugin/test/full-suite-runner.test.mjs（ANSI 摘要行解析测试）
- tasks/gap-suite-round-pass-fail-cancel-parser-breaks-under-force-color-ansi.md（自身）

## Needs-Human

**执行 2026-08-28T14:52:56.722Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
