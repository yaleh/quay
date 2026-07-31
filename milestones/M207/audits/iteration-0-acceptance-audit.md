# M207 Iteration-0 Acceptance Audit — gap-dir126d-deferred-phase-timing-recurrence-tracking

**Audit session id:** 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1

**Audit posture:** adversarial / refute-first. Fresh context — no prior exposure to this build.
**Date:** 2026-07-31 · **Build under audit:** dc3d6c4 (HEAD of `master`) · **Milestone root:**
`milestones/M207` (via `gate_resolve_milestone_root 207`)

## Verdict: REFUTED

11 of 12 Acceptance Criteria and both DoD bullets were independently confirmed from concrete
artifacts (own test runs, own real-CLI executions, own greps/cmps/A-B runs) — not from the
implementer's self-report. **One AC could not be confirmed and was positively REFUTED**: AC6's
negative enforcement sub-assertion (CLAIM C9). The mechanical gate (`it0-dod-check.sh`) exits 1
(clause0 HARD-block on the one unchecked AC item — mechanically consistent with this verdict).
Per the audit rule "any AC you cannot confirm → REFUTED", the verdict is REFUTED.

---

## 1. The refutation (AC6 / CLAIM C9 / charter Done-when)

**AC6's negative enforcement sub-assertion claims:** "a grep over `proposal-convergence.ts`
confirms `validateTelemetryRecord` has exactly ONE live call site … and that NO call site
validates a disk-read / historical record — i.e. enforcement is write-time only and nothing
re-validates committed telemetry history, so widening `REQUIRED_TOP` is forward-only-safe
(verified by the grep, not merely asserted in prose)."

