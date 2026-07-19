# M31-cli-gate-enforcement — iteration-0 report

**Branch:** `exp5-m31-iteration-0` · **Worktree:**
`experiments/quay-perpetual-stream/milestones/M31-cli-gate-enforcement/worktrees/iteration-0` ·
**Base commit:** `95bb68013b225715686a587c278d41555ec79618` (`exp5-outer-driver` HEAD at dispatch time)

## HARD GATES (literal output)

### 1. Pending directives listing + disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md
```

**Disposition — DIR-017: deferred, unchanged.** Read the full file. It remains `status: pending`.
Its own "Human verification when exp5 marks this DIR done" section requires a human to confirm the
DoD meta-enforcer is actually *operative* (blocks a synthetic violating milestone), not merely
designed, before any further DIR-017 steps proceed — that human 6-point re-verification has not
happened. M23's own disposition note (quoted inside DIR-017 itself) already establishes that
DIR-017's scope is explicitly out of scope for unrelated milestones; M31 does not touch
`inherited-core.md`'s DoD section, does not attempt any of DIR-017's steps 0-3, and this iteration
confirms (re-verified directly, not assumed) that the file's `status:` field and its "NOT a
resolution" note are unchanged from what M30's ABSORB entry last recorded. Confirmed: still the
correct state, no new disposition needed beyond "deferred, still pending human re-verification."

### 2. manda hub healthz gate

**N/A for this CLI-only milestone.** M31's charter scope is entirely `packages/quay/bin/quay.js` +
its own test files — no manda dispatch, no hub interaction of any kind is exercised by this
iteration's work. Stated explicitly per the HARD GATES block's own instruction, not silently
omitted.

### 3. Port 4173 reachability gate

**N/A for this CLI-only milestone.** No Web UI surface is touched (charter's own "Explicitly OUT of
scope" section: MCP-tool-level equivalents and any Web UI surface are out of scope; this milestone
is Core-CLI-only). Stated explicitly, not silently omitted.

### 4. Worktree creation + isolation proof

```
$ git rev-parse exp5-outer-driver
95bb68013b225715686a587c278d41555ec79618

