# Iteration 37: quay-github's own MCP stdio transport regression coverage (QN-048)

**Date**: 2026-07-15
**Driver**: quay:author + quay:execute (native, self-selected work; `experiments/quay-native-bootstrap/directives/pending/` empty)
**Stage**: 2+ (native and GitHub Providers both exist; GitHub-Provider-side test-coverage work this iteration)

## 1. Context from prior iteration

Iteration 36 ended with: σ (strict) = 39/46 = 0.8478, V_instance = 0.4833
(0.69 × 0.96 × 0.76 × 0.96), V_meta = 0.0973 (flat many iterations), all
5 convergence criteria scored NO (criterion 3 materially narrower — the
MCP-registration sub-gap fully closed — but not YES on its own literal
wording). Iteration 36's "Problems identified for next iteration" named,
as fresh candidate sources: (1) re-reading `docs/proposal/
quay-proposal.md`/`docs/proposal/quay-native-design.md` for any
not-yet-closed "open decision"; (2) deliberately scoping a genuinely
Skill-orchestration-timing-shaped task to break `effectiveness`'s
then-15-consecutive-iteration plateau at 0.26; (3) considering whether a
genuinely new GitHub-Provider transfer-target increment (not merely
re-confirming existing behavior) is overdue, `reusability` having been
flat for 11 consecutive iterations (26-36).

Seven post-hoc corrections exist in `experiments/quay-native-bootstrap/provenance.md` prior to
this iteration (iterations 25, 29, 31, 33, 34, 35, and the
iteration-36-internal correction about a false 29/30 precedent claim,
itself corrected post-audit), all tracing to the same root cause: citing
a precedent (by name or claiming corroboration) without actually
verifying it by reading that iteration's real content. This iteration's
standing instructions explicitly reinforce that discipline: before
crediting any V-factor movement or citing any iteration as corroborating,
actually open and read that iteration's report content in full this
session, quote exact defining language, search all of `provenance.md` for
the closest precedent, and explicitly consider whether a closer precedent
argues for a different factor.

## 2. Preconditions checked

- `manda` daemon live for this workspace: confirmed via `ps aux | grep
  manda`.
- `gh` CLI authenticated as `yaleh` with repo+workflow scopes: confirmed
  via `gh auth status`.
- `experiments/quay-native-bootstrap/directives/pending/` confirmed **empty** via `ls` (mandatory
  first step).
- Full regression suite (24 `*.test.mjs` files across all three packages,
  plus `abi-symmetry.mjs`) re-run at the start of this iteration to
  confirm a clean starting baseline: all pass.
- `git status --short` confirmed clean at the start of this iteration
  (modulo the pre-existing, deliberately-untouched
  `docs/proposal/baime-lite-driving-external-projects.md`).

## 3. Observe

Iteration 36's three candidate directions were evaluated in order of
concreteness and evidentiary risk:

- **Effectiveness-plateau-breaking work** was considered but explicitly
  *not* fabricated: the instructions for this iteration were explicit
  that self-selected work should be genuinely Skill-orchestration-timing-
  shaped if such work naturally arose, but must not be manufactured
  solely to move `effectiveness`. No such naturally-arising work
  presented itself this iteration (see §8 for why the work actually done
  does not qualify either).
- **`docs/proposal/quay-proposal.md` §15/§16 and `docs/proposal/
  quay-native-design.md` §8** were re-read fresh (not from memory) this
  iteration. Both sections are historical "open decisions"/"risks" lists
  that are already resolved by the current implementation (matching the
  finding already recorded from this same re-read in this iteration's own
  working notes) — no fresh actionable gap found there.
- **`packages/quay/DESIGN.md` §2.5 "Known gaps"** was re-read fresh: all
  previously-named gaps are closed (mcp-server.js session gap closed
  iterations 28/36; `task_write` CAS closed iteration 32; manifest
  name-vs-uri closed iteration 30). No fresh gap found here either.
