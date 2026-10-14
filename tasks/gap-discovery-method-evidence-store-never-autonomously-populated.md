---
id: gap-discovery-method-evidence-store-never-autonomously-populated
title: discovery_method 的 EVIDENCE_STORE_MISSING 不是启动期暂态——没有任何常驻 routine 会写
  architecture-evidence-store.jsonl
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal
**Found 2026-10-14 while planning safe enablement of `arch_discovery`/`discovery_method` on ClaudeCodeUI, as part of the "Quay architecture analysis as a shipped capability" follow-through.** `discovery-method-routine.ts`'s ingest step refuses every round with `EVIDENCE_STORE_MISSING` on any host where `.quay/architecture-evidence-store.jsonl` does not yet exist (`docs/analysis/discovery-experience-ledger.mjs:1392/1775/1992`). This was already observed once in `gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance`'s AC1 evidence on a fresh clean-room host and recorded there as a legible, correctly-fail-closed, "not the fix's concern" condition for THAT task's scope. This task investigates the condition itself: **is a fresh host's missing evidence store a transient startup gap that autonomous operation closes on its own, or does it stay missing forever without a manual step?**

**Confirmed by code-reading every write path to the store** (`docs/analysis/architecture-evidence-store.mjs`'s `appendRecord`/`appendEvidenceRecord`/`appendHypothesisRecord`/`appendOutcomeRecord`/`appendCounterexampleRecord`, and the ONE production call site, `arch-hypothesis-generation.mjs:1979`'s `appendRecord(root, kind, rec)` inside `emit(records, {writeStore, root, ...})`): `writeStore` defaults to `false`, and the ONLY place anything ever passes `writeStore: true` is `arch-hypothesis-generation.mjs`'s own manual CLI subcommands (`verify`/`match`/`review`, gated behind an explicit `--write-store` flag a human/worker types — `arch-hypothesis-generation.mjs:2453/2489/2523`). **None of the three resident, driver-invoked routines that load this engine — `open-semantic-discovery-routine.ts`, `discovery-method-routine.ts`, `cross-project-dogfood-routine.ts` — call `emit()` with `writeStore` at all** (confirmed: zero occurrences of `emit(`/`writeStore`/`EVIDENCE_STORE`/`appendRecord` in any of the three routine files). `arch-discovery-routine.ts` doesn't load this engine at all (it only spawns the mechanical space/time instruments, which import validation helpers from the store module but never call an append function).

**Real-host corroboration:** quay's own repo's evidence store (300 lines) was last modified 2026-10-12T22:07:27+08:00 — a SINGLE write event, not an accumulating trickle from resident rounds (OSD alone has run 187+ resident/manual rounds on this repo in the same window; if OSD's own operation wrote evidence, the store would show many distinct timestamps spread across that history, not one). ClaudeCodeUI — which has run real OSD resident rounds since 2026-10-11 and, as of today, real architecture-review rounds — has **zero** `.quay/architecture-evidence-store.jsonl` (confirmed: file does not exist). This is consistent with the code reading: the store is a manual-research artifact, not a production side effect, on EITHER host.

**Why this matters beyond ClaudeCodeUI specifically (it's a Quay-generic wiring gap, not a host config issue):** `discovery_method` is part of the shipped, documented Method/Portfolio/Experience capability. On ANY fresh deployment — a new project, or an existing one whose evidence store was never seeded — enabling `discovery_method` produces an indefinite `failed: EVIDENCE_STORE_MISSING` with no autonomous path to a different outcome, because nothing in its own resident pipeline (or any sibling resident routine's) ever bootstraps the prerequisite it declares. This is the SAME class of defect as Task D's packaging gap and the architecture-review detector-shipping gap — "a capability's own resident operation cannot reach the state its own gate requires" — just one layer upstream (data bootstrap, not code/packaging).

## Plan
1. **Decide the fix shape — do not do both** (hard rule: give a reason, don't hedge): either (a) have ONE of the evidence-producing resident routines (most naturally `arch-discovery-routine.ts`, since its space/time instruments already compute archguard-sourced readings that resemble `kind:"evidence"` records, or `open-semantic-discovery-routine.ts`, since its investigator/verifier/refuter already produce exactly the hypothesis/outcome shapes the store wants) call `emit(..., {writeStore:true, root})` on its own real output as a normal part of its resident round; or (b) have `discovery-method-routine.ts`'s own ingest step bootstrap-create an EMPTY, valid, schema-correct store file on first encounter (changing the semantics from "missing ⇒ refuse" to "missing ⇒ create empty, then proceed with zero records to ingest") so the gate stops being a permanent dead end while still being honest that there is nothing to ingest yet.
2. Whichever is chosen, it must not retroactively fabricate evidence for records that were never actually observed — a bootstrap-created empty store is honest; synthesizing plausible-looking evidence records to "seed" it is not and must not be done.
3. Negative control: on a host with the fix, `discovery_method`'s ingest no longer reads `failed: EVIDENCE_STORE_MISSING` purely because the file never existed; it still correctly reads some other state (e.g. "0 new outcomes to ingest") when there is genuinely nothing new, and still fails closed on a GENUINELY corrupt/unreadable store (not just an absent one).
4. No change to `discovery_method`'s own budget/call-count enforcement, and no change to the manual CLI tool's `--write-store` semantics (that path stays available for research use).

## Acceptance Criteria
- [ ] AC1: the claim above — zero production call sites pass `writeStore:true` — is re-verified at implementation time against the then-current source (grep count pasted) before any fix, so the fix targets a condition still true, not a stale reading.
- [ ] AC2: after the fix, a genuinely fresh host (no pre-existing evidence store, no quay source checkout, same clean-room methodology as the cleanroom-acceptance task) with `discovery_method` enabled produces a real round whose state is NOT `failed: EVIDENCE_STORE_MISSING` — pasted.
- [ ] AC3: the same fresh host, BEFORE the fix (on the current/pre-fix build), is shown to still fail with `EVIDENCE_STORE_MISSING` — the negative control proving the fix changes something real, not host coincidence.
- [ ] AC4: a genuinely corrupt/unreadable (not merely absent) store still fails closed with a legible reason distinct from the absent-file case — the two "nothing usable" conditions remain distinguishable (硬规则 3b: don't collapse "wasn't there" and "was there but broken" into the same reading).
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence.
- No fabricated/synthetic evidence records are ever written by this fix — only a real resident routine's own real output (option a) or an honestly-empty bootstrap (option b).
- `.quay/config.yml` budget ceilings on any host touched by verification are unchanged.

## Touches
- tasks/gap-discovery-method-evidence-store-never-autonomously-populated.md
- plugin/scripts/discovery-method-routine.ts
- docs/analysis/discovery-experience-ledger.mjs
- docs/analysis/architecture-evidence-store.mjs
- plugin/scripts/arch-discovery-routine.ts
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/discovery-method-routine.test.mjs
- plugin/test/discovery-experience-ledger.test.mjs
