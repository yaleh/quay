---
id: exp5-M-CRYST-D1
title: D1 quay DOCUMENT-MANAGEMENT capability (contract-validator as a quay
  feature; formalized-style + self-verifying contracts enforced by quay)
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:M45-cryst-d1-doc-management
parent: exp5-M-CRYST
children: []
extra:
  schema: "v1"
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-CRYST-D1
    experiments/quay-perpetual-stream/charters/M45-cryst-d1-doc-management.md
    /tmp/m45-absorb-entry.md
  auditIndependenceArgs:
    - --orchestrator-id
    - m45-inner-worker-builder-session
    - /tmp/m45-absorb-entry.md
---
## Proposal
**(Reconciled M45, quay-task-to-plan pipeline — see `experiments/quay-perpetual-stream/milestones/
M45-cryst-d1-doc-management/pipeline/{proposals,adjudication}.md` for the full N=2 + adjudication
record.)** Add a new sibling doc-management object kind — `packages/quay-native/src/
document-store.js` — independent of `adr-store.js` (same E1 rationale: an ADR's decision-lifecycle
is semantically distinct from a plain managed document's lifecycle; factor the SHARED frontmatter
parse/serialize/lock/list-filter logic out of `adr-store.js` into a small shared internal helper
both stores import, to honor DRY without coupling the two kinds). Frontmatter carries `id`, `title`,
`kind`, `status`, and a NEW `contracts:` field — a list of `{target:"self", type:"grep"|"not-grep",
pattern, description}` self-verifying assertions (matches this task's own AC1 wording verbatim). A
new single-source `contract-validator.js` (pure function `validateContracts(doc)` → `{ok, results}`)
runs each assertion against the document's own body. Wrap it as a new `doc-<id>` gate-factory in
`packages/quay/src/gate/registry.js` (`makeDocumentContractGate`, structurally parallel to E3's
`makeAdrGate` — same fail-closed-on-missing/malformed shape — but validating in-process against the
document's own `contracts:` block rather than shelling out to an external command, since a
document's contract is checked against its OWN live content, not run as an external process).
**Real end-to-end target:** retrofit `.claude/skills/quay-directive/SKILL.md` (a real, existing
method doc) with a `contracts:` block asserting ≥1 currently-true load-bearing rule from its own
prose; construct one synthetic non-conforming fixture doc to prove the FAIL path (never deliberately
break a real doc). `OUTER-LOOP.md` itself was considered and REJECTED as the retrofit target — see
adjudication.md decision 2 (DIR-013/DIR-018 concurrent-edit race risk on the loop's own live driver
document; the task's own AC2 wording offers "a skill" as the primary example). Unblocks D2/D3-§9
(contracts validated BY quay) and E2 back-links.
## Plan
N/A — product code across packages (a Core doc-management kind + contract-validator, reached via the Provider ABI, like E1); strict TDD per ADR-001 (red→green, ≥80% coverage); no staged docs/plans doc warranted. Milestone-level plan record: `experiments/quay-perpetual-stream/milestones/M45-cryst-d1-doc-management/pipeline/plan.md`.
## Acceptance Criteria
- [x] quay validates a document's self-`contracts:` (grep/not-grep, `target:self`) and surfaces conformance; a non-conforming doc is flagged (not silently passed).
- [x] A real method doc (e.g. a skill or OUTER-LOOP) is managed + validated through quay end-to-end; single-source (the contract logic lives once, a gate wraps it).
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [x] A REAL method doc is managed + validated through quay (not a fixture) — the contract-validator flags a real non-conforming doc.
- [x] Strict TDD (product code); no dual source (validator logic once, wrapped by a gate); unblocks D2/D3-§9/E2.

## Not selected (M41)
DIR-030 explicitly requires the observe-and-enforce cluster (G1→E3→DIR022-REMAINING→INV) to land BEFORE D1, with D1 not selectable until ≥3 of the four have landed. Not selected this pass (0/4 landed so far) — foundational but per DIR-030's steer, deferred until the window closes.

## Not selected (M42)
Still gated by DIR-030 (1/4 — only G1 — landed after m41). This pass selects exp5-M-CRYST-E3 (item 2 of 4) per DIR-030's ordering. D1 remains ineligible until ≥3/4 land.

## Not selected (M43)
2/4 landed (G1, E3). Still short of the ≥3/4 threshold — D1 remains ineligible. This pass selects `exp5-M-DIR022-REMAINING-GATES` (item 3 of 4) per DIR-030's ordering.

## Not selected (M44)
DIR-030's window closed at m43 ABSORB (3/4 landed) — D1 becomes ELIGIBLE for the first time this
pass, and is a real, ready, foundational candidate (capability-growth). NOT selected anyway: this
pass's live candidate set also contains DIR-032 (audit independence), a `governance-integrity`
+ `risk/option`-typed candidate that is actively degrading the loop's strongest verification gate
(the ABSORB adversarial audit) EVERY milestone it remains open — three consecutive occurrences
(M41/M42/M43) of the exact silent-self-audit-fallback failure mode DIR-032 diagnoses. Applying
`inherited-core.md`'s ranking discipline ("a candidate with zero/negative VT Δv̂ but a
governance-integrity/risk-option type can and should outrank a positive-VT capability-growth
candidate when the non-VT risk is higher"): DIR-032 outranks D1 this pass. D1 is fully eligible and
should be the FIRST candidate considered at the m45 SELECT once DIR-032 lands (or is itself
resized/deferred with justification) — it is not being re-gated by any directive, only outranked
for this one pass by a higher-priority governance-integrity risk.

## SELECTed (M45)
This pass re-DRAINed the task store (`task_list --label directive`: 0 with `extra.dirStatus:
pending`; `task_list --label milestone-candidate --status todo`: no new human-authored or
`label:human-steered`-cleared item landed since M44) and confirmed no out-of-band human commit
landed on `master` since M44 ABSORB (`git log`/`git status` clean, `e800326` is current HEAD).
DIR-032 (the item that outranked D1 at M44) is now `done`/`resolved` — no competing
governance-integrity/risk-option candidate at the same urgency is currently open. Compared against
the other open, non-`human-steered` crystallization candidates (`INV`, `B4`, `E2`,
`D4-LEDGER-STRUCTURED-STATUS`, `C1`, `B6-VALIDATOR-COVERAGE`, `B5-PARSER-UNIFY`) — each is a small
design/instrument-correction fix with no active-degradation urgency comparable to what DIR-032
carried; none is cited by any pending directive this pass. Per M44 ABSORB's own note, D1 is "the
FIRST candidate considered at the m45 SELECT" — **SELECTed this pass** as the leading eligible
capability-growth candidate. Dev-class (real product code: Core doc-management kind +
contract-validator per DIR-014/5a two-class routing) — routed through the `quay-task-to-plan`
pipeline. See charter `experiments/quay-perpetual-stream/charters/M45-cryst-d1-doc-management.md`.