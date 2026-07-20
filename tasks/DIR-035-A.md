---
id: DIR-035-A
title: "DIR-035 split A: ABI, not file paths — remove Core's ../../../quay-native relative imports (delivery-standalone-smoke blockers 2/3/4)"
status: done
labels:
  - directive
  - milestone-candidate
parent: DIR-035
children: []
extra:
  dirStatus: resolved
  schema: "v1"
---
## Proposal
First child slice of [[DIR-035]] (ADR-013), per DIR-026 SPLIT-OR-COMMIT: DIR-035 is too large for
one milestone, so it is split into four independently-completable children (A/B/C/D below); THIS
task (A) is the one selected and fully executed at M48.

Scope: `packages/quay/src/gate/registry.js` imported `createAdrStore`/`createDocumentStore`/
`validateContracts` from `../../../quay-native/src/{adr-store,document-store,contract-validator}.js`
— a cross-package relative-path reach into a sibling Provider's internals, the exact Provider-ABI
violation ADR-013 names (R2/R3/R4, one fault: `gate --list` and the whole CLI fail to load
standalone because the import target does not exist in a delivered `quay` package).

## Finding
Inspection showed `adr-store.js`/`document-store.js`/`contract-validator.js` (+ their shared
`frontmatter-store-base.js`) are GENERIC filesystem-frontmatter stores with NO dependency on
quay-native's task vocabulary (`store.js`) or any Provider-specific mechanism — they were placed
under `quay-native` only because that's where they were first added (E1/E3/D1 stages), not because
they are Provider-specific. This means the correct fix is not "reach via the ABI" (there is no
ABI-shaped capability to reach — these aren't task-store operations) but DIR-035's own alternative,
explicitly sanctioned in its Requested action item 1: "move the shared logic that Core actually
needs into `packages/quay` itself if it's generic."

## Requested action
1. Move `adr-store.js`, `document-store.js`, `contract-validator.js`, `frontmatter-store-base.js`
   from `packages/quay-native/src/` to `packages/quay/src/` (Core now owns them — generic, no
   Provider dependency).
2. Update `packages/quay/src/gate/registry.js` to import them via local relative paths
   (`../adr-store.js` etc.) instead of `../../../quay-native/src/...`.
3. `quay-native`'s own CLI (`bin/quay-native.js`) and MCP server (`src/mcp-server.js`), which also
   use these stores for their own ADR/document CLI verbs, now import them back from `quay` as a
   DECLARED workspace dependency (`"quay": "*"` in `quay-native`'s `package.json`) — a Provider
   depending on Core's generic utility library is architecturally fine (not the ABI-violating
   direction); Core reaching into a Provider's internals by file path is what was forbidden.
4. Move the corresponding unit tests (`adr-store.test.mjs`, `document-store.test.mjs`,
   `contract-validator.test.mjs`, `frontmatter-store-base.test.mjs`) from `packages/quay-native/test/`
   to `packages/quay/test/` (single-source: one test location per module, co-located with its code).
5. Remove literal `experiments/quay-perpetual-stream`/`exp5` STRING references from comments in
   delivered `packages/quay/src` and `packages/quay/bin` where they are purely cosmetic provenance
   citations (not the functional hardcoded gate-script paths, which are DIR-035-B's scope).

## Acceptance Criteria
- [x] `grep -rnE '\.\./\.\./\.\./quay-(native|github)|\.\./\.\./quay-(native|github)' packages/quay/src packages/quay/bin` returns nothing. Confirmed empty by independent audit re-run.
- [x] `bash packages/quay/test/delivery-standalone-smoke.sh` blockers 2 ("cross-package relative imports"), 3 ("CLI loads standalone"), and 4 ("gate --list loads standalone") are GREEN. Independently re-run: smoke verdict is 2 RED (blockers 1 and 5, both explicitly DIR-035-B scope) / 3 GREEN (blockers 2/3/4).
- [x] Full existing test suite (excluding live-GitHub suites) shows no regressions vs `master` baseline. Independently re-run: 287 tests / 284 pass / 3 fail, the SAME 3 pre-existing failures present on unmodified `master` (confirmed via merge-base check) — no regression.

## Definition of Done
References the standard inherited-core DoD clauses. Done ONLY when:
- [x] The moved modules' own unit tests (adr-store/document-store/contract-validator/frontmatter-store-base) pass at their new location. Confirmed passing at `packages/quay/test/{adr-store,document-store,contract-validator,frontmatter-store-base}.test.mjs`.
- [x] `quay-native`'s own ADR/document CLI verbs (`quay-native adr ...`, `quay-native document ...`) still function via the new `quay`-dependency import path (not removed, only re-routed). Confirmed live: `node packages/quay-native/bin/quay-native.js adr list` and `... mcp` both work via the new import path.
- [x] No new cross-package relative import was introduced anywhere else as a side effect (full-repo grep re-run clean). Confirmed clean.

## Resolution (2026-07-20, M48-dir035-split-abi-imports, commit `81fd6066`)

Built in worktree `milestones/M48/worktrees/iteration-0` (commit `81fd60664ca14f4af20efdfe04e06d53cca5b38b`),
independently re-verified by a fresh-context Explore/general-purpose audit subagent with NO access
to the builder's self-report (re-ran the smoke test, the full suite, the grep, and the live CLI
check itself rather than trusting the build-phase report). **Audit verdict: PASS.**

**Architectural call confirmed sound.** Rather than a literal ABI passthrough, the build moved
`adr-store.js`/`document-store.js`/`contract-validator.js`/`frontmatter-store-base.js` from
`packages/quay-native/src/` into `packages/quay/src/` (Core), with `quay-native` declaring
`"quay": "*"` as a workspace dependency and importing them back. The audit confirmed by code
inspection these four modules are generic filesystem-frontmatter stores with no dependency on
quay-native's task vocabulary, and confirmed this alternative is explicitly sanctioned by DIR-035's
own Requested-action-item-1 text ("move the shared logic that Core actually needs into
`packages/quay` itself if it's generic") and by ADR-013 ("a declared dependency on a Core-owned or
shared package, not a reach across the workspace tree").

**Delivery-standalone-smoke, before → after:** 5 RED → **2 RED** (blockers 1 and 5 remain, both
explicitly out of scope for DIR-035-A — they are DIR-035-B's data-driven-gate-set scope). Blockers
2 ("no cross-package relative imports"), 3 ("CLI loads standalone"), and 4 ("gate --list loads
standalone") are GREEN, independently re-confirmed:
```
=== 2) STATIC: delivered files must not import sibling packages by relative path ===
  ✅ no cross-package relative imports
=== 3) RUNTIME: the CLI must load standalone ===
  ✅ CLI --help loads standalone
=== 4) RUNTIME: the gate engine must load standalone ===
  ✅ gate --list ran standalone
=================== SMOKE VERDICT: 2 RED (delivery blockers) ===================
```

**Test regression check:** 287 tests / 284 pass / 3 fail across the repo (packages/quay +
packages/quay-native, live-GitHub suites excluded) — the SAME 3 failures reproduce on unmodified
`master`, confirmed by running the identical suite there; no regression introduced by the module
move. The moved modules' own relocated unit tests (adr-store, document-store, contract-validator,
frontmatter-store-base) and quay-native's document-CLI tests all pass at their new location.

**Live CLI check:** `quay-native adr list` and `quay-native mcp` both verified working via the new
`quay`-dependency import path (not a stub/mocked check).

Full detail: see the M48 build-phase report and the independent audit's own findings (this
milestone did not produce a separate `audits/*.md` artifact file distinct from this Resolution —
the audit's findings are transcribed here verbatim per the ABSORB entry).
