# Iteration 57 — Independent Out-of-Band Audit (G3)

**Verdict: PASS WITH CONCERNS**

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full (from disk,
gitignored), `experiments/quay-native-bootstrap/iterations/iteration-57.md` in full, and the tail
of `experiments/quay-native-bootstrap/provenance.md`. Did not trust the report's narration —
independently re-ran every cited command, independently read
`packages/quay/src/serve.js` and `packages/quay/src/provider-client.js` in
full, `packages/quay-github/src/mcp-server.js` and
`packages/quay-github/src/github-client.js`'s `list()`/`get()` bodies, and
the new `packages/quay/test/serve-github.test.mjs` line by line. Also
independently re-examined the exact task-gate-lifecycle claims of the
three cited precedent iterations (54/55/56) against their own source
text, which surfaced one material discrepancy (Finding 9 below).

## Findings

### 1. Preconditions — `ls experiments/quay-native-bootstrap/directives/pending/`, independently re-run, matches.

```
$ ls experiments/quay-native-bootstrap/directives/pending/
(no output, exit code 0)
```
Confirmed empty, matching the report's claim of self-selected work.

### 2. Prior-iteration git log — independently re-run, matches.

```
$ git log --oneline -3
383be83 Iteration 57: close Web-UI-layer cross-Provider GitHub test-coverage gap (QN-061)
a2a75d7 Add iteration-56 independent audit (PASS)
23aa9db Iteration 56: close MCP-layer cross-Provider GitHub aggregation test-coverage gap (QN-060)
```
Matches the report's stated chain (`a2a75d7`/`23aa9db`/`e6c16c5`).

### 3. Claim: no test file has ever spun up the Web UI against live GitHub — independently confirmed.

At the pre-iteration-57 commit (`a2a75d7`), listed all `packages/quay/test/`
and `packages/quay-native/test/` files and grepped for "github"
(case-insensitive) across every file in that directory:

```
$ git grep -il "github" a2a75d7 -- packages/quay/test/ packages/quay-native/test/
packages/quay/test/cli.test.mjs
packages/quay/test/config.test.mjs
packages/quay/test/mcp-server.test.mjs
```

Neither `serve.test.mjs`, `serve-browser-render.test.mjs`, nor
`core-three-way-symmetry.test.mjs` appears in that list — confirmed by
directly grepping each for "github" at `a2a75d7` (zero hits, all three).
Also walked the full `git log -p --all` history of each of those three
files for any "github" occurrence ever committed, at any point, on any
branch: `serve.test.mjs` and `serve-browser-render.test.mjs` have zero
hits in their entire history; `core-three-way-symmetry.test.mjs` has
exactly one hit, a header comment noting that "quay-github" is "untouched
-- additive, Core-layer-only" (i.e., a scope-boundary comment, not test
code exercising GitHub). The claim is independently verified correct: no
test file in this repo, at any point in its history, previously exercised
`quay serve`/`startServer()` against the live GitHub Provider.

### 4. New test file — independently read in full; genuinely exercises the Web UI via a real `quay serve` HTTP server against real issue `gh-3`, non-vacuously.

Read `packages/quay/test/serve-github.test.mjs` (157 lines) directly.
Confirmed:

- A dedicated `.quay/config.yml` fixture (lines 83-96) enables only the
  `github` Provider, with `QUAY_GITHUB_REPO: "yaleh/quay"` — a real,
  network-reaching config.
- `startServer({ port })` (line 103, imported directly from
  `../src/serve.js`) is the real production `serve.js` entry point — not
  a mock/stub — and real HTTP `GET` requests are issued via Node's
  `http.get` (lines 64-72), not simulated in-process calls.
- Assertions are non-vacuous: the list-route assertions check for the
  specific real task id `gh-3` AND the exact real live issue title string
  ("Fix MCP task_write silently dropping the extra field"), not just a
  200 status; the detail-route assertions check the same title string,
  the derived `[ready]` status label (from the real `status:ready`
  label), and the presence of the rendered `Advance` button tied to the
  real `action/advance` POST target.
- The POST `/task/:id/action/:actionId` route is explicitly and
  correctly NOT exercised, with an inline comment (lines 138-144)
  documenting the exclusion rationale.

Independently re-ran the file standalone:

```
$ node packages/quay/test/serve-github.test.mjs
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
quay serve: listening on http://localhost:43720
PASS: GET / returns 200 (got 200)
PASS: GET / body contains the real GitHub-backed task id gh-3
PASS: GET / body contains gh-3's real live title
PASS: GET /task/gh-3 returns 200 (got 200)
PASS: GET /task/gh-3 body contains gh-3's real live title
PASS: GET /task/gh-3 body reflects gh-3's real live derived status (ready, from its status:ready label)
PASS: GET /task/gh-3 renders the Advance action button (gh-3's live status 'ready' matches provider.yml's whenStatus)

All QN-061 live cross-Provider (GitHub) Web UI regression tests passed.
```
All 7 assertions pass, matching the report's quoted output exactly.

### 5. Critical safety check — independently traced the code path for the GET routes; confirmed genuinely read-only.

Read `packages/quay/src/serve.js` in full (150 lines) and
`packages/quay/src/provider-client.js` in full (62 lines).

- `GET /` (list route, lines 48-79 of `serve.js`): calls only
  `client.taskList({})` and (once, at startup) `client.manifest()`.
- `GET /task/:id` (detail route, lines 81-111): calls only
  `client.taskGet(id)` and `client.manifest()` (already fetched at
  startup, reused).
- `provider-client.js`'s `taskList()`/`taskGet()`/`manifest()` each issue
  a single read-only `callTool`/`readResource` call; `taskWrite()` (the
  sole write-capable function returned by `connectProvider()`) is never
  called from either GET route — independently confirmed by grepping
  `serve.js` for `taskWrite` (zero hits outside the function's own
  declaration).
- On the GitHub Provider side, read
  `packages/quay-github/src/github-client.js`'s `list()` (line 503) and
  `get()` (line 512) bodies directly: both call only `ghApiJson(...)`
  (a `gh api` GET-style read), with no `-X`/`PATCH`/`POST` mutation and
  no call to the module's own `setStatus`-style write function, which is
  a separate, later-declared function in the same file.
- The POST `/task/:id/action/:actionId` route (lines 113-133) calls
  `composePayload()` + `deliverTrigger()` (from `action.js`) — a real,
  non-idempotent trigger-delivery side effect, though it does not itself
  call `taskWrite`. This route is correctly and explicitly excluded from
  the new test file, with rationale matching `write.test.mjs`'s and
  iterations 55/56's established write-path exclusion precedent.

No reachable path from either tested GET route to a GitHub write call
exists. The exclusion of the POST route is correctly reasoned.

Independently confirmed no live-issue-state mutation occurred, checked
both before and after the test runs in this audit session:

```
$ gh issue view 3 --repo yaleh/quay --json number,state,labels
{"labels":[{"name":"status:ready",...},{"name":"lane:execution",...}],"number":3,"state":"OPEN"}
```
Identical label set and state before and after independently re-running
`node packages/quay/test/serve-github.test.mjs` and the full regression
suite — no write occurred.

### 6. Full regression suite — independently re-run, matches.

```
$ node --test packages/*/test/*.test.mjs
...
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
26/26 pass (up from 25), matching the report's quoted tail exactly.

### 7. Diff scope — independently confirmed test-file-only.

```
$ git diff --stat a2a75d7 383be83
 experiments/quay-native-bootstrap/iterations/iteration-57.md    | 508 +++++++++++++++++++++++++++++++
 experiments/quay-native-bootstrap/provenance.md                 | 210 +++++++++++++
 packages/quay/test/serve-github.test.mjs | 157 ++++++++++
 tasks/QN-061.md                          |  76 +++++
 4 files changed, 951 insertions(+)