- **A systematic grep across all three packages' test files** was run to
  find any capability with zero test coverage:
  `grep -rl "mcp-server\|StdioClientTransport" packages/*/test/` was
  cross-checked against each package's actual capability surface. This
  surfaced a genuine, concrete, previously-undiscovered (by this
  experiment's own test suite, not merely by documentation) gap:
  `packages/quay-github/src/mcp-server.js` — the GitHub Provider's own
  MCP stdio transport (`provider://manifest`, `task_list`, `task_get`,
  `task_write`, `task_check`) — had **zero automated test coverage
  anywhere in the repo**. `packages/quay/test/mcp-server.test.mjs` covers
  Core's own MCP transport; `packages/quay-native/src/mcp-server.js` is
  exercised by `abi-symmetry.mjs`; but `quay-github`'s own MCP transport
  had never been spawned as a real subprocess with a real MCP client in
  any test file.

This is not a newly-invented gap: **QN-034 (iteration 24)**, read in full
this iteration, explicitly named "the `mcp` subcommand (starting the
stdio MCP transport)" as out of scope for its own CLI-dispatch-layer
closure, "for its different (long-running, stdio-server)
process-lifecycle shape," and iteration 24's own "Problems identified for
next iteration" section explicitly predicted this exact gap as the next,
harder candidate for this package. This iteration closes precisely that
named residual, 13 iterations later.

This work naturally touches `packages/quay-github` (a Provider-side
package), giving an opportunity to re-examine whether `reusability`
should move — addressed rigorously in §7/§8 below by reading iteration
24's own directly-on-point reasoning for the analogous QN-034 case,
rather than assuming.

## 4. Strategy

Given the concrete, real, previously-undocumented gap found, the strategy
selected was to close it following the exact established pattern from
this project's own Core-side sibling test
(`packages/quay/test/mcp-server.test.mjs`) and this package's own
live-repo write-avoidance convention (`write.test.mjs`/`cli.test.mjs`),
rather than inventing a new pattern. Priorities, in order:

1. Read `packages/quay-github/src/mcp-server.js` in full and
   `packages/quay/test/mcp-server.test.mjs` for the connection/assertion
   pattern to mirror.
2. Live-probe `quay-github.js mcp` manually to confirm the process starts
   and prints its banner before encoding assertions.
3. Write the new test file, asserting resource enumeration, `task_list`,
   `task_get` (happy + not-found), `task_check` (both real issues,
   cross-checked against direct CLI output), and `task_write`'s
   unknown-id error path only (no live write ever attempted).
4. Adversarially break one assertion-relevant line, confirm a live FAIL,
   restore, confirm byte-identical restoration, re-confirm a full green
   run.
5. Re-run the full regression suite across all three packages.
6. Record creation-to-execute-done timestamps for the `effectiveness`
   marginal-timing comparison (with the explicit expectation, per §7/§8
   below, that this data will not actually be creditable toward
   `effectiveness` given the live-`gh api` network-I/O confound iteration
   24 itself identified).

This was authored and driven through `quay-native`'s own CLI lifecycle
(`task create`/`task edit --status ready`/`task edit --status done`) with
`task check` gated at both transitions, per the standing "native" (see
§6 for the honesty note on what that does and does not mean).

## 5. Execution

`packages/quay-github/src/mcp-server.js` (133 lines) was read in full,
confirming it exports `startMcpServer({owner, repo})` registering
`provider://manifest` plus `task_list`, `task_get`, `task_write`,
`task_check` tools — structurally mirroring `packages/quay-native/src/
mcp-server.js` (design §6 symmetry principle). `bin/quay-github.js` (133
lines) was read in full, confirming the `mcp` subcommand dispatch:
`if (cmd === "mcp") { const { startMcpServer } = await
import("../src/mcp-server.js"); await startMcpServer({ owner, repo });
return; }`. `packages/quay/test/mcp-server.test.mjs` (359 lines) was read
in full as the Core-side sibling pattern to mirror. `tasks/QN-034.md` was
read in full as the closest sibling task-body precedent for scoping
QN-048 (both are GitHub-Provider, live-repo-constrained, test-coverage-
only tasks).

`tasks/QN-048.md` was created via `quay-native task create`, with a full
Proposal/Plan/AC/DoD body (4 AC items, 4 DoD items) naming the gap, the
sibling relationship to QN-034, the live-repo constraint, and the
explicit out-of-scope carve-out (the real `task_write` status-change path
against a live issue). Gated `todo → ready` via `task check`: `ok:true`.

