---
id: DIR-124-A3a
title: Invariant-ownership manifest format + enforcement script
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

### Problem framing (grounded in current code)

The installed milestone workflow is a distributed system spanning four layers with no mechanical inventory of which component owns which invariant. Reading the live codebase reveals the following concrete state:

**Three verified inline mirrors in `execute-milestone.js`** (each documented as "INLINE MIRROR" at its definition site -- the workflow DSL has no `import` capability):

1. `_normalizeExecuteArgsInline` (lines 29-46) mirrors `composite-args.ts:63` `normalizeExecuteArgs`. The mirror validates task-id arrays, rejects conflicting legacy+new args, detects duplicates. Any semantic change to `composite-args.ts`'s normalization must be replicated here by hand.
2. `_isolationPlan` computation (lines 96-104) mirrors `milestone-worktree.ts:74` `computeIsolationPlan`. Computes milestone number, applies the >=130 path-prefix rule, derives worktree path and branch name. A cross-verification test (`execute-milestone-worktree.test.mjs`) already pins this mirror against the canonical source -- the other two mirrors lack equivalent tests.
3. `_diffAuditSnapshotLines` (lines 592-605) mirrors `composite-audit.ts:128` `diffGitSnapshots`. Computes a line-count-based diff between before/after snapshot arrays to detect audit write violations. Identical algorithm: build Maps counting line occurrences, emit +/- delta lines.

**Single-source-of-truth violations observed:**

- `gate_resolve_milestone_root` in `gate-script-lib.sh` (line 152) carries the explicit warning "grep for '130' outside this function is a single-source violation." Yet the >=130 path-prefix rule is replicated inline at `execute-milestone.js` line 102 (`num >= 130 ? ...`), in `_milestoneRootCmd` constructions, and in CLAUDE.md's worktree documentation. Four copies of the same boundary value, no mechanical check that they agree.
- `select-preflight.ts:115` `checkHalt()` is the sole code path that reads the `.halt` sentinel (confirmed: grep across `experiments/quay-perpetual-stream/scripts/` returns exactly one implementation). CLAUDE.md and OUTER-LOOP.md both describe halt behavior in prose -- three copies of the rule, one executable owner.
- `it0-dod-check.ts` (lines 737-857, clauses 10-12) shells out to `tree-hygiene-check.sh`, `worktree-branch-hygiene-check.sh`, and `audit-independence-check.sh` via `execFileSync` -- but no corresponding invariant-ownership manifest declares which file is the authoritative owner of the "tree-hygiene invariants" those scripts enforce. If a developer edits `tree-hygiene-check.sh`'s logic and someone else independently edits a workflow prompt that describes the same invariant in prose, there is no mechanical check that catches the drift.

**Systematic duplication between `experiments/` and `plugin/`:**

