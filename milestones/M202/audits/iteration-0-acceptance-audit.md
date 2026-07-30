# M202 / DIR-126-C — Iteration 0 Adversarial Acceptance Audit

**Audit session id:** 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1

**Verdict: CONCERNS**

Fresh-context, refute-first audit of the Build commit `2319e8e` ("M202/DIR-126-C Build:
generation-aware resume for prepare-milestone.js") against `tasks/DIR-126-C.md`'s own Acceptance
Criteria / Definition of Done. The mechanism is real, well-tested, and — critically — independently
reproduced end-to-end by this audit via genuine (non-mocked-CLI) dispatches, not merely trusted from
Build's own self-report. This audit also independently discovered one real, reproducible latent
defect (a path-sanitization mismatch) that does not falsify any AC item as literally worded and does
not affect any currently-real production taskId, but is worth a disclosed follow-up. No AC/DoD item
was refuted.

## 0. Method

Unlike Build's own permanent test suite (`proposal-convergence.test.mjs`,
`prepare-milestone-convergence.test.mjs`) — which mocks the `agent()` callback for
admission/preflight/resume-decision labels with canned JSON, never touching real disk state for
those calls in the workflow-integration tests — this audit followed the M201/DIR-126-B audit's own
established precedent: a fresh, ad hoc scratch harness that loads the REAL, unmodified
`.claude/workflows/prepare-milestone.js` source as a live `AsyncFunction` (same `loadWorkflow()`
technique the project's own test suite uses) and, for every admission/preflight/resume-decision
`agent()` call, extracts and REALLY EXECUTES the shell command embedded in the prompt via
`child_process.execSync` — mocking only the pure-content-generation phases (ProposalAuthors/
Adjudicate/ProposalReview/PlanAuthor/PlanCheck/Receipt), which require a real LLM this audit
subagent cannot dispatch (no `Workflow` tool available to this session, matching the M200 audit's
own disclosed limitation).

Three harness scripts (not committed, this session's scratchpad):
`/tmp/claude-1000/.../scratchpad/e2e-verify-dir126c.mjs` (v1, first attempt — used a slash-containing
scratch taskId matching this repo's own established test-fixture convention, which surfaced the
Concern in §5), `-v2.mjs` (cold + automatic-resume, plain/production-shaped taskId under the real
`tasks/` dir, cleaned up after), `-v3.mjs` (reuse-terminal, plain taskId, cleaned up after).

## 1. AC-by-AC

### 1.1 "Most important — real production wiring" — CONFIRMED

`grep -n "'resume-decision'"` in both `.claude/workflows/prepare-milestone.js` and
`plugin/workflows/prepare-milestone.js` shows the label dispatched from a real `agent()` call at
line ~209, strictly between the real Admission-acquired log line and `phase('Preflight')`, gated
only by `$a.resumeFromAdjudicatedProposal === undefined`. Not `--selftest`-only: this audit's own
harness runs (§2) show a REAL `--decide-resume` CLI invocation actually executing and returning a
real, non-canned verdict.

- [x] confirmed

### 1.2 "Automatic safe resume" + "any mismatch forces a fresh generation" — CONFIRMED

Real, non-mocked dispatch (v2 harness, Scenario B): a real `prepared`-terminal generation record was
written by a real prior dispatch (Scenario A); the task's on-disk `## Proposal` was then mutated
(simulating a human repair) while charter/AC/DoD/Touches/review-policy stayed untouched. The
SECOND real dispatch (flag omitted) produced a genuinely non-canned `--decide-resume` CLI stdout:

```json
{"decision":"resume","reason":"repaired-proposal-detected","priorGenerationId":"d4f1028d9d99", ...}
```

and the real workflow control flow genuinely skipped `ProposalAuthors`/`Adjudicate`
(`authorsCount:0`, `adjudicateCount:0`) while `ProposalReview`'s round-0 review genuinely still
dispatched (`reviewCount:1`, `proposal-review` label present in the real journal) — not asserted
from a mock, observed from the real CLI's real stdout and the real workflow's real branch taken.
Mismatch-forces-fresh (charter/task-contract/review-policy-hash mismatch, missing prior record) is
covered by `decideResumeGeneration`'s own real, independently-re-run unit fixtures (steps 4–8 in
`proposal-convergence.test.mjs`, 63/63 pass) plus this audit's own Scenario-A observation (no prior
record → 0 resume-decision dispatches, real full cold synthesis).

