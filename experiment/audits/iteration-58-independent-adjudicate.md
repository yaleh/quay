# Iteration 58 — Independent Out-of-Band Audit (G3)

**Verdict: PASS**

**Auditor:** fresh, zero-prior-context out-of-band review, conducted per protocol
§6 (G3). Read `docs/proposal/quay-bootstrap-experiment.md` in full (from disk),
`experiment/iterations/iteration-58.md` in full, the tail of
`experiment/provenance.md` (iterations 54-58, plus iterations 23/24/37 for
precedent verification), and `tasks/QN-062.md` in full. Did not trust the
report's narration — independently re-ran every cited command from a clean
shell, independently read `packages/quay/src/provider-client.js`,
`packages/quay/bin/quay.js`, `packages/quay/src/serve.js`, and
`packages/quay/src/mcp-server.js` in full/relevant sections, and both new test
blocks (`cli.test.mjs` test 12, `mcp-server.test.mjs` block 11) line by line.

## 1. Command-output verification (fabrication check)

All commands cited as evidence in iteration-58.md were independently re-run
from a clean shell. All matched verbatim or in substance.

- `ls experiment/directives/pending/` → empty, exit 0. Matches.
- `ls tasks/QN-*.md | wc -l` → **61**. Matches the report's post-iteration count.
- `git diff --stat -- packages/*/src/*.js` → **empty output**. Independently
  confirmed: no `src/*.js` file was touched. This is the single most
  load-bearing claim in the report (test-only change) and it is genuinely true.
- Full regression suite, independently re-run:
  ```
  ℹ tests 26
  ℹ pass 26
  ℹ fail 0
  ```
  Exact match to the report's claimed 26/26 (unchanged top-level file count).
