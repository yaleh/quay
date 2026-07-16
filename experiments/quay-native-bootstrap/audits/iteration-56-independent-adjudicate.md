# Iteration 56 — Independent Out-of-Band Audit (G3)

**Verdict: PASS**

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full (from disk,
gitignored), `experiments/quay-native-bootstrap/iterations/iteration-56.md` in full, and the
tail of `experiments/quay-native-bootstrap/provenance.md` (the "Iteration 56" section plus enough
of iteration 55's carried-forward text for context). Did not trust the
report's narration — independently re-ran every cited command,
independently read `experiments/quay-native-bootstrap/iterations/iteration-26.md` §5c-5g,
`packages/quay/src/mcp-server.js` in full, `packages/quay-github/src/
github-client.js`, and the new block 10 in `packages/quay/test/
mcp-server.test.mjs` line by line, and independently confirmed the git
history of that test file shows no prior automated GitHub-provider
coverage.

Given this iteration's central claim — four MCP tools (`task_list`/
`task_get`/`task_check`/`action_list`) now run live against a real,
shared, external GitHub issue (`gh-3` in `yaleh/quay`) through the real
`quay mcp` aggregation subprocess on every future `node --test`
invocation — this audit gave the read-only-safety claim its own
dedicated, maximum-scrutiny check (Finding 6 below), independent of the
report's own characterization.

## Findings

### 1. Preconditions — `ls experiments/quay-native-bootstrap/directives/pending/`, independently re-run, matches.

```
$ ls experiments/quay-native-bootstrap/directives/pending/
(no output, exit code 0)
```
Confirmed empty, matching the report's claim of self-selected, non-directive-driven work.

### 2. Prior-iteration git log — independently re-run, matches.

```
$ git log --oneline -3 (as of the state prior to this audit)
23aa9db Iteration 56: close MCP-layer cross-Provider GitHub aggregation test-coverage gap (QN-060)
e6c16c5 Add iteration-55 independent audit (PASS)
91b79f1 Iteration 55: systematic sweep closes task view/action list/task check --provider github coverage gap (QN-059)
```
Matches the report's stated commit chain (`e6c16c5`/`91b79f1`/`06efe94`).

### 3. Claim: MCP-level GitHub aggregation was previously verified only by hand at iteration 26 — independently confirmed.

Read `experiments/quay-native-bootstrap/iterations/iteration-26.md` §5c-5g (the section headed
"Execution", the live-verification subsections) in full. Confirmed
verbatim: §5d describes a one-time manual live check with
`.quay/config.yml`'s `github.enabled` "temporarily flipped `false → true`
... for the duration of this check only", exercising `task_list`/
`task_get`/`task_check` against the real `yaleh/quay` repo (fixture
`gh-7`/`gh-5`/`gh-6`), §5e cross-checks byte-identically against
`quay-github mcp` directly, and §5g confirms `.quay/config.yml` was
restored to its original state and diffed byte-identical. §5h then
describes the **committed** regression test (`mcp-server.test.mjs`) as
using "two independently-seeded native task stores configured as two
distinct `enabled: true` Providers (`native`/`native-2`)... with **zero
external-network dependency**" — i.e., the committed automated test
deliberately did NOT exercise live GitHub.

Independently confirmed via git history that no commit between iteration
26 and iteration 56 added GitHub-provider test coverage to this file:

```
$ git log --oneline --follow -- packages/quay/test/mcp-server.test.mjs
23aa9db Iteration 56: close MCP-layer cross-Provider GitHub aggregation test-coverage gap (QN-060)
3f133bc Iteration 33: close DIR-010 (Core CLI/MCP/Web-UI three-way symmetry, QN-044)
6848cd3 Iteration 32: close QN-043 (Core MCP task_write expectedStatus/CAS live-verification)
79b0515 Iteration 30: close DESIGN.md §2.5's manifest name/uri test-coverage gap (QN-041)
355e06f Iteration 26: implement Core's own MCP server (quay mcp, DIR-007)
```

```
$ git log -p --follow -- packages/quay/test/mcp-server.test.mjs | grep -n "provider.*github\|gh-3\|status:.*github"
```
The only pre-56 occurrence of "github" in this file's entire history is
the header-comment acknowledgment that live GitHub aggregation was
"separately live-verified by hand this iteration [26]" — zero test code
in commits 355e06f/79b0515/6848cd3/3f133bc exercises a live GitHub
Provider. The claim is independently verified correct.

