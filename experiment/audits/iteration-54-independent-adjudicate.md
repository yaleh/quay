# Iteration 54 — Independent Out-of-Band Audit (G3)

**Verdict: PASS**

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full (from disk,
gitignored), `experiment/iterations/iteration-54.md` in full, and the
tail of `experiment/provenance.md` (the full "Post-hoc correction
(iteration 53 audit)" and "Iteration 54" sections). Did not trust the
report's narration — independently re-ran every cited command and
independently read the actual test code (`packages/quay/test/cli.test.mjs`
test 10) and the delivery mechanism (`packages/quay/src/action.js`)
rather than accepting the report's characterization, per the discipline
iteration 53's audit established (false test-content characterization is
a real, distinct failure category, now the audit's fourth line of
scrutiny alongside V-factor misattribution and command-output
fabrication).

Given this iteration's central, unusual feature — a new automated test
that runs live against a **real, shared, external GitHub issue** (#3 in
`yaleh/quay`) on every future `node --test` invocation — this audit gave
that specific mechanism its own dedicated, maximum-scrutiny check
(Finding 4 below): whether `QUAY_ACTION_MOCK_LOG` genuinely prevents the
test suite from ever mutating issue #3's real label/status state. This
is treated as an operational-safety question, not merely a scoring
question, per the task's explicit instruction.

## Findings

### 1. Preconditions — `ls experiment/directives/pending/`, independently re-run, matches.

```
$ ls experiment/directives/pending/
(no output, exit code 0)
```
Confirmed empty, matching the report's claim.

### 2. `git log --oneline` — independently re-run, matches.

```
$ git log --oneline -5
85d7741 Iteration 54: close audit-discovered action-run/github test-coverage gap (QN-058)
98ab6ab Correct iteration 53's false test-coverage citation for action run/github
92fb3a2 Add iteration-53 independent audit (PASS WITH CONCERNS)
6324ff5 Iteration 53: provider.yml/DESIGN.md drift review and action/write test-coverage audit
0b904b7 Add iteration-52 independent audit (PASS)
```
Matches the report's quoted context exactly (the report quotes the same
five commits, one iteration earlier in its own §2, which is the correct
pre-iteration-54 state).

### 3. Test file content — independently read in full, matches the report's description exactly.

Read `packages/quay/test/cli.test.mjs` lines 423-527 (test 10) in full,
not just the report's summary. Confirmed:

- The invocation is `run(["action", "run", "gh-3", "advance", "--json",
  "--provider", "github"], { ...spawnOpts, env: { ...process.env,
  QUAY_ACTION_MOCK_LOG: mockLogPath } })` (lines 476-479) — the
  `--provider github` flag genuinely is passed to the spawned child
  process, not silently defaulting to native the way iteration 53's
  false claim about test 8/line 261 did.
- Assertions genuinely check `result.taskId === "gh-3"` (line 490) — a
  GitHub-shaped id, not a native `CLI-*` id — directly refuting the
  specific failure mode this iteration's own report (§9 point 5) flagged
  for special scrutiny.
- The mock delivery log file is independently re-read from disk
  (`fs.readFileSync(mockLogPath, ...)`, lines 502-509) and its fields
  cross-checked (`record.taskId === "gh-3" && record.skill ===
  "quay:execute" && record.channel === "task-gh-3"`) — the test does not
  merely trust the CLI's own JSON echo, matching the report's claim
  exactly.
- The test writes a temporary `.quay/config.yml` enabling the `github`
  provider for the duration of this block only, then restores the
  native-only config afterward (lines 511-525) — a hygiene detail the
  report mentions and that checks out in the actual code.

**Test 10's content matches the report's description exactly — no
false-characterization defect found**, in contrast to iteration 53's
line-261 miscitation.

### 4. `QUAY_ACTION_MOCK_LOG` mechanism — traced through `action.js`; genuinely prevents any write back to the real GitHub issue. This is the most important check in this audit.

Read `packages/quay/src/action.js` in full and `packages/quay/bin/quay.js`'s
`action run` dispatch branch (lines 149-171) in full.

The `action run` code path is exactly:
```js
const manifest = await client.manifest();
const t = await client.taskGet(id);
const payloadObj = composePayload({ providerManifest: manifest, task: t, actionId });
...
const result = await deliverTrigger({ root: cfg.workspaceRoot, channel, payloadObj, mockLogPath });
```
`composePayload()` (action.js:31-39) is a pure function: it reads
`providerManifest.action_buttons`/`status_skill_map` and `task.status`/
`task.id`, and returns a plain object. It performs no I/O of any kind.

