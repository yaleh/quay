---
id: gap-dist-doc-gate-repo-root-off-by-one
title: "dist build's doc gate can't find documents — REPO_ROOT resolves off-by-one from packages/quay/dist/"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---

## Proposal

`packages/quay/test/document-gate-fixture.test.mjs` D1 A(Stage5) fails — the CLI-level
end-to-end doc gate proof. Evidence (isolated + full-suite, 2026-08-06):

- `node packages/quay/dist/quay.js gate T-doc-gate-e2e-fixture --gate doc-quay-directive-skill`
  outputs `FAIL — no such document: DOC-001`, but the SRC entry
  (`node packages/quay/bin/quay.ts ...`) outputs `PASS`.
- Root cause: `packages/quay/src/gate/registry.ts:13`
  `REPO_ROOT = path.resolve(moduleDir, "..", "..", "..", "..")`. In the SRC build
  `moduleDir = packages/quay/src/gate/` → 4-up = repo root (correct). In the DIST build
  `moduleDir = packages/quay/dist/` → 4-up = `/home/yale/work` (off-by-one → wrong
  `DOCUMENTS_DIR` = `<repo>/../docs-managed`, which does not exist).
- Direct `createDocumentStore('/home/yale/work/quay/docs-managed').get('DOC-001')` returns
  FOUND — the store itself is fine; only the dist's REPO_ROOT resolution is wrong.

## Acceptance Criteria

- [ ] AC1: `node --no-warnings --test packages/quay/test/document-gate-fixture.test.mjs`
      passes (the dist path resolves DOC-001 correctly).
- [ ] AC2: the dist's `REPO_ROOT` resolves to the workspace root (not one level up) — verify
      via the doc gate finding `docs-managed/DOC-001*` OR a mechanical check on the built dist.
- [ ] AC3: the fix is robust to BOTH the src (`src/gate/`) and dist (`dist/`) module depths —
      not a one-off patch for the current layout.
- [ ] AC4: `git show --name-only` on the fix touches only the intended source (+ its test).

## Contract

measure   d1_result = `node --no-warnings --test packages/quay/test/document-gate-fixture.test.mjs` 的 stdout → tests pass, fail 0
band      d1_fail_count = 0（tests 3, pass 3, fail 0）
invariant dist 构建的 doc gate 必须能解析到 workspace 的 docs-managed/（REPO_ROOT 不能偏一级）
invoke    `node packages/quay/dist/quay.js gate T-doc-gate-e2e-fixture --gate doc-quay-directive-skill`（输出 PASS）
control   负控制：把 dist 的 moduleDir 故意设成偏一级（模拟当前 bug）⇒ 必须 FAIL；修复后同样构造 ⇒ PASS（证明修复对深度鲁棒）
resume    n/a（fresh task）

## Dispatch review

reviewer: outer
at: 2026-08-06T00:4xZ
changed: 无

## Touches

- packages/quay/src/gate/registry.ts
- packages/quay/test/document-gate-fixture.test.mjs
