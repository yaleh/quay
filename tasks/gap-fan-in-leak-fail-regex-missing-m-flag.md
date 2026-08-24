---
id: gap-fan-in-leak-fail-regex-missing-m-flag
title: fan-in-execute.js:363 TMUX_LEAK_FAIL_RE 缺 m flag ⇒ leak-residual
  分支死代码、真实泄漏红被误标 checker-misreport
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

`fan-in-execute.js:363` `TMUX_LEAK_FAIL_RE=/^tmux-leak-scan: FAIL/` 缺 `m`（multiline）flag——`^` 无 m 只锚字符串首，日志文本多行 ⇒ **leak-residual 分支死代码**（never matches），真实泄漏红被误标 `checker-misreport`。node 实测：`re.test("blah\ntmux-leak-scan: FAIL ...")` = false（无 m）/ true（有 m）。outer 独立复核确认。

## Plan

给 `TMUX_LEAK_FAIL_RE` 加 `m` flag（`/^tmux-leak-scan: FAIL/m`），让 leak-residual 分支真正可达。

## Acceptance Criteria

- [x] AC1（能取假，leak-residual 可达）：多行日志中含 `tmux-leak-scan: FAIL` 时，`TMUX_LEAK_FAIL_RE.test()` = true（⛔ 仍 false ⇒ 假）。
- [x] AC2（能取假，不再误标）：真实泄漏红走 leak-residual 分支，不被误标 checker-misreport（⛔ 仍误标 ⇒ 假）。

## Definition of Done

m flag 落地 develop；AC1-2 全勾；多行日志 leak-residual 分支可达（AC1 复现）。

## Touches

- plugin/scripts/tmux-leak-fail-re.ts（TMUX_LEAK_FAIL_RE 加 m flag——正本单一定义；两个 workflow 副本按路径引用它，无需改副本）
- plugin/test/fan-in-execute-paths.test.mjs（leak-residual 测试改为多行日志复现 m flag）
- tasks/gap-fan-in-leak-fail-regex-missing-m-flag.md（自身）