### 4. New test block 10 — independently read in full; genuinely exercises the four read-only tools via a real `quay mcp` subprocess against real issue `gh-3`, non-vacuously.

Read lines 364-445 of `packages/quay/test/mcp-server.test.mjs` (block 10)
directly. Confirmed:

- `coreBin` (line 80, `path.join(__dirname, "..", "bin", "quay.js")`) is
  the real Core `quay` CLI's `mcp` subcommand entry — the connection at
  line 394, `connectStdio("node", [coreBin, "mcp"], ghWorkspaceRoot)`,
  spawns the real `quay mcp` aggregation server as a subprocess, not a
  direct `quay-github mcp` spawn and not a mock/stub.
- The dedicated `.quay/config.yml` fixture (lines 374-392) enables both
  `native` and `github` Providers, with `QUAY_GITHUB_REPO: "yaleh/quay"`
  — a real, network-reaching GitHub Provider config, matching
  `cli.test.mjs`'s own established per-block github-fixture convention.
- Each of the four assertions blocks is non-vacuous: `task_list` checks
  a non-empty array AND that it contains `gh-3` specifically (not just
  "array exists"); `task_get` checks the real id, a non-empty title
  string, and the real live status value; `task_check` checks
  `isError !== true`, the specific `ok === false` value for gh-3's
  actual unchecked-AC state, and that `acTotal`/`acChecked` are real
  numbers; `action_list` checks the presence of the specific `"advance"`
  button id. None of these assertions would pass against an empty/stub
  response.
