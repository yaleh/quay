# Iteration 55 — Independent Out-of-Band Audit (G3)

**Verdict: PASS**

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full (from disk,
gitignored), `experiment/iterations/iteration-55.md` in full, and the
tail of `experiment/provenance.md` (the "Iteration 55" section and
enough of iteration 54's carried-forward text to have context). Did not
trust the report's narration — independently re-ran every cited command,
independently read `bin/quay.js` in full, `packages/quay-github/src/
github-client.js` in full, `packages/quay/src/provider-client.js`, and
the new test 11 block (11a/11b/11c) in `packages/quay/test/cli.test.mjs`
line by line, rather than accepting the report's characterization.

Given this iteration's central claim — three new commands now run live
against a real, shared, external GitHub issue (#3 in `yaleh/quay`) on
every future `node --test` invocation, one of which (`task check`)
deliberately exercises a FAIL/exit-1 branch — this audit gave the
read-only-safety claim its own dedicated, maximum-scrutiny check
(Finding 6 below), independent of the report's own characterization.

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
91b79f1 Iteration 55: systematic sweep closes task view/action list/task check --provider github coverage gap (QN-059)
06efe94 Add iteration-54 independent audit (PASS)
85d7741 Iteration 54: close audit-discovered action-run/github test-coverage gap (QN-058)
98ab6ab Correct iteration 53's false test-coverage citation for action run/github
92fb3a2 Add iteration-53 independent audit (PASS WITH CONCERNS)
```
Matches the report's quoted pre-iteration context (report's §2 quotes
the same commits one iteration earlier, correctly reflecting the
pre-iteration-55 state), and confirms iteration 54's audit (`06efe94`)
sits between the two iteration reports, exactly as the report describes.

### 3. Full Provider-parameterized subcommand list — independently read `bin/quay.js` in full, confirmed.

`bin/quay.js` (203 lines, read in full) has exactly six branches that
accept `--provider` (via `withProvider(fn, { providerId: flags.provider })`):
`task list`, `task view`, `task edit`, `task check`, `action list`,
`action run`. Two additional branches (`serve`, `mcp`) take no
`--provider` flag. This matches the report's claimed branch table
exactly.

### 4. Pre-iteration test coverage — independently verified via git history, not just the report's grep claim.

```
$ git show 06efe94:packages/quay/test/cli.test.mjs | grep -n "provider.*github\|github.*provider"
```
Confirmed: as of the commit immediately preceding iteration 55 (iteration
54's own audit commit), `--provider github` appears only in test 8
(`task list`, since iteration 29) and test 10 (`action run`, added
iteration 54). No occurrence for `task view`, `task edit`, `task check`,
or `action list` exists anywhere in the pre-iteration-55 test file.
Independently confirms the report's central factual claim — this is not
merely trusting the report's own grep summary, it is a direct diff
against the actual pre-iteration commit.

### 5. New test 11 — independently read in full; genuinely exercises `--provider github` against `gh-3`, non-vacuously.

Read lines ~545-660 of the current `cli.test.mjs`. Confirmed:

- The block writes a `.quay/config.yml` with a real `github` provider
  entry whose `env.QUAY_GITHUB_REPO` is the literal string `"yaleh/quay"`
  (not a synthetic/mocked repo), matching test 8/10's own established
  fixture convention.
- **11a** (`task view`): spawns `["task", "view", "gh-3", "--json",
  "--provider", "github"]`, asserts exit 0, parseable JSON, `t.id ===
  "gh-3"`, non-empty `title`, and `t.status === "ready"`. Non-vacuous:
  these are real field-value assertions against a live-read object, not
  merely "did not throw."
- **11b** (`action list`): spawns `["action", "list", "gh-3", "--json",
  "--provider", "github"]`, asserts exit 0, JSON array shape, and that
  the array contains a button with `id === "advance"` (a real semantic
  check tied to gh-3's live status being in the `advance` button's
  `whenStatus`).
- **11c** (`task check`): spawns `["task", "check", "gh-3", "--json",
  "--provider", "github"]`, asserts **exit 1** (not exit 0 — a real,
  meaningful negative-path assertion), parseable JSON, `id === "gh-3"`,
  `ok === false`, and that `acTotal`/`acChecked` are both numbers.

None of these assertions is vacuous (e.g. `assert(true)` or a bare
"didn't crash" check) — each ties to a real field value read live from
GitHub. Independently ran the standalone suite:

```
$ node packages/quay/test/cli.test.mjs
...
PASS: quay task view gh-3 --json --provider github exits 0 (real GitHub-backed task, end-to-end)
PASS: quay task view --json --provider github emits parseable JSON output
PASS: quay task view --json --provider github output includes the real GitHub taskId (gh-3)
PASS: quay task view --json --provider github output includes a non-empty title read live from the real issue
PASS: quay task view --json --provider github reflects gh-3's real live status (got ready)
PASS: quay action list gh-3 --json --provider github exits 0 (real GitHub-backed task, end-to-end)
PASS: quay action list --json --provider github emits a JSON array
PASS: quay action list --json --provider github includes the 'advance' button for gh-3 (whenStatus includes its real live status 'ready')
PASS: quay task check gh-3 --json --provider github exits 1 (mirrors result.ok for gh-3's real, currently-unchecked AC state)
PASS: quay task check --json --provider github emits parseable JSON output
PASS: quay task check --json --provider github output includes the real GitHub taskId (gh-3)
PASS: quay task check --json --provider github reports ok:false for gh-3's real, currently-unchecked AC state
PASS: quay task check --json --provider github reports real acTotal/acChecked counts read live from the issue body

All QN-033 bin/quay.js CLI dispatch tests passed.
```
Every quoted PASS line in the report's §5 matches this session's own
independent re-run, verbatim.

### 6. Critical safety check — independently traced the code path for all three commands; confirmed genuinely read-only.

Read `bin/quay.js`'s three branches directly:
- `task view` → `client.taskGet(id)` only.
- `action list` → `client.manifest()` + `client.taskGet(id)` only.
- `task check` → `client.taskCheck(id)` only.

None of these three branches calls `client.taskWrite()` anywhere in
their control flow (independently confirmed by reading each branch's
full body, not just grepping for the function name).

Read `packages/quay/src/provider-client.js`: `taskGet`, `taskCheck`, and
`manifest` are separate exported functions from `taskWrite`, each
independently wrapping distinct MCP calls (`task_get`/`task_check`/
`provider://manifest` resource read vs. `task_write`).

Read `packages/quay-github/src/github-client.js` (327 lines) in full:
- `get(id)` (backs `taskGet`): calls `ghApiJson([...issues/${number}])`
  only — a bare GET, no `-X` write verb anywhere in this function.
- `check(id)` (backs `taskCheck`): calls `get(id)` then the pure function
  `checkGate(task, get)` — no `gh api` call of its own beyond the read
  already covered above; `checkGate` itself is a pure, non-I/O function
  operating on the already-fetched task object and body text.
- `manifest()` reads a static resource (`provider://manifest`), itself
  backed by `readManifest()` in `packages/quay-github/src/manifest.js` —
  a static, in-repo manifest file, no `gh api` call at all.
- The **only** function in `github-client.js` that calls `ghApiRun`
  with `-X PATCH`, `-X POST`, or `-X DELETE` is `setStatus(id, status)`
  (lines ~536-591), which is exclusively wired to `taskWrite` (used only
  by `task edit`). Grepped for `PATCH`/`POST`/`DELETE` across the whole
  file: all three write verbs occur exclusively within `setStatus`.

Conclusion: the safety claim is independently verified at the source
level, not merely trusted from the report's narration. `task view`,
`action list`, and `task check` have **no reachable write call** to
GitHub in their entire call graph.

Live-state comparison, independently performed before and after this
session's own full test-suite run:
```
$ gh issue view 3 --repo yaleh/quay --json number,state,labels
{"labels":[{"name":"status:ready",...},{"name":"lane:execution",...}],"number":3,"state":"OPEN"}
```
Identical byte-for-byte before and after running `node packages/quay/
test/cli.test.mjs` and the full `node --test packages/*/test/*.test.mjs`
suite in this audit session. **No live-issue-state mutation occurred.**

### 7. Full regression suite — independently re-run, matches.

```
$ node --test packages/*/test/*.test.mjs
...
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
```
$ node packages/quay-native/test/abi-symmetry.mjs
...
ALL FOUR SURFACES SYMMETRIC
```
Both match the report's claims exactly.

### 8. `task edit` exclusion rationale — independently confirmed via source.

`bin/quay.js`'s `task edit` branch calls `client.taskWrite({ id, status:
flags.status })`, which is the **only** Provider-parameterized command
wired to `taskWrite`. In `github-client.js`, `taskWrite` maps to
`setStatus()`, the sole function performing real `gh api -X PATCH/POST/
DELETE` calls (issue close/reopen, label add/remove). Read
`packages/quay-github/test/write.test.mjs`'s header comment directly:
it states, verbatim, that `computeStatusWrite()` is tested only as an
"injected... pure decision logic" with "no live `gh api` call in this
file," explicitly because "this repo's real issue count is too small/
precious to safely target with destructive live writes in an automated,
repeatable test file." This is a genuine, pre-existing, directly-on-point
precedent — the report's citation of it is accurate, not invented after
the fact.

### 9. QN-059 provenance/lifecycle — independently confirmed.

```
$ cat tasks/QN-059.md
```
Shows `status: done`, all four AC items checked, all four DoD items
checked, Proposal/Plan sections matching the work described in the
iteration report.

```
$ node packages/quay-native/bin/quay-native.js task check QN-059 --json
{
  "id": "QN-059",
  "gate": "none",
  "ok": true,
  "reason": "terminal"
}
```
This is the expected terminal-state result for an already-`done` task
(no further gate applies) — consistent with, not contradicting, the
report's claim that both the `author->ready` and `execute->done` gates
returned `ok:true` during the iteration itself (those calls happened
before the final `ready -> done` transition; the task is now
post-terminal). The provenance table entry (`author_by: native,
execute_by: native, gate_by: native, status: done`) is consistent with
`experiment/provenance.md`'s tail, independently re-read this session.

### 10. Precedent search for `skeleton +0.01` — independently confirmed as the correct, closest precedent.

Read iteration 24 (QN-034) and iteration 37 (QN-048) directly (not just
the report's summary): both are genuine, on-point precedents — test-
coverage-only additions for already-existing, unmodified capability,
credited `skeleton +0.01` with `gate_correctness`/other factors held
flat, using materially identical reasoning to what iteration 55 (and 54)
apply. No closer or contradicting precedent was found elsewhere in
`provenance.md` for this exact fact pattern (test-only change, zero
source diff, closes a genuine, previously-uncredited coverage gap,
including one sub-block that specifically targets the gate-check stage
without touching gate logic). The iteration 55 report's own explicit
consideration of `gate_correctness` as an alternative factor (because
11c targets `task check`) and its reasoned rejection (assertions
cross-check existing, unmodified gate *output*, not gate *logic* —
confirmed independently in Finding 6 above: no `checkGate()`/`store.js`/
`github-client.js` diff exists) is sound and consistent with precedent.

### 11. σ_strict arithmetic — independently reproduced.

```
$ ls tasks/QN-*.md | wc -l
58
```
```
$ python3 -c "print(50/57); print(51/58)"
0.8771929824561403
0.8793103448275862
```
Both round to the report's claimed `0.8772` and `0.8793`. Matches.

### 12. V_instance / V_meta arithmetic — independently reproduced.

```
$ python3 -c "print(0.72*0.96*0.76*0.96)"
0.50429952
```
Rounds to **0.5043**, matching the report's claim exactly.
V_meta = 0.74 × 0.26 × 0.79 × 0.64 — unchanged from iteration 54,
confirmed identical inputs and identical result (0.0973) in
`experiment/provenance.md`'s tail.

### 13. Verbatim command-output quoting — spot-checked, genuine.

Independently re-ran and compared, verbatim: the `ls experiment/
directives/pending/` precondition check, `git log --oneline -5`, the
full `node --test packages/*/test/*.test.mjs` summary block, the
`abi-symmetry.mjs` final line, all 13 new PASS lines from test 11, and
the `gh issue view 3` JSON output. All match the report's quotes
exactly, character for character where compared. No fabricated or
edited command output was found.

### 14. `git status --short` — independently confirmed clean, modulo the one known file.

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
```
Matches exactly the one pre-existing, deliberately-untouched untracked
file carried forward from prior iterations/audits. No other changes.

### 15. Diff scope — independently confirmed test-only.

```
$ git diff 06efe94 91b79f1 --stat
 experiment/iterations/iteration-55.md | 547 +++...
 experiment/provenance.md              | 163 +...
 packages/quay/test/cli.test.mjs       | 151 +++-
 tasks/QN-059.md                       |  56 +++
```
Only one file under `packages/` changed (`cli.test.mjs`, test file);
no `src/*.js` file in any package was touched. Confirms the report's
"test-file-only change" claim.

## Net assessment

**Verdict: PASS.**

Iteration 55 performed a genuine, independently-confirmed systematic
sweep of `bin/quay.js`'s complete Provider-parameterized branch table
(six subcommands, verified by direct full-file read) and correctly
identified that `task view`, `action list`, and `task check` had zero
pre-existing `--provider github` test coverage (independently confirmed
via a direct diff against the pre-iteration commit, not merely by
trusting the report's grep summary). The new test 11 (11a/11b/11c) was
read in full and independently re-run: it genuinely spawns the real CLI
against real GitHub issue `gh-3` with `--provider github`, and every
assertion is meaningful (specific field values, specific exit codes,
specific array contents) rather than vacuous. The critical safety
check was independently traced at the source level (`bin/quay.js` +
`provider-client.js` + `github-client.js` in full): all three newly
tested commands have no reachable write call anywhere in their call
graph, and live issue #3's label/state was independently confirmed
byte-identical before and after this audit's own full test-suite run —
no live-issue-state mutation occurred. `task edit`'s exclusion is
independently confirmed correct: it is the sole command wired to the
only real `gh api` write path (`setStatus`), and the citation of
`write.test.mjs`'s pre-existing header-comment precedent is accurate.
The `skeleton +0.01` precedent (QN-034/iteration 24, QN-048/iteration
37) was independently read in full and found to be the correct, closest
precedent, including the reasoned (and correct) rejection of
`gate_correctness` as the alternative factor. All arithmetic (σ_strict,
V_instance, V_meta) is independently reproduced exactly. QN-059's task
file and gate history show a genuine `todo → ready → done` lifecycle
with both gates `ok:true` at the time they were checked, now correctly
terminal (`gate: none, ok: true, reason: terminal`) as a completed task.
The full regression suite (25/25) and `abi-symmetry.mjs` both pass, the
working tree is clean modulo the one known pre-existing untracked file,
and the diff is confirmed test-file-only.

No fabricated command output, no false test-content characterization,
no misapplied precedent, and **no operational side-effect risk** were
found anywhere in this iteration's work. This is the second consecutive
clean, unqualified PASS (following iteration 54's `06efe94`), extending
the clean-audit streak to 2.
</content>