- `node packages/quay/test/cli.test.mjs`, independently re-run standalone:
  produced the identical three new PASS lines quoted in the report
  ("`quay task list --provider <a Provider whose mcp_entry crashes on
  launch> exits 1`", "writes nothing to stdout", "reports a diagnostic on
  stderr naming the failure"), plus the identical `resolveRepo()` stack
  trace text ("`Error: QUAY_GITHUB_REPO must be "owner/repo" (got:
  this-is-not-owner-slash-repo)`"). Matches verbatim.
- `node packages/quay/test/mcp-server.test.mjs`, independently re-run
  standalone: produced the identical three new PASS lines quoted in the
  report (`isError:true` on first call, non-empty error text
  `MCP error -32000: Connection closed`, `isError:true` on the second,
  independent call). Matches verbatim.
- `node packages/quay-native/test/abi-symmetry.mjs` → `ALL FOUR SURFACES
  SYMMETRIC`. Matches.
- `gh issue view 3 --repo yaleh/quay --json number,state,labels` →
  independently re-run: `{"labels":[{"name":"status:ready",...},
  {"name":"lane:execution",...}],"number":3,"state":"OPEN"}`. Matches the
  report's quoted value exactly — no live write occurred to the real issue.
- `git status --short` → only the pre-existing untracked
  `docs/proposal/baime-lite-driving-external-projects.md`, matching the
  report's own final `git status --short` claim.

No fabricated "no matches," test-pass count, or diff/status output was found.
The previously-confirmed failure pattern from iterations 50/51 does not recur.

## 2. Characterization-of-precedent verification

Checked every "matches precedent X" claim against the actual precedent text.

- **QN-034 (iteration 24) as "the only prior test of the misconfiguration
  path, exercised directly against `quay-github.js`'s own CLI, never through
  a Core-level binding."** Independently re-read provenance.md's iteration-24
  section (lines ~3301-3349). Confirmed: QN-034's test exercises "a malformed
  `QUAY_GITHUB_REPO` env value (`resolveRepo()`'s own throw path via
  `main().catch(...)`)" directly against `bin/quay-github.js`'s own CLI via
  `execFileSync` — no Core-level binding (`bin/quay.js`, `mcp-server.js`,
  `serve.js`) is involved. This matches the report's characterization
  exactly. The independent `grep -n "QUAY_GITHUB_REPO\|resolveRepo\|
  misconfigur" experiment/provenance.md` I ran turned up no earlier
  Core-level test of this failure mode, confirming the gap was real.
- **Skeleton `+0.01` precedent chain (iterations 54/55/56/57, QN-058/059/
  060/061; ultimately QN-034/QN-048).** Independently read each cited
  provenance.md section (iteration 54 lines ~8291-8330, iteration 55 lines
  ~8459-8490, iteration 56 lines ~8615-8650, iteration 57 lines ~8794-8830).
  Each genuinely applies the identical reasoning pattern ("test-coverage-only
  regression addition, zero source-code change, for an already-existing,
  unmodified capability" → `skeleton +0.01`, all other three factors held
  flat with individually stated reasoning). The skeleton value increments
  0.70→0.71→0.72→0.73→0.74→0.75 across iterations 54-58, exactly matching
  each iteration's own stated before/after values. This is a genuine,
  traceable, non-fabricated precedent chain.
- **`effectiveness` decline citing iteration 23 (QN-033).** Independently
  read provenance.md's iteration-23 section (lines ~3241-3261). Confirmed:
  iteration 23 explicitly declined to credit `effectiveness` absent an
  actual timed comparison against the stage-0 baseline, and explicitly
  characterized "manufacturing a timing comparison purely to decide credit"
  as something to avoid. Iteration 58's claim that "merely lacking a network
  dependency does not by itself constitute evidence of a speedup" and that
  performing such a comparison now "would repeat the exact
  manufactured-evidence problem iteration 23 declined" is a literally
  accurate characterization of iteration 23's actual reasoning, not merely
  plausible-sounding.
- **QN-060 (iteration 56) full-gate-lifecycle precedent, contrasted with the
  QN-061 (iteration 57) shortcut.** Independently read provenance.md's
  iteration-56 section: "Created `tasks/QN-060.md`, gated `author->ready`
  ..., transitioned `todo -> ready`, gated `execute->done` ..., transitioned
  `ready -> done`." This is the genuine two-transition sequence the report
  claims QN-062 replicated. Confirmed genuine (see §4 below for QN-062's own
  reproduction).

No false "matches precedent" claim was found — the failure pattern
previously confirmed in iterations 53/57 does not recur here.

## 3. New test coverage (QN-062, test 12 / block 11)

(a) **Tests exist and exercise the claimed failure mode.** Read both new
blocks in full.
`packages/quay/test/cli.test.mjs`'s test 12 (tail of the file, ~50 lines)
constructs a `.quay/config.yml` with a `broken-github` Provider whose
`mcp_entry` points at the real `quay-github.js` binary with
`QUAY_GITHUB_REPO: "this-is-not-owner-slash-repo"` (a genuinely malformed
value, not a stub/mock), then runs `quay task list --provider broken-github
--json` via a real subprocess and asserts exit code 1, empty stdout, and a
stderr diagnostic. `packages/quay/test/mcp-server.test.mjs`'s block 11
(tail of the file) does the MCP-layer sibling: spins up a real `quay mcp`
subprocess against the same broken-Provider fixture and asserts
`task_list` returns `isError:true` twice in a row (proving the aggregator
process survives). Neither test mocks or stubs the failure — both rely on
the genuine `resolveRepo()` throw in the real `quay-github.js` binary. No
live GitHub network call is made in either test (the failure path is
local/synchronous, before any `gh api` call is reached) — confirmed by
reading `packages/quay-github/bin/quay-github.js`'s `resolveRepo()`, which
throws before any network code executes.

(b) **Pass counts.** Independently re-run (see §1): full suite 26/26 (exact
match), standalone `cli.test.mjs` and `mcp-server.test.mjs` both produce the
exact PASS lines and stack-trace text quoted in the report.

(c) **`git diff --stat -- packages/*/src/*.js` genuinely empty.**
Independently confirmed empty. This is a real test-only change.

(d) **Architectural asymmetry claim, independently assessed from source.**
Read `packages/quay/src/provider-client.js` (`connectProvider()`, 62 lines),
`packages/quay/bin/quay.js` (`withProvider()`, calls `await
connectProvider(...)` synchronously before running any command body — an
eager connect), `packages/quay/src/serve.js` (`startServer()` calls `await
connectProvider(...)` at line 29, before `server.listen()` at line 139 — an
eager connect), and `packages/quay/src/mcp-server.js` (`startMcpServer()`'s
`getClient(providerId)`, which only calls `connectToProvider(cfg, id)` on
first invocation, cached in a `Map` — a genuinely lazy connect, with the
file's own pre-existing header/doc comment explicitly stating "Lazily
connect to each enabled Provider on first use (not eagerly at startup)").
This is a real, source-verified architectural asymmetry, not a
mischaracterization — Core CLI and Web-UI eagerly connect and fail fast at
startup; Core MCP lazily connects and only surfaces a Provider failure
(opaquely, as `isError:true` with `MCP error -32000: Connection closed`) on
first tool call naming that Provider.

## 4. Provenance / task-lifecycle claims (QN-062)

`tasks/QN-062.md` exists, `status: done`, with Proposal/Plan/AC/DoD sections
matching the report's described work. Only one commit (`1f8f43b`) touches
this file — but this is the established pattern for this experiment: the
confirmed-good precedent QN-060 (iteration 56) is also a single commit
(`23aa9db`), because the intermediate gate-transition commands are run live
in-session and only the final state is committed (single squash-style
commit per iteration is the norm here, not evidence of a shortcut by
itself).

The load-bearing question is whether the *session actually ran* the
claimed three-step `task check` sequence (`author->ready` →
`execute->done` → `none`/terminal), rather than a single vacuous check on
an already-`done` task (the QN-061 shortcut pattern). I independently
reconstructed this by copying `tasks/QN-062.md`, rewriting its `status:`
field to `todo` and then to `ready`, and running `quay-native task check`
against each version from a clean directory:

```
$ QUAY_NATIVE_TASKS_DIR=/tmp/qn-verify/tasks node .../quay-native.js task check QN-062 --json   # status: todo
{
  "id": "QN-062", "gate": "author->ready", "ok": true,
  "artifacts": {"proposal": true, "plan": true, "ac": true, "dod": true},
  "reason": "all four artifacts present; eligible to move to ready"
}
$ ... # status: ready
{
  "id": "QN-062", "gate": "execute->done", "ok": true,
  "acTotal": 4, "acChecked": 4,
  "reason": "all AC checkboxes checked; eligible to move to done"
}
```

These two outputs are **byte-for-byte identical** to the two intermediate
JSON blocks quoted in iteration-58.md §6, and distinct in kind
(`gate` field: `"author->ready"` vs `"execute->done"` vs `"none"`) from
QN-061's single vacuous `"gate":"none"` check. This is strong, direct,
independently-reproduced evidence that the claimed multi-step gated
lifecycle genuinely occurred as described, not a repeat of the QN-061
shortcut. **Confirmed: QN-062 was genuinely driven through
`todo → ready → done` with real gate checks at each transition.**

Minor note (not a fabrication, flagged for completeness): `tasks/QN-062.md`'s
own AC text (item 3) says the regression suite would reach "27/27 (up from
26/26)" — this is inconsistent with the actual/reported 26/26 result (both
new test blocks landed inside already-counted files, not new files, so the
top-level count is unchanged, exactly as both iteration-58.md and
provenance.md correctly state). This is stale/incorrect wording written into
the task file's own AC section (likely a copy-paste artifact from planning),
not a false claim in the audited iteration report or provenance.md, both of
which consistently and correctly state 26/26.

