---
id: DIR-124-A3b
title: Invariant-ownership DoD gate integration
status: done
labels:
  - directive
  - milestone-candidate
parent: DIR-124-A3
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

Split from DIR-124-A3. Wire the invariant-ownership enforcement script (`workflow-invariant-ownership.mjs`, created by sibling DIR-124-A3a) into the DoD gate (`it0-dod-check.ts`) as a new unconditionally-dispositioned clause, following the exact structural pattern of clauses 10/11/12.

### Problem framing (grounded in current code)

`it0-dod-check.ts` (919 lines, exported `runDodCheck`) is the mechanical DoD enforcer. It currently has 13 clauses (0-12). Clauses 10 (tree-hygiene), 11 (worktree-branch-hygiene), and 12 (audit-independence) were added in M47/DIR-034 as net-new shell-out clauses, each following the exact same structural pattern:

1. Resolve a sibling script path via `path.join(__dirname, "<script>")`.
2. Assert the script exists on disk (throw `DodCheckEnvError` if not).
3. `execFileSync(scriptPath, [...args], { encoding: "utf8" })` wrapped in try/catch.
4. Exit 0 -> `passes.push(...)`; exit 1 -> `failures.push(...)`; any other exit -> throw `DodCheckEnvError`.
5. `dispositionedClauses.add("<clause-key>")` on every branch (unconditional disposition, same as clauses 3/4).
6. The clause key is added to `MECHANICALLY_UNCONDITIONAL_CLAUSES` in clause 5's block so self-exemptions of it always require a WAIVER line.
7. The clause name + matching pattern is added to the `clauseNames` array so clause 5's exemption scanner covers it.

DIR-124-A3a creates the invariant-ownership manifest and enforcement script -- a runnable validator that checks every load-bearing invariant of the milestone workflow has exactly one authoritative executable owner, and that every `[authoritative]` owner path resolves to an existing file. But without DoD gate wiring, the enforcement script is a standalone tool that nobody invokes during milestone Land. A milestone that corrupts the invariant landscape (e.g., by inlining a second copy of a contract without updating the manifest) would pass the DoD gate silently because nothing calls the enforcement script.

The gap is specifically the integration step: pulling the enforcement script into the existing DoD gate framework so that every milestone Land mechanically confirms invariant-ownership integrity. The DoD gate already has the exact integration pattern needed (clauses 10/11/12). Adding a 14th clause (Clause 13: invariant-ownership) following this identical pattern is a pure additive wiring task -- no new mechanism design is needed.

### Chosen mechanism

Add **Clause 13 (invariant-ownership)** to `it0-dod-check.ts`'s `runDodCheck()` function. The clause shells out to `workflow-invariant-ownership.mjs` (a sibling script in the same `scripts/` directory) via `execFileSync`, following the structurally identical pattern of clauses 10, 11, and 12. The clause runs **unconditionally** (mirrors clauses 3/4/10/11/12 -- always dispositioned, never conditionally skipped), because the invariant-ownership check is a workspace-level structural validator that must run on every milestone Land.

The enforcement script is invoked with the manifest path as a single positional argument. The manifest path is derived from the workspace root: since `it0-dod-check.ts` lives in `experiments/quay-perpetual-stream/scripts/`, the manifest is at `../invariant-ownership.md` relative to `__dirname`. The clause resolves this path and passes it to the enforcement script. This deviates minimally from clauses 10/11's zero-argument pattern because the enforcement script needs to know which manifest file to validate (unlike tree-hygiene and worktree-branch-hygiene, which operate on the whole repo tree ambiently).

The clause does NOT pass `--require-manifest` -- the enforcement script's soft-launch behavior (exit 0 with warning when the manifest is absent) is the correct default for the DoD gate, allowing the milestone that creates the manifest to pass its own DoD check before the manifest exists on disk.

### Concrete control and data flow

1. **DoD enforcer invocation**: `it0-dod-check.sh <milestone-id> <charter-file> <absorb-entry-file>` delegates to `it0-dod-check.ts`, which calls `runDodCheck({ milestoneId, charterFile, charterFileText, absorbFileText })`.

