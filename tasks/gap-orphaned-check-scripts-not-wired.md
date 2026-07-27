---
id: gap-orphaned-check-scripts-not-wired
title: Multiple real, correct check scripts/config sections exist but are never
  invoked by CI or the loop — a recurring "designed but never wired" pattern
status: todo
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
- [ ] `delivery-manifest-check.ts` is either wired into `.github/workflows/*.yml` (real CI
  invocation) or its header explicitly says "manual-only, not CI-enforced" with a citation of why.
- [ ] `restart-readiness-check.sh` — same treatment (tracked jointly with
  `gap-halt-sentinel-path-mismatch` item 4).
- [ ] `experiments/quay-perpetual-stream/.quay/loop.yml`'s stale "INERT" comment on `routines:` is
  corrected to reflect it's now live; `concurrency`/`stop`/`gates`/`policy` either get wired or the
  comment is left accurate (already is, for those fields).
- [ ] `gates.yml`/`config.yml` `it0.*` path divergence resolved or explicitly asserted as
  intentional with a drift check.

## Definition of Done
- [ ] Each item above lands with real, verified evidence (a real CI run that exercises the
  newly-wired check, or a real doc diff), not asserted.

## Human verification when exp5 marks this task done
1. Does a deliberately-broken `delivery-manifest.json` now actually fail a real CI run?
2. Does `loop.yml`'s comment accurately describe what's live vs. inert today?
