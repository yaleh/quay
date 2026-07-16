# Iteration 53 — Independent Out-of-Band Audit (G3)

**Verdict: PASS WITH CONCERNS**

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full (from disk,
gitignored, 233 lines), `experiments/quay-native-bootstrap/iterations/iteration-53.md` in full,
and the tail of `experiments/quay-native-bootstrap/provenance.md` (the full "Iteration 53"
section). Did not trust the report's narration — independently re-ran
every cited command against the live working tree and the live GitHub
API, and independently read every source/test file the report cites
rather than accepting its characterization of their contents. Given that
iterations 50 and 51 both failed for fabricating command-output claims,
and iteration 52 restored a clean, verbatim-verified PASS, this audit's
#1 job was (a) whether the literal-copy-paste discipline held for every
quoted terminal output, and (b) whether the report's four substantive
claims (provider.yml parity, DESIGN.md non-drift, the test-coverage
investigation, and the two live re-checks) are actually true, not merely
plausible-sounding.

**Bottom line:** the verbatim command-output discipline held cleanly —
every quoted terminal output I independently re-ran matched exactly,
several character-for-character. However, one of the report's four
substantive claims (claim 3, the test-coverage investigation) contains a
factually incorrect citation: it asserts that `packages/quay/test/cli.test.mjs`
line 261 exercises `quay action run --json` "against `--provider github`"
for "a real GitHub-backed task." This is false — that test invokes
`action run` against `CLI-1`, a **native**-Provider fixture task, with no
`--provider` flag at all; the file's actual `--provider github` test
(test 8) only exercises `task list`, never `action run`. This is not a
fabricated terminal-output quote (no tool call is misquoted), but it is a
materially incorrect characterization of what a cited test file actually
tests, used to support a "no gap found" conclusion. See Finding 6 below.

## Findings

### 1. `ls experiments/quay-native-bootstrap/directives/pending/` — independently re-run, matches.

```
$ ls experiments/quay-native-bootstrap/directives/pending/
(no output, exit code 0)
```
Confirmed empty, matching the report's claim.

