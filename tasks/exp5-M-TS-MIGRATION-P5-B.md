---
id: exp5-M-TS-MIGRATION-P5-B
title: "TS migration P5-B (quay-backlog provider, DIR-058): migrate 3 src/*.js
  files to .ts"
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:M-117
parent: exp5-M-TS-MIGRATION-P5
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P5-B
    experiments/quay-perpetual-stream/charters/M117-ts-migration-p5-b.md
    /tmp/m117-absorb-entry.md
---
## Proposal

P5-B of [[exp5-M-TS-MIGRATION-P5]] (DIR-058): migrate `packages/quay-backlog/src/*.js` (3 files) to
`.ts`, behavior-preserving, under the ADR-012 golden-diff discipline:

- `packages/quay-backlog/src/manifest.js`
- `packages/quay-backlog/src/backlog-client.js`
- `packages/quay-backlog/src/mcp-server.js`

(`packages/quay-backlog/bin/quay-backlog.js` is covered by [[exp5-M-TS-MIGRATION-P5-A]], not here.)

`quay-backlog` is the 4th, read-only Backlog.md Provider, added after/outside ADR-012's original P3
scope (which only enumerated quay-native/quay-github/quay Core) — this is its first TS migration pass.

## Plan
N/A — mechanical per-file port, same pattern as P3-C (quay-github, M81): a full package's internal
implementation, smaller surface (3 files, one package).

## Acceptance Criteria
- [x] All 3 `src/*.js` files renamed/ported to `.ts`, typechecking against the Provider ABI (`packages/quay/src/abi.ts`) the same way quay-native/quay-github do.
- [x] `npx tsc --noEmit` (root tsconfig, once these files are included) exits 0 or with only the pre-existing documented TS2589 errors (no NEW errors from these 3 files).
- [x] `packages/quay-backlog`'s own test suite (if one exists at execution time) is green before/after; if none exists, this AC is explicitly stated N/A with the reason (not silently skipped).
- [x] Full non-flaky `packages/quay` suite green before/after (golden-diff), since quay Core's MCP client talks to this provider.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [x] All 3 files are `.ts` on `master`, `git log --follow` shows the rename commit for each.
- [x] `tsc --noEmit` + relevant suite(s) pasted as evidence in the Resolution.
- [x] No behavior change (golden-diff: quay-backlog provider behaves identically before/after, pasted evidence).

## Resolution

Verified by an independent, fresh-context adversarial audit (`milestones/M117/audits/iteration-0-adversarial-audit.md`),
re-executing every claim personally against `master` HEAD `ad49578` (implementation commit `8c4bc9e`)
rather than trusting the iteration-0 report's pasted output. Evidence (this audit's own re-execution,
not copied from the report):

1. **All 3 files are `.ts`, typechecking against the Provider ABI** — `ls packages/quay-backlog/src/*.ts`
   shows all 3 (`manifest.ts`, `backlog-client.ts`, `mcp-server.ts`); no `.js` remains at those paths.
   `manifest.ts`/`backlog-client.ts` import `Manifest`/`Task` as `import type` from
   `../../quay/src/abi.ts` — confirmed by direct `grep` of the files. Personally re-ran
   `cd packages/quay-backlog && npx tsc --noEmit -p .` → exit 0.
2. **`tsc --noEmit` exits 0, no errors at all** — ran all 4 packages' per-package `tsc --noEmit -p <dir>`
   individually myself: `quay-backlog`, `quay-github`, `quay-native`, `quay` all exit 0, zero
   diagnostics (not even a tolerated pre-existing TS2589 — none exist).
3. **`packages/quay-backlog` test suite green** — personally ran `node --test test/*.mjs`:
   `tests 12 / pass 12 / fail 0` on the current (post-migration) tree.
4. **Full non-flaky `packages/quay` suite green** — personally ran the 42-file non-flaky set
   (`ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance'`, recount matches 42):
   `tests 354 / pass 354 / fail 0 / cancelled 0 / skipped 0`, zero `not ok` lines in the raw log.
5. **`git log --follow` continuity** — personally ran `git log --follow --oneline` on all 3 `.ts`
   paths: each shows `8c4bc9e` (the rename commit) at the top followed by pre-migration history
   (`manifest.ts` → `c005bbd` → `def5c92`; `backlog-client.ts`/`mcp-server.ts` → `61f02e7` → `c005bbd`).
6. **Golden-diff / no behavior change** — personally extracted `git show 8c4bc9e~1:<path>` for **all
   3** files (not a sample) and diffed against the current `.ts` content: every hunk in all 3 files is
   exactly a type annotation, an `import type` addition, an `as`-cast, a `.js`→`.ts` import-suffix
   change, or an `@ts-nocheck`-removal — zero control-flow/data-shape/logic changes found in any file.
   Also confirmed the `.ts`-suffixed imports resolve correctly under Node's native type-stripping by
   directly importing `manifest.ts` and calling `readManifest`.
7. **JS-elimination scope (informational, ties to DIR-058)** — personally ran
   `find packages -path '*/node_modules/*' -prune -o -name '*.js' -print | grep -v '/test/'`: returns
   only the 2 permanently-exempted SEA shims (`packages/quay-native/scripts/manifest.sea-shim.js`,
   `packages/quay/scripts/version-sea-shim.js`).
8. **Scope check** — `git show --stat 8c4bc9e` touches exactly the 3 renamed files plus 2 necessary
   import-specifier fixups (`bin/quay-backlog.ts`, `test/backlog-client.test.mjs`); no undisclosed
   scope creep.

**Caveat, disclosed rather than silently dropped:** AC3/AC4's "before" half (pre-migration test run)
was not independently re-executed a second time in this audit pass — only the "after" (current-tree)
half was personally re-run. The golden-diff (item 6) is treated as sufficient evidence that pre- and
post-migration behavior is identical, since the only source deltas are type annotations/import
suffixes that Node's native type-stripping erases at runtime with no behavioral effect.

Two charter-level "Additional Done-when" items (a post-migration archguard structural-analysis run
recorded on `dashboard.md`, and dispositioning `DIR-058` `applied`) remain open — these are explicitly
scoped to the charter/ABSORB stage, not this task's own AC/DoD, and were already correctly disclosed
as deferred-to-ABSORB by the iteration-0 report; they are not blocking this task's own closure.

Audit verdict: **CONCERNS** (technical migration fully verified true on independent re-execution; the
non-blocking concerns are the AC3/AC4 "before"-half caveat above and — now corrected by this very
write-back — the fact that this task's own record had not yet been updated to reflect the verified
work). Full audit trail: `milestones/M117/audits/iteration-0-adversarial-audit.md`.


## Not selected (M115)

Not selected M115 — exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM selected instead (smaller, higher-leverage governance fix this pass). Good next exploit pick.



## Not selected (M116)

Not selected M116 — exp5-M-TS-MIGRATION-P5-A selected instead (capability-growth: real product TS migration work, diversifying value type from the last two governance-integrity/instrument-correction picks M114/M115). Good next pick.