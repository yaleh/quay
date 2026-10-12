---
id: gap-discovery-method-registry-and-versioned-contract
title: "Discovery Method: versioned domain contract + append-only registry
  (Phase 0 of the self-bootstrapping discovery loop)"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
This is Phase 0 of the single-layer self-bootstrapping Discovery Method loop. It is NOT a new detector and NOT a new scheduler. Scope check against what already exists, so this doesn't duplicate it:

- `docs/analysis/architecture-evidence-store.mjs` already has a generic FINDING-level carrier (`evidence`/`hypothesis`/`experiment`/`outcome`/`counterexample`/`repair_attempt`, validated by `validateRecord`, keyed by `subjectKey`). That store records ONE discovery's evidence trail. It has no concept of a reusable METHOD — a named, versioned "how to look for this class of problem" — that could apply across many unrelated findings.
- `docs/analysis/architecture-decision-memory.mjs` is a static seed of 3 exempted-finding entries with no write path. It records "this specific finding was already judged," not "this general method works/doesn't."
- The `arch-discovery` routine (`plugin/scripts/arch-discovery-routine.ts`) and the two `arch-discovery-{space,time}.mjs` instruments are themselves FIXED, hand-written detectors (checker-exit-code split, Touches-parser reuse, etc.). They are candidate CONSUMERS of a method registry later, not the registry itself.
- No existing module lets a method be versioned, retired, or deduplicated against a sibling method.

So this task adds exactly one thing: a versioned `DiscoveryMethod` domain contract + an append-only registry module, with no detection logic and no scheduler of its own.

## Plan
1. New module `docs/analysis/discovery-method-registry.mjs`, same convention as `architecture-evidence-store.mjs` (pure functions + one fixed append-only carrier relative path, `.quay/discovery-method-registry.jsonl`, gitignored).
2. `DiscoveryMethod` record shape (one immutable version per record; editing a method APPENDS a new version, never rewrites history — same shrink-only/append-only discipline as the evidence store):
   ```
   {
     method_id: string,              // stable across versions, e.g. "shared-contract-divergence"
     version: integer,               // 1, 2, 3... monotonic per method_id
     ts: ISO-8601,
     provenance_evidence: string[],  // >=1 ref into architecture-evidence-store.jsonl (evidence/outcome records) OR a teaching-case id (Phase 1) — a method with zero provenance is refused
     applicability: { domain_signals: string[], preconditions: string[] },  // free-text but non-empty; checked for substance (>=20 non-whitespace chars joined), never a boolean "applies: true"
     operation: { steps: string[], tools: string[] },  // the tools list must name only EXISTING capability-catalog entries or evidence-store primitives — checked against capability-catalog.sh output, not asserted
     expected_invariant: string,     // the general claim form this method tests FOR (not a fixed enum — free text, so Phase 2 generation is not boxed into a pre-declared invariant taxonomy)
     falsification: string,          // what observation would refute a candidate this method produces — required, same discipline as hypothesis.counterexample_requirement
     cost_budget: { max_candidates: integer, max_model_calls: integer, max_wall_ms: integer },
     status: "draft" | "active" | "retired",
     retirement_reason: string | null,   // required non-null when status="retired"
     supersedes: string | null,      // method_id this version replaces, or null
   }
   ```
3. `validateMethodRecord(rec)`: same shape as the evidence store's `validateRecord` — returns `{ok, reasons[]}`, never silently drops a bad field. Refuses: empty `provenance_evidence`, empty `falsification`, `status="retired"` with no `retirement_reason`, a `tools` entry not found in the capability catalog, and a `version` that is not `(highest existing version for this method_id) + 1`.
4. `appendMethodRecord(root, rec)`: validates first, appends only if valid — mirrors `appendRecord` in the evidence store (reuse its `sha256`/file-append primitives directly via import, do not re-implement them).
5. `readMethodRegistry(root)`: returns the LATEST version per `method_id` (plus full history on request) — never silently returns a stale version as if it were current.
6. `dedupMethods(registry)`: a pure function flagging method PAIRS whose `applicability.domain_signals` ∩ `operation.tools` overlap above a reported (not hidden) threshold — this is a REPORT, not an auto-merge. The task that calls it decides; this task only builds the detector.
7. Declare the new carrier in `docs/carrier-registry.json` and the new script file in `plugin/scripts/capability-catalog-declarations.json` if the module is later promoted into `plugin/scripts/` — for THIS task it stays under `docs/analysis/` (same placement as the evidence store), so capability-catalog declaration is not required; confirm this placement rule by checking whether `architecture-evidence-store.mjs` itself has a capability-catalog entry, and match whatever that answer is.
8. No CLI wiring, no routine wiring in this task. This task's only artifact is the module + its tests + a reproduction command.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-method-registry.test.mjs` exits 0, covering:
  - (a) a well-formed draft method is accepted and appended;
  - (b) empty `provenance_evidence` is refused with a distinct reason code;
  - (c) empty `falsification` is refused;
  - (d) `status:"retired"` with `retirement_reason:null` is refused;
  - (e) a `tools` entry not present in a fixture capability-catalog listing is refused;
  - (f) writing version 3 when only version 1 exists (skipping 2) is refused;
  - (g) `readMethodRegistry` returns only the latest version per `method_id` by default, and the full history when asked;
  - (h) `dedupMethods` flags a fixture pair sharing domain_signals and tools, and does NOT flag an unrelated pair.
- [ ] Real reproduction: register ONE real method record using provenance that already exists in `.quay/architecture-evidence-store.jsonl` — point `provenance_evidence` at the outcome record with `experiment: "E-HYPGEN-AB-1-B"`, `experiment_ref: "E-HYPGEN-AB-1-B cluster 8"` (subject_key names `per-task-suite-record.ts` / `per-task-suite-record-check.ts`; this is the REQUIRED_FIELDS duplication, done task `gap-per-task-suite-record-required-fields-declared-twice`). Verify that record actually exists with `jq` before citing it. Call the method `shared-contract-divergence-v1`. Paste the full record, the validator result (`ok:true`), and the line it appended to `.quay/discovery-method-registry.jsonl`.
- [ ] Mutation control: temporarily drop the version-monotonicity check and show that writing version 1 twice (silently overwriting) is no longer refused — i.e., prove the check is load-bearing, not decorative. Paste the before/after, then restore the check.
- [ ] `dedupMethods` run over the registry after the real write above reports 0 pairs (only one method exists) — paste the output. This is a negative control: the detector must not fabricate a pair from one record.

## Definition of Done
- All AC ticked with command output pasted.
- `scripts/test.sh --for-task gap-discovery-method-registry-and-versioned-contract` green.
- No detection logic, no routine, no CLI verb added by this task — confirmed by the Touches list below being exhaustive.

## Touches
- tasks/gap-discovery-method-registry-and-versioned-contract.md
- docs/analysis/discovery-method-registry.mjs (new)
- plugin/test/discovery-method-registry.test.mjs (new)
- docs/carrier-registry.json
