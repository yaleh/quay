---
id: gap-discovery-teaching-case-ledger-feedback-ingestion
title: "Discovery Method: teaching-case ledger for human-flagged misses (Phase 1
  feedback ingestion, anti-leak deny-list)"
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
Phase 1 of the self-bootstrapping Discovery Method loop: turn a human-flagged miss into a TEACHING CASE with evidence and labels, structurally barred from leaking into the SAME blind test it is meant to teach. This is feedback ingestion, not detection — it adds no detector.

Six concrete teaching cases already exist from this session's record (all real, all independently verified earlier — cited by task id / experiment id, not re-derived here):
1. **Probe/Meta coupling miss** — the user pointed out, ahead of any tool run, that `probe-routine.ts`/`routine-file-gate.ts` and `meta-driver.ts` separately implement problem identity, dedup and quota admission. Six rounds of blind hypothesis generation (`E-HYPGEN-1`, `E-HYPGEN-ACCEPT-1`, `E-HYPGEN-AB-1-A/B`, `E-DT-1-Hf/Hp`) never found it: 0/9 runs. This is the canonical MISS case — label `role: missed-by-tooling`.
2. **C5** — checker exit-code 2-vs-3 split (`checker-io.ts` / `gate-script-base.ts` / `ac69-slot-queue-gap-check.ts`). Found by tooling (`E-HYPGEN-ACCEPT-1` c5/c10), then independently confirmed by a real `run_checker` control and fixed (`gap-ac69-malformed-record-exits-3-and-passes-the-static-gate`). Label `role: found-and-fixed`.
3. **C13** — `routine_quota.window_ms` parsed but never consumed. First surfaced as an UNDETERMINED verifier cluster (turn-budget exhaustion, `E-HYPGEN-ACCEPT-1`), confirmed by the operator independently, fixed by `gap-routine-quota-window-ms-parsed-but-inert`. Label `role: found-undetermined-then-confirmed`.
4. **C7** — Touches-parser shared-reader NEGATIVE (claims of independent parsers are false; all consumers import `touches-parser.ts`, pinned by `touches-parser-parity.test.mjs`). Label `role: confirmed-negative`.
5. **fan-in lock-hold pairing (Hp c11)** — `fan-in-ff-protocol-check.ts` and `fan-in-queueing-model.ts` pair acquire/release events with two different keys and different double-acquire policies. Found by `E-DT-1` arm Hp, fixed by `gap-fan-in-lock-hold-pairing-two-divergent-keys`. Label `role: found-and-fixed`.
6. **per-task-suite-record contract (E-DT-1/AB-1 c8)** — `REQUIRED_FIELDS` declared twice (writer + checker). Found, fixed by `gap-per-task-suite-record-required-fields-declared-twice`. Label `role: found-and-fixed`.

## Plan
1. New module `docs/analysis/discovery-teaching-ledger.mjs`, append-only carrier `.quay/discovery-teaching-ledger.jsonl` (gitignored), reusing `architecture-evidence-store.mjs`'s `sha256`/`appendRecord`-style primitives by import — not re-implemented.
2. Teaching-case record shape:
   ```
   {
     case_id: string,              // stable, human-assignable e.g. "TEACH-probe-meta-coupling"
     ts: ISO-8601,
     role: "missed-by-tooling" | "found-and-fixed" | "found-undetermined-then-confirmed" | "confirmed-negative",
     reported_by: "user" | "operator",       // who flagged it — a tool-self-reported case is NEVER "user"
     evidence: [{ ref: string, sha256: string }],   // >=1 pointer into architecture-evidence-store.jsonl, a task id, or an experiment id — never free prose alone
     components: string[],          // the repo-relative files involved — used ONLY for the anti-leak deny-list, never for scoring
     summary: string,               // >=40 non-whitespace chars
   }
   ```