### 2. `git status --short` — independently re-run, matches exactly.

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
```
Clean modulo the one known pre-existing untracked file, both before and
after this audit's own read-only work.

### 3. `git log --oneline` / commit stat — independently re-run, matches.

```
$ git log --oneline -5
6324ff5 Iteration 53: provider.yml/DESIGN.md drift review and action/write test-coverage audit
0b904b7 Add iteration-52 independent audit (PASS)
02dbeb7 Iteration 52: re-confirm stability post-correction; live re-probe of manda dispatch primitive and GitHub issue-state check
29ac1ad Correct iteration 51's false grep-claim about comment-handling code
b8a47c2 Add iteration-51 independent audit (FAIL — recurring false grep claim)
```
`git show --stat 6324ff5` confirms the commit touches only
`experiments/quay-native-bootstrap/iterations/iteration-53.md` (562 insertions) and
`experiments/quay-native-bootstrap/provenance.md` (146 insertions) — no source, Skill, gate, or
config file. This correctly supports the report's claim that no
code/schema/Skill change occurred this iteration, and correctly
justifies holding all eight V-factors flat.

### 4. `ls tasks/QN-*.md | wc -l` — independently re-run, matches.

```
$ ls tasks/QN-*.md | wc -l
56
```
σ (strict) = 49/56 = 0.8750 reproduced exactly via direct arithmetic.

### 5. Full regression suite and ABI symmetry — independently re-run, both match.

```
$ node --test packages/*/test/*.test.mjs
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
25/25 pass, matching the report's quoted counts exactly (duration
naturally differs run-to-run, ~15.0s here vs. ~14.9s in the report — not
a discrepancy).

```
$ node packages/quay-native/test/abi-symmetry.mjs
...
ALL FOUR SURFACES SYMMETRIC
```
All six checks (`task_list`, `task_get`, `task_write`,
`task_write_value_equivalence`, `task_write_extra_only_equivalence`,
`task_check`) independently re-run and each shows `"match": true`,
matching the report's characterization.

### 6. Claim 3 (test-coverage investigation) — one citation is factually wrong; the underlying code-level conclusion nonetheless holds.

Read `packages/quay/src/action.js` in full: `composePayload` (line 31) is
a pure function operating only on `providerManifest`/`task`/`actionId`,
with zero Provider-specific branching — confirmed directly.

Read `packages/quay-github/src/github-client.js:220`'s `computeStatusWrite`
in full: it takes only `{ currentLabelNames, status }`, with no
role/children parameter of any kind, and mutates a status label
uniformly. This is genuinely role/children-blind, exactly as the report
claims — cross-checked against `checkGate()`/`childrenStatus()`
(QN-035), which is where the role-aware gate logic actually lives, and
which has dedicated coverage in `packages/quay-github/test/compound-gate.test.mjs`.
**This part of claim 3 (the write/gate separation-of-concerns judgment)
is correct and well-supported.**

However, the report's specific test-citation for cross-Provider
`action run`/`composePayload` coverage does not hold up under direct
reading. The report states (iteration-53.md §3, lines 179-183, and
repeated in `provenance.md`'s Iteration 53 section):

> "`packages/quay/test/cli.test.mjs` (line 261: `quay action run --json`
> against `--provider github`, asserting the correct `status_skill_map`
> skill resolves for a real GitHub-backed task)"

Independent reading of `packages/quay/test/cli.test.mjs`:

```
$ sed -n '248,263p' packages/quay/test/cli.test.mjs
  // 6. `quay action run <id> advance --json` — composePayload() +
  //    deliverTrigger() reached without throwing; JSON output carries the
  //    expected fields.
  {
    const r = run(["action", "run", "CLI-1", "advance", "--json"], spawnOpts);
    assert(r.status === 0, "quay action run CLI-1 advance --json exits 0");
    ...
    assert(result.taskId === "CLI-1", "quay action run --json output includes taskId");
    assert(result.skill === "quay:execute", "quay action run --json output includes the correct status_skill_map skill (task is status:ready)");
    ...
```
`spawnOpts = { cwd: workspaceRoot, encoding: "utf8" }` (line 138) — no
`--provider` flag anywhere in this invocation, so it defaults to
`native`. `CLI-1` is created at line 129 via `execFileSync("node",
[nativeBin, "task", "create", "CLI-1", ...])` — it is a **native**-Provider
fixture task, not GitHub-backed.

The file's actual `--provider github` test is a separate test (test 8,
starting around line 273):

```
$ grep -n '"\-\-provider", "github"' packages/quay/test/cli.test.mjs
307:    const r = run(["task", "list", "--provider", "github", "--json"], spawnOpts);
```
Test 8 only exercises `task list`; it never calls `action run`. A
repo-wide search confirms there is no test anywhere combining `action
run`/`composePayload` with `--provider github`:

```
$ grep -rn "action.*run.*--provider\|--provider.*action" packages/quay-github/test/*.test.mjs packages/quay/test/*.test.mjs
(no output)
```

**Assessment.** This is a materially incorrect claim about what a
specific, named test file/line actually tests — the report attributes a
GitHub-backed `action run` assertion to a line that is in fact a
native-task assertion, and no such GitHub-backed `action run` test
exists anywhere in the codebase. This is exactly the class of
overstated/unverified evidentiary claim the audit history (iterations
50, 51) is sensitized to, though it differs in kind from those two
prior failures: those were fabricated *terminal-output* quotes (a
command was claimed to have been run and to have produced specific text
it did not produce); this is a false *characterization* of an existing,
correctly-quoted test file's content — no fake tool output is invoked or
quoted. The `grep -n "composePayload\|action_buttons\|status_skill_map"
packages/quay/test/*.test.mjs` command shown in the report's §3 was
genuinely run and its raw grep hits are accurately reproduced (I
independently re-ran it and got the same hit set) — but the report then
draws an incorrect inference from that hit list (specifically, about
what line 261's test actually covers) rather than reading the
surrounding test body carefully enough to notice `CLI-1` is native.

Because `composePayload` is a small, Provider-agnostic pure function
(confirmed by direct code reading above) and it is independently
end-to-end tested against a **real GitHub Provider's own manifest**
elsewhere in the suite — via `packages/quay-github/provider.yml`'s own
data flowing into `composePayload`-equivalent action-list logic,
although not via a dedicated `action run --provider github` CLI/MCP
integration test — the underlying code-level "no gap" conclusion is
still defensible on structural grounds (same generic function, same
manifest-shape contract, verified byte-identical in Finding 7 below).
But the report should not have cited a specific test line as proof of
"end-to-end" GitHub-backed action-run coverage when that specific test
does not exist. **This is the one concern that prevents a clean PASS.**

### 7. Claim 1 (provider.yml parity) — independently verified, holds exactly.

```
$ find . -name "provider.yml" -not -path "*/node_modules/*"
./packages/quay-github/provider.yml
./packages/quay-native/provider.yml
```
Both files read in full. `status_skill_map` in both:
```
status_skill_map:
  todo: "quay:author"
  ready: "quay:execute"
```
byte-identical. `action_buttons` in both:
```
action_buttons:
  - id: advance
    label: "Advance"
    payload: "Drive task {{id}} forward one status transition using its current status's Skill (see status_skill_map)."
    whenStatus: ["todo", "ready"]
```
byte-identical. Confirmed via direct diff-by-eye of both full files.

```
$ ls packages/quay-github/skills 2>&1
ls: cannot access 'packages/quay-github/skills': No such file or directory
```
No duplicate Skill directory exists — matches the report exactly.

```
$ grep -rn skills_path packages/*/src/*.js
(no output)
```
Zero consumers repo-wide — matches the report's citation exactly.
**Claim 1 fully holds.**

### 8. Claim 2 (DESIGN.md non-drift) — independently verified, holds.

```
$ grep -n "^#\|iteration [0-9]\|QN-0[0-9][0-9]" packages/quay/DESIGN.md | tail -20
```
produces output byte-identical to the report's quoted excerpt (diffed
programmatically against the report's text; zero differences).

Spot-checked QN citations against `git log --oneline --all`:

```
67177be Iteration 41: fix quay-github/provider.yml missing skills_path field (QN-052)
95c23e5 Iteration 38: fix stale provider.yml/DESIGN.md compound/epic gate scope comments (QN-049)
cdbacb2 Iteration 36: close the real-Claude-Code-session MCP-client tool-discovery gap for quay mcp (QN-047)
1edfb1a Iteration 18: resolve DIR-005 ... + QN-029 (quay-github skill capability via Skill-invocation provider parameterization)
1f3e27d Iteration 17: implement quay-github's gate capability (QN-028)
```
Every spot-checked QN-number/iteration pairing (QN-047/iter-36,
QN-049/iter-38, QN-052/iter-41, QN-028/iter-17, QN-029/iter-18)
corresponds to a real commit with matching iteration number. **Claim 2
fully holds** — no drift found in either file's body-content citations.

### 9. Claim 4 (live GitHub issue and manda dispatch re-checks) — independently re-run, matches exactly.

```
$ gh issue list --repo yaleh/quay --state all --json number,title,updatedAt
```
Issue #3: `"updatedAt":"2026-07-15T05:40:27Z"`; issue #4:
`"updatedAt":"2026-07-15T08:18:05Z"` — matches the report's quoted
values character-for-character, and matches iteration 52's own
independently-verified values (unchanged).

```
$ ps aux | grep manda-tools | grep -v grep
yale     1050926  0.0  0.0 1700580 7868 pts/1    Sl+  15:51   0:00 manda-tools mcp --self  --allow todo.write,todo.read,agent.spawn
yale     1085804  0.0  0.0 1700580 7744 pts/9    Sl+  15:58   0:00 manda-tools mcp --self  --allow todo.write,todo.read,agent.spawn
yale     1090943  0.0  0.0 1622540 7248 pts/6    Sl+  16:01   0:00 manda-tools mcp --self  --allow todo.write,todo.read,agent.spawn
```
Identical PIDs, identical empty `--self` substitution pattern, matching
the report and the standing wiring-gap diagnosis exactly. **Claim 4 fully
holds.**

### 10. Test-coverage supporting evidence — `wc -l` and `grep -c "test("` outputs independently reproduced exactly.

```
$ wc -l packages/quay/src/*.js packages/quay-github/src/*.js packages/quay-native/src/*.js
  109 packages/quay/src/action.js
   55 packages/quay/src/config.js
  382 packages/quay/src/mcp-server.js
   62 packages/quay/src/provider-client.js
   32 packages/quay/src/provider-env.js
  150 packages/quay/src/serve.js
  611 packages/quay-github/src/github-client.js
   16 packages/quay-github/src/manifest.js
  132 packages/quay-github/src/mcp-server.js
   17 packages/quay-native/src/manifest.js
  152 packages/quay-native/src/mcp-server.js
  496 packages/quay-native/src/store.js
 2214 total
```
Byte-identical to the report's quoted table.

```
$ grep -c "test(" packages/quay-github/test/mcp-server.test.mjs packages/quay-github/test/compound-gate.test.mjs packages/quay-github/test/write.test.mjs packages/quay-native/test/compound-gate.test.mjs packages/quay-native/test/compound-gate-recursive.test.mjs packages/quay-native/test/gate-gameability.test.mjs packages/quay-native/test/gate-checked-state.test.mjs
```
All seven return `0`, matching the report. Reading
`packages/quay-github/test/write.test.mjs`'s header confirms a custom
`function assert(cond, msg) { ...; console.error("FAIL: ..."); ...;
console.log("PASS: ..."); }` pattern — matches the report's
characterization exactly.

### 11. σ, V_instance, V_meta — independently recomputed, matches exactly.

```
σ = 49/56 = 0.875           (0.8750 as reported)
V_instance = 0.70 × 0.96 × 0.76 × 0.96 = 0.4903
V_meta      = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
```
Both reproduced exactly via direct arithmetic (Python), matching the
report and matching iteration 52's own values (unchanged, correctly,
since `git show --stat` confirms no source/Skill/gate file was touched).

### 12. V-factor flat-hold reasoning — correctly justified for 7 of 8 factors; `reusability`'s flat-hold rests partly on the miscited evidence in Finding 6.

`git show --stat 6324ff5` confirms only the iteration report and
provenance file were touched — this cleanly supports holding
`skeleton`, `abi_symmetry`, `skill_convergence`, `gate_correctness`,
`completeness`, `effectiveness`, and `validation` flat, per the same
reasoning already validated in the iteration-52 audit and re-confirmed
here. `reusability` (0.79, unchanged, 28th consecutive flat iteration)
is *correctly held flat* regardless — the report's own framing ("this is
confirmatory re-verification... not new transfer behavior... §5.2's
behavior-change requirement is not met") is the right reasoning
independent of the specific test-citation error in Finding 6, since flat
was the correct call either way (no new capability was built). The
citation error does not change the V-factor outcome, but it is evidence
that the "no gap found" investigation underlying that reasoning was
executed slightly less rigorously than claimed.

## Critical assessment

This iteration's #1 exposure, given the recent history, was whether
every *quoted terminal output* is genuine. On that specific axis, the
discipline held cleanly: every command I independently re-ran — `ls
experiments/quay-native-bootstrap/directives/pending/`, `git status --short`, `git log
--oneline`, `ls tasks/QN-*.md | wc -l`, the regression suite,
`abi-symmetry.mjs`, both `provider.yml` files, the `DESIGN.md` grep
(byte-identical to the report's quote via programmatic diff), `ls
packages/quay-github/skills` (not-found error), `grep -rn skills_path`,
`gh issue list` (exact timestamps), and `ps aux` (exact PIDs and
pattern) — reproduced exactly, several character-for-character. No
fabricated command-output claim was found anywhere in this report.

However, this audit's broader mandate ("scrutinize the four substantive
claims") surfaced a different kind of problem in claim 3: a specific,
named test-file/line citation ("`cli.test.mjs` line 261... against
`--provider github`... for a real GitHub-backed task") is factually
wrong. `CLI-1` is a native fixture; the file's actual `--provider
github` test never calls `action run`. This is a real accuracy defect —
not a fabricated tool-call transcript, but an incorrect claim about what
existing, correctly-quoted source material actually demonstrates. Given
this experiment's history of two prior audits catching exactly this
category of overclaim (misreading/misstating what code or a grep result
actually shows), this is flagged as a genuine concern rather than
waved through, even though it does not reach the severity of iterations
50/51's fabricated-output failures and does not change the correct
V-factor outcome (reusability was correctly held flat regardless).

## Net assessment

**Verdict: PASS WITH CONCERNS.**

The verbatim command-output discipline held cleanly across every
independently-reproduced command in this report — no fabricated or
misquoted terminal-output claim was found, extending the clean-audit
streak's discipline-on-quotes property for a second consecutive
iteration. Claims 1 (provider.yml parity), 2 (DESIGN.md non-drift), and
4 (live GitHub issue / manda dispatch re-checks) are all independently
verified and fully hold, several character-for-character. σ (49/56 =
0.8750), V_instance (0.4903), and V_meta (0.0973) are independently
reproduced exactly, and the flat-hold on all eight V-factors is
correctly justified by `git show --stat` showing no source/Skill/gate
file touched. The full regression suite (25/25) and ABI-symmetry check
both pass. The working tree is clean except the one known pre-existing
untracked file.

The concern: claim 3's test-coverage investigation cites
`packages/quay/test/cli.test.mjs` line 261 as proof of a real,
GitHub-backed `action run`/`composePayload` end-to-end test. This
citation is incorrect — that test runs against a native fixture task
with no `--provider` flag, and no test anywhere in the repository
combines `action run` with `--provider github`. The report's underlying
structural conclusion (no code-level Provider-specific branching gap in
`composePayload`) remains defensible on other grounds independently
verified in this audit (Finding 6), and the V-factor outcome this
citation was used to support (`reusability` held flat) was the correct
call regardless. But the specific evidentiary claim is false and should
be corrected in a future iteration's provenance note, consistent with
this experiment's own established practice of publishing explicit
post-hoc corrections (as done for iterations 50 and 51's false
grep-claims) rather than silently absorbing the error.

**Recommend:** the next iteration (or a dedicated correction commit)
should add a post-hoc correction to `provenance.md` narrowing claim 3's
`cli.test.mjs` citation to what it actually shows (a native-task `action
run` test plus a separate, unrelated `--provider github` `task list`
test), rather than leaving the overstated "GitHub-backed action run"
characterization uncorrected in the historical record.
