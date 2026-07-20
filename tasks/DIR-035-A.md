---
id: DIR-035-A
title: "DIR-035 split A: ABI, not file paths — remove Core's ../../../quay-native relative imports (delivery-standalone-smoke blockers 2/3/4)"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-035
children: []
extra:
  dirStatus: pending
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
- [ ] `grep -rnE '\.\./\.\./\.\./quay-(native|github)|\.\./\.\./quay-(native|github)' packages/quay/src packages/quay/bin` returns nothing.
- [ ] `bash packages/quay/test/delivery-standalone-smoke.sh` blockers 2 ("cross-package relative imports"), 3 ("CLI loads standalone"), and 4 ("gate --list loads standalone") are GREEN.
- [ ] Full existing test suite (excluding live-GitHub suites) shows no regressions vs `master` baseline.

## Definition of Done
References the standard inherited-core DoD clauses. Done ONLY when:
- [ ] The moved modules' own unit tests (adr-store/document-store/contract-validator/frontmatter-store-base) pass at their new location.
- [ ] `quay-native`'s own ADR/document CLI verbs (`quay-native adr ...`, `quay-native document ...`) still function via the new `quay`-dependency import path (not removed, only re-routed).
- [ ] No new cross-package relative import was introduced anywhere else as a side effect (full-repo grep re-run clean).

## Build note (M48, milestones/M48-dir035-split-abi-imports branch, UNMERGED — pending independent audit)
Built in worktree `milestones/M48/worktrees/iteration-0`, commit see the M48 build-phase report for
the full diff summary, smoke-test before/after output, and test counts. Boxes above are left
UNCHECKED per DIR-020 (no self-ticking) and the process rule that only an independent audit may
write status/dirStatus/Resolution/tick boxes — this note records WHERE the build happened, not a
completion claim. See the M48 build-phase agent's final report for the proposed AC/DoD evidence the
audit should check against.
