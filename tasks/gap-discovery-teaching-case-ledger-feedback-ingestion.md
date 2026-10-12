---
id: gap-discovery-teaching-case-ledger-feedback-ingestion
title: "Discovery Method: unified Experience ledger (user + system sources) with
  auto-ingestion from evidence-store outcomes (Phase 1, generalized)"
status: ready
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
- [x] `node --test plugin/test/discovery-experience-ledger.test.mjs` exits 0, covering:
  - (a) a well-formed manual (`reported_by:"user"`) case with >=1 evidence ref is accepted, `source_ref:null`;
  - (b) a case with zero evidence refs is refused;
  - (c) `reported_by` outside the two-value vocab is refused;
  - (d) `summary` under 40 non-whitespace chars is refused;
  - (e) `ingestFromEvidenceStoreOutcome` against a FIXTURE evidence-store file correctly derives `reported_by:"system"` + `source_ref` and refuses when the named record does not exist;
  - (f) `ingestFromEvidenceStoreOutcome` refuses when the caller's claimed role contradicts the record's stored verdict (e.g. claiming `confirmed-negative` for a `supported` record), with a distinct reason code;
  - (g) `experienceDenyList` on a fixture ledger flags a fabricated inventory line naming a registered component, and does not flag an unrelated one;
  - (h) `experienceDenyList` on an empty ledger runs without crashing.
- [x] Real reproduction: ingest the 5 system-sourced cases listed in the Proposal via `ingestFromEvidenceStoreOutcome` (verify each named experiment_ref/record actually resolves before running — if one does not, say so and drop it rather than fabricate) and the 1 user-sourced Probe/Meta case via `ingestFeedback`. Paste all 6 accepted records, the validator tally (accepted=6, refused=0), and for each system-sourced one, confirm `source_ref` is non-null and points at a real id in `.quay/architecture-evidence-store.jsonl`.
- [x] `experienceDenyList` over this real ledger — paste the output; it must include `meta-driver.ts`, `probe-routine.ts`, `routine-file-gate.ts`, `checker-io.ts`, `driver-config.ts`, `touches-parser.ts`, `fan-in-ff-protocol-check.ts`, `per-task-suite-record-check.ts`.
- [x] Mutation control: construct a synthetic inventory line containing `probe-routine.ts`; show it is flagged; remove the Probe/Meta case from the ledger; show the same line is no longer flagged.
- [x] Negative control for AC(f): run `ingestFromEvidenceStoreOutcome` against the REAL `E-HYPGEN-ACCEPT-1 cluster 7` record claiming role `found-and-fixed` (wrong — its real verdict is `refuted`) and show it is refused; then re-run claiming the correct role `confirmed-negative` and show it is accepted.

## Definition of Done
- All AC ticked with command output pasted.
- `scripts/test.sh --for-task gap-discovery-teaching-case-ledger-feedback-ingestion` green.
- `.quay/discovery-experience-ledger.jsonl` holds the 6 real entries (gitignored, local artifact — the AC output pasted into this body is the durable record).

## Touches
- tasks/gap-discovery-teaching-case-ledger-feedback-ingestion.md
- docs/analysis/discovery-experience-ledger.mjs (new)
- plugin/test/discovery-experience-ledger.test.mjs (new)

## Evidence
All commands run in the task worktree `/data/home/yale/work/quay-worktrees/gap-discovery-teaching-case-ledger-feedback-ingestion`, with `root` = that path. The REAL evidence store was copied in byte-identically first: source sha256 `2f089bab72bccdf3a71e223b61b8c5accf379626d3891f5344e9815c76df6b70`, copy sha256 `2f089bab72bccdf3a71e223b61b8c5accf379626d3891f5344e9815c76df6b70` (identical), 270 lines.

### AC1 — `node --test plugin/test/discovery-experience-ledger.test.mjs` exits 0

