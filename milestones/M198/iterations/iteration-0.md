# M198 / DIR-119-D1 — Iteration 0 (Build)

**Task:** DIR-119-D1 — real manifest phase/shard synthesis at the SELECT/dispatch boundary
(`composite-manifest-synthesis.ts`) — first child of DIR-119-D's 5-way split.
**Charter:** `experiments/quay-perpetual-stream/charters/M198-dir119d1-manifest-synthesis.md`
**Plan:** `docs/plans/M198-dir-119-d1.md` (7 stages, all 18 task AC items mapped)
**Build mode:** direct-to-master edit-in-place (no iteration worktree), per this repo's confirmed
current `execute-milestone.js` Build-phase behavior (CLAUDE.md's 2026-07-28 correction).

## What was built

1. **New module** `experiments/quay-perpetual-stream/scripts/composite-manifest-synthesis.ts`
   (545 lines) + byte-identical `plugin/scripts/` mirror. Exports:
   - `synthesizeManifest(candidate, taskFacts, couplingGraph, capacity?)` — pure union-find fusion
     over each candidate member task's Touches overlap (+ coupling-graph `shared-implementation`/
     `shared-semantic-resource` edges as a second fusion signal), fail-toward-fusion on
     missing/empty Touches, prohibiting-edge check BEFORE any union-find step (throws
     `ProhibitingEdgeError`). Emits one `task-ac` audit shard per member task, one
     `semantic-integration` shard per multi-task phase, sorted/membership-derived deterministic ids.
   - `DEFAULT_SYNTHESIS_CAPACITY` — real exported constant (`{maxPhases:32, maxAuditShards:64,
     maxParallelAgents:4, landPolicy:"atomic"}`); only the `CapacityLimits`-shaped subset is ever
     written into `context.capacity`.
   - `extractCharterTaskIds(text)` — reads a charter's `**Task:**` line (or a `## Scope` bullet
     list fallback); the CLI folds the result into `context.charterTaskIds` so
     `checkCompositeContract()`'s own `membership-mismatch-charter` check IS the candidate-vs-charter
     validation (no separate ad hoc check).
   - `loadTaskFacts(taskIds, taskStoreDir, workspaceRoot)` — CLI-layer I/O: reads each task's real
     markdown file, calls `parseTouches`/`expandGlobs` (direct reuse) to get expanded concrete
     Touches, counts real `## Acceptance Criteria` checkbox items.
   - A CLI (`--candidate-json`/`--charter`/`--workspace-root`/`--task-store-dir`/`--out`, plus
     `--explicit-edges-json`/`--max-phases`/`--max-audit-shards`) matching
     `milestone-preparation-check.ts`'s separate-named-flags convention. Self-validates via
     `checkCompositeContract()` before writing; writes via `fs.writeFileSync(tmp)` +
     `fs.renameSync(tmp, out)`.
2. **Test file** `experiments/quay-perpetual-stream/test/composite-manifest-synthesis.test.mjs`
   (351 lines, 15 scenarios, all RED-then-GREEN during Build) + byte-identical `plugin/test/`
   mirror. Covers: fusion of overlapping Touches, fail-toward-fusion on empty Touches, genuinely
   disjoint Touches staying split, byte-identical re-run (order-independent), capacity-constant
   shape, prohibiting-edge exclusion (unit-level direct `synthesizeManifest()` call, AC17), charter
   task-id extraction, real-filesystem `loadTaskFacts()`, and three CLI-subprocess scenarios
   (successful write + content-match, contract-violation rejected before write via a
   `--max-phases` override, prohibiting-edge rejected before write via `--explicit-edges-json`),
   plus the AC4 vacuous-pass documentation fixture (imports the real, unmodified
   `composite-preflight.ts`) and a hand-corrupted-manifest unit test.
3. **`.claude/workflows/select-preflight.js`** edited (TASK 1 step 3, TASK 4's return shape, and
   the result schema) so the agent prompt now instructs: parse the real `portfolio` field from
   `select-preflight.ts`'s `PreflightResult` and thread it through verbatim into this workflow's
   own returned JSON (previously read internally and discarded). `node --check` confirms the file
   stays syntactically valid.