3. **Anti-leak structural rule** (the load-bearing part of this task): a function `teachingDenyList(root)` that returns the UNION of all registered teaching cases' `components` plus their `case_id`/`summary` text as deny patterns, in the SAME shape `ownership-active-contract.mjs`'s `DENY_PATH_PATTERNS` and `arch-hypothesis-generation.mjs`'s `--contamination-pairs` already consume. Any future blind-investigator inventory or prompt that is built for a round INCLUDING a given teaching case as training/provenance material must run its existing contamination scan against this deny-list, and REFUSE (not warn) if a match is found in investigator-visible text. This task does not modify `arch-hypothesis-generation.mjs` — it only produces the deny-list function; wiring is a later task's job, named explicitly in this task's body so it isn't silently skipped.
4. CLI ingestion path: `docs/analysis/discovery-teaching-ledger.mjs` exports `ingestFeedback({caseId, role, reportedBy, evidenceRefs, components, summary})` — pure, validates, returns `{ok, reasons}` or appends. A thin CLI wrapper is explicitly OUT of scope for this task (no new `plugin/scripts/*.ts`, no capability-catalog entry) — ingestion in this task is called from a test/reproduction script only. A real CLI verb, if wanted, is a follow-up task.
5. Register the six real cases above as the FIRST real ledger entries, via the reproduction AC below — not hand-inserted into the jsonl file directly (hard rule: no hand-edit of an ABI-governed carrier; this one is not ABI-governed, but the discipline of "write through the function you just built" still applies so the write path is actually exercised).

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-teaching-ledger.test.mjs` exits 0, covering:
  - (a) a well-formed teaching case with `reported_by:"user"` and >=1 evidence ref is accepted;
  - (b) a case with zero evidence refs is refused;
  - (c) `reported_by` outside the two-value vocab is refused;
  - (d) `summary` under 40 non-whitespace chars is refused;
  - (e) `teachingDenyList` on a fixture ledger returns every registered case's `components` plus a prose pattern for its `case_id`, and a scan using this list against a FABRICATED inventory line that names one of those components is flagged — proving the list is actually usable by a contamination scanner, not just produced and ignored;
  - (f) `teachingDenyList` on an EMPTY ledger returns an empty list that still successfully runs (no crash on the base case).
- [ ] Real reproduction: ingest the six teaching cases listed in the Proposal, each with `evidence` pointing at the REAL identifiers named above (task ids / experiment ids — verify each one actually exists in `.quay/architecture-evidence-store.jsonl` or `tasks/*.md` before citing it; if one does not resolve, say so and drop that case rather than fabricate a ref). Paste all six accepted records and the validator tally (accepted=6, refused=0).
- [ ] Run `teachingDenyList` over the real ledger from the step above and paste its output. It must include `meta-driver.ts`, `probe-routine.ts`, `routine-file-gate.ts` (from case 1), `checker-io.ts` (case 2), `driver-config.ts` (case 3), `touches-parser.ts` (case 4), `fan-in-ff-protocol-check.ts` (case 5), `per-task-suite-record-check.ts` (case 6).
- [ ] Mutation control: construct a synthetic inventory line containing `probe-routine.ts` and feed it through a contamination check using this deny-list; show it is flagged. Then remove case 1 from the ledger and show the SAME line is no longer flagged — proving the deny-list is driven by the ledger's actual contents, not a hardcoded pattern.

## Definition of Done
- All AC ticked with command output pasted.
- `scripts/test.sh --for-task gap-discovery-teaching-case-ledger-feedback-ingestion` green.
- The six real cases are durably registered in `.quay/discovery-teaching-ledger.jsonl` (gitignored — note its presence is a local/operator artifact, not a repo commit; the AC output pasted into this task body is the durable record of what was written).

## Touches
- tasks/gap-discovery-teaching-case-ledger-feedback-ingestion.md
- docs/analysis/discovery-teaching-ledger.mjs (new)
- plugin/test/discovery-teaching-ledger.test.mjs (new)