- 72 `.ts` files under `experiments/quay-perpetual-stream/scripts/` vs 40 under `plugin/scripts/`.
- 42 `.sh` files vs 15 -- significant asymmetry. The `plugin/` copy is the distribution surface (consumed by plugin installs in other workspaces), but there is no documented sync mechanism (contrary to the parent task's claim, `plugin/scripts/sync.sh` does not exist).
- Byte-identical pairs exist (confirmed: `gate-script-lib.sh` is 7875 bytes in plugin/). Divergent pairs exist (confirmed: `task-schema.ts` differs between the two directories per prior investigation). Without a manifest recording which copy is authoritative, a future edit to one copy leaves the other silently stale.

**Prose vs executable ownership gap:**

- OUTER-LOOP.md defines 16 formal invariants (I1 through I16, lines 265-280) and 9 contracts (C1 through C9, lines 285-293) in prose. Each invariant names an enforcement mechanism (e.g., I6 "halt-sentinel" with `.halt -> clean exit at next boundary`; I9 "split-or-commit" with `scripts/it0-split-or-commit-check.ts`). But no single file records the assignment of invariant-to-owner, and the enforcement mechanisms are discipline-level assertions with no mechanical cross-reference.
- `inherited-core.md` (532 lines) defines the 13 DoD clauses (0-12) in prose (lines 24-34), including a formal notation layer (lines 415-443) with Haskell-style signatures. The executable enforcer is `it0-dod-check.ts` (919 lines), which imports `extractSection` from `task-schema.ts` (line 96) and implements each clause as a block in `runDodCheck()`. These are two normative sources for the same structure -- but there is no declaration that `it0-dod-check.ts` is the authoritative owner.

- `task-schema.ts` (lines 73-83) exports `extractSection(fullText, heading)` -- a depth-aware section parser that is the canonical structural primitive used by `it0-dod-check.ts`, `drain-scheduler.ts`, and `proposal-convergence.ts`. This function is the natural parsing tool for a heading-based manifest, but no manifest exists that it could parse.

### Chosen mechanism

A two-file mechanism: an **invariant-ownership manifest** (single source of truth for invariant-to-owner assignment) and a **mechanical enforcement script** (validates manifest internal consistency). The enforcement script is wired into the DoD gate as Clause 13, following the established pattern of clauses 10/11/12.

**File 1: Invariant-ownership manifest** (`experiments/quay-perpetual-stream/invariant-ownership.md`). A structured markdown file enumerating every load-bearing invariant of the installed milestone workflow. For each invariant, it records **exactly one** `[authoritative]` executable owner (a repo-root-relative file path) and classifies every other occurrence via a structured key-value block:

```
## Invariant: <short-name>
- **Rule:** <one-sentence invariant statement>
- **Authoritative owner:** `<repo-root-relative-path>` `[authoritative]`
- **Other occurrences:**
  - `<repo-root-relative-path>` `[classification]` -- `<rationale>`
```

The five classifications are:

| Classification | Meaning | Enforcement |
|---|---|---|
| `[authoritative]` | The single executable owner of this invariant. Exactly one per invariant. | Enforcement script rejects >1 or 0. |
| `[compatibility-adapter]` | A copy maintained for distribution/portability that must stay in sync (e.g., `plugin/scripts/foo.ts` mirroring `experiments/.../scripts/foo.ts`). | Recorded for downstream DIR-124-B anti-drift checks; not mechanically compared here. |
| `[dsl-necessity-mirror]` | An inline copy in a workflow DSL script that cannot `import`. | Recorded for downstream anti-drift; the mirror's identity is known. |
| `[generated-view]` | A file derived from the authoritative source (e.g., `backlog.md` generated by `it0-backlog-regen.ts`). The generated file is NOT independently authoritative. | No mechanical check -- the classification is informational. |
| `[duplicate-to-remove]` | A redundant occurrence scheduled for deletion by downstream crystallization milestones (DIR-124-B/C/D). | Aggregated in enforcement script's `deletionList` structured output. |

**Format rationale.** Markdown with heading-delimited sections. Headings are parseable by `extractSection` from `task-schema.ts` (lines 73-83) -- the same depth-aware section parser already shared between `it0-dod-check.ts` and `task-schema-check.mjs`. This avoids introducing a new file format while remaining mechanically parseable. The format is self-describing: each block is a self-contained invariant record, easy to diff and review individually.

**Why not GFM tables.** At an estimated 80-150 invariant rows, a GFM table becomes a maintenance burden: column alignment breaks on edit, diffs are unreadable (a one-line change shifts every pipe character in the row), and individual invariant review requires horizontal scrolling. Heading-delimited blocks are the established convention in this repo (tasks, charters, inherited-core, ADRs all use `##` sections).

**Why not YAML/JSON.** Every other source-of-truth document in this repo is markdown. Introducing a new format for one file adds cognitive overhead with no benefit -- the manifest's structure is simple enough that a lightweight structural parser suffices.

**Self-hosting.** The manifest records its own invariant entry:

```
## Invariant: invariant-ownership-manifest
- **Rule:** The invariant-ownership manifest is the single source of truth for invariant-to-owner assignment.
- **Authoritative owner:** `experiments/quay-perpetual-stream/invariant-ownership.md` `[authoritative]`
- **Other occurrences:**
  - `plugin/invariant-ownership.md` `[compatibility-adapter]` -- distribution copy
```

Once the manifest lands, it validates its own entries on every subsequent DoD check.

**File 2: Enforcement script** (`experiments/quay-perpetual-stream/scripts/workflow-invariant-ownership.mjs`). A Node.js ESM script (`.mjs` extension -- runs via `node <script>` without `--experimental-strip-types` on the outer invocation) that parses the manifest and validates two core rules:

1. **Single-authoritative-owner rule:** No invariant block has zero or more than one `[authoritative]` line. Zero authoritative owners is a hard failure (exit 1) -- an orphaned invariant. Two or more is a hard failure (exit 1) -- a conflict.

2. **Owner-exists rule:** Every `[authoritative]` owner path resolves to an existing file relative to the workspace root. A path with no matching file is a hard failure (exit 1).

These are the ONLY rules enforced in this child. Extended checks (DSL-mirror anti-drift via `--check-dsl-mirrors`, adapter staleness via `--check-adapters`) are deferred to DIR-124-B and are NOT implemented here. The enforcement script's CLI contract defines the flags for forward compatibility but they are no-ops with a "not yet implemented" message.

**Concrete syntax for the parsing algorithm.** The enforcement script imports `extractSection` from `./task-schema.ts` -- the EXISTING canonical section parser (lines 73-83), reused, never reimplemented. For each `## Invariant: <name>` block extracted:

1. Locate the `**Authoritative owner:**` line within the block (regex: `` /^\s*-\s+\*\*Authoritative owner:\*\*\s*(.+)$/im ``). Fail (exit 2) if absent.
2. Extract the path token: the backtick-quoted string before the classification tag (regex: `` /`([^`]+)`\s+`\[authoritative\]`/ ``). Fail if not parseable.
3. Resolve the path against the workspace root (`process.cwd()`, overridable via `--workspace-root`). Fail (exit 1) if the file does not exist.
4. Collect all `[duplicate-to-remove]` entries for the `deletionList` output.
5. Collect all `[dsl-necessity-mirror]` and `[compatibility-adapter]` entries into structured metadata for downstream consumption (emitted in the JSON output even though not mechanically checked here).

**Exit codes.** 0 = clean (no violations). 1 = invariant-ownership violation (missing/duplicate authoritative owner, or missing owner file). 2 = usage/environment error (unparseable manifest, missing Node, manifest file absent when `--require-manifest` is set).

**Output.** On exit 0 or 1, stdout is a JSON object with:
- `ok`: boolean
- `violations`: array of `{ invariant, rule, detail }` for each violation
- `deletionList`: array of `{ path, invariant, classification }` for all `[duplicate-to-remove]` entries
- `mirrorList`: array of `{ path, authoritativeSource, classification }` for all `[dsl-necessity-mirror]` entries
- `adapterList`: array of `{ path, authoritativeSource }` for all `[compatibility-adapter]` entries
- `totalInvariants`: number of invariants parsed

On exit 2, stderr has the error message; stdout may be empty or partial.

**Zero dependencies beyond Node >=20 built-ins** (`fs`, `path`, `child_process`) and the existing `extractSection` from `task-schema.ts` (which itself depends only on Node built-ins).

### Concrete control and data flow

**Enforcement script internal flow:**

```
readFileSync("invariant-ownership.md")
  -> extractSection for each "## Invariant:" heading
    -> for each block:
        -> parse Authoritative owner line -> extract path + classification
        -> validate: exactly 1 [authoritative] (else violation)
        -> validate: file exists at resolved path (else violation)
        -> scan Other occurrences -> classify each entry
        -> accumulate deletionList, mirrorList, adapterList
  -> emit JSON to stdout
  -> exit(0) if no violations, exit(1) if any violation