$ git worktree add experiments/quay-perpetual-stream/milestones/M31-cli-gate-enforcement/worktrees/iteration-0 -b exp5-m31-iteration-0 95bb68013b225715686a587c278d41555ec79618
Preparing worktree (new branch 'exp5-m31-iteration-0')
...
HEAD is now at 95bb680 SELECT m31: M31-cli-gate-enforcement — charter authored, DIR-scope decision made
```

Isolation proof (run from REPO ROOT, after all development/test work):

```
$ git -C /home/yale/work/quay status --short
(no output — clean)
```

Real repo-root `tasks/` directory confirmed untouched — md5sum of `/home/yale/work/quay/tasks/*.md`
taken before and after the full test run inside the worktree matched exactly
(`ca27f8e0522143412194fcd2834f9e0c` both times).

All development/test edits targeted paths under
`experiments/quay-perpetual-stream/milestones/M31-cli-gate-enforcement/worktrees/iteration-0/` only.

## What was built

`packages/quay/bin/quay.js`'s `task edit` handler gained an opt-in `--enforce-gate` flag, per the
charter's Decision section (option (b) + opt-in (c)-flavored escape hatch — default behavior
unchanged/unguarded, `--enforce-gate` opts into the same `task check` gate logic). Also updated
`--help` text and added an inline code comment explaining the design decision and citing the
charter.

### Implementation

- `enforceGate = flags["enforce-gate"] !== undefined` computed alongside `id` at handler entry.
- Inside the existing `withProvider(async (client) => { ... })` callback, before the
  `--append-notes` branch and the main `taskWrite` call: if `enforceGate && patch.status !==
  undefined`, call `client.taskCheck(id)` (the exact same passthrough `task check` itself calls —
  no new gate-evaluation logic written) and, if `result.ok === false`, print
  `` `quay task edit: --enforce-gate refused this write — gate check failed: ${gateResult.reason}` ``
  to stderr, set `process.exitCode = 1`, and `return` before any write occurs.
- This check sits ahead of BOTH the `--append-notes` read-then-write path and the main
  `patch.title`-guard path, so it applies uniformly regardless of which write path an edit
  ultimately takes.

## Done-when clauses — evidence

**1. `task edit <existing-id> --status <failing-transition> --enforce-gate` refuses (exit 1, no
write), with `result.reason` surfaced.**
Demonstrated live against a genuinely gate-failing fixture: a task in status `ready` with an
UNCHECKED AC checkbox (`store.js#check()`'s `status === "ready"` branch, execute->done gate,
`ok:false`, reason `"0/1 AC checkboxes checked"`). Test:
`packages/quay/test/gap-cli-gate-enforcement.test.mjs`, test 1
("RED->GREEN: task edit ... --enforce-gate refuses..."). Confirmed via direct CLI run: stderr
contained `quay task edit: --enforce-gate refused this write — gate check failed: 0/1 AC checkboxes
checked`; exit code non-zero; a follow-up `task view` confirmed status remained `ready` (no write).
**MET.**

**2. `task edit <existing-id> --status <passing-transition> --enforce-gate` succeeds identically to
today's unguarded write when the gate passes.**
Fixture: same shape, but AC checkbox checked (`ok:true`). Test 2 in the same file. Exit 0, JSON
output `{"status":"done",...}`, identical shape/exit-code to the unguarded path. **MET.**

**3. `task edit <existing-id> --status <x>` WITHOUT `--enforce-gate` behaves exactly as today
(unguarded) — zero regression.**
Demonstrated against the SAME gate-failing fixture shape as clause 1 (separate fixture instance,
same construction): without `--enforce-gate`, the write succeeds (exit 0, status written to
`done`), i.e. current behavior fully preserved. Test 3. **MET.**

**4. `--enforce-gate` combined with a non-`--status` patch is either (a) always-check-if-
status-affecting or (b) a documented no-op-without-status — pick one, implement, state which.**
**Implemented option (b): explicit no-op without `--status`.** The gate check is gated on
`patch.status !== undefined` — a `--labels`-only (or any other non-status-field) edit with
`--enforce-gate` performs zero gate check and proceeds unconditionally, even when the underlying
task would fail `task check`. Demonstrated: test 4 constructs a gate-failing fixture, edits only
`--labels` with `--enforce-gate` present, and confirms the write succeeds (labels written) despite
the gate being failing.
**Why (b), not (a):** the charter's own in-scope item 1 text explicitly permits either but leans
toward simplicity ("keep this simple and always check when `--enforce-gate` is present and the
write includes a `status` field") — reading this literally, "includes a status field" IS the
condition, which is exactly (b): check only fires on an explicit status-bearing patch. Considered
(a) (check for ANY status-affecting change, e.g. treat `--expect-status`-only edits or `--children`
changes that could cascade into a compound-gate rollup as status-affecting too) but rejected it:
`task check`'s own gate logic (`store.js#check()`) is keyed entirely off the task's CURRENT
`status` field read fresh from disk at check time, not off what fields the CURRENT edit's patch
happens to touch — a `--labels`-only edit does not change what `task check` would report before or
after, because `task check` re-reads the task's status from the store independent of this edit's
patch shape. The only patch field that can move the checked-gate's *effective* answer for THIS
edit is `patch.status` itself (the new value about to be written) — checking on any other field
would just re-run the identical `task check` result already knowable without the edit, adding cost
with no discriminating information. (b) is therefore not just simpler but the more correct reading
of what the gate is actually protecting: the moment of a status transition, which is precisely when
`patch.status !== undefined`.

**5. `--help` text documents both behaviors, verified by a test.**
Test: "--help documents both default-unguarded task edit status behavior and --enforce-gate"
(test 5) — asserts `--help` output contains `--enforce-gate` and matches `/unguard/i`. `--help`
text now states, verbatim: status transitions "are UNGUARDED by default — no gate check runs unless
--enforce-gate is passed, analogous to 'git commit --no-verify'" and documents `--enforce-gate`'s
own semantics (checks when `--status` is part of the patch; no-op otherwise; refuses with reason on
failure). **MET.**

**6. Inline code comment present at the `task edit` handler.**
Added directly above `const id = positional[0];` inside the `task edit` block — a block comment
explaining the unguarded-by-default decision, the `git commit --no-verify` analogy, that
`--enforce-gate` reuses `client.taskCheck(id)` (no duplicated logic), and an explicit citation to
`experiments/quay-perpetual-stream/charters/M31-cli-gate-enforcement.md` for the full reasoning, so
a future reader does not have to re-derive it. A second, shorter comment sits immediately above the
gate-check block itself inside `withProvider`, explaining the option-(b) no-op-without-status
choice inline at the point of use. **MET.**

**7. Skill-doc cross-reference check performed; staleness fixed or logged, not silently ignored.**
See "Skill-doc staleness check" section below. **Result: confirmed-already-accurate, no staleness
found, no edit made.** **MET.**

**8. Full test suite green before AND after; TDD RED→GREEN demonstrated.**
See "TDD transcript" and "Full test suite" sections below. **MET** (modulo two pre-existing,
network/live-GitHub-state-dependent flaky tests unrelated to this change, present identically in
the before-fix baseline run — see below for the specific transcript proving this).

**9. `git diff --stat` scoped only to `quay.js` + new/changed test files + this report; real
repo-root `tasks/` untouched.**
```
$ git diff --stat
 packages/quay/bin/quay.js | 45 ++++++++++++++++++++++++++++++++++++++++++++-
 1 file changed, 44 insertions(+), 1 deletion(-)
$ git status --short
M  packages/quay/bin/quay.js
A  packages/quay/test/gap-cli-gate-enforcement.test.mjs
```
Plus this report file itself, added separately (see commit). No other files touched. **MET** — see
also the HARD GATE 4 isolation proof above (`md5sum` match on real `tasks/`, clean `git -C
<repo-root> status --short`).

## TDD RED→GREEN transcript

**RED** (before implementation — `packages/quay/test/gap-cli-gate-enforcement.test.mjs` written
first, run against pre-fix `quay.js`):
```
✖ RED->GREEN: task edit <id> --status done --enforce-gate refuses when the execute->done gate fails, surfacing result.reason (1619.609022ms)
  AssertionError: expected non-zero exit refusing... got exit=0   (the unrecognized --enforce-gate
  flag was silently ignored by the flag parser; the write proceeded unconditionally, exactly the gap
  the charter describes)
✔ task edit <id> --status done --enforce-gate succeeds when the gate passes (identical to unguarded write)
✔ task edit <id> --status done WITHOUT --enforce-gate still writes unconditionally (zero regression to default/unguarded behavior)
✔ --enforce-gate with a non-status patch (--labels only) is a no-op guard: write proceeds even though the gate would fail
✖ --help documents both default-unguarded task edit status behavior and --enforce-gate
  AssertionError: --help output missing --enforce-gate flag
ℹ tests 5
ℹ pass 3
ℹ fail 2
```
(2 of 5 fail as expected — clauses 1 and 5's gap, confirmed RED. Clauses 2/3/4 "pass" trivially
pre-fix because they describe behavior that was already true by construction of the current
unguarded code path — not evidence the feature already existed, only that the negative-space
assertions for those specific clauses happened to hold before the flag was recognized at all.)

**GREEN** (after implementation, same test file, unchanged):
```
✔ RED->GREEN: task edit <id> --status done --enforce-gate refuses when the execute->done gate fails, surfacing result.reason (2502.694707ms)
✔ task edit <id> --status done --enforce-gate succeeds when the gate passes (identical to unguarded write) (1730.990225ms)
✔ task edit <id> --status done WITHOUT --enforce-gate still writes unconditionally (zero regression to default/unguarded behavior) (1604.109324ms)
✔ --enforce-gate with a non-status patch (--labels only) is a no-op guard: write proceeds even though the gate would fail (1660.820016ms)
✔ --help documents both default-unguarded task edit status behavior and --enforce-gate (344.983007ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

## Full test suite — before and after

**Before (baseline, pre-fix, full repo run inside the worktree):**
```
ℹ tests 48
ℹ pass 45
ℹ fail 3
✖ failing tests:
  packages/quay/test/cli-edit-parity-conformance.test.mjs
  packages/quay/test/provider-abi-conformance.test.mjs
  packages/quay/test/serve-github.test.mjs
```
Investigated individually: `serve-github.test.mjs` fails consistently (live github.com/yaleh/quay
state dependency — "GET / body contains the real GitHub-backed task id gh-3" fails because the
live repo's current issue list doesn't include that fixture id right now); `cli-edit-parity-
conformance.test.mjs` and `provider-abi-conformance.test.mjs` are flaky under full-suite parallel
load against the live GitHub API (rate-limiting/timing) but pass cleanly when re-run individually
(confirmed both, pre-fix). None of the three touch `task edit`'s status-transition path in a way
this charter's change affects — all failures are pre-existing, network/live-repo-state artifacts,
not caused by (or fixed by) this milestone's work.

**After (post-fix, full repo run inside the worktree, new test file included):**
```
ℹ tests 53
ℹ pass 51
ℹ fail 2
✖ failing tests:
  packages/quay/test/cli-edit-parity-conformance.test.mjs
  packages/quay/test/serve-github.test.mjs
```
Re-ran both individually post-fix: `cli-edit-parity-conformance.test.mjs` passes cleanly
standalone (flaky-under-load, confirmed both before and after); `serve-github.test.mjs` fails
identically both before and after (live-repo-state dependent, unrelated to `task edit`). The new
5-test file (`gap-cli-gate-enforcement.test.mjs`) is fully green, both standalone and as part of the
full suite run. Net: same pre-existing flake class, same root cause, present identically before and
after — no new failures introduced, no failures fixed or masked by this change.

## Skill-doc staleness check (in-scope item 4 / Done-when clause 7)

Read both live Skill definitions in full: `packages/quay-native/skills/author/SKILL.md` and
`packages/quay-native/skills/execute/SKILL.md` (the actual `quay:author`/`quay:execute` Skills —
distinct from the frozen historical snapshots under `.claude/skills/quay-native-methodology/
examples/quay-{author,execute}-SKILL.md`, which are provenance artifacts, not the live Skill
definitions). Searched for "gate" and "task check" (extensive "Gaps" sections in both files
reference gate mechanics).

**Finding: no staleness. Confirmed-already-accurate, no edit made.**

Both Skills' own documented Method sections already sequence `task check <id>` BEFORE
`task edit <id> --status ...` as two SEPARATE CLI calls, procedurally gated by the Skill's own
control flow (`case gate.ok of True -> {task edit --status ready; ...} | False -> NeedsHuman(...)`)
— i.e. these Skills never rely on `task edit` itself enforcing the gate; they already implement the
identical two-step check-then-write sequence `--enforce-gate` now mechanizes as a single flag, just
done manually across two commands rather than atomically. This was true before this milestone's fix
and remains true after — no change to Skill-documented behavior needed.

The one directly-relevant existing Gap entry (`quay:author`'s SKILL.md, "the gate is still both
contestant and judge for this class of claim (G3)") is about a DIFFERENT concern — checkbox-count
gameability (an author checking a box without independent verification the underlying claim is
true) — not about whether `task edit` itself enforces the gate mechanically. That gap is orthogonal
to and unaffected by this charter's scope (which only adds a new CALLER of the existing check, per
the charter's own explicit "Explicitly OUT of scope" — no change to `task check`'s own logic).
No claim in either Skill's Gaps section asserts or implies that `task edit` enforces (or fails to
enforce) its own gate at the CLI level — both were and remain silent on that specific question,
because they never depended on it; they always did their own explicit `task check` call first.
Nothing to fix, nothing newly stale.

## Disagreement / confirmation of the charter's Decision section

**Confirmation, no disagreement found.** Implementing the charter's chosen (b)+opt-in-(c) decision
surfaced no evidence that (a) hard-block-by-default or a pure-(c)-without-(b) would have been
better:

- The `--enforce-gate` no-op-without-status semantics (Done-when clause 4, option (b), reasoned
  above) turned out to be a genuinely CLEAN, non-arbitrary boundary once the actual gate logic was
  read directly (`store.js#check()` keys entirely off the task's on-disk `status`, not off the
  edit's patch shape) — this is independent confirmation the charter's own "keep this simple" steer
  was not just expedient but correctly matched to how the underlying gate actually works, not a
  coincidence.
- Both `quay:author`/`quay:execute`'s own documented Methods already implement the two-step
  check-then-write pattern this flag mechanizes, which is direct, pre-existing evidence supporting
  the charter's core premise: real callers (these two Skills) already treat `task edit` as the
  low-level unguarded primitive it is documented to be, and already build their own gate discipline
  ON TOP of it rather than depending on it — exactly the "git commit --no-verify" analogy the
  charter's Decision section uses. Had `task edit` silently enforced the gate all along, these
  Skills' own explicit `task check` calls would have been redundant; the fact that they are not
  redundant (they are the only enforcement currently happening) is itself evidence the charter's
  characterization of `task edit` as unguarded-by-design was accurate, not merely a defensible
  reading.
- No caller was found, in this iteration's own read of the codebase (Skills, MCP server, `serve.js`
  gate-check reuse at line ~941-942, other CLI paths), that assumes/depends on `task edit` itself
  enforcing the gate — consistent with the charter's own stated absence-of-evidence claim for
  hard-block-by-default's necessity.

This iteration brings the requested skepticism and finds the charter's reasoning holds up under
direct implementation, not merely under prose review — recorded per the Dispatcher notes' request,
not merely to comply with them.

## Artifacts

- `packages/quay/bin/quay.js` — `--enforce-gate` flag, updated `--help` text, inline decision
  comment.
- `packages/quay/test/gap-cli-gate-enforcement.test.mjs` — new TDD test file, 5 tests, all green.
- This report: `experiments/quay-perpetual-stream/milestones/M31-cli-gate-enforcement/
  report.iteration-0.md`.