```
EXIT=0
✔ AC1(a): a well-formed manual (reported_by:"user") case is accepted with source_ref null
✔ AC1(a): a refused manual case appends NOTHING and does not even create the carrier
✔ AC1(b): a case with zero evidence refs is refused, with a code distinct from the absent-field one
✔ AC1(c): reported_by outside the two-value vocab is refused, naming the value
✔ AC1(d): a summary under 40 non-whitespace chars is refused; whitespace does not count
✔ AC1(e): ingestFromEvidenceStoreOutcome derives reported_by:"system", source_ref and a line-hash
✔ AC1(e): a named outcome record that does not exist is REFUSED, and nothing is appended
✔ AC1(e): an AMBIGUOUS ref is reported with its candidates, never resolved arbitrarily (枚举, not boolean)
✔ AC1(f): a claimed role contradicting the record's stored verdict is refused with its own code
✔ AC1(g): experienceDenyList flags an inventory line naming a registered component, and not an unrelated one
✔ the deny-list emits patterns only where a pattern can FIRE (summary text is data, not a pattern)
✔ AC1(h): experienceDenyList on an empty (and on an absent) ledger runs without crashing
✔ a PARTIALLY readable ledger is reported as not-ok, never read as a complete deny-list
✔ the refusal vocabulary is enumerable — every required field has its own absent-key code
✔ source_ref is a structural invariant in BOTH directions, each with its own code
✔ `recurred-after-fix` is IN the vocabulary and is accepted (a future recurrence is not blocked)
✔ records are content-addressed: identical content ⇒ one id, a changed field ⇒ a different id
ℹ tests 17   ℹ pass 17   ℹ fail 0   ℹ skipped 0
```

### AC2 — real reproduction: pre-flight resolution, the 6 accepted records, the tally

Pre-flight (each named record must actually resolve before ingesting — none dropped):

```
E-DT-1-Hp cluster 11           -> RESOLVES  [{"line":234,"id":"outcome-31fc82ad5d6c1f86","verdict":"supported"}]
E-HYPGEN-AB-1-B cluster 8      -> RESOLVES  [{"line":185,"id":"outcome-bb12a6858838e74b","verdict":"supported"}]
E-HYPGEN-ACCEPT-1 cluster 5    -> RESOLVES  [{"line":137,"id":"outcome-696a9770477e60e0","verdict":"supported"}]
E-HYPGEN-ACCEPT-1 cluster 13   -> RESOLVES  [{"line":149,"id":"outcome-49efc26cb95f2b48","verdict":"undetermined"}]
E-HYPGEN-ACCEPT-1 cluster 7    -> RESOLVES  [{"line":140,"id":"outcome-ee63601cc7031e95","verdict":"refuted"}]
E-ARCH-PM-IDENTITY (manual case's own later confirmation) -> RESOLVES (outcome-99aa24ac34d53b6a)
```

The 6 accepted records, verbatim from `.quay/discovery-experience-ledger.jsonl`:

```
{"kind":"experience","id":"experience-ac45b802574bff62","case_id":"EXP-fan-in-lock-hold-pairing","ts":"2026-10-11T18:54:48.783Z","role":"found-and-fixed","reported_by":"system","source_ref":"outcome-31fc82ad5d6c1f86","evidence":[{"ref":"outcome-31fc82ad5d6c1f86","sha256":"86559a949065f48ac43a2e7bfee76a8c8d82a4d12f507a590b201c5d8b6f556c"}],"components":["plugin/scripts/fan-in-ff-protocol-check.ts","plugin/scripts/fan-in-queueing-model.ts"],"summary":"fan-in lock acquire/release events are paired with two divergent keys and two different double-acquire policies, so a lock hold is attributed to the wrong key."}
{"kind":"experience","id":"experience-6af078be3c5cda11","case_id":"EXP-per-task-suite-record-required-fields","ts":"2026-10-11T17:49:48.598Z","role":"found-and-fixed","reported_by":"system","source_ref":"outcome-bb12a6858838e74b","evidence":[{"ref":"outcome-bb12a6858838e74b","sha256":"d3537c419a5b13ab56e5e570cf5b9839f44923061e2a950f94a0a6f8e22d2ef0"}],"components":["plugin/scripts/per-task-suite-record-check.ts","plugin/scripts/per-task-suite-record.ts"],"summary":"the per-task suite record's REQUIRED_FIELDS set is declared twice — once in the writer and once in the checker — so the two silently drift apart."}
{"kind":"experience","id":"experience-08f90ce9f6cfb13a","case_id":"EXP-checker-exit-code-split","ts":"2026-10-11T16:05:43.724Z","role":"found-and-fixed","reported_by":"system","source_ref":"outcome-696a9770477e60e0","evidence":[{"ref":"outcome-696a9770477e60e0","sha256":"065c4be8824db6b7536670165f6d95a01b995209ea1f3cdeb20a73a1af6f1f3d"}],"components":["plugin/scripts/checker-io.ts"],"summary":"a malformed record makes the checker exit 3 while the static gate only recognises exit 2 as failure, so a broken checker passes the gate as if it were clean."}
{"kind":"experience","id":"experience-1124743050c461e9","case_id":"EXP-routine-quota-window-inert","ts":"2026-10-11T16:05:43.724Z","role":"found-undetermined-then-confirmed","reported_by":"system","source_ref":"outcome-49efc26cb95f2b48","evidence":[{"ref":"outcome-49efc26cb95f2b48","sha256":"a6dd555347ef860c558c55c55f716e2082a5175f1bcfd9cb7c0c0cdceedc834a"}],"components":["plugin/scripts/driver-config.ts"],"summary":"routine_quota.window_ms is parsed through the driver config but never consumed by any admission decision, so the declared quota window is inert."}
{"kind":"experience","id":"experience-956f3d389b6967cc","case_id":"EXP-touches-parser-shared-reader","ts":"2026-10-11T16:05:43.724Z","role":"confirmed-negative","reported_by":"system","source_ref":"outcome-ee63601cc7031e95","evidence":[{"ref":"outcome-ee63601cc7031e95","sha256":"e17405ef9c88bb7ac9677d8d3175d0f4b41d118158995f353d68f36bfe857786"}],"components":["plugin/scripts/touches-parser.ts"],"summary":"the claim that Touches is parsed by several independent readers is refuted: every consumer imports the one shared touches-parser.ts, pinned by a parity test."}
{"kind":"experience","id":"experience-9d1e0ffe5ebf7dd0","case_id":"EXP-probe-meta-coupling","ts":"2026-10-12T03:34:02.722Z","role":"missed-by-tooling","reported_by":"user","source_ref":null,"evidence":[{"ref":"outcome-99aa24ac34d53b6a","sha256":"05562b1ae3fe20cfe830e99f234a015d489b26df0813eb50ab371b9f7c97cd29"},{"ref":"E-HYPGEN-1","sha256":"fc29da98b9867862d6b472423667b76b8a75b91f4c32a8664e605d1602252d7c"},{"ref":"E-HYPGEN-ACCEPT-1","sha256":"b52617a783858101a06c2c2b8504c86387ae6c90832e5048dbb8f4df4a0e4352"},{"ref":"E-HYPGEN-AB-1-A","sha256":"9d3f9d4da9d4561c212db6e6b355076c12ee2c6d29d8953c2c1ee47299f12b58"},{"ref":"E-HYPGEN-AB-1-B","sha256":"ef52dee07a2c4a58373fff939c8d1586a7d9878d2ea3cb3ef752d8c6b67d4715"},{"ref":"E-DT-1-Hf","sha256":"d9cef8d4c8d095d200025270c6f2829cb8eb222d8b594163b8a2ce72b99eea44"},{"ref":"E-DT-1-Hp","sha256":"7e00c45725c0d5af7e157761e401c19c96772516b531162500632730a52b3732"}],"components":["plugin/scripts/meta-driver.ts","plugin/scripts/probe-routine.ts","plugin/scripts/routine-file-gate.ts"],"summary":"probe-routine.ts/routine-file-gate.ts and meta-driver.ts separately implement problem identity, dedup and quota admission; a human flagged it ahead of any tool run and nine later blind runs never matched it."}
```

```
file: <worktree>/.quay/discovery-experience-ledger.jsonl
malformed_lines: 0
=== TALLY: accepted=6 refused=0 ledger_records=6 ===

=== STEP 4: source_ref points at a real id in the evidence store ===
EXP-fan-in-lock-hold-pairing              source_ref=outcome-31fc82ad5d6c1f86  in-store=true
EXP-per-task-suite-record-required-fields source_ref=outcome-bb12a6858838e74b  in-store=true
EXP-checker-exit-code-split               source_ref=outcome-696a9770477e60e0  in-store=true
EXP-routine-quota-window-inert            source_ref=outcome-49efc26cb95f2b48  in-store=true
EXP-touches-parser-shared-reader          source_ref=outcome-ee63601cc7031e95  in-store=true
EXP-probe-meta-coupling                   reported_by=user  source_ref=null (null is the manual path's invariant)
ALL system source_ref values are non-null and resolve to a real evidence-store id
```

Each system-sourced entry's `evidence[].sha256` was independently re-checked against the CURRENT carrier line it points at — all five match (lines 234, 185, 137, 149, 140).