- `task_write`/`action_run` are explicitly NOT exercised in this block
  (confirmed by their absence from block 10's body), with an inline
  comment (lines 435-441) documenting the exclusion rationale.

Independently re-ran the file standalone:

```
$ node packages/quay/test/mcp-server.test.mjs
...
quay mcp: aggregating enabled providers [native, github] (default: native)
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS: task_list via quay mcp (provider=github) returns real, non-empty task data aggregated live from the yaleh/quay repo
PASS: task_list via quay mcp (provider=github) includes the real, live gh-3 task
PASS: task_get via quay mcp (provider=github) returns gh-3's real id
PASS: task_get via quay mcp (provider=github) returns a non-empty title read live from the real issue
PASS: task_get via quay mcp (provider=github) reflects gh-3's real live status (got ready)
PASS: task_check via quay mcp (provider=github) does not error for gh-3 (the gate itself may still report ok:false)
PASS: task_check via quay mcp (provider=github) reports ok:false for gh-3's real, currently-unchecked AC state (got {"id":"gh-3","gate":"execute->done","ok":false,"acTotal":4,"acChecked":0,"reason":"0/4 AC checkboxes checked"})
PASS: task_check via quay mcp (provider=github) reports real numeric acTotal/acChecked counts read live from the issue body
PASS: action_list via quay mcp (provider=github) includes the "advance" button for gh-3 (its real live status is in the button's whenStatus); got {"buttons":[{"id":"advance","label":"Advance","payload":"Drive task {{id}} forward one status transition using its current status's Skill (see status_skill_map).","whenStatus":["todo","ready"]}]}

All QN-036 Core MCP server (DIR-007) tests passed.
```
Exact match to the report's quoted output.

### 5. Critical safety check — independently traced the code path for all four tools; confirmed genuinely read-only.

Read `packages/quay/src/mcp-server.js` in full (383 lines).

- `task_list` (lines 149-168): calls only `client.taskList({ status,
  label })`.
- `task_get` (lines 170-195): calls only `client.taskGet(id)`.
- `task_check` (lines 236-262): calls only `client.taskCheck(id)`.
- `action_list` (lines 274-305): calls only `client.manifest()` and
  `client.taskGet(id)`, applies a local `whenStatus` filter — no client
  call beyond those two reads.

None of these four call `client.taskWrite()` or `deliverTrigger()`.

Read `packages/quay-github/src/github-client.js`: `createGithubClient()`
(line 473) returns exactly `{ list, get, setStatus, check }` (line 610) —
`setStatus` (line 536) is the **sole** function that performs a GitHub
write (via `computeStatusWrite()`/`gh api` label mutation). `list`/`get`/
`check` never call `setStatus` internally (independently grepped: no
call to `setStatus` inside `list`, `get`, or `check`'s own bodies). Since
`task_list`/`task_get`/`task_check`/`action_list` route only through
`list`/`get`/`check`/`manifest` (never `setStatus`/`taskWrite`), there is
no reachable path from any of the four newly-tested tools to a GitHub
write call.

By contrast, `task_write` (lines 201-234) calls `client.taskWrite()`
directly — the sole write-capable passthrough — and `action_run` (lines
316-361) calls `composePayload()` + `deliverTrigger()`, which for a
resolved Skill triggering a real write-back would eventually reach
`setStatus()`. Both are correctly and explicitly excluded from live
GitHub testing in block 10, with the same rationale `write.test.mjs` and
iteration 55's `task edit --provider github` exclusion used. This
exclusion reasoning is independently confirmed correct.

Independently confirmed no live-issue-state mutation occurred, checked
both before running the test suite and after:

```
$ gh issue view 3 --repo yaleh/quay --json number,state,labels,updatedAt
{"labels":[{"name":"status:ready",...},{"name":"lane:execution",...}],
 "number":3,"state":"OPEN","updatedAt":"2026-07-15T05:40:27Z"}
```
Identical label set, state, and `updatedAt` timestamp before and after
independently re-running `node packages/quay/test/mcp-server.test.mjs`
and the full regression suite in this audit session — no write occurred.

### 6. Full regression suite — independently re-run, matches.

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
25/25 pass, matching the report's quoted tail exactly.

### 7. QN-060 provenance/lifecycle — independently confirmed.

```
$ cat tasks/QN-060.md
```
Frontmatter: `status: done`, Proposal/Plan/AC/DoD sections present, all
four AC checkboxes and both DoD checkboxes checked (`[x]`).

```
$ node packages/quay-native/bin/quay-native.js task check QN-060 --json
{"id":"QN-060","gate":"none","ok":true,"reason":"terminal"}
```
Confirms QN-060 is now correctly in its terminal (`done`) state with
`ok:true`. The report's own §6 quotes the two gate checks at the time of
transition (`author->ready`, `ok:true`, all four artifacts present; then
`execute->done`, `ok:true`, 4/4 AC checked) — both are consistent with
the final terminal state observed here. Provenance table entry
(`author_by: native, execute_by: native, gate_by: native, status: done`)
matches `provenance.md`'s corresponding row.

```
$ ls tasks/QN-*.md | wc -l
59
```
Confirms σ denominator independently.

### 8. Precedent search for `skeleton +0.01` — independently confirmed as the correct, closest precedent.

Independently grepped iterations 24, 37, 54, 55 and confirmed each
scored `skeleton +0.01` for a structurally identical pattern (a
test-coverage-only regression-test addition, live against real
`yaleh/quay` data, zero source-code change):

```
iteration-24.md:454: skeleton: 0.65 (up from 0.64, Δ +0.01)
iteration-37.md:276: skeleton: 0.69 → 0.70 (+0.01)
iteration-54.md:329: scored skeleton +0.01
iteration-55.md:316: all three scored skeleton +0.01
```

Iteration 56's own §7 reasoning — explicitly considering and rejecting
`abi_symmetry` (on the grounds that `abi-symmetry.mjs` measures
CLI-output-vs-MCP-output schema comparability for a single Provider, not
cross-Provider aggregation-routing correctness) and `gate_correctness`
(no `checkGate()`/`store.js`/`github-client.js` logic changed) — was
independently re-examined against `abi-symmetry.mjs`'s actual source and
found sound: that file's assertions do compare CLI-JSON output to
MCP-tool output for the *same* Provider connection, not fan-out/routing
behavior across Providers. `skeleton` remains the correct factor.

V_meta factors (`completeness`/`effectiveness`/`reusability`/
`validation`) are all explicitly held flat with reasoning consistent
with the established precedent (test-coverage-only, no new
orchestration-Skill content, no new capability built, no new audit yet
existing) — correctly reflecting "no capability change."

### 9. σ_strict arithmetic — independently reproduced.

```
$ ls tasks/QN-*.md | wc -l
59
$ python3 -c "print(51/58, 52/59)"
0.8793103448275862 0.8813559322033898
```
Matches the report's `51/58 = 0.8793 → 52/59 = 0.8814` exactly.

### 10. V_instance / V_meta arithmetic — independently reproduced.

```
$ python3 -c "print(round(0.73*0.96*0.76*0.96,4))"
0.5113
$ python3 -c "print(0.74*0.26*0.79*0.64)"
0.09727744000000002
```
`V_instance = 0.5113` matches exactly. `V_meta = 0.0973` (rounds
correctly) matches exactly, and is confirmed unchanged from iteration
55's value.

### 11. Verbatim command-output quoting — spot-checked, genuine.

Re-ran independently and compared byte-for-byte against the report's
quoted transcripts for: `ls experiments/quay-native-bootstrap/directives/pending/` (§2 of
report), the standalone `mcp-server.test.mjs` run (§5), the full
regression suite tail (§5), and `gh issue view 3` (§5/§9). All matched.
The report's description of the new test block's actual content (§4/§5
of the report, and the file's own header comment) matches the real test
body read directly in this audit (Finding 4 above) — no
summary-vs-content mismatch of the kind iteration 53 flagged as a risk.

### 12. `git status --short` — independently confirmed clean, modulo the one known file.

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
```
Matches exactly the one pre-existing, deliberately-untouched untracked
file carried forward from prior iterations/audits. No other changes.

### 13. Diff scope — independently confirmed test-file-only.

```
$ git diff e6c16c5 23aa9db --stat
 experiments/quay-native-bootstrap/iterations/iteration-56.md  | 526 +++++++++++++++++++++++++++++++++
 experiments/quay-native-bootstrap/provenance.md               | 156 ++++++++++
 packages/quay/test/mcp-server.test.mjs | 105 +++++++
 tasks/QN-060.md                        |  73 +++++
 4 files changed, 860 insertions(+)
```
Only one file under `packages/` changed (`mcp-server.test.mjs`, test
file); no `src/*.js` file in any package was touched. Confirms the
report's "test-file-only change" claim independently.

## Net assessment

**Verdict: PASS.**

Iteration 56 correctly identified a genuine, previously-real,
self-documented test-coverage gap: `quay mcp`'s Core-level GitHub
fan-out/aggregation path had been proven exactly once, by hand, at
iteration 26, and never captured as an automated regression test since —
independently confirmed by reading iteration 26's §5c-5g in full and by
walking this test file's entire git history (five commits, zero prior
GitHub-provider test code). The new block 10 in `mcp-server.test.mjs`
was read in full and independently re-run: it genuinely spawns the real
`quay mcp` aggregation subprocess (not `quay-github mcp` directly, not a
mock) against the real, live `yaleh/quay` issue `gh-3`, and every
assertion is meaningful (specific ids, non-empty strings, specific
boolean/numeric gate values, specific button ids) rather than vacuous.

The critical safety check was independently traced at the source level
(`mcp-server.js` + `github-client.js` in full): all four newly-tested
tools (`task_list`/`task_get`/`task_check`/`action_list`) route only
through `list`/`get`/`check`/`manifest`, never `setStatus`/`taskWrite` —
no reachable write path exists. `task_write`/`action_run` are correctly
identified as the sole write-capable paths and correctly excluded, with
sound rationale. Live issue #3's label set, state, and `updatedAt`
timestamp were independently confirmed byte-identical before and after
this audit's own full-suite and standalone re-runs — no live-issue-state
mutation occurred.

The `skeleton +0.01` precedent (iterations 24/37/54/55, QN-034/048/
058/059) was independently confirmed as the correct, closest precedent,
including the reasoned and correct rejection of `abi_symmetry` as the
alternative factor. All arithmetic (σ_strict, V_instance, V_meta) is
independently reproduced exactly. QN-060's task file and gate history
show a genuine `todo → ready → done` lifecycle, both gates `ok:true` at
the time they were checked, now correctly terminal. The full regression
suite (25/25) passes, the working tree is clean modulo the one known
pre-existing untracked file, and the diff is confirmed test-file-only.

No fabricated command output, no false test-content characterization, no
misapplied precedent, and **no operational side-effect risk** were found
anywhere in this iteration's work. This is the third consecutive clean,
unqualified PASS (following iteration 54's `06efe94` and iteration 55's
`e6c16c5`), extending the clean-audit streak to 3.
