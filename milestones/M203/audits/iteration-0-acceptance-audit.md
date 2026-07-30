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
- [x] **A fresh independent audit confirms the real production callsite for telemetry emission at
  every phase boundary, not merely unit-test reachability** — CONFIRMED by this audit itself, via
  direct `git show 1be6c21` diff read of `.claude/workflows/prepare-milestone.js` /
  `plugin/workflows/prepare-milestone.js`: the 3 pre-lease `_recordAttemptAgentCall` sites and the
  Receipt-phase `_writeGenerationTelemetry`/`_releaseLease` split are unconditional, real call sites
  in the main execution flow, never gated behind a `--selftest`-only branch.

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
