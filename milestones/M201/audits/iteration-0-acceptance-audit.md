# M201 / DIR-126-B — Iteration 0 Adversarial Acceptance Audit

**Audit session id:** 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1

**Verdict: REFUTED**

Fresh-context, refute-first audit of the Build commit `3552787` ("M201/DIR-126-B build: deterministic
mechanical Preflight phase for prepare-milestone.js") against `tasks/DIR-126-B.md`'s own Acceptance
Criteria / Definition of Done. The core wiring/mechanism is real, well-tested, and independently
reproduced by this audit (not merely self-reported) — but a severe, reproducible false-positive
defect was found by dogfooding the real production CLI against this child's OWN real task+charter
(and DIR-126-A's), which the calibration fixture corpus never exercised. That defect directly
falsifies the "No heuristic overreach" and "valid fixtures remain GREEN" claims for realistic
content, not just synthetic fixtures.

## 1. AC-by-AC refutation attempt

### 1.1 "Most important — real production wiring, not agent-prompt guidance" — CONFIRMED

- `git show 3552787 -- .claude/workflows/prepare-milestone.js` shows a new `phase('Preflight')`
  block calling `_preflightAgentCall('--preflight --taskId ... --charterFile ... --workspace .', 'preflight-content')`
  strictly after `Admission`'s acquired-lease log and strictly before the pre-existing
  `ProposalAuthors`-dispatching code (line ~136 in the new file), and a second
  `--preflight-plan` call strictly after `planAuthorResult` succeeds and before `phase('PlanCheck')`
  (line ~512).
- Both `.claude/workflows/` and `plugin/workflows/` mirrors carry byte-identical changes (`cmp`
  confirms identical, see §1.6).
- `--preflight`/`--preflight-plan`/`--planFile`/`--charterFile` live in the SAME `spec.flags` object
  `--acquire`/`--renew`/`--release` already use (`experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`,
  confirmed via direct read of `main()`'s `spec` object) — one `parseArgs(` call site, test-asserted
  (`WIRING-CLAIM 9` test passes, see §1.8).
- **Not selftest-only:** `grep -rn selftest experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`
  returns zero hits — there is no selftest-only reachability path for these flags.
- [x] confirmed

### 1.2 "Preflight precedes agents" — **REFUTED**

Structural short-circuit and the "zero forbidden dispatch" claim were independently reproduced by
this audit (not merely trusted from `milestones/M201/iterations/iteration-0.md`'s prose): a scratch
harness (`/tmp/.../scratchpad/e2e-verify.mjs`, not committed) loaded the REAL, unmodified
`.claude/workflows/prepare-milestone.js` source as a live `AsyncFunction`, mocked only
`admission-acquire`/`admission-release-*` with canned lease verdicts, and let `preflight-content`
extract-and-run the REAL shell command from the agent prompt (not stubbed) against a scratch task
with a deliberately-seeded `preflight-merged-markdown-claims` violation. Result, independently
confirmed:
```
outcome: revision-needed, reason: preflight-rejected, phase: Preflight
journal: [phase:Admission, admission-acquire, phase:Preflight, preflight-content, admission-release-preflight-rejected]
FORBIDDEN DISPATCHES: []
```
Any `proposal-author-*`/`adjudicate`/`proposal-review`/`plan-check-*` label reached would have thrown
in this mock — none did. This part of the AC item is genuinely met for a deliberately-bad fixture.

**However, this same AC item's own text also requires "Valid M195/M197-shaped fixtures remain
GREEN."** This audit dogfooded the exact production CLI invocation shape (`--preflight --taskId
<id> --charterFile <charter> --workspace .`) against two REAL tasks from this same DIR-126 family —
the two tasks that most resemble "a valid, real M20x-shaped task" available in this repo:

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts \
    --preflight --taskId DIR-126-B \
    --charterFile experiments/quay-perpetual-stream/charters/M201-dir126b-deterministic-preflight.md --workspace .
exit 1
{"ok":false, findings:[
  {"code":"preflight-stale-ac-refs","blocking":true,
   "message":"'## Acceptance Criteria'/'## Definition of Done' cite 6 reference(s) that do not resolve...:
     file:prepare-admission-check.ts, file:prepare-milestone.js, file:wiring-coverage-check.ts,
     file:wiring-coverage-check.test.mjs, file:tasks/X.md, file:task-schema.ts"},
  {"code":"preflight-missing-precedent","blocking":true,
   "message":"'## Finding'/'## Requested action'/'## Proposal' cite 7 claimed precedent(s) ... that
     do not resolve...: file:wiring-coverage-check.ts, file:wiring-coverage-check.test.mjs,
     file:prepare-admission-check.ts, file:prepare-milestone.js, file:task-schema.ts,
     file:milestone-preparation-check.ts, file:tasks/X.md"}
]}
```

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts \
    --preflight --taskId DIR-126-A \
    --charterFile experiments/quay-perpetual-stream/charters/M200-dir126a-single-flight-admission.md --workspace .
exit 1
{"ok":false, findings: [... preflight-stale-ac-refs blocking (10 refs) ..., ... preflight-missing-precedent blocking (13 refs) ...]}
```

**DIR-126-B's own real task file — the very task that introduces this feature — would be REJECTED
by its own new `Preflight` phase**, and so would DIR-126-A's. Root cause, confirmed by direct read
of `_FILE_PATH_RE` in `prepare-admission-check.ts`:
```
const _FILE_PATH_RE = /^[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]{1,6}$|^[\w.-]+\.(?:ts|js|mjs|md|yml|yaml|json|sh)$/;
```
The second alternative matches ANY bare `word.ext` token with a common extension, with no directory
component required. `preflightStaleAcRefs`/`preflightMissingPrecedent` then do
`fs.existsSync(path.join(workspace, tok))` on that bare token — so a completely ordinary prose
reference like `` `prepare-admission-check.ts` `` (the real file lives at
`experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`, not at the repo root) is
treated as a dangling reference and blocks. This is not an edge case: mentioning a file by its bare
name without repeating its full path is the dominant convention in EVERY task/charter file read
during this audit, including this task's own AC/Finding text. `` `tasks/X.md` `` — a generic
placeholder token used to mean "some task file," present verbatim in this task's own AC bullet 4 — is
also flagged as a "missing precedent," compounding the problem.

This is exactly the false-positive class the Proposal's own Risks section says is mitigated
("Preflight false positives recreating the exact M198 `wiring-coverage-check.ts` regression class...
Mitigated by (a) reusing the already-fixed... splitter... (b) the reviewer-required disposition for
anything a detector cannot confidently classify") — but that mitigation only covers
`preflight-merged-markdown-claims`. `preflight-stale-ac-refs`/`preflight-missing-precedent` have NO
comparable reviewer-required routing for bare-filename references; they hard-block. The calibration
fixture triads for these two detectors (`stale-ac-refs/{bad,good,ambiguous}.md`,
`missing-precedent/{bad,good,ambiguous}.md`) are synthetic (self-disclosed in
`milestones/M201/iterations/iteration-0.md`'s "Known follow-ups": "not against a corpus of real
M192/M195/M196/M198 session artifacts verbatim... the fixtures are realistic, representative
instances... not literal excerpts") and never exercised this exact, extremely common shape.

**Consequence if landed as-is:** every future `prepare-milestone.js` dispatch against a task written
in this repo's own dominant prose convention (bare filenames in AC/Finding text) will be wrongly
rejected at the `Preflight` phase before any author agent runs — the opposite of the feature's
purpose (avoid wasting agent turns on genuinely bad proposals; this instead blocks good ones with
zero recourse other than a human noticing and rewriting every backtick-quoted filename in every
task's AC/DoD/Finding/Requested-action section to include full paths).

- [ ] **NOT confirmed as stated** — the "valid content stays GREEN" half of this AC item is
  demonstrably false against two real, currently-landed tasks in this very repo.

### 1.3 "Repair/calibrate before fail-closed activation" — **REFUTED** (as a substantive claim; the mechanical process itself runs)

The calibrate-then-enforce *machinery* is real: `PREFLIGHT_CALIBRATED` (all five `true`), a fixture
triad per detector, and a passing "calibration: an uncalibrated detector's blocking verdict is
downgraded..." test (`experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`, 55/55
green). But the entire *point* of calibrating-before-enforcing is to "prove the detector's blocking
boundary" before production ships it — and §1.2 shows the boundary for `preflight-stale-ac-refs` /
`preflight-missing-precedent` is proven WRONG the moment it is run against real content, not
hypothetical content. A calibration corpus that is synthetic-only and misses the codebase's own
dominant prose convention did not actually validate the claimed boundary.

- [ ] **NOT confirmed as stated** — calibration ran, but did not prove a correct boundary.

### 1.4 "No heuristic overreach" — **REFUTED**

Per-detector ambiguous-valid fixtures do correctly route to `reviewer-required` (all 5 ambiguous
tests pass, confirmed via `scripts/test.sh --test-name-pattern="ambiguous" ...` — 5/5 green). But
"no heuristic overreach" as a *behavioral guarantee against real content* is directly falsified by
§1.2: real, valid, already-landed task text is not routed to `reviewer-required` — it is hard-blocked
(`blocking: true`, `disposition: "unresolved"`).

- [ ] **NOT confirmed as stated**

### 1.5 "`wiring-coverage-check.ts`'s merged-list false-positive class stays closed" (already-satisfied precedent) — CONFIRMED

`bash scripts/test.sh experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` → 18/18
pass, unmodified logic (only a 2-line `export` added, confirmed via `git show 3552787 --
.../wiring-coverage-check.ts`), including the bullet-list regression test (`335317d`) and the
pipe-table regression test (`44ca1b3`). Unrelated to the §1.2 defect (different detector family).

- [x] confirmed — `bash scripts/test.sh experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`: 18/18 pass.

### 1.6 Mirror byte-identity — CONFIRMED

```
$ cmp .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js            (identical, no output)
$ cmp experiments/.../prepare-admission-check.ts plugin/scripts/prepare-admission-check.ts     (identical, no output)
$ cmp experiments/.../wiring-coverage-check.ts plugin/scripts/wiring-coverage-check.ts         (identical, no output)
$ cmp experiments/.../test/prepare-admission-check.test.mjs plugin/test/prepare-admission-check.test.mjs  (identical, no output)
$ bash plugin/scripts/sync-vendor.sh --check                                                    → CLEAN: all files verified, no drift detected.
```

- [x] confirmed

### 1.7 Checker version/hash on every verdict — CONFIRMED

`PREFLIGHT_POLICY_VERSION = "preflight-v1"` exported; every finding in both my own dogfooding runs
and the test suite carries `"policyVersion":"preflight-v1"`. Test "`PREFLIGHT_POLICY_VERSION` is a
stable, exported literal — every finding carries it" passes.

- [x] confirmed

### 1.8 Grounding-evidence bullet + Grounding evidence 1–16 (wiring-coverage citation-completeness bullets) — CONFIRMED

All named identifiers (`WIRING_VERB_RE`, `703e014`, `f3d870b`, `335317d`, `splitListAwareBlocks()`,
`splitSentences`, `44ca1b3`, `git cat-file -e`, `fs.existsSync`, `reviewer-required`,
`checkTouches()`/`checkTouches`, `parsePlanStages`/`validatePlanStructure`, `- Files:`/`### Stage
N`/`## Touches`, the phase names/labels, etc.) were confirmed present and wired as claimed via direct
source read of `prepare-admission-check.ts`, `wiring-coverage-check.ts`, and
`.claude/workflows/prepare-milestone.js`, and via `git log` for the cited commit hashes. These
bullets assert only that the cited identifiers are real (not fabricated names) — they do not assert
absence of false positives, so they are unaffected by the §1.2 defect.

- [x] all 16 confirmed (Grounding evidence 1–16) + the main grounding-evidence bullet.

## 2. Definition of Done

1. **Landed on `master` under human-steered discipline** — NOT YET true: `tasks/DIR-126-B.md`'s
   frontmatter still reads `status: todo`; only the Build commit (`3552787`) exists so far, ahead of
   this Audit/Absorb pass. Expected to remain unmet until Land completes — but given the REFUTED
   verdict below, Land should NOT proceed until §1.2's defect is fixed. **[ ] not yet — and should not proceed as-is.**
2. **Real, non-fixture `prepare-milestone` dispatch showing `preflight-rejected` before any author
   agent, journal evidence** — independently reproduced by this audit for the deliberately-bad-input
   case (§1.2, scratch harness). **[x] confirmed** for that specific scenario — `/tmp/.../scratchpad/e2e-verify.mjs`
   run output: `outcome: revision-needed, reason: preflight-rejected`, zero forbidden dispatches.
3. **RED/GREEN evidence for all five preflight classes + `splitSentences` fix** — confirmed present:
   `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` 55/55 pass (RED/known-bad,
   known-good, ambiguous-valid `describe` blocks per detector); `wiring-coverage-check.test.mjs` 18/18.
   **[x] confirmed** (evidence exists; §1.2/1.3 is a separate finding about calibration ADEQUACY, not
   about whether RED/GREEN tests exist).
4. **Fail-closed activation evidence proves detector calibration completed before enforcement** — the
   mechanical evidence (all five `PREFLIGHT_CALIBRATED: true`, calibration-downgrade test passing)
   exists, but §1.3 shows the calibration did not actually validate against realistic content. **[ ]
   not confirmed as a substantive claim.**
5. **Fresh independent audit confirms the real production callsite AND the Plan-shape-timing
   reading** — this document IS that audit; the callsite is confirmed real (§1.1). The
   content-check-input-scope / Plan-shape-timing reading from the Proposal was not separately
   contested by any later "Correction" note in the task body, so this audit accepts it as the
   reviewer's implicit approval per the Proposal's own stated fallback ("If a reviewer's actual
   intent differs from this reading, the AC below should be corrected explicitly rather than the code
   silently reinterpreted mid-Build" — no such correction exists, and the two-insertion-point
   implementation matches the documented design 1:1). **[x] confirmed** for the callsite/timing
   question; **REFUTED overall** because of §1.2's substantive functional defect discovered during
   this same audit.

## 3. Mechanical evidence independently reproduced by this audit (not self-report)

- `bash scripts/test.sh experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` → 55/55 pass.
- `bash scripts/test.sh experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` → 18/18 pass.
- `bash scripts/test.sh` (full canonical suite) → 664 tests, 661 pass, 0 fail, 3 skipped (live-GitHub, correctly self-skipping), exit 0 — matches the Build's own claim exactly.
- `bash plugin/scripts/sync-vendor.sh --check` → CLEAN.
- `cmp` on all four touched canonical/`plugin/` file pairs → identical.
- Scratch e2e harness (`/tmp/.../scratchpad/e2e-verify.mjs`, not committed) driving the REAL,
  unmodified `.claude/workflows/prepare-milestone.js` source with a mock `agent()` that runs the
  REAL preflight CLI → reproduces the claimed `preflight-rejected`/zero-forbidden-dispatch outcome.
- Direct CLI dogfooding of `--preflight` against `DIR-126-B`/`DIR-126-A`'s own real task+charter
  files (production invocation shape, not a test fixture) → **both reject with blocking findings**,
  refuting the "valid content stays GREEN" / "no heuristic overreach" claims.

## 4. Overall verdict

**REFUTED.** The production wiring (AC "Most important" item, WIRING-CLAIMs 1–9, mirror
byte-identity, policy-version emission, and the deliberately-bad-input rejection path) is real,
correctly implemented, and independently reproduced. However, this audit found — by dogfooding the
exact real production CLI invocation against this child's own real task and its sibling
DIR-126-A — that `preflight-stale-ac-refs` and `preflight-missing-precedent` hard-block on the
codebase's own dominant, valid prose convention (bare filenames in backticks without full repo-root
paths), a false-positive class the calibration fixture corpus (synthetic-only, self-disclosed as
such in the Build's own iteration doc) never exercised and therefore never caught. This directly
falsifies the "No heuristic overreach" / "valid fixtures remain GREEN" / "calibration proves the
blocking boundary" claims for realistic content, and — if landed as-is — would make the `Preflight`
phase reject essentially any ordinarily-written task, defeating the milestone's own purpose.
**Recommend: do not Land as-is.** Fix (narrow `_FILE_PATH_RE`/its existence check to require either
a real directory-qualified path or a repo-wide basename search before treating a bare `word.ext`
token as a dangling file reference, or route unqualified bare-filename tokens to
`preflight-ambiguous-*`/`reviewer-required` the same way the merged-markdown-claims detector already
does for its own uncertain cases), add at least one real fixture that reproduces this exact class,
and re-audit.
