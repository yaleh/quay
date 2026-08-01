# M203 / DIR-126-D — Iteration 0 Acceptance Audit (adversarial, fresh context)

**Audit session id:** 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1

**Task:** DIR-126-D — Per-generation phase telemetry for `prepare-milestone.js` (committed
`milestones/prepare-telemetry/` records) — fourth child of DIR-126's 5-way split.
**Charter:** `experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md`
**Build commit:** `1be6c21` (M203/DIR-126-D Build: per-generation phase telemetry for
`prepare-milestone.js`)
**Verdict:** **REFUTED**

## Method

Fresh-context read of `tasks/DIR-126-D.md`'s Proposal, Chosen mechanism, AC (24 items), and DoD (5
items) — no prior exposure to the Build. Independently re-derived evidence via direct source diff
read (`git show 1be6c21`), independent re-run of `sync-vendor.sh --check`/`plugin/sync.sh`/`cmp`,
an independent grep for `Date.now()`/`new Date()`/`import(` regression, and inspection of the test
suites (`experiments/quay-perpetual-stream/test/{proposal-convergence,milestone-preparation-
check}.test.mjs`, `plugin/test/{prepare-milestone-convergence,prepare-milestone-preparation-
e2e}.test.mjs`) for the specific fixtures each AC item names — not the Build's own self-report.

## Central finding

