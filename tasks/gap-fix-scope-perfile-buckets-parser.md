---
id: gap-fix-scope-perfile-buckets-parser
title: fix-scope gate __PERFILE__ 解析器接 --buckets 输出格式（--buckets 走 node test-runner，parser 命中 0 行）
status: todo
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

**来源**：AC126 接线引入的新缺口（inner 实测）+ manager 裁决③「真 follow-up，须在窗口攒数前 land，否则桶轮失败归因一直盲」。

**证据（能取假）**：fix-scope gate 的 `__PERFILE__` 解析器本轮命中 0 行——`scripts/test.sh --buckets` 走 node test-runner 输出格式，非 full-suite-runner 的 `__PERFILE__` 标记 ⇒ 触发 checker-misreport 兜底。AC126 的 AC3 修了桶字段落账，但 fix-scope gate 的 per-file 失败归因 parser 仍不认识 --buckets 输出格式。

**判据**：`--buckets` 路径 emit `__PERFILE__`（或 parser 认桶格式），使桶轮失败能逐文件归因。
**取假**：跑一个带红测试的桶轮，fix-scope gate 能定位到具体失败文件（非 0 行命中）。

**为什么 inner 执行**：改 fix-scope gate parser / --buckets 输出格式属产品代码 → inner 域。

## Plan

1. 定位 fix-scope gate 的 `__PERFILE__` 解析器 + `--buckets` 的输出格式差异。
2. 让 --buckets 路径 emit `__PERFILE__`（或 parser 认桶格式）。
3. 取假回放：带红桶轮 → fix-scope gate 逐文件归因（非 0 行）。
4. fan-in（AC78 workflow）land。

## Acceptance Criteria

- [ ] AC1: `--buckets` 路径的失败能逐文件归因（fix-scope gate 非 0 行命中）。
- [ ] AC2: 取假——带红桶轮 → fix-scope gate 定位到具体失败文件。

## Definition of Done

- [ ] --buckets 输出格式被 fix-scope gate 识别 + 取假通过；AC1-2 全勾；land 到 develop。

## Touches

- scripts/test.sh（--buckets 路径 emit __PERFILE__）
- plugin/scripts/full-suite-runner.ts（若 parser 在 runner 侧）
- tasks/gap-fix-scope-perfile-buckets-parser.md（自身）