```
Only one file under `packages/` changed (`serve-github.test.mjs`, a test
file); zero `src/*.js` files touched anywhere in the diff. Confirms the
report's "test-only change" claim independently.

### 8. Stray exploration-script claim — independently confirmed no artifact was left behind.

```
$ find . -iname "*manual-serve-github*" -not -path "./.git/*"
(no output)
$ git log --all --oneline -- packages/quay/manual-serve-github-check.mjs
(no output)
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
```
No file matching the throwaway exploration script's stated name exists
anywhere in the working tree, and it was never committed on any branch.
The working tree is clean modulo the one known pre-existing untracked
file. The claim is confirmed correct.

### 9. QN-061 task file/gate history — **discrepancy found: does NOT show a genuine two-gate transition lifecycle, and the report's claim of matching QN-060's convention is factually incorrect.**

```
$ cat tasks/QN-061.md
```
Frontmatter: `status: done`, Proposal/Plan/AC/DoD sections present, all
AC/DoD checkboxes checked.

```
$ node packages/quay-native/bin/quay-native.js task check QN-061 --json
{"id": "QN-061", "gate": "none", "ok": true, "reason": "terminal"}
```
This confirms only the final terminal state — it is not evidence of a
`todo → ready → done` lifecycle, since a task authored directly at `done`
also reports this.

```
$ git log --all --oneline -- tasks/QN-061.md
383be83 Iteration 57: close Web-UI-layer cross-Provider GitHub test-coverage gap (QN-061)
```
Only one commit touches this file, ever — it was created already at
`status: done`. The iteration-57 report's §6 states this directly: "Gated
(task authored directly at terminal status; `task check` on a
`done`-status task correctly reports no pending gate)" — there is no
`author->ready` or `execute->done` gate check quoted anywhere in the
report, unlike iterations 54/55/56's own QN-058/059/060 records.

**This directly contradicts the report's own characterization.** The
report states (iteration-57.md §6): "Created `tasks/QN-061.md` directly
with Proposal/Plan/AC/DoD sections documenting exactly the work in §3-§5
above (authored at `status: done`, reflecting already-completed,
already-verified work — **matching QN-060's own recording convention**)."
Independently re-read iteration-56.md's own §6 (the actual QN-060 record)
to check this claim:

```
Gated `author->ready`:
$ node packages/quay-native/bin/quay-native.js task check QN-060 --json
{"id": "QN-060", "gate": "author->ready", "ok": true,
 "artifacts": {...all four present...},
 "reason": "all four artifacts present; eligible to move to ready"}
Transitioned `todo -> ready` via `task edit QN-060 --status ready`.

Gated `execute->done`:
$ node packages/quay-native/bin/quay-native.js task check QN-060 --json
{"id": "QN-060", "gate": "execute->done", "ok": true,
 "acTotal": 4, "acChecked": 4,
 "reason": "all AC checkboxes checked; eligible to move to done"}
Transitioned `ready -> done` via `task edit QN-060 --status done`.
```

QN-060 genuinely went through both real gate checks (`author->ready` then
`execute->done`), each with its own distinct `ok:true` result and
gate-specific reason, via real `task edit --status ready` /
`--status done` transitions during the session. Independently confirmed
the identical two-gate pattern also holds for QN-058 (iteration-54.md)
and QN-059 (iteration-55.md) — both quote `Gated \`author->ready\`` /
`Transitioned \`todo -> ready\`` blocks verbatim. **All three cited
precedent tasks (QN-058/059/060) were genuinely gated through both
transitions; QN-061 was not.** QN-061 skips the `author->ready` gate
check entirely and is authored directly at the terminal state with a
single vacuous "terminal, no pending gate" check — this is a real
reduction in rigor relative to the precedent it claims to follow, and the
claim "matching QN-060's own recording convention" is **not accurate**.

This is a process/documentation-accuracy concern, not a safety or
correctness concern: the underlying AC/DoD checkboxes are genuinely all
checked, and independent review of §3-§5 confirms the work was in fact
done and verified as claimed. But it is a factual misstatement in the
report that a careful independent audit should not wave through, and it
represents a small erosion of the gate-lifecycle discipline the previous
three-iteration clean streak had established and maintained.

### 10. Precedent search for `skeleton +0.01` (rejecting `abi_symmetry`) — independently confirmed sound.

Independently re-read `packages/quay/test/core-three-way-symmetry.test.mjs`'s
own header (lines 1-30): it explicitly scopes its own symmetry claim to
"CLI vs. Core MCP vs. Web UI... task-list rendering, task-detail
rendering, and action-button triggering" — a claim about whether three
bindings' *content* agrees with each other for the *same* underlying
data, exercised entirely against **one** Provider (native, per its own
fixture). This is a genuinely different claim from "does the Web UI
binding itself correctly connect to and render data from a *second, live*
Provider" — which is what `serve-github.test.mjs` proves, and which is
exactly the `skeleton`-shaped claim (the v0 loop's `serve` stage
functioning end-to-end). This is the identical distinction iteration 56
drew (and this audit's predecessor confirmed sound) between
`abi-symmetry.mjs` (single-Provider CLI/MCP schema comparability) and
`mcp-server.test.mjs`'s new cross-Provider aggregation test. Independently
confirmed the precedent chain: iterations 24, 37, 54, 55, 56 (QN-034,
048, 058, 059, 060) all scored `skeleton +0.01` for structurally identical
test-coverage-only additions. The reasoning for rejecting `abi_symmetry`
here is sound and consistent with that chain; `skeleton` is the correct
factor.

### 11. σ_strict arithmetic — independently reproduced.

```
$ ls tasks/QN-*.md | wc -l
60
$ python3 -c "print(52/59, 53/60)"
0.8813559322033898 0.8833333333333333
```
Matches the report's `52/59 = 0.8814 → 53/60 = 0.8833` exactly, and the
denominator (60) is independently confirmed.

### 12. V_instance / V_meta arithmetic — independently reproduced.

```
$ python3 -c "print(round(0.74*0.96*0.76*0.96,4))"
0.5183
$ python3 -c "print(round(0.74*0.26*0.79*0.64,4))"
0.0973
```
`V_instance = 0.5183` matches exactly (up from 0.5113, ΔV_instance =
+0.0070). `V_meta = 0.0973` matches exactly and is confirmed unchanged
from iteration 56's value.

### 13. `git status --short` — independently confirmed clean, modulo the one known file.

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
```
Matches exactly the one pre-existing, deliberately-untouched untracked
file carried forward from prior iterations/audits. No other changes,
before or after this audit's own command re-runs.

## Net assessment

**Verdict: PASS WITH CONCERNS.**

Iteration 57 correctly identified a genuine, previously-real,
self-documented test-coverage gap: the Web UI (`quay serve`) had never
been exercised end-to-end against the live GitHub Provider by any test
file in the repo's history — independently confirmed by grepping the
full pre-iteration test directory and by walking the entire git history
of `serve.test.mjs`, `serve-browser-render.test.mjs`, and
`core-three-way-symmetry.test.mjs` for any "github" occurrence (found
none in test code). The new `serve-github.test.mjs` was read in full and
independently re-run standalone: it genuinely spins up the real
`startServer()` HTTP server backed by the real, live GitHub Provider
against real issue `gh-3`, and all 7 assertions are meaningful (real
title strings, real derived status, real button presence), not vacuous.

The critical safety check was independently traced at the source level
(`serve.js`, `provider-client.js`, `github-client.js`'s `list`/`get`
bodies): the tested GET routes route only through read-only Provider
calls, with no reachable path to a write call; the POST action-delivery
route is correctly identified as write-capable (a real, non-idempotent
trigger-delivery side effect) and correctly excluded. Live issue #3's
label set and state were independently confirmed byte-identical before
and after this audit's own re-runs — no live-issue-state mutation
occurred. No stray exploration artifact (`manual-serve-github-check.mjs`
or similar) exists anywhere in the working tree or git history. The full
regression suite independently reproduces 26/26. The `skeleton +0.01`
scoring (rejecting `abi_symmetry`) is independently judged sound and
consistent with the five-iteration precedent chain (24/37/54/55/56). All
arithmetic (σ_strict, V_instance, V_meta) is independently reproduced
exactly, and `git status --short` is clean modulo the one known
pre-existing file.

**One concern prevents an unqualified clean PASS.** QN-061's task
file/gate history does **not** show a genuine `todo → ready → done`
lifecycle: it was authored directly at terminal `status: done` in a
single commit, with only a single vacuous "terminal, no pending gate"
`task check` result — never a distinct `author->ready` gate check nor an
`execute->done` gate check. The report explicitly (and incorrectly)
claims this "match[es] QN-060's own recording convention"; independent
re-reading of iteration-56.md (and, for corroboration, iteration-54.md
and iteration-55.md) shows QN-058/059/060 were each genuinely gated
through **both** transitions, with distinct, gate-specific `ok:true`
results quoted for each, via real `task edit --status ready` /
`--status done` commands during the session. QN-061 skips this entirely.
This does not affect safety (no GitHub write occurred; regression suite
passes) or the underlying correctness of the work (AC/DoD checkboxes
genuinely reflect completed, verified work per independent review of
§3-§5), but it is a factual misstatement in the report about matching an
established precedent, and a real (if narrow) erosion of the
gate-lifecycle rigor the prior three-iteration clean-audit streak (54,
55, 56) maintained. The next iteration, and any that similarly author a
task directly at a terminal status, should either (a) genuinely run both
gate transitions before setting the file to `done`, or (b) stop claiming
this matches a precedent that itself ran both transitions.

No fabricated command output, no false test-content characterization,
and no operational side-effect risk were found. This ends the
three-consecutive-clean-PASS streak (iterations 54, 55, 56) with a
PASS-with-concerns rather than a fourth unqualified clean PASS, on the
strength of Finding 9 alone — all other findings independently confirm
the iteration's substantive work was done correctly and safely.