4. **`experiments/quay-perpetual-stream/OUTER-LOOP.md`** edited: a new `⊨` bullet after the
   existing DIR-119-B paragraph in `execute()`, naming the `taskIds.length > 1` condition, the
   literal synthesis-CLI invocation, and the `compositeManifestFile` threading into the
   `execute-milestone.js` dispatch args (doc-text only, matching the DSL's five-global constraint).
5. **Infrastructure gap found + fixed (within touch-set spirit, disclosed):**
   `plugin/scripts/gate-script-base.ts` did not exist — `composite-preflight.ts`'s own `plugin/`
   mirror has always imported it (broken, silently, because no `plugin/test/composite-*.test.mjs`
   file had ever exercised that mirror through `scripts/test.sh` before this milestone). This
   child's own new `plugin/test/composite-manifest-synthesis.test.mjs` imports `composite-preflight.ts`
   for the AC4 fixture, which surfaced the gap. Fixed by mirroring `gate-script-base.ts` (byte-identical
   copy, zero logic authored) and adding it + `composite-manifest-synthesis` to `sync-vendor.sh`'s
   `SYNC_SCRIPTS` array. `composite-manifest-synthesis.ts` itself does NOT import
   `gate-script-base.ts` — it uses the same inline direct-entry-check pattern as
   `composite-contracts.ts`/`coupling-graph.ts`/`composite-args.ts`, specifically to avoid adding a
   new cross-file dependency of its own.

## Guardrails re-verified (Stage 7 / Plan §Guardrails)

```
$ grep -n 'from "./touches-orthogonality-check.ts"\|from "./coupling-graph.ts"' \
    experiments/quay-perpetual-stream/scripts/composite-manifest-synthesis.ts
49:import { parseTouches, expandGlobs, filesDisjoint } from "./touches-orthogonality-check.ts";
50:import { buildCouplingGraph, deriveInternalOrderEdges, hasProhibitingEdge, type CouplingGraph } from "./coupling-graph.ts";

$ git diff 8addd4f..HEAD -- experiments/quay-perpetual-stream/scripts/composite-contracts.ts \
    experiments/quay-perpetual-stream/scripts/composite-preflight.ts \
    experiments/quay-perpetual-stream/scripts/composite-args.ts \
    experiments/quay-perpetual-stream/scripts/coupling-graph.ts \
    experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.ts
(empty — all five non-goal files byte-unmodified)
```

## Real regression proof (AC8/AC9)

Real proof-run command output is under `milestones/M198/evidence/`. Real, currently
`status:todo` tasks `DIR-100` (`packages/quay/src/gate/config/loader.ts`, ...) and `DIR-101`
(`packages/quay-native/src/*`) — genuinely disjoint declared `## Touches` — were used as the
candidate's member tasks (real task facts read live from `tasks/DIR-100.md`/`tasks/DIR-101.md`):

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-manifest-synthesis.ts \
    --candidate-json '{"candidateId":"m198-proof-DIR-100+DIR-101","taskIds":["DIR-100","DIR-101"]}' \
    --charter milestones/M198/evidence/scratch-proof-charter.md \
    --workspace-root . --task-store-dir tasks \
    --out milestones/M198/evidence/proof-manifest-DIR-100+DIR-101.json
{"ok":true,"out":"...","candidateId":"m198-proof-DIR-100+DIR-101","taskIds":["DIR-100","DIR-101"],"phaseCount":2,"auditShardCount":2}

$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-preflight.ts \
    --args-json '{"milestoneCandidate":{"taskIds":["DIR-100","DIR-101"]},"compositeManifestFile":"milestones/M198/evidence/proof-manifest-DIR-100+DIR-101.json","charterFile":"...","absorbEntryFile":"x"}'
{"ok":true,"taskIds":["DIR-100","DIR-101"],"isComposite":true,"contractViolations":[]}
```

`phaseCount: 2` (genuinely disjoint Touches stayed split, not fused) and the UNMODIFIED
`composite-preflight.ts` contract check passes.

## Honest disclosure — what this Build iteration did NOT close

**A real, currently-live, pre-existing defect was found and is out of this child's scope to fix:**
`select-preflight.ts`'s `getTaskList()` has a hardcoded 60000ms `execFileSync` timeout on `quay task
list --json`. Measured live, twice, in this session: 66-78 seconds — now longer than that timeout
against this repo's current (475+ task) real task store. Every live `select-preflight.ts --json`
invocation in this environment therefore returns `halt:true` with an empty `candidates`/`portfolio`,
regardless of composite-ness. This predates and is unrelated to this child's own change (D1 does
not touch `getTaskList` or its timeout — not in `## Touches`); it is a real methodology-layer gap
worth its own future task, not silently absorbed here.

Consequences, honestly reflected in the AC/DoD checkboxes below (left unchecked, not
silently-passed):
- **AC8/AC9/DoD-2** were still satisfied with REAL evidence (see above) via the Plan's own
  explicitly-anticipated fallback (real task facts from the live store, hand-assembled candidate
  wrapper) — checked, with the caveat documented inline on the task.
- **AC1, WIRING CLAIM 3 (AC14), WIRING CLAIM 4 (AC15), AC18 (legacy golden-replay), and DoD
  "Landed"/"fresh independent audit"** remain UNCHECKED. Each needs either (a) a real
  `Workflow(...)` dispatch (this Build subagent has no `Workflow` tool — same constraint M197's
  Build disclosed) or (b) a live `select-preflight.ts --json` run that returns real non-empty
  candidates (currently blocked by the timeout defect above). These are explicitly deferred to the
  post-Build Audit/coordinator phase, which holds `Workflow` tool access, matching the M197
  precedent (`milestones/M197/absorb-entry.md`'s own "Post-audit real-journal fix + re-audit"
  section).

## Test evidence

```
$ node --experimental-strip-types --test experiments/quay-perpetual-stream/test/composite-manifest-synthesis.test.mjs
ℹ tests 15
ℹ pass 15
ℹ fail 0

$ cmp experiments/quay-perpetual-stream/scripts/composite-manifest-synthesis.ts plugin/scripts/composite-manifest-synthesis.ts
$ cmp experiments/quay-perpetual-stream/test/composite-manifest-synthesis.test.mjs plugin/test/composite-manifest-synthesis.test.mjs
(both exit 0 — byte-identical)

$ bash plugin/scripts/sync-vendor.sh --check
[sync-vendor --check] CLEAN: all files verified, no drift detected.

$ bash scripts/test.sh plugin/test/composite-manifest-synthesis.test.mjs
ℹ tests 15
ℹ pass 15
ℹ fail 0

$ bash scripts/test.sh   # full repo suite, run to check for regressions
(see below — a pre-existing, unrelated hang was found and worked around)
```

**Second real finding, unrelated to this child's own scope:** a full `scripts/test.sh` run (no
args) got through ~85 of ~89 files (through `packages/quay/test/adr-store.test.mjs`, all PASS, no
FAIL observed) before stalling on `packages/quay/test/build-dist-smoke.test.mjs`, still alive with
0 CPU seconds accumulated 32+ minutes later. Root-caused live: its subtest "(c) raw MCP initialize
round-trip over stdio" (line ~150) spawns a real `node .../quay.js mcp` child, awaits a `Promise`
racing a 15s `setTimeout` reject, and only calls `child.kill("SIGKILL")` on the code path AFTER a
successful `await` — if the timer fires first (reject), the awaited expression throws and
`child.kill()` is never reached, leaking the MCP child process indefinitely. Confirmed via `pgrep
-P <pid>`: a live orphaned `node .../quay.js mcp` process was found, matching this exact bug. This
file is 100% outside this child's `## Touches` (`packages/quay/test/*`, unrelated to
`experiments/`/`plugin/`/`.claude/workflows/`) — disclosed as a real finding for a future task, not
fixed here. Worked around for regression evidence by re-running `scripts/test.sh` against the SAME
glob minus this one file (88/89 files); see below.

