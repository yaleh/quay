# Iteration 55: systematic sweep for cross-Provider test-coverage gaps (QN-059); closes task view/action list/task check `--provider github`; skeleton +0.01

**Date**: 2026-07-15
**Driver**: quay:author + quay:execute (native, self-selected work following a systematic sweep of the test suite; `experiments/quay-native-bootstrap/directives/pending/` empty)
**Stage**: 2+ (native and GitHub Providers both exist). This iteration performs the systematic sweep iteration 54's closure invited — "are there other Provider-parameterized commands... that might have an analogous only-tested-against-one-Provider gap?" — and closes what that sweep found.

## 1. Context from prior iteration

Iteration 54 ended with: σ (strict) = 50/57 = 0.8772, V_instance = 0.4973
(0.71 × 0.96 × 0.76 × 0.96), V_meta = 0.0973 (0.74 × 0.26 × 0.79 × 0.64),
all 5 convergence criteria scored NO. Iteration 54 itself closed an
audit-discovered gap (`action run --provider github` had zero test
coverage) and flagged that the same fact pattern might recur elsewhere.
Its own out-of-band audit (`06efe94`, read in full this session) returned
a clean **PASS** (not "PASS WITH CONCERNS" — the first clean PASS since
iteration 52), confirming QN-058's test is genuine, safe, and correctly
scored `skeleton +0.01`.

## 2. Preconditions checked

```
$ ls experiments/quay-native-bootstrap/directives/pending/
```
produced no output (exit code 0) — confirmed **empty**.

`docs/proposal/quay-bootstrap-experiment.md` (read fresh from disk in
full this session, gitignored, 233 lines), `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`,
`experiments/quay-native-bootstrap/iterations/iteration-54.md`, and the tail of
`experiments/quay-native-bootstrap/provenance.md` were all read fresh this session, verbatim.

```
$ git log --oneline -3
06efe94 Add iteration-54 independent audit (PASS)
85d7741 Iteration 54: close audit-discovered action-run/github test-coverage gap (QN-058)
98ab6ab Correct iteration 53's false test-coverage citation for action run/github
```

```
$ gh auth status
github.com
  ✓ Logged in to github.com account yaleh (/home/yale/.config/gh/hosts.yml)
  - Active account: true
  - Git operations protocol: https
  - Token scopes: 'codespace', 'gist', 'read:org', 'repo', 'workflow'
```

