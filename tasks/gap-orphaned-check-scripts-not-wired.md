---
id: gap-orphaned-check-scripts-not-wired
title: Multiple real, correct check scripts/config sections exist but are never
  invoked by CI or the loop — a recurring "designed but never wired" pattern
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

A full survey of quay's/exp5's configuration files (2026-07-27, prompted by root-causing
`gap-halt-sentinel-path-mismatch`) found this shape recurring at least 3 times, independent of the
halt-path issue itself:

1. **`scripts/delivery-manifest-check.ts`** — a real, working checker that cross-validates
   `delivery-manifest.json` (documented as "single source of truth for release artifacts... 
   release.yml must produce exactly this set") against `.github/workflows/release.yml`. Zero
   references anywhere in `.github/workflows/*.yml`, `.quay/gates.yml`, or `package.json` — never
   runs automatically. A drift between `delivery-manifest.json` and the real release workflow would
   go undetected indefinitely.
2. **`experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`** — "the mechanical
   go/no-go for un-halting exp5"; real, correct, never invoked by `OUTER-LOOP.md` or any workflow
   script. (Also has its own path bug, tracked separately in `gap-halt-sentinel-path-mismatch`.)
3. **`experiments/quay-perpetual-stream/.quay/loop.yml`'s `concurrency`/`stop`/`gates`/`policy`
   fields** — schema-valid, FAIL-CLOSED-validated by `readLoopParams`, but never read by
   `OUTER-LOOP.md`'s bespoke prose driver (which doesn't call `readLoopParams` at all for exp5).
   The file's own comments already self-disclose this for `concurrency`/`routines`
   ("DECLARATIVE INTENT... INERT until OUTER-LOOP consumes it") but the `routines:` field is now
   actually live (wired via `/run-routines` at OUTER-LOOP's checkpoint step) while
   `concurrency`/`stop`/`gates`/`policy` remain genuinely inert — the comment is now stale/overbroad
   for `routines` specifically.

Also found (lower severity, informational): repo-root `.quay/gates.yml` is a "legacy fallback" per
`.quay/config.yml`'s own header, but `config.yml`'s unified `gates:` section is always present, so
the legacy file is never actually consulted — and the two files' `it0.*` gate script paths have
silently DIVERGED (one points at `plugin/scripts/*`, the other at `experiments/quay-perpetual-stream/
scripts/*`) with no drift check between them, harmless today only because the legacy file is dead
weight.

None of these are silent data-correctness bugs on their own — each is "a real, correct, tested
piece of infrastructure exists, and nothing calls it automatically." But the halt-path case just
showed how this shape (a real script/config field that LOOKS authoritative but isn't actually in
the execution path) can compound with a stale doc into a genuine safety-relevant miss when someone
(a human or an agent) reasonably assumes "if it's documented and the script exists, it must be
running."

## Requested action

For each of the 3 primary findings above, either wire it into a real, automatically-triggered path
(CI workflow step, `OUTER-LOOP.md` step, or `.quay/gates.yml` gate), or — if it's genuinely meant
to stay a manual/human-invoked tool — say so explicitly and loudly in its own header AND in
`CLAUDE.md`/`OUTER-LOOP.md` wherever it's referenced, so nobody mistakes "exists" for "runs".
Resolve the `gates.yml`/`config.yml` `it0.*` path divergence by either deleting the dead legacy
file's gate paths or asserting they match via a drift check.

## Acceptance Criteria
- [x] `delivery-manifest-check.ts` is either wired into `.github/workflows/*.yml` (real CI
  invocation) or its header explicitly says "manual-only, not CI-enforced" with a citation of why. -- [audit M-DIR119-C-CANARY: wired, not manual-only. `.github/workflows/ci.yml` line ~102 runs
  its static mode on every push (`node --experimental-strip-types scripts/delivery-manifest-check.ts`); `.github/workflows/release.yml`'s new `delivery-manifest-verify` job runs `--ci` mode
  post-publish. Ran the static-mode command locally: `DELIVERY-MANIFEST-CHECK: OK`, exit 0.]
- [x] `restart-readiness-check.sh` — same treatment (tracked jointly with
  `gap-halt-sentinel-path-mismatch` item 4). -- [audit: chose the "manual-only, explicit" branch —
  script header now reads "MANUAL-ONLY, NOT CI/LOOP-WIRED (gap-orphaned-check-scripts-not-wired,
  M-DIR119-C-CANARY, 2026-07-27, explicit decision..."; `CLAUDE.md`'s `.halt sentinel` bullet
  (lines 73-77) cites the script by name and states the same "manual, human-invoked check, not
  CI/loop-wired" framing — a fresh reader finds the pointer where CLAUDE.md's own instructions
  say to look for it.]
- [x] `experiments/quay-perpetual-stream/.quay/loop.yml`'s stale "INERT" comment on `routines:` is
  corrected to reflect it's now live; `concurrency`/`stop`/`gates`/`policy` either get wired or the
  comment is left accurate (already is, for those fields). -- [audit: `loop.yml` lines 33-45 replace
  the stale wording with a "CORRECTED STATUS" paragraph explaining routines is now live via
  `.claude/workflows/run-routines.js`, and explicitly reaffirms `concurrency`/`stop`/`gates`/`policy`
  remain genuinely INERT for the bespoke driver. CAVEAT (not blocking this AC, but noted): the
  file's OWN header comment 10 lines above ("stop: until(.halt) sentinel... at
  experiments/quay-perpetual-stream/.halt") was left unedited and is itself stale per
  `gap-halt-sentinel-path-mismatch`/M187 — a residual drift this task's scope didn't reach.]
- [x] `gates.yml`/`config.yml` `it0.*` path divergence resolved or explicitly asserted as
  intentional with a drift check. -- [audit: resolved (not just asserted) — diffed `.quay/gates.yml`'s and `.quay/config.yml`'s `it0:` blocks directly, all 6 entries' `script`/`argsKey` pairs
  are now byte-for-byte identical between the two files.]

## Definition of Done
- [ ] Each item above lands with real, verified evidence (a real CI run that exercises the
  newly-wired check, or a real doc diff), not asserted. -- [audit: 3 of 4 items verified with real
  doc diffs / real local command output (see AC citations above: restart-readiness-check.sh header,
  loop.yml comment, gates.yml/config.yml sync). The `delivery-manifest-check.ts` CI-wiring item is
  NOT yet backed by "a real CI run that exercises the newly-wired check" — same unpushed-commit
  caveat as DIR-110/DIR-111: `git log --oneline --all -- .github/workflows/release.yml` shows the
  `delivery-manifest-verify` job was added in this milestone's own Build commit (`23f43d5`), local
  `master` is 55 commits ahead of `origin/master`, and `gh run list` shows no CI run postdating this
  change. Local static-mode execution passes but is not the CI-run evidence this DoD item names —
  left unticked overall pending that.]

## Human verification when exp5 marks this task done
1. Does a deliberately-broken `delivery-manifest.json` now actually fail a real CI run?
2. Does `loop.yml`'s comment accurately describe what's live vs. inert today?

## Touches

- scripts/delivery-manifest-check.ts
- .github/workflows/release.yml
- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- experiments/quay-perpetual-stream/.quay/loop.yml
- .quay/gates.yml
- .quay/config.yml

## Execution record

- **Milestone:** M-DIR119-C-CANARY (composite, 7 member tasks; DIR-119-C proof)
- **Iteration count:** 1 (direct-to-master build, no separate worktree — precedent: M187/M188/M189)
- **Realized Δv:** deliverable=yes — 4 of 4 AC items independently confirmed with live diffs/
  command output; the DoD's "real CI run" clause for `delivery-manifest-check.ts` remains open
  pending a push to `origin/master` (same shared caveat as DIR-110).
- **Merge commit:** 23f43d5 (Build, direct on master) + this Land's Reconcile/write-back commit
- **Outcome:** DONE with disclosed CONCERNS — all wiring/doc work confirmed; CI-run confirmation
  deferred until this commit series is actually pushed (tracked, not blocking).