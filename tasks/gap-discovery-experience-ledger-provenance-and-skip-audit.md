---
id: gap-discovery-experience-ledger-provenance-and-skip-audit
title: "Experience ledger: worker-written entries labelled user, no author
  field, and 5 filtered outcomes leave no per-record trace"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
Production acceptance check, 2026-10-12, of `.quay/discovery-experience-ledger.jsonl` (118 entries: 116 `system`, 2 `user`) against `.quay/architecture-evidence-store.jsonl` (121 outcomes).

1. **False user provenance.**
   - The 2 `reported_by:"user"` entries are `experience-5e20efdfaaf99116` (`EXP-carriers-ephemeral-in-worktree`) and `experience-2519951c56dc2990` (`EXP-post-gate-write`). Both were written by a task worker, carry a synthetic `ts` of `2026-10-12T00:00:00.000Z`, and describe a defect the worker itself found. No human reported them.
   - Meanwhile the one genuinely user-reported case, the Probe/Meta coupling the user pointed out before any tool ran, is ABSENT from the production ledger. It only ever existed in a since-destroyed worktree.
2. **Unauditable gap.**
   - The 5 outcomes without a ledger entry are store lines 9/18/28/40/49 (`outcome-9e6d7e295cbee878`, `-3d9cbb30bb825059`, `-44479971ff16fdac`, `-65c8177059358730`, `-1d5faf3428b4ecff`). All have `verdict:"proposed"` (ownership-active loop).
   - `ingestNewOutcomes` filters them (`docs/analysis/discovery-experience-ledger.mjs`, around line 1098: `if (!d.ok) { skipped++; ... continue; }`). It only increments `skipped_not_ingestible`; there is no per-record trace of what was skipped or why, and no way to re-evaluate when the mapping changes.
3. **No author on entries.** Every entry lacks an `authored_by`, so a worker-written entry cannot be told apart from a driver-ingested one.

## Plan
1. **`authored_by` is required on every new Experience:** `{actor: "ingester" | "task-worker" | "operator-session", ref: <task id | session id | "ingestNewOutcomes">}`.
2. **`reported_by:"user"` needs `user_provenance`:** `{kind: "conversation" | "task-body", ref, quote}`, where `quote` is ≥20 chars of the human's own words. Without it ⇒ `USER_PROVENANCE_MISSING`.
   - A write from a task-worker process with `reported_by:"user"` is always refused (`USER_SOURCE_FROM_WORKER`). Detect the worker via an explicit `authored_by.actor`; an absent actor is refused for `user`.
3. **Correct the two existing entries append-only:** write a `kind:"experience-correction"` record per entry, setting `reported_by:"system"` and `authored_by:{actor:"task-worker"}`, with the reason. Readers apply corrections. Never rewrite or delete the original lines.
4. **Per-record skip ledger:** `.quay/discovery-ingest-skips.jsonl`, with `{store_line, outcome_id, verdict, reason_code, mapping_version, ts}` for every outcome not ingested. Reason codes:
   - `VERDICT_NOT_INGESTIBLE:<verdict>`
   - `DUPLICATE_SOURCE_REF`
   - `READ_FAILED` (transient)
   - `MALFORMED`

   Recording rules:
   - Dedup skip records on `(outcome_id, reason_code, mapping_version)`.
   - `READ_FAILED` records are retried on the next round, and the watermark does not advance past them.
   - When the verdict→role mapping version changes, previously skipped `VERDICT_NOT_INGESTIBLE` records are re-evaluated.
5. **One-time backfill:** record a skip entry for each of the 5 existing gaps, using the real store lines. This makes `ingested + skipped == outcomes scanned` hold, and checkable.
6. **The genuine Probe/Meta user case:** the operator session (not a worker) ingests it with `user_provenance` quoting the user's own message.
   - The user message is in session `e6db01fa-cceb-44f2-8b83-02f868644460`; locate it with `grep` on that session's jsonl under `~/.claude/projects/-data-home-yale-work-quay/`.
   - The worker of this task must NOT perform this write. It only builds the path and leaves an operator command in the task body. That AC is marked （待外部）.