```

**DoD gate integration flow (Clause 13 in `it0-dod-check.ts`):**

```
it0-dod-check.ts runDodCheck()
  -> Clause 13 block:
      -> resolve script path: path.join(__dirname, "workflow-invariant-ownership.mjs")
      -> check script exists (throw DodCheckEnvError if not)
      -> resolve manifest path: path.join(workspaceRoot, "invariant-ownership.md")
      -> try {
           execFileSync("node", [scriptPath, manifestPath], { encoding: "utf8" })
           -> exit 0: PASS, dispositionedClauses.add("invariant-ownership")
         } catch (e) {
           e.status === 1: FAIL, dispositionedClauses.add("invariant-ownership")
           other exit / throw: DodCheckEnvError (fail-loud, exit 2)
         }
```

The workspace root is `process.cwd()` in the CLI path (which is the repo root when `it0-dod-check.ts` is invoked by `execute-milestone.js`) or the first existing candidate of `[cwd, path.join(__dirname, "..", "..", "..")]` -- matching the pattern already used by clauses 0 and 8 for task-file resolution.

### Key design decisions

**DD1: Markdown with structured key-value lines, not YAML/JSON/GFM table.** The manifest uses heading-delimited `## Invariant:` blocks with `- **Key:** value` lines, parseable by the existing `extractSection` from `task-schema.ts`. Rationale: every other source-of-truth document in this repo is markdown (tasks, charters, inherited-core, ADRs); introducing a new format for one file adds cognitive overhead with no benefit. GFM tables are rejected because ~150+ rows require column-alignment maintenance across all rows; heading-delimited blocks are self-contained, individually diffable, and align with the repo's existing `##`-section conventions.

**DD2: Reuse `extractSection`, do not reimplement.** The enforcement script imports `extractSection` from `task-schema.ts` (lines 73-83) directly. This is the same function used by `it0-dod-check.ts` for clause evaluation, by `drain-scheduler.ts` for directive body parsing, and by `proposal-convergence.ts` for generation metadata extraction. No new parser is introduced; no regex duplication for section parsing.

**DD3: Mechanical enforcement, not prose.** Two authoritative owners for the same invariant = exit 1 = DoD gate failure. Prose manifests without enforcement get paraphrased away (ADR-004). This is the same principle as `it0-dod-check.ts`'s self-exemption meta-clause (Clause 5): a document that claims something without mechanical backing is not trusted.

**DD4: Soft-launch, fail-open on missing manifest.** The manifest does not exist at this milestone's start. If the enforcement script fails closed when the manifest is absent, the milestone that creates the manifest cannot pass the DoD gate. Exit 0 with a warning on missing manifest allows the manifest to be created and landed, after which subsequent DoD checks validate it. The `--require-manifest` flag (for CI or strict-audit contexts) changes this to exit 2.

**DD5: Clause 13 follows the exact pattern of clauses 10/11/12.** `execFileSync("node", [scriptPath, manifestPath], {encoding: "utf8"})` in a try/catch. Exit 0 = PASS, exit 1 = FAIL, any other exit = `DodCheckEnvError`. No novel wiring mechanism; no additional gate registration; no `quay gate` engine involvement. The clause runs UNCONDITIONALLY -- no conditional disposition (the invariant-ownership check is always applicable: every Land must confirm invariant landscape integrity).

**DD6: Self-hosting.** The manifest records its own `## Invariant:` block (authoritative owner: `experiments/quay-perpetual-stream/invariant-ownership.md`, plugin mirror classified as `[compatibility-adapter]`). The enforcement script records its own block (authoritative owner: `experiments/quay-perpetual-stream/scripts/workflow-invariant-ownership.mjs`). From the moment the manifest lands, the enforcement script validates its own entries on every subsequent DoD check.

**DD7: Deletion list output as structured JSON.** The enforcement script's stdout JSON includes a `deletionList` array with `{invariant, path, classification}` entries for every `[duplicate-to-remove]` occurrence. This is the mechanical hand-off to DIR-124-B/C/D.

**DD8: `.mjs` extension (Node ESM), not `.ts`.** The enforcement script is a `.mjs` file because it runs via `node <script>` (no `--experimental-strip-types` flag needed on the outer invocation), reducing CLI surface fragility. The `extractSection` import from `task-schema.ts` works because Node >=20's ESM loader handles `.ts` files with `--experimental-strip-types` transparently when the import chain starts from a `.mjs` file that is itself invoked from a parent process (`it0-dod-check.ts`) already running under that flag. This avoids the fragility of requiring `--experimental-strip-types` on the outer `execFileSync` invocation.

### Invariant inventory categories

Based on direct reading of the current codebase, the manifest will enumerate invariants in these categories. Each category's enumeration is the implementation's responsibility; the manifest is hand-authored, not auto-generated. The enforcement script validates STRUCTURE (one authoritative owner per invariant, owner files exist), not COMPLETENESS of coverage -- completeness is an audit concern deferred to DIR-124-C. The categories guide what to include:

**A. Arg/contract invariants.** `normalizeExecuteArgs` (`composite-args.ts:63`), MilestoneCandidate contract shape (`composite-contracts.ts`), preparation receipt schema (`milestone-preparation-check.ts`), verify cache fingerprinting (the args+prompt hash in `execute-milestone.js` Verify phase).

**B. Path/location invariants.** `gate_resolve_milestone_root` (`gate-script-lib.sh:152` -- the canonical >=130 boundary function) with `execute-milestone.js` inline copy classified as `[dsl-necessity-mirror]`, MILESTONE_ROOT single-source consumed by Audit/Land/evidence prompts. All other occurrences of the >=130 rule are classified as `[duplicate-to-remove]` or `[dsl-necessity-mirror]`.