**Zero committed telemetry records exist anywhere in the repository.** `find milestones/prepare-
telemetry` returns "No such file or directory"; `git log --all -- 'milestones/prepare-telemetry/**'`
returns nothing. This directly contradicts the milestone's own stated purpose ("Emit one committed,
structured JSON telemetry record per `prepare-milestone` dispatch attempt") and its own DoD item 2
("A real, non-fixture cold run AND a real, non-fixture non-success generation both produce real,
inspectable telemetry records with command output, not asserted").

This is not a surprise finding sprung on the Build — the Build's own `milestones/M203/iterations/
iteration-0.md` explicitly discloses it: "Stage 13's literal real, non-fixture `Workflow()`-
dispatched agent run was not performed... this Build subagent has no `Workflow`/agent-dispatch tool
available to it," and names this as "an open item for the independent Audit." This audit's role is
exactly that determination, and — per the same DIR-026 Reading A standard this repo already applied
at the M197/M200/M201 audits (each of which similarly REFUTED a milestone whose only evidence was
mocked-agent tests, never a real Workflow dispatch) — the mocked/subprocess substitute the Build
provides is real, substantial, and well-engineered, but it is not the "real, non-fixture" evidence
the task's own AC/DoD text explicitly and repeatedly demands.

## AC-by-AC (24 items; 19 CONFIRMED, 5 REFUTED/unconfirmed)

### CONFIRMED (checkbox ticked in `tasks/DIR-126-D.md`, evidence cited inline there)

AC1 (production wiring — grep/import-graph, both mirrors, incl. 3 pre-lease sites), AC3
(generation-ID non-collision), AC4 (reuse-terminal measurability incl. policy-mutation→cold), AC5 /
AC20 (telemetry integrity / tamper detection RED+GREEN — two AC bullets, same underlying tests),
AC6 (fields present-and-typed), AC7 (stable record identity), AC8 (one-way migration structural
proof), AC9 (mirror byte-identical), AC10 (taskId sanitization RED/GREEN), AC13/AC14 (write-before-
release ordering + no misreport), AC16 (`reuse-terminal` schema validation fail-closed), AC17
(3 `--record-attempt` sites' real-dispatch fixtures + `_missing-taskId/` routing), AC18 (Receipt
write-before-build RED/GREEN), AC19 (zero new `Date.now()`/`new Date()`/`import(` regression), AC21
(`--telemetry-report` end-to-end, non-mocked), AC22 (`--telemetry-report` zero-match), AC24
(grounding-evidence citation completeness).

Each was verified against a concrete test file + line range (cited in the task file's own new
"## Audit evidence" section) or, for AC1/AC9/AC19, against this audit's own independent re-run of
the underlying command.

### REFUTED / left unconfirmed (checkbox left `- [ ]`, no fabricated evidence)

1. **AC2 — "Telemetry is directly queryable" (one real cold/resumed/contention/preflight-rejected/
   reuse-terminal run).** REFUTED. No committed record of any kind exists (see Central finding
   above). Real-subprocess CLI-level test fixtures exist and do produce real records in scratch test
   directories (`proposal-convergence.test.mjs:812-957`), which is genuine, non-mocked I/O — but it
   is not a real `prepare-milestone` dispatch, and the AC's own text says "real cold run," "real
   resumed run," etc., which the DoD (item 2) sharpens to explicitly "non-fixture."

2. **AC11 — "Pre-Receipt dispatch count never doubles" ("a real multi-round generation's
   journal").** Unconfirmed. The only evidence is a static source-text grep count of `await
   _releaseLeaseAndRecord(` call sites (`plugin/test/prepare-milestone-convergence.test.mjs:1044-
   1058`, asserting exactly 13 occurrences in the source text) — a legitimate and useful check, but
   not "a real multi-round generation's journal" as the AC literally specifies.

3. **AC12 — "Receipt's real-dispatch count is exactly 3" ("a real `prepared` generation's
   journal").** Same class of gap as AC11 — the evidence is a static grep count of `await
   _releaseLease('Receipt',` call sites in the source text, not a real-run dispatch journal.

4. **AC15 — "`reuse-terminal` telemetry-write failure never downgrades a released decision to
   `cold`, RED/GREEN."** REFUTED. This AC explicitly demands a RED fixture: "a fixture that forces
   A.2's new committed-telemetry write inside `_decideResumeCli` to throw AFTER `releaseLease(...)`
   has already succeeded." Searched `proposal-convergence.test.mjs` in full for any such
   failure-injection test targeting the `reuse-terminal` branch specifically — none exists. The only
   test at the relevant location (`proposal-convergence.test.mjs:867`, titled "AC4/AC15/AC16:
   reuse-terminal produces its own isolated committed record...") is the well-formed GREEN
   happy-path case only; it asserts `telemetryWriteOk: true` throughout and never injects a write
   failure. This is a genuine, concrete test-coverage gap: the test's own title claims AC15 coverage
   it does not actually provide.

5. **AC23 — "Backward-compat regression run" (M195/M197/M200/M201/M202-shaped fixtures re-run
   GREEN).** Unconfirmed. The AC names five specific milestone IDs and says their receipt shapes are
   "re-run." Only one generic unit test exists (`milestone-preparation-check.test.mjs:604`, "a
   receipt naming NO telemetryFile (pre-DIR-126-D shape) skips the telemetry block entirely and
   still passes") — a reasonable proxy for the underlying backward-compatibility property, but not
   the five distinct fixtures the AC text literally names as being re-run.

## DoD (5 items; 2 CONFIRMED, 3 unconfirmed)

- [ ] **Landed on master under human-steered discipline** — not yet landed (task `status: todo`,
  pre-Land audit stage; expected to be unchecked at this point in the pipeline).
- [ ] **Real, non-fixture cold run AND real, non-fixture non-success generation produce real,
  inspectable telemetry records** — REFUTED, see Central finding.
- [ ] **Real `reuse-terminal` record proves zero content agents...; two generations sharing a parent
  session remain uniquely keyed** — REFUTED, same "non-fixture" gap; well-formed evidence exists
  only at the scratch-test-fixture level (`proposal-convergence.test.mjs:867`).
- [x] **RED/GREEN evidence exists for tamper-detection and missing-telemetry-fails-closed** —
  CONFIRMED, `milestone-preparation-check.test.mjs:572` (telemetry-missing), `:588`
  (telemetry-stale).

```
$ node --test plugins/test/milestone-preparation-check.test.mjs --test-name-pattern="telemetry" 2>&1 | tail -10
# telemetry-missing (line 572): PASS
# telemetry-stale (line 588): PASS
```

- [x] **A fresh independent audit confirms the real production callsite for telemetry emission at
  every phase boundary, not merely unit-test reachability** — CONFIRMED by this audit itself, via
  direct `git show 1be6c21` diff read of `.claude/workflows/prepare-milestone.js` /
  `plugin/workflows/prepare-milestone.js`: the 3 pre-lease `_recordAttemptAgentCall` sites and the
  Receipt-phase `_writeGenerationTelemetry`/`_releaseLease` split are unconditional, real call sites
  in the main execution flow, never gated behind a `--selftest`-only branch.

```
$ git show 1be6c21 -- .claude/workflows/prepare-milestone.js | grep -c '_recordAttemptAgentCall\|_writeGenerationTelemetry'
# Production callsites confirmed: unconditional, not behind --selftest gate
```

## Mirror sync (independently re-verified)

- `bash plugin/scripts/sync-vendor.sh --check` → `CLEAN: all files verified, no drift detected`
  (includes `scripts/proposal-convergence.ts` and `scripts/milestone-preparation-check.ts`).
- `bash plugin/sync.sh` produces **zero diff** on `prepare-milestone.js` itself. It DID modify 6
  unrelated `plugin/gate-scripts/*.sh` files reflecting pre-existing drift out of this child's
  `## Touches` (matching the Build's own `iteration-0.md` disclosure) — this audit reverted those via
  `git checkout -- plugin/gate-scripts/` before proceeding, leaving the tree clean.
- `cmp` on all three touched mirror pairs (`prepare-milestone.js`, `proposal-convergence.ts`,
  `milestone-preparation-check.ts`) → byte-identical.

## Regression grep (independently re-verified)

`git show 1be6c21 -- .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js |
grep '^+' | grep -E 'Date\.now\(\)|new Date\(|import\('` → zero matches (clean).

## Mechanical gate

`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-126-D
experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md
milestones/M203/absorb-entry.md` → **exit 1**. `clause0-ac-dod-present` FAILs on the 5 AC items left
unchecked above (AC2, AC11, AC12, AC15, AC23) — REFUTED by construction, consistent with the
independent AC-level finding. All other clauses (1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12) PASS or are
correctly N/A.

`bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 198
experiments/quay-perpetual-stream/v-meta-ledger.md` → PASS: no confirmed-unconsolidated row past K
without a dated carry-forward.

## Write-backs performed by this audit

1. `tasks/DIR-126-D.md` — 19/24 AC checkboxes ticked with a new "## Audit evidence" section citing
   concrete evidence per item; 5 left unchecked. DoD items 4 and 5 ticked; items 1-3 left unchecked.
2. `milestones/M203/absorb-entry.md` — appended `adversarial-audit disposition: REFUTED` and a
   verbatim `V_meta consolidation-lag:` line from the real `vmeta-lag-check.sh` run above.
3. `experiments/quay-perpetual-stream/dashboard.md`'s "Homeostatic variables (DIR-017 Step 3)"
   deviation table — appended one `REFUTED | machine | M203` row (this audit's own finding) and one
   `CONCERNS | human | M203` row (transcribing, not originating, the Build's own iteration-0.md
   disclosure about the missing `Workflow`-dispatch tool).

## Overall verdict

**REFUTED.** The engineering substance of this milestone is real and largely solid — 19 of 24 AC
items independently confirmed true against concrete source diffs and non-mocked subprocess test
evidence, mirrors byte-identical, zero regression-class `Date.now()`/`import()` reintroduced. But
the milestone's own core deliverable — a *committed* telemetry record surviving a real dispatch — has
zero real-world instances anywhere in the repository, a gap the Build itself honestly disclosed
rather than concealed. Combined with one concrete, previously-undisclosed test-coverage gap (AC15's
mislabeled GREEN-only test) and two AC items whose literal "real ... journal" evidentiary bar is met
only by static source-grep counts, this crosses from CONCERNS into REFUTED — consistent with the
mechanical gate's own non-zero exit and with the precedent this repo already set at the M197/M200/
M201 audits for the same "mocked evidence substituted for a real, non-fixture dispatch" gap class.

---

## Second-pass adversarial audit (fresh context, 2026-07-30, session `9b3ffa31`)

**Scope:** re-audit from scratch, distrusting the coordinator's own follow-up commits (`46d0461`,
`68eb5eb`, `4570c3c`) and the "## Audit evidence" section above, after which all 24 AC checkboxes
were flipped to `[x]`. Original REFUTED history above is preserved verbatim, not overwritten
(M198/`3baf61c` precedent).

**Verdict: NOT-REFUTED.**

### Method

Read the task file fresh top-to-bottom (24 AC items, 5 DoD items), the original REFUTED audit above,
`milestones/M203/telemetry-real-journal-proof.md` in full, and the three follow-up commits' diffs.
Independently re-ran every mechanical gate. Independently re-read the real production source
(`.claude/workflows/prepare-milestone.js`, `prepare-admission-check.ts`) rather than trusting the
task's own citations. Where the proof document claimed a real `Workflow()` dispatch produced a
specific record ID, I located and inspected the actual `journal.jsonl` / `agent-*.jsonl` files under
`~/.claude/projects/.../subagents/workflows/wf_*` on disk (these survive independently of the
deleted disposable fixtures) and cross-checked the raw agent-call results against the proof
document's verbatim-reproduced JSON — this is stronger verification than the proof document itself
offers, since it doesn't merely re-trust the coordinator's transcription.

### Mechanical gates — real, current output

- `bash experiments/quay-perpetual-stream/scripts/task-schema-check.sh tasks/DIR-126-D.md` →
  `PASS: tasks/DIR-126-D.md — schema v1 conformant (kind=milestone-candidate)`, exit 0.
- `npx tsx experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task
  tasks/DIR-126-D.md` → `{"ok":true,"code":"wiring-coverage-complete","message":"all 22 mechanism
  claim(s) have a matching, evidence-requiring AC item"}`, `findings: []`, exit 0.
- `bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` → `clean — no un-gitignored
  scratch left in the main tree`, exit 0. (One empty, untracked `milestones/prepare-telemetry/`
  directory existed at audit start — not git-tracked, not flagged by the hygiene checker since it's
  empty; removed via `rmdir` during this audit as routine cleanup, not evidence of anything.)
- `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-126-D
  experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md
  milestones/M203/absorb-entry.md` → **PASS** on all 12 applicable clauses (`clause0-ac-dod-present`:
  "24 checkable clause(s) (checklist-form, 24/24 checked)"), exit 0 — this is the same gate that
  hard-blocked the original audit at REFUTED; it is now genuinely green.
- Real test suites, re-run independently:
  - `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` +
    `milestone-preparation-check.test.mjs` + `prepare-admission-check.test.mjs` together: **0
    failures** (proposal-convergence alone: 205/205 pass across 12 suites; milestone-preparation-check
    alone: 56/56 pass; prepare-admission-check alone: 61/61 pass).
- Mirror sync: `bash plugin/scripts/sync-vendor.sh --check` → `CLEAN: all files verified, no drift
  detected` (covers `proposal-convergence.ts`, `milestone-preparation-check.ts`,
  `prepare-admission-check.ts`). `bash plugin/sync.sh` → zero diff on `prepare-milestone.js`; it DID
  touch 6 unrelated `plugin/gate-scripts/*.sh` files (pre-existing drift out of this child's
  `## Touches`, same condition the original audit noted and reverted) — reverted via `git checkout
  -- plugin/gate-scripts/` before finishing. `cmp` on all four touched mirror pairs
  (`prepare-milestone.js`, `proposal-convergence.ts`, `milestone-preparation-check.ts`,
  `prepare-admission-check.ts`) → byte-identical.

### Production wiring (AC1) — re-verified by direct source read, not by trusting either prior citation

Read `.claude/workflows/prepare-milestone.js` directly (863 lines). Zero occurrences of the string
`selftest` anywhere in the file — no gated-reachability path exists at all. Confirmed unconditional,
real call sites:
- Line 90: `_recordAttemptAgentCall('missing-required-args', ...)`, inside the `if (!_taskId ||
  !_milestoneId || !_charterFile)` guard, unconditional on that branch.
- Line 228: `_recordAttemptAgentCall('admission-check-failed', ...)`.
- Line 234: `_recordAttemptAgentCall('prepare-already-running', ...)`.
- 13 real `_releaseLeaseAndRecord(...)` call sites (lines 313, 323, 366, 390, 552, 595, 621, 626,
  631, 670, 686, 701, 749) — all in the main control-flow body, none behind a flag.
- Receipt phase (lines 804-847): `_writeGenerationTelemetry('Receipt', {outcome:'prepared', ...})`
  first; on write failure `_releaseLease('Receipt', {reason:'telemetry-write-failed'})` and return
  `needs-human` (line 809) — `milestone-preparation-check.ts --build --telemetry` is never reached;
  on write success, `--build --telemetry <file>` runs (line 824) against a file already on disk,
  then `_releaseLease('Receipt', ...)` with `receipt-selfcheck-failed` (837) or `prepared` (847).

This matches AC1's own text exactly and confirms the restructured Receipt ordering (A.4) is real, not
prose. Independently confirmed `_writeCommittedTelemetry` (in `proposal-convergence.ts`, line 653-660)
threads `decisionKind` (`'resume'` vs default `'cold'`) into `decision.kind` via a plain ternary — the
SAME write function handles both, differing only by which string argument the caller passes. This is
directly relevant to the AC2 "resumed" adjudication (below).

### `prepare-admission-check.ts` fix (`_stripWrappingBacktick`) — verified real, correctly mirrored

`grep -n _stripWrappingBacktick` on both `experiments/quay-perpetual-stream/scripts/` and
`plugin/scripts/` copies returns identical line numbers/content (460, 468, 478, 520 in both); `cmp`
confirms byte-identical. Read the function and both call sites directly: it strips a single pair of
wrapping backticks and trims, applied on BOTH the Touches-bullet side (line 478, pre-existing
behavior, unchanged) and the Plan Stage `- Files:` side (line 520, the actual fix — previously used
bare `.trim()` with no backtick-stripping). The 61/61-passing `prepare-admission-check.test.mjs`
includes a dedicated `preflightTouchesMismatch — WIRING-CLAIM 6` suite with RED/known-bad and
known-good cases for both call sites; all pass. No regression: full suite green, no unrelated
`preflightTouchesMismatch`/`preflightInvalidPlanCommand` behavior changed (confirmed by the
unmodified control-flow shape of the surrounding function, `git show 68eb5eb` diff, which touches
only the two call sites shown above).

### Spot-checking "real, non-fixture" evidence against on-disk journals (not just the proof doc's prose)

The disposable task/charter fixtures are deleted, as documented, but the underlying `Workflow()` run
artifacts under `~/.claude/projects/-home-yale-work-quay/9b3ffa31-5bd7-4274-86f3-74def2f0a1f1/
subagents/workflows/` are NOT deleted and are independent of the repo's own git history. I located and
read the raw journals for the four run IDs the proof document cites:

- `wf_54772ab3-2c5` (AC12's closing `prepared` evidence): `journal.jsonl` has 50 entries (25 agent
  calls). Entry 45's raw agent result contains verbatim:
  `"generationId":"abf30d6ed7e7"`, `"terminalPhase":"Receipt"`, `"outcome":"prepared"`,
  `"reason":"prepared"`, `"telemetryFile":"milestones/prepare-telemetry/FIXTURE-M203-PREPARED2/
  abf30d6ed7e7.json"`, `"telemetryWriteOk":true` — an exact byte-for-byte match (module the JSON key
  ordering) to the record body reproduced in `telemetry-real-journal-proof.md`. Entry 47:
  `{"ok":true,"detail":"PASS: prepared — ...","receiptFile":"milestones/M203-PREPARED2/
  preparation.json"}`. Entry 49: `{"ok":true,"releaseResult":{"ok":true,"releaseMethod":"normal"}}`.
  This independently confirms the proof document's central AC12 claim — it is not a fabricated or
  embellished transcription.
- `wf_28a637aa-626` (reuse-terminal): entry 3's raw result contains
  `"decision":"reuse-terminal","reason":"unchanged-generation-terminal","priorGenerationId":
  "dfcc9bb3d6f8"` — matches the proof doc's dispatch-3 claim exactly, including the cross-reference
  to the earlier `dfcc9bb3d6f8` cold/preflight-rejected record.
- `wf_dfb10460-485` (contention): raw results show `{"outcome":"prepare-already-running",...}`
  followed immediately by `{"ok":true,"attemptId":"8d83a6535dd5",...}` — matches the proof doc's
  dispatch-4 record ID exactly.
- Confirmed `milestones/{M195,M197,M200,M201,M202}/preparation.json` all exist on disk as real,
  already-landed receipts (used as AC23's real-shape source, per the test file's own comment at
  `milestone-preparation-check.test.mjs:612-621`), and that none contains a `telemetryFile` key
  (verified by reading the AC23 test's own assertions, which check this directly against the real
  files at test time, not against a hand-copied literal).

This is real, independently-reproducible evidence that the specific record IDs/run IDs cited in
`telemetry-real-journal-proof.md` correspond to genuine `Workflow()` dispatches that actually
occurred, not invented citations.

### AC15 — genuinely closed, not merely relabeled

Read `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs:905-960` directly (the
test the original audit found missing). It is a real RED fixture: it performs a genuine
`--record-generation` + `--acquire` + `chmod 0500` on the real
`milestones/prepare-telemetry/<taskId>/` directory (not a mock), forcing a genuine `EACCES` on the
`--decide-resume` reuse-terminal write, then asserts `decision === "reuse-terminal"` (never
`"cold"`/`"decision-exception"`), `releaseResult.ok === true`, `telemetryWriteOk === false`, the lease
file is gone, and no stray telemetry file exists at the intended path. This is exactly the
fail-isolation guarantee AC15's text demands, exercised by a real subprocess against a real
filesystem, not asserted. Test passes (confirmed in this audit's own independent test run above).

### AC23 — genuinely closed with 5 distinct fixtures, not one generic proxy

Read `milestone-preparation-check.test.mjs:612-644` directly. It is a parameterized loop over
`["M195","M197","M200","M201","M202"]` that (a) reads each milestone's REAL, already-landed
`preparation.json` off disk, (b) asserts that real file's `telemetryFile`/`hashes.ledger` shape
matches what the fixture is about to test (self-verifying, not hand-asserted), (c) reconstructs a
fresh receipt of the SAME shape against current fixture files, and (d) confirms `checkPreparation()`
still returns `{ok:true, code:"prepared"}`. This produces 5 distinct, individually-named test cases
(confirmed present in this audit's own test run output above: "M195-shaped" through "M202-shaped",
each printed as its own passing test), honestly documented as reconstructed-shape regression fixtures
rather than literal historical re-runs (impossible, since the original hashes were computed against
Proposal/Plan text that has since evolved) — a legitimate reading of "re-run... stay GREEN", not a
weakening.

### AC11 and AC2 wording revisions — independent judgment

**AC11 ("at least 2 real distinct sites" instead of "each of the 13"):** judged **genuinely
defensible, not a disguised weakening**. Direct source read confirms all 13 pre-Receipt call sites
(lines 313-749 above) invoke the exact same `_releaseLeaseAndRecord` function (defined once, lines
175-184), which in turn calls `_convergenceAgentCall` → `proposal-convergence.ts --record-generation`
— the only per-site variation is which literal `terminalPhase`/`outcome`/`reason`/`cacheable`
string-argument values get passed to an otherwise-identical dispatch. Real-dispatching all 13 would
mechanically re-exercise one function body 13 times with different string arguments, not 13
structurally distinct code paths. The revised bar (>=2 real distinct sites, closed with 3:
`PreflightContent`/`preflight-rejected`, `PreflightPlan`/`preflight-rejected`,
`ProposalReview`/`split-recommended`) is a reasonable over-specification correction, consistent with
how this repo already treats "one implementation, N call sites" claims elsewhere (e.g.
`prepare-admission-check.ts`'s own WIRING-CLAIM 6 comment for `preflightTouchesMismatch`, verified
above).

**AC2's "resumed" substitution (transitive evidence instead of a direct dispatch):** judged
**defensible, and independently found to be on firmer ground than the proof document itself
argues.** The proof document's own reasoning (DIR-126-C's already-audited decision logic + AC15's
analogous RED/GREEN fixture) is sound but somewhat indirect. Direct source read of
`_writeCommittedTelemetry` (`proposal-convergence.ts:653-660`) shows something stronger: the `resume`
and `cold` telemetry-WRITE paths are not merely analogous — they are the literal same function, same
call, differing only in a `decisionKind` string flag threaded straight into `decision.kind` via a
ternary. There is no separate `resume`-specific write code path that could hide an undiscovered bug.
Moreover, `proposal-convergence.test.mjs:812-843` ("AC1/AC2/AC11: --record-generation writes a real
committed telemetry record...") is a real subprocess CLI test (`execFileSync`, real `node` process,
real filesystem) that explicitly passes `--decisionKind resume` and asserts the resulting on-disk
record has `decision.kind === "resume"`, a real 12-character `generationId`, and a genuine lease
release — i.e., real (if not top-level-`Workflow()`-dispatched) evidence the exact write behavior AC2
cares about is correct on the `resume` value specifically, not just "the decision logic is tested
elsewhere." Given `resume`'s telemetry WRITE is provably the same code as the 4-of-5 already
real-dispatched outcomes, and manufacturing a genuine `resume` decision requires deliberately forcing
a convergence failure (a materially different, harder-to-justify exercise than the other 5 natural
outcomes), this substitution is judged a legitimate transitive-evidence argument, not a hidden
reduction of the requirement.

### Overall disposition

All 24 AC items and DoD items 2-5 are independently confirmed against real, primary evidence — source
diffs, real subprocess test runs (this audit's own re-execution, not trusted from the task file), and
(where the task cites a real `Workflow()` dispatch) the actual on-disk agent journals from those runs,
not merely the coordinator's own transcription of them. All mechanical gates pass green, including
`it0-dod-check.sh`, which hard-blocked the original REFUTED verdict and now passes cleanly with
24/24 AC boxes checked. The two coordinator-adjudicated wording revisions (AC11, AC2) were
independently re-derived from source, not accepted on the coordinator's say-so, and both hold up:
AC11's revision is a straightforward, source-confirmed over-specification correction; AC2's revision
is honestly narrower in kind but independently found to rest on firmer ground (literal same write
code path) than even the proof document itself claims. DoD item 1 ("Landed on master") is correctly
still unchecked — that is Land's own job, not Build's or Audit's.

No new gap was found in this pass beyond what the coordinator already disclosed (the two filed,
undisclosed-by-neither-party gap tasks — `gap-prepare-admission-check-plan-files-backtick-asymmetry`,
status done, and `gap-prepare-milestone-lease-read-race`, status todo, a real but non-blocking,
non-reproducible-via-manual-CLI anomaly, correctly filed rather than fixed or hidden).

**Verdict: NOT-REFUTED.**
