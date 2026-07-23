# Charter M121-sea-build-crash-fix — quay Core SEA binary crash fix (DIR-004 Distribution)

**Milestone id:** M121
**Task:** `tasks/exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH.md`
**Surface:** development-class / capability-growth (chart-2 S1 Distribution-reliability)
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`be3561a`, DIR-064-A ABSORB commit)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

Found at M116: quay Core's SEA (Single Executable Application) binary crashes at startup for any
gate-touching command. Root cause: `packages/quay/src/gate/registry.ts` computed `__dirname` via
`path.dirname(fileURLToPath(import.meta.url))`; the SEA build bundles this module to CJS (Node SEA
does not support ESM main modules), where `import.meta.url` evaluates to `undefined` (esbuild warns,
does not error), crashing `fileURLToPath(undefined)` at module-init.

M119's SELECT explicitly deferred this task pending a scoping investigation, since its own Plan
admitted "needs investigation" into an unresolved structural question: whether `REPO_ROOT` (derived
from the crashing `__dirname`) is used to resolve gate-script paths under
`experiments/quay-perpetual-stream/scripts/` — which genuinely would not exist in a real end-user SEA
install, and would need a real design decision (embed / disable-in-SEA / other).

**This milestone's own investigation (iteration-0) resolves that open question**: `grep -n REPO_ROOT
packages/quay/src/gate/registry.ts` shows `REPO_ROOT` is used ONLY to compute `DOCUMENTS_DIR =
REPO_ROOT/docs-managed` for the product-owned D1 `doc-*` gates (`registerDocumentGate`, lazy — no
disk read at module-init, only at gate-run time). It is NOT used for the research/experiment gate
scripts (those are resolved via `.quay/gates.yml`'s own `discoverWorkspaceRoot`/`loadWorkspaceGates`
path in `factories/loader.ts`, untouched by this bug). The task's own "deeper structural note" concern
does not apply — this is a narrowly-bounded mechanical fix, not a design-decision milestone. No split
required (re-scoping this SELECT's sizing per the M119 not-selected note's option (a): a short
investigation resolved the open question in-pass).

## Scope

1. Make `packages/quay/src/gate/registry.ts`'s `__dirname` computation dual-mode safe: prefer the real
   CJS `__dirname` binding (available in the SEA/esbuild-CJS bundle context) when present, falling back
   to the ESM-only `fileURLToPath(import.meta.url)` computation otherwise — mirrors the existing
   `src/version.ts` / `scripts/version-sea-shim.js` dual-mode precedent (M01-dist).
2. Verify: `bash packages/quay/scripts/build-sea.sh && ./packages/quay/dist-sea/quay --version` (and a
   `task list` / `gate` smoke command) — pasted real output, not asserted.
3. Verify the D1 doc-gate (`doc-quay-directive-skill`) degrades GRACEFULLY in the SEA context (FAIL
   with a clear reason, e.g. "no such document"), not a startup crash — this is the AC2 resolution:
   documented graceful-degrade, since `docs-managed/` is repo-relative and genuinely unavailable in a
   true single-file distribution; the CLI/MCP/gate-engine core loop is otherwise fully functional.
4. `packages/quay` full non-flaky test suite green; `tsc --noEmit -p packages/quay` clean;
   `test/delivery-standalone-smoke.sh` (ADR-013 conformance gate) 0 RED — the fix's own explanatory
   comment must not itself trip the "no experiment references in delivered files" static check.

**Not in scope:** any redesign of the D1 doc-gate's data-path resolution, or embedding `docs-managed/`
into the SEA build (that would be new capability, not a crash fix); `quay-native`'s own separate SEA
binary (already verified working, M116) and `manifest.ts`'s `import.meta.url` usage (quay-native only,
untouched by this bug).

## Class routing

**Development-class** (a mechanical source fix + build/runtime verification, one file touched, no open
design question once scoped). Per the DIR-014 exemption precedent for small, well-bounded, single-file
fixes with an established verify pattern (the version.ts/version-sea-shim.js dual-mode precedent), no
`quay-task-to-plan` pipeline required — mirrors M99/M116/M119's sizing.

## Acceptance Criteria (from task)

- [ ] `./packages/quay/dist-sea/quay --version` (and other gate-touching commands) run without
  crashing.
- [ ] The REPO_ROOT-relative gate-path SEA-compatibility question is explicitly resolved: REPO_ROOT is
  used only for the product-owned `docs-managed/` D1 doc-gate data (not the research gate scripts);
  that gate degrades to a graceful FAIL (not a crash) when `docs-managed/` is unavailable — documented,
  not a silent gap.
- [ ] `bash packages/quay/scripts/build-sea.sh && ./packages/quay/dist-sea/quay --version` (and a
  `task list`/`gate` smoke command) pasted as real evidence.

## Definition of Done

- [ ] All 3 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.
- [ ] chart-2 S1 (Distribution reliability) cov-calculator re-run shows the flip DIR-064-B's Δv
  demonstration predicted (0.20→0.80 on the SEA rows), registering a real chart-2 Δv.

## GATE-HASH-REF

GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1

(Same pre-existing, tracked-not-blocking drift as M116-M119 —
`exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE`.)
