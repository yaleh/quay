# M191 — iteration-0 (composite: DIR-117 + DIR-122)

**Charter:** `experiments/quay-perpetual-stream/charters/M191-dir117-dir122-composite.md`
**Composite manifest:** `/home/yale/.claude/jobs/13efe277/tmp/m191-dir117-dir122-manifest.json`
**Member tasks (2):** DIR-117, DIR-122 · **Phases (2, no dependency):** phase-DIR-117, phase-DIR-122
**Build lead:** one agent (this session), serializing both phases per the composite-build.ts
first-implementation note ("the first implementation MAY serialize all phases through you as the
one Build lead if parallel dispatch is unavailable") — task count (2) is NOT reported 1:1 with
agent count (1), per DIR-119-B's own `mapEvidenceToTasks` discipline.

## Evidence map (task × phase × files × tests)

| Task | Phase | Files touched | Tests | Real evidence |
|---|---|---|---|---|
| DIR-122 | phase-DIR-122 | `experiments/quay-perpetual-stream/scripts/task-schema.ts` (+`classifyKind` gap case, `checkGapFinding`/`checkGapRequestedAction`/`checkGapWiringCoverage`), `plugin/scripts/task-schema.ts` (byte-identical mirror), `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` (new, shared), `plugin/scripts/wiring-coverage-check.ts` (mirror), `plugin/scripts/sync-vendor.sh` (+2 SYNC_SCRIPTS entries), `plugin/test/plugin-packaging.test.mjs` (okCount 19→21, workflow count 3→4) | `task-schema.test.mjs` 22/22, `wiring-coverage-check.test.mjs` 9/9, `plugin-packaging.test.mjs` 34/34 | Real before/after `task-schema-check.ts tasks/gap-*.md`: BEFORE `16 total, 7 pass, 7 N/A-legacy, 2 fail`; AFTER `17 total, 7 pass, 7 N/A-legacy, 3 fail` — every currently-`todo`/`ready` gap task now PASSes under `kind=gap`; the 3 remaining fails are pre-existing structure on already-`done` tasks (opportunistic per DIR-122's own Requested-action item 6, not blocking) |
| DIR-122 | phase-DIR-122 | `tasks/gap-build-phase-iteration-evidence-path-not-single-sourced.md`, `tasks/gap-cli-serve-port-test-flaky-ci-timeout.md`, `tasks/gap-drain-dispose-body-corruption.md`, `tasks/gap-touches-orthogonality-symlink-isdirect-mismatch.md` (retrofit: heading fix + real matching AC items for genuine wiring claims) | (covered above) | Each retrofit is a real, honest AC item for a claim the task ALREADY makes — not weakening the check |
| DIR-122 | phase-DIR-122 | (verify-only, not redone) `tasks/gap-symlink-mirror-noop-affects-5-more-scripts.md` / `gap-touches-orthogonality-symlink-isdirect-mismatch.md` reconciliation; `gap-task-schema-plugin-mirror-touches-drift`'s mirror-sync fix | n/a | Both independently re-verified TRUE at Build time (already landed by prior session activity, per charter's own "verify, don't redo" instruction) |
| DIR-117 | phase-DIR-117 | `.claude/workflows/prepare-milestone.js` (new), `plugin/workflows/prepare-milestone.js` (mirror), `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (new), `plugin/scripts/milestone-preparation-check.ts` (mirror), `experiments/quay-perpetual-stream/fixtures/preparation/*` (4 fixtures), `.claude/workflows/execute-milestone.js` (+`Prepared` phase, opt-in), `plugin/workflows/execute-milestone.js` (mirror), `plugin/scripts/sync-vendor.sh`, `plugin/sync.sh` (+prepare-milestone.js to copy list) | `milestone-preparation-check.test.mjs` 12/12, `wiring-coverage-check.test.mjs` 9/9 (shared with DIR-122), `execute-milestone-disposition-conformance.test.mjs` 16/16 | Real CLI runs: `PASS: prepared — ...` (fresh receipt), 4 independent negative mutations each producing a DISTINCT code (`proposal-stale`/`charter-stale`/`plan-stale`/`source-stale`), unrelated-file-no-op still PASS, `--build` CLI mode round-tripped end-to-end (`WROTE:` → `PASS: prepared`) |
| DIR-117 | phase-DIR-117 | `experiments/quay-perpetual-stream/OUTER-LOOP.md` (`prepare(c)` step + `execute()` `preparationReceiptFile?` param + disclosure note), `.claude/skills/quay-task-to-plan/SKILL.md` + `plugin/skills/quay-task-to-plan/SKILL.md` (N=2/N=3 + 3-round/F_i=0 standardization, byte-identical) | n/a (prose/skill files) | `git diff` shows the drift resolved in the design doc's favor (N=2 already the real convention in `prompts/proposal-subagent.md`) |
| DIR-117 | phase-DIR-117 | `tasks/DIR-117-B.md` (new child task, DIR-026 SPLIT-OR-COMMIT) | n/a | Carries the one item (AC#11/DoD real-landing) this milestone cannot self-certify by construction (bootstrap paradox) — same split pattern as DIR-119-A/B → DIR-119-C |

## Composite mechanical checks

- `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-preflight.ts --args-json '...'` → `{"ok":true,"taskIds":["DIR-117","DIR-122"],"isComposite":true,"contractViolations":[]}` (pre-validated per charter; re-verified structurally unchanged — this milestone's own edits do not touch `composite-*.ts`).
- Touches orthogonality: DIR-117 and DIR-122's real touch sets remained file-disjoint EXCEPT the two new shared modules (`wiring-coverage-check.ts`, and both directives' own task files/`OUTER-LOOP.md` references) — both directives explicitly designed to share `wiring-coverage-check.ts` (DIR-122's own AC6: "does not weaken or duplicate DIR-117's ... check — the two share the same underlying concept/implementation"), so this is an intentional, disclosed, load-bearing intersection, not an accidental overlap.

## Full test suite (`bash scripts/test.sh`)

```
tests 537
suites 4
pass 533
fail 1
cancelled 0
skipped 3
duration_ms 592592
```

The 1 fail (`packages/quay/test/build-dist-smoke.test.mjs` — "(b) serve --port + HTTP GET returns
200") is a KNOWN FLAKY test unrelated to this milestone's changes (matches the
`gap-cli-serve-port-test-flaky-ci-timeout` pattern class already on file — CI-timing-sensitive
`serve --port` HTTP readiness poll). Confirmed by re-running the file in isolation immediately
after: `4/4 pass` (`tests 4, pass 4, fail 0`). Not caused by, and not touched by, this milestone's
edits (no overlap with `task-schema.ts`/`wiring-coverage-check.ts`/`milestone-preparation-
check.ts`/`execute-milestone.js`'s new `Prepared` phase).

## Composite-specific hazard disclosed: concurrent activity on `master` during this Build

This Build ran WITHOUT worktree isolation directly against `master` (per the newly-filed
`gap-execute-milestone-no-worktree-isolation` → promoted to `DIR-123` mid-session — a real,
independently-discovered architectural gap, not something this milestone caused). Three commits
landed on `master` from another concurrent session DURING this Build
(`38158d6`/`adb0f26`/`fb20ce1`, timestamps 02:29–02:54 vs. this session's ongoing edits) — none of
which touch any file this milestone's own Touches lists declare (verified via `git show --stat` on
each), so no semantic conflict resulted. Per this hazard, the final commit below stages ONLY the
files this Build intentionally changed (verified via `git status` immediately before staging) —
several unrelated, uncommitted `plugin/gate-scripts/*.sh` changes from that other concurrent
session's own in-flight work are deliberately left untouched, not swept into this commit.

## Per-task disclosed scope (not hidden)

- **DIR-117 AC#5** (Prepared-gate-triggered batch re-evaluation on touch-set expansion):
  `milestone-preparation-check.ts`'s `touches-expanded` code + `--declared-touches` flag exist and
  are tested; wiring that result into `concurrent-batch-scheduler.ts`'s own re-assembly loop is NOT
  done this milestone — disclosed, deferred to a future milestone once DIR-117-B's real-landing
  proof exists to exercise it against.
- **DIR-117 AC#10/#11 + DoD real-landing**: NOT achievable within this same Build by construction
  (this directive cannot pass through its own not-yet-built gate). Split into `DIR-117-B`
  (DIR-026 SPLIT-OR-COMMIT), same pattern this repo already used for DIR-119-A/B → DIR-119-C.
  `execute-milestone.js`'s `Prepared` phase ships strictly OPT-IN (`$a.preparationReceiptFile`)
  so this landing cannot retroactively break the live loop's very next dispatch.
- **DIR-122**: fully landed within this milestone, including the real before/after regression
  proof — no further split needed.

## Task-status disposition (left to Audit, per DIR-020)

Per DIR-020, this Build did not self-tick any AC/DoD checkbox on DIR-117, DIR-122, or any gap task,
and did not change `status`/`dirStatus` fields (only appended `## Execution record` sections to
DIR-117/DIR-122 documenting real evidence for the Audit phase to independently verify). `DIR-117-B`
was created `status: todo` as a new child task.