## Implementation notes (where the Plan's rules live in code)
- `mapping_version` is **derived** (`verdictRoleMappingVersion()` = a digest of `VERDICT_ROLE`), not a literal anyone must remember to bump. A hand-maintained version string would make "re-evaluate the skips when the mapping changes" a memory obligation whose failure mode is silent: the map changes, the version does not, and the stale skips stay invisible while every check reports green. Because it is derived, Plan item 4's third recording rule is a property of the DATA.
- The **rewind** is what makes that rule do anything: `ingestNewOutcomes` starts at `min(watermark, earliest stale VERDICT_NOT_INGESTIBLE skip line, earliest READ_FAILED skip line)`. Without it the version would be decorative — the watermark sits past those lines, so they would never be looked at again.
- The **`READ_FAILED` seam** is `opts.readLine`, and its status is stated plainly in the module: on the production path the store has been read whole before the scan, so a per-line read cannot fail there. The seam exists so the retry contract is exercisable, and the AC that requires it says "simulated". It is **not** claimed as a production measurement — AC2 and AC3 below are, and they read the real carriers.
- `backfillIngestSkips` reports a third answer, `unexplained`, for an **ingestible outcome with no entry**: that is a finding that was LOST, and filing it as a skip would shape "we lost this" exactly like "we chose not to take it". `ingested + skipped + unexplained == scanned` therefore holds by construction, with all three terms as lists of named records.
- A correction may patch **only** `CORRECTABLE_FIELDS` (`reported_by`, `authored_by`). One able to patch `summary`/`evidence` would be a supported way to rewrite what was found — the thing "never rewrite the original lines" forbids.

## Acceptance Criteria
- [x] `node --test plugin/test/discovery-experience-ledger.test.mjs` exits 0, with new cases:
  - (a) a new Experience without `authored_by` is refused;
  - (b) `reported_by:"user"` without `user_provenance` ⇒ `USER_PROVENANCE_MISSING`;
  - (c) `reported_by:"user"` with `authored_by.actor:"task-worker"` ⇒ `USER_SOURCE_FROM_WORKER`;
  - (d) a correction record changes what readers report, and the original line stays byte-identical;
  - (e) a `proposed` outcome yields one skip record with `VERDICT_NOT_INGESTIBLE:proposed`, and a second round adds none (dedup);
  - (f) a simulated `READ_FAILED` holds the watermark and is retried and ingested on the next round;
  - (g) bumping `mapping_version` re-evaluates earlier `VERDICT_NOT_INGESTIBLE` skips.

  **Evidence — `node --test plugin/test/discovery-experience-ledger.test.mjs`; EXIT CODE: 0**

  ```
  ✔ AC1(a): an entry with no `authored_by` is refused, and NO adapter invents one
  ✔ AC1(b): a claim of human provenance that cannot quote the human is refused
  ✔ AC1(c): `reported_by:"user"` with `authored_by.actor:"task-worker"` ⇒ USER_SOURCE_FROM_WORKER
  ✔ AC1(d): a correction restates an entry for readers while the original line stays byte-identical
  ✔ a correction that corrects nothing, or rewrites the finding itself, is REFUSED
  ✔ AC1(e): a `proposed` outcome yields ONE skip record, and a second round adds none
  ✔ AC1(f): a READ_FAILED holds the watermark, and the next round retries and ingests the line
  ✔ AC1(g): bumping mapping_version re-evaluates the earlier VERDICT_NOT_INGESTIBLE skips
  ✔ backfill: the arithmetic holds, and a LOST finding is reported — never filed as a skip
  ✔ readExperienceLedger keeps corrections OUT of `records`, and reports a correction with no target
  ℹ tests 47   ℹ pass 47   ℹ fail 0
  ```

  Each new case carries its own negative control, so none of them can be satisfied by a predicate that
  cannot fire: (a) also shows the DERIVED form refusing a caller's author while still writing
  `{actor:"ingester", ref:"ingestNewOutcomes"}` of its own; (b) separates a thin quote from a
  whitespace-only one (different codes) and shows a real quote accepted; (c) shows the SAME worker
  accepted once the finding is recorded as what it is (`reported_by:"system"`, itself named);
  (d) re-runs the correction and shows `DUPLICATE_ID` with the carrier byte-identical;
  (e) re-files the same skip explicitly and gets `DUPLICATE_ID`; (f) shows round 2 ingesting the retried
  line; (g)(iii) bumps the version with the map UNCHANGED and still observes the rewind, so the rewind is
  driven by the version rather than by the record having become ingestible.

