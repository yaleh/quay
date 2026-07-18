# Charter M08-merge-recover — Recover exp4 merge-drift: CLI/Docs/Packaging (Tier-A)

**Milestone id:** M08-merge-recover · **surface:** CLI (25) + Docs (15) + Packaging/Distribution (20)
· **type:** explore
**Source:** gap-list MD-001 (significant) + DOC-006/DOC-007 (minor), discovered by M04-discover (m4);
backlog `M-MERGE-RECOVER` row, deferred from m5 and m6 per the standing pre-commitment recorded at
m7's ABSORB ("SELECT m8 = M-MERGE-RECOVER, no further deferral").
**Charter authored:** m7→m8 boundary, 2026-07-18, chart-1.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's current
HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis (recorded BEFORE dispatch, §4.1/§6.2)
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **capability-growth** (primary —
  real, previously-claimed-shipped CLI/Docs/Packaging capability is silently absent from `master`
  today; recovering it is a genuine VT step) + **instrument-correction** (secondary — `CHANGELOG.md`'s
  v0.2.0 entry makes 3 false shipped-feature claims per MD-001; fixing the ledger to match reality is
  itself corrective, same flavor as M04-discover's own VT re-score at m4).
- Current baseline (post-m4 re-score, `dashboard.md` chart-1 re-score section): **CLI cov = 0.80**
  (4 capability losses: `--version`/`-V`, `--page-size` in 3 modes, `--format json` alias — all
  live-confirmed absent/broken despite gap-list claiming them closed since exp4 iterations 13-17),
  **Docs cov = 0.55** (packages/quay/{README,CHANGELOG,LICENSE}.md all absent; root README has zero
  SEA-distribution mention; CHANGELOG stuck at v0.2.0 with false claims), **Packaging cov = 0.85**
  (SEA path itself solid; `package.json` `files`/`license` fields missing — explicitly flagged at m4
  for "more rigorous re-derivation at the M-MERGE-RECOVER milestone").
- Target (conservative, re-baseline at ABSORB from REALIZED evidence, not this placeholder): CLI
  0.80→~0.93 (Δ+0.13 × 25 = **+3.25**), Docs 0.55→~0.80 (Δ+0.25 × 15 = **+3.75**), Packaging
  0.85→~0.88 (Δ+0.03 × 20 = **+0.60**) → **Δv̂ ≈ +7.6** (backlog's own pre-charter estimate was "+4 to
  +6"; this charter's slightly higher number reflects a fuller accounting including the
  Packaging-metadata nudge backlog flagged as deferred-not-yet-priced — still treat as a placeholder,
  the realized number at ABSORB is authoritative, not this estimate).
- Metric `Y`: binary Done-when completion (below), each independently pasted-evidence checkable —
  every item is a live CLI/file-existence/test-suite check, not subjective judgment.

## In-scope gap subset (the ONLY gaps this milestone may work; no gap-list-wide sweep)
Recovery approach: **re-implement fresh against current `master`**, NOT re-merge the original
`experiment-4-iteration-{13,14,16,17,18,19}` branch tips. Confirmed at charter-authoring time via
`git diff --stat master experiment-4-iteration-19 -- packages/quay`: those branches predate M-DIST
and M-ABI-EVAL and would DELETE files master now has (`scripts/build-sea.sh`, `scripts/esbuild-
sea.mjs`, `scripts/version-sea-shim.js`, `test/provider-abi-conformance.test.mjs`) — a direct merge
is unsafe. Re-implementing each capability fresh against current master, re-verified against its
original test intent, is the smaller-diff, safer path backlog already flagged as preferred.

1. **CB-021 / `--format json` alias** — `bin/quay.js`: make `--format json` behave identically to
   the working `--json` flag (currently silently falls through to human-readable output, no error).
2. **CB-006 / CB-022 / `--page-size N`** — functional in CLI table mode, JSON output mode
   (`printJson(sorted)` bug — should filter by page size before printing), AND Web UI list page.
   Currently silently ignored in all three.
3. **UQ-047 / `--version`/`-V`** — add a working version flag printing the real `package.json`
   version (currently both fail with a usage error).
4. **UQ-048** — once CB-006 is real again, invalid `--page-size` values (0, -1, `abc`) should emit a
   warning/error rather than silently falling back to "show all" (this validation was moot while
   `--page-size` itself was non-functional; now it's real scope).
5. **PKG-003/004/006/007/008** — `packages/quay/package.json` gains a `files` field (correct
   contents, no ghost entries — PKG-005's "templates/ ghost entry" finding was itself moot with no
   `files` field; don't reintroduce it) and a `license` field; `packages/quay/{README,CHANGELOG,
   LICENSE}.md` created (LICENSE mirrors repo root's license).
6. **DOC-001..005** — once `packages/quay/README.md` exists (item 5), it documents `--provider`,
   `action list`/`action run`, `task view`/`task edit --status`, has correct config-section ordering,
   and includes the releases URL for Option A install.
7. **DOC-006** — root `README.md` gains a section documenting the SEA/single-file-executable
   distribution path (M-DIST's headline deliverable, currently completely undocumented there).
8. **DOC-007** — `CHANGELOG.md` gains a real v0.3.x entry (SEA/CI distribution, this milestone's
   recovered items); the existing v0.2.0 entry's 3 false shipped-feature claims (`--version`/`-V`,
   `--page-size`, `--format json` alias) are corrected to accurately reflect what v0.2.0 actually
   shipped vs. what's newly landing in this milestone's entry.
9. **Explicit exclusions**: UQ-049/UQ-050 (Web UI search-param/mobile-CSS, separate backlog rows,
   bundle into a future Web UI pass, not this milestone) and PKG-ABI-related items (out of this
   surface set). Do not re-attempt a branch merge after confirming the conflict risk above.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `quay --version` and `quay -V` both print the real package version — pasted output.
2. `[ ]` `--format json` produces valid JSON identical in content to `--json` — pasted output, both
   flags compared.
3. `[ ]` `--page-size N` works correctly in CLI table mode, JSON mode, AND Web UI list page; invalid
   values (0, -1, `abc`) emit a warning/error (UQ-048) — pasted output for all cases.
4. `[ ]` `packages/quay/{README,CHANGELOG,LICENSE}.md` all exist with real content (README covers
   DOC-001..006 scope including SEA distribution; CHANGELOG has a v0.3.x entry and a corrected v0.2.0
   entry); `package.json` has correct `files`/`license` fields — pasted `ls`/`cat` evidence.
5. `[ ]` Root `README.md` documents the SEA distribution path (DOC-006) — pasted diff/excerpt.
6. `[ ]` Full existing test suite passes, PLUS new/updated tests covering items 1-3 above (re-derive
   against the ORIGINAL exp4 test intent for these capabilities, not just re-implement blind) —
   pasted raw output, not a summary.
7. `[ ]` `dashboard.md`'s chart-1 CLI/Docs/Packaging cov re-scored from this milestone's OWN live
   re-verification evidence (not the placeholder above); gap-list.md's MD-001/CB-006/CB-021/CB-022/
   UQ-047/UQ-048/PKG-003..008/DOC-001..007 entries updated to reflect real closure (not re-asserting
   the same "Closed (claim)" pattern that caused MD-001 in the first place — this milestone's own
   closure claims must be independently re-verifiable, e.g. cite the live command output directly in
   the gap-list entry, mirroring how MD-001 itself was diagnosed).

Milestone is DONE when all seven are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2–5 if they fire first (ΔV plateau K=2, ceiling, budget≈10 past with nothing
climbing, external HALT).

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch.

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop · (4) budget≈10
backstop, past→default HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — re-verify at it0 that all 9 in-scope items are still live-confirmed
   absent/broken on current master (charter-authoring-time evidence is from m4's report; re-check in
   case anything shifted since m4-m7).
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted live command/file/test output.
d. **Domain-misfit audit-channel** — per `inherited-core.md`'s now-CONSOLIDATED φ-confirmed pattern
   (added at m7's ABSORB): the audit channel for this milestone is a CI job / independently-triggered
   test run (existing CI workflow re-run against the recovered capabilities), NOT the same-process
   local test run that writes the fix — this milestone should EXPLICITLY apply the now-consolidated
   convention rather than re-deriving it from scratch, itself a small first real-world reuse of the
   consolidation work just landed.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher. Record each iteration under
`experiments/quay-perpetual-stream/milestones/M08-merge-recover/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M08-merge-recover/worktrees/iteration-N`, branch
`exp5-m08-iteration-N`.
