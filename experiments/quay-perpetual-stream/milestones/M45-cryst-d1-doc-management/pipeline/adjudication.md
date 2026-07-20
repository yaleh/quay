# exp5-M-CRYST-D1 — quay-task-to-plan pipeline: adjudication (Stage 6.3)

## Convergence vs divergence call

**DIVERGED** on two real approach-level questions (not merely framing differences):

1. **Store architecture.** Proposal 1: a wholly new sibling module `document-store.js` (independent
   of `adr-store.js`, same shape). Proposal 2: extend/alias `adr-store.js` itself with a second
   factory function sharing its `{list,get,write}` implementation.
2. **Real-landing retrofit target.** Proposal 1: `.claude/skills/quay-directive/SKILL.md` (small,
   stable, low blast-radius). Proposal 2: `OUTER-LOOP.md` itself (max-stakes, actively-loop-edited
   driver document).

Both proposals agree on: a separate `contract-validator.js` module (pure function, single-source),
`contracts:` frontmatter with `grep`/`not-grep`/`target:self` shape (matches task AC1 verbatim), and
wrapping the validator as a new named `quay gate` factory (E3 precedent, wrap-a-script/wrap-a-check
pattern, no duplicated process-spawn logic).

## Adjudicated decision

**1. Store architecture: ADOPT Proposal 1 (new sibling `document-store.js`).** E1's own header
comment (quoted verbatim by proposal 1) is a direct, on-record design rationale from THIS
codebase's own prior milestone: "This store is deliberately independent of store.js... keeping the
two stores separate is the whole point of the ADR/task split." That same argument transfers exactly
to ADR-vs-document: an ADR's lifecycle (`proposed→accepted→superseded/deprecated`, a DECISION) is
semantically distinct from a document's lifecycle (a MANAGED ARTIFACT, no accept/reject decision
step) — reusing `adr-store.js`'s `VALID_ADR_STATUSES` for documents would either force ADR-shaped
statuses onto plain docs or require forking that array per-kind inside the same file, which is
exactly the kind of implicit two-kinds-in-one-module coupling E1 rejected. Proposal 2's "90% shared
code" argument is real but is better addressed by FACTORING OUT the shared frontmatter
parse/serialize/lock/list-filter helpers into a small shared internal module (e.g.
`frontmatter-store-base.js`) that BOTH `adr-store.js` and `document-store.js` import — preserving
proposal 2's DRY concern without proposal 2's architectural coupling. **Adopted: new
`document-store.js` (independent object kind, own directory `docs-managed/`), refactoring the shared
frontmatter/lock/list-filter logic out of `adr-store.js` into a small shared helper both stores
import — synthesizing the two proposals' best point each, not just picking one wholesale.**

**2. Real-landing retrofit target: ADOPT Proposal 1 (a skill file), REJECT retrofitting
OUTER-LOOP.md itself, for a concrete safety reason not weighed by either proposal alone.** Per this
milestone's OWN dispatch instructions and DIR-027/031 hygiene: OUTER-LOOP.md is the loop's own live
driver document, edited by every milestone that touches methodology, and per invariant 2
("Never perturb an in-flight inner milestone... Human async input handled at milestone boundary")
plus the DIR-027 human-steering-hygiene concern about racing edits to files the loop concurrently
authors — retrofitting a `contracts:` frontmatter block onto OUTER-LOOP.md from an ISOLATED WORKTREE
branch risks exactly the DIR-013 concurrent-edit class of problem if this worktree's change needs to
merge against a since-advanced `master` copy of that same file (this repo's git history already shows
two prior real instances of exactly this race, DIR-013/DIR-018). A skill file
(`.claude/skills/quay-directive/SKILL.md`) is materially lower-risk (rarely touched mid-loop,
narrower blast radius) while fully satisfying the task's own AC2 wording ("e.g. a skill or
OUTER-LOOP" — explicitly offers the skill as the primary example, OUTER-LOOP as an alternative, not
a requirement). **Adopted: retrofit `.claude/skills/quay-directive/SKILL.md`** with a `contracts:`
block asserting ≥1 real, currently-true load-bearing rule from that skill's own prose (e.g. "never
overwrite an existing `label:directive` task on repeat invocation" or the task-canonical/no-file-
projection rule DIR-028 established) — chosen at implementation time by reading the skill file
directly and picking the clearest currently-grep-able assertion, and ALSO construct one synthetic
non-conforming fixture doc (never a real doc deliberately broken) to prove the FAIL path, per the
task's own AC1 "a non-conforming doc is flagged (not silently passed)" wording.

**3. Gate-wiring convention: SYNTHESIS.** Neither `makeAdrGate` (external command string) nor a
generic reuse is quite right — a document's `contracts:` check is validated IN-PROCESS against the
document's own live body content (not an external shell command), so it needs its OWN factory,
`makeDocumentContractGate(docId, docDir)`, structurally parallel to `makeAdrGate` (same fail-closed-
on-missing/malformed shape, same `{ok, reason}` return contract) but calling
`contract-validator.js`'s `validateContracts()` directly rather than shelling out via
`runAcceptance`. Registered under gate name `doc-<id>` (lowercased, matching the `adr-<id>` naming
convention exactly).

## Alternatives considered and rejected (preserved per Stage 6.3.c)
- Proposal 2's shared/aliased single-store approach — rejected for the ADR/document semantic-
  lifecycle-coupling reason above, but its DRY concern is honored via a shared internal
  frontmatter-store-base helper (not a rewrite from scratch — folded in).
- Proposal 2's OUTER-LOOP.md retrofit target — rejected for the concrete DIR-013/DIR-018 concurrent-
  edit race risk on the loop's own live driver document; proposal 1's skill-file target adopted
  instead, matching the task AC's own primary ("e.g. a skill") wording.
- A single generic gate factory shared between ADR/document (considered, neither proposal proposed
  it explicitly) — rejected: the external-command-string vs. in-process-validation execution shapes
  are different enough that forcing one factory would need an internal branch on "is this ADR-shaped
  or doc-shaped," reintroducing exactly the coupling avoided in decision 1.

## Write-back
Adjudicated proposal written to `tasks/exp5-M-CRYST-D1.md`'s `## Proposal` section (full-section
replace, idempotent) via direct file edit in this worktree (this session's provider write path —
`mcp__quay__task_write` targets the MAIN tree's `.quay/config.yml`-configured tasks dir, not this
isolated worktree's copy; per DIR-027 isolated-worktree-build convention, this worktree's own copy of
`tasks/exp5-M-CRYST-D1.md` is edited directly and reconciled at ABSORB merge, matching how M42/M43/
M44's own worktree-local task edits were folded in at their respective merges). Read back via `Read`
tool (evidence below).
