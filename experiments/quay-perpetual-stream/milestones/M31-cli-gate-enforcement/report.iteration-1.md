# Report — M31-cli-gate-enforcement — iteration-1

**Independence statement:** this iteration did NOT read iteration-0's worktree, branch, or report at
any point. Everything below was independently re-derived from the charter
(`experiments/quay-perpetual-stream/charters/M31-cli-gate-enforcement.md`) and direct source
investigation only.

## HARD GATES (literal output)

### 1. Pending directives

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md
```

Exactly one file, as expected. Disposition (my own, independently reasoned): **deferred-with-reason,
not applicable to this milestone's scope.** DIR-017 is the "install a global Definition-of-Done
program, self-host the record, build a standing meta-enforcer" directive — a governance/methodology
program targeting `inherited-core.md`/outer-loop mechanics. M31 is a narrow CLI implementation
charter (`task edit --enforce-gate`). Nothing in DIR-017's Requested Action names or implies CLI-gate
work. The charter's own text confirms this reading explicitly: "DIR-017 status: unchanged this
milestone (still pending human 6-point re-verification, per m30's ABSORB entry) — restate at DRAIN, do
not silently drop." I restate it here per that instruction: DIR-017 remains pending, unchanged by
this milestone, awaiting the human 6-point re-verification referenced in m30's ABSORB entry. This
iteration performed no action on it (correctly, per its own out-of-scope status for M31).

### 2. manda hub healthz gate

**N/A for this CLI-only milestone.** No manda dispatch, no hub health check performed or required —
stated explicitly per the charter's HARD GATES adaptation note.

### 3. Port 4173 reachability gate

**N/A for this CLI-only milestone.** No Web UI dev server involved in this charter's scope — stated
explicitly per the charter's HARD GATES adaptation note.

### 4. Worktree isolation

```
$ git worktree add experiments/quay-perpetual-stream/milestones/M31-cli-gate-enforcement/worktrees/iteration-1 -b exp5-m31-iteration-1 95bb68013b225715686a587c278d41555ec79618
Preparing worktree (new branch 'exp5-m31-iteration-1')
HEAD is now at 95bb680 SELECT m31: M31-cli-gate-enforcement — charter authored, DIR-scope decision made
```

Base commit confirmed via `git rev-parse exp5-outer-driver` → `95bb68013b225715686a587c278d41555ec79618`
— matches the charter's stated base (`a96ff23` was the base at charter-authoring time / m30-publish;
the branch has since moved forward to include the M31 charter-authoring commit itself, `95bb680`,
which both iterations dispatch off of — same commit for both, per the Dispatcher notes' "neither of
you should have moved that branch").

Isolation proof (from repo root, after all work including test runs and the commit below):

```
$ git -C /home/yale/work/quay status --short
(no output — clean)
```

No unexpected changes leaked into the main worktree at any point.

## Independent investigation summary (before writing any test)

- `packages/quay/bin/quay.js` `task edit` handler (originally lines ~472-577): confirmed directly, no
  call to `taskCheck`/gate logic anywhere in the block — matches the charter's Current-state notes
  exactly.
- `packages/quay/bin/quay.js` `task check` handler: calls `client.taskCheck(id)`.
- `packages/quay/src/provider-client.js` `taskCheck(id)`: generic `task_check` MCP tool passthrough,
  returns `r.structuredContent` directly (so `result.ok`/`result.reason` are top-level fields, not
  nested) — confirmed by reading the source, not assumed from the charter's prose.
- `packages/quay-native/src/store.js` `check(id)` (the real gate logic): gates on the task's CURRENT
  `status` field (`todo` -> author->ready gate: all-artifacts-present + all-AC-checkboxes-checked;
  `ready` -> execute->done gate: AC-checkboxes-checked + all-children-done; `done`/`needs-human` ->
  terminal/soft-stop). Critically, **the gate checks the task's current recorded state, not the
  target status being written** — so a `todo` task with an unchecked AC box fails `task check`
  regardless of what `--status` value the caller is trying to move it to.
- Existing fixture pattern found in `packages/quay/test/cli.test.mjs` (test 4, pre-existing): `CLI-2`
  is seeded as `status: todo` with an AC section present but **unchecked**
  (`AC_DOD_UNCHECKED` constant) — this task already fails `task check` (test 4's own pre-existing
  assertion: `rFail.status === 1`, `fail.ok === false`). This is a genuine, real gate-failing fixture
  built from the actual native-provider gate condition (unchecked AC boxes), not a synthetic
  always-fail stub. I reused this exact fixture for the new `--enforce-gate` tests rather than
  constructing a new one, since it already demonstrates the real condition the charter asks for
  ("missing artifact / unchecked AC box, whichever the active provider's `task_check` gates on" —
  the unchecked-AC-box branch).

## TDD RED -> GREEN transcript

**RED** (test written first, against pre-implementation `quay.js`):

```
$ node --test packages/quay/test/cli.test.mjs 2>&1 | grep -E "PASS|FAIL" | grep -i "enforce"
FAIL: quay task edit CLI-2 --status ready --enforce-gate exits 1 (gate fails)
FAIL: quay task edit --enforce-gate refusal surfaces the gate's result.reason in the error message (got stderr: )
FAIL: quay task edit --enforce-gate refusal performs NO write — CLI-2 status unchanged (still todo)
PASS: quay task edit CLI-2 --status ready (no --enforce-gate) still succeeds unguarded against the same gate-failing fixture (Done-when clause 3)
PASS: quay task edit CLI-2 --status ready (no --enforce-gate) actually persists the new status
PASS: quay task edit CLI-1 --status todo --enforce-gate exits 0 when the gate passes
PASS: quay task edit --enforce-gate (gate passes) actually persists the new status, same output shape as unguarded
PASS: quay task edit CLI-2 --labels a,b --enforce-gate (no --status field) succeeds as a no-op guard-check — Done-when clause 4, option (b)
```

3 failures — exactly the refuse-on-fail behavior that did not yet exist (since `--enforce-gate` was
previously an unrecognized/no-op flag, the write always succeeded unguarded, same as default). The
other assertions passed vacuously (an unimplemented `--enforce-gate` behaves identically to no flag at
all, which happens to satisfy the "succeeds when gate passes" and "no-op without --status" cases by
coincidence — the RED failures are the ones that actually demonstrate the gap).

**Implementation** (in `packages/quay/bin/quay.js`, `task edit` handler, immediately before the
`client.taskWrite` call):

```js
if (flags["enforce-gate"] && patch.status !== undefined) {
  const gateResult = await client.taskCheck(id);
  if (gateResult.ok === false) {
    console.error(
      `quay task edit: --enforce-gate refused the write — gate check failed: ${gateResult.reason}`
    );
    process.exitCode = 1;
    return;
  }
}
```

Plus a documentation-provenance code comment (in-scope item 3) immediately above it, and `--help`
text updates (in-scope item 2).

**GREEN** (full `cli.test.mjs` run post-implementation):

```
$ node --test packages/quay/test/cli.test.mjs 2>&1 | tail -10
All QN-033 bin/quay.js CLI dispatch tests passed.
✔ packages/quay/test/cli.test.mjs (75904.185723ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
```

All 8 new `--enforce-gate`-related assertions pass, plus the 2 new `--help`-text assertions:

```
PASS: quay task edit CLI-2 --status ready --enforce-gate exits 1 (gate fails)
PASS: quay task edit --enforce-gate refusal surfaces the gate's result.reason in the error message
PASS: quay task edit --enforce-gate refusal performs NO write — CLI-2 status unchanged (still todo)
PASS: quay task edit CLI-2 --status ready (no --enforce-gate) still succeeds unguarded against the same gate-failing fixture (Done-when clause 3)
PASS: quay task edit CLI-2 --status ready (no --enforce-gate) actually persists the new status
PASS: quay task edit CLI-1 --status todo --enforce-gate exits 0 when the gate passes
PASS: quay task edit --enforce-gate (gate passes) actually persists the new status, same output shape as unguarded
PASS: quay task edit CLI-2 --labels a,b --enforce-gate (no --status field) succeeds as a no-op guard-check — Done-when clause 4, option (b)
PASS: quay --help output mentions --enforce-gate flag (M31-cli-gate-enforcement)
PASS: quay --help output documents that status transitions are unguarded by default (M31-cli-gate-enforcement)
```

## Full test suite: before / after

**Before (baseline, fresh worktree, `npm install` run, `node --test packages/*/test/*.test.mjs`):**
3 file-level failures in the parallel run — `cli-edit-parity-conformance.test.mjs`,
`provider-abi-conformance.test.mjs`, `serve-github.test.mjs`. All three depend on live
`--provider github` network calls against the real `yaleh/quay` repo. Re-run each **in isolation**
(not parallel):
- `cli-edit-parity-conformance.test.mjs` — PASS in isolation (1/1).
- `provider-abi-conformance.test.mjs` — PASS in isolation (1/1).
- `serve-github.test.mjs` — FAIL in isolation too: `GET /` no longer includes `gh-3` on the live
  listing page (real-repo-state/pagination drift, unrelated to `task edit`/gate scope — the failing
  assertions are about the task-list page, not `task edit` at all).

**After (post-implementation, same commands):** identical result — `provider-abi-conformance.test.mjs`
and `serve-github.test.mjs` fail in the parallel run, `cli-edit-parity-conformance.test.mjs` passes
this time (parallel-run GitHub API contention is nondeterministic run-to-run, as expected for live
network concurrency). Re-run in isolation post-change:
- `provider-abi-conformance.test.mjs` — PASS in isolation (1/1), same as before.
- `serve-github.test.mjs` — FAIL in isolation, **identical failure** (same 2 assertions, same
  live-repo-state cause), reproducing byte-for-byte pre- and post-change.

**Conclusion:** these 2-3 failures are pre-existing, environmental (live GitHub network state /
parallel-run API contention), and reproduce identically with or without my diff — confirmed not a
regression I introduced. `cli.test.mjs` (the file I actually modified) is 100% green before and
after, in isolation and in the full parallel run.

## Done-when clauses — evidence

**1. `--enforce-gate` refuses a gate-failing transition (exit 1, no write), `result.reason` surfaced.**
MET. `CLI-2` (todo, AC unchecked) + `--status ready --enforce-gate` -> exit 1, stderr contains
`"0/1 AC checkboxes checked"` (the real `store.js#check()` reason string), `task view CLI-2` confirms
status still `todo` (no write performed). See RED->GREEN transcript above.

**2. `--enforce-gate` succeeds identically to unguarded when the gate passes.** MET. `CLI-1` (AC fully
checked) + `--status todo --enforce-gate` -> exit 0, same JSON output shape (`{id, title, status, ...}`)
as an unguarded write.

**3. Without `--enforce-gate`, behavior is unchanged (zero regression), demonstrated against the SAME
gate-failing fixture.** MET. `CLI-2` (same fixture as clause 1) + `--status ready` (no flag) -> exit 0,
write succeeds, status persists to `ready` — current unguarded behavior fully preserved.

**4. `--enforce-gate` + non-`--status` patch: pick (a) or (b), document which.** MET — **option (b)
chosen: explicit no-op without a `status` field present.** `CLI-2 --labels a,b --enforce-gate` (no
`--status`) -> exit 0, no gate check performed, even though CLI-2 is itself currently gate-failing.
Reasoning for (b) over (a): the charter's own in-scope item 1 text explicitly states "keep this simple
and always check when `--enforce-gate` is present and the write includes a `status` field" — this is
already (b)'s condition, stated as the charter's own preferred simple rule, not left fully open. I
independently agree with (b) over (a) for an additional reason found during implementation: `patch`
only carries a `status` key when `--status` was actually passed (see the `if (flags.status !==
undefined) patch.status = flags.status;` line) — checking `patch.status !== undefined` is a single,
unambiguous condition with no risk of the check firing on an unrelated field (e.g. `--extra` or
`--parent` changes) that the gate logic has no opinion about. Option (a)'s "any status-affecting
change" framing is vaguer — no other flag in this codebase's `task edit` surface is described anywhere
as "status-affecting" except `--status` itself, so (a) would have required inventing a definition the
charter never actually needs.

**5. `--help` documents both default-unguarded and `--enforce-gate`, verified by a test.** MET. Usage
line updated (`[--enforce-gate]` added to the `task edit` synopsis), a new "Options for task edit"
paragraph added documenting the `git commit --no-verify` analogy and the opt-in semantics, plus two new
test assertions (`r.stdout.includes("--enforce-gate")` and an "UNGUARDED"/"unguarded" substring check).

**6. Inline code comment present at the handler.** MET. A ~18-line comment immediately above the new
`if (flags["enforce-gate"] && patch.status !== undefined) { ... }` block, explaining the
unguarded-by-default decision, the `git commit --no-verify` analogy, why option (a) was rejected, why
`--enforce-gate` reuses `client.taskCheck` rather than duplicating gate logic, the Done-when-4 option-
(b) choice, and a pointer to the charter file for full reasoning.

**7. Skill-doc cross-reference check performed; staleness fixed or logged.** MET —
**confirmed-already-accurate, no staleness found.** See "Skill-doc cross-reference check" section
below for the full investigation.

**8. Full test suite green before AND after, TDD RED->GREEN demonstrated.** MET, with the caveat above:
`cli.test.mjs` (the modified file) is 100% green before and after; the 2-3 pre-existing
network/live-repo-state failures in unrelated test files reproduce identically pre- and post-change
(confirmed by isolated re-runs both before and after my diff), so are not a regression. See "Full
test suite: before / after" above and the RED->GREEN transcript.

**9. `git diff --stat` scoped correctly; real repo-root `tasks/` untouched.** MET.

```
$ git diff --stat
 packages/quay/bin/quay.js       | 37 +++++++++++++++++++++++-
 packages/quay/test/cli.test.mjs | 64 +++++++++++++++++++++++++++++++++++++++++
 2 files changed, 100 insertions(+), 1 deletion(-)
```

(Plus this report file, added separately — not part of the code diff.) `git -C /home/yale/work/quay
status --short` (repo root, checked after all test runs and the commit) shows no output — the real
repo-root `tasks/` directory (and everything else outside this worktree) is confirmed untouched.

## Skill-doc cross-reference check (in-scope item 4 / Done-when clause 7)

Read `.claude/skills/quay-native-methodology/examples/quay-author-SKILL.md` and
`.../quay-execute-SKILL.md` in full, searching specifically for "gate" and "task check" per the
charter's instruction. Findings:

- Both Skills already document a **Skill-level (not CLI-level) two-step workflow**: `gate: quay task
  check <id> ...` then, conditionally, `quay task edit <id> --status <next> ...` — i.e. both Skills
  already call `task check` explicitly before `task edit --status`, as a manual process step, and
  never assumed or claimed the CLI itself enforces this ordering.
- The "gate is both contestant and judge" language the charter cites (quay-author-SKILL.md's Gaps
  section, QN-019 entry) is about the deeper "checkbox-count gameability" concern (an author can check
  a box without independent verification the underlying claim is true) — a different concern from
  whether `task edit` enforces `task check`. This is the correct reading: it is not a claim that
  `task edit` is (or should be) gate-enforcing, and is not made stale by this fix.
- Searched both files' full text for any claim of CLI-level enforcement/non-enforcement of `task edit
  --status` specifically (`grep -n "unenforced\|not enforced\|unguarded\|enforce.*by the gate\|CLI.*
  enforc\|edit.*enforc"`): only one unrelated hit each — `quay-execute-SKILL.md` line 159 ("execution
  is not enforced by tooling" — about reviewer independence, not gate enforcement) and line 211
  ("enforced only by Skill-level process discipline, not by the gate itself" — about the now-fixed
  compound-task children-done check inside the gate logic itself, QN-012, unrelated to CLI-level
  status-transition enforcement).
- **Verdict: confirmed-already-accurate.** Neither doc makes any claim about `task edit`'s own
  enforcement behavior that this fix contradicts or renders stale. Both Skills' documented workflow
  (check-then-conditionally-edit) remains exactly correct after this fix; the new `--enforce-gate`
  flag offers the same two-step logic as a single CLI-level convenience, which is consistent with,
  not contradictory to, either Skill's existing documented Method. No edit made to either Skill doc
  (correctly — a genuine staleness was searched for and not found, per the charter's explicit
  read-only-unless-genuine-staleness instruction).

## Independent skepticism on the charter's Decision section

Per the charter's Dispatcher notes, I brought genuine skepticism to the (b)+opt-in-(c) decision while
implementing it. My independent assessment:

**I agree with the Decision, and found positive evidence for it while implementing, not just
absence-of-counter-evidence:**

1. **The Skill-doc investigation above is itself evidence FOR the charter's Decision, found live, not
   anticipated at charter-authoring time.** Both `quay:author` and `quay:execute` already implement the
   gate-then-edit ordering as an explicit two-step MANUAL process, using the unguarded `task edit`
   deliberately as the second step of a caller-controlled sequence (`gate: quay task check <id>`, THEN
   `case gate.ok of True -> quay task edit ...`). If `task edit --status` were hard-blocked-by-default
   (option a), this exact, already-shipped, already-working pattern would not literally break (task
   check would already have passed before task edit is called) — but it demonstrates that the existing
   ecosystem's actual usage pattern is "check first, then edit unconditionally," not "edit and let the
   edit itself gate." This is a real design precedent already in production use in this repo, and it
   is what a hard-block-by-default would be redundant with in the success path, while still being a
   silent behavior change for anyone bypassing the check-first pattern deliberately (e.g. a
   `needs-human` recovery flow where a human has manually verified it's fine to force the transition
   despite a technically-failing mechanical gate — the AC-checkbox proxy is explicitly a "thin,
   machine-checkable proxy," per `store.js`'s own comments, not a claim of true correctness).
2. **The UX of `--enforce-gate` in practice worked cleanly, with no friction discovered.** Building
   the test fixtures required no awkward workarounds — `client.taskCheck(id)` returns exactly
   `{id, gate, ok, reason, ...}` with no nesting quirks, and gating on `patch.status !== undefined`
   was a single, unambiguous, already-available signal. Nothing in the implementation revealed a
   design flaw in the opt-in-flag shape itself.
3. **No existing test, script, or Skill doc anywhere in this repo assumes `task edit --status` is
   gate-enforced.** I searched (`grep -rn "enforce-gate\|task edit.*--status" .claude/skills/
   packages/*/test/ docs/` before writing my own tests) and found zero pre-existing callers assuming
   enforcement — consistent with the charter's own claim that no evidence exists FOR a caller wanting
   silent enforcement, only evidence (M28's near-misses) that undocumented-unguarded is a trust/UX
   problem, which (b)'s documentation fix directly addresses.

**One genuine, if minor, disagreement/refinement I would flag:** the charter's Done-when clause 4
text frames option (a) ("always-check-if-status-present") and (b) ("no-op-without-status") as if they
were live open design alternatives at *implementation* time. In practice, once you read the actual
`patch` construction code, there is no real alternative reading — `patch.status` is populated if and
only if `--status` was passed, so "any status-affecting change" (option a's framing) and "the
`--status` flag specifically" (option b) are the *same condition* in this codebase's actual data
model; there is no OTHER flag that could plausibly affect gate-relevant state without going through
`--status`. I do not think this is a flaw in the charter's Decision (the outcome is identical either
way), but I'd suggest a future charter drop the "pick one" framing for this specific clause once this
finding is on record — it reads as a bigger open decision than it turned out to be, once you have
actually read `bin/quay.js`'s patch-construction code. This is a documentation-precision refinement,
not a disagreement with the underlying choice.

**No evidence found that would favor pure-(a) hard-block-by-default or pure-(c)-without-(b).** I did
not find any scenario during implementation where the unguarded default caused a real problem in this
codebase's own test suite or Skill docs, and the opt-in flag's UX was clean. My independent verdict:
**agree with the charter's Decision as written**, with the one minor documentation-framing refinement
noted above.

## Note for ABSORB (per charter's own "Note for ABSORB" list, restated here for this iteration)

1. Clause 4: option **(b)** implemented (explicit no-op without a `status` field present) — see
   Done-when clause 4 evidence above for full reasoning.
2. Skill-doc cross-reference: **confirmed-already-accurate** — no staleness found, no edit made. See
   "Skill-doc cross-reference check" section above.
3. Decision section reasoning: **held up, and gained additional supporting evidence** (the
   `quay:author`/`quay:execute` Skills' own already-shipped check-then-edit workflow, found live
   during this iteration's Skill-doc cross-reference investigation) — no evidence found that would
   revise the (b)+opt-in-(c) choice toward (a) or pure-(c).
4. Realized Δv: **0**, as expected (governance-integrity, no VT chart cell) — confirmed explicitly,
   not silently omitted.
5. DIR-017 status: **unchanged this milestone**, still pending human 6-point re-verification per
   m30's ABSORB entry — restated here, not silently dropped (see HARD GATES section 1 above).

## Commit

Committed on branch `exp5-m31-iteration-1` (this worktree), targeting only
`packages/quay/bin/quay.js`, `packages/quay/test/cli.test.mjs`, and this report file.