2. **Clause 13 block** (inserted after clause 12 in `runDodCheck`):
   - **(W1)** Resolves `workflow-invariant-ownership.mjs` via `path.join(__dirname, "workflow-invariant-ownership.mjs")`.
   - Asserts the script exists via `fs.existsSync`; throws `DodCheckEnvError` if not (same defense as clauses 10/11/12).
   - **(W2)** Resolves the manifest path: `path.join(__dirname, "..", "invariant-ownership.md")`. Derived from `__dirname` (the script's own location), not `process.cwd()`, matching how all other sibling-script paths are resolved.
   - **(W3)** Runs `execFileSync(scriptPath, [manifestPath], { encoding: "utf8" })` -- same mechanism as clauses 10/11/12, with the manifest path passed as a single positional argument.
   - Exit 0: `passes.push("clause13-invariant-ownership: PASS -- <first line of stdout>")`.
   - Exit 1: `failures.push("clause13-invariant-ownership: FAIL -- <first line of stdout>")`.
   - Any other exit (including exit 2 for usage/environment errors): `throw new DodCheckEnvError(...)`.
   - **(W4)** `dispositionedClauses.add("invariant-ownership")` on EVERY code path (pass, fail, and env-error throws halt the check entirely). The clause is NOT gated on any trigger condition -- it always runs.

3. **Clause 5 integration**:
   - **(W5)** `"invariant-ownership"` is added to the `MECHANICALLY_UNCONDITIONAL_CLAUSES` set (line 355): `new Set(["line-budget", "impl-row", "escrow-delta-v", "test-floor", "task-canonical-lifecycle-record", "tree-hygiene", "worktree-branch-hygiene", "invariant-ownership"])`.
   - **(W6)** A new entry `{ key: "invariant-ownership", pattern: /invariant[- ]ownership/i }` is added to the `clauseNames` array (after the `audit-independence` entry at line 366), so clause 5's exemption scanner covers it and any self-exemption of "invariant-ownership" without a WAIVER line is caught.

4. **Gate failure blocks Land**: Since clause 13 is unconditional, any FAIL from the enforcement script (exit 1) produces a clause failure, which causes `runDodCheck()` to return `failures.length > 0`, which causes the CLI wrapper to `process.exit(1)`, which the DoD gate interprets as a gate failure, which blocks `lifecycle_complete` and the Land phase. This is the same mechanism all other unconditional clauses use.

5. **Evidence flow**: The enforcement script writes human-readable detail to stdout. The DoD clause captures the first line of stdout for its pass/fail message. The enforcement script's structured JSON output (including `deletionList`) goes to stdout and is captured by the clause for the DoD check log, making it available for downstream consumption by DIR-124-B/C/D without any additional wiring.

### Enforcement script interface contract

This clause depends on the enforcement script's contract as defined by sibling DIR-124-A3a:

- **Exit 0**: Clean -- no invariant-ownership violations found. This includes the soft-launch case where the manifest file is absent (the enforcement script exits 0 with a warning on stderr, which the DoD clause ignores -- the enforcement script's own exit-code discipline is the single source of truth).
- **Exit 1**: Invariant-ownership violation -- duplicate authoritative owners, or missing owner file. The DoD gate fails and blocks Land.
- **Exit 2**: Usage/environment error -- unparseable manifest, missing Node, or `--require-manifest` flag supplied when the manifest is absent. Surfaced as `DodCheckEnvError` in the DoD gate, causing the check to abort.

The enforcement script receives exactly one positional argument: the path to the manifest file. This is a contract commitment -- if DIR-124-A3a changes the argument signature of the enforcement script, this clause must be updated accordingly. The clause does NOT parse or interpret the enforcement script's output beyond exit code -- it trusts the script's exit code as the authoritative signal.

### Key design decisions

1. **Follow the existing clause pattern exactly, do not invent a new one.** Clauses 10/11/12 established the pattern for unconditional shell-out clauses. Clause 13 replicates it with the minimal necessary deviation (passing the manifest path as an argument, since the enforcement script is not an ambient repo check). This minimizes the surface area for bugs and makes the clause trivially reviewable against its three immediate predecessors.

2. **Manifest path from `__dirname`, not from `process.cwd()`.** The enforcement script and its manifest are co-located with `it0-dod-check.ts` in the `experiments/quay-perpetual-stream/` tree. Deriving the manifest path from `__dirname` means the clause works regardless of where `it0-dod-check.sh` is invoked from -- matching how all other sibling-script paths are resolved.

3. **No `--require-manifest` flag.** The soft-launch behavior belongs in the enforcement script (DIR-124-A3a scope), not in the DoD clause. The clause should trust the enforcement script's exit code. Adding a flag here would couple the DoD enforcer to the enforcement script's internal semantics, which is the kind of coupling this directive exists to eliminate.

4. **Unconditional, not conditional.** Unlike clauses 1/2/6/7 (which legitimately N/A-pass when their trigger conditions don't fire), the invariant-ownership check has no trigger condition -- every milestone edit could potentially corrupt an invariant. It must run every time, like tree-hygiene and worktree-branch-hygiene.

5. **Clause 13, not a sub-clause of an existing clause.** The invariant-ownership check is a distinct concern with its own failure modes and its own script. Adding it as a new numbered clause keeps its failure self-describing and its test fixtures independent, matching the precedent set by clauses 10/11/12 (each a distinct concern, each a distinct clause number).

6. **Having the DoD clause perform its own manifest parsing rather than shelling out.** Rejected in alternatives -- it would duplicate the enforcement script's logic, creating exactly the kind of single-source violation this mechanism is designed to prevent. The enforcement script is the single authoritative executable owner of the invariant-ownership validation logic -- the DoD clause is purely an invoker, following the same delegation pattern as clauses 3/4/10/11/12.

### Defaults and failure behavior

- **Manifest absent (soft-launch)**: The enforcement script (per DIR-124-A3a's contract) exits 0 with a warning when the manifest is absent. The DoD clause treats exit 0 as PASS and records the warning in its pass message. This allows the milestone that creates the manifest to pass its own DoD check.
- **Two authoritative owners for one invariant**: Enforcement script exits 1. DoD clause records FAIL. Gate fails. Land blocked.
- **Authoritative owner path does not resolve**: Enforcement script exits 1. DoD clause records FAIL. Gate fails. Land blocked.
- **Enforcement script crashes (exit 2 or other)**: DoD clause throws `DodCheckEnvError`. The DoD enforcer exits 2. The caller (Gate phase) treats this as an environment error and the milestone fails.
- **Enforcement script absent**: If `workflow-invariant-ownership.mjs` does not exist at the resolved path, the clause throws `DodCheckEnvError` (exit 2). This is a usage/environment error, not a gate failure -- it means the milestone's own build is incomplete. The clause does NOT silently skip.
- **Unparseable manifest**: Exit 2, clause 13 throws `DodCheckEnvError`. The DoD check aborts entirely (the manifest is structurally corrupted).
- **Stale/missing clause-5 entries**: If the `MECHANICALLY_UNCONDITIONAL_CLAUSES` set or `clauseNames` array is not updated when clause 13 is added, clause 5 will not scan for self-exemptions of "invariant-ownership". This is a build-time correctness requirement, not a runtime behavior -- it is enforced by the test that verifies `dispositionedClauses` contains "invariant-ownership" on every run.

### Compatibility

This is a net-new clause (clause 13) added to `it0-dod-check.ts`. No existing behavior is modified:

- Existing clauses 0-12 are untouched (unchanged code, unchanged behavior).
- The `runDodCheck()` function signature is unchanged.
- The `MECHANICALLY_UNCONDITIONAL_CLAUSES` set gains one new entry; this is additive and does not change the behavior of any existing clause's self-exemption check.
- The `clauseNames` array gains one new entry; this is additive and does not change the matching behavior of any existing clause name.
- No new CLI arguments or environment variables are introduced.
- The enforcement script's soft-launch behavior means pre-existing milestones that lack the manifest do NOT fail the DoD gate -- the enforcement script exits 0 with a warning, and clause 13 records a PASS.
- The `dod-fixture-selfcheck.sh` comment block at line 6 and the `it0-dod-check.ts` header comment listing all clauses (currently "13 clauses (0-12)") will be updated to reflect the new count (14 clauses, 0-13). The selfcheck's `only_hygiene_diff` grep logic (which already filters clause10/clause11 FAIL lines for pre-DIR-034 fixtures) will be extended with `\|^FAIL: clause13-` to filter clause-13 ambient failures from pre-existing fixture assertions.

### Risks

1. **Selfcheck fixture pollution (same class as clauses 10/11).** The existing `dod-fixture-selfcheck.sh` fixtures were authored before clause 13 existed and assert specific exit codes. If the enforcement script's soft-launch behavior (exit 0 when manifest absent) works correctly, clause 13 will PASS for all existing fixtures (no manifest in the fixture text) and the selfcheck will be unaffected. If the enforcement script exits non-zero for any reason not related to the fixtures' actual content, the selfcheck fixtures will diverge. Mitigation: the `only_hygiene_diff` logic in `dod-fixture-selfcheck.sh` already handles this class of problem (clauses 10/11's ambient-repo-dependent behavior) and needs one extra `grep -v` pattern for clause 13.

2. **Enforcement script contract mismatch.** DIR-124-A3a defines the enforcement script's exact CLI contract (argument order, exit codes, stdout format). If that contract diverges from what this clause expects (e.g., the manifest path is passed as a flag rather than a positional argument, or exit code 2 means something different), the wiring breaks. Mitigation: the clause's contract is minimal and mechanical -- a single positional argument (manifest path), exit 0/1/2 semantics matching `execFileSync` conventions, stdout first line as summary. Any divergence from this contract is a DIR-124-A3a bug, not a DIR-124-A3b bug.

3. **Manifest path assumption.** The clause derives the manifest path as `../invariant-ownership.md` relative to `__dirname`. If the manifest is placed elsewhere or renamed, the clause breaks. Mitigation: the manifest location is pinned by DIR-124-A3's Touches field (`experiments/quay-perpetual-stream/invariant-ownership.md`) and the enforcement script's location is pinned by the same field (`experiments/quay-perpetual-stream/scripts/workflow-invariant-ownership.mjs`). The relative path `../invariant-ownership.md` from the scripts directory is mechanically determined and cannot drift without a file move that would break the enforcement script too.

4. **Test ordering dependency.** The unit test for clause 13 in `it0-dod-check.test.mjs` requires `workflow-invariant-ownership.mjs` to exist on disk (the clause resolves the real script path). If DIR-124-A3a's tests create the script but the script is not yet functional, the clause-13 unit test will fail. Mitigation: both children land in the same milestone; the build phase creates the enforcement script before wiring the clause. The unit test uses `execFileSync` against the real script, so it provides genuine integration coverage (not mock coverage). The test fixture can also create a temporary stub script at the expected path to exercise the wiring independently.

5. **Soft-launch masking real violations.** If the manifest file is accidentally deleted after landing, the enforcement script's soft-launch behavior would exit 0 (no manifest = no violations found), silently masking the loss. Mitigation: this is a known limitation of the soft-launch design (documented in DIR-124-A3a's own proposal). The recovery path is straightforward -- re-create the manifest from git history. Once DIR-124-C adds completeness auditing (cross-referencing the manifest against actual code patterns), an absent manifest with real invariants in the codebase would be detectable.

### Non-goals (explicit)

- No implementation of `workflow-invariant-ownership.mjs` (DIR-124-A3a scope).
- No manifest format definition or manifest authoring (DIR-124-A3a scope).
- No enforcement script test fixtures or RED/GREEN tests for the enforcement script itself (DIR-124-A3a scope).
- No anti-drift enforcement for DSL mirrors or compatibility adapters (deferred to DIR-124-B).
- No completeness audit of the manifest against the codebase (deferred to DIR-124-C).
- No post-Land Wiring Audit mechanism (deferred to DIR-124-B).
- No lifecycle-promotion policy changes.
- No worktree redesign or stage scheduler.
- No resource lease mechanism.
- The DoD clause does NOT validate the enforcement script's output beyond exit code -- it trusts the script's exit code as the authoritative signal.
- The DoD clause does NOT parse or interpret the `deletionList` -- it captures the enforcement script's stdout for the gate event log, but downstream consumption of the deletion list is DIR-124-B/C/D's responsibility.
- No new gate engine (QENG) registration -- the invariant-ownership check is a workspace-level structural validator, not a per-task gate, and belongs in the DoD enforcer, not the quay gate engine.
- No standalone gate or OUTER-LOOP.md wiring -- the DoD enforcer is the single integration point.

### AC coverage

| AC | Coverage |
|---|---|
| New clause in it0-dod-check.ts shells out to enforcement script | Clause 13 block invokes `workflow-invariant-ownership.mjs` via `execFileSync(scriptPath, [manifestPath], { encoding: "utf8" })` -- same mechanism as clauses 10/11/12. Manifest path derived as `path.join(__dirname, "..", "invariant-ownership.md")`. Clause block placed after clause 12 in `runDodCheck()`, preserving clause-number ordering. Header comment updated to "14 clauses (0-13)". **Wiring claims W1, W2, W3.** |
| Clause follows existing unconditionally-dispositioned pattern (matching clauses 3/4/10/11/12) | `dispositionedClauses.add("invariant-ownership")` on every code path (pass, fail). `"invariant-ownership"` added to `MECHANICALLY_UNCONDITIONAL_CLAUSES`. Entry `{ key: "invariant-ownership", pattern: /invariant[- ]ownership/i }` added to `clauseNames` array. **Wiring claims W4, W5, W6.** |
| Enforcement output (deletionList) consumed by DIR-124-B/C/D | The DoD clause captures the enforcement script's stdout (including structured JSON with `deletionList`). The pass/fail message includes `${out.trim().split("\n")[0]}` -- the enforcement script's first stdout line, matching the pattern of clauses 10/11/12. The full stdout is recorded in the gate event log for downstream consumption. This child only ensures the enforcement script runs and its output is recorded -- it does NOT consume the deletion list. |
| Gate failure blocks Land | Clause 13 failure -> `failures.length > 0` -> `runDodCheck` returns failures -> CLI wrapper exits 1 -> DoD gate interprets exit 1 as gate failure -> `lifecycle_complete` is refused -> Land phase is blocked. No new blocking mechanism is needed -- this is inherited from the existing DoD enforcer architecture. `dod-fixture-selfcheck.sh`'s `only_hygiene_diff` grep extended with `\|^FAIL: clause13-` to filter clause-13 ambient failures from pre-existing fixture assertions. |
| Tests RED/GREEN | Unit tests in `it0-dod-check.test.mjs` following the existing clause-10/11/12 test patterns: exit-0 -> PASS, exit-1 -> FAIL, `dispositionedClauses` always contains "invariant-ownership", clause 5 catches self-exemption of "invariant-ownership" with no WAIVER line. RED: temporary fake enforcement script that exits 1, run clause, assert FAIL. GREEN: run against real enforcement script (soft-launch exit 0 when manifest absent). Test file imports `runDodCheck` from `../scripts/it0-dod-check.ts`. |
| No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease | Confirmed in Non-goals above. The clause is a pure read-only shell-out; it writes nothing and mutates no state. The enforcement script (DIR-124-A3a) is also read-only. |

### Wiring claims summary (for mechanism-claim review)

| # | Claim | AC coverage |
|---|---|---|
| W1 | `it0-dod-check.ts` clause 13 resolves `workflow-invariant-ownership.mjs` via `path.join(__dirname, "workflow-invariant-ownership.mjs")` and asserts it exists via `fs.existsSync` (throws `DodCheckEnvError` if absent) | AC1 |
| W2 | Manifest path derived as `path.join(__dirname, "..", "invariant-ownership.md")` -- sibling-directory resolution, not `process.cwd()` | AC1 |
| W3 | Clause 13 invokes the enforcement script via `execFileSync(scriptPath, [manifestPath], { encoding: "utf8" })` -- same mechanism as clauses 10/11/12, with manifest path as a single positional argument | AC1 |
| W4 | `dispositionedClauses.add("invariant-ownership")` on every code path (unconditional, mirrors clauses 3/4/10/11/12) | AC2 |
| W5 | `"invariant-ownership"` added to `MECHANICALLY_UNCONDITIONAL_CLAUSES` set in clause 5's block | AC2 |
| W6 | Entry `{ key: "invariant-ownership", pattern: /invariant[- ]ownership/i }` added to the `clauseNames` array | AC2 |
| W7 | Pass/fail message includes `${out.trim().split("\n")[0]}` -- enforcement script's first stdout line captured in gate event log | AC3 |
| W8 | Clause 13 is placed after clause 12 in `runDodCheck()`, preserving clause-number ordering; header comment updated to "14 clauses (0-13)" | AC1 |
| W9 | `dod-fixture-selfcheck.sh`'s `only_hygiene_diff` grep extended with `\|^FAIL: clause13-` to filter clause-13 ambient failures from pre-existing fixture assertions | AC4 |

### Alternatives considered and rejected

1. **Conditional disposition (like clauses 1/2/6/7/12).** Rejected. The invariant-ownership check has no trigger condition -- every milestone edit could corrupt an invariant. It must run unconditionally, like tree-hygiene and worktree-branch-hygiene. Making it conditional (e.g., "only fire when the manifest file exists") would let a milestone that accidentally deletes the manifest pass silently -- exactly the class of corruption this check is designed to catch.

2. **Integrating the check into an existing clause rather than a new clause.** Rejected. The invariant-ownership check is a distinct concern with its own script, its own failure modes, and its own fixtures. Adding it to clause 0 (AC/DoD presence) or clause 10 (tree-hygiene) would conflate unrelated failure reasons, making diagnosis harder. A new clause (Clause 13) keeps the check independent and its failure self-describing, matching the precedent of every clause added after the original five (clauses 6-12 each got their own clause number).

3. **Running the enforcement script as a quay gate rather than a DoD clause.** Rejected. The quay gate engine is task-scoped (`quay gate <task-id>` evaluates a per-task acceptance command). The invariant-ownership check is a workspace-level structural validator -- it validates the repo's invariant landscape, not a single task's acceptance criteria. Running it as a per-task gate would require a dummy task, which is a category error. The direct `execFileSync` pattern used by clauses 10/11/12 is the established mechanism for workspace-level checks and is the right fit.

4. **A standalone gate wired into execute-milestone.js rather than a DoD clause.** Rejected. Wiring into `it0-dod-check.ts` means the check runs on every milestone Land with zero additional wiring -- the DoD enforcer already exists, already runs unconditionally, and already has the clause-adding pattern. A standalone gate would require additional OUTER-LOOP.md and execute-milestone.js wiring, duplicating the integration surface. Moreover, per ADR-004, prose steps get paraphrased away -- that is the exact defect DIR-034 diagnosed for clauses 10/11/12 before they were mechanized.

5. **Passing `--require-manifest` from the DoD clause.** Rejected. The soft-launch behavior (exit 0 with warning when manifest absent) is the enforcement script's concern. The DoD clause should not encode policy about whether the manifest must exist -- it should only invoke the script and trust the exit code. Adding `--require-manifest` here would couple the DoD enforcer to a specific enforcement-script flag, creating the kind of cross-component coupling this directive exists to eliminate. It would also deadlock this milestone's own Land (the manifest does not exist before this milestone lands).

6. **Deriving the manifest path from `process.cwd()` instead of `__dirname`.** Rejected. `process.cwd()` depends on where `it0-dod-check.sh` is invoked from, which varies (the test runner, the Gate phase's working directory, manual CLI invocation). `__dirname` is the script's own location and is invariant. Every other sibling-script path in `it0-dod-check.ts` is resolved from `__dirname`. Consistency with the existing pattern is the deciding factor.

7. **Making the enforcement script optional (skip clause if script absent).** Rejected. Clauses 3/4/10/11/12 all throw `DodCheckEnvError` when their sibling script is absent -- they do not silently skip. A missing enforcement script is a build error (the milestone's own files are incomplete), not a legitimate N/A condition. Failing loud (exit 2) is the correct behavior.

8. **Having the DoD clause perform its own manifest parsing rather than shelling out.** Rejected because it would duplicate the enforcement script's logic, creating exactly the kind of single-source violation this mechanism is designed to prevent. The enforcement script is the single authoritative executable owner of the invariant-ownership validation logic -- the DoD clause is purely an invoker, following the same delegation pattern as clauses 3 (delegates line-budget logic to `it0-ceiling-line-budget-check.sh`) and 10/11/12 (delegate hygiene/audit logic to their respective scripts).

9. **Deferring the wiring to DIR-124-B (the crystallization child that consumes the deletion list).** Rejected because without wiring, the enforcement script is dead code for the entire gap between A3 landing and DIR-124-B landing -- potentially multiple milestones during which the invariant landscape could silently corrupt. The wiring is the minimum viable integration that makes the enforcement script operational; the downstream consumption of the deletion list (DIR-124-B) is a separate concern that builds on this wiring.

10. **Zero-argument invocation (matching clauses 10/11 exactly).** Rejected because the enforcement script is not an ambient repo check -- it needs to know which manifest file to validate. Clauses 10/11's scripts (`tree-hygiene-check.sh`, `worktree-branch-hygiene-check.sh`) operate on the whole repo tree and genuinely need zero arguments. Passing the manifest path explicitly makes the dependency between the DoD clause and the manifest visible in the code, and allows the enforcement script to be tested independently with arbitrary manifest paths.

## Acceptance Criteria

- [ ] New clause in it0-dod-check.ts shells out to enforcement script
- [ ] Clause follows existing unconditionally-dispositioned pattern (matching clauses 3/4/10/11/12)
- [ ] Enforcement output (deletionList) consumed by DIR-124-B/C/D
- [ ] Gate failure blocks Land
- [ ] Tests RED/GREEN
- [ ] No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease

## Definition of Done

Standard inherited-core DoD clauses apply.

## Touches

- `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts`
- `experiments/quay-perpetual-stream/scripts/it0-dod-check.sh`
