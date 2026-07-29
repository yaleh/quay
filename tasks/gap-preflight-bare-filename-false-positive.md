---
id: gap-preflight-bare-filename-false-positive
title: M201/DIR-126-B's new preflight-stale-ac-refs/preflight-missing-precedent
  detectors hard-blocked on this repo's own dominant bare-filename authoring
  convention -- fixed with a repo-wide basename fallback before declaring a
  file-shaped token stale
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
---
## Proposal

Make `prepare-admission-check.ts`'s shared `_scanStaleReferences()` helper (used by both
`preflightStaleAcRefs` and `preflightMissingPrecedent`) fall back to a repo-wide basename search
(via `git ls-files`, computed once per scan) before declaring a file-shaped backtick token stale —
a token whose basename resolves anywhere in the tracked tree is real, regardless of which directory
it actually lives in.

## Finding

Discovered 2026-07-29 by the M201/DIR-126-B iteration-0 adversarial acceptance audit
(`milestones/M201/audits/iteration-0-acceptance-audit.md`, verdict REFUTED): dogfooding the real
production `--preflight` CLI invocation against DIR-126-B's own real task+charter file (and
DIR-126-A's) rejected BOTH — `` `prepare-admission-check.ts` ``, `` `prepare-milestone.js` ``,
`` `wiring-coverage-check.ts` ``, `` `task-schema.ts` ``, etc. are this repo's dominant authoring
convention for naming a file in prose (bare filename, no directory component), but the pre-fix
`_scanStaleReferences()` only checked `fs.existsSync(path.join(workspace, tok))` — a literal
repo-root-relative join — so any bare filename whose real location is NOT the repo root (i.e.
almost every file in this repo, which lives under `experiments/quay-perpetual-stream/scripts/`,
`packages/*/src/`, etc.) was wrongly flagged as a dangling reference. Landed as-is, the new
`Preflight` phase would have rejected essentially any ordinarily-written task before any author
agent ever ran — the opposite of the feature's purpose.

## Requested action

1. Add `_repoBasenames(workspace)` to `prepare-admission-check.ts` (+ `plugin/scripts/` mirror):
   `git ls-files` once per scan, indexed by `path.basename()`.
2. In `_scanStaleReferences()`, before declaring a file-shaped token stale, check the basename index
   as a fallback when the literal join fails.
3. Add regression tests: a bare filename that resolves elsewhere in the real repo tree (not at the
   literal joined path) is NOT stale, for both `preflightStaleAcRefs` and `preflightMissingPrecedent`.
4. Re-verify no regression: full `scripts/test.sh` stays green; DIR-126-B's own real task now
   dogfoods clean (`--preflight` against `tasks/DIR-126-B.md` returns `{ok:true, findings:[]}`).

## Acceptance Criteria

- [x] `_repoBasenames()`/the basename-fallback check are real, wired into `_scanStaleReferences()` in
  both the canonical `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` and the
  byte-identical `plugin/scripts/prepare-admission-check.ts` mirror (`cmp`, zero output).
- [x] Two new regression tests confirm the fix (one per detector sharing the helper): a bare
  filename that exists elsewhere in the repo tree is not flagged stale/missing. Full suite: 57/57
  pass (`node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`).
