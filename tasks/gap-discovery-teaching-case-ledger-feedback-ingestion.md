---
id: gap-discovery-teaching-case-ledger-feedback-ingestion
title: "Discovery Method: unified Experience ledger (user + system sources) with
  auto-ingestion from evidence-store outcomes (Phase 1, generalized)"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-method-registry-and-versioned-contract
---
## Proposal
**This supersedes the original body of this task in place** (task still `todo`, not dispatched — safe to revise before any worker touches it). The original framing was wrong: it treated "user-flagged miss" as a separate pipeline from "system self-discovered finding." The user corrected this explicitly: Method Learning must NEVER be triggered only by a human pointing something out. Every Finding the system itself produces — supported, refuted, fixed, recurred-after-fix — must feed the SAME reflection entry point that a human-flagged miss feeds. User feedback and self-discovery are two SOURCES of one thing, "Experience" — not two flows.

So this task now builds an **Experience ledger**, not a "teaching-case ledger": one schema, one validator, one anti-leak deny-list, fed by TWO adapters (manual for `reported_by:"user"`, automatic for `reported_by:"system"`). The automatic adapter is the load-bearing new piece: it must convert ANY `architecture-evidence-store.jsonl` outcome record into an Experience entry without hand-narration, so a future, never-yet-seen self-discovery requires no human curation step to become learnable material.

Five of the six cases originally planned for hand-narration already have a real outcome record and should be ingested THROUGH THE ADAPTER instead of described by hand:
- fan-in lock-hold pairing — `E-DT-1-Hp cluster 11` (role: `found-and-fixed`, fixed by `gap-fan-in-lock-hold-pairing-two-divergent-keys`)
- per-task-suite-record `REQUIRED_FIELDS` — `E-HYPGEN-AB-1-B cluster 8` (role: `found-and-fixed`, fixed by `gap-per-task-suite-record-required-fields-declared-twice`)
- C5 checker exit-code split — `E-HYPGEN-ACCEPT-1 cluster 5` (role: `found-and-fixed`, fixed by `gap-ac69-malformed-record-exits-3-and-passes-the-static-gate`)
- C13 quota window inert — `E-HYPGEN-ACCEPT-1 cluster 13` (role: `found-undetermined-then-confirmed`, verdict recorded as `undetermined`/`TURN_LIMIT`, fixed by `gap-routine-quota-window-ms-parsed-but-inert`)
- C7 Touches-parser shared-reader — `E-HYPGEN-ACCEPT-1 cluster 7` (role: `confirmed-negative`, verdict `refuted`)

Only ONE case has no single outcome record of its own and still needs the manual path:
- Probe/Meta coupling — the user pointed it out before any tool ran; the system's OWN later confirmation is `E-ARCH-PM-IDENTITY` outcome record (`experiment_ref` begins "Problem identity is implemented twice in disjoint key spaces...", `verdict:"supported"`, noted in-record as "operator-led investigation... NOT a blind discovery"). Nine later blind runs (`E-HYPGEN-1`, `E-HYPGEN-ACCEPT-1`, `E-HYPGEN-AB-1-A`, `E-HYPGEN-AB-1-B`, `E-DT-1-Hf`, `E-DT-1-Hp` — 9 runs across these 6 experiments) never matched it: role `missed-by-tooling`, `reported_by:"user"`.