`deliverTrigger()` (action.js:94-109) has exactly three branches:
`mockLogPath` present → `appendMockDeliveryRecord()` (writes only to the
local temp file, returns `{delivered: "mock", ...}`); else `manda`
available → `manda send` (a local IPC dispatch, not a GitHub call);
else → `console.log` (print/degrade). **None of these three branches
calls any GitHub-write API.**

Critically, `action run`'s entire code path calls only `client.manifest()`
and `client.taskGet(id)` on the GitHub-Provider client returned by
`connectProvider()`/`withProvider()`. I independently confirmed via `grep`
that `bin/quay.js`'s `action run` branch never references
`client.setStatus` or any other write-capable client method — the *only*
write-capable operation exposed by `packages/quay-github/src/github-client.js`
is `setStatus(id, status)` (lines 536-610), which issues `gh api ... PATCH`
calls to add/remove labels or close/reopen the issue. `setStatus` is
reachable only via `quay-github task edit --status <value>` and the MCP
`task_write` tool — **neither is ever invoked anywhere in the `action run`
code path**, mock-log mode or not. This is not merely a property of the
mock-log flag; it is a structural property of `action run` itself: it has
no code path that can write to GitHub, mock log or no mock log. The
`QUAY_ACTION_MOCK_LOG` flag only changes *how the composed trigger is
delivered locally* (file vs. manda vs. stdout) — it has no bearing on
whether GitHub is written to, because GitHub is never written to by this
command in the first place.

**Conclusion: the report's "makes zero writes back to the real repo" claim
is correct, and is actually a stronger property than the report frames it
as** — it is not just that the mock-log mode "sidesteps" a write risk,
but that `action run` (for any Provider, in any delivery mode) has no
write-capable code path at all. There is no realistic way for this test,
or any future regression-suite run, to mutate issue #3's labels or state.
**No operational-safety concern found.**

### 5. Live GitHub issue #3 state — independently confirmed byte-identical before and after a full regression-suite run.

Before running the suite:
```
$ gh issue view 3 --repo yaleh/quay --json number,title,state,labels
{"number":3,"state":"OPEN","title":"Fix MCP task_write silently dropping the extra field",
 "labels":[{"name":"status:ready",...},{"name":"lane:execution",...}]}
```

Ran the full regression suite (`node --test packages/*/test/*.test.mjs`),
then re-checked:
```
$ gh issue view 3 --repo yaleh/quay --json labels,state
{"labels":[{"name":"status:ready",...},{"name":"lane:execution",...}],"state":"OPEN"}
```
Labels (`status:ready`, `lane:execution`) and state (`OPEN`) are
byte-identical before and after. **Confirmed: this test run had zero
side effects on the real, live issue.**

### 6. QN-058 lifecycle — independently verified via `cat tasks/QN-058.md` and re-running `task check`.