- [x] Real reconciliation on production carriers: after the backfill, paste outcomes scanned (121), ingested (116), skip records (5) with each `store_line`, `outcome_id` and `reason_code`, and the arithmetic `116 + 5 = 121` with 0 unexplained.

  **Evidence — `backfillIngestSkips` over the REAL `.quay/` carriers (run from this task's worktree; the carriers resolve to the shared checkout by design):**

  ```
  outcomes scanned : 121
  ingested         : 116
  skip records     : 5
  unexplained      : 0 []
  arithmetic       : 116 + 5 = 121 vs scanned 121 -> HOLDS
  mapping_version  : vr-3bc966850cfa
  skips_recorded   : 5 (already present: 0)

  --- every skip record, read back off disk ---
    store_line=9   outcome_id=outcome-9e6d7e295cbee878  verdict=proposed  reason_code=VERDICT_NOT_INGESTIBLE:proposed
    store_line=18  outcome_id=outcome-3d9cbb30bb825059  verdict=proposed  reason_code=VERDICT_NOT_INGESTIBLE:proposed
    store_line=28  outcome_id=outcome-44479971ff16fdac  verdict=proposed  reason_code=VERDICT_NOT_INGESTIBLE:proposed
    store_line=40  outcome_id=outcome-65c8177059358730  verdict=proposed  reason_code=VERDICT_NOT_INGESTIBLE:proposed
    store_line=49  outcome_id=outcome-1d5faf3428b4ecff  verdict=proposed  reason_code=VERDICT_NOT_INGESTIBLE:proposed
  skip carrier     : /data/home/yale/work/quay/.quay/discovery-ingest-skips.jsonl

  --- second backfill (idempotence) ---
    skips_recorded=0 skips_already_present=5 unexplained=0 arithmetic=116+5+0==121 -> true
  ```

  The five lines and ids match the Proposal's audit **exactly** (9/18/28/40/49), and the watermark was
  left untouched at `{"line":270,"line_sha256":"7549bc6e…"}` — the backfill ingests nothing and rewinds
  nothing, it only names what was already accounted for. (`unexplained: 0` is the load-bearing number
  here: it is the reported count of ingestible outcomes with no entry, i.e. of findings that were LOST.)

  ⚠️ Reported, not fixed (outside this task's `## Touches`): `.quay/discovery-ingest-skips.jsonl` is **not**
  gitignored, exactly like the four carriers in `DISCOVERY_CARRIERS` and the ingest watermark. The Plan's
  premise "carriers stay gitignored" does not hold today — `git check-ignore` exits 1 for all of them,
  because quay's `.gitignore` uses per-file lines rather than a `.quay/` wildcard.

- [x] Real correction: paste the two correction records, and a reader listing showing both entries now `reported_by:"system"` with `authored_by.actor:"task-worker"`. Paste the user-entry count after correction (0, until AC4).

  **Evidence.** Before: 118 entries, 2 with `reported_by:"user"`. Both corrections were appended with
  `appendExperienceCorrection`, and nothing on the original lines was touched.

  ```
  {"kind":"experience-correction","id":"experience-correction-e64d273b0694864f","corrects":"experience-5e20efdfaaf99116","patch":{"reported_by":"system","authored_by":{"actor":"task-worker","ref":"gap-discovery-experience-ledger-provenance-and-skip-audit"}},"reason":"written by a task worker about a defect the worker itself found; no human reported it (2026-10-12 acceptance check)","ts":"2026-10-12T00:00:00.000Z","authored_by":{"actor":"operator-session","ref":"gap-discovery-experience-ledger-provenance-and-skip-audit"}}
  {"kind":"experience-correction","id":"experience-correction-c54bf0020bd474be","corrects":"experience-2519951c56dc2990","patch":{"reported_by":"system","authored_by":{"actor":"task-worker","ref":"gap-discovery-experience-ledger-provenance-and-skip-audit"}},"reason":"written by a task worker about a defect the worker itself found; no human reported it (2026-10-12 acceptance check)","ts":"2026-10-12T00:00:00.000Z","authored_by":{"actor":"operator-session","ref":"gap-discovery-experience-ledger-provenance-and-skip-audit"}}
  ```

  --- reader listing AFTER the corrections ---
  ```
    experience-5e20efdfaaf99116  reported_by=system  authored_by={"actor":"task-worker","ref":"gap-discovery-experience-ledger-provenance-and-skip-audit"}
    experience-2519951c56dc2990  reported_by=system  authored_by={"actor":"task-worker","ref":"gap-discovery-experience-ledger-provenance-and-skip-audit"}
  corrected_ids: ["experience-5e20efdfaaf99116","experience-2519951c56dc2990"]
  user-entry count after correction: 0
  correction lines on disk: 2
  ```

  **Byte-identity of the originals (the part that makes this a correction and not a rewrite):**

  ```
  md5 of the file BEFORE any write             : c604e7f366fc2fbf5b70f28e540c4a27  (118 lines)
  md5 of the first 94369 bytes AFTER the writes: c604e7f366fc2fbf5b70f28e540c4a27  (identical prefix)
  line count 118 -> 120; raw lines 1 and 2 still read reported_by="user" ON DISK
  ```

  So the correction changes what READERS report while the carrier still holds every line it ever held —
  the pre-existing bytes are a byte-identical PREFIX, and `readExperienceLedger` is where the corrected
  view is assembled (`corrected_ids` names what was patched).

- [ ] Operator ingestion of the genuine Probe/Meta user case with a real quote from the user's message, done by the operator session, not the worker. Paste the record. （待外部）

  **The worker did NOT perform this write** (the Plan says so explicitly). What is here instead is the
  built path, a DRY RUN proving it accepts, and the operator command.

  The user's message was located in session `e6db01fa-cceb-44f2-8b83-02f868644460` (via the meta-cc MCP,
  `query_session_content` restricted to that session): turn of `2026-10-11T14:48:36.945Z`, whose opening
  sentence is the human pointing at the coupling before any tool ran. The quote below is that sentence,
  verbatim.

  **Operator command** (run it from the shared checkout, not from a worktree):
  ```
  node --input-type=module -e '
  import { ingestFeedback } from "/data/home/yale/work/quay/docs/analysis/discovery-experience-ledger.mjs";
  const SESSION = "e6db01fa-cceb-44f2-8b83-02f868644460";
  console.log(JSON.stringify(ingestFeedback("/data/home/yale/work/quay", {
    caseId: "EXP-probe-meta-domain-concept-duplication",
    role: "missed-by-tooling", reportedBy: "user",
    evidenceRefs: ["gap-discovery-method-reflection-unified-trigger-and-candidate-generation"],
    components: ["plugin/scripts/probe-routine.ts", "plugin/scripts/meta-driver.ts"],
    summary: "Probe Routine and Meta-driver each carry their own field-set and dedup mechanism for the same domain concept, and nothing the tooling ran surfaced the duplication until the user pointed at it",
    ts: "2026-10-11T14:48:36.945Z",
    authoredBy: { actor: "operator-session", ref: SESSION },
    userProvenance: { kind: "conversation", ref: SESSION,
      quote: "用户同意将我们未主动发现 Probe Routine/Meta-driver 潜在领域概念重复，作为自主架构假设生成能力的正式回归案例" },
  }), null, 1));'
  ```

  **DRY RUN of that exact call against a throwaway fixture root (production untouched — `file` in the
  output is the proof of where it went):**
  ```
    ok        : true
    id        : experience-d5e67d42857b8556
    file      : /tmp/ac4-dryrun-OhgVAi/.quay/discovery-experience-ledger.jsonl
    record    : {"kind":"experience","id":"experience-d5e67d42857b8556","case_id":"EXP-probe-meta-domain-concept-duplication","ts":"2026-10-11T14:48:36.945Z","role":"missed-by-tooling","reported_by":"user","authored_by":{"actor":"operator-session","ref":"e6db01fa-cceb-44f2-8b83-02f868644460"},"source_ref":null,"evidence":[{"ref":"gap-discovery-method-reflection-unified-trigger-and-candidate-generation","sha256":"ec5082e9112f696432c23d77309a43c48bdca35e5019ff7f7872d66c5e04d076"}],"components":["plugin/scripts/probe-routine.ts","plugin/scripts/meta-driver.ts"],"summary":"…","evaluation_pin":null,"user_provenance":{"kind":"conversation","ref":"e6db01fa-cceb-44f2-8b83-02f868644460","quote":"用户同意将我们未主动发现 Probe Routine/Meta-driver 潜在领域概念重复，作为自主架构假设生成能力的正式回归案例"}}
    read back : reported_by=user authored_by={"actor":"operator-session","ref":"e6db01fa-cceb-44f2-8b83-02f868644460"}

    negative controls on the SAME command:
      authored_by.actor = task-worker     -> ok=false ["USER_SOURCE_FROM_WORKER:…"]
      no user_provenance at all           -> ok=false ["USER_PROVENANCE_MISSING:…"]
      a quote a machine could type itself -> ok=false ["USER_PROVENANCE_QUOTE_INSUBSTANTIAL:needs->=20-non-whitespace-chars-got-5"]
  ```
  The production ledger is unchanged by this AC: it still holds 120 lines and 0 `reported_by:"user"` entries.

- [x] Mutation control: drop the `USER_SOURCE_FROM_WORKER` rule and show case (c) goes red. Paste, then revert.

  **Evidence.** The rule was commented out in `validateExperienceRecord`, the case re-run, then reverted.

  ```
  baseline   : md5 2ded208b386c61b0c266f21cfdf7b8a0  -> AC1(c) PASS (2 passed, 0 failed)

  MUTATED (rule dropped):
    node --test --test-name-pattern="AC1\(c\)" plugin/test/discovery-experience-ledger.test.mjs
    ✔ AC1(c): reported_by outside the two-value vocab is refused, naming the value
    ✖ AC1(c): `reported_by:"user"` with `authored_by.actor:"task-worker"` ⇒ USER_SOURCE_FROM_WORKER
    ℹ pass 1   ℹ fail 1
      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      true !== false
          at … assert.equal(r.ok, false, "the worker's claim is refused, not stored")

    direct reading of the same mutation:
      ok: true | reasons: undefined
      records now in the ledger: 1
      stored reported_by: user | stored authored_by: {"actor":"task-worker","ref":"gap-fixture-worker"}

  REVERTED:
    md5 2ded208b386c61b0c266f21cfdf7b8a0  (byte-identical to the pre-mutation module)
    direct reading: ok: false | reasons: ["USER_SOURCE_FROM_WORKER:authored_by.actor=task-worker-cannot-store-its-own-finding-as-reported_by=user"] | records in the ledger: 0
    node --test plugin/test/discovery-experience-ledger.test.mjs -> ℹ tests 47  ℹ pass 47  ℹ fail 0
  ```

  The mutant does not merely flip an assertion: with the rule gone the worker's false claim is ACCEPTED
  and the entry LANDS (`records now in the ledger: 1`, `reported_by: user`) — the 2026-10-12 defect,
  reproduced on demand. The revert is verified by digest, not by re-reading my own edit.

## Definition of Done
- AC1–AC3 and AC5 ticked with output pasted; AC4 by the operator or recorded as pending. **Done** — AC1/AC2/AC3/AC5 are ticked with the runs pasted above; AC4 is left unchecked with `（待外部）` because its live predicate is false (no operator write has happened), which is what that marker means.
- `scripts/test.sh --for-task gap-discovery-experience-ledger-provenance-and-skip-audit` green. **Done** — exit 0, both with `--allow-thin` (the driver's fan-in flags) and with the literal command as written here.

## Touches
- tasks/gap-discovery-experience-ledger-provenance-and-skip-audit.md
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/discovery-experience-ledger.test.mjs