`packages/quay-github/test/mcp-server.test.mjs` (135 lines) was written,
spawning the real `bin/quay-github.js mcp` subprocess via
`StdioClientTransport`, with `QUAY_GITHUB_REPO=yaleh/quay`, asserting:

1. Resource enumeration: `provider://manifest` is listed, its entry
   carries a non-empty `name` field, and reading it resolves to
   `id === "github"`.
2. `task_list` includes the real, currently-open issues `gh-3` and
   `gh-4`.
3. `task_get('gh-3')` via MCP is byte-identical (via `JSON.stringify`
   comparison) to the direct CLI's own `task get gh-3 --json` output.
4. `task_get` for an unknown id (`gh-999999`) returns `isError:true`, not
   a crash.
5. `task_check` for both `gh-3` and `gh-4` via MCP is byte-identical to
   the direct CLI's own `task check <id> --json` output (handling the
   CLI's own nonzero-exit-on-`ok:false` behavior via `try/catch` and
   `err.stdout`).
6. `task_write` for an unknown id returns `isError:true` — the **only**
   `task_write` call this file ever makes, so `client.setStatus` is never
   reached with a real, existing task id and no live write to any real
   GitHub issue ever occurs.

Live run: `node packages/quay-github/test/mcp-server.test.mjs` — all 6
assertion groups PASS, exit code 0.

**Adversarial break/restore cycle**: `src/mcp-server.js`'s `task_check`
handler line `structuredContent: result,` was changed to
`structuredContent: { ...result, ok: !result.ok },`. Re-running the test
produced exactly 2 live FAILs (the `task_check('gh-3')` and
`task_check('gh-4')` byte-identity assertions), confirming the test has
real teeth. The file was then restored via `cp` from a saved backup and
confirmed byte-identical to the original via `diff` (empty output) and
`git diff --stat -- packages/quay-github/src/mcp-server.js` (empty). The
test was re-run once more: full green, 0 failures.

**Full regression suite**: all 24 `*.test.mjs` files across all three
packages, plus `abi-symmetry.mjs`, were re-run after the new file was
added — zero regressions, including the new QN-048 file itself
("All QN-048 quay-github MCP server tests passed.").

**Live-write-avoidance verification**: `gh issue list --repo yaleh/quay
--state all --json number,title,state,labels,body` was re-run after task
completion, confirming the same 2 open issues (`#3`, `#4`), same labels,
same body content as before this task started — no accidental live write
occurred.

`packages/quay-github/DESIGN.md` was updated in place: header Status line
updated to mention QN-048/§3.7, and a new `### 3.7 MCP stdio transport
regression coverage (iteration 37, QN-048)` section was inserted between
the existing §3.6 "Skill path" and §4, documenting the gap closed, what
was built, the live-repo write-avoidance discipline followed, the
zero-source-change confirmation, and the adversarial break/restore
result.

`tasks/QN-048.md` was gated `ready → done` via `task check`: `ok:true`
(4/4 AC checkboxes checked, cross-verified against real command output,
not "should work" reasoning). All 8 AC/DoD checkboxes were flipped from
`[ ]` to `[x]` only after each was independently, genuinely re-verified.

Timestamps recorded in `experiments/quay-native-bootstrap/timing/iteration-37.log`:
author-create → execute-done span = 3m07s (187s), vs. stage-0 comparator
QN-006 (~2m59s/179s, +8s/~4.5% slower) and iteration-22's own
scope-matched QN-032 comparator (3m07s — coincidentally identical span).
Per §7/§8 below, this data is recorded for completeness but **not**
credited toward `effectiveness`, matching iteration 24's own explicit
reasoning for the identical live-network-dependent fact pattern.

## 6. Provenance update

`experiments/quay-native-bootstrap/provenance.md` updated with a new "Records (as of end of
iteration 37)" section (task ledger row for QN-048, the honesty note on
QN-048's lifecycle execution), a new "σ computation — iteration 37"
section, and a new "V-factor attribution — iteration 37" section — all
detailed in §7/§8 below and written into `provenance.md` directly.

