# M125 iteration-0 — adversarial audit (DIR-062-A)

Audit session id: PLACEHOLDER-ORCHESTRATOR-FILLS-IN

**Auditor role:** fresh-context, out-of-band subagent per `inherited-core.md`'s Clause 1
(per-milestone acceptance audit) and the "Adversarial-audit role" section. Charged to REFUTE, not
re-confirm. Read only: the M125 charter, `milestones/M125/iterations/iteration-0.md`, `tasks/DIR-062-A.md`,
`inherited-core.md` (the two named sections), the two new scripts + their sibling tests, and
`drivable-workspaces.yml`.

## Verdict: **NO REFUTATION FOUND**

Every Done-when claim in `iteration-0.md` was independently re-derived from a real command, not
taken on the implementer's word, and every one checked out. Attempts to actively break the two
scripts (mutation testing per the audit brief's instruction (a)) were caught by the existing test
suite both times. One narrative miscount was found (non-blocking, see Concerns).

## What I tried to break, and what happened

### (a) Mutation testing — does the test suite actually distinguish correct from broken?

I edited the two script files in-place (in this worktree only — restored byte-identical afterward,
confirmed via `diff` against a pre-edit backup and `git diff --stat` showing no residual change) and
re-ran the sibling test suites:

1. **`isUnder()` mutation** (`drivable-workspace-check.ts`): changed
   `resolvedTarget.startsWith(resolvedBase + path.sep)` → `resolvedTarget.startsWith(resolvedBase)`
   (removes the trailing-separator guard, reintroducing the exact "look-alike prefix" bug the
   script's own comments say it defends against, e.g. `/home/yale/work2/evil` would then
   false-positive as covered by `/home/yale/work`). Result: **3 tests failed**
   (`isCovered: string-prefix look-alike (not a real path ancestor) -> false`,
   `selftest(): all embedded RED+GREEN fixture cases pass`, `CLI: --selftest -> exit 0`) — the exact
   test named in the audit brief's edge-case list caught it immediately, not a tautological pass.
2. **`classify()` mutation** (`human-steered-classify.ts`): changed the verdict formula from
   `driverFileEdit || missionRedirection || unauthorizedWorkspace` to the same three terms ANDed
   together. Result: **10/23 tests failed** — every single-clause GREEN case (driver-file-edit
   alone, mission-redirection alone, unauthorized-workspace alone) broke, exactly as expected for a
   genuine OR→AND regression.

Both mutations were caught hard, not by a shared-substring coincidence — each failing assertion
targets the specific behavior the mutation broke. This is the opposite of the M124-audit pattern
(tautological substring assertion); these tests distinguish real from broken.

### (b) `isCovered` path-matching edge cases

Verified directly (both by reading the code and by exercising `isCovered`/the CLI):
- **Exact match to `authorized_root` itself**: `isUnder` returns true on `resolvedTarget ===
  resolvedBase` — covered. Confirmed by the sibling test `isCovered: exact authorized_root match ->
  true`.
- **Trailing-slash inconsistency**: both target and base go through `path.resolve()`, which
  normalizes trailing slashes away before comparison — a registry `authorized_root` written with or
  without a trailing slash resolves identically. No test explicitly names this, but it follows
  directly from `path.resolve()`'s documented behavior and I confirmed it live:
  `path.resolve("/home/yale/work/")` === `path.resolve("/home/yale/work")` in a `node -e` check.
- **String-prefix look-alike** (`/home/yale/work2/evil` vs `authorized_root: /home/yale/work`):
  explicitly tested (`isCovered: string-prefix look-alike ... -> false`) and confirmed correctly
  rejected — this is the exact case the mutation in (a)#1 broke.
- **Relative vs absolute paths**: `path.resolve()` resolves relative paths against `process.cwd()`;
  since both target and base go through the same resolution, this is internally consistent, though
  it does mean a relative target path's coverage depends on the CWD the gate is invoked from — a
  real but minor operational gotcha (not exercised in tests), noted as a Concern below.
- **Case-sensitivity**: not applicable in a meaningful way — Linux paths are case-sensitive by
  filesystem convention and neither the registry nor real workspace paths in this repo use mixed
  case; not a live risk.
- **Symlinks**: `isCovered`/`isUnder` do **not** call `fs.realpathSync` — coverage is purely lexical.
  A symlink physically located under `authorized_root` that resolves to a target OUTSIDE the
  registry (e.g. `/home/yale/work/evil-symlink -> /tmp/x`) would be treated as covered by the
  `authorized_root` rule even though the real target isn't. This is a genuine gap relative to a
  "true" filesystem-authorization check, but it is consistent with the script's own stated contract
  (path-string coverage against the registry, not filesystem-identity verification) and no AC/DoD
  clause claims symlink-safety. Recorded as a Concern, not a refutation.
- **Windows-style paths**: N/A on this Linux host, as the brief itself anticipated; `path.sep` is
  POSIX `/` throughout.

### (c) `touchesDriverFile` false-positive/negative edge cases

- **`foo/OUTER-LOOP.md.bak`**: `path.basename()` of this is `OUTER-LOOP.md.bak`, not in
  `DRIVER_FILE_BASENAMES` (`{"OUTER-LOOP.md", "inherited-core.md"}`) — correctly NOT flagged. Verified
  by direct reasoning against the exact-match `Set.has()` semantics (no substring/prefix match on
  basename).
- **`foo/not-OUTER-LOOP.md`**: basename `not-OUTER-LOOP.md` ≠ `OUTER-LOOP.md` — correctly NOT flagged.
  This is essentially the same shape as the sibling test `similar-name-not-driver-file`
  (`OUTER-LOOP-notes-draft.md`), which is explicitly tested and passes.
- **`.claude/skills/` as a substring inside an unrelated segment**, e.g. `my.claude/skills-backup/`:
  traced the logic by hand — `DRIVER_PATH_SEGMENT` requires the literal substring `/.claude/skills/`
  (separator-bounded on both sides) and `DRIVER_PATH_PREFIX` requires the string to *start with*
  `.claude/skills/`. `my.claude/skills-backup/` contains neither: there's no separator immediately
  before `.claude` (it's glued to `my`), and it doesn't start with `.claude/skills/`, and even if it
  did, `skills-backup` ≠ `skills` followed by a separator. Correctly NOT flagged. This is a genuine,
  correctly-guarded edge case, not merely an untested one.
- **Case sensitivity**: `path.basename()` comparison via `Set.has()` is case-sensitive; a
  hypothetically-renamed `outer-loop.md` would not match. Not a live risk (the real files are
  `OUTER-LOOP.md`/`inherited-core.md` exactly), same class of non-issue as (b)'s case-sensitivity
  point.

### (d) Test counts and coverage — independently re-run, not re-quoted

| Claim | Re-run result | Match? |
|---|---|---|
| `node --test` on both test files → 49/49 pass | `tests 49 / pass 49 / fail 0` | ✅ exact |
| `drivable-workspace-check.ts` coverage 97.86%/93.02%/100% | `97.86 \| 93.02 \| 100.00` | ✅ exact |
| `human-steered-classify.ts` coverage 94.55%/85.71%/100% | `94.55 \| 85.71 \| 100.00` | ✅ exact |
| `loadbearing-test-gate.sh` → 31 total, 8 pass, 23 N/A, 0 fail | same | ✅ exact |
| `it0-split-or-commit-check.ts .` → 368 tasks, no violations | same | ✅ exact |
| Full experiments suite 525/525 | `tests 525 / pass 525 / fail 0` (34 test files, 6 suites) | ✅ exact |

All six headline numbers reproduce byte-for-byte. See Concerns for a sub-count discrepancy that does
**not** affect any of the above.

### (e) `quay gate --list` / real GateEvent claims

Ran independently against the real workspace (this worktree, checked out at the landing commit
`ecc7344`):

```
$ node packages/quay/bin/quay.ts gate --list | grep -i drivable
drivable-workspace
```

```
$ node packages/quay/bin/quay.ts task edit QC-T1 --extra '{"drivableWorkspaceArgs":["/home/yale/work/archguard"]}'
$ node packages/quay/bin/quay.ts gate QC-T1 --gate drivable-workspace
PASS
$ echo $?
0
```

```
$ node packages/quay/bin/quay.ts task edit QC-T1 --extra '{"drivableWorkspaceArgs":["/tmp/unlisted-x"]}'
$ node packages/quay/bin/quay.ts gate QC-T1 --gate drivable-workspace
FAIL — acceptance failed (exit 1)
$ echo $?
1
```

Confirmed real GateEvents were appended to `.quay/gate-events.jsonl` (not just process exit codes):

```
{"item_id":"QC-T1", ..., "gate":"drivable-workspace", ..., "verdict":"pass", ..., "payload":{"reason":"acceptance passed (exit 0)"}}
{"item_id":"QC-T1", ..., "gate":"drivable-workspace", ..., "verdict":"fail", ..., "payload":{"reason":"acceptance failed (exit 1)"}}
```

**Cleanup performed**: `task edit QC-T1 --extra '{}'` afterward. Confirmed via `cat tasks/QC-T1.md` —
`extra: {}` restored, matching exactly the state of `QC-T1.md` at the landing commit `ecc7344`
(verified via `git diff` showing no residual change to the file). No test residue left behind.

### (f) FILE-ONLY / no-driver-file-touched claim

```
$ git show --stat ecc7344
```
13 files changed: `.quay/config.yml`, `.quay/gates.yml`, `experiments/quay-perpetual-stream/backlog.md`,
the M125 charter, `milestones/M125/iterations/iteration-0.md`, `drivable-workspace-check.sh`,
`drivable-workspace-check.ts`, `human-steered-classify.ts`, the two new test files,
`tasks/DIR-062-A.md`, `tasks/DIR-063-A.md`, `tasks/QC-T1.md`.

```
$ git show --stat ecc7344 | grep -iE "OUTER-LOOP|inherited-core|\.claude/skills"
```
→ **no output** — confirmed zero driver-file lines in this commit's diff. FILE-ONLY claim holds.

(Note: `tasks/QC-T1.md`'s 1-line change in the landing commit is the `extra: {}` frontmatter field
being added — the *result* of the end-to-end gate test's cleanup being committed as part of the
milestone, not test residue. `tasks/DIR-063-A.md`'s change is an unrelated "Not selected (M125)"
backlog-disposition note, consistent with normal SELECT bookkeeping, not a driver-file touch.)

### (g) `.quay/gates.yml` / `.quay/config.yml` consistency

```
$ grep -n -A2 "name: drivable-workspace" .quay/gates.yml .quay/config.yml
.quay/gates.yml:76:  - name: drivable-workspace
.quay/gates.yml:77:    script: "./experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh"
.quay/gates.yml:78:    argsKey: drivableWorkspaceArgs
.quay/config.yml:45:    - name: drivable-workspace
.quay/config.yml:46:      script: "./experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh"
.quay/config.yml:47:      argsKey: drivableWorkspaceArgs
```
`argsKey: drivableWorkspaceArgs` is identical in both files and matches exactly the `extra` key
(`drivableWorkspaceArgs`) used in the live `quay task edit ... --extra` calls in (e) above, which
worked — this is not merely textually consistent, it is functionally proven consistent (the gate
actually read the args key and evaluated the right paths).

## AC / DoD checklist write-back

Per Clause 1's write-back duty, ticked `- [x]` on `tasks/DIR-062-A.md` via `task_write` for every
item independently confirmed above:
- **AC 1-5**: all ticked — each has a specific independent re-run in this report (AC1 → (e); AC2 →
  the mutation-tested `classify()` + its passing test suite; AC3 → (d); AC4 → (g) + (e)'s live
  `gate --list`; AC5 → (d)).
- **DoD 1** (load-bearing + tests + `loadbearing-test-gate.sh`): ticked, evidence in (d).
- **DoD 2** (it0 DoD meta-enforcer passes all clauses): **left unticked**, per explicit instruction
  — see the mechanical-gate section below.
- **DoD 3** (no driver file touched): ticked, evidence in (f).

## Mechanical gate: `it0-dod-check.sh` run against `iteration-0.md` as ABSORB-entry stand-in

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-062-A \
    experiments/quay-perpetual-stream/charters/M125-dir062-a-drivable-workspace-gate.md \
    experiments/quay-perpetual-stream/milestones/M125/iterations/iteration-0.md
ERROR: absorb-entry-file has no "## Backlog row" section (required to run the impl-row clause against a synthetic milestone)
$ echo $?
2
```

This is **exactly the expected failure mode** the dispatch prompt named: Clause 4 (design-only-
milestone impl-row gate, reused from `it0-impl-row-check.sh`) unconditionally requires a `##
Backlog row` section in the absorb-entry text to materialize a synthetic backlog file — regardless
of whether the milestone is actually design-only — and `iteration-0.md` (a milestone report, not a
real ABSORB-log excerpt) never had one. This is a structural artifact of using iteration-0.md as a
stand-in, not a genuine DIR-062-A defect.

**Important honesty note on scope of this result**: I read `it0-dod-check.ts`'s source and confirmed
Clauses 0-3 execute, in-process, strictly *before* Clause 4's block (top-to-bottom function body, no
early return) — so nothing in Clauses 0-3 threw its own `DodCheckEnvError` before reaching Clause 4
(had one done so, we'd see a *different* error message). However, the script only prints its
per-clause PASS/FAIL/N/A summary at the very end of `runDodCheck()`, and the Clause-4 throw
propagates out and aborts the whole run before that summary is ever built or printed — so **stdout
was genuinely empty** (confirmed: captured stdout separately from stderr, stdout was 0 bytes). I
cannot honestly claim "Clauses 0-3 pass" from this run's printed output — only that they didn't
independently error out with their own message first. Verifying Clauses 0-3's actual dispositions
requires either (a) a real absorb-entry with a `## Backlog row` section, or (b) a dedicated fixture
run isolating those clauses — neither of which this stand-in run provides. This is consistent with
the dispatch instructions ("report which clauses genuinely evaluate cleanly regardless" — the honest
answer is: none of them printed a verdict in this run; the run's only observable fact is that it
reaches Clause 4 without an earlier crash).

DoD item 2 left **unticked** per the dispatch instructions, pending the orchestrator writing the
real absorb-entry and re-running for a final confirmation pass.

## Concerns (non-blocking)

1. **Narrative sub-count mismatch (cosmetic, not evidentiary)**: `iteration-0.md`'s "What was done"
   section states the 49 tests break down as "28 tests" (`drivable-workspace-check.test.mjs`) + "21
   tests" (`human-steered-classify.test.mjs`). Independently counting, the actual split is **26 +
   23 = 49**. The combined total (49/49 pass) and every coverage/count figure that matters for the
   AC/DoD is exact and independently reproduced (see (d) above) — only the prose sub-breakdown in
   one summary sentence is off. Non-blocking; does not affect any AC/DoD clause, which only cites
   the combined 49/49 figure.
2. **Symlink-unawareness in `isCovered`** (see (b) above): lexical-only path coverage, no
   `fs.realpathSync`. Not a violation of any stated contract (the script's own header describes
   path-string coverage against the registry, not filesystem-identity verification) but worth
   flagging as a hardening opportunity if this gate is ever relied on for a stronger security
   guarantee than "declared path prefix membership."
3. **CWD-relative path resolution**: `isCovered`/`isUnder` resolve relative target paths against
   `process.cwd()` via `path.resolve()`. A `--workspace ./somewhere` argument's coverage verdict
   would silently depend on the invoking shell's CWD. Not exercised by any test, not a documented
   contract violation (nothing claims absolute-only or CWD-independence), but a plausible footgun
   for a future caller of the CLI who doesn't pass absolute paths.

None of these concerns rise to REFUTED — they are hardening notes, not claim failures.

## Commands run (for reproducibility)

All commands were run directly in this audit worktree (`ecc7344` checked out), never against
`master`, and all file mutations used for mutation-testing were reverted and verified clean via
`diff`/`git diff --stat` before this report was written. `tasks/QC-T1.md`'s test-scratch state was
restored to `extra: {}` via `task_write` before this report was written, matching the file's
committed state exactly.

## Second-pass addendum — DoD-2 confirmation (post-real-ABSORB-entry)

The orchestrator subsequently (a) corrected `iteration-0.md`'s test-count breakdown ("28+21" →
"26+23", with an explicit correction note citing this audit), and (b) wrote the real ABSORB-entry to
`/tmp/m125-absorb-entry.md` and reported `it0-dod-check.sh` PASS (12/12 clauses) + a real `quay gate
DIR-062-A` PASS GateEvent.

Per instruction, I did **not** trust the paste — I independently re-ran both commands myself from the
**shared checkout** (`/home/yale/work/quay`, not this isolated audit worktree):

```
$ cd /home/yale/work/quay
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-062-A \
    experiments/quay-perpetual-stream/charters/M125-dir062-a-drivable-workspace-gate.md \
    /tmp/m125-absorb-entry.md
PASS: clause0-ac-dod-present ... PASS: clause1-adversarial-audit ... PASS: clause2-vmeta-lag ...
PASS: clause3-line-budget ... PASS: clause4-impl-row ... PASS: clause5-no-self-exemption ...
PASS: clause6-escrow-delta-v ... PASS: clause7-test-floor ... PASS: clause8-task-canonical-lifecycle-record ...
PASS: clause10-tree-hygiene ... PASS: clause11-worktree-branch-hygiene ... PASS: clause12-audit-independence ...
N/A: clause9-split-or-commit ...
PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
$ echo $?
0
```

```
$ node packages/quay/bin/quay.ts gate DIR-062-A
PASS
$ echo $?
0
```

Confirmed the real GateEvent in `.quay/gate-events.jsonl` (shared checkout, not the worktree's own
copy): `{"item_id":"DIR-062-A", ..., "gate":"acceptance", "verdict":"pass",
"timestamp":"2026-07-23T11:38:09.598Z", ...}` — timestamp matches the orchestrator's paste exactly.
(My own re-run of `quay gate DIR-062-A` appended a *second* corroborating pass event at
`11:38:38.553Z` — not a substitute for the original, additional independent confirmation the
mechanism is real and repeatable.)

Also independently re-verified the corrected test-count breakdown by re-running each test file
separately in the shared checkout: `drivable-workspace-check.test.mjs` → 26/26 pass;
`human-steered-classify.test.mjs` → 23/23 pass. Matches `iteration-0.md`'s corrected "26+23" note
exactly (which itself matches this audit's own first-pass finding).

**All second-pass claims confirmed independently — none taken on trust.** Ticked the final DoD-2 box
(`- [x] it0 DoD meta-enforcer passes all clauses.`) on `tasks/DIR-062-A.md` via `task_write`, citing
this second-pass evidence directly in the tick's adjacent text. Task `status` field was **not**
touched (left at `todo`, per instruction — status transitions are the orchestrator's/loop's own
step, not this audit's). All 5 AC items and all 3 DoD items are now `- [x]` on the task.

**Updated overall verdict: still NO REFUTATION FOUND.** Nothing in this second pass changed the
first-pass verdict; it closes the one item (DoD-2) that was legitimately deferred pending the real
ABSORB-entry, and the deferral itself is now resolved cleanly.
