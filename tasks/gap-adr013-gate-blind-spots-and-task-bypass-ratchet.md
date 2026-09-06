---
id: gap-adr013-gate-blind-spots-and-task-bypass-ratchet
title: Fix ADR-013 conformance gate's two evergreen-pass defects + add a
  fail-closed task-file-bypass ratchet
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-09-06 architecture-audit discussion found ADR-013's own conformance gate (`packages/quay/test/delivery-standalone-smoke.sh`) has two structurally-always-pass defects, independently verified in-session (not assumed):

1. **Checks 1/2 (`:52`, `:57`) scan scope misses shipped directories.** They grep only `"$D/src" "$D/bin"`, but `packages/quay/package.json`'s `"files"` array (confirmed by direct read) also ships `"plugin"` and `"dist"`. Real exp5-reference/cross-package-import violations in `plugin/` (confirmed: 137 lines of exp5 references live there) go undetected because the checker never looks at the directory it's shipped in.
2. **Check 5 (`:78`) targets a renamed file.** It greps `"$D/src/gate/registry.js"` for gate-script references, but the file was renamed `registry.ts` under the TS migration (confirmed: `ls packages/quay/src/gate/` shows only `registry.ts`) and `bin` now resolves to `./dist/quay.js` (confirmed in `package.json`), meaning the actually-delivered artifact may carry a compiled `dist/gate/registry.js` distinct from the `src/*.ts` this check was written against. Verified bidirectionally: the predicate misses on both the old `.js` path (file doesn't exist there) and would miss on a literal `.ts` swap too if `dist/` isn't also checked — it needs to locate whichever form is actually delivered, not assume one.

Both defects produce a "0 RED" verdict that is indistinguishable from genuine conformance — a checker that can't see the thing it's checking is not evidence of correctness (CLAUDE.md 硬规则 3b: "an unreadable input must not return a value shaped like a pass").

Separately, the same audit found ~96 places across this codebase where code reads/writes `tasks/*.md` directly instead of through the Provider ABI (`task_write`/`task_get`/etc.) — the exact problem class the sibling tasks `gap-abi-missing-commit-delete-dependson-primitives`, `gap-task-ops-consolidate-driver-frontmatter-writers`, `gap-quay-task-consolidated-subagent`, and `gap-worker-prompt-ac-check-via-abi-not-hand-edit` are chipping away at. Fixing those without ALSO adding a mechanical check that a NEW bypass site can't quietly reappear is exactly the failure mode ADR-013's own gate demonstrates: fixing individual instances without a standing check for the class lets the class regress silently. No such check exists today for `tasks/*.md` bypass (confirmed: no task or file matching this pattern found in a dedup sweep).

## Plan

1. **Fix check 1/2's scan scope**: extend the `grep -rnE` target list in both checks from `"$D/src" "$D/bin"` to `"$D/src" "$D/bin" "$D/plugin" "$D/dist"` (matching the real `files` whitelist).
2. **Fix check 5's target resolution**: replace the hardcoded `"$D/src/gate/registry.js"` path with a `find "$D" -path '*/gate/registry.*'` (or equivalent) that locates whichever form (`.ts` source or compiled `.js`) is actually present in the delivered artifact, and greps that.
3. **Add a new fail-closed static checker**, e.g. `plugin/scripts/task-file-bypass-check.ts`: scan `packages/quay/src/**` and `plugin/**` (excluding `plugin/test/`) for `tasks/` path-literal `fs.*`/`execFileSync`/`spawnSync`/git-show-on-task-path calls; report every hit NOT covered by an explicit allowlist.
4. **Seed the allowlist** with today's known, currently-necessary bypass sites (a ratchet baseline, not a one-time exemption): `packages/quay/src/observation.ts` (the documented quarantine for git-ref reads), `plugin/scripts/driver-filters.ts`, `plugin/scripts/worker-driver.ts`, `plugin/scripts/ready-pool-check.ts` (until `gap-task-ops-consolidate-driver-frontmatter-writers` lands), `packages/quay/src/fan-in/ff-merge.ts`, `packages/quay/src/config-validate.ts`, `packages/quay/src/init.ts`, `plugin/skills/routines/`, `plugin/workflows/fan-in-execute.js` (+ its dual-copy locations).
5. **Wire it as a one-way ratchet**: the checker fails if a hit appears in a file NOT in the allowlist (new bypass = red); it must NOT auto-fail on allowlisted files, but must warn/report when an allowlisted file's hit COUNT changes, so shrinking the allowlist (as sibling tasks land) is a deliberate, reviewed edit, not a silent capability loss. Register it in `scripts/test.sh`'s static-check tier (per its own header convention for `--for-task` scoped static checks).
6. Confirm neither fix regresses `packages/quay/test/delivery-standalone-smoke-gate.test.mjs`'s existing expectations.

## Acceptance Criteria

- [x] `delivery-standalone-smoke.sh` checks 1/2 scan `"$D/src" "$D/bin" "$D/plugin" "$D/dist"` — verified by reading the script and confirming the four paths appear in both `grep -rnE` invocations.
- [x] Running the smoke gate against the current tree (with the exp5-reference content actually present in `plugin/`) now produces a genuine RED on check 1 or 2 where it previously produced a false GREEN — verified by running the script before and after the fix and diffing the verdict counts (a negative control: it must be able to fail).
- [x] `delivery-standalone-smoke.sh` check 5 locates the real delivered gate-registry file regardless of extension — verified by running it against the current tree and confirming it finds and greps a real file (not silently matching nothing).
- [x] `plugin/scripts/task-file-bypass-check.ts` exists, is registered in `scripts/test.sh`'s static-check tier, and exits non-zero on a deliberately-injected new bypass site (a scratch file outside the allowlist with a `tasks/` fs call) — verified by injecting one and running the checker.
- [x] The same checker exits zero against the current tree with today's allowlist populated (the ratchet baseline holds, no false-positive noise on day one).
- [x] The allowlist is a data file or exported constant (not inline scattered logic) so shrinking it later (as sibling tasks land) is a one-line diff — verified by inspecting the checker's structure.
- [x] `packages/quay/test/delivery-standalone-smoke-gate.test.mjs` still passes after both smoke-gate fixes.

## Definition of Done

Running `bash packages/quay/test/delivery-standalone-smoke.sh` against the current tree produces at least one genuine RED that was previously a false GREEN (proving the fix, not just asserting it), and `node plugin/scripts/task-file-bypass-check.ts` is wired into the default static-check tier and demonstrated (via an injected scratch violation) to actually catch a new `tasks/*.md` bypass site — not merely coded to be capable of it.

## Touches

- `packages/quay/test/delivery-standalone-smoke.sh`
- `packages/quay/test/delivery-standalone-smoke-gate.test.mjs`
- `plugin/scripts/task-file-bypass-check.ts` (new)
- `plugin/scripts/capability-catalog.sh`
- `plugin/scripts/runner-static-gate.ts`
- `plugin/scripts/checker-mutation-cases/task-file-bypass-check.sh` (new)
- `plugin/test/task-file-bypass-check.test.mjs` (new)
- `plugin/test/fixtures/task-file-bypass/plugin/scripts/bad.ts` (new)
- `tasks/gap-adr013-gate-blind-spots-and-task-bypass-ratchet.md` (self)
