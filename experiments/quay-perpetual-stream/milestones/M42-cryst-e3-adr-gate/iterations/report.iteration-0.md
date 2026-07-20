# M42-cryst-e3-adr-gate — iteration-0 report

**Worktree:** `milestones/M42-cryst-e3-adr-gate/worktrees/iteration-0` (branch `exp5-m42-iteration-0`,
base `780bd4b`, fast-forwarded onto `d447a1b` mid-iteration — see §0 below).

**Dispatcher pattern used:** `baime:iteration-executor` subagent dispatch was probed and found
unreachable (`ToolSearch` returned no match; the generic `mcp__plugin_manda_manda__Agent` spawn tool
errored `cap request requires to=` — no addressed broker configured in this session), matching the
m41 precedent. Fell back to isolated-worktree DIRECT EXECUTION by the orchestrator itself. Per the
charter's dispatcher notes (5a mandatory dev-class routing), independence is spent UPSTREAM at the
`quay-task-to-plan` pipeline's N=2 proposal step (drafted sequentially by this same orchestrator
context, NOT genuinely isolated subagents — an honestly-flagged process-fidelity limitation, see
`pipeline/proposals.md`'s own note) and DOWNSTREAM at the adversarial-audit gate (`audit.md`) — there
is no additional whole-milestone iteration-1 re-derivation for this dev-class milestone.

## §0 Preconditions / mid-flight master advance (DIR-027/DIR-031 hygiene)

