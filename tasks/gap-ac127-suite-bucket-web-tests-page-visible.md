---
id: gap-ac127-suite-bucket-web-tests-page-visible
title: AC127 分桶记录在 web /tests 页可见（observation.ts + serve-handlers.ts 解析并展示 buckets 字段）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac126-suite-bucket-execution-enable-wiring
---

**type:** execution

## Proposal

**来源**：人 2026-08-22 00:3xZ 明令「还应确认在 quay web server 的 tests 页可以看到这些分桶测试的记录」+ manager AC127（commit 4883e53b）。

**缺口（实测核实，非推理）**：AC124/126 让桶字段进了 `verification-round.jsonl`（`buckets`/`bucket_files`/`bucket_duration_ms`，`full-suite-runner.ts:1530-1539`），但 `/tests` 页的 parser/renderer **都未解析该字段**：
- `observation.ts` `TestRunRecord` 接口（:1324-1349）无 `buckets` 键，`parseVerificationRound`（:1363）不提取它；
- `serve-handlers.ts` `renderTestsPage`（:2231）表头只有 round/state/pass-fail-cancel/duration/scope/commit，无桶列。
⇒ 桶记录在 web 端不可见——「分桶执行」对人不可观测 = 未交付。

**判据**：`/tests` 页解析并展示桶字段。
**取假（可机械核）**：(a) 回放带 `buckets=M` 的记录 ⇒ `parseVerificationRound` 返回含 `buckets` 且 `renderTestsPage` 输出该值；(b) 无桶字段的 legacy 记录 ⇒ 不展示桶（absence 容忍，同 ledger 契约，⛔ 不得显示伪 `full`）。

**为什么 inner 执行**：改 `packages/quay/src/`（产品 web 代码）→ inner 域。

## Plan

1. `observation.ts` `TestRunRecord` 接口加 `buckets?: string`（可缺），`parseVerificationRound` 提取 `buckets` 字段（legacy 行缺键 → undefined，不 throw）。
2. `serve-handlers.ts` `renderTestsPage` 加桶列（有值显示，无值/legacy 不显示，⛔ 不显示伪 `full`）。
3. 取假回放：带 `buckets=M` 记录 → parse 含 buckets 且 render 输出；legacy 无桶记录 → 不展示桶。
4. fan-in（AC78 workflow）land。

## Acceptance Criteria

- [ ] AC1: `parseVerificationRound` 解析 `buckets` 字段（legacy 缺键 → undefined，不 throw）。
- [ ] AC2: `renderTestsPage` 输出桶值——回放 `buckets=M` ⇒ 页面含 `M`；legacy 无桶字段 ⇒ 不展示桶（absence 容忍，不显示伪 `full`）。

## Definition of Done

- [ ] /tests 页解析并展示桶字段 + 取假两向回放通过；AC1-2 全勾；land 到 develop。

## Touches

- packages/quay/src/observation.ts（TestRunRecord + parseVerificationRound 加 buckets）
- packages/quay/src/serve-handlers.ts（renderTestsPage 加桶列）
- tasks/gap-ac127-suite-bucket-web-tests-page-visible.md（自身）
