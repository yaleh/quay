# M211 / DIR-119-D3 — iteration-0 (Build phase)

**Task:** DIR-119-D3 — wire Audit into per-shard, mechanically-enforced read-only dispatch
(composite-audit.ts); third child of DIR-119-D's split.
**Charter:** experiments/quay-perpetual-stream/charters/M211-dir119d3-audit-readonly-shards.md
**Plan:** docs/plans/M211-dir-119-d3.md (6 stages; this iteration executes Stages 1–5; Stage 6 is
post-Land by Plan design, exactly as the sibling M210 Plan sequences its real-dispatch proof).
**Dispatch base:** `efb8ec6f` (master HEAD when this Build dispatch began — M210/DIR-119-D2's Land
commit; the declared dependency DIR-119-D2 is therefore landed, per G1's dispatch-base formulation).
**Class:** development · capability-growth · human-steered (touches
`.claude/workflows/execute-milestone.js`, the driver execution-chain script).

## What was done (per Plan stage)

### Stage 1 — RED (load-bearing tests + in-process-isolation negative control)

- Extended `experiments/quay-perpetual-stream/test/composite-audit.test.mjs` (+176 lines) and
  created its NEW byte-identical mirror `plugin/test/composite-audit.test.mjs` (declared in the
  task's own `## Touches`; did not exist at base).
- RED captured before implementation — exit 1, exact reason:
  `SyntaxError: The requested module '../scripts/composite-audit.ts' does not provide an export named 'diffGitSnapshots'`.
- Tests added (both mirrors byte-identical; real temp-repo fixtures via `mkdtemp` + `git init` +
  one committed file, the composite-manifest-synthesis.test.mjs execFileSync pattern):
  - **AC4 RED:** clean temp repo → plant one UNTRACKED file AND modify the TRACKED file →
    `guardShardReadOnly("sX", before, after)` → `{ok:false, violation:"audit-shard-write-violation:sX"}`
    with a ≥2-line delta surfacing both write classes; CLI form
    `composite-audit.ts --guard --shard-id sX --before <f> --after <f>` exits 1 with the violation
    JSON on stdout.
  - **AC4 GREEN fixture:** identical zero-write window → `{ok:true}` / CLI exit 0 (fresh
    `--after` snapshot path also covered). Both states in the same file — never GREEN-only.
  - **AC5 (asserted, not narrated):** `runReadOnlyAuditShard(state, shardFn)` where `shardFn`
    performs a REAL `fs.writeFileSync` inside the temp repo → `outcome.ok === true` (the
    deepFreeze/structuredClone isolation is PROVABLY BLIND to filesystem effects), then
    `diffGitSnapshots(before, takeGitSnapshot(repo)).length > 0` on that same write (the mechanical
    diff is the real enforcement).
  - **--combine-json anti-reimplementation:** CLI output byte-equal (at the JSON transport level)
    to the directly-imported `combineShardVerdicts()` over identical inputs; `--snapshot` prints
    tracked-AND-untracked porcelain lines as JSON; malformed `--combine-json` input exits 1 with a
    stderr diagnostic.
  - `diffGitSnapshots` order-stability + multiset semantics (two copies added → two delta lines).

### Stage 2 — implementation (composite-audit.ts, + byte-identical mirror; +122 lines each)

New EXPORTED symbols (appended after `combineShardVerdicts`, before `selftest`):
- `takeGitSnapshot(cwd = process.cwd()): string[]` — `git status --porcelain=v1 --untracked-files=all`
  lines, split/sorted/normalized. The `--untracked-files=all` flag is load-bearing (a shard dropping
  a NEW file is the primary hostile case).
- `diffGitSnapshots(before, after): string[]` — line-multiset delta (added ∪ removed), order-stable
  (sorted keys); empty ⟺ clean.
- `guardShardReadOnly(shardId, before, after)` — violation string EXACTLY
  `audit-shard-write-violation:<shardId>`; delegates to `diffGitSnapshots` (single diff
  implementation, no duplicated comparison logic).
- `combineShardVerdictsFromJson(shardResults, candidateId, generationId?)` — THIN wrapper delegating
  to the existing exported `combineShardVerdicts()` — never a reimplementation (AC3).

New non-selftest CLI modes in the trailing `process.argv` block (the existing `--selftest` branch is
unchanged and still fires first):
- `--snapshot` → stdout JSON `{snapshot: [...]}`, exit 0.
- `--guard --shard-id <id> --before <file> [--after <file>]` → stdout JSON of the
  `guardShardReadOnly` result; exit 0 iff `ok:true`, exit 1 on violation; `--after` defaults to a
  fresh `takeGitSnapshot()`; malformed snapshot files exit 1.
- `--combine-json --in <file> --candidate-id <id> [--generation-id <g>]` → stdout JSON
  `BundleAuditResult` via `combineShardVerdictsFromJson`, exit 0; malformed JSON/missing flags →
  stderr message, exit 1.

`runReadOnlyAuditShard()`/`deepFreeze`/`isolate` are DELIBERATELY UNCHANGED — they remain the
in-process control the Stage-1 AC5 test proves insufficient; the enforcement point is the
git-status diff, not them (G6).

### Stage 3 — GREEN (verification only, 0 new lines)

Full chain, every segment exit 0:
- `scripts/test.sh plugin/test/composite-audit.test.mjs` → 19/19 pass.
- `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/composite-audit.test.mjs` → 19/19 pass.
- `--selftest` on BOTH mirrors → "SELFTEST: all fixture cases PASS".
- `diff` of the script pair AND the test pair → byte-identical (G3).
- Full `scripts/test.sh`: 835 tests, 830 pass, 3 skipped (live-GitHub opt-in), 2 fail — the 2
  failures are the PRE-EXISTING plugin-packaging tests flagging `plugin/scripts/tree-hygiene-check.sh`
  (outside this touch set; M210's landed build-integrate prompt documents the same pair as
  pre-existing at its base; this child never touches that file).
- AC1 partial discharge here: the modes exist with a non-`--selftest` CLI surface; the full
  production-callsite claim discharges in Stages 5/6. RED→GREEN pair for AC4/AC5 complete: the
  hostile-write catch AND the compliant pass are both in the passing output, never GREEN-only.

### Stage 4 — fenced per-shard Audit prompt template + composite-write-instruction strip (both mirrors)

- Introduced `_compositeAuditShardPrompt(shard, candidateId, generation)` delimited by
  `// COMPOSITE-AUDIT-SHARD-PROMPT-BEGIN` / `// COMPOSITE-AUDIT-SHARD-PROMPT-END` markers,
  containing ONLY: refute-first AC/DoD inspection scoped to the shard's declared `taskIds`/AC
  indexes/integrated generation; the `--snapshot` before/after + `--guard` command chain; the typed
  return schema `{beforeSnapshot, afterSnapshot, shardResult}`; and the DIR-093 session-id capture.
- STRIPPED the old composite interpolation from the single-agent Audit prompt (the `_isComposite ?
  '...checklist write-back...' : ''` clause referencing checklist write-back / Land-owned mutations).
  The legacy width-1 prompt text is byte-for-byte identical — verified via
  `git diff efb8ec6f -- .claude/workflows/execute-milestone.js`: exactly 3 deleted lines, all inside
  the composite interpolation region; zero deletions in the legacy (`_isComposite===false`) prompt
  body (G2).
- AC6 structural check PASSES in both mirrors: fenced-region grep for
  `CHECKLIST WRITE-BACK|DISPOSITION APPEND|DEVIATION-LOG WRITE-BACK|cat >>|- \[x\]|dashboard\.md|milestone_counter`
  → 0 hits per mirror (static grep, not merely one run's clean tree).
- `node --check` exits 0 on both mirrors.

### Stage 5 — composite per-shard Audit dispatch + workflow-side diff + single audit-combine (both mirrors)

New `_compositePerShardAudit()` async dispatcher (fires IFF `_isComposite && $a.compositeManifestFile`;
the width-1 / manifest-less path stays the untouched single agent):
1. **audit-manifest-read** (exactly one mechanical agent, label `audit-manifest-read`, schema
   `{auditShards:[{id, kind, taskIds}]}`) reads `$a.compositeManifestFile` and returns the
   `auditShards[]` array (the DSL cannot read files — grounded fact, file L21–22); empty/malformed →
   typed terminal `{outcome:"needs-human", reason:"audit-manifest-read-failed", phase:"Audit"}`.
2. **Serialized shard loop** (plain `for...of` — deliberately NOT `parallel()`: concurrent snapshot
   windows would cross-attribute writes; single-driver discipline per CLAUDE.md, G5): one agent per
   shard, label `audit-shard-${shard.id}` (dispatch-time identity — NOT the counting surface;
   journal.jsonl carries no label field), prompt interpolated with that shard's `id`/`kind`/`taskIds`
   ONLY. Return schema `{beforeSnapshot: string[], afterSnapshot: string[], shardResult:
   AuditShardResult, guardResult, auditSessionId}`. Missing snapshot arrays fail closed as
   `audit-shard-snapshot-missing:<id>` (never treated as clean); a returned `shardResult.shardId`
   mismatching the manifest shard fails closed as `audit-shard-result-mismatch:<id>`.
3. **Workflow-side mechanical diff — THE ENFORCEMENT POINT:** inline DSL `_diffAuditSnapshotLines`
   (documented inline-mirror of Stage 2's `diffGitSnapshots`/`guardShardReadOnly`, same pattern as
   `_normalizeExecuteArgsInline`) runs IN THE WORKFLOW JS on the returned raw snapshot strings — not
   the agent's self-report, not its `--guard` run, not `deepFreeze`. ANY non-empty delta, tracked or
   untracked → immediate `{outcome:"needs-human", reason:"audit-shard-write-violation:"+shard.id,
   phase:"Audit"}`. Both raw snapshot arrays are retained in the shard's journaled typed return for
   auditability (trust-boundary limitation stated plainly in code comments: mechanical adjudication
   of returned command output within the existing agent/tool boundary, NOT a cryptographic
   attestation — raw-output retention is the backstop).
4. **audit-combine** (exactly one agent, label `audit-combine` — distinct from the `audit-shard-*`
   pattern) writes the collected `shardResult[]` JSON to a /tmp scratch file and runs
   `composite-audit.ts --combine-json` — the REAL `combineShardVerdicts()`, never a workflow-side
   reimplementation (AC3) — returning the `BundleAuditResult`. `bundleVerdict` maps onto the
   existing `auditResult` shape (REFUTED→REFUTED, CONCERNS→CONCERNS, PASS→NO REFUTATION FOUND) so
   ALL downstream plumbing (verdict branches, `AUDIT_SESSION_ID` pass-through, Gate/Land) is
   unchanged. A new fail-closed check after the dispatch routes the dispatcher's typed terminals
   (`auditResult?.outcome === 'needs-human'`) to a terminal return BEFORE Gate/Land — the legacy
   single-agent audit never returns an `outcome` field, so it fires only on the composite path.

Verification (all exit 0):
- `node --check` both mirrors; `diff` of the pair → byte-identical (G3).
- SIX separate per-mode-per-mirror greps each ≥1: `--snapshot` 3/3, `--guard` 1/1, `--combine-json`
  2/2 (AC1 production callsites, non-selftest dispatch-prompt text, both mirrors); `audit-combine`
  refs 9/9.
- Legacy golden replay: `scripts/test.sh plugin/test/execute-milestone-build-phase-gate.test.mjs
  plugin/test/execute-milestone-disposition-conformance.test.mjs
  plugin/test/execute-milestone-preparation-gate.test.mjs` → 40/40 pass (G2).
- Full `scripts/test.sh` after wiring: 830 pass / 2 pre-existing out-of-touch-set failures /
  3 skipped — zero NEW failures.

### Stage 6 — post-Land by Plan design

Stage 6 (ONE real non-fixture composite dispatch over DIR-119-D2's real per-phase Build output with
a ≥2-shard manifest; journal typed-return shard-count equality, exactly-once `.result.bundleVerdict`,
zero before/after snapshot deltas, per-shard transcript-prompt scope verdict, fresh independent
import-graph wiring audit) is post-Land evidence, identical to the sibling M210 Plan's sequencing —
a real nested composite dispatch from within Build is barred by single-driver serialization on the
shared working tree (CLAUDE.md; M210's own audit named this exact structural constraint). Its
journal excerpts + count outputs append to the Plan's evidence appendix after Land.

## AC status at iteration-0 (structural halves discharged; real-dispatch halves post-Land)

| AC | Status | Evidence |
|---|---|---|
| 1 (master item — real production callsites) | STRUCTURAL half discharged; REAL-exercise half post-Land | 6 per-mode-per-mirror greps ≥1 in non-selftest dispatch-prompt text; import graph flipped from type-only (zero runtime importers) to real production callsites in both mirrors; Stage 6 real dispatch closes it |
| 2 (journal shard-count equality + per-shard scope) | post-Land | dispatch code emits one `audit-shard-<id>` per `auditShards[]` entry with taskIds-only scope; Stage 6 counts journaled `.result.shardResult.shardId` vs manifest |
| 3 (audit-combine exactly once, real combineShardVerdicts) | STRUCTURAL half discharged; count post-Land | exactly one `audit-combine` dispatch in code (distinct label), invoking `composite-audit.ts --combine-json` = the real exported `combineShardVerdicts` via the thin `combineShardVerdictsFromJson` wrap; CLI-vs-import byte-equality unit test |
| 4 (RED/GREEN hostile-write catch) | DISCHARGED | Stage 1/3: hostile (untracked+tracked) window → `audit-shard-write-violation:sX` (fn + CLI, exit 1); compliant window → `{ok:true}` (fn + CLI, exit 0); both states in passing test output |
| 5 (RED/GREEN in-process isolation insufficient) | DISCHARGED | Stage 1/3 AC5 test: real `fs.writeFileSync` through `runReadOnlyAuditShard` → `outcome.ok === true` (blind), same write caught by `diffGitSnapshots` |
| 6 (write-instruction language structurally absent) | DISCHARGED | fenced-region static grep = 0 in both mirrors; old composite interpolation stripped; legacy body byte-identical (3 deleted lines, all in the interpolation) |
| 7 (fresh independent wiring audit) | post-Land | Stage 6 dispatches it, briefed to trace import graphs, not journal counts only |

DoD: "landed on master under human-steered discipline" and "fresh independent wiring audit" are
Land/post-Land; "RED/GREEN evidence exists for the audit-shard read-only check" is DISCHARGED by
this iteration (Stages 1/3); "real non-fixture composite dispatch with journal evidence" is
post-Land (Stage 6), per DIR-026 Reading A the load-bearing evidence — same sequencing as M210.

## Line budget

| Stage | Budget | Actual |
|---|---|---|
| 1 | ≤ +200/file | +176/file (experiments + mirror) |
| 2 | ≤ +160/file | +122/file |
| 3 | 0 | 0 |
| 4+5 | ≤ +140 net/file combined | **+183 net/file (+186/−3)** |

**Stage 4+5 overage justification (recorded before proceeding, per Plan line-budget discipline):**
the three typed-return JSON schemas (audit-manifest-read / audit-shard-<id> / audit-combine) are
load-bearing for Stage 6's journal selectors (G7 counting-surface honesty — `.result.shardResult.shardId`
vs `.result.bundleVerdict` disjointness is the exactly-once/shard-count mechanism) and cannot be
compressed without breaking the counting contract; the enforcement-point / trust-boundary /
serialization comments are required by the task's own "stated plainly rather than oversold" clauses
(G5/G6) and by the finding's failure-mode framing. The fenced prompt itself is the deliverable prose.
No second module was split out — `composite-audit.ts` remains single-responsibility
(snapshot/guard/combine only).

## Touch-set closure (G1)

Code: the 6 declared files (both `execute-milestone.js` mirrors, both `composite-audit.ts` mirrors,
both `composite-audit.test.mjs` files) + this Plan + this iteration report + the standard Land
writebacks declared in the Plan (`milestones/M211/absorb-entry.md` created with its `## Backlog row`
carrying `surface:method-infra`; `tasks/DIR-119-D3.md` extra.acceptance set at Build pre-flight).
Read-only inputs (`composite-contracts.ts`, `composite-manifest-synthesis.ts`,
`composite-reconcile.ts`, `composite-preflight.ts` + mirrors) were never edited.