### AC3 — `experienceDenyList` over the real ledger

```
ok: true  evaluated(cases): 6  malformed_lines: 0
components ( 10 ):
    plugin/scripts/checker-io.ts
    plugin/scripts/driver-config.ts
    plugin/scripts/fan-in-ff-protocol-check.ts
    plugin/scripts/fan-in-queueing-model.ts
    plugin/scripts/meta-driver.ts
    plugin/scripts/per-task-suite-record-check.ts
    plugin/scripts/per-task-suite-record.ts
    plugin/scripts/probe-routine.ts
    plugin/scripts/routine-file-gate.ts
    plugin/scripts/touches-parser.ts
case_ids: ["EXP-checker-exit-code-split","EXP-fan-in-lock-hold-pairing","EXP-per-task-suite-record-required-fields","EXP-probe-meta-coupling","EXP-routine-quota-window-inert","EXP-touches-parser-shared-reader"]
patterns: 16 (one per component + one per case_id)
REQUIRED 8 present: YES — all of meta-driver.ts, probe-routine.ts, routine-file-gate.ts, checker-io.ts, driver-config.ts, touches-parser.ts, fan-in-ff-protocol-check.ts, per-task-suite-record-check.ts
```

### AC4 — mutation control (the flag is driven by the ledger's contents, not a hardcoded pattern)

```
synthetic line: "- plugin/scripts/probe-routine.ts — reads the routine file and decides admission"
WITH the Probe/Meta case:    flagged=true  matches=[{"kind":"component","value":"plugin/scripts/probe-routine.ts","pattern":"/(?:^|[\\s/`\"'()\\[\\]{},;:<>|=])probe-routine\\.ts(?:$|[\\s/`\"'()\\[\\]{},;:<>|=])/"}]
real ledger = 6 entries; ledger-minus-Probe/Meta = 5 entries
components WITHOUT the Probe/Meta case: ["plugin/scripts/checker-io.ts","plugin/scripts/driver-config.ts","plugin/scripts/fan-in-ff-protocol-check.ts","plugin/scripts/fan-in-queueing-model.ts","plugin/scripts/per-task-suite-record-check.ts","plugin/scripts/per-task-suite-record.ts","plugin/scripts/touches-parser.ts"]
WITHOUT the Probe/Meta case: flagged=false  matches=[]
MUTATION CONTROL PASSES: the flag is driven by the ledger's actual contents, not a hardcoded pattern
unrelated line (with Probe/Meta case): flagged= false
```

`probe-routine.ts` is registered ONLY by the Probe/Meta case (the C13 case's registered component is `driver-config.ts`), which is why removing that one case un-flags the line.

### AC5 — negative control for AC(f) against the REAL `E-HYPGEN-ACCEPT-1 cluster 7` record

```
scratch evidence store sha256: 2f089bab72bccdf3a71e223b61b8c5accf379626d3891f5344e9815c76df6b70
claiming role 'found-and-fixed' (WRONG, real verdict is refuted):
   ok=false  reasons=["ROLE_VERDICT_INCONSISTENT:role=found-and-fixed-requires-verdict-in-(supported)-but-outcome-ee63601cc7031e95-stored-refuted"]
re-run claiming the CORRECT role 'confirmed-negative':
   ok=true  source_ref=outcome-ee63601cc7031e95  derived_from={"id":"outcome-ee63601cc7031e95","line":140,"verdict":"refuted","experiment_ref":"E-HYPGEN-ACCEPT-1 cluster 7"}
NEGATIVE CONTROL PASSES: the refusal tracks the claimed role, not the record
```

### DoD — `scripts/test.sh --for-task gap-discovery-teaching-case-ledger-feedback-ingestion` green

```
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
PASS: no new task-file bypass — 38 hit(s), all within the allowlist
... the change-relevant static subset reported no failure ...
ℹ tests 17   ℹ pass 17   ℹ fail 0   ℹ skipped 0
EXIT=0
```

The scoped-gate cache was then recorded for the fan-in:
`{"event":"scoped-gate-cache-written","task":"gap-discovery-teaching-case-ledger-feedback-ingestion","developSha":"a6ed02f9f51d568d035e4fece66ed10338a8c2a5"}`

`.quay/discovery-experience-ledger.jsonl` holds the 6 real entries (local artifact, not committed; the output pasted above is the durable record).