While this worktree's implementation was in progress, the MAIN working tree's `master` advanced by
4 commits, landed by out-of-band human work (per their own commit messages, "authored off-loop per
DIR-027"): `fe8c223`/`d9de6f3` (ADR-012 TS-migration decision + `exp5-M-TS-MIGRATION` program task)
and `d9e9864`/`d447a1b` (DIR-031 Tier-1 loop hygiene + `tree-hygiene-check.sh`). Verified via
`git merge-base --is-ancestor 780bd4b master` (yes) and confirmed ZERO file overlap with this
milestone's in-scope files (`adr-store.js`, `registry.js`, `adr/ADR-001-*.md`, `quay-native.js`) via
`git diff 780bd4b master --stat -- packages/ adr/ tasks/exp5-M-CRYST-E3.md`. Rebased cleanly:
`git stash push -u` → `git merge --ff-only <master-tip>` (clean fast-forward, no conflicts) →
`git stash pop` (clean, no conflicts). Re-ran `tree-hygiene-check.sh` post-merge: PASS ("clean — no
un-gitignored scratch left in the main tree"). This is the DIR-027/DIR-031 steering-hygiene loop
working as intended — human work slotted in without racing this milestone.

## §1 Build (AC 1-4)

Followed the mandatory dev-class `quay-task-to-plan` pipeline (5a): N=2 draft proposals
(`pipeline/proposals.md`) → adjudication (`pipeline/adjudication.md`, DIVERGED on `enforcement`'s
shape — raw command string vs structured `{check,args}`; adopted the raw-command-string convention,
matching `task.extra.acceptance`, with proposal 2's registration-table idea folded in) → write-back
to the task's `## Proposal`/`## Plan` sections (`tasks/exp5-M-CRYST-E3.md`) → milestone-level plan
(`docs/plans/10-adr-gate-enforcement.md`, 4 phases, self-checked once, F_1=0) → implementation.

### AC1/3 — `adr-001` gate wired to B7, real GateEvent
`packages/quay-native/src/adr-store.js`: `toViewModel` now surfaces `appliesTo`/`enforcement` from
the previously-reserved-but-unconsumed frontmatter fields (E1's own forward-compat design); added
`appliesToMatches()` using Node's built-in `path.matchesGlob` (no new dependency).
`packages/quay/src/gate/registry.js`: new `makeAdrGate(adrId, adrDir)` factory (mirrors M39's
`makeIt0Gate` wrap-a-script discipline exactly — reads the ADR at gate-run time, fails closed on
missing/not-accepted/no-enforcement, shells the `enforcement` command through the SAME
`runAcceptance` runner every other gate uses), registered via a declarative `ADR_GATE_IDS` table
(`["ADR-001"]` → `adr-001`). ADR-001's frontmatter now carries:
```yaml
applies-to:
  - "experiments/quay-perpetual-stream/scripts/**"
enforcement: "bash experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh --scripts experiments/quay-perpetual-stream/scripts --tests experiments/quay-perpetual-stream/test"
```
Real end-to-end CLI proof (fixture task written into, then removed from, the real repo's `tasks/`
dir — the enforcement command's paths are repo-root-relative, so an `adr-<id>` gate's realistic
invocation IS the repo it governs, unlike the free-form `acceptance` gate):
```
$ node packages/quay/bin/quay.js gate T-ADR001-e2e-fixture --gate adr-001 --file <tmp-log>
PASS
$ node packages/quay/bin/quay.js gate-log T-ADR001-e2e-fixture --json --file <tmp-log>
[{ "gate": "adr-001", "verdict": "pass", ... }]
```

### AC2 — violating vs conforming fixture, both directions pinned
`packages/quay/test/adr-gate.test.mjs` builds a synthetic violating load-bearing-scripts tree
(script importing a helper with NO sibling test) and a conforming one (sibling test present), points
a fixture ADR's `enforcement` at each via `loadbearing-test-gate.sh`, and asserts FAIL / PASS
respectively through the exact same `runAcceptance` mechanism the real gate uses.

### AC4 — consult surface
Added `--applies-to <path>` to `quay-native adr list` (`packages/quay-native/bin/quay-native.js`),
composable with `--status`/`--tag`. Verified live against the real `adr/` dir:
```
$ node packages/quay-native/bin/quay-native.js adr list --applies-to \
    experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.mjs --json
[{ "id": "ADR-001", ... }]   # in-scope path -> present
$ node packages/quay-native/bin/quay-native.js adr list --applies-to \
    packages/quay/src/gate/registry.js --json
[]   # out-of-scope path -> absent
```

## §2 Test-floor (Clause 7 — APPLIES, real product code)

`node --test --experimental-test-coverage` (full `packages/quay` suite excl. serve-github/
provider-abi-conformance, run post-merge):
- **164/165 pass** — the 1 failure (`web-ui-browser.test.mjs`) is a PRE-EXISTING, unrelated browser-
  environment failure, independently confirmed to fail IDENTICALLY on pristine `master` (ran outside
  this worktree, same failure, same test, zero relation to any file this milestone touches).
- `packages/quay-native/test/adr-store.test.mjs`: **13/13 pass**, `adr-store.js` **93.30% line /
  80.30-83.33% branch / 100% funcs** coverage (3 new tests: surfacing, safe-default, applies-to
  filter — RED-then-GREEN, RED confirmed before implementation).
- `packages/quay/test/adr-gate.test.mjs` (new, 11 tests) + `gate.test.mjs`/`gate-cli.test.mjs`
  (pre-existing, unmodified, re-run to confirm no regression): **34/34 pass**; `registry.js`
  **94.15% line / 86.96% branch / 100% funcs** in the full-suite coverage run (the authoritative
  combined number — narrower per-file runs read lower since they don't exercise every gate path).
- No import cycle introduced: `registry.js` -> `adr-store.js` is a new cross-package import, but
  `quay-native` has zero imports from `quay` (`grep` confirmed) — same one-directional shape as the
  existing `dod` gate's indirect `client.taskCheck()` reliance on quay-native.

## §3 it0 mechanical gates (re-run post-merge, inside the worktree)
- `it0-gate-hash-check.sh --by-reference` against the charter: **PASS** (hash matches pinned source).
- `it0-ceiling-line-budget-check.sh` against the charter: **PASS** ("scope within the small-milestone
  norm").
- `it0-impl-row-check.sh`: **N/A** — this milestone is not design-only (real product code landed);
  confirmed the milestone has no `backlog.md` row at all yet (backlog.md is a generated view, not
  hand-edited), consistent with the charter's own N/A note — the rule genuinely does not apply.
- `vmeta-lag-check.sh --counter 41 v-meta-ledger.md`: **PASS** ("no confirmed-unconsolidated row past
  K without a dated carry-forward").
- `tree-hygiene-check.sh` (new, DIR-031): **PASS** post-merge.

## §4 Known limitations (stated, not hidden)
- The "N=2 independent proposals" in `pipeline/proposals.md` were drafted sequentially by this same
  orchestrator context, not dispatched to genuinely isolated subagents (no reachable dispatch
  mechanism this session) — same-context anchoring risk not eliminated, flagged in the pipeline docs
  themselves.
- `adr-001`'s `enforcement` command uses repo-root-relative paths; the gate is only meaningfully
  runnable from within the repo it governs (not an arbitrary workspace) — an intentional, documented
  design choice (see `registry.js`'s `makeAdrGate` docstring), not a defect, but worth the adversarial
  audit's attention.