- [x] Real, non-fixture evidence: dogfooding `--preflight --taskId DIR-126-B --charterFile
  experiments/quay-perpetual-stream/charters/M201-dir126b-deterministic-preflight.md --workspace .`
  against the real task/charter files goes from `{ok:false, ...2 blocking findings...}` (pre-fix) to
  `{ok:true, findings:[]}` (post-fix, after also correcting one placeholder-shaped token in the task
  body itself — see `tasks/DIR-126-B.md`'s `tasks/<taskId>.md` correction, a separate content fix).
- [x] No regression: `wiring-coverage-check.test.mjs` (18/18) and the full `scripts/test.sh` suite
  stay green.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master` under human-steered discipline (this touches the shared
  `prepare-admission-check.ts` module DIR-126-A/DIR-126-B/DIR-126-C both depend on).
- [x] Real, non-fixture evidence: M201/DIR-126-B's own real task+charter dogfood run went from
  REFUTED-causing (2 blocking false positives) to clean, confirmed via direct before/after re-run of
  the real CLI against the real task file.

## Known follow-up (not fixed here, filed for completeness)

Dogfooding DIR-126-A's own (already-landed, already-audited) task text surfaced a second, narrower
false positive: `preflight-missing-precedent` flagged an internal ProposalReview finding-id
(`f76ae150`, an 8-hex-char ledger identifier) as a stale commit citation, because finding-ids and
abbreviated commit SHAs are visually indistinguishable by the `_COMMIT_HASH_RE` regex. This is NOT
fixed here: DIR-126-A is already `status: done` and will never be re-run through `Preflight` (the
phase only gates an in-progress `prepare-milestone` dispatch), so there is no operational risk
today — but a FUTURE task citing a finding-id in prose could hit the same collision. Left as a
known, narrower precision limitation for a future child (likely [[DIR-126-C]] or a dedicated gap)
to address, rather than blocking this fix on a fully general commit-hash-vs-finding-id
disambiguation heuristic.

## Round 2 (2026-07-29, independent re-audit of the round-1 fix)

A second independent audit of DIR-126-B, dispatched specifically to check whether the round-1
basename-fallback fix generalized correctly, found it introduced its own new defect plus a
separate, pre-existing false-positive class the round-1 fix never touched:

- **Finding A (round-1 fix too permissive):** the basename fallback was originally unconditional —
  a directory-qualified but entirely FABRICATED path (`` `packages/nonexistent-fabricated-package/
  package.json` ``) silently passed whenever some unrelated real file shared its basename
  (`package.json` exists dozens of times in this repo) — a silent false pass, not
  `reviewer-required`. **Fixed:** the basename fallback now applies ONLY to bare tokens (no `/` at
  all) — the actual shape of the original bug; a directory-qualified token that fails its literal
  join no longer gets a basename-anywhere escape hatch.
- **Finding B (pre-existing, untouched by round 1):** neither detector could distinguish "citing a
  file that already exists" from "naming a file this task's own `## Touches` proposes to create" —
  an extremely common authoring pattern (`` `foo.ts (new)` `` in Touches, then `` `foo.ts` `` cited
  in AC/DoD text). A scan of this repo's real open `status:todo` tasks found 6/39 (~15%) hard-blocked
  this way (DIR-099, DIR-100, DIR-101, DIR-104, DIR-121, this repo's own
  `gap-build-phase-iteration-evidence-path-not-single-sourced`). **Fixed:** `_scanStaleReferences()`
  now accepts an optional `touchesGlobs` list (the calling task's own `## Touches`, reusing the
  already-existing `_extractGlobsFromSection`/`_globCoversPath` helpers `preflightTouchesMismatch`
  already defines — no new parser); a file-shaped token covered by the task's own declared Touches
  is future work the task itself brings into existence, never a stale/missing precedent. Also
  strips a trailing parenthetical annotation (`` `foo.ts (new)` ``) before matching, since that's
  this repo's real, confirmed authoring convention (`tasks/DIR-099.md` through `DIR-121.md`).
- **Bonus fix, found while re-sweeping the real task corpus for residual false positives after
  fixing A/B:** `.quay/`-prefixed tokens (e.g. `` `.quay/gates.yml` ``) are this repo's own
  established per-workspace RUNTIME state prefix (CLAUDE.md documents `.quay/config.yml` as
  per-workspace, never repo-tracked) — illustrative in prose, never a claimed repo-tracked
  precedent. Now skipped entirely in the existence check, closing the remaining false positive on
  DIR-099/DIR-100/DIR-104 (all three cite `.quay/gates.yml` this way).

**Result:** of the 6 originally-flagged real open tasks, 5 now dogfood clean
(DIR-099/DIR-100/DIR-101/DIR-104/DIR-121); the 6th
(`gap-build-phase-iteration-evidence-path-not-single-sourced`) still cites a literal
placeholder-shaped token (`` `iteration-N.md` ``, same class as `tasks/X.md` fixed in DIR-126-B's
own text) — left as-is since fixing it means editing that OTHER task's content, out of this gap's
scope. DIR-126-A's own already-landed text also now shows a THIRD known, non-blocking residual
(a partial-path abbreviation, `` `quay-native/src/store.ts` `` missing its real `packages/` prefix,
previously covered by the now-restricted basename-anywhere fallback) — same disposition as the
`f76ae150` finding-id case above: DIR-126-A won't be re-preflighted, so no operational risk.

Real evidence for round 2: 3 new regression tests (fabricated-path-still-stale,
Touches-membership, `.quay/`-prefix carve-out) — full suite 60/60 pass. DIR-126-B's own dogfood
re-confirmed clean after all round-2 changes: `{ok:true, findings:[]}`.

## Round 3 (2026-07-29, third independent audit — the calibration downgrade)

A third independent audit, specifically trying to construct new counter-examples against the
round-2 fix, found: (1) a LIVE, currently-blocking false positive on a different real open task
(`gap-build-phase-iteration-evidence-path-not-single-sourced.md`'s own `` `iteration-N.md` ``
placeholder — the exact same generic-placeholder class DIR-126-B's own text already had to work
around once); (2) a real regression introduced by round 2's own bare-only basename restriction
(a directory-qualified-but-SHORTENED real path, e.g. `` `scripts/foo.sh` `` for the real
`` `experiments/quay-perpetual-stream/scripts/foo.sh` ``, no longer resolves); (3) a still-open gap
in the Touches-membership check (trailing free-form prose after a backtick path defeats the glob
match). None of these three were currently live-blocking a real task except (1).

Given THREE independent audit rounds each found a genuinely NEW real false-positive class
specifically in `preflight-stale-ac-refs`/`preflight-missing-precedent` (never in the other three
detectors) against this repo's real, organically-varied, ever-growing task-prose corpus,
per-shape regex patching does not converge — natural-language disambiguation of "claimed existing
precedent" vs. "placeholder/future-file/abbreviated-path prose" is not fully solvable by exact
mechanical matching. **Resolution:** flip `PREFLIGHT_CALIBRATED["preflight-stale-ac-refs"]` and
`PREFLIGHT_CALIBRATED["preflight-missing-precedent"]` to `false` — not a scope-narrowing
workaround, but the literal mechanism this task's own AC ("Repair/calibrate before fail-closed
activation") and DoD (`Defaults and failure behavior` table: "A detector's calibration corpus is
not green → that detector stays non-blocking in production") already specify for exactly this
situation. A non-calibrated detector still runs and still reports every finding
(`disposition:"reviewer-required"`, confirmed by a new regression test — never silently dropped),
it simply cannot hard-block. The other three detectors held up with zero real false positives
across all three independent audit rounds and remain calibrated/blocking.

Real evidence for round 3: a full sweep of all 39 of this repo's real, currently-open
(`status:todo`) tasks — not a sample — now dogfoods 0/39 blocked (was 1/39 live-blocked pre-fix,
plus the round-2-introduced regression and the Touches-gap were both real but not yet live-blocking
any of the 39). 1 new regression test confirms the downgrade behavior at the real
`runPreflightChecks`/CLI entry point (not just the raw detector function, which stays
calibration-unaware by design). Full suite: 61/61 pass.

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