**C. Build-phase invariants.** Class routing (`execute-milestone.js` Build prompt -- the single place the routing decision lives), composite phase DAG (`composite-build.ts` + `composite-contracts.ts` requires-edges), sole commit-creator (`composite-build.ts` AC8 -- confirmed via the parent directive), per-phase Touches isolation (`composite-build.ts` + `composite-contracts.ts`), build evidence collection (`build-evidence-collector.ts`), timeout discipline (`execute-milestone.js` Build prompt `timeout` field).

**D. Audit-phase invariants.** Read-only enforcement via snapshot diff (`composite-audit.ts:128` `diffGitSnapshots` with inline mirror at `execute-milestone.js:592` classified as `[dsl-necessity-mirror]`), per-shard scoping (`composite-audit.ts` + `composite-contracts.ts`), session-ID capture (DIR-093, `execute-milestone.js` Audit prompt), refute-first stance (`execute-milestone.js` Audit prompt -- single place the adversarial instruction lives).

**E. Gate-phase invariants.** DoD clause enumeration 0-12 (`it0-dod-check.ts` -- the single executable enforcer; `inherited-core.md`'s DoD section is classified as `[generated-view]`), V_meta consolidation-lag check (`vmeta-lag-check.ts`), line-budget 2000-line cap (`it0-ceiling-line-budget-check.sh`), dashboard 1200-line cap (`it0-dashboard-line-budget-check.sh`), tree-hygiene (`tree-hygiene-check.sh`), worktree-branch-hygiene (`worktree-branch-hygiene-check.sh`), SPLIT-OR-COMMIT whole-store scan (`it0-split-or-commit-check.ts`), build-evidence structural completeness (`build-evidence-gate.ts`), gate-hash byte-for-byte (`it0-gate-hash-check.sh`), dogfood-evidence (`it0-dogfood-evidence-gate.sh`), enforcement-with-design (`it0-enforcement-with-design-check.ts`). The 13 DoD clauses each have exactly one executable owner: clauses 0-2, 5-9 are owned by their blocks in `it0-dod-check.ts`; clauses 3, 4, 10, 11, 12 are owned by the shell scripts they invoke.

**F. Land-phase invariants.** Land lock single-flight wx-create (`milestone-worktree.ts` -- confirmed via DIR-123 implementation), CAPTURE mechanical unconditional (`execute-milestone.js` Land prompt), post-Land split-or-commit re-scan (`execute-milestone.js` `postLandSplitOrCommitCheck`), dashboard/backlog regeneration (`it0-backlog-regen.ts`), milestone counter increment serialization (`execute-milestone.js` Land prompt).

**G. Lifecycle invariants.** Task schema v1 marker (`task-schema.ts` + `task-schema-check.sh`), SPLIT-OR-COMMIT parent-done-iff-children + child-link-symmetry + SELECT-split (`it0-split-or-commit-check.ts` -- confirmed via `scripts/test.sh` line 47 which runs this on every invocation), checklist write-back (DIR-020, executed by Audit phase).

**H. Concurrency invariants.** No-isolation strictly serial (`CLAUDE.md` prose -- discipline-level), worktree isolation opt-in (DIR-123, `milestone-worktree.ts` -- confirmed via `computeIsolationPlan`), concurrent batch touches-orthogonality (`touches-orthogonality-check.ts`), fan-in sole merge owner (OUTER-LOOP.md step g -- discipline-level + single-flight Land lock).

**I. SELECT invariants.** Human-steered exclusion (`human-steered-classify.ts` -- confirmed as the classifier invoked by `select-preflight.ts`), deliverable classification (`deliverable-governor.ts`), explore/exploit cadence (`explore-exploit-cadence.ts`), drain-before-select (`drain-scheduler.ts` + `drain-directives.js`), halt-sentinel (`select-preflight.ts:115` `checkHalt()` -- confirmed as the sole code path reading `.halt`), candidate-synthesis portfolio choice (`candidate-synthesis.ts` + `portfolio-choice.ts`).

**J. OUTER-LOOP.md formal invariants I1 through I16.** Each assigned one authoritative owner. Example assignments confirmed by code reading:

| Invariant | Authoritative owner | Enforcement |
|---|---|---|
| I1 not-point-baime-at-stream | OUTER-LOOP.md prose | Discipline only (no executable owner) |
| I2 not-perturb-inflight | OUTER-LOOP.md prose + `.halt` sentinel | Discipline |
| I3 gate-text-transclusion-or-hash | `it0-gate-hash-check.sh` | Script exit code |
| I4 drain-before-select | `drain-scheduler.ts` + `drain-directives.js` | Mechanical ordering |
| I5 master-direct | `restart-readiness-check.sh` | Script exit code |
| I6 halt-sentinel | `select-preflight.ts:115` `checkHalt()` | Mechanical check (sole code path) |
| I7 not-self-tick | Discipline only (DIR-020) | N/A |
| I8 explore >=1 per 5 | `explore-exploit-cadence.ts` | Script computation |
| I9 split-or-commit | `it0-split-or-commit-check.ts` (whole-store scan) | Script exit code |
| I10 schema-v1 marker | `task-schema-check.sh` + `task-schema.ts` | Script exit code |
| I11 deliverable-governor SOFT | `deliverable-governor.ts` | Script computation |
| I12 human-steered EXCLUDE | `human-steered-classify.ts` | Script classification |
| I13 FILE-ONLY routines output | `routine-file-gate.ts` | Gate check |
| I14 task-canonical directives | `drain-scheduler.ts` | Mechanical |
| I15 parent-done iff children-done | `it0-split-or-commit-check.ts` (child-link-symmetry) | Script exit code |
| I16 sentinel-removal-idempotent | Discipline + `restart-readiness-check.sh` | Script check |

For invariants enforced by discipline only (I1, I2, I7), the authoritative owner is `OUTER-LOOP.md` itself (the discipline is the only enforcement mechanism); these are recorded to make the gap explicit.

**K. execute-milestone.js phase-sequence invariants.** The 8-phase sequence (Verify -> Prepared -> Build -> Build-Evidence -> Audit -> Gate -> [Reconcile] -> Land) as defined in `execute-milestone.js` is the single authoritative executable definition. OUTER-LOOP.md's step 4-7 descriptions are classified as `[generated-view]`.

**L. Inline DSL mirrors.** Three confirmed mirrors:

| Mirror | Canonical source | Classification |
|---|---|---|
| `_normalizeExecuteArgsInline` (lines 29-46) | `composite-args.ts:63` `normalizeExecuteArgs` | `[dsl-necessity-mirror]` |
| `_isolationPlan` (lines 96-104) | `milestone-worktree.ts:74` `computeIsolationPlan` | `[dsl-necessity-mirror]` |
| `_diffAuditSnapshotLines` (lines 592-605) | `composite-audit.ts:128` `diffGitSnapshots` | `[dsl-necessity-mirror]` |

These are NOT scheduled for deletion -- the workflow DSL has no `import`, so the mirrors are a necessary constraint. Recording them in the manifest makes the drift risk explicit and gives DIR-124-B a target list for anti-drift checks.

**M. Experiment/plugin script pairs.** For each script present in both directories, the authoritative path is `experiments/quay-perpetual-stream/scripts/` (where development happens, where tests live, and where `execute-milestone.js` points). The `plugin/scripts/` copy is `[compatibility-adapter]`. Scripts present ONLY in experiments/ are experiment-internal and not classified as adapters.

**N. Meta-invariants.** The manifest itself, the enforcement script, and the Clause 13 wiring are each recorded as invariants with themselves as authoritative owners. This self-hosting design means the manifest validates its own entries on every subsequent DoD check.

### Wiring claims

Each claim below asserts a concrete relationship that the review phase can mechanically check for a matching Acceptance Criteria item:

- **WIRING-CLAIM (A3a-PARSE):** The enforcement script imports `extractSection` from `task-schema.ts` to parse `## Invariant:` blocks -- the EXISTING canonical section parser at `experiments/quay-perpetual-stream/scripts/task-schema.ts` lines 73-83. No new parser is introduced; no regex duplication for section parsing.
- **WIRING-CLAIM (A3a-SINGLE-OWNER):** The enforcement script FAILS (exit 1) when any `## Invariant:` block has zero or more than one `[authoritative]` occurrence. A two-owner fixture at `fixtures/invariant-ownership/two-owner-violation.md` contains one invariant with two `[authoritative]` lines; the test asserts exit 1.
- **WIRING-CLAIM (A3a-OWNER-EXISTS):** The enforcement script FAILS (exit 1) when any `[authoritative]` owner path does not resolve to an existing file. A missing-owner fixture proves this falsifiably.
- **WIRING-CLAIM (A3a-CLAUSE-13):** `it0-dod-check.ts` gains Clause 13, which shells out to `workflow-invariant-ownership.mjs` via `execFileSync("node", [scriptPath, manifestPath], {encoding: "utf8"})` -- the IDENTICAL pattern used by clauses 10 (tree-hygiene-check.sh, line 751), 11 (worktree-branch-hygiene-check.sh, line 775), and 12 (audit-independence-check.sh, line 843). Exit 0 = PASS; exit 1 = FAIL; any other exit = `throw new DodCheckEnvError(...)`. The clause runs UNCONDITIONALLY (mirrors clauses 10/11/12 -- no conditional disposition). `"invariant-ownership"` is added to `MECHANICALLY_UNCONDITIONAL_CLAUSES` and a `{ key: 'invariant-ownership', pattern: ... }` entry is added to the `clauseNames` array (`it0-dod-check.ts` lines 356-366) in the Clause 5 block so a charter's self-exemption of this clause always requires a WAIVER line.
- **WIRING-CLAIM (A3a-SOFT-LAUNCH):** When the manifest file is absent, the enforcement script exits 0 with a warning diagnostic -- it does NOT fail closed. This allows the milestone that creates the manifest to pass the DoD gate before the manifest exists. The `--require-manifest` flag changes this to exit 2 for CI/strict-audit contexts.
- **WIRING-CLAIM (A3a-DELETION-LIST):** The enforcement script's stdout JSON includes a `deletionList` array aggregating all `[duplicate-to-remove]` entries with their paths and invariant names. This is consumed by DIR-124-B (crystallization: single-source script resolution), DIR-124-C (inherited-core as generated view), and DIR-124-D (OUTER-LOOP as generated view).
- **WIRING-CLAIM (A3a-MIRROR):** Both manifest mirrors (`experiments/` authoritative, `plugin/` compatibility-adapter) and both script mirrors (`experiments/scripts/` authoritative, `plugin/scripts/` compatibility-adapter) are byte-identical. Verified by `diff` or `sha256sum` at implementation time. The enforcement script reads from the workspace root manifest path; it does not hardcode the experiments/ path.
- **WIRING-CLAIM (A3a-TEST):** `experiments/quay-perpetual-stream/test/workflow-invariant-ownership.test.mjs` exercises RED (two-owner violation, missing-owner) and GREEN (valid single-owner manifest) paths against fixture manifests. The test is runnable via `scripts/test.sh experiments/quay-perpetual-stream/test/workflow-invariant-ownership.test.mjs` (experiment tests are passed as explicit file arguments, matching how `it0-dod-check.test.mjs` is run).

### Defaults and failure behavior

- **Missing manifest (soft-launch):** If `invariant-ownership.md` does not exist at the resolved path, the enforcement script exits 0 and emits JSON with `ok: true, totalInvariants: 0, warnings: ["no manifest found -- invariant ownership unchecked"]`. This is deliberate: the manifest does not exist at this milestone's start, and failing closed would deadlock the very milestone that creates it. Once the manifest lands, it is self-hosting. The `--require-manifest` flag (for CI or strict-audit contexts) changes this to exit 2 with a diagnostic.
- **Duplicate authoritative owners in one invariant block:** Exit 1. Both entries are named in the violation with their line numbers. The DoD gate fails.
- **Zero authoritative owners in an invariant block:** Exit 1 (a block with no owner is an incomplete declaration -- the same class as a missing owner). The invariant is named; the violation states "orphaned invariant." The DoD gate fails.
- **Missing authoritative owner file:** Exit 1. The missing path is named. The DoD gate fails.
- **Parse failure (malformed manifest):** Exit 2. The DoD gate surfaces this as `DodCheckEnvError` and the milestone fails.
- **Enforcement script not found by DoD check:** `DodCheckEnvError` thrown by the Clause 13 block (mirrors clauses 10/11/12's sibling-script-existence check). Milestone fails.
- **Clause 13 runs unconditionally** in the DoD gate. A FAIL from the enforcement script blocks Land just as any other DoD clause failure does. There is no waiver mechanism within this child (clause 5 applies as normal -- a charter can declare a WAIVER line, but the enforcement script itself has no internal bypass).
- **The enforcement script is a pure read-only validator** -- it writes nothing and mutates no state. It does not modify any file, task, or gate-event log. The stdout JSON is the only output that matters for the DoD gate; human-readable detail is included in the JSON for diagnosis.

### Compatibility

This is a net-new file pair (`invariant-ownership.md` + `workflow-invariant-ownership.mjs`). No existing behavior is modified:

- **No existing file is changed** by the enforcement script. The manifest is a new file; the enforcement script reads it only.
- **The new DoD clause is additive** (Clause 13). Existing clauses 0-12 are untouched. Their logic, exit codes, and output format are unchanged. The `runDodCheck` function signature is unchanged (the manifest path is derived from the workspace root internally, like clauses 10/11 derive their script paths from `__dirname`).
- **The soft-launch missing-manifest behavior** means pre-existing milestones that lack the manifest do not fail the DoD gate. The transition is seamless: the manifest is created and landed in this milestone, and from the next milestone onward, it is present and self-hosting.
- **No existing enforcement script's behavior changes.** `it0-dod-check.ts` gains one new clause block following the identical pattern as clauses 10/11/12, inserted after clause 12.
- **No workflow DSL changes.** `execute-milestone.js` is not modified. The DoD gate is invoked by the Gate phase as before; Clause 13 runs as part of the existing `it0-dod-check.ts` invocation.
- **No plugin distribution changes.** The manifest and enforcement script are net-new files mirrored into `plugin/` as byte-identical copies. No existing plugin file is modified.
- **No existing file is forced to reference the manifest.** That is the job of downstream crystallization milestones (DIR-124-B/C/D) which consume the deletion list.
- **The manifest is forward-only.** Milestones that predate this mechanism are not retroactively applied -- the soft-launch missing-manifest behavior handles the transition.
- **The enforcement script resolves the manifest path relative to the workspace root;** it does not hardcode the experiments/ path.

### Risks

1. **Manifest staleness (incompleteness, not inconsistency).** The enforcement script validates internal consistency of the manifest (one authoritative owner, files exist) but does NOT verify that the manifest enumerates every actual invariant in the codebase. A future milestone that adds a new invariant but forgets to update the manifest will not be caught. Mitigation: DIR-124-C can add a completeness scan that cross-references the manifest against code patterns. For now, the manifest's value is in making ownership explicit for the invariants it DOES record.

2. **DSL-mirror drift.** The three inline mirrors in `execute-milestone.js` are documented as `[dsl-necessity-mirror]` entries but are NOT mechanically compared to their authoritative sources in this child. A future edit to `composite-args.ts:63` `normalizeExecuteArgs` that forgets to update the inline mirror at `execute-milestone.js:29` will not be caught. Mitigation: DIR-124-B's scope includes anti-drift checks; the `execFileSync` pattern already exists (`execute-milestone-worktree.test.mjs` pins one of the three mirrors). The manifest's `mirrorList` output gives DIR-124-B a machine-readable target list.

3. **Plugin-mirror drift.** Files in `plugin/scripts/` that are byte-identical today may diverge as experiment copies evolve. The manifest records the pairing and the classification but does not enforce consistency. Mitigation: same as above -- DIR-124-B.

4. **Classification disagreements.** Two authors may disagree on whether an occurrence is `[compatibility-adapter]` or `[duplicate-to-remove]`. The enforcement script validates structural correctness (one authoritative owner, no orphan paths), not semantic correctness of the classification. Classification correctness is an audit concern.

5. **Manifest size.** The initial manifest is estimated at 80-150 invariant blocks (16 OUTER-LOOP invariants + 13 DoD clauses + ~10 phase-sequence invariants + ~25 script-duplicate pairs + 3 inline mirrors + ~10 contracts + ~10 workflow invocation points). Maintenance burden is low because invariants change infrequently, and each edit is a self-contained block.

6. **Missing-manifest soft-launch window.** Between this milestone's Land and the first subsequent milestone's Gate phase, there is no enforcement. A concurrent or immediately-following milestone that adds an invariant without updating the manifest in the same commit would not be caught until a later DoD check. Mitigation: the manifest is landed in this milestone; by the time any other milestone runs its Gate phase, the manifest exists and Clause 13 fires.

7. **Self-hosting bootstrap edge case.** The manifest and enforcement script are created in the same milestone. During the first Land where the manifest exists but the enforcement script runs as Clause 13, the enforcement script reads a manifest whose entries were just written. There is no circular dependency because the manifest's own `## Invariant:` block records the manifest itself as authoritative -- the enforcement script validates the manifest's self-entry against the manifest's own content. This is a fixed-point: the manifest declares itself valid, and the enforcement script verifies that declaration is structurally sound.

### Non-goals (explicit)

Per the parent task DIR-124-A's AC9 and this child's AC items:

- **No post-Land Wiring Audit mechanism** is introduced. The enforcement script is a pre-Land structural validator, not a post-Land wiring audit.
- **No lifecycle-promotion policy changes.** The DoD gate's promotion logic (Clause 9, SPLIT-OR-COMMIT) is unchanged.
- **No worktree redesign.** The enforcement script has no interaction with worktree isolation.
- **No stage scheduler or resource lease mechanism.**
- **No anti-drift enforcement for DSL mirrors or compatibility adapters.** The manifest records the entries; the enforcement script does not compare them mechanically. Deferred to DIR-124-B.
- **No completeness audit** of the manifest against the codebase. Deferred to DIR-124-C.
- **No automated manifest generation** from code analysis. The manifest is hand-authored for precision, then mechanically enforced for consistency. An auto-generator would produce a long list of function-exports but miss the architectural invariants (e.g., "sole commit-creator") that are the actual load-bearing rules.
- **No retroactive application** to pre-existing milestones. The soft-launch behavior handles the transition.
- **No semantic validation of classifications.** The enforcement script checks structural validity only -- one authoritative owner, files exist, no duplicate owners per invariant. Whether a classification is semantically correct is an audit concern.
- **Deletion of inline mirrors in `execute-milestone.js` is explicitly out of scope.** The mirrors are `[dsl-necessity-mirror]`, not `[duplicate-to-remove]`.
- **No automatic detection of new invariants or missing manifest entries.**

### AC coverage

| AC | Coverage |
|---|---|
| Manifest is a checked file with one authoritative owner per invariant | The manifest format enforces this structurally: the enforcement script fails (exit 1) if any invariant block has zero or >1 `[authoritative]` lines. The manifest is checked into the repo at both paths (`experiments/` authoritative, `plugin/` mirror). The format is self-describing and parseable by `extractSection` from `task-schema.ts`. The schema is the set of required fields per block: `Rule`, `Authoritative owner` (exactly one, with path and `[authoritative]` tag), and optional `Other occurrences` list. |
| Enforcement rejects two authoritative owners for the same rule | Falsifiable: a two-owner fixture at `fixtures/invariant-ownership/two-owner-violation.md` contains one invariant with two `[authoritative]` lines. Running the enforcement script against it exits 1. The test at `workflow-invariant-ownership.test.mjs` asserts this (wiring claim A3a-SINGLE-OWNER). |
| Enforcement validates owner paths exist on disk | The enforcement script resolves each `[authoritative]` path against the workspace root and calls `fs.existsSync`. A fixture with a non-existent path exits 1. The test asserts this (wiring claim A3a-OWNER-EXISTS). |
| Byte-identical mirrors at plugin/ | Both manifest mirrors and both script mirrors are byte-identical. `diff` or `sha256sum` confirms at implementation time (wiring claim A3a-MIRROR). |
| Tests RED/GREEN | `workflow-invariant-ownership.test.mjs` exercises the enforcement script against fixture manifests, asserting correct exit codes and JSON output for both violation (RED: two-owner, missing-owner) and valid (GREEN: single-owner valid manifest) paths. Runnable via `scripts/test.sh` with explicit file path (wiring claim A3a-TEST). |
| Enforcement script imports extractSection from task-schema.ts (no reimplemented parser) | The enforcement script imports `extractSection` from `./task-schema.ts` -- the existing canonical section parser at lines 73-83, the same function used by `it0-dod-check.ts`, `drain-scheduler.ts`, and `proposal-convergence.ts`. No new parser is introduced; no regex duplication for section parsing. The test asserts via code inspection or a structural assertion that the enforcement script does not contain a reimplemented section parser (wiring claim A3a-PARSE). |
| Clause 13 wired into it0-dod-check.ts with execFileSync pattern matching clauses 10/11/12 | `it0-dod-check.ts` gains a Clause 13 block shelling out to `workflow-invariant-ownership.mjs` via `execFileSync("node", [scriptPath, manifestPath], {encoding: "utf8"})` -- the identical pattern used by clauses 10 (tree-hygiene-check.sh, line 751), 11 (worktree-branch-hygiene-check.sh, line 775), and 12 (audit-independence-check.sh, line 843). Exit 0 = PASS, exit 1 = FAIL, any other exit = `DodCheckEnvError`. `"invariant-ownership"` is added to both `MECHANICALLY_UNCONDITIONAL_CLAUSES` and the `clauseNames` array for Clause 5 self-exemption guarding. The clause runs unconditionally (wiring claim A3a-CLAUSE-13). |
| Soft-launch: missing manifest exits 0 with warning; --require-manifest flag exits 2 | When the manifest file is absent, the enforcement script exits 0 and emits JSON with `ok: true, totalInvariants: 0, warnings: ["no manifest found -- invariant ownership unchecked"]`. This prevents deadlocking the milestone that creates the manifest. The `--require-manifest` flag (for CI/strict-audit contexts) changes this to exit 2 with a diagnostic (wiring claim A3a-SOFT-LAUNCH). |
| stdout JSON includes deletionList array aggregating [duplicate-to-remove] entries | The enforcement script's stdout JSON output includes a `deletionList` array with `{ path, invariant, classification }` entries for every `[duplicate-to-remove]` occurrence in the manifest. This is the mechanical hand-off to DIR-124-B (crystallization: single-source script resolution), DIR-124-C (inherited-core as generated view), and DIR-124-D (OUTER-LOOP as generated view) (wiring claim A3a-DELETION-LIST). |
| No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease | Confirmed in Non-goals above. The enforcement script is a pure read-only validator; it writes nothing and mutates no state. Clause 13 follows the established `execFileSync` pattern without introducing new lifecycle policy. |

### Alternatives considered and rejected

1. **Prose-only manifest with no enforcement.** Rejected because this repo has repeatedly demonstrated that prose gets paraphrased away (ADR-004). The value of the manifest is in the mechanical check that prevents two owners from silently diverging. Without enforcement, the manifest becomes documentation that rots at the same rate as the undocumented status quo.

2. **YAML or JSON manifest format.** Rejected. Every other source-of-truth document in this repo is markdown (tasks, charters, inherited-core, ADRs). Introducing a new format for one file adds cognitive overhead with no benefit. The manifest's structure (heading-delimited sections with key-value lines) is simple enough that `extractSection` (which already exists) can parse it; pulling in a YAML dependency for one file is unnecessary complexity.

3. **GFM table format.** Rejected. At 80-150 rows, a GFM table becomes unmaintainable: column alignment breaks on every edit, diffs are unreadable (a one-line change shifts every pipe character in the row), and scrolling to review a single invariant is tedious. Heading-delimited blocks are self-contained, easy to diff, and align with the repo's existing `##`-section conventions.

4. **Embedding ownership metadata in each invariant's source file** (e.g., a `// @invariant-owner: args-normalization` comment at the top of `composite-args.ts`). Rejected because the manifest is the single source of truth -- scattering ownership metadata across 40+ files makes it impossible to answer "who owns what?" with a single read. It also makes the duplicate-authoritative-owner check infeasible (requiring parsing 40+ files to find conflicts). A single manifest file reduces the check to a single-file parse.

5. **Auto-generating the manifest from code analysis.** Rejected because many invariants are semantic, not syntactic. "SOLE commit-creator" is a design constraint enforced by prompt text and agent discipline, not a function signature. "Refute-first stance" is an audit-phase instruction, not a code pattern. An auto-generator would produce a list of function exports but miss the architectural invariants that are the actual load-bearing rules.

6. **Failing closed when the manifest file is absent.** Rejected because this milestone creates the manifest -- it cannot exist before this milestone lands. A fail-closed approach would deadlock. The soft-launch (exit 0 with warning when manifest absent) allows the manifest to be created and landed, after which it becomes self-hosting.

7. **Integrating ownership enforcement into an existing DoD clause.** Rejected because invariant ownership is a distinct concern with its own failure modes and its own test fixtures. Adding it to an existing clause (e.g., folding it into clause 10 tree-hygiene) would conflate unrelated failure reasons, making diagnosis harder. A new clause (Clause 13) keeps the check independent and its failure self-describing. This is the same rationale that justified clauses 10/11/12 as separate clauses rather than being folded into clause 5.

8. **Using the quay gate engine (QENG) instead of a direct `execFileSync` shell-out.** Rejected because invariant-ownership is a workspace-level structural validator, not a per-task gate. The QENG engine is task-scoped (`quay gate <task-id>`). Running the enforcement as a gate would require a dummy task, which is a category error. The `execFileSync` pattern used by clauses 10/11/12 is the established mechanism for workspace-level mechanical checks.

9. **Making the enforcement a standalone gate rather than a DoD clause.** Rejected. Wiring into `it0-dod-check.ts` means the check runs on every milestone Land with zero additional wiring -- the DoD enforcer already exists, already runs unconditionally, and already has the clause-adding pattern (clauses 10/11/12 were added using the exact same mechanism). A standalone gate would require additional OUTER-LOOP.md step definitions and `execute-milestone.js` Gate phase wiring.

10. **Writing the enforcement as `.ts` with `--experimental-strip-types`.** Rejected. The `.mjs` extension means the script can be invoked as `node workflow-invariant-ownership.mjs` without needing `--experimental-strip-types` on the outer invocation, reducing CLI surface fragility. The `extractSection` import from `task-schema.ts` is resolved internally by Node's loader when invoked from `it0-dod-check.ts` (which already runs under `--experimental-strip-types`).

11. **Including anti-drift checks for DSL mirrors in this child's scope.** Rejected. The DSL-mirror anti-drift and compatibility-adapter staleness checks are deferred to DIR-124-B, which consumes this child's deletion list and mirror registry. This child only records the entries; it does not mechanically compare them.

12. **Retroactive application to pre-existing milestones.** Rejected. Pre-existing milestones lack the manifest; requiring them to backfill it would be a retroactive scope expansion. The soft-launch behavior handles the transition.

13. **Making the manifest machine-writable** (i.e., the enforcement script updates the manifest). Rejected. The manifest is hand-authored; the enforcement script is read-only. Letting a script update the manifest introduces the risk of automated misclassification. The manifest is the human-curated ground truth; the enforcement script validates it mechanically but never mutates it.

## Plan

See `docs/plans/M250-dir-124-a3a.md` for the full mechanical stage spec (6 stages: prose manifest authoring, RED fixtures, enforcement script implementation, GREEN test pass + mirrors, Clause 13 wiring, guardrails verification).

## Acceptance Criteria

- [ ] Manifest format documented with schema
- [ ] Enforcement rejects two authoritative owners for the same rule
- [ ] Enforcement validates owner paths exist on disk
- [ ] Byte-identical mirrors at plugin/
- [ ] Tests RED/GREEN
- [ ] Enforcement script imports extractSection from task-schema.ts (no reimplemented parser)
- [ ] Clause 13 wired into it0-dod-check.ts with execFileSync pattern matching clauses 10/11/12
- [ ] Soft-launch: missing manifest exits 0 with warning; --require-manifest flag exits 2
- [ ] stdout JSON includes deletionList array aggregating [duplicate-to-remove] entries
- [ ] No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease

## Definition of Done

Standard inherited-core DoD clauses apply.

## Touches

- `experiments/quay-perpetual-stream/invariant-ownership.md (new)`
- `experiments/quay-perpetual-stream/scripts/workflow-invariant-ownership.mjs (new)`
- `plugin/invariant-ownership.md (new)`
- `plugin/scripts/workflow-invariant-ownership.mjs (new)`
- `experiments/quay-perpetual-stream/test/*invariant-ownership*.test.mjs`
- `plugin/test/*invariant-ownership*.test.mjs`