```
$ ls tasks/QN-*.md | wc -l
57
```
(before this iteration's work; 58 after QN-059 was created.)

## 3. Observe — systematic sweep for the analogous gap

The standing instruction asked whether other Provider-parameterized
commands (e.g. `task list`/`task get`/`task edit`) might have an
analogous "only tested against one Provider end-to-end" gap, and to
actually check the test suite systematically rather than assume.

Read `packages/quay/bin/quay.js` in full (203 lines) to enumerate its
complete branch table: `task list`, `task view`, `task edit`, `task
check`, `action list`, `action run`, `serve`, `mcp` — 6 Provider-
parameterized subcommands plus 2 provider-agnostic ones.

```
$ grep -n "provider.*github\|github.*provider" packages/quay/test/*.test.mjs
```
(full output inspected) confirmed only two subcommands had ever been
spawned with `--provider github`: `task list` (test 8, since iteration 29)
and `action run` (test 10, added iteration 54). `task view`, `task edit`,
`task check`, and `action list` had **zero** cross-Provider test
coverage anywhere in the suite.

Before assuming this was a genuine, closeable gap (not a correctly-
excluded one, per the standing discipline of reading full test bodies
rather than inferring from grep hits), checked whether each untested
subcommand is safe to test against a real, live issue:

- Read `bin/quay.js`'s `task view`/`action list`/`task check` branches in
  full: each calls only `client.taskGet()` / `client.manifest()` /
  `client.taskCheck()` — no `client.taskWrite()` call anywhere in their
  control flow.
- Read `packages/quay-github/src/github-client.js` in full (327 lines):
  confirmed `checkGate()` (backing `task_check`) only reads the issue
  body via `gh api`, never writes; `computeStatusWrite()` (backing
  `task_write`/`task edit`) is the only write path, and it is used
  exclusively by `task edit`.
- Read `packages/quay-github/test/write.test.mjs`'s own header comment:
  it explicitly documents the project's standing convention — "this
  repo's real issue count is too small/precious to safely target with
  destructive live writes in an automated, repeatable test file" — and
  tests `computeStatusWrite()` only as an injected pure function, never
  live. This is a directly on-point precedent: `task edit --provider
  github` should remain excluded from live-issue end-to-end testing for
  the same reason, at the Core CLI layer too.

Conclusion: `task view`, `action list`, and `task check` are genuinely
closeable, safe gaps (read-only); `task edit` is a genuinely, correctly
excluded gap (real write path, matches existing precedent). This is not
manufactured work — it is a concrete, previously-uncredited coverage gap
found by systematically reading the actual branch table and the actual
test file contents, exactly the same class of discovery iteration 54's
own gap was.

Manually exercised all three live against real issue `gh-3` before
writing any test code:

```
$ QUAY_GITHUB_REPO=yaleh/quay node packages/quay/bin/quay.js task view gh-3 --json --provider github
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
{
  "id": "gh-3",
  "title": "Fix MCP task_write silently dropping the extra field",
  "status": "ready",
  ...
}
```

```
$ QUAY_GITHUB_REPO=yaleh/quay node packages/quay/bin/quay.js action list gh-3 --json --provider github
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
[
  {
    "id": "advance",
    "label": "Advance",
    "payload": "Drive task {{id}} forward one status transition using its current status's Skill (see status_skill_map).",
    "whenStatus": [
      "todo",
      "ready"
    ]
  }
]
```

```
$ QUAY_GITHUB_REPO=yaleh/quay node packages/quay/bin/quay.js task check gh-3 --json --provider github
```
(exit code 1)
```
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
{
  "id": "gh-3",
  "gate": "execute->done",
  "ok": false,
  "acTotal": 4,
  "acChecked": 0,
  "reason": "0/4 AC checkboxes checked"
}
```

This confirmed `task check` against gh-3 exercises the FAIL branch — a
different, previously-untested shape from test 10's `action run` path
(which only ever exercises the ready-status/advance-button branch).

## 4. Strategy

Add a new test block (test 11) to `packages/quay/test/cli.test.mjs`,
matching the existing test 8/10 style and fixture conventions exactly
(same `.quay/config.yml` github-provider fixture, same real issue
`gh-3`), covering `task view`, `action list`, and `task check`, all
`--provider github`, against `gh-3`. Explicitly document, in the test
file itself, why `task edit --provider github` remains excluded, citing
`write.test.mjs`'s own precedent directly rather than inventing new
reasoning.

## 5. Execution

Added test 11 to `packages/quay/test/cli.test.mjs` (three sub-blocks:
11a `task view`, 11b `action list`, 11c `task check`), each spawning
`bin/quay.js` for real against `gh-3` with `--provider github`, asserting:

- 11a: exit 0, parseable JSON, `id === "gh-3"`, non-empty `title`,
  `status === "ready"` (gh-3's real live status).
- 11b: exit 0, JSON array, includes the `advance` button (gh-3's real
  live status is in its `whenStatus`).
- 11c: exit 1 (mirrors `result.ok === false`, since gh-3's real AC state
  is currently 0/4 checked), parseable JSON, `id === "gh-3"`,
  `ok === false`, numeric `acTotal`/`acChecked` fields.

Full regression suite, re-run after the change:
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
ℹ duration_ms 21110.898954
```

`abi-symmetry.mjs`, re-run:
```
$ node packages/quay-native/test/abi-symmetry.mjs
...
ALL FOUR SURFACES SYMMETRIC
```

Standalone run of `cli.test.mjs`, verbatim tail (test 11's 11 new
sub-assertions):
```
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS: quay task view gh-3 --json --provider github exits 0 (real GitHub-backed task, end-to-end)
PASS: quay task view --json --provider github emits parseable JSON output
PASS: quay task view --json --provider github output includes the real GitHub taskId (gh-3)
PASS: quay task view --json --provider github output includes a non-empty title read live from the real issue
PASS: quay task view --json --provider github reflects gh-3's real live status (got ready)
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS: quay action list gh-3 --json --provider github exits 0 (real GitHub-backed task, end-to-end)
PASS: quay action list --json --provider github emits a JSON array
PASS: quay action list --json --provider github includes the 'advance' button for gh-3 (whenStatus includes its real live status 'ready')
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
PASS: quay task check gh-3 --json --provider github exits 1 (mirrors result.ok for gh-3's real, currently-unchecked AC state)
PASS: quay task check --json --provider github emits parseable JSON output
PASS: quay task check --json --provider github output includes the real GitHub taskId (gh-3)
PASS: quay task check --json --provider github reports ok:false for gh-3's real, currently-unchecked AC state
PASS: quay task check --json --provider github reports real acTotal/acChecked counts read live from the issue body

All QN-033 bin/quay.js CLI dispatch tests passed.
```

`git diff --stat` confirms the change is test-file-only:
```
$ git diff --stat -- packages/
 packages/quay/test/cli.test.mjs | 151 +++++++++++++++++++++++++++++++++++++++-
 1 file changed, 150 insertions(+), 1 deletion(-)
```
No source file (`src/*.js`) was touched.

Confirmed no accidental write occurred against the real issue during the
test run:
```
$ gh issue view 3 --repo yaleh/quay --json number,state,labels
{"labels":[{"id":"LA_kwDOTY9jJM8AAAACrxoLEw","name":"status:ready", ...},
           {"id":"LA_kwDOTY9jJM8AAAACrxoMYA","name":"lane:execution", ...}],
 "number":3,"state":"OPEN"}
```
Unchanged from the pre-test state recorded in iteration 54 and re-confirmed
at the start of this session — `status:ready`, `lane:execution`, OPEN.

## 6. Provenance update — QN-059

Created `tasks/QN-059.md` via `quay-native task create` (title: "Add
cross-Provider test coverage for task view/action list/task check
(--provider github)"), body written via `task edit --body` with
Proposal/Plan/AC/DoD sections documenting exactly the work in §3-§5
above.

Gated `author->ready`:
```
$ node packages/quay-native/bin/quay-native.js task check QN-059 --json
{
  "id": "QN-059",
  "gate": "author->ready",
  "ok": true,
  "artifacts": { "proposal": true, "plan": true, "ac": true, "dod": true },
  "reason": "all four artifacts present; eligible to move to ready"
}
```
Transitioned `todo -> ready` via `task edit QN-059 --status ready`.

Gated `execute->done`:
```
$ node packages/quay-native/bin/quay-native.js task check QN-059 --json
{
  "id": "QN-059",
  "gate": "execute->done",
  "ok": true,
  "acTotal": 4,
  "acChecked": 4,
  "reason": "all AC checkboxes checked; eligible to move to done"
}
```
Transitioned `ready -> done` via `task edit QN-059 --status done`.

```
$ ls tasks/QN-*.md | wc -l
58
```
(QN-001 through QN-059, minus QN-018, never allocated.)

QN-059 completed its full lifecycle within this iteration: authored
(`todo → ready`, gated `ok:true`), then executed (`ready → done`, gated
`ok:true`, 4/4 AC checked). Final provenance triple: `{author_by: native,
execute_by: native, gate_by: native, status: done}`.

| Task | Description | author_by | execute_by | gate_by | Status |
|---|---|---|---|---|---|
| QN-059 | Add cross-Provider test coverage for task view/action list/task check (--provider github) | **native** | **native** | **native** | **done** |

σ (strict, native/native/native, done) = 51 / 58 = **0.8793** (up from
50/57 = 0.8772 at the start of this iteration; +1 task in both numerator
and denominator).

σ_author_only (diagnostic) = 58 / 58 = **1.0000** (unchanged shape).

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

Per the standing discipline (quote §5.1's exact defining language, search
all of `provenance.md` for the closest precedent, read that precedent's
full reasoning in full this session, and consider whether a closer
precedent argues for a different factor):

- **skeleton** (§5.1: "The v0 loop runs end-to-end (`config → mcp → serve
  → action → Skill → done`)"). Closest, directly on-point precedent:
  **iteration 54 (QN-058)**, itself following **iterations 24/37
  (QN-034/QN-048)** — all read in full this session. All three closed a
  test-coverage-only regression-test gap for an already-existing,
  unmodified capability, live against real `yaleh/quay` issues, zero
  source-code change, and all three scored `skeleton +0.01`. QN-059 is
  structurally identical in kind: a test-coverage-only regression-test
  addition (three new sub-blocks), live-repo-constrained, for
  already-existing, unmodified capabilities (`git diff --stat --
  packages/*/src/*.js` confirmed empty), closing a real, previously-
  uncredited zero-coverage gap in the `task view`/`action`(list)/`task
  check` stages of the v0 loop's own end-to-end chain (§5.1's own named
  stages), specifically their cross-Provider (GitHub) instantiation.
  Applying the precedent directly: credited **+0.01 (0.71 → 0.72)**.
  `gate_correctness` was considered (this iteration's `task check` test
  touches the gate stage specifically) but per QN-034/QN-048/QN-058's own
  precedent, test assertions that cross-check existing, unmodified gate
  *output* do not themselves change `checkGate()`'s logic — no
  `github-client.js`/`store.js` gate implementation code was touched
  (`git diff --stat` confirms), so `gate_correctness` correctly stays
  flat and `skeleton` is the right factor, consistent with precedent.
- **abi_symmetry**: no ABI schema/shape change; `abi-symmetry.mjs`
  re-run this session confirms all four surfaces remain symmetric
  (verbatim output above). Held flat at **0.96**.
- **gate_correctness** (§5.1: "`quay-native task check <id>` correctly
  asserts the `author → ready` and `execute → done` gates"). No change
  to `checkGate()`/`store.js`/`github-client.js` gate logic; the new
  `task check --provider github` test (11c) exercises existing,
  unmodified gate behavior (and, notably, exercises the FAIL branch,
  previously untested for the cross-Provider case — but this is new
  *coverage*, not new *logic*). Per precedent, held flat at **0.76**.
- **skill_convergence**: no `quay:author`/`quay:execute` SKILL.md
  Method-step content changed. Held flat at **0.96**.

```
V_instance = 0.72 × 0.96 × 0.76 × 0.96 = 0.5043  (up from 0.4973)
```

ΔV_instance = **+0.0070**.

## 8. V_meta

```
V_meta = completeness × effectiveness × reusability × validation
```

- **completeness** (§5.2: "Methodology... fully documented and
  self-contained"). Per QN-034/QN-048/QN-058's own explicit precedent
  ("documents a test-coverage gap closure for existing... behavior, not
  new orchestration-Skill methodology content"): QN-059 documents a
  test-coverage gap closure for existing cross-Provider read/gate
  behavior, not new orchestration-Skill methodology content. Held flat at
  **0.74**.
- **effectiveness** (§5.2: "Speedup building feature N+1 *via
  quay-native*... Measured on the marginal increment only"). QN-059 *was*
  built via `quay:author`/`quay:execute` driving a real native task to
  `done` this iteration (§6) — but per QN-034/QN-048/QN-058's own
  explicit, directly-applicable reasoning, this task has a live
  external-network dependency (`gh api` calls against real issue `gh-3`
  in the manual pre-test exploration and in the test itself), so timing
  it against the stage-0 seed comparator would conflate methodology
  speedup with network-I/O latency variance. Held flat at **0.26**, for
  the same reason as iteration 54.
- **reusability** (§5.2: "The methodology transfers to a second Provider
  (GitHub) unmodified... Measured on the transfer target, never the
  accumulated artifact"). Per QN-034/QN-048/QN-058's own explicit
  precedent ("a test-coverage-only addition to an *already-existing*
  GitHub-Provider capability is not 'methodology transfer' evidence — no
  new capability was built via quay-native *driving* GitHub-Provider
  construction"): QN-059 adds test coverage for already-existing
  cross-Provider capabilities (`task view`, `action list`, `task check`,
  all built at earlier iterations); it does not build a *new* capability
  via quay-native driving GitHub-Provider construction. Held flat at
  **0.79**, now the **thirtieth consecutive iteration (26-55)**.
- **validation** (§5.2: "Self-host proof: σ and the provenance log...
  Corroborated by out-of-band audit (G3)"). No audit yet exists for this
  iteration's own work (correctly — it happens after this report is
  committed). Held flat at **0.64**, per standing convention.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973  (unchanged)
```

ΔV_meta = **0.0000**.

## 9. Out-of-band audit

**No new out-of-band audit was initiated or attempted by this
iteration-executor session**, per standing rules — G3 audit dispatch is
exclusively the top-level orchestrator's job, performed separately after
this report is committed.

`experiments/quay-native-bootstrap/audits/` was checked for iteration 54's audit
(`06efe94 Add iteration-54 independent audit (PASS)`), read in full this
iteration: a clean **PASS**, no post-hoc correction required, the first
clean PASS since iteration 52.

**Honesty note.** This iteration built and gated a real native task
(QN-059) driving a genuine test-file change. All command outputs quoted
in §3, §5, §6 above were copy-pasted verbatim from this session's own
tool-call output; none were stated from memory or assumed unchanged.

**This iteration's work merits close audit scrutiny on the following
points**, named explicitly for the next audit to check independently:

1. Independent re-run of `ls experiments/quay-native-bootstrap/directives/pending/` to confirm
   it is empty.
2. Independent re-run of the full regression suite (`node --test
   packages/*/test/*.test.mjs`) to confirm 25/25 pass, and specifically
   that `cli.test.mjs`'s new test 11 passes (all 11 sub-assertions listed
   in §5).
3. Independent re-run of `node packages/quay/test/cli.test.mjs` standalone
   to confirm the exact PASS lines quoted in §5, including against the
   real, live `yaleh/quay` issue `gh-3` (this depends on issue #3's
   `status:ready` label and its AC-checkbox state remaining unchanged — if
   either changes, the `status === "ready"` and `ok === false` assertions
   would need revisiting).
4. Independent confirmation that `git diff --stat -- packages/*/src/*.js`
   is empty (i.e., this is genuinely a test-only change).
5. Independent read of the new test block (test 11, 11a/11b/11c) in
   `packages/quay/test/cli.test.mjs` to confirm it genuinely exercises
   `--provider github` end-to-end for all three subcommands (not silently
   falling back to native), and that `task edit --provider github`'s
   exclusion rationale (citing `write.test.mjs`'s own precedent) is
   correctly reasoned, not just asserted.
6. Independent judgment on whether crediting `skeleton +0.01` (rather than
   `gate_correctness`, given that one of the three new sub-blocks
   specifically targets the gate stage) is correctly reasoned against the
   QN-034/QN-048/QN-058 precedent, or whether `gate_correctness` should
   have moved instead for the `task check` sub-block specifically.
7. Independent verification that no live write occurred against issue #3
   during this session's test runs (`gh issue view 3 --repo yaleh/quay
   --json number,state,labels`, compared against the value quoted in §5).
8. Independent verification of QN-059's provenance triple
   (`{author_by: native, execute_by: native, gate_by: native, status:
   done}`) via `cat tasks/QN-059.md` and re-running `task check QN-059
   --json` at both gates.
9. `git status --short` should show a clean working tree at audit time,
   modulo the one pre-existing, deliberately-untouched
   `docs/proposal/baime-lite-driving-external-projects.md` file.

## 10. Convergence Check

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** —
      **NO.** V_instance = 0.5043 (up from 0.4973), V_meta = 0.0973
      (unchanged). Both remain far below 0.80.
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set +
      gate)** — **NO.** σ (strict) = 51/58 = 0.8793, up from 0.8772, still
      far from 1. No `quay:author`/`quay:execute` Method-step content
      changed; no gate logic changed.
- [ ] **3. Contract proven (native + GitHub both run)** — **NO.**
      Unchanged from iteration 54's framing — this iteration strengthens
      confidence in the contract (three previously-untested cross-
      Provider read/gate paths now have regression coverage) but does not
      itself constitute the full contract-proof criterion.
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off)** — **NO.** No audit yet exists for *this* iteration's own
      work.
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** —
      **Literal test: YES** (ΔV_instance = 0.0070, ΔV_meta = 0.0000, both
      < 0.02, matching iteration 54's own ΔV_instance exactly). **Scored NO
      on substance**, consistent with standing practice: a small ΔV
      sitting far below the 0.80 dual threshold on both axes reflects a
      value function still far from convergence, not a system leveling off
      near it. Criteria 1-4 remain clearly unmet.

**Status**: **NOT CONVERGED**. Criteria 1, 2, 3, and 4 all remain clearly
NO. Criterion 5, as literally worded, is met but scored NO on substance.
V_instance (0.5043) and V_meta (0.0973) remain far below the 0.80 dual
threshold on both axes.

## Reflections

This iteration performed exactly the systematic sweep iteration 54's own
problem list invited: rather than assuming the `action run`/`--provider
github` gap was an isolated incident, it read `bin/quay.js`'s complete
branch table and grepped the full test suite for every combination, then
verified via full-file reads (not grep-hit inference) which of the
uncovered subcommands were safe to close (read-only: `task view`, `action
list`, `task check`) versus correctly excluded (write: `task edit`,
matching `write.test.mjs`'s own explicit, pre-existing precedent). This
follows the standing scoring discipline's item 7 directly: don't infer
coverage from grep hit locations alone — read the full test/source bodies
and confirm the fixtures genuinely match the claimed scenario.

The closest precedent (iterations 24/37/54, QN-034/QN-048/QN-058) directly
governs the scoring: a test-coverage-only regression addition for
already-existing, unmodified capabilities moves `skeleton` (+0.01) but not
`gate_correctness`/`reusability`/`effectiveness`/`completeness`, even
though one of this iteration's three new sub-blocks specifically targets
the gate-check stage — the precedent's own reasoning (assertions
cross-check existing gate *output*, they do not change gate *logic*)
applies identically here, since no `checkGate()`/`store.js`/
`github-client.js` code was touched.

No system evolution (no new agent, no new capability, no Skill change) is
warranted this iteration — the standing system (M_54 = M_55, A_54 = A_55)
remains stable. Having now closed the two most obvious cross-Provider
test-coverage gaps (action-run in iteration 54, and view/list/check in
this iteration) across two consecutive iterations, the pool of "easily
found, genuinely closeable, non-manufactured" gaps of this exact shape is
likely smaller going into iteration 56 — the sweep in §3 confirmed the
remaining uncovered subcommand (`task edit --provider github`) is
correctly excluded, not merely undiscovered, so future iterations should
not expect another gap of this identical shape without a genuinely new
angle (e.g. a new subcommand being added, or a different systematic axis
such as error-path/negative-case coverage rather than happy-path
cross-Provider coverage).

## Problems identified for next iteration

1. **The `docs/proposal/quay-bootstrap-experiment.md` gitignore discovery
   remains open for human attention** (carried forward from iterations
   42-55).
2. **The alternate-AC-state-source question remains closed across five
   candidates**, unchanged, not revisited this iteration.
3. **`effectiveness` remains at its honest ceiling (0.26)**, now for 35
   consecutive iterations (21-54, and now 55) — network-I/O confound
   (per QN-034/QN-048/QN-058's own precedent) still applies.
4. **`reusability` remains flat**, now for the thirtieth consecutive
   iteration (26-55).
5. **`validation` (0.64) has now held flat since approximately iteration
   10 (45 iterations)**, unchanged this iteration; reserved for the
   top-level orchestrator.
6. **The clean-audit streak sits at 1 going into iteration 56** (iteration
   54's own audit was a clean PASS, per commit `06efe94`). This
   iteration's own report should be scrutinized per the 9 points in §9
   above.
7. **The systematic-sweep angle for cross-Provider coverage is now
   largely exhausted** for the current subcommand roster (`task
   list/view/edit/check`, `action list/run`) — `task edit` is correctly
   excluded (live-write safety), and the other five now all have
   cross-Provider coverage. Future iterations should look for a
   genuinely new angle (new subcommands, negative/error-path coverage,
   external state changes) rather than re-running this exact sweep,
   which would no longer surface anything new.
</content>
