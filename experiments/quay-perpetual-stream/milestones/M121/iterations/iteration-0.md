# M121 iteration-0 — quay Core SEA binary crash fix

**Task:** `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH`
**Charter:** `experiments/quay-perpetual-stream/charters/M121-sea-build-crash-fix.md`
**Class:** development, single-pass (small, well-bounded mechanical fix — no `quay-task-to-plan`
pipeline, per the M99/M116/M119 precedent for this size of defect).

## What was done

1. **Investigation** resolved the task's own open structural question (Plan said "N/A — needs
   investigation"): `grep -n REPO_ROOT packages/quay/src/gate/registry.ts` shows `REPO_ROOT` is used
   ONLY to compute `DOCUMENTS_DIR = REPO_ROOT/docs-managed` for the product-owned D1 `doc-*` gates —
   NOT for the research/experiment gate scripts (those resolve via `.quay/gates.yml`'s own
   `discoverWorkspaceRoot`/`loadWorkspaceGates` path, untouched by this bug). No split needed.

2. **Fix**: `packages/quay/src/gate/registry.ts` — made the `__dirname` computation dual-mode safe.
   Diff:
   ```ts
   // esbuild bundles this module to CJS for the SEA build (Node SEA does not
   // support ESM main modules), where `import.meta.url` is unavailable and
   // evaluates to `undefined` (esbuild warns, does not error) — crashing
   // `fileURLToPath(undefined)` at module-init for every gate-touching command.
   // Node's CJS module wrapper provides a real `__dirname` binding in that
   // context, so prefer it when present (mirrors the src/version.ts /
   // scripts/version-sea-shim.js dual-mode precedent) and fall back to the
   // ESM-only computation otherwise.
   declare const __dirname: string | undefined;
   const moduleDir =
     typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
   const REPO_ROOT = path.resolve(moduleDir, "..", "..", "..", "..");
   ```
   First attempt's own explanatory comment cited the task ID by name — tripped
   `delivery-standalone-smoke.sh`'s "no experiment references in delivered files" static check (1 RED).
   Caught by re-running that gate before considering the fix done; fixed by removing the task-id
   reference from the shipped comment (per CLAUDE.md's own "don't reference the current task" style
   rule) — 0 RED after.

## Real evidence (AC1/AC3 — local)

```
$ ./dist-sea/quay --version
0.3.8
$ ./dist-sea/quay task list --status todo | head -1
DIR-038	todo	primitive	...
$ ./dist-sea/quay gate DIR-038
FAIL — no acceptance command defined (set with `quay task edit <id> --acceptance '<cmd>'`)
```
All exit 0 (or the expected non-crash FAIL for the acceptance gate with no command set) — no crash.

## Real evidence (AC2 — the structural question)

```
$ ./dist-sea/quay gate DIR-038 --gate doc-quay-directive-skill
FAIL — no such document: DOC-001
```
Exit 1, a normal gate FAIL with a clear reason — NOT a crash. This is the AC2 resolution: the D1
doc-gate degrades gracefully when `docs-managed/` is unavailable in the SEA distribution context;
documented, not a silent gap.

## Real evidence (regression check)

- `bash packages/quay/test/delivery-standalone-smoke.sh` → `0 RED` (was `1 RED` before the comment
  fix above).
- `npx tsc --noEmit -p packages/quay` → exit 0, no output.
- `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance|cli-edit-parity-conformance')`
  → `tests 370 / pass 370 / fail 0`.

## Real evidence (chart-2 S1 Δv — the real object, not asserted)

Version bumped to 0.3.9, tagged, pushed. Real GitHub Actions release run:
https://github.com/yaleh/quay/actions/runs/29995456654

```
✓ sea-release (windows-latest, windows-x64) in 1m21s
✓ sea-release (macos-latest, macos-arm64)   in 53s
✓ sea-release (ubuntu-latest, linux-x64)    in 1m12s
✓ sea-verify-node-free                       in 20s   <- was the FAILING job on v0.3.8
✓ dist-verify-node-floor                     in 15s
```
`sea-verify-node-free` job log (real Node-free `debian:stable-slim` container):
```
./quay --help   -> full help text printed, no crash
./quay serve --port 18080 & curl -sf ... -> http_code:200
```
This is the exact job that failed on v0.3.8 due to this crash — now green on the SAME evidence class
(a real Node-free container running the real SEA binary), not merely "the build succeeded" (build
always succeeded even on the crashing version — the bug was a runtime crash, not a build failure).

`chart2-s1-artifacts.json` updated: `sea-linux-x64` → `floorSmokePass:true` (real evidence above).
`sea-macos-arm64`/`sea-windows-x64` left `false` — `sea-release` proved those builds succeed, but
`sea-verify-node-free` only runtime-smokes linux-x64; build success is NOT proof the runtime crash is
fixed there (honesty discipline — not asserting evidence not gathered). Filed
`exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY` as the follow-up to close that gap.

```
$ node experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts
S1 Distribution-reliability cov = 0.4 (2/5 artifacts pass floor-smoke)
```
Was 0.2 before this milestone. Δcov = +0.2 × weight 30 = **+6.0 chart-2 points** — a real,
CI-evidenced, non-asserted chart-2 Δv (DIR-064-B's own escrow condition: "a REAL post-transition
milestone registers a real chart-2 Δv").

Updated the S1 calculator's own golden tests (3 assertions pinned to the old 0.2 value) + its
embedded `selftest()`'s "seeded real file" check (now asserts the cov=passed/total invariant, not a
specific number, since that number legitimately moves as real evidence lands) — re-ran, 59/59 pass.

## Not in scope / deferred

- `sea-macos-arm64`/`sea-windows-x64` runtime-smoke coverage — filed as
  `exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY`.
- Embedding `docs-managed/` into the SEA build (would be new capability, not a crash fix).
- `quay-native`'s own SEA binary / `manifest.ts`'s separate `import.meta.url` usage — already verified
  working (M116), untouched by this bug.