**Honesty note on QN-048's lifecycle execution.** As with every task
since the seed's author/execute retirement, "native" means the
`quay-native` CLI's mechanical `task check` gate was genuinely invoked at
both the author→ready and execute→done transitions (both returned
`ok:true`, confirmed via direct command output, not estimated), and the
task file itself was authored and driven through its lifecycle using
`quay-native task create`/`task edit`/`task check` rather than
hand-edited frontmatter status. It does NOT mean an independent,
fresh-context subagent performed the authoring or execution work in
isolation from this top-level session — this environment still has no
verified subagent-dispatch primitive (confirmed via `ToolSearch` this
iteration, per G6), so "native" continues to describe the degraded-
fallback mode already documented for every prior "native" entry since
iteration ~15.

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

Per the standing discipline, the closest — and directly on-point —
precedent for this iteration's work is **iteration 24 (QN-034)**, read in
full this iteration (`experiments/quay-native-bootstrap/iterations/iteration-24.md`, offsets
445-600 and 751-800). QN-034 closed the identical class of gap (a
test-coverage-only regression-test addition for `bin/quay-github.js`'s
CLI dispatch layer, live against the same real `yaleh/quay` issues #3/#4,
zero source-code change) and its own reasoning, read verbatim, scored:
`skeleton` +0.01 (0.64→0.65, "a genuinely new regression-test file
closing a previously-real, zero-coverage gap in an existing dispatch
loop — the same magnitude and shape as QN-030/032/033's own test-only
additions"); `reusability` held flat (0.68), with explicit reasoning that
a test-coverage-only addition to an already-existing GitHub-Provider
capability is not "methodology transfer" evidence; `effectiveness`
explicitly not measured, reasoning that a task with a live external-
network dependency conflates methodology speedup with network-I/O
latency variance, orthogonal to what `effectiveness` measures.

This iteration's QN-048 is the exact sibling event QN-034 explicitly
predicted and scoped around, one layer harder (MCP stdio transport
process-lifecycle shape, rather than direct CLI dispatch) but otherwise
identical in kind. Applying iteration 24's own precedent directly:

- **`skeleton`: 0.69 → 0.70 (+0.01).** A genuinely new regression-test
  file closing a previously-real, zero-coverage gap in an existing
  process-lifecycle loop (the MCP stdio server's tool/resource dispatch),
  matching QN-030/032/033/034's own test-only-addition magnitude and
  reasoning exactly.
- **`abi_symmetry`: 0.96 (unchanged).** No new Core-level CLI/MCP/Web-UI
  schema-or-content-equivalence proof was produced this iteration
  (constraint 4(b)); `abi-symmetry.mjs` re-run unchanged, still "ALL FOUR
  SURFACES SYMMETRIC". This iteration's cross-checks (`task_get`/
  `task_check` via MCP vs. direct CLI) are within `quay-github`'s own
  surfaces, not a new Core-level CLI/MCP/Web-UI proof — not implicated.
- **`gate_correctness`: 0.76 (unchanged).** No gate-logic change to
  `store.js`/`github-client.js`'s `checkGate()`; QN-048's own
  `task_check` assertions cross-check existing, unmodified gate output,
  they do not change it.
- **`skill_convergence`: 0.96 (unchanged).** No Skill-orchestration
  (`quay:author`/`quay:execute` SKILL.md Method-step) change this
  iteration.

```
V_instance = 0.70 × 0.96 × 0.76 × 0.96 = 0.4903
```

ΔV_instance = **+0.0070** (up from 0.4833).

## 8. V_meta

```
V_meta = completeness × effectiveness × reusability × validation
```

- **completeness: 0.74 (unchanged).** Matching iteration 24's own
  reasoning for QN-034 verbatim: this task documents a test-coverage gap
  closure for existing MCP-transport behavior, not new orchestration-
  Skill methodology content. `packages/quay-github/DESIGN.md` §3.7
  records the closure but does not introduce new reusable Skill/
  methodology guidance. Conservatively not counted toward completeness.
- **effectiveness: 0.26 (unchanged).** Timing data was recorded
  (`experiments/quay-native-bootstrap/timing/iteration-37.log`: 3m07s/187s author-create→
  execute-done span) but, per iteration 24's own explicit, directly-
  applicable reasoning, a task with a live external-network dependency
  (`gh api` calls against real issues gh-3/gh-4) is not a valid comparator
  against the stage-0 seed baseline — the confound is network-I/O latency
  variance, not methodology signal. This is the same confound iteration
  24 itself first identified for the analogous QN-034 case; repeating its
  conclusion here rather than making a fresh judgment call. Remains the
  honest, unmeasured ceiling, now for **17 consecutive iterations (21-34,
  35, 36, and now 37)**. No genuinely Skill-orchestration-timing-shaped
  work arose naturally this iteration either; per explicit instruction,
  none was fabricated to force a break in this plateau.
- **reusability: 0.79 (unchanged).** QN-048 adds test coverage to an
  already-existing GitHub-Provider capability (`src/mcp-server.js`, built
  at an earlier iteration; `git diff --stat -- packages/quay-github/src/
  mcp-server.js` confirmed empty after the adversarial break/restore
  cycle); it does not build a *new* capability via quay-native *driving*
  GitHub-Provider construction, which is the precise "methodology
  transfer" scope this factor measures (protocol §5.2, reinforced
  directly by iteration 24's own reasoning for the analogous QN-034).
  Held flat for the **twelfth consecutive iteration (26-37)**. Crediting
  this would repeat exactly the kind of precedent-blind overclaim the
  session's prior seven post-hoc corrections were about.
- **validation: 0.64 (unchanged).** Per standing convention, credited
  only after the out-of-band audit for this iteration's own work occurs
  (next iteration, via the top-level orchestrator's separate `Agent`
  dispatch, G3). Correctly held flat pending that audit, not
  self-simulated.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
```

ΔV_meta = **0.0000** (unchanged). QN-048's genuine contribution (closing
a real, 13-iteration-old, precisely-named test-coverage residual) moves
`skeleton` on the instance layer but, per iteration 24's own directly
on-point precedent, does not move any of the four V_meta factors.

## 9. Out-of-band audit

**No new out-of-band audit was initiated or attempted by this
iteration-executor session**, per standing rules — G3 audit dispatch is
exclusively the top-level orchestrator's job, performed separately after
this report is committed, via its own native `Agent` tool. This session
did not attempt to self-obtain or simulate any such audit.

`experiments/quay-native-bootstrap/audits/iteration-36-independent-adjudicate.md` remains the
most recent independent audit of this experiment's iteration work.

**This iteration's work merits close audit scrutiny on the following
points**, named explicitly for the next audit to check independently:

1. Whether crediting `skeleton` +0.01 (rather than `reusability` or
   `abi_symmetry`) is correct — an independent reviewer should re-derive
   against iteration 24's precedent (quoted in full in §7 above) and
   confirm that QN-048's fact pattern (new test file, zero source-code
   change, GitHub-Provider-side, live-repo-constrained) genuinely matches
   QN-034's own fact pattern rather than differing in a way that would
   argue for a different factor.
2. Whether holding `reusability` flat despite this iteration's work
   touching `packages/quay-github` is correct, given the precise
   "methodology transfer" scope this factor measures per protocol §5.2 —
   an independent reviewer should confirm no new capability was built via
   quay-native driving GitHub-Provider construction (only test coverage
   for an existing, unmodified capability).
3. Whether holding `effectiveness` flat despite recording timing data is
   correct, given the network-I/O confound reasoning inherited directly
   from iteration 24 — an independent reviewer should confirm this
   iteration's QN-048 genuinely shares the same live-`gh api`-dependent
   fact pattern as QN-034, not a subtly different one.
4. Independent re-run of the adversarial break/restore cycle (2 live
   FAILs expected, then clean restore) and the full regression suite (24
   `*.test.mjs` files plus `abi-symmetry.mjs`) to confirm zero
   regressions.
5. Independent re-verification that `gh issue list --repo yaleh/quay
   --state all` shows the same 2 open issues, unchanged, before and after
   this task.
6. `git status --short` should show a clean working tree at audit time,
   modulo the one pre-existing, deliberately-untouched
   `docs/proposal/baime-lite-driving-external-projects.md` file.

## 10. Convergence Check

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** —
      **NO.** V_instance = 0.4903 (up from 0.4833), V_meta = 0.0973
      (unchanged). Both remain far below 0.80.
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set
      + gate)** — **NO.** σ (strict) = 40/47 = 0.8511, up from
      39/46 = 0.8478, still far from 1. No `quay:author`/`quay:execute`
      Method-step content changed this iteration; no gate logic changed.
      Remains NO for the same standing reason (σ < 1).
- [ ] **3. Contract proven (native + GitHub both run)** — **NO.**
      Unchanged from iteration 36's framing. This iteration's work
      strengthens the GitHub Provider's own test-coverage completeness
      (a different, narrower scope than criterion 3's own "both run"
      wording), but does not itself newly prove or disprove the broader,
      durable contract-stability claim criterion 3 names.
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off)** — **NO.** No audit yet exists for this iteration's own
      work (correctly — it happens after this report is committed).
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** —
      **Literal test: YES**, now for a third consecutive iteration
      (ΔV_instance = +0.0070 this iteration, 0.0000 at iteration 36,
      +0.0050 at iteration 35's own corrected values — all < 0.02).
      **Scored NO on substance**, consistent with this experiment's
      standing practice (iterations 28-36): a small/flat ΔV sitting far
      below the 0.80 dual threshold on both axes reflects a value
      function genuinely pinned near its own floor, not a system
      approaching convergence and leveling off there. Criteria 1-4 remain
      clearly unmet.

**Status**: **NOT CONVERGED**. Criteria 1, 2, 3, and 4 all remain clearly
NO. Criterion 5, as literally worded, is met for a third consecutive
iteration but scored NO on substance for the reasons above. V_instance
(0.4903) and V_meta (0.0973) remain far below the 0.80 dual threshold on
both axes.

## Problems identified for next iteration

1. **A fresh source of self-selected work will again be needed** for the
   next iteration if `directives/pending/` is again empty. This
   iteration's gap (quay-github MCP transport coverage) is now closed;
   the systematic-grep technique used to find it (search every package's
   test files for missing coverage of an existing capability) proved
   productive and should be reused, alongside re-checking whether any
   fresh gap has emerged in `packages/quay/DESIGN.md`/`packages/
   quay-github/DESIGN.md`.
2. **`effectiveness` remains at its honest ceiling (0.26)**, now for 17
   consecutive iterations (21-34, 35, 36, and now 37) — the single
   longest-flat V_meta factor in the experiment's history. This
   iteration's own timing data (§8) again could not be credited due to
   the live-network-I/O confound. A future iteration should consider
   whether a genuinely Skill-orchestration-timing-shaped task — one with
   *no* live external-network dependency, timed end-to-end through a real
   `quay:author`→`quay:execute` Skill invocation — can be deliberately
   scoped to finally produce a creditable data point, rather than
   continuing to wait for one to arise naturally from otherwise-motivated
   work.
3. **`reusability` remains flat**, now for the twelfth consecutive
   iteration (26-37). This iteration's work touched `packages/
   quay-github` but, per iteration 24's own directly on-point precedent,
   test-coverage-only additions to an already-existing capability do not
   count as "methodology transfer" evidence. A future iteration should
   consider whether a genuinely new GitHub-Provider capability increment
   — built by quay-native's methodology actually driving new construction,
   not merely testing existing behavior more thoroughly — is overdue; no
   such increment has been scoped since iteration 25 (QN-035).
4. **This iteration's precedent-matching to iteration 24 is itself the
   most audit-sensitive claim in this report** (see §9 points 1-3) — a
   future iteration should not treat this iteration's own reasoning as
   settled precedent until the next independent audit has reviewed it.
5. **The systematic cross-package coverage-gap grep technique used this
   iteration** (`grep` every `*.test.mjs` file for references to each
   capability file, cross-checked against each package's actual surface)
   is itself now documented, reusable evidence for any future iteration
   needing to find a genuine, non-fabricated self-selected-work candidate
   without assuming design docs are exhaustive or current.