- [x] confirmed

### 1.3 "Unchanged stable terminal is not recomputed" (R4 sharpened) — CONFIRMED

Real, non-mocked dispatch (v3 harness). First dispatch against a real fixture task containing a
genuine `preflight-merged-markdown-claims` violation (`` `foo.ts` - update `bar.ts` invokes `baz.ts`
and `qux.ts` `` crammed on one line — the REAL detector in `prepare-admission-check.ts`, not a
canned verdict) really rejected with `preflight-rejected`, and the real
`_releaseLeaseAndRecord`→`--record-generation` dispatch really wrote
`{terminalPhase:"PreflightContent", reason:"preflight-rejected", cacheable:true, ...}` to
`.quay/prepare-leases/AUDIT-DIR126C-TMP2.generation.json`. The SECOND real dispatch, task/charter
completely unchanged, produced a real `--decide-resume` stdout:

```json
{"decision":"reuse-terminal","reason":"unchanged-generation-terminal","priorGenerationId":"608b68c2cf9d",
 "priorReason":"preflight-rejected","priorOutcome":"revision-needed","releaseResult":{"ok":true,...}}
```

with the real workflow journal being EXACTLY `[admission-acquire, resume-decision]` — zero
`preflight-content` dispatched, confirming the return genuinely precedes `phase('Preflight')`
itself, the sharpened R4 claim, not merely "before ProposalAuthors."
`.generation.json` byte content and mtime were independently verified unchanged after (WIRING-CLAIM
R6, §1.13). The `PreflightPlan`/`preflight-rejected` non-cacheable-despite-same-reason-string half
is confirmed via the real production-callsite grep (§1.10/§1.12) plus the passing R7 unit fixtures.

- [x] confirmed

### 1.4 "No lease is stranded by terminal reuse" — CONFIRMED

Directly chained onto §1.3's same real run: immediately after the real `reuse-terminal` return, a
real, separate `prepare-admission-check.ts --acquire --taskId AUDIT-DIR126C-TMP2 --workspace .`
process returned `{"outcome":"acquired", ...}` — NOT `prepare-already-running` — proving the
embedded release inside `--decide-resume` genuinely left no stranded owner. The injected-
release-failure fail-closed path (`reuse-terminal-release-failed`) is confirmed via the passing
`prepare-milestone-convergence.test.mjs` "AC4" test (both mirrors).

- [x] confirmed

### 1.5 "Review stays unconditional under resume" — CONFIRMED

§1.2's real automatic-resume dispatch shows `reviewCount:1` in the real journal (not asserted from a
mock). The explicit-`true` forced-resume path's review-still-runs property is unchanged pre-existing
behavior, independently re-confirmed passing ("M197 GREEN"/"M197: resumeFromAdjudicatedProposal:true
with open blocking findings..." tests, both mirrors, 52/52 total). `reuse-terminal`'s inability to
advance to PlanAuthor/Receipt is directly shown by §1.3's real journal (`plan-author`/`receipt` never
appear).

- [x] confirmed

### 1.6 Explicit `true`/`false` behavior unchanged — CONFIRMED