## Plan
1. New module `docs/analysis/discovery-experience-ledger.mjs` (renamed from the original `discovery-teaching-ledger.mjs`), append-only carrier `.quay/discovery-experience-ledger.jsonl`, reusing `architecture-evidence-store.mjs` primitives by import.
2. Experience record shape:
   ```
   {
     case_id: string,
     ts: ISO-8601,
     role: "missed-by-tooling" | "found-and-fixed" | "found-undetermined-then-confirmed" | "confirmed-negative" | "recurred-after-fix",
     reported_by: "user" | "system",
     source_ref: string | null,      // for reported_by:"system", the evidence-store record id/experiment_ref this was auto-derived from; null only for reported_by:"user"
     evidence: [{ ref: string, sha256: string }],
     components: string[],
     summary: string,                // >=40 non-whitespace chars
   }
   ```
   `recurred-after-fix` is a new role not in the original draft: a fix that landed and was later observed to regress. No real case for it yet — the validator must accept it (so a future recurrence isn't blocked by an unknown-value refusal) but no fixture/real data is required to exercise it beyond the unit test.
3. `ingestFeedback({...})` (manual path, `reported_by:"user"`) — same as before, `source_ref` forced `null`.
4. **New, load-bearing**: `ingestFromEvidenceStoreOutcome(root, { experiment, experimentRef, role, components, caseId })` — reads the named outcome record straight from `.quay/architecture-evidence-store.jsonl` (by `experiment` + a match on `experiment_ref`), REFUSES if that record does not exist (never fabricates one), derives `evidence` from the matched record's own id/ts/sha-of-line, sets `reported_by:"system"` and `source_ref` to the matched record's id. The caller supplies `role` and `caseId` (the ledger does not re-derive "found-and-fixed" vs "confirmed-negative" by itself in this task — that classification-from-verdict step belongs to the next task, the reflection trigger, not to ingestion; ingestion only refuses to proceed if the record is missing or the verdict named is inconsistent, e.g. caller claims `confirmed-negative` for a record whose stored `verdict` is `"supported"`).
5. Anti-leak deny-list (`teachingDenyList` → rename `experienceDenyList`), unchanged in mechanism from the original draft.
6. No CLI wiring (same scope boundary as before).

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-experience-ledger.test.mjs` exits 0, covering:
  - (a) a well-formed manual (`reported_by:"user"`) case with >=1 evidence ref is accepted, `source_ref:null`;
  - (b) a case with zero evidence refs is refused;
  - (c) `reported_by` outside the two-value vocab is refused;
  - (d) `summary` under 40 non-whitespace chars is refused;
  - (e) `ingestFromEvidenceStoreOutcome` against a FIXTURE evidence-store file correctly derives `reported_by:"system"` + `source_ref` and refuses when the named record does not exist;
  - (f) `ingestFromEvidenceStoreOutcome` refuses when the caller's claimed role contradicts the record's stored verdict (e.g. claiming `confirmed-negative` for a `supported` record), with a distinct reason code;
  - (g) `experienceDenyList` on a fixture ledger flags a fabricated inventory line naming a registered component, and does not flag an unrelated one;
  - (h) `experienceDenyList` on an empty ledger runs without crashing.
- [ ] Real reproduction: ingest the 5 system-sourced cases listed in the Proposal via `ingestFromEvidenceStoreOutcome` (verify each named experiment_ref/record actually resolves before running — if one does not, say so and drop it rather than fabricate) and the 1 user-sourced Probe/Meta case via `ingestFeedback`. Paste all 6 accepted records, the validator tally (accepted=6, refused=0), and for each system-sourced one, confirm `source_ref` is non-null and points at a real id in `.quay/architecture-evidence-store.jsonl`.
- [ ] `experienceDenyList` over this real ledger — paste the output; it must include `meta-driver.ts`, `probe-routine.ts`, `routine-file-gate.ts`, `checker-io.ts`, `driver-config.ts`, `touches-parser.ts`, `fan-in-ff-protocol-check.ts`, `per-task-suite-record-check.ts`.
- [ ] Mutation control: construct a synthetic inventory line containing `probe-routine.ts`; show it is flagged; remove the Probe/Meta case from the ledger; show the same line is no longer flagged.
- [ ] Negative control for AC(f): run `ingestFromEvidenceStoreOutcome` against the REAL `E-HYPGEN-ACCEPT-1 cluster 7` record claiming role `found-and-fixed` (wrong — its real verdict is `refuted`) and show it is refused; then re-run claiming the correct role `confirmed-negative` and show it is accepted.

## Definition of Done
- All AC ticked with command output pasted.
- `scripts/test.sh --for-task gap-discovery-teaching-case-ledger-feedback-ingestion` green.
- `.quay/discovery-experience-ledger.jsonl` holds the 6 real entries (gitignored, local artifact — the AC output pasted into this body is the durable record).

## Touches
- tasks/gap-discovery-teaching-case-ledger-feedback-ingestion.md
- docs/analysis/discovery-experience-ledger.mjs (new; replaces the originally-planned discovery-teaching-ledger.mjs filename)
- plugin/test/discovery-experience-ledger.test.mjs (new; replaces discovery-teaching-ledger.test.mjs)