**Refutation — the grep scope misses a live disk-read validator.** Repo-wide grep:
`milestone-preparation-check.ts:287` calls `validateTelemetryRecord(rec)` over every record its
`computeCapacityReport` walks off disk (import at :26). That mode LANDED at M204/DIR-126-E
(commit `23f8891`, "land --capacity-report aggregation; regenerate throughput doc §4 from real
telemetry") — a production consumer that predates this build and is OUT of the AC's
`proposal-convergence.ts`-only grep scope. Within `proposal-convergence.ts` the one-live-call
claim holds (:718, reuse-terminal branch) — the fixture encoding that grep
(`proposal-convergence.test.mjs` "AC6/C9 mechanical") passes for exactly the reason it is too
narrow.

**Refutation — empirical A/B on the SAME committed archive (own runs, read-only):**

| run | result |
|---|---|
| `dc3d6c4~1` worktree, `--capacity-report --workspace <real repo>` | `code: ok`, `sampleCount: 31`, telemetry exclusions: **none** |
| `dc3d6c4` (HEAD), same command, same archive | ALL **27** telemetry records excluded as `telemetry-field-missing` ("telemetry record is missing required field 'phaseTimings'"); telemetry population **0**; `code: insufficient-samples` |

The `REQUIRED_TOP` widening therefore retroactively invalidates every pre-M207 record in the
capacity report's population — the exact "re-validate-all sweep" the task's own Risks section
claimed could only happen in the FUTURE ("forward-only-safe TODAY"). It is not forward-only-safe;
it is backward-breaking today for this landed consumer.

**Knock-on violations confirmed by the same evidence:**
- **Charter Done-when** ("existing consumers of DIR-126-D's own telemetry-record schema are
  unaffected by the additive extension (no shape becomes stricter, no existing field
  renamed/removed)"): the shape DID become stricter for `computeCapacityReport` — 31 → 0
  historical telemetry samples.
- **Landed code comment is false as written:** the new REQUIRED_TOP latent-trap comment claims
  "NOTHING re-validates committed history and every pre-M207 record lacking both keys stays valid
  forever" — empirically false the moment the commit landed.
- **Design rationale for `schemaVersion`-stays-2** ("nothing re-validates history, so no
  forward-compat hazard forces a bump") rests on the same false premise. (A bump alone would not
  fix it either — the validator does not branch on version; the real fixes are version-aware
  validation, a pre-M207-schema skip in the capacity report analogous to this task's OWN
  `_scanPriorTelemetryRecords` skip rule, or un-widening REQUIRED_TOP.)

**AC6 disposition in task write-back:** left `- [ ]` with full evidence citation. Its POSITIVE
half (validator fails closed with `telemetry-field-missing` for either missing key — direct unit
test `proposal-convergence.test.mjs:1164`) IS confirmed green; the item as a whole is
unconfirmable.

---

## 2. AC satisfaction — the 11 confirmed items (refute-first, own evidence)

- **AC1 — additive `nowMs`; zero new sandbox clock sites:** CONFIRMED. Admission fixtures 74/74
  via `scripts/test.sh` AND direct `node --experimental-strip-types --test` on the experiments
  mirror; AC19 comment-stripping guard (`plugin/test/prepare-milestone-convergence.test.mjs:1124`)
  green ×2 mirrors; own grep: zero LIVE `Date.now()`/`new Date(`/`import(` in both workflow
  mirrors (3 comment-only mentions). Diff shows `main()` reuses the single `const now`
  (:681) — zero new `Date.now()` sites in the admission CLI.
- **AC2 — renewal-bounded dispatch/entry equality on a multi-round generation:** CONFIRMED on the
  AC's own operative sentence ("The fixture asserts equality on this renewal-bounded metric").
  `prepare-milestone-convergence.test.mjs:1195` drives the REAL workflow file through a full
  generation incl. a `ProposalReview-delta-round-1` and `PlanCheck-round-1` renewal, and asserts
  `spans.length === admissionRenews + 1` (= 7), acquire-seed (`startedAtMs === 500`), span
  contiguity, caller-owned round values, and the trailing `endedAtMs: null`. Green ×2 mirrors.
  Noted reading clarification (not a refutation): acquire seeds `_lastBoundaryMs` but pushes no
  entry by documented design (no prior boundary to pair), so entry-producing boundaries (6
  renewals + terminal close = 7) equal the entry count exactly; the AC's prose counting acquire
  among "dispatches" is satisfied on the renewal-bounded metric the AC itself mandates. The
  end-to-end real-dispatch journal equality is Plan Stage 9, explicitly deferred to Land by Plan
  design (same structure as the DIR-126-D/M203 precedent).
- **AC3 — `findingCodes[]` recurrence pin/advance:** CONFIRMED. `proposal-convergence.test.mjs`
  :1200 (two generations: recurrenceKey stable, firstSeen PINNED, lastSeen ADVANCES), :1228
  (attemptId-keyed sub-case), :1247 (corrupt/pre-M207 siblings skipped; local helper) — 97/97
  green. ALSO reproduced by this audit's own real-CLI runs (§4 below) against a copy of the real
  committed archive.
- **AC4 — mirror parity:** CONFIRMED. Own run: `cmp` byte-identical for all three edited pairs
  (both `.ts` scripts + the workflow); `plugin/scripts/sync-vendor.sh --check` → "CLEAN: all
  files verified, no drift detected", exit 0.
- **AC5 — recurrence scan local, zero new import edges:** CONFIRMED. Own grep: the 4
  `milestone-preparation-check` mentions in both `proposal-convergence.ts` mirrors are ALL
  comments (:8/:14/:172/:333); `git diff dc3d6c4~1 dc3d6c4` shows zero import-line changes;
  `_telemetryDir` reuses `telemetryPath` via probe-record dirname.
- **AC7 — `round` threaded explicitly, never label-parsed:** CONFIRMED. Source-guard fixture
  `:1340` (comment-stripped) asserts exactly 6 `_renewLease(label, round)` sites, round ∈
  `/^(0|_deltaRound|_planCheckRound)$/`, NEGATIVE asserts against `stageLabel` parsing/RegExp,
  and the exact push rule `v.ok === true && Number.isFinite(v.nowMs)` via `_parseAgentJson`.
  Green ×2 mirrors.
- **AC8 — missing/unparseable `nowMs` fail-soft:** CONFIRMED. Fixtures :1240 (success renewal
  WITHOUT nowMs pushes nothing, `_lastBoundaryMs` unchanged) and :1253 (ok:false renewal that
  CARRIES nowMs pushes nothing — the rule is success AND finite). Green.
- **AC9 — receiver-side trailing close (CLAIM C5):** CONFIRMED. `proposal-convergence.test.mjs`
  :1181 real-CLI fixture asserts filled `endedAtMs === recordedAtMs` exactly; sender-half source
  guard `:1362` asserts both record-writing helpers thread both flags while `--release-only`
  gains nothing. ALSO confirmed by audit's own real run (§4): `1785456654605 === 1785456654605`.
- **AC10 — all 7 pre-ledger/pre-lease terminals produce non-empty `findingCodes[]`:** CONFIRMED.
  TDZ fixture :1267 (pre-ledger exit yields `[reason]` with NO ReferenceError — the `_ledgerLive`
  short-circuit, verified against the `_ledger?.map` anti-form) + :1292 (all 3 pre-lease
  `--record-attempt` sites non-empty, `phaseTimings []` by construction). Green ×2 mirrors.
- **AC11 — all six CLI modes carry `nowMs` on success AND error paths, keys preserved:**
  CONFIRMED. Admission fixtures :761-892 individually cover acquire (success/contention/
  missing-session-id), renew, release, force-release (success + lease-missing error each),
  preflight + preflight-plan (success + error + exact `{ok, policyVersion, findings}` key-set
  preservation), and the catch-all. 74/74 ×2 mirrors. Own source read confirmed the spread is
  non-clobbering; the one non-JSON path (force-release missing-reason) prints to `console.error`,
  not a JSON verdict — consistent with the design.
- **AC12 — exhaustive identifier grounding:** CONFIRMED (spot-checked). On the current tree:
  `missing-now: a real epoch-ms` literal (×1), all 6 `_renewLease` call sites with caller-owned
  rounds (:445/:480/:653/:714/:795/:831), `MAX_PLANCHECK_ROUNDS = 3`, `_parseAgentJson` (×8),
  AC19 fixture citing `f6db2a8`/`7357a91`, `--release-only` (×3) — all real. CAVEAT recorded in
  the write-back: the "sole enforcement point" identifier framing is false repo-wide (see §1).

## 3. DoD satisfaction

- **Landed on `master` under human-steered discipline:** CONFIRMED. `dc3d6c4` IS `HEAD` of
  `master`; `git merge-base --is-ancestor dc3d6c4 master` true; touches both
  `prepare-admission-check.ts` mirrors; charter labels the milestone human-steered.
- **Real, non-fixture evidence (fresh independent audit confirms the real production callsites):**
  CONFIRMED for both callsites by THIS audit's own real-CLI executions (§4). CAVEAT: the
  end-to-end real-dispatch journal (Plan Stage 9) is deferred to Land by Plan design.
- **Charter Done-when** (existing schema consumers unaffected): **VIOLATED** — see §1. This is
  the charter-level counterpart of the AC6 refutation and is not a task-file checkbox.
- **Inherited-core standard clauses:** mechanical gate clauses 1-12 all PASS/legitimately N/A;
  clause0 HARD-blocks on the one unchecked AC (exit 1) — consistent with REFUTED.

## 4. Own real-CLI evidence runs (non-fixture, audit-generated)

Scratch workspace seeded with a COPY of the real committed archive
(`milestones/prepare-telemetry/gap-dir126d-.../`, 5 pre-M207 records incl. genuinely recurred
`split-recommended`), real charter, real task body; real CLIs from `HEAD`:

1. `prepare-admission-check.ts --acquire` → `{"outcome":"acquired",…,"nowMs":1785456570332}` —
   real phase-timing self-report callsite, production shape.
2. `--renew --stage Adjudicate` → `{"ok":true,…,"nowMs":1785456570699}`.
3. `--preflight` → `{ok:true, policyVersion, findings, nowMs}` — existing keys survive.
4. `proposal-convergence.ts --record-generation` with real `--phaseTimings` (trailing
   `endedAtMs:null`) + `--findingCodes '["prepared","split-recommended","audit-probe-fresh"]'`
   → committed record `4f6aa41bb495` with 21 keys, `schemaVersion: 2`, trailing span closed with
   the receiver's OWN `recordedAtMs` (`1785456654605 === 1785456654605`), `telemetryWriteOk:
   true`; all 5 real pre-M207 siblings individually skipped by the scan (by design — no
   `findingCodes` array), yielding honest first-occurrence quads.
5. Second real `--record-generation` with recurring `split-recommended` → record
   `72af725059ab`: recurrenceKey STABLE (`f7bc72448be9`), `firstSeenGeneration` PINNED to
   `4f6aa41bb495`, `lastSeenGeneration` ADVANCED to `72af725059ab` — real recurrence read over
   real committed history.
6. INCIDENTAL fail-soft proof: an earlier run with double-encoded (malformed) flag values
   persisted the primary write with defaulted `phaseTimings: []`, `ok:true`, no throw — CLAIM
   C10's degradation posture observed in the real CLI, not just the fixture.
7. A/B capacity-report runs (§1 table): `dc3d6c4~1` vs `dc3d6c4` on the identical archive.

## 5. Secondary observation (NOT verdict-determining)

Full `scripts/test.sh` under `--test-concurrency=8` load timed out exactly 3 spawn-heavy M52
`delivery-standalone-smoke` tests (60.5s/79.2s/60.3s — at/over the 60s gate-runner envelope).
All 3 pass in isolation at HEAD in 9-13s (`scripts/test.sh packages/quay/test/delivery-
standalone-smoke-gate.test.mjs` → 7/7 green). This is the same environmental load-boundary class
the build itself disclosed repairing in `build-dist-smoke.test.mjs` (poll window widened
40→100, no assertion change — verified as disclosed), and M207 touches no gate code path
(`delivery-standalone-smoke.sh` is product-side). Not M207-caused; recorded for honesty because
a naive "full suite green" claim is load-contingent on this machine.

## 6. Disclosed incidental repairs — verified as disclosed

- `plugin/test/prepare-milestone-convergence.test.mjs` R9 pin closed from open-ended
  `480cb58..HEAD` to `480cb58..68eb5eb^`: verified — closed-range diff is EMPTY (exit 0), and
  `68eb5eb` is indeed the first post-base commit (DIR-126-D) to touch the file. Legitimate
  fix-the-source repair of a permanently-red historical pin.
- `packages/quay/test/build-dist-smoke.test.mjs`: diff matches the disclosure (40→100 ×150ms
  poll, comment added, zero assertion change). Out-of-Touches but minimal and disclosed.

## 7. Write-backs performed by this audit

- Task file: 11 ACs + 2 DoD items ticked `- [x]` with per-item evidence citations; **AC6 left
  `- [ ]`** with the full refutation note.
- `milestones/M207/absorb-entry.md`: `adversarial-audit disposition: REFUTED` + full rationale +
  `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated
  carry-forward` (verbatim from `vmeta-lag-check.sh --counter 200`, exit 0).
- `dashboard.md` DIR-017 deviation table: one REFUTED/machine/M207 row (this finding), status
  open, age 0.
- Mechanical gate: `it0-dod-check.sh … → exit 1` (clause0-ac-dod-present HARD-block on the
  unchecked AC6 item; clauses 1-12 PASS/N/A).
- This audit artifact staged (`git add`) per DIR-M176.
