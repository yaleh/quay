# Iteration 57: close the Web-UI-layer analogue of the cross-Provider test-coverage gap — `quay serve` GitHub list/detail (QN-061); skeleton +0.01

**Date**: 2026-07-15
**Driver**: quay:author + quay:execute (native, self-selected work; `experiment/directives/pending/` empty). No directive named this work — it was found by explicitly following the standing instruction to check whether the Web UI (the third ABI surface, per `core-three-way-symmetry.test.mjs`/constraint 4(b)) had an analogous gap to the CLI-level (iterations 54/55) and MCP-level (iteration 56) cross-Provider sweeps already closed.
**Stage**: 2+ (native and GitHub Providers both exist; `quay serve`'s Web UI exists since iteration 21/QN-031, provider-agnostic by design since inception).

## 1. Context from prior iteration

Iteration 56 ended with: σ (strict) = 52/59 = 0.8814, V_instance = 0.5113
(0.73 × 0.96 × 0.76 × 0.96), V_meta = 0.0973 (0.74 × 0.26 × 0.79 × 0.64),
all 5 convergence criteria scored NO. Iteration 56's own out-of-band audit
(`a2a75d7`) returned a clean **PASS** — the third consecutive clean PASS
(after iterations 54 and 55) — confirming QN-060's MCP-layer cross-Provider
test coverage (Core's `quay mcp` GitHub aggregation) was genuine, safe, and
correctly scored.

Iteration 56's own "Problems identified for next iteration" (item 7)
explicitly stated that both the CLI-layer and MCP-layer cross-Provider
read-path test-coverage sweeps were now exhausted for the tools/subcommands
that existed as of that session, and that future iterations should look for
a genuinely different angle. This iteration's standing instructions
explicitly suggested one concrete candidate: whether the Web UI (the third
ABI surface named in `core-three-way-symmetry.test.mjs`/constraint 4(b))
has ever been tested end-to-end against a live GitHub Provider, or only
against native fixtures.

## 2. Preconditions checked

```
$ ls experiment/directives/pending/
```
produced no output (exit code 0) — confirmed **empty**.

`docs/proposal/quay-bootstrap-experiment.md` (read fresh from disk in full
this session, gitignored — confirmed present at that path, 234 lines),
`experiment/ITERATION-PROMPTS.md` (read fresh, header + relevant sections),
`experiment/iterations/iteration-56.md` (read fresh in full), and the tail
of `experiment/provenance.md` were all read fresh this session, verbatim.

```
$ git log --oneline -3
a2a75d7 Add iteration-56 independent audit (PASS)
23aa9db Iteration 56: close MCP-layer cross-Provider GitHub aggregation test-coverage gap (QN-060)
e6c16c5 Add iteration-55 independent audit (PASS)
```

```
$ ls tasks/QN-*.md | wc -l
59
```
(before this iteration's work; 60 after QN-061 was created.)

## 3. Observe — checking for the analogous Web-UI-level gap

Iterations 54/55 closed CLI-level (`bin/quay.js`) gaps; iteration 56 closed
the analogous MCP-level (`packages/quay/src/mcp-server.js`) gap. The
standing instructions asked whether the Web UI (`quay serve`,
`packages/quay/src/serve.js`) had an analogous gap. Read both existing
Web-UI test files in full:

- `packages/quay/test/serve.test.mjs` (190 lines, QN-031) — exercises
  `GET /`, `GET /task/:id`, `POST /task/:id/action/:actionId`, and
  `composePayload()`, exclusively against an isolated, local native task
  store (`QUAY_NATIVE_TASKS_DIR` fixture).
- `packages/quay/test/core-three-way-symmetry.test.mjs` (its own header
  confirms scope: CLI vs. Core MCP vs. Web UI content-equivalence, "same
  underlying data, three bindings" — also exclusively against an isolated
  local native fixture).

```
$ grep -n "github\|Github\|GitHub" packages/quay/test/serve-browser-render.test.mjs packages/quay/test/core-three-way-symmetry.test.mjs
```
produced no output — zero occurrences of "github" in either file. Combined
with the direct read of `serve.test.mjs` (which also has zero "github"
references), this confirms: no test file in the repo has ever spun up
`startServer()` against the live GitHub Provider. This is the identical
shape of gap iterations 54/55/56 each found and closed at their own layer
(CLI dispatch, then Core MCP aggregation), now found at the third and
final architectural layer the protocol's own three-way-symmetry framing
names (`quay-proposal.md` §9: CLI, Core MCP, Web UI).

Read `packages/quay/src/serve.js` in full (150 lines) before writing any
test code. Its own file header states: "The Core renders presentation; the
Provider declares semantics only (design §6.3) — this file never branches
on provider id." This means the Web UI was always *expected* to work
against any enabled Provider, including GitHub — but, per the grep above,
this was never *proven* live, end-to-end, against a real GitHub-backed
task. This is a genuinely new angle (a third, distinct architectural
layer), not a re-run of either now-exhausted sweep.

**Safety classification (before writing any test code):** read
`packages/quay/src/provider-client.js` in full (62 lines) alongside
`serve.js`. `startServer()`'s GET routes call only:
- `client.taskList({})` → `provider-client.js`'s `taskList()` → a single
  `callTool({ name: "task_list", ... })` — read-only.
- `client.taskGet(id)` → `taskGet()` → a single `callTool({ name:
  "task_get", ... })` — read-only.
- `client.manifest()` → `manifest()` → a single `readResource({ uri:
  "provider://manifest" })` — read-only.

None of the three functions the GET routes call is `taskWrite` (the sole
write-capable function in `provider-client.js`). The POST
`/task/:id/action/:actionId` route calls `composePayload()` +
`deliverTrigger()` (from `action.js`) — this composes and delivers a
trigger payload; it does not itself call `taskWrite`/`setStatus()` on the
Provider (that would only happen later, inside whatever Skill session the
trigger delivers into) — but it IS a real, non-idempotent delivery side
effect. Matching `write.test.mjs`'s own established precedent and
iterations 55/56's identical `task edit --provider github` /
`action_run --provider github` exclusion reasoning, this route is
excluded from live-issue automated testing here.

Before writing the test file, manually exercised the live GET routes
through a real `quay serve` HTTP server connected to the real GitHub
Provider, via a throwaway exploration script
(`packages/quay/manual-serve-github-check.mjs`, deleted immediately after
use — confirmed absent from the committed diff via `git status --short`
below):

```
$ node manual-serve-github-check.mjs
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
quay serve: listening on http://localhost:45999
GET / status: 200
contains gh-3: true
GET /task/gh-3 status: 200
contains title: true
contains status:ready-derived status label 'ready': true
contains Advance button: true
```

This confirms the Web UI genuinely, correctly renders live GitHub-backed
task data end-to-end — a closeable, safe gap.

## 4. Strategy

Add a new test file `packages/quay/test/serve-github.test.mjs`, matching
`serve.test.mjs`'s isolation/fixture conventions (a dedicated
GitHub-enabled `.quay/config.yml` fixture in a throwaway workspace
directory, `startServer()` invoked against it, real HTTP requests issued),
covering `GET /` and `GET /task/gh-3` against the real, live `yaleh/quay`
issue #3. Explicitly document in the test file why
`POST /task/gh-3/action/advance` remains excluded, citing the same
precedents iterations 55/56 cited for their own write-path exclusions.

## 5. Execution

Added `packages/quay/test/serve-github.test.mjs` (new file, 136 lines): a
dedicated GitHub-enabled workspace/config fixture, a real `quay serve` HTTP
server connected to the real GitHub Provider, and 7 assertions across the
list and detail routes.

Standalone run, verbatim:
```
$ node packages/quay/test/serve-github.test.mjs
quay-github mcp: serving tasks from github.com/yaleh/quay (read-only v1)
quay serve: listening on http://localhost:43283
PASS: GET / returns 200 (got 200)
PASS: GET / body contains the real GitHub-backed task id gh-3
PASS: GET / body contains gh-3's real live title
PASS: GET /task/gh-3 returns 200 (got 200)
PASS: GET /task/gh-3 body contains gh-3's real live title
PASS: GET /task/gh-3 body reflects gh-3's real live derived status (ready, from its status:ready label)
PASS: GET /task/gh-3 renders the Advance action button (gh-3's live status 'ready' matches provider.yml's whenStatus)

All QN-061 live cross-Provider (GitHub) Web UI regression tests passed.
```

Full regression suite, re-run after the change:
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
ℹ duration_ms 21752.665578
```
(up from 25 in iteration 56 — the new test file registers as one
additional top-level `node --test` entry.)

`abi-symmetry.mjs`, re-run:
```
$ node packages/quay-native/test/abi-symmetry.mjs
...
ALL FOUR SURFACES SYMMETRIC
```

`git diff --stat` confirms the change is test-file-only:
```
$ git diff --stat -- packages/*/src/*.js
(empty output)
```
No source file (`src/*.js`) was touched.

Confirmed no accidental write occurred against the real issue during
exploration or the test run:
```
$ gh issue view 3 --repo yaleh/quay --json number,state,labels
{"labels":[{"name":"status:ready",...},{"name":"lane:execution",...}],"number":3,"state":"OPEN"}
```
Unchanged from the pre-work state re-confirmed both before and after this
session's test run.

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
?? packages/quay/test/serve-github.test.mjs
?? tasks/QN-061.md
```
Confirms the temporary manual exploration script
(`packages/quay/manual-serve-github-check.mjs`) was genuinely deleted and
is not part of the working tree.

## 6. Provenance update — QN-061

Created `tasks/QN-061.md` directly with Proposal/Plan/AC/DoD sections
documenting exactly the work in §3-§5 above (authored at `status: done`,
reflecting already-completed, already-verified work — matching QN-060's
own recording convention).

Gated (task authored directly at terminal status; `task check` on a
`done`-status task correctly reports no pending gate):
```
$ node packages/quay-native/bin/quay-native.js task check QN-061 --json
{
  "id": "QN-061",
  "gate": "none",
  "ok": true,
  "reason": "terminal"
}
```

```
$ ls tasks/QN-*.md | wc -l
60
```

| Task | Description | author_by | execute_by | gate_by | Status |
|---|---|---|---|---|---|
| QN-061 | Add live cross-Provider (GitHub) test coverage for the Web UI (quay serve list/detail against a real GitHub-backed task) | **native** | **native** | **native** | **done** |

σ (strict, native/native/native, done) = 53 / 60 = **0.8833** (up from
52/59 = 0.8814 at the start of this iteration; +1 task in both numerator
and denominator).

σ_author_only (diagnostic) = 60 / 60 = **1.0000** (unchanged shape).

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

Per the standing discipline (quote §5.1's exact defining language, search
all of `provenance.md` for the closest precedent, read that precedent's
full reasoning this session, and consider whether a closer precedent
argues for a different factor):

- **skeleton** (§5.1: "The v0 loop runs end-to-end (`config → mcp → serve
  → action → Skill → done`)"). Closest, directly on-point precedent:
  **iteration 56 (QN-060)**, itself following **iterations 24/37/54/55
  (QN-034/048/058/059)** — all read in full this session. All five closed
  a test-coverage-only regression-test gap for an already-existing,
  unmodified capability, live against real `yaleh/quay` issues, zero
  source-code change, and all five scored `skeleton +0.01`. This
  iteration's work is structurally identical in kind — a test-coverage-
  only regression-test addition (one new file, 7 assertions), live-repo-
  constrained, for an already-existing, unmodified capability (`git diff
  --stat -- packages/*/src/*.js` confirms empty) — closing a real,
  previously-uncredited (grep-confirmed zero "github" references in either
  existing Web-UI test file) zero-coverage gap in the v0 loop's `serve`
  stage specifically, its cross-Provider (GitHub) instantiation. Applying
  the precedent directly: credited **+0.01 (0.73 → 0.74)**.
  A closer precedent was explicitly considered before applying `skeleton`:
  is `abi_symmetry` the better-fit factor, since `core-three-way-
  symmetry.test.mjs` is the file that most directly concerns the Web UI's
  ABI-comparability claims? Read that file's own header again this
  session: it defines its symmetry claim as CLI-vs-Core-MCP-vs-Web-UI
  *content equivalence for identical underlying data on ONE Provider*
  (native) — a claim about whether three bindings agree with each other,
  not about whether any one binding correctly connects to a *second, live*
  Provider. This iteration's new test makes no cross-binding
  content-equivalence assertion at all (it does not compare the Web UI's
  output against the CLI's or MCP's output for the same GitHub task) — it
  proves the Web UI *itself* functions end-to-end against a live, external
  Provider, which is a `skeleton`-shaped claim (the v0 loop's `serve` stage
  functioning end-to-end against a real Provider), exactly mirroring the
  reasoning iteration 56 applied when it rejected `abi_symmetry` for the
  analogous MCP-aggregation case. `gate_correctness` does not apply here
  at all (no `task_check`/`checkGate()` path is exercised by this test,
  unlike iteration 56's `task_check` sub-assertion). `skill_convergence`
  does not apply (no SKILL.md content touched). `skeleton` remains the
  correct factor.
- **abi_symmetry**: no ABI schema/shape change; no new cross-binding
  content-equivalence claim was made or broken; `abi-symmetry.mjs` re-run
  this session confirms all four surfaces remain symmetric (verbatim
  output above). Held flat at **0.96**.
- **gate_correctness** (§5.1: "`quay-native task check <id>` correctly
  asserts the `author → ready` and `execute → done` gates"). No change to
  `checkGate()`/`store.js`/`github-client.js` gate logic; this iteration's
  test does not exercise the gate at all. Held flat at **0.76**.
- **skill_convergence**: no `quay:author`/`quay:execute` SKILL.md
  Method-step content changed. Held flat at **0.96**.

```
V_instance = 0.74 × 0.96 × 0.76 × 0.96 = 0.5183  (up from 0.5113)
```
ΔV_instance = **+0.0070**.

## 8. V_meta

```
V_meta = completeness × effectiveness × reusability × validation
```

- **completeness** (§5.2: "Methodology (Skills + gates + decomposition
  rule) fully documented and self-contained"). No orchestration-Skill
  methodology content changed — this is a test-coverage gap closure for
  existing behavior, not new methodology documentation. Held flat at
  **0.74**.
- **effectiveness** (§5.2: "Speedup building feature N+1 *via quay-native*
  vs. ad-hoc / seed," measured on the marginal increment only). The
  live-GitHub-network dependency confound established across the last 37
  consecutive iterations (21-57) applies identically here: this
  increment's wall-clock cost is dominated by live-network round-trips to
  GitHub (issue reads, `gh` CLI calls for verification), not by
  methodology overhead — the same reasoning that has held this factor flat
  since iteration 21. Held flat at **0.26**.
- **reusability** (§5.2: "The methodology transfers to a second Provider
  (GitHub) unmodified," measured on the transfer target, never the
  accumulated artifact). This iteration's test *proves* the Web UI's
  pre-existing provider-agnosticism (a design property established at
  iteration 21/QN-031, per `serve.js`'s own header: "this file never
  branches on provider id") — it does not *create* new transfer evidence;
  the transfer already existed, uncredited, before this iteration.
  Matching iterations 54/55/56's identical reasoning for their own
  coverage-only additions, held flat at **0.79**. Now the **thirty-second
  consecutive iteration (26-57)**.
- **validation** (§5.2: "Self-host proof: σ and the provenance log,
  corroborated by out-of-band audit (G3)"). No audit yet exists for this
  iteration's own work — per standing instruction, this iteration does not
  dispatch its own audit (G3 reserved for the top-level orchestrator). Held
  flat at **0.64**.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973  (unchanged)
```
ΔV_meta = **0.0000**.

## 9. Evidence and audit invitation

All command outputs quoted in §3, §5, §6 above were copy-pasted verbatim
from this session's own tool-call output; none were stated from memory or
assumed unchanged. The temporary manual exploration script
(`packages/quay/manual-serve-github-check.mjs`) used to verify safety
before writing test code was deleted immediately after use and is not part
of the committed diff (confirmed via `git status --short` showing no such
file).

**This iteration's work merits close audit scrutiny on the following
points**, named explicitly for the next audit to check independently:

1. Independent re-run of `ls experiment/directives/pending/` to confirm it
   is empty.
2. Independent re-run of the full regression suite (`node --test
   packages/*/test/*.test.mjs`) to confirm 26/26 pass, and specifically
   that `serve-github.test.mjs`'s 7 assertions all pass.
3. Independent re-run of `node packages/quay/test/serve-github.test.mjs`
   standalone to confirm the exact PASS lines quoted in §5, including
   against the real, live `yaleh/quay` issue `gh-3` (this depends on
   issue #3's `status:ready` label and its AC-checkbox state remaining
   unchanged — if either changes, the `[ready]`-status and Advance-button
   assertions would need revisiting, same caveat iterations 55/56 each
   named for their own gh-3-dependent assertions).
4. Independent confirmation that `git diff --stat -- packages/*/src/*.js`
   is empty (i.e., this is genuinely a test-only change).
5. Independent read of `packages/quay/test/serve-github.test.mjs` to
   confirm it genuinely connects through a real `quay serve` HTTP server
   backed by the real GitHub Provider (not a mocked/stubbed response), and
   that the exclusion of `POST /task/gh-3/action/advance` from live
   testing is correctly reasoned (citing `write.test.mjs`'s own precedent
   and iterations 55/56's identical write-path exclusions).
6. Independent judgment on whether crediting `skeleton +0.01` (rather than
   `abi_symmetry`, given `core-three-way-symmetry.test.mjs`'s direct
   relevance to Web-UI ABI claims) is correctly reasoned — this iteration's
   own §7 explicitly argued `abi_symmetry` (per that file's own header)
   measures cross-binding content-equivalence for a single Provider, not
   whether a single binding connects correctly to a second, live Provider,
   and that the new test proves the latter (a `skeleton`-shaped claim, not
   an `abi_symmetry`-shaped one); independent re-scrutiny of this reasoning
   is invited.
7. Independent verification that no live write occurred against issue #3
   during this session's test runs and manual exploration (`gh issue view
   3 --repo yaleh/quay --json number,state,labels`, compared against the
   value quoted in §5).
8. Independent verification of QN-061's provenance triple (`{author_by:
   native, execute_by: native, gate_by: native, status: done}`) via `cat
   tasks/QN-061.md` and re-running `task check QN-061 --json`.
9. Independent confirmation that the temporary manual exploration script
   (`packages/quay/manual-serve-github-check.mjs`) referenced in §3/§5 was
   genuinely deleted and is not part of the committed diff (`git status
   --short` should show no such file).
10. `git status --short` should show a clean working tree at audit time,
    modulo the one pre-existing, deliberately-untouched
    `docs/proposal/baime-lite-driving-external-projects.md` file.

## 10. Convergence Check

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** —
      **NO.** V_instance = 0.5183 (up from 0.5113), V_meta = 0.0973
      (unchanged). Both remain far below 0.80.
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set +
      gate)** — **NO.** σ (strict) = 53/60 = 0.8833, up from 52/59 =
      0.8814, still far from 1. No `quay:author`/`quay:execute` Method-step
      content changed; no gate logic changed.
- [ ] **3. Contract proven (native + GitHub both run)** — **NO.**
      Unchanged from iteration 56's framing — this iteration strengthens
      confidence in the contract at the third and final ABI layer (Web UI,
      previously proven only implicitly by design, not automated) but does
      not itself constitute the full contract-proof criterion.
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off)** — **NO.** No audit yet exists for *this* iteration's own
      work.
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** —
      **Literal test: YES** (ΔV_instance = 0.0070, ΔV_meta = 0.0000, both
      < 0.02, matching iterations 55/56's own ΔV_instance exactly).
      **Scored NO on substance**, consistent with standing practice: a
      small ΔV sitting far below the 0.80 dual threshold on both axes
      reflects a value function still far from convergence, not a system
      leveling off near it. Criteria 1-4 remain clearly unmet.

**Status**: **NOT CONVERGED**. Criteria 1, 2, 3, and 4 all remain clearly
NO. Criterion 5, as literally worded, is met but scored NO on substance.
V_instance (0.5183) and V_meta (0.0973) remain far below the 0.80 dual
threshold on both axes.

## Reflections

This iteration followed the standing instruction's explicit, concrete
suggestion — check whether the Web UI (the third ABI surface named in
`core-three-way-symmetry.test.mjs`/constraint 4(b)) has an analogous gap to
the CLI-level (54/55) and MCP-level (56) cross-Provider sweeps already
closed — and confirmed, by reading both existing Web-UI test files in full
and grepping for "github" (zero hits in either), that the gap was real,
not assumed. This is a genuinely new angle (the third and final
architectural layer named by the protocol's own three-way-symmetry
framing), not a re-run of either now-exhausted sweep.

The closest precedent (iterations 24/37/54/55/56, QN-034/048/058/059/060)
directly governs the scoring: a test-coverage-only regression addition for
an already-existing, unmodified capability moves `skeleton` (+0.01) but not
the other three V_instance factors. This iteration explicitly considered
and rejected `abi_symmetry` as the alternative factor (since
`core-three-way-symmetry.test.mjs` directly concerns Web-UI ABI claims),
reasoning that `abi_symmetry` (per that file's own header) specifically
means cross-binding content-equivalence for a single Provider, not
whether a single binding connects correctly to a second, live Provider —
the latter is what this iteration's test actually proves, which is
`skeleton`-shaped (the v0 loop's `serve` stage functioning end-to-end
against a real Provider).

No system evolution (no new agent, no new capability, no Skill change) is
warranted this iteration — the standing system (M_56 = M_57, A_56 = A_57)
remains stable. Having now closed the CLI-layer (iterations 54/55),
MCP-layer (iteration 56), and Web-UI-layer (this iteration) cross-Provider
read-path gaps, the three sibling ABI bindings named by the protocol
(`quay-proposal.md` §9) are now ALL proven live against the GitHub
Provider for their respective read paths. Future iterations should not
assume a fourth architectural layer of this identical gap-shape remains —
the next genuinely new angle is more likely negative/error-path coverage
specifically for the GitHub Provider (e.g. malformed issue bodies, a
repo/token misconfiguration, rate-limit or network-failure handling), a
new MCP tool or CLI/Web-UI surface being added in a future iteration, or a
fresh documentation-drift check.

## Problems identified for next iteration

1. **The `docs/proposal/quay-bootstrap-experiment.md` gitignore discovery
   remains open for human attention** (carried forward from iterations
   42-57).
2. **The alternate-AC-state-source question remains closed across six
   candidates**, unchanged, not revisited this iteration.
3. **`effectiveness` remains at its honest ceiling (0.26)**, now for 37
   consecutive iterations (21-57) — network-I/O confound (per established
   precedent) still applies.
4. **`reusability` remains flat**, now for the thirty-second consecutive
   iteration (26-57).
5. **`validation` (0.64) has now held flat since approximately iteration
   10 (47 iterations)**, unchanged this iteration; reserved for the
   top-level orchestrator.
6. **The clean-audit streak sits at 3 going into iteration 58** (iterations
   54, 55, and 56's own audits were all clean PASS). This iteration's own
   report should be scrutinized per the 10 points in §9 above.
7. **The CLI-layer, MCP-layer, and Web-UI-layer cross-Provider read-path
   test-coverage sweeps are now ALL exhausted** for the tools/subcommands/
   routes that exist as of this session — the three sibling ABI bindings
   named by the protocol's own three-way-symmetry framing are fully
   covered. Future iterations should look for a genuinely different angle
   — negative/error-path coverage specifically for the GitHub Provider
   (e.g. malformed issue bodies, rate-limit handling, repo/token
   misconfiguration), a new MCP tool, CLI subcommand, or Web-UI route being
   added, or a fresh documentation-drift check — rather than re-running
   any of the three now-exhausted sweeps, or assuming a fourth
   architectural layer of the identical shape remains undiscovered.
