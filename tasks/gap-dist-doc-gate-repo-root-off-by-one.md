---
id: gap-dist-doc-gate-repo-root-off-by-one
title: dist build's doc gate can't find documents — REPO_ROOT resolves
  off-by-one from packages/quay/dist/
status: done
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

- [x] AC1: `node --no-warnings --test packages/quay/test/document-gate-fixture.test.mjs`
      passes (the dist path resolves DOC-001 correctly).
- [x] AC2: the dist's `REPO_ROOT` resolves to the workspace root (not one level up) — verify
      via the doc gate finding `docs-managed/DOC-001*` OR a mechanical check on the built dist.
- [x] AC3: the fix is robust to BOTH the src (`src/gate/`) and dist (`dist/`) module depths —
      not a one-off patch for the current layout.
- [x] AC4: `git show --name-only` on the fix touches only the intended source (+ its test).

## Execute evidence（2026-08-06，inner 直修）

Fix commit: `fix(gate): REPO_ROOT resolves off-by-one under dist bundle`（`git show --name-only` = 仅 `packages/quay/src/gate/registry.ts`，AC4）。

Root cause confirmed: `registry.ts:13` `REPO_ROOT = path.resolve(moduleDir, "..","..","..","..")` — src 下 `moduleDir=src/gate/` → 4-up=仓库根（对）；dist 下 `moduleDir=dist/` → 4-up=`/home/yale/work`（偏一级，DOCUMENTS_DIR 错）。

Fix: `REPO_ROOT = discoverWorkspaceRoot(moduleDir) ?? path.resolve(moduleDir, "..","..","..","..")`（loader 的 `discoverWorkspaceRoot` 已 import；从模块位置向上发现工作区，src/dist 深度都鲁棒，AC3）。dist 已重建。

Verification:
```
$ node packages/quay/dist/quay.js gate T-doc-gate-e2e-fixture --gate doc-quay-directive-skill  → PASS（修复前 FAIL — no such document: DOC-001，AC2/Contract invoke）
$ node --experimental-strip-types packages/quay/bin/quay.ts gate ... → PASS（src 不回归）
$ node --no-warnings --test packages/quay/test/document-gate-fixture.test.mjs → pass 3 / fail 0（AC1）
$ node --no-warnings --test packages/quay/test/adr-gate.test.mjs → pass 11 / fail 0（同族 gate 不回归）
```

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
