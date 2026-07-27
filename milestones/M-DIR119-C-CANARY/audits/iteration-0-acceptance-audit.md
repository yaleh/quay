# M-DIR119-C-CANARY — composite adversarial acceptance audit (iteration 0)

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

**Scope:** DIR-119-B (M189) composite-audit call, 7 member tasks: `DIR-070`, `DIR-110`, `DIR-111`,
`exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN`, `gap-config-wiring-check-symlink-noop`,
`gap-orphaned-check-scripts-not-wired`, `gap-workflow-name-dispatch-stale-script-cache`.

**Stance:** refute-first, fresh context, no prior exposure to the build. Per the composite-audit
architectural boundary, this artifact and the per-task AC/DoD checklist write-backs are this
agent's only mutations — no absorb dispositions, dashboard ABSORB entries, milestone counter, or
lifecycle STATUS field were written for any member task (that is Land's job).

**Overall verdict: CONCERNS.** No fabrication or missing work found anywhere in the 7 tasks; the
large majority of AC/DoD claims are independently, mechanically confirmed against live command
output, real diffs, and passing tests. Two concrete, reproducible gaps prevent a clean "NO
REFUTATION FOUND": (1) two of DIR-070's 8 AC bullets describe gate behavior that does not hold as
literally worded (pre-existing since M137, not newly introduced), and (2) several DoD items across
DIR-110/gap-orphaned-check-scripts-not-wired require "a real CI run," which cannot yet exist because
this milestone's Build commit is still local (`master` is 55 commits ahead of `origin/master` at
audit time). Both are disclosed in detail below and in the per-task checklist write-backs.

---

## Per-task findings

### DIR-070 (epic, 6 children DIR-070-A..F, all `status: done`)

AC (8 items): 6 confirmed, 2 unconfirmed.

- **Confirmed with live evidence:**
  1. `sync-vendor.sh --check` drift detection: deliberately drifted `plugin/scripts/candidate-contracts.ts`
     (appended a marker line) → `bash plugin/scripts/sync-vendor.sh --check` exits 1 with an explicit
     `DRIFT:` line naming the file; restored the file → exits 0 `CLEAN`. Both RED and GREEN states
     reproduced live, not just the passing case the repo's own test suite exercises.
  2. 7 group-1 symlinks (`anti-drift-touches-check.ts`, `concurrent-batch-scheduler.ts`,
     `read-probe-spec.ts`, `routine-file-gate.ts`, `routine-scheduler.ts`, `serial-fanin-absorb.ts`,
     `touches-orthogonality-check.ts`) confirmed via `ls -la experiments/quay-perpetual-stream/scripts/`
     — all `lrwxrwxrwx -> ../../../plugin/scripts/<name>`.
  3. `plugin/test/plugin-packaging.test.mjs`: ran directly, 34/34 pass, 0 fail.
  4. `quay gate --gate audit-independence` (it0-family, argsKey-parameterized): resolves to
     `plugin/scripts/audit-independence-check.sh` and returns an actionable, correctly-worded
     failure ("no audit-independence arguments defined... set task.extra.auditIndependenceArgs...")
     rather than a raw usage crash — wired and behaving as designed.
  5. `/run-routines` continues to work with the now-symlinked scripts: `routine-scheduler.test.mjs` +
     `routine-file-gate.test.mjs` → 17/17 pass; `probe-spec-wiring.test.mjs` → 8/8 pass.
  6. DIR-069 dispatch path: task `status: done`, DoD ticked with citations (probe spec authored,
     `.quay/config.yml` routine entry present, scheduler parses it — 25/25 related tests, manual
     dry-run against live `quay serve` documented in `milestones/M138/iterations/iteration-0.md`).

- **NOT confirmed (refute-first — left unchecked in the task file):**
  7. `quay gate --gate loadbearing-test` — resolves to the correct `plugin/scripts/` path, but the
     gate is registered as a **zero-argument** `fixed:` gate in `.quay/config.yml` while
     `loadbearing-test-gate.sh`'s own contract requires `--scripts <dir> [--tests <dir>]`. Invoked
     with zero args (exactly what `quay gate --gate loadbearing-test <any-task>` supplies), it always
     prints `Usage: ...` and exits 2 — never a real pass/fail verdict, regardless of actual repo
     state. Reproduced live:
     ```
     $ node --experimental-strip-types packages/quay/bin/quay.ts gate DIR-070 --gate loadbearing-test
     FAIL — acceptance failed (exit 2)
     $ bash plugin/scripts/loadbearing-test-gate.sh
     Usage: plugin/scripts/loadbearing-test-gate.sh --scripts <dir> [--tests <dir>] ...
     ```
  8. `quay gate --gate anti-gaming` — identical shape: `anti-gaming-guard.sh` requires
     `--cov-source/--cov-capped/--cov-inflatable/--adjudication`, registered zero-arg under `fixed:`,
     always exits 2 via the CLI form.

  **This is not a new defect.** `milestones/M137/audits/iteration-0-acceptance-audit.md` (DIR-070-B's
  own acceptance audit) already observed and disclosed the exact same behavior ("Gate resolves via
  `quay gate --gate anti-gaming DIR-070-B`: executes (exit 2 — missing args, NOT gate-not-found)")
  and accepted the AC under a looser "resolves and doesn't ENOENT" reading of "works". This audit
  applies DIR-070's own literal AC wording ("works with plugin/scripts/ paths") under a stricter,
  refute-first standard and cannot confirm it: a gate that can never produce anything but a usage
  error is not "working" in the sense a reader would expect. In practice this is low-impact — every
  real caller of these two scripts found in this repo (`experiments/quay-perpetual-stream/charters/
  M42-*.md`, `M125-*.md`, `M127-*.md`, `M158-*.md`, `restart-readiness-check.sh`) invokes them
  directly with explicit args, never through `quay gate --gate <name> <task>`. Flagged as a
  deviation row (dashboard.md) rather than a blocking finding.

DoD: 10 of 11 confirmed (mirrors the AC evidence above plus direct file/config inspection). The
final DoD item ("Satisfies the standard DoD clauses in inherited-core.md... real-landing, not
asserted") is left unchecked because the mechanical gate genuinely fails — see Mechanical Gate
section below; that failure is real, not a bookkeeping artifact, and stems directly from the two
unconfirmed AC items above, not from anything this audit introduced.

### DIR-110 (test-coverage-check.ts / ADR-019 step 2)

AC: all 4 confirmed live —
```
$ node --experimental-strip-types scripts/test-coverage-check.ts
test-coverage-check — canonical=84 discovered=84
PASS: 0 orphan(s) — every discovered product/plugin-tier test file is reachable by scripts/test.sh
$ node --experimental-strip-types scripts/test-coverage-check.ts --selftest
test-coverage-check --selftest: 6 passed, 0 failed
```
`--selftest` genuinely plants an orphan test file in a scratch temp dir, asserts RED (orphan path
named), removes it, asserts GREEN again — a live-executed demonstration of both states, not two
static fixture files. `.github/workflows/ci.yml` lines 28-35 run `--selftest` then the real check as
an early step, immediately before "Run tests". `adr/ADR-019-...md` line 7's `enforcement` field
cites this script's exact invocation.

DoD: 3 of 4 confirmed. **Unconfirmed:** "A real CI run shows the step executing and passing" — this
script exists only in this milestone's own local Build commit (`23f43d5`; `git log --oneline --all
-- scripts/test-coverage-check.ts` shows exactly one commit), and local `master` is 55 commits
ahead of `origin/master` (unpushed). `gh run list` confirms no GitHub Actions run postdates this
change. Local reproduction of the CI step's exact command passes, but that is not the same evidence
this DoD item names — left unticked pending Land pushing the commit and a real run completing.

### DIR-111 (ADR-019 step 3 — packaging/browser e2e labeling)

AC: all 3 confirmed. `ci.yml`'s `dist-verify-node-floor` job carries an explicit
"DIR-111/ADR-019 decision #5: this job IS this repo's 'packaging e2e' category" comment.
`CLAUDE.md` lines 34-39 name both packaging e2e and browser/agent e2e explicitly, citing
`adr/ADR-010-scheduled-milestone-e2e-incl-browser-tests.md` by filename, placed directly inside the
Commands section's Tests bullet block (not folded away). `grep -n "ADR-010" CLAUDE.md` hits.

DoD: both items confirmed (both edits are part of local commit `23f43d5`; a fresh read of both
files unambiguously distinguishes covered vs. not-covered categories).

### exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN

The task's own "Scope narrowed (2026-07-26)" section pivots the deliverable from a standalone ADR
file to a CLAUDE.md paragraph (M148 precedent style). The pivoted deliverable is real and
confirmed: `CLAUDE.md` lines 41-49 cover why schemas are deferred, the mandatory pre-fetch pattern,
the zero-results failure mode, and the verify-before-call mitigation.

However, the `## Acceptance Criteria` checklist above that section was **never rewritten** to match
the pivot — it still literally demands `adr/ADR-NNN-toolsearch-deferred-schema-pattern.md` (does
not exist: `ls adr/ | grep -i toolsearch` → empty) and "ADR status: accepted". Per refute-first
instructions, these 3 boxes are left unchecked rather than ticked against a different artifact; the
real narrowed-scope deliverable is cited separately in a new "Redefined-scope deliverable" block
added to the task file. This is a genuine checklist/narrative inconsistency (the AC text itself is
stale), not a missing deliverable — flagged as a deviation row and as a recommended follow-up edit.

### gap-config-wiring-check-symlink-noop

**Fully confirmed, fixed correctly.** Both invocation paths now produce byte-identical output:
```
$ node experiments/quay-perpetual-stream/scripts/config-wiring-check.ts --driver both   # mirror (symlink)
$ node plugin/scripts/config-wiring-check.ts --driver both                              # real path
```
both exit 1 with the identical 8-field FAIL report (`diff` confirms, modulo a cosmetic PID in the
Node module-type warning line). Root cause fix: `isDirectInvocation()` now resolves both
`process.argv[1]` and `import.meta.url` through `fs.realpathSync` before comparing, instead of raw
string equality. `concurrent-batch-scheduler.ts` was checked and confirmed to have the identical
root cause and received the identical fix (same `isDirectInvocation()` helper, verified by
inspection). A real regression test exists and passes:
```
$ node --test experiments/quay-perpetual-stream/test/config-wiring-check.test.mjs
✔ config-wiring-check.ts: mirror-path invocation is real, not a silent no-op
✔ concurrent-batch-scheduler.ts: mirror-path invocation is real, not a silent no-op
tests 2, pass 2, fail 0
```
All 3 AC + 1 DoD item confirmed (with the same unpushed-commit caveat as DIR-070/110/111 noted for
"landed on master").

### gap-orphaned-check-scripts-not-wired

AC: all 4 confirmed —
- `delivery-manifest-check.ts`: wired (not manual-only) — `ci.yml` runs static mode on every push,
  `release.yml`'s new `delivery-manifest-verify` job runs `--ci` mode post-publish. Ran the static
  mode locally: `DELIVERY-MANIFEST-CHECK: OK`, exit 0.
- `restart-readiness-check.sh`: chose the explicit "manual-only" branch — script header now states
  "MANUAL-ONLY, NOT CI/LOOP-WIRED... explicit decision"; `CLAUDE.md`'s `.halt sentinel` bullet
  (lines 73-77) cites it with the same framing.
- `loop.yml`'s stale "INERT" comment on `routines:` corrected (lines 33-45) to describe it as now
  live via `run-routines.js`; `concurrency`/`stop`/`gates`/`policy` correctly reaffirmed as still
  inert. **Caveat (non-blocking, noted but not this task's stated scope):** the same file's header
  10 lines above ("stop: until(.halt) sentinel... at experiments/quay-perpetual-stream/.halt") was
  left uncorrected and is itself stale per `gap-halt-sentinel-path-mismatch`/M187 — a residual drift
  this task's AC did not ask it to reach.
- `gates.yml`/`config.yml` `it0.*` divergence: resolved (not just asserted) — diffed both files'
  `it0:` blocks directly, all 6 `script`/`argsKey` pairs are now identical.

DoD: 3 of 4 items backed by real doc diffs / local command output. The 4th
(`delivery-manifest-check.ts` CI-wiring) shares DIR-110's unpushed-commit caveat: the new
`delivery-manifest-verify` release.yml job and the ci.yml static-mode step both exist only in this
milestone's local Build commit; no CI run has exercised either yet.

### gap-workflow-name-dispatch-stale-script-cache

No `## Acceptance Criteria` section exists in this task (DoD-only) — flagged as an
authoring-convention gap for this one task, distinct from the other 6.

DoD: 2 of 3 items were already ticked with real evidence before this audit; independently
re-confirmed: `grep -n "Extension (M176" CLAUDE.md` hits at line 111, and the cited paragraph text
matches exactly. Item 3 (escalation to Claude Code support) is correctly left open as a human
decision, not self-closed.

---

## Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070 \
    experiments/quay-perpetual-stream/charters/M-DIR119-C-CANARY.md \
    /tmp/m-dir119-c-canary-absorb-entry.md
```
Result: **FAIL, exit 1.** All clauses PASS/N/A except `clause0-ac-dod-present`, which fails because
2 of DIR-070's 8 AC items remain genuinely unconfirmed (the loadbearing-test/anti-gaming gate
findings above) — this is real, not a template/bookkeeping artifact; before this audit's
write-back, the same clause failed with 8 unchecked items (nothing had been ticked yet).

`gate_resolve_milestone_root` (the single-sourced milestone-root-path function this charge
instructed be used) errors on the non-numeric milestone id `M-DIR119-C-CANARY` (`${_ms%%-*}` strips
everything after the leading `-` in `-DIR119-C-CANARY`, leaving an empty string, then
`$((10#$_ms))` throws `invalid integer constant`). Worked around by using the milestone directory
already present on disk, `milestones/M-DIR119-C-CANARY/` (confirmed to exist and contain
`iterations/iteration-0.md`) — flagged here as a real, reproducible tooling gap for a future pass,
out of scope to fix in an audit-only agent.

## V_meta consolidation-lag check

```
$ bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 188 \
    experiments/quay-perpetual-stream/v-meta-ledger.md
[ok] consolidated | lag=- | consolidated — lag gate does not apply | domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise)
[ok] proposed | lag=- | proposed — not past φ threshold, no lag gate | repo-root isolation-leak lesson
PASS: no confirmed-unconsolidated row past K without a dated carry-forward
```
(`--counter 188` = current `milestone_counter` (189) minus 1, per the charge.)

## Disposition & deviation-log write-back

- Disposition lines appended to `/tmp/m-dir119-c-canary-absorb-entry.md`: `adversarial-audit
  disposition: CONCERNS` and the verbatim `V_meta consolidation-lag` reason text above.
- 4 new deviation rows appended to `experiments/quay-perpetual-stream/dashboard.md`'s "Deviation
  rows" table, all `caught-by: machine`, `caught-at: M-DIR119-C-CANARY`, `status: open`, `age: 0`:
  1. DIR-070's loadbearing-test/anti-gaming zero-arg gate finding (detailed above).
  2. DIR-110/gap-orphaned-check-scripts-not-wired's shared "no real CI run yet" caveat.
  3. exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN's stale-AC-vs-narrowed-scope inconsistency.

No absorb dispositions, dashboard ABSORB-log entries, milestone counter, or lifecycle STATUS fields
were written by this audit for any of the 7 member tasks — all 7 remain `status: todo` on master,
as expected at this stage (Land's responsibility, not this audit's).

## Verdict

**CONCERNS.** Real, well-evidenced work across all 7 tasks; nothing fabricated or missing outright.
The two genuine gaps (DIR-070's 2 gate-CLI AC bullets; the "no real CI run yet" pending-push status
shared by DIR-110/gap-orphaned-check-scripts-not-wired) are disclosed in detail above, written back
into each task's own checklist with evidence citations, and logged as deviation rows for the record.
