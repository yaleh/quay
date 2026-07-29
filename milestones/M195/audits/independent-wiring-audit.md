# M195 / DIR-117-B — Independent Wiring Audit (fresh-context, refute-first)

**Auditor posture:** fresh-context adversarial WIRING auditor, NO prior exposure to the M195 build.
Every verdict below is RE-DERIVED from on-disk artifacts and LIVE command output at audit time
(2026-07-28), never trusted from prose/checkboxes/the workflow's own internal acceptance audit
(`milestones/M195/audits/iteration-0-acceptance-audit.md`, read but independently re-derived).
Repo root: `/home/yale/work/quay`. HEAD at audit: `3316419` (M195 ABSORB). Build commit `c9ef805`.

**Scope guard (DIR-119-C precedent):** the primary job is PRODUCTION CALL-GRAPH tracing — verifying
that "wired" modules have real production importers/call-sites and that checks exist as real calls,
not agent-prompt guidance. Journal call-counts and AC citations are treated as weak evidence and
re-derived from source wherever possible.

---

## OVERALL VERDICT: **NO REFUTATION**

All 6 required checks CONFIRMED with live evidence. Two NON-BLOCKING concerns surfaced (neither
refutes an M195 claim; see §7). The enforced-by-default flip is real and bypass-resistant; the
`checkWiringCoverage()` wiring is a genuine production call site; the evidence chain is genuine
(NC#2 journal re-derived byte-identically from the real workflow source).

**Mechanical gate `it0-dod-check.sh DIR-117-B …` exit code: `0`** (12/12 clauses PASS/N/A).

---

## Check 1 — Flip wiring (most important): **CONFIRMED**

### Commands run
```
diff -q .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js
grep -n "preparationReceiptFile\|Prepared\|preparation-receipt-missing\|SKIPPED\|revision-needed" .claude/workflows/execute-milestone.js
grep -n -B3 "^phase('Prepared')" .claude/workflows/execute-milestone.js
grep -rn "if (\$a.preparationReceiptFile)" .claude/workflows/ plugin/workflows/
grep -rn "SKIPPED — no preparationReceiptFile\|Prepared phase SKIPPED\|opt-in skip" <repo, excl milestones/docs/tasks/node_modules>
```

### Evidence (verbatim)
- **Mirrors byte-identical:** both files 39558 bytes; `diff -q` → no output (identical).
- **Header phase-table no longer opt-in** (line 6):
  `{ title: 'Prepared', detail: 'DIR-117-B/M195 — ENFORCED-BY-DEFAULT fail-closed Proposal/Plan preparation-receipt check before Build; a missing args.preparationReceiptFile returns {outcome:"revision-needed", reason:"preparation-receipt-missing", phase:"Prepared"} before Build (opt-in skip retired)' }`
- **Phase is UNCONDITIONAL.** `phase('Prepared')` at line 196 is preceded only by comment lines
  (193–195) — no wrapping `if`. The ONLY `if` touching the receipt is the NEGATIVE fail-closed check:
  ```
  196  phase('Prepared')
  197  if (!$a.preparationReceiptFile) {
  198    log(`Prepared phase FAILED — preparation-receipt-missing: no preparationReceiptFile supplied (enforced-by-default since DIR-117-B/M195; the pre-DIR-117-B opt-in skip is retired).`)
  199    return { outcome: 'revision-needed', reason: 'preparation-receipt-missing', phase: 'Prepared', verifyCacheUpdates }
  200  }
  ```
- **Missing receipt returns BEFORE Build.** The Build dispatch is at line 228 (`phase('Build')` /
  `const buildResult = await agent(...)`), strictly AFTER the fail-closed returns at 199 (missing
  receipt) and 221–224 (failed/stale check: `if (!preparedResult || preparedResult.ok !== true) return
  { outcome:'revision-needed', reason: preparedResult?.code || 'preparation-check-failed', phase:'Prepared', … }`).
  There is NO else-skip / log-and-fall-through branch.
- **No positive wrapper:** `grep "if ($a.preparationReceiptFile)"` → none (only `if (!$a.preparationReceiptFile)` at line 197 in both mirrors).
- **No bypass string survives:** the only `SKIPPED`/`opt-in skip` hits are comments/log text declaring
  the skip RETIRED (lines 6, 191, 192, 198) — no live code path logs "Prepared phase SKIPPED" and falls through.

**Verdict: CONFIRMED.** Prepared is enforced-by-default in both byte-identical mirrors; missing
receipt → `{outcome:'revision-needed', reason:'preparation-receipt-missing', phase:'Prepared'}` before any Build dispatch.

---

## Check 2 — checkWiringCoverage production call site (most important): **CONFIRMED**

### Commands run
```
diff -q .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js
grep -n "wiring-coverage\|checkWiringCoverage\|_upsertFindings\|ProposalReview" .claude/workflows/prepare-milestone.js
diff -q experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts plugin/scripts/wiring-coverage-check.ts
bash plugin/scripts/sync-vendor.sh --check
node --experimental-strip-types experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task experiments/quay-perpetual-stream/fixtures/preparation/wiring-uncovered-claim-task.md
```

### Evidence (verbatim)
- **prepare-milestone mirrors byte-identical** (both 36112 bytes; `diff -q` identical).
- **REAL agent dispatch in ProposalReview** (label + CLI command string), `.claude/workflows/prepare-milestone.js`:
  ```
  235  const _wiringCheckScript = 'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'
  236  const _wiringVerdict = await agent(
  237    `Run exactly this command and return its parsed stdout JSON:
  238  node --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md
  ...
  240    { label: 'wiring-coverage-check', phase: 'ProposalReview',
  241      schema: { … required: ['ok'], properties: { ok, code, findings: {array of _findingSchema} } } }
  ```
- **The SCRIPT (not LLM prose) merges the function's return value into the ledger:**
  ```
  243  const _wiringVerdictCodes = ['wiring-coverage-complete','wiring-coverage-none-claimed','wiring-coverage-uncovered']
  244  if (!_wiringVerdict || !_wiringVerdictCodes.includes(_wiringVerdict.code)) {
  245    log(`ProposalReview wiring-coverage sub-step FAILED — no parseable verdict …; failing the phase closed rather than skipping coverage.`)
  246    return { outcome:'needs-human', reason:'wiring-coverage-check-failed', phase:'ProposalReview', … }
  247  }
  248  _upsertFindings(Array.isArray(_wiringVerdict.findings) ? _wiringVerdict.findings : [], 0)
  ```
  `_upsertFindings` (line 139) sets `blocking = raw.blocking === true`; `_blockingOpen()` (line 167)
  returns `_ledger.filter(f => f.blocking && f.status==='open')`. So the phase's open-blocking count
  increments by the CLI's printed `findings.length` (the function's real return value relayed via the
  agent's structured output — the SAME dispatch pattern the Receipt/Prepared phases use for
  milestone-preparation-check.ts), NOT by an LLM's independent judgment. A non-parseable verdict fails
  the phase CLOSED (line 244–246), not skip.
- **Module has a real CLI mode wrapping the exported function** (`wiring-coverage-check.ts`):
  `export function checkWiringCoverage(sourceSectionText, acSectionText)` at line 105; CLI guard
  `_runAsCli` (lines 194–205 via `import.meta.url === pathToFileURL(process.argv[1]).href`); CLI block
  reads `--task`, extracts `## Proposal` / `## Acceptance Criteria`, and at **line 224 calls
  `checkWiringCoverage(proposalText, acText)`** (the ONE assertion — no re-implementation), maps
  uncovered claims to BLOCKING typed ledger findings (`wiringFindingsFromUncovered`, lines 182–192),
  prints JSON `{ok, code, message, claims, findings}` on stdout, exit 0 (exit 2 on usage/IO error).
- **Mirrors byte-identical + sync CLEAN:** canonical and `plugin/scripts/wiring-coverage-check.ts`
  both 11237 bytes, `diff -q` identical; `bash plugin/scripts/sync-vendor.sh --check` →
  `CLEAN: all files verified, no drift detected.` exit 0 (incl. `OK (identical): scripts/wiring-coverage-check.ts`).
- **LIVE CLI on the fixture (≥1 blocking finding derived from the function):**
  ```
  { "ok": false, "code": "wiring-coverage-uncovered",
    "message": "2 of 2 mechanism claim(s) have no matching, evidence-requiring '## Acceptance Criteria' item: …",
    "findings": [
      { "subsystem":"wiring-coverage", "severity":"blocker", "blocking":true,
        "evidence":"checkWiringCoverage() returned uncovered claim #1; identifiers: `batch-reconciler.ts`, `shard-writer.ts`", … },
      { "subsystem":"wiring-coverage", "severity":"blocker", "blocking":true,
        "evidence":"checkWiringCoverage() returned uncovered claim #2; identifiers: `metrics-emitter.ts`, `dashboard.md`", … } ] }
  CLI exit: 0
  ```
  Fixture verified legitimate: its `## Proposal` claims two mechanisms (`batch-reconciler.ts`
  dispatches `shard-writer.ts`; `metrics-emitter.ts` owns `dashboard.md`); its single `## Acceptance
  Criteria` item is intentionally unrelated and carries no evidence keyword for either pair → both
  claims stay uncovered → 2 blocking findings.

**Verdict: CONFIRMED.** Real `wiring-coverage-check` agent dispatch (label + CLI string) in both
prepare-milestone mirrors; script merges the function's returned findings via `_upsertFindings`;
CLI wraps the single exported `checkWiringCoverage()`; mirrors identical + sync CLEAN; live CLI emits
2 blocking findings on a legitimate uncovered-claim fixture.

---

## Check 3 — Test harnesses: **CONFIRMED**

### Commands run
```
grep -n "SKIPPED\|back-compat\|reaches Build\|buildReached\|preparation-receipt-missing\|RED\|GREEN" plugin/test/execute-milestone-preparation-gate.test.mjs
grep -n "wiring-coverage-check" plugin/test/prepare-milestone-convergence.test.mjs plugin/test/prepare-milestone-preparation-e2e.test.mjs
node --test plugin/test/execute-milestone-preparation-gate.test.mjs plugin/test/prepare-milestone-convergence.test.mjs \
  plugin/test/prepare-milestone-preparation-e2e.test.mjs experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs \
  experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs plugin/test/plugin-packaging.test.mjs
```

### Evidence (verbatim)
- **RED-then-GREEN honest fail-closed case** (former "SKIPPED (back-compat) — reaches Build" flipped),
  `plugin/test/execute-milestone-preparation-gate.test.mjs` lines 275–292, run once PER MIRROR
  (`MIRRORS = [['.claude/…', …], ['plugin/…', …]]` line 48; `for (const [mirrorName, workflowFile] of MIRRORS)` line 169):
  ```
  const args = scratchArgs(scratchDir, { receiptFile: undefined });   // receipt OMITTED
  const result = await runExecuteMilestone(workflowFile, args);        // loads REAL unmodified workflow source
  assert.equal(result.outcome, 'revision-needed', …);
  assert.equal(result.reason, 'preparation-receipt-missing');
  assert.equal(result.phase, 'Prepared');
  assert.notEqual(result.reason, 'test-short-circuit-after-build', 'Build must NOT be reached when the receipt is omitted');
  ```
  The Build short-circuit sentinel (`test-short-circuit-after-build`) must NOT appear — proving Build
  was never dispatched. A companion case (lines 258–273) confirms a fully-valid receipt DOES reach Build.
- **Both mock harnesses handle the `wiring-coverage-check` label without throwing** — each routes it to
  the REAL CLI: `prepare-milestone-convergence.test.mjs:149` and
  `prepare-milestone-preparation-e2e.test.mjs:163` both do
  `if (label === 'wiring-coverage-check') { … runShell('node --experimental-strip-types …/wiring-coverage-check.ts --task …') }`.
  The convergence test also has a dedicated AC#4 test (lines 508–545) asserting exactly one
  wiring-coverage-check dispatch and that the findings land in the ledger from the function's return value.
- **LIVE run (real pass/fail counts):**
  ```
  ℹ tests 125
  ℹ pass 125
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  TEST SUITE EXIT: 0
  ```
  Includes, verbatim: `✔ […] DIR-117-B/M195 AC#4: ProposalReview finding count increments from
  checkWiringCoverage()'s real return value (not LLM judgment)` and both mirrors' fail-closed + reaches-Build cases.

**Verdict: CONFIRMED.** 125/125 pass, 0 fail, exit 0. No failures to triage (none pre-existing, none M195-caused).

---

## Check 4 — Evidence chain: **CONFIRMED**

### Commands run
```
node -e '<parse journal>' …/subagents/workflows/wf_977c3bab-c59/journal.jsonl
node --experimental-strip-types …/milestone-preparation-check.ts --task tasks/DIR-117-B.md --charter …/M195-dir117b-prepared-gate-real-proof.md --receipt milestones/M195/preparation.json
node --experimental-strip-types …/milestone-preparation-check.ts … --receipt milestones/M195/negative-control/preparation-tampered.json
diff <(node -e '…real receipt hash…') <(node -e '…tampered receipt hash…')
cat milestones/M195/negative-control/post-flip-omitted-receipt-journal.jsonl
node /tmp/nc2-repro.mjs   # independent reproduction of NC#2 from the REAL workflow source
diff /tmp/nc2-mine.txt milestones/M195/negative-control/post-flip-omitted-receipt-journal.jsonl
```

### Evidence (verbatim)
- **Execute journal `wf_977c3bab-c59` — Prepared PASSED on the real receipt, Build dispatched AFTER (ordering visible):**
  ```
  event[13] result  agentId=ad1792381e1ace312   { "ok": true, "code": "PASS: prepared",
                "detail": "PASS: prepared — preparation receipt matches current state; review/plan-check both zero-finding (3 round(s))" }
  event[14] started agentId=a37700a17241b31fa                      # Build-phase agent STARTS AFTER the Prepared PASS
  event[15] result  agentId=a37700a17241b31fa   { "taskId": "DIR-117-B", "outcome": "done", "iterationCount": 1, "mergeCommit": "c9ef805" }
  ```
  Index 14 (Build start) > 13 (Prepared PASS) — ordering is explicit. `mergeCommit c9ef805` = the claimed build commit.
  (Phase mapping verified: events 0–11 = Verify it0 checks; 12/13 = Prepared `preparation-check`;
  14/15 = Build; 16/17 = Audit "All 5 Acceptance Criteria independently CONFIRMED"; 18–27 = Gate; 28/29 = Land.)
- **Receipt passes the standalone checker (exit 0):**
  `PASS: prepared — preparation receipt matches current state; review/plan-check both zero-finding (3 round(s))` — EXIT 0.
- **Negative control #1 (tampered receipt → proposal-stale FAIL exit 1):**
  `FAIL: proposal-stale — task '## Proposal' has changed since preparation — rerun the full Proposal→Plan preparation` — EXIT 1.
  Tamper verified GENUINE: `hashes.proposal` first hex char flipped `f931ba1f…` → `0931ba1f…` (real one-char diff vs the live receipt).
- **Negative control #2 (omitted receipt, post-flip) — journal lines are GENUINE, re-derived byte-identically:**
  Journal `milestones/M195/negative-control/post-flip-omitted-receipt-journal.jsonl` (both mirrors):
  ```
  {"mirror":".claude/workflows/execute-milestone.js","argsPreparationReceiptFile":null,"outcome":"revision-needed","reason":"preparation-receipt-missing","phase":"Prepared","buildReached":false,"phasesDispatched":["Verify","Prepared"]}
  {"mirror":"plugin/workflows/execute-milestone.js","argsPreparationReceiptFile":null,"outcome":"revision-needed","reason":"preparation-receipt-missing","phase":"Prepared","buildReached":false,"phasesDispatched":["Verify","Prepared"]}
  ```
  I wrote my OWN minimal harness (`/tmp/nc2-repro.mjs`) that loads each REAL, unmodified mirror as an
  AsyncFunction (only `export` stripped), stubs the 6 Verify it0 checks to pass, tracks dispatched
  phases, and OMITS `preparationReceiptFile`. Its output was **byte-identical** to the journal file
  (`diff` → no output, "GENUINE"). This directly answers the DIR-119-C failure mode: the NC#2 lines are
  NOT hand-authored prose — they are exactly what the real production source produces. (The workflow's
  own audit disclosed this load-the-real-source method; I re-ran it independently.)
- **Supporting context — prepare-run journal `wf_c265f7ee-f08` (cited by AC#11/Resolution) exists** (27
  events): it dispatched the wiring-coverage check (wiring findings present) and produced the real
  receipt — event[26] `{ok:true, receiptFile:"milestones/M195/preparation.json", detail:"PASS: prepared — preparation receipt matches curre…"}`.

**Verdict: CONFIRMED.** Real execute-run journal shows Prepared PASS before Build (mergeCommit c9ef805);
receipt passes the checker (exit 0); NC#1 → proposal-stale exit 1 (genuine tamper); NC#2 → both mirrors
preparation-receipt-missing/buildReached:false, re-derived byte-identically from real source (genuine).

---

## Check 5 — Parent bookkeeping: **CONFIRMED** (one NON-BLOCKING pre-existing note)

### Commands run
```
sed -n '1,30p' tasks/DIR-117.md ; grep -n "dirStatus\|^status:\|Resolution\|M195" tasks/DIR-117.md
awk '<enumerate AC checklist>' tasks/DIR-117.md ; sed -n '327,342p' tasks/DIR-117.md ; sed -n '655,676p' tasks/DIR-117.md
node experiments/quay-perpetual-stream/scripts/task-schema-check.ts tasks/DIR-117-B.md
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-117-B <charter> milestones/M195/absorb-entry.md
git show c9ef805~1:tasks/DIR-117.md ; git show ea63c05:tasks/DIR-117.md   # dirStatus-field history
```

### Evidence (verbatim)
- **AC item #11 (the remaining real-landing item) ticked + pointed at M195** (line 327, `- [x]`):
  "One real post-DIR-117 milestone completes the entire preparation→Prepared gate→Build route. …
  **LAND (2026-07-28, M195 land of [[DIR-117-B]]): CONFIRMED — …** real prepare-run journal
  `wf_c265f7ee-f08` … → receipt `milestones/M195/preparation.json` (re-verified PASS) → real execute-run
  journal `wf_977c3bab-c59` (Prepared `PASS: prepared` BEFORE Build, `mergeCommit c9ef805` on `master`)
  → `docs/plans/M195-dir-117-b.md`." (All 11 AC items are `[x]`.)
- **`## Resolution (M195 land, 2026-07-28)` added** (line 655), pointing comprehensively at M195's real
  evidence: real route (both journals + receipt + plan), enforced default (byte-identical mirrors,
  unconditional `phase('Prepared')`, missing receipt fail-closes), negative controls (proposal-stale /
  preparation-receipt-missing/buildReached:false), full audit reference. Line 673–675: "`status` remains
  `needs-human` pending the human verification checklist …; `dirStatus` stays `applied`."
- **Current literal state:** `status: needs-human` (frontmatter line 5 — by design: DIR-117 is
  `label:human-steered`; the Resolution explicitly records evidence but reserves the human disposition).
  `dirStatus`: prose says `applied` (Resolution line 675 + Execution log line 439 "set dirStatus: applied").
- **task-schema-check DIR-117-B:** `PASS: tasks/DIR-117-B.md — schema v1 conformant (kind=directive)` — EXIT 0.
- **it0-dod-check DIR-117-B:** all clauses PASS/N/A, `PASS: DoD check passed — all clauses satisfied
  (12 disposition(s) confirmed), no undeclared self-exemption.` — **EXIT 0** (clause0 5/5 AC checked;
  clause10 tree-hygiene clean; clause11 worktree-branch-hygiene clean; clause9 split-or-commit N/A).

### Non-blocking note (NOT M195-caused, NOT a refutation)
DIR-117's frontmatter `extra:` block carries only `acceptance:` — it has **no `extra.dirStatus` field**,
whereas its sibling directives (DIR-119-A/B/C, DIR-122, DIR-125) all carry `extra.dirStatus: applied`.
The body/Resolution prose claims "applied" but there is no machine field backing it. Verified
**PRE-EXISTING**: `git show c9ef805~1:tasks/DIR-117.md` and `git show ea63c05:tasks/DIR-117.md` (M191)
BOTH show an `extra:` block with no `dirStatus` key — so M195 neither introduced nor was required to fix
this. `task-schema-check` does not require the field (DIR-117 passes as N/A-legacy; DIR-117-B passes v1).
Flagged only as a minor single-source-of-truth hygiene drift for a future cleanup; it does not touch any
M195 claim.

**Verdict: CONFIRMED.** AC#11 ticked + Resolution added, both pointing at M195's real evidence; literal
status `needs-human` (by design), dirStatus `applied` (prose); task-schema-check exit 0; it0-dod-check exit 0.

---

## Check 6 — Bypass hunt: **CONFIRMED** (no bypass; one NON-REFUTING doc concern)

### Commands run
```
grep -n "preparationReceiptFile\|execute-milestone\|execute(\|prepare(\|required\|optional" experiments/quay-perpetual-stream/OUTER-LOOP.md
sed -n '124,178p' experiments/quay-perpetual-stream/OUTER-LOOP.md
grep -rln "BUILD the inner iteration\|buildResult\|class-route\|inner iteration agent" <repo, excl node_modules/milestones>
grep -rn "execute-milestone" <repo> | grep -i "invoke\|dispatch\|Workflow\|name:\|scriptPath"
grep -rn "phase.*Build\|dispatch.*Build" plugin/skills/ …/concurrent-batch-scheduler.ts …/select-preflight.ts
```

### Evidence (verbatim)
- **OUTER-LOOP serial `execute()` names the receipt REQUIRED** (line 124 + 128):
  `execute(params) where |batch|=1 = invoke(".claude/workflows/execute-milestone.js", {taskId, charterFile, absorbEntryFile, preparationReceiptFile})`
  and "ENFORCED-BY-DEFAULT: `preparationReceiptFile` is REQUIRED — … the phase fails closed with
  {phase:\"Prepared\", outcome:\"revision-needed\"} on a MISSING param (reason:\"preparation-receipt-missing\") …
  The pre-DIR-117-B opt-in skip is retired". Lines 62–65 likewise: "every dispatch MUST supply a `preparationReceiptFile`."
- **Build logic is exclusive to the workflow.** `grep -rln "BUILD the inner iteration|buildResult|class-route|inner iteration agent"`
  (excl node_modules/milestones) → ONLY the two `execute-milestone.js` mirrors. It is inline (not an
  importable module), so no CLI/MCP/script can invoke the Build phase except THROUGH the workflow — which
  now has an unconditional Prepared gate. No skill or scheduler dispatches a Build directly
  (the `loop-driver` skill drives a FOREIGN workspace's own iterate cycle, not this repo's execute-milestone Build).
- **Therefore NO path reaches Build without passing Prepared.** Any dispatch (serial OR concurrent) that
  omits the receipt now FAILS CLOSED before Build (independently proven in Check 1 + Check 4/NC#2).

### Non-refuting doc CONCERN
`OUTER-LOOP.md`'s **`concurrent_execute()` dispatch shape (lines 160–161) OMITS `preparationReceiptFile`:**
```
a. ∀c∈B: dispatch Workflow({name: "execute-milestone",
   args: {taskId: c.id, charterFile: c.charter, absorbEntryFile: c.absorb, mode: "concurrent"}}, run_in_background: true)
```
The serial path (line 124) supplies it; the concurrent path's documented args do not. Post-flip this is
NOT a bypass — a ≥2-wide concurrent batch dispatched exactly as documented would **fail closed** at
Prepared for every member (I proved omitting the receipt fails closed in Check 4/NC#2). It is a latent
documentation-completeness bug (the doc would now produce failing dispatches), not a gate bypass. It does
not refute any M195 claim: M195 ran the SERIAL path (which is correct), and `concurrency` defaults OFF in
this repo (loop runs serially on master). Recommended follow-up: add `preparationReceiptFile: c.receipt`
to the `concurrent_execute()` args shape so the documented wide path matches the enforced contract.

**Verdict: CONFIRMED** (no Build-bypass exists; the flip is robust). One non-refuting doc-drift concern recorded.

---

## §7 — Summary of concerns (none refuting)

| # | Concern | Severity | M195-caused? | Effect |
|---|---------|----------|--------------|--------|
| C1 | `tasks/DIR-117.md` frontmatter has no `extra.dirStatus` field though prose says `applied` (siblings carry the field) | minor / hygiene | **NO** — pre-existing at M191 & pre-build | single-source-of-truth drift; not a schema violation; does not touch any M195 claim |
| C2 | `OUTER-LOOP.md` `concurrent_execute()` args shape omits now-required `preparationReceiptFile` | minor / doc-drift | partial (the flip exposed a pre-existing doc gap) | NOT a bypass — wide dispatch would FAIL CLOSED; serial path (used by M195) correct; concurrency defaults OFF |

Neither concern reaches the bar for REFUTATION. The two MOST-IMPORTANT checks (flip wiring;
checkWiringCoverage production call site) are both CONFIRMED with live, independently re-derived evidence,
and the specific DIR-119-C failure mode (a "wired" module with zero production importers / a check that
exists only as agent-prompt guidance) is positively ruled out: `checkWiringCoverage()` has a real CLI call
site invoked by a real agent dispatch whose returned findings the script merges mechanically, and the
NC#2 journal was re-derived byte-identically from the real workflow source.

## Final line
**Overall: NO REFUTATION. it0-dod-check exit code: 0.** M195's DIR-117-B done-claim is legitimate on the
wiring evidence. Two non-blocking items (C1 pre-existing dirStatus-field drift; C2 concurrent_execute doc
gap) are recommended for a future cleanup milestone but do not invalidate this milestone.