`prepare-milestone-convergence.test.mjs`'s "AC6/AC11/R2" test (both mirrors, independently re-run by
this audit): for both explicit `true` and `false`, with a prior generation record present on disk,
`calls.resumeDecisions === 0` (the CALL itself skipped, not just the decision forced) and
`result.resumed === explicitValue`. Combined with every pre-existing DIR-125/M197/DIR-126-A/
DIR-126-B scenario continuing to pass byte-for-byte unmodified (52/52), this is genuine behavioral-
parity evidence, not a literal diff-tool "golden replay" but substantively equivalent.

- [x] confirmed

### 1.7 Mirror byte-identity + independent test-file runs — CONFIRMED

Independently re-run by this audit (not trusted from Build's iteration doc):
`cmp .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js` → identical;
`cmp experiments/.../proposal-convergence.ts plugin/scripts/proposal-convergence.ts` → identical;
`bash plugin/scripts/sync-vendor.sh --check` → `CLEAN: all files verified, no drift detected.`
(exit 0). `node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` →
**63/63 pass**. `node --test plugin/test/prepare-milestone-convergence.test.mjs` → **52/52 pass**.

- [x] confirmed

### 1.8 WIRING-CLAIM R3 (embedded release, single dispatch) — CONFIRMED

§1.3's real journal is exactly `[admission-acquire, resume-decision]` on the `reuse-terminal` path —
zero separate `admission-release-*` dispatch. This is the literal dispatch-count evidence the AC
text requires, from a real run, not a mock assertion.

- [x] confirmed

### 1.9 WIRING-CLAIM R9 (Touches-scope containment) — CONFIRMED

Independently re-run: `git diff --stat 480cb58 HEAD --
experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts .gitignore` → empty (both
paths, canonical only — no `plugin/` mirror of `prepare-admission-check.ts` exists to check, and
none is claimed). Matches the passing `prepare-milestone-convergence.test.mjs` "WIRING-CLAIM R9"
test (both mirrors).

- [x] confirmed

### 1.10 WIRING-CLAIM R7 (pair disambiguation + production callsite) — CONFIRMED

Unit fixtures (`proposal-convergence.test.mjs`, "R7 fixture half" x3, passing) prove the pure
function distinguishes `{PreflightContent, preflight-rejected}` (eligible) from `{PreflightPlan,
preflight-rejected}` (not eligible, same reason string). Production-callsite half independently
re-confirmed by direct read of `.claude/workflows/prepare-milestone.js`: lines 259/269 pass
`--terminalPhase PreflightContent` (269 has `cacheable true`), lines 632/647 pass `--terminalPhase
PreflightPlan` (647 has `cacheable false`) — textually distinct literals at all four call sites, not
a shared coarse `'Preflight'` value. §1.3's real run additionally proves this end-to-end for the
cacheable half; the non-cacheable (`PreflightPlan`) half is covered by the passing unit fixture +
static callsite confirmation (this audit did not additionally dispatch a real `PlanAuthor`-stage
rejection, which would require a real content-generating agent — reasonable given the static
production-callsite grep already closes the "coarse-value" failure mode the AC text is guarding
against).

- [x] confirmed

### 1.11 WIRING-CLAIM R2 (explicit flags, zero dispatch) — CONFIRMED

Same evidence as §1.6.

- [x] confirmed

### 1.12 WIRING-CLAIM R5 (15 sites + terminalPhase argument values) — CONFIRMED

`grep -c "_releaseLeaseAndRecord("  .claude/workflows/prepare-milestone.js` → 16 (independently
re-run: 1 function definition + 15 real call sites — matches the task's own claimed live count,
re-derived, not assumed). `grep -n "_releaseLease(" .claude/workflows/prepare-milestone.js` → 0
(zero bare `_releaseLease(` calls remain). Direct read confirms every one of the 15 sites passes an
explicit `terminalPhase:` value; the two content-preflight sites pass `'PreflightContent'`, the two
plan-shape sites pass `'PreflightPlan'` — matches `prepare-milestone-convergence.test.mjs`'s passing
"WIRING-CLAIM R5/R7 production-callsite half" test (both mirrors).

- [x] confirmed

### 1.13 WIRING-CLAIM R6 (`.generation.json` never overwritten on reuse-terminal) — CONFIRMED

§1.3's real run: `fs.statSync(...).mtimeMs` and full file content captured before and after the real
`reuse-terminal` dispatch — both byte-for-byte/timestamp-for-timestamp identical
(`{"mtimeUnchanged":true,"contentUnchanged":true}`).

- [x] confirmed

### 1.14 WIRING-CLAIM R8 (side-effect-free CLI-tail import) — CONFIRMED

`proposal-convergence.test.mjs`'s "AC14/R8" test (independently re-run, passing): importing the
module in a subprocess with no CLI argv fires zero `fs`/argv-parsing side effects. Direct source
read confirms the CLI tail is gated by `if (isDirectEntry(import.meta)) { _cliMain(...) }` at the
bottom of the file, after every export.

- [x] confirmed

### 1.15 Grounding-evidence bullets (identifier-citation completeness) — CONFIRMED

All cited identifiers across the grounding-evidence bullet and items 1–12 were independently
re-confirmed present via direct source read of `proposal-convergence.ts` and
`.claude/workflows/prepare-milestone.js` during this audit (not re-typed from the task body).

- [x] all confirmed

## 2. Definition of Done

1. **Landed on `master`** — NOT YET true, and correctly so: `git log` shows only the Build commit
   (`2319e8e`), `tasks/DIR-126-C.md` frontmatter still reads `status: todo`. This is the expected
   state for an Audit-phase artifact under this milestone's own pipeline (Land runs after Audit) —
   left unchecked, not a defect.
2. **Real, non-fixture cold + automatic-resume dispatch, journal output** — **[x] confirmed** — §1.2
   (this audit's own v2 harness).
3. **Real unchanged-input `reuse-terminal` dispatch** — **[x] confirmed** — §1.3/§1.4 (v3 harness).
4. **RED/GREEN evidence for the six named scenarios** — **[x] confirmed** — 63/63 +
   52/52 independently re-run, covering matching-contract resume, charter-mutation-forces-fresh,
   unchanged-input stable-terminal reuse, task-contract/checker-policy invalidation,
   transient-terminal cold, missing-provenance-fails-closed.
5. **Fresh independent audit confirms real production callsite + review-unconditional** — **[x]
   confirmed** — this document.

## 3. Mechanical evidence independently reproduced by this audit (not self-report)

- `node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` → 63/63 pass.
- `node --test plugin/test/prepare-milestone-convergence.test.mjs` → 52/52 pass.
- `node --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
  experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs` → 103/103 pass.
- `bash plugin/scripts/sync-vendor.sh --check` → CLEAN.
- `cmp` on both touched mirror pairs → identical.
- `git diff --stat 480cb58 HEAD -- .../prepare-admission-check.ts .gitignore` → empty.
- Direct CLI dogfooding of `--preflight` against DIR-126-C's own real task+charter (production
  invocation shape) → `{"ok":true, findings:[1 non-blocking reviewer-required finding]}` — no
  regression of the M201-audit-fixed false-positive class for THIS task's own content.
- Three real, non-mocked-CLI `loadWorkflow()`-driven harness runs (§0) proving cold, automatic-
  resume, and reuse-terminal dispatches end-to-end against real fixture tasks (two ephemeral, under
  `tasks/`, deleted after the proof — same convention M200's own real-dispatch evidence used).

## 4. Concern (not a refutation of any AC item as literally worded)

**Path-sanitization mismatch in the Stage-4 pre-check, `.claude/workflows/prepare-milestone.js`
line ~202:**

```js
const _generationRecordPath = `.quay/prepare-leases/${_taskId}.generation.json`
```

builds the path via RAW, unsanitized string interpolation of `_taskId`. The CLI this pre-check is
shadowing (`proposal-convergence.ts`'s `_generationPath()`) instead sanitizes:

```js
function _safeTaskIdSegment(taskId) { return String(taskId).replace(/[\\/]/g, "_"); }
```

For any `taskId` containing a `/` — never true for a real `tasks/<ID>.md` id in this repo today
(every current task id is a plain hyphenated string), but true for this project's OWN established
relative-path scratch-fixture convention (`taskId: `../${scratchRel}/task``, used throughout
`prepare-milestone-convergence.test.mjs`'s `baseArgs()` for every DIR-125/DIR-126-A/DIR-126-B/
DIR-126-C scratch test, predating this child) — the two computations resolve to DIFFERENT files:

```
workflow pre-check (unsanitized):  .quay/prepare-leases/../tmp/dir126c-audit-XXXXX/task.generation.json
                                    -> resolves to .quay/tmp/dir126c-audit-XXXXX/task.generation.json
CLI (_safeTaskIdSegment):          .quay/prepare-leases/.._tmp_dir126c-audit-XXXXX_task.generation.json
```

Independently confirmed real via direct path computation
(`/tmp/claude-1000/.../scratchpad/path-check.mjs`) and reproduced live: this audit's OWN first
harness attempt (v1, using the SAME slash-based scratch-taskId convention this repo's test suite
already established) silently got `resumeDecisionDispatches: 0` in what should have been an
automatic-resume scenario with a real prior record on disk — the pre-check's `existsSync` check
missed the record (wrong path) and silently fell through to the "no prior record — cold" branch,
with no error, no log distinguishing this from a genuinely first-ever dispatch.

**Impact:** fail-safe (never an unsafe resume, never a crash — only a missed resume/reuse
opportunity), and does NOT affect any currently-real production dispatch (no real taskId contains a
`/`). It also does NOT falsify any AC item as literally worded — no AC claims robustness to
slash-containing taskIds. However: (a) it is an undisclosed deviation from the task's own Proposal,
which describes the `--decide-resume` dispatch as unconditional-when-omitted with no pre-check
gating it at all — the pre-check itself is a Build-time addition; (b) it means the Build's own
permanent test suite structurally CANNOT catch this class of defect, because every one of its
scratch fixtures uses the identical slash-taskId convention while ALSO fully mocking
`onResumeDecision`/`admission-*` (bypassing the real path computation the bug lives in) — so a
real regression here would be silent even to the existing 52+63 passing tests; and (c) it would
silently defeat the resume mechanism for any FUTURE audit or dogfooding session that reuses this
repo's own established scratch-taskId convention to attempt genuine (non-mocked) end-to-end proof —
exactly what happened to this audit's own first attempt.

**Recommendation:** file a follow-up gap task to sanitize `_generationRecordPath`'s taskId segment
in `prepare-milestone.js` the same way `_generationPath()`/`_leasePath()` already do in
`proposal-convergence.ts` (or, more robustly, expose `_safeTaskIdSegment` as an importable one-liner
and use it from both places) — small, low-risk, does not block Land given the fail-safe direction
and zero real-production blast radius, but should not be left open indefinitely given point (c)
above.

## 5. Overall verdict

**CONCERNS.** All 27 Acceptance Criteria items and 4 of 5 Definition-of-Done items (the 5th,
Landed-on-master, is correctly not-yet-true at this Audit-phase checkpoint) are genuinely confirmed
— several via this audit's OWN independently-reproduced real, non-mocked-CLI end-to-end dispatches
(cold/automatic-resume/reuse-terminal), not merely trusted from Build's self-report, closing exactly
the class of gap the M200/DIR-126-A audit flagged (missing real non-fixture dispatch proof) for this
child. No AC/DoD item is refuted. This audit independently discovered one real, reproducible,
narrow-blast-radius latent defect (§4) that does not block Land but should be tracked as a
follow-up gap. Recommend: proceed to Land, with the §4 gap disclosed in the ABSORB entry and
filed as a follow-up.