`tasks/QN-058.md` front-matter: `status: done`. Body contains Proposal,
Plan, AC (4 items, all `[x]`), DoD (4 items, all `[x]`) sections matching
the report's §6 description. Both gate calls quoted in iteration-54.md
(`author->ready` at line 268, `execute->done` at line 281) both show
`"ok": true` in the file exactly as claimed. Re-running `task check
QN-058 --json` now (task is already `done`) correctly returns `{"gate":
"none", "ok": true, "reason": "terminal"}` — the expected behavior for an
already-completed task, not a discrepancy. **QN-058's `todo → ready →
done` lifecycle with both gates `ok:true` is independently confirmed.**

### 7. Precedent search (QN-034/iteration 24, QN-048/iteration 37) — independently read in full; the `skeleton +0.01` scoring is correctly derived and is the closest available precedent.

Read `experiment/provenance.md` lines 3301-3414 (iteration 24/QN-034) and
lines 5018-5111 (iteration 37/QN-048) in full, not merely the excerpts
iteration 54 quotes.

Both precedents share the exact fact pattern iteration 54 claims:
test-coverage-only regression-test addition, live-repo-constrained
(real `yaleh/quay` issues #3/#4), zero source-code change, and both were
explicitly scored `skeleton +0.01` while `reusability` was held flat with
explicit reasoning ("a test-coverage-only addition to an already-existing
GitHub-Provider capability is not 'methodology transfer' evidence — no
new capability was built via quay-native *driving* GitHub-Provider
construction," iteration 37's provenance text, itself echoing iteration
24's). `gate_correctness` was likewise held flat in both precedents ("no
gate-logic change... own `task_check` assertions cross-check existing,
unmodified gate output, they do not change it").

Protocol §5.1's exact language: **"skeleton — The v0 loop runs end-to-end
(`config → mcp → serve → action → Skill → done`)."** QN-058 adds
regression-test coverage for the `action` stage's cross-Provider
(GitHub) instantiation — a stage named explicitly in this definition.
This is a looser reading of "skeleton" than a literal first-time
"the loop now runs" claim (the loop already ran end-to-end via this path
before the test existed — the manual, ad-hoc invocation in the report's
§3 proves this), but it is **exactly the same looseness the QN-034/QN-048
precedents already established and were independently, previously
scored under** — this is not a new or more generous interpretation
invented for this iteration; it is the identical class of increment,
scored identically, for a directly analogous reason (closing a
zero-coverage gap in one of the five named v0-loop stages). Given that
precedent already exists and is directly on point, treating QN-058
differently (e.g., crediting `gate_correctness` or `reusability` instead,
as iteration 53's correction speculated might be "likely") would be the
inconsistent choice, not the reasoned one.

**Independent judgment: `skeleton +0.01` is the correct call, and no
closer or better-fitting precedent exists in `provenance.md`.** I did not
find any other precedent entry describing a test-coverage-only,
zero-source-change increment scored under a different factor than
`skeleton` — the QN-034/QN-048 pairing is consistent across both
instances, which increases confidence this is a stable, established
convention rather than a one-off judgment call being stretched to fit.

### 8. σ arithmetic — independently reproduced.

```
$ ls tasks/QN-*.md | wc -l
57
```
Matches the report's claimed post-iteration count exactly.
```
49/56 = 0.875   (0.8750 as reported for iteration 53's end state)
50/57 = 0.8771929824561403  (0.8772 as reported, correctly rounded)
```
Both values independently reproduced via direct arithmetic.

### 9. V_instance / V_meta arithmetic — independently reproduced.

```
V_instance = 0.71 × 0.96 × 0.76 × 0.96 = 0.4973
V_meta      = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
```
Both reproduced exactly via direct computation (Python), matching the
report's quoted figures and the correctly-unchanged V_meta (no
`completeness`/`effectiveness`/`reusability`/`validation` factor moved
this iteration, consistent with the precedent-derived reasoning in
Finding 7).

### 10. Command-output quotes and test citations — independently re-run; all genuine.

Re-ran the full regression suite:
```
$ node --test packages/*/test/*.test.mjs
ℹ tests 25
ℹ pass 25
ℹ fail 0
```
Matches the report's quoted 25/25 exactly (duration naturally differs
run-to-run, not a discrepancy).

Re-ran `cli.test.mjs` standalone:
```
$ node packages/quay/test/cli.test.mjs
...
PASS: quay action run gh-3 advance --json --provider github exits 0 (real GitHub-backed task, end-to-end)
PASS: quay action run --json --provider github emits parseable JSON output
PASS: quay action run --json --provider github output includes the real GitHub taskId (gh-3)
PASS: quay action run --json --provider github resolves the correct status_skill_map skill for gh-3's real live status (got status=ready, skill=quay:execute)
PASS: quay action run --json --provider github output includes the composed channel name for the real GitHub task id
PASS: quay action run --json --provider github used the deterministic QUAY_ACTION_MOCK_LOG delivery mode, not a live manda/print path
PASS: the mock delivery log file was actually created on disk for the real GitHub-backed action run
PASS: mock delivery log contains exactly one record (got 1)
PASS: the on-disk mock delivery record for the real GitHub task carries the correct taskId/skill/channel
All QN-033 bin/quay.js CLI dispatch tests passed.
```
All nine new PASS lines reproduced byte-for-byte against the report's
§5 quote. Per Finding 3, the test body's actual content matches every one
of these claims (not merely their surface text) — this closes the
specific loophole iteration 53's audit found (a correctly-quoted PASS
line whose underlying test did not actually test what the line's label
implied). Here, the label and the code agree.

```
$ git diff --stat -- packages/
(no output — clean; QN-058's own commit is already merged, so this
independently confirms the historical commit's diff, see Finding 11)
```

### 11. `git diff --stat` scope of the iteration-54 commit — independently verified test-only.

```
$ git show --stat 85d7741 -- packages/
 packages/quay/test/cli.test.mjs | 108 ++++++++++++++++++++++++++++++++++++-
 1 file changed, 107 insertions(+), 1 deletion(-)
```
Matches the report's claim exactly: only the test file changed, no
`src/*.js` file touched. Confirms `abi_symmetry`/`gate_correctness`/
`skill_convergence` were correctly held flat (no possible mechanism for
them to have moved).

### 12. `git status --short` — independently re-run, clean modulo the known file.

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
```
Matches exactly, both before and after this audit's own work (including
after running the regression suite, which creates and cleans up its own
temp directories under `/tmp`, not under the repo).

## Critical assessment

This iteration's central novelty — adding a test that runs live against
a real, shared GitHub issue (#3) — was given this audit's primary
scrutiny, per the task's explicit fourth risk category. The result is
unambiguous: `action run`'s code path has **no write-capable operation
reachable from it at all**, for any Provider, with or without
`QUAY_ACTION_MOCK_LOG`. `composePayload()` is a pure function and
`deliverTrigger()`'s three delivery branches (mock-file, manda IPC,
stdout print) never call the GitHub client's `setStatus()` (the only
write-capable method that package exposes). This means every future
`node --test` run of this suite is safe with respect to issue #3's real
label/status state — independently confirmed empirically as well (byte-
identical `labels`/`state` before and after a live run). This is a
stronger safety property than the report's own framing implies (the
report frames `QUAY_ACTION_MOCK_LOG` as the reason writes are avoided;
in fact `action run` cannot write to GitHub regardless of delivery mode
— the mock-log flag only makes *local* delivery deterministic, not
GitHub-write-avoidance, though the report's practical conclusion —
"zero writes back to the real repo" — is correct).

One residual, non-blocking operational note for future iterations: the
test's correctness (specifically the `status === "ready" && skill ===
"quay:execute"` assertion) is genuinely coupled to issue #3's live label
state remaining `status:ready`. This is a live-state dependency, not a
side-effect risk — if a human or another process changes issue #3's
label in the future, this specific assertion (not the harness, and not
GitHub's real state) would need revisiting. The report itself names this
explicitly (§9 point 3) as a forward-looking risk for the next audit to
watch, which is the correct, honest framing — it is a fragility
consideration, not a mutation risk.

The precedent-search claim (QN-034/iteration 24, QN-048/iteration 37 as
the basis for `skeleton +0.01` rather than `gate_correctness` or
`reusability`) was independently verified against the actual historical
reasoning in `provenance.md`, not merely the iteration-54 report's
summary of it, and holds up: both precedents are genuinely on point,
genuinely reasoned the same way, and no closer or contradicting
precedent exists elsewhere in the file.

All arithmetic (σ, V_instance, V_meta) is independently reproduced
exactly. The QN-058 task file and both gate calls are independently
confirmed. The regression suite (25/25) and `abi-symmetry.mjs` both pass.
The working tree is clean modulo the one known pre-existing untracked
file. No fabricated command output, no false test-content
characterization, and no operational side-effect risk were found
anywhere in this iteration's work.

## Net assessment

**Verdict: PASS.**

This is the first iteration since 52 to earn a clean, unqualified PASS.
Iteration 54 closed a genuine, previously-audit-discovered
test-coverage gap (no test exercised `action run --provider github`
end-to-end against a real GitHub-backed task) with a new test that was
independently confirmed, line by line, to do exactly what the report and
the test's own PASS-message labels claim. The test's use of a real,
live, shared GitHub issue (#3) was scrutinized as a potential
operational-safety risk and found to be safe by construction: `action
run`'s code path (`composePayload` + `deliverTrigger`) has no
write-capable branch to GitHub in any delivery mode, and this was
empirically confirmed by comparing issue #3's live label/state
byte-for-byte before and after a full regression-suite run — unchanged.
The `skeleton +0.01` scoring is correctly derived from the closest
available precedent (QN-034/iteration 24, QN-048/iteration 37), read in
full and independently found to be genuinely on point, with no
contradicting or closer precedent found elsewhere in `provenance.md`.
All σ/V_instance/V_meta arithmetic reproduces exactly. QN-058's
`todo → ready → done` lifecycle with both gates `ok:true` is
independently confirmed via the task file and a live gate re-check. The
regression suite passes (25/25), `abi-symmetry.mjs` confirms all four
surfaces remain symmetric, and the working tree is clean modulo the one
known pre-existing untracked file.

**No corrections required.** This iteration is recommended to restart
and continue the clean-audit streak at 1 (following iteration 53's PASS
WITH CONCERNS, which required one post-hoc correction now itself
verified resolved).
</content>