**Third, related real finding:** the same real (475+ task) task store that makes
`select-preflight.ts`'s `getTaskList()` exceed its own 60s timeout (disclosed above and on the
task's AC8/AC9/DoD-2 checkboxes) also makes many individual test files that shell out to the real
`quay`/`quay-native` CLI (`acceptance.test.mjs`, `cli.test.mjs`, `driver.test.mjs`, etc.) noticeably
slower per-test than their own logic would otherwise require — confirmed live via `ps`: parent
`node --test` workers sitting at ~0% CPU while their spawned `quay task edit`/`quay-native task
create` children do real (if slow) work against the large real store. Not a hang, just materially
slower than historical baseline; disclosed here as a systemic environmental characteristic, not
fixed (out of this child's scope — it does not touch `packages/quay*`).

**88-file regression run status at Build-iteration close:** re-run twice (first attempt used too
short an internal `timeout`, corrected on the second attempt). Both runs progressed cleanly through
100% of `packages/quay-backlog`, `packages/quay-github`, `packages/quay-native`, and well into
`packages/quay/test/` — 390+ individual PASS/✔ lines observed cumulative across both runs, **zero
FAIL/✖ lines at any point**. The second run had not reached its own completion within this Build
iteration's own time budget (see the systemic slowness finding above); this is disclosed honestly
as an in-progress, not a completed, DoD-3/AC10 confirmation for the packages-wide regression
surface — the load-bearing, COMPLETE evidence for this child's own change is the targeted run below
(this child's own new/changed files, all locations, all green).

## Files touched (matches the Plan's Complete touch set, plus the disclosed infra-gap fix)

- `experiments/quay-perpetual-stream/scripts/composite-manifest-synthesis.ts` (new)
- `plugin/scripts/composite-manifest-synthesis.ts` (new, mirror)
- `experiments/quay-perpetual-stream/test/composite-manifest-synthesis.test.mjs` (new)
- `plugin/test/composite-manifest-synthesis.test.mjs` (new, mirror)
- `.claude/workflows/select-preflight.js` (edited)
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` (edited)
- `plugin/scripts/gate-script-base.ts` (new, mirror — disclosed infra-gap fix, see above)
- `plugin/scripts/sync-vendor.sh` (edited — added `gate-script-base`/`composite-manifest-synthesis`
  to `SYNC_SCRIPTS`)
- `tasks/DIR-119-D1.md` (AC/DoD checkboxes ticked with inline evidence/disclosure; `extra.acceptance`
  set via `task_write`)
- `milestones/M198/absorb-entry.md` (new)
- `milestones/M198/evidence/*` (new — real command-output captures)
- `milestones/M198/iterations/iteration-0.md` (this file)
