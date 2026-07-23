# M116 iteration-0 — adversarial acceptance audit

**Audit session id:** a917c9df98cf14e60
**Orchestrator session id:** 145cc0be-0e0e-4eb4-a1aa-9d47637114c0

**Note (orchestrator-authored, per inherited-core.md's Adversarial-audit role item 5):** the line
above was written by the ORCHESTRATOR, using the `Agent` tool's own returned dispatch id
(`a917c9df98cf14e60`), recorded in `/tmp/m116-dispatch-record.txt` at dispatch time — not
self-reported by the subagent. The write-back addendum below (tool-use-id
`toolu_0187yEgfkKEvXjxKpmonLEXC`) is a continuation of this same dispatched agent (resumed via
`SendMessage` to `a917c9df98cf14e60`), not a new independent dispatch.

**Auditor stance:** independent, fresh-context, REFUTE-FIRST. No prior context beyond the three named
sources plus what was needed to verify specific claims.

**Sources read:** charter (`charters/M116-ts-migration-p5-a.md`), iteration report
(`milestones/M116/iterations/iteration-0.md`), and the live task
(`exp5-M-TS-MIGRATION-P5-A`, fetched via `quay-native task get --json`).

**Environment note:** my assigned worktree's branch (`worktree-agent-a917c9df98cf14e60`) was parked
at an old commit (`acb68ca`, M113-era) — several milestones behind the commits under audit
(`3667b02`, `6f183ef`). Since `master` was already checked out in the main working copy and cannot
be checked out twice, I created a local branch `audit-m116-verify` pointed at `6f183ef` (current
`master` HEAD) inside my own worktree and ran all verification there. This is disclosed because it
means my worktree's starting `git log -1` did not match the commits under audit — the verification
below is against `6f183ef`, confirmed to be the real, current `master` tip.

## Claim-by-claim re-verification (executed independently, not trusted from the report)

### 1. Four files are `.ts`, old `.js` gone, `git log --follow` shows continuity — CONFIRMED

```
packages/quay-native/bin/quay-native.ts  exists
packages/quay-github/bin/quay-github.ts  exists
packages/quay/bin/quay.ts                exists
packages/quay-backlog/bin/quay-backlog.ts exists
(all four corresponding .js paths: No such file or directory)
```

`git log --follow --oneline` on each of the four `.ts` paths returns `3667b02` at the top followed by
that file's pre-migration history (e.g. `quay-native.ts` → `17d9b9c`, `ac89940`, `93566f0`, …) — rename
continuity holds for all 4.

### 2. `tsc --noEmit` per-package, all exit 0 — CONFIRMED

Ran `npx tsc --noEmit -p .` inside each of the four package directories independently (not the
report's own for-loop transcript): `quay-backlog` exit=0, `quay-github` exit=0, `quay-native` exit=0,
`quay` exit=0. Matches AC2 exactly.

### 3. Full non-flaky suite, 354/354 — CONFIRMED

Ran `node --test` over the same 42-file set (`ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance'`)
myself: `tests 354 / pass 354 / fail 0 / cancelled 0 / skipped 0`. Zero `not ok` lines in the raw log.
Matches AC3 exactly.

### 4. Experiment-layer suite, 343/343 — CONFIRMED

Ran `node --test experiments/quay-perpetual-stream/test/*.mjs` (18 files) myself:
`tests 343 / pass 343 / fail 0`. Matches the report's informational second block exactly.

### 5. Golden-diff behavior-preservation, `quay` and `quay-native` — CONFIRMED, and stronger than the report states

I extracted `git show 3667b02~1:<path>` for both files myself. Byte-for-byte `diff` against the
current `.ts` file returns **exit 0 — the files are 100% identical**, not merely equivalent. This is
also visible directly in `git show --stat 3667b02`: both renames show `{quay.js => quay.ts} | 0` and
`{quay-native.js => quay-native.ts} | 0` — zero insertions, zero deletions. (`quay-github` and
`quay-backlog` show `| 1 +` in the stat, consistent with the report's note of a one-line change.)

I additionally ran both old and new files directly with `--help`:
- `quay.ts` (new) vs. reconstructed `quay.js` (old, placed back in `bin/`): both exit 0, byte-identical
  stdout+stderr.
- `quay-native.ts` (new) vs. reconstructed `quay-native.js` (old): both exit 1, byte-identical
  stdout+stderr.

Matches AC1's claim for these two entrypoints exactly (I did not re-run the `quay-github`/
`quay-backlog` golden-diff myself, per the audit's own scope instruction to check "at least" `quay`
and `quay-native`; the report's stated diff for those two — DIR/exit values — is internally
consistent with the `git show --stat` line counts and I have no reason from the diffs I did run to
doubt it).

### 6. SEA-shim exemption — CONFIRMED as narrated in charter/report, but see Finding 1 below for where it's *not* recorded

`packages/quay-native/scripts/manifest.sea-shim.js` and `packages/quay/scripts/version-sea-shim.js`
are both still present as `.js` on the current tree. My own `find packages -name '*.js' | grep -v /test/`
returns exactly the same 5-file set the report pastes (2 exempt shims + 3 `quay-backlog/src/*.js`
files correctly attributed to P5-B, not this milestone). No silent omission of the shims from the
scan.

### 7. Scope check on the landed commits — CONFIRMED, no undisclosed scope creep

`git show --stat 3667b02` (69 files) matches the charter's own "Also folded into this milestone's
landed commit" disclosure line-for-line: the 4 bin renames, package.json/config/provider.yml/
esbuild-sea.mjs/`.mcp.json` updates, test-helper path updates, and the named task-bookkeeping files
(`PROBE-M98-001.md`, `exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH.md`,
`exp5-DEFECT-M114-TESTSUITE-DRIFT.md`, `exp5-M-ARCH-AUDIT-M98-EXPLORE.md`,
`exp5-M-TS-MIGRATION-P5-B.md`, and the two new defect files). Nothing outside that disclosed list.
`git show --stat 6f183ef` (DIR-059, the adjacent commit) is likewise consistent with its own commit
message's description (per-package `tsconfig.json`×4, `package.json`/`package-lock.json` zod
`overrides`, the named test fixes, two new test files). No hidden scope creep found in either commit.

## Finding 1 (REFUTED claim) — the task's own record contradicts "All 4 AC + 3 DoD items independently re-verified true"

The iteration report's closing line is:

> DONE. All 4 AC + 3 DoD items independently re-verified true with fresh evidence pasted above, this
> same ABSORB.

This is not true for **AC4** and **DoD clause 2**, checked against their own literal wording, against
the actual current state of the task object:

- AC4 (task body, unchanged since task creation): *"The 2 SEA shims are explicitly named as
  out-of-scope in this task's Resolution (not silently ignored)."*
- DoD clause 2: *"`tsc --noEmit` + full suite pasted as evidence in the Resolution."*

I fetched the live task (`quay-native task get exp5-M-TS-MIGRATION-P5-A --json`) and re-read it
directly off `master` HEAD (`6f183ef`) in my worktree. The task:

- has **`status: todo`** — not `done`, not even `ready`. It was never moved through the lifecycle.
- has **no `## Resolution` section at all**, and no evidence pasted anywhere in its body (`grep -in
  "resolution"` inside the task file matches only the two AC/DoD checklist lines quoting the word,
  not an actual heading).
- has **every AC and DoD checkbox still unchecked (`[ ]`)** — none were ever flipped to `[x]`.
- The only byte the landing commit (`3667b02`) touched in this task file was adding the
  `milestone:M-116` label (confirmed via `git show 3667b02 -- tasks/exp5-M-TS-MIGRATION-P5-A.md` —
  a 1-line diff, label-only).

This is a real gap, not a technicality invented by re-reading strictly: I checked three sibling
TS-migration tasks for precedent (`exp5-M-TS-MIGRATION-P1.md`, `-P3-B-3.md`, `-P4.md`). Both `P1` and
`P3-B-3` are `status: done` with every AC/DoD box checked `[x]` and a written record (`P1` uses a
"Human verification…" + "Execution record" pair; `P3-B-3`'s "## Execution record" section names the
milestone, worktree branch, implementation commit, **audit session id, audit verdict, and outcome**
explicitly). `exp5-M-TS-MIGRATION-P5-A` has none of this. By the repo's own established convention —
and by CLAUDE.md's explicit "single source of truth… when you find content living in two places…
that is drift — fix the SOURCE" principle, and DIR-026 Reading A's "done = a real object actually
operated through the mechanism" bar — the *canonical* record (the task) does not yet say this
milestone is done, and none of the AC/DoD checklist items live in the one place (the task's own
Resolution) that AC4/DoD-2 require them to live in.

To be fair to the charter: it explicitly discloses this gap exists — "This charter, and the ABSORB
steps that follow it, complete that bookkeeping… task write-back" is listed as a step that follows the
charter, and the iteration report's own opening note admits "the prior session's turn ended before
the ABSORB bookkeeping… was performed." So this is not a hidden defect; it is a disclosed, pending
step. But that disclosure does not rescue the report's own closing sentence, which asserts an
unqualified "All 4 AC + 3 DoD items independently re-verified true" — that sentence is false as
measured against AC4 and DoD-2's own text, right now, on the object those criteria name (the task).
"Independently re-verified true" should mean I can go find the artifact the criterion names and see
it; for these two criteria, I went and looked, and it is not there.

**Net effect of this finding:** the underlying migration work is real and I could not break it (see
below) — but the milestone is not, as of this audit, actually closed out per its own AC/DoD text, and
the report overstates the state of two specific criteria rather than flagging them as "verified
in-substance, write-back still pending."

## Findings summary

- **Finding 1 (above):** REFUTED — "All 4 AC + 3 DoD items independently re-verified true" is false
  for AC4 and DoD-2 as literally worded (require content "in this task's Resolution"); the task has
  no Resolution section, remains `status: todo`, and has zero checked boxes, unlike every completed
  sibling TS-migration task checked for precedent.
- Everything else I attempted to break — file renames + `git log --follow` continuity, per-package
  `tsc --noEmit` exit codes, the 354/354 and 343/343 suite counts, the `quay`/`quay-native`
  golden-diff (byte-identical, stronger than "identical output" — the files are literally the same
  bytes), the SEA-shim exemption and JS-elimination scope scan, and the commit-stat scope check for
  both `3667b02` and `6f183ef` — held up exactly as claimed when I re-ran them independently, with no
  narrower or looser result than what the report pasted.

## Verdict (superseded — see Addendum below)

**REFUTED** (as originally filed, against `master` HEAD `6f183ef`).

Specific claim refuted: the iteration report's closing "Recommendation: DONE. All 4 AC + 3 DoD items
independently re-verified true" (`milestones/M116/iterations/iteration-0.md`, final section). AC4
("...explicitly named as out-of-scope in **this task's Resolution**...") and DoD clause 2
("`tsc --noEmit` + full suite pasted as evidence **in the Resolution**...") are not satisfied: the
live task `exp5-M-TS-MIGRATION-P5-A` (verified via `quay-native task get --json` and by reading the
raw file at current `master` HEAD `6f183ef`) has no `## Resolution` section, remains `status: todo`,
and has every AC/DoD checkbox still unchecked — a materially different state from every completed
sibling TS-migration task I checked for precedent. The underlying technical migration (4 files
renamed, `tsc --noEmit` clean ×4, 354/354 + 343/343 suites, byte-identical golden-diff for `quay` and
`quay-native`, correctly-scoped SEA-shim exemption, no undisclosed scope creep in either landed
commit) is real and I could not find fault with any of it on independent re-execution — the refutation
is specifically about the closing "all criteria verified" claim outrunning the actual state of the
task record the criteria point to.

## Addendum — write-back performed, verdict corrected

Per DIR-020 discipline ("the audit WRITES BACK to the task file directly ... The audit is the ONLY
writer that ticks boxes"), the write-back this Finding 1 called for has now been performed by this
same audit, directly against the **main repo working tree** at
`/home/yale/work/quay/tasks/exp5-M-TS-MIGRATION-P5-A.md` on `master` (HEAD `5c8f866` at write-back
time — one commit ahead of the `6f183ef` this audit originally ran against; the intervening commit
only added the task's `extra.acceptance` field, no bookkeeping race). Before writing, every AC/DoD
item was **re-executed a second time, independently, against the current tree** (not copied from
either the iteration-0 report or this audit's own first pass):

- Confirmed all 4 `bin/*.ts` files present, no `.js` remaining, via `ls`.
- Confirmed `git log --follow --oneline` on each of the 4 `.ts` paths shows `3667b02` at the top with
  continuous pre-migration history for all 4.
- Re-ran `npx tsc --noEmit -p .` inside all 4 package directories myself: exit 0 ×4.
- Re-ran the full non-flaky suite (`packages/quay`, the 42-file grep-excluded set): 354/354 pass.
- Re-ran the experiment-layer suite: 343/343 pass.
- Re-extracted `git show 3667b02~1:<path>` for all 4 files (not just the 2 checked the first time) and
  diffed against current: `quay.ts`/`quay-native.ts` byte-identical (diff exit 0); `quay-github.ts`/
  `quay-backlog.ts` differ by exactly one added `// @ts-nocheck` comment line each (confirmed this
  time, where the first pass had only inferred it from the `git show --stat` line count without
  reading the actual diff).
- Ran all 4 new `.ts` entrypoints directly with `--help`, recorded exit codes/output.
- Re-ran `find packages -name '*.js' | grep -v /test/`: same 5-file result (2 SEA shims + 3
  `quay-backlog/src/*.js`, correctly out of this task's scope).

All 4 AC and all 3 DoD items check out true against this second, independent re-execution. The task
file was then edited directly (not via a script, not via MCP in this pass — plain `Edit` tool against
the absolute path above): all 7 checkboxes flipped `[ ]` → `[x]`, `status: todo` → `status: done`, and
a `## Resolution` section appended (after DoD, before the pre-existing "Not selected (M115)" note)
citing this second re-execution's own evidence per item. `git status --short` in the main tree
confirms the edit landed on `tasks/exp5-M-TS-MIGRATION-P5-A.md` while `git rev-parse --abbrev-ref HEAD`
confirms it was made on `master`, not this audit's own worktree branch.

This resolves Finding 1 exactly as scoped: the finding was never about the underlying migration work
(which held up under adversarial re-execution both times) — it was that the task's own canonical
record didn't yet say so. It now does, with fresh, personally-re-executed evidence, not a copy of the
iteration-0 report's numbers.

## Final verdict

**NO REFUTATION FOUND.**

The original Finding 1 gap (missing Resolution, `status: todo`, unchecked boxes) has been corrected by
this audit's own write-back, performed against the main repo tree per DIR-020 ("the audit is the ONLY
writer that ticks boxes"), backed by a second independent re-execution of all 4 AC + 3 DoD items (not
a copy of prior numbers). Nothing else attempted to break in the original pass (file renames,
`tsc --noEmit`, suite counts, golden-diff, SEA-shim scope, commit-stat scope check) turned up a defect
on re-verification either. The milestone's technical claim and its bookkeeping now both hold.