## 5. V-factor scoring proportionality

- **σ arithmetic.** `ls tasks/QN-*.md | wc -l` independently confirms **61**
  total tasks. σ_strict = 54/61 = 0.885245... rounds to the report's claimed
  **0.8852**. This is +1 task in numerator and denominator vs. iteration 57's
  53/60 = 0.8833, consistent with exactly one task (QN-062) newly reaching
  `{native, native, native, done}`.
- **V_instance arithmetic.** 0.75 × 0.96 × 0.76 × 0.96 = 0.525312, rounds to
  the claimed **0.5253**. Verified by independent calculation.
- **V_meta arithmetic.** 0.74 × 0.26 × 0.79 × 0.64 = 0.097277..., rounds to
  the claimed **0.0973**, unchanged from iteration 57. Verified.
- **Skeleton-factor credit consistency with precedent chain.** See §2 above
  — independently confirmed the precedent chain (iterations 54-57, and
  originally iteration 24/QN-034, iteration 37/QN-048) genuinely establishes
  and consistently applies the "test-coverage-only, zero source-code change"
  → `skeleton +0.01` rule, with each iteration's stated before/after values
  chaining correctly (0.70→0.71→0.72→0.73→0.74→0.75). Iteration 58's
  application of this rule to a new but structurally identical kind of
  closure (failure-path rather than success-path coverage) is a defensible,
  consistently-reasoned extension of the precedent, not an unsupported
  score bump. The explicit consideration-and-rejection of `gate_correctness`
  and `abi_symmetry` as alternative factors is well-reasoned and, on
  independent reading of the actual `checkGate()`/`abi-symmetry.mjs` code
  and the new tests' actual assertions, correct: the new tests exercise
  `provider-client.js`'s `connectProvider()`, not `store.js`'s
  `checkGate()`, and make no cross-binding content-equivalence assertion.
  `effectiveness` decline is independently verified correct against
  iteration 23's actual precedent text (§2 above).

## 6. `baime-lite-driving-external-projects.md` untouched

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
$ git diff HEAD -- docs/proposal/baime-lite-driving-external-projects.md
(empty — file was never tracked/committed, so there is no tracked diff to show)
$ git log --all --oneline -- docs/proposal/baime-lite-driving-external-projects.md
(no output — never committed to any branch)
```
Confirmed: this file remains untracked and untouched by iteration 58's
commit (`1f8f43b`'s file list does not include it). It is not part of the
experiment's tracked artifact set.

## Overall verdict: PASS

Every command-output claim was independently reproduced verbatim or in
exact substance. Every "matches precedent" claim was independently checked
against the actual cited precedent text and found literally true, including
re-derivation of QN-062's intermediate gate-check JSON by direct
reconstruction (byte-for-byte match). The claimed architectural asymmetry
(Core CLI/Web-UI eager-connect vs. Core MCP lazy-connect) is genuine,
independently verified from `provider-client.js`/`bin/quay.js`/`serve.js`/
`mcp-server.js` source, including a pre-existing doc comment in
`mcp-server.js` confirming the lazy-connect design intent predates this
iteration. The σ/V_instance/V_meta arithmetic is independently reproduced
and correct. `git diff --stat -- packages/*/src/*.js` is genuinely empty
(test-only change). The pre-existing untracked file was not touched.

One minor, non-fabrication inconsistency was found and is noted for the
record: `tasks/QN-062.md`'s own AC-item-3 wording says "27/27 (up from
26/26)," which does not match the actual/reported 26/26 result that both
iteration-58.md and provenance.md consistently and correctly state
elsewhere. This does not rise to a false claim in the audited report itself
and does not affect the PASS verdict, but is worth a housekeeping fix to
`tasks/QN-062.md` in a future iteration.

This iteration restores a clean audit result after iteration 57's post-hoc
correction (the eleventh confirmed correction, for a false QN-060/QN-061
precedent-match claim) — the same class of failure this iteration's own
QN-062 lifecycle was specifically designed to avoid repeating, and which
this audit independently confirms it did avoid.
