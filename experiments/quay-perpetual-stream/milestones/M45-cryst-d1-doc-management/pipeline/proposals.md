# exp5-M-CRYST-D1 — quay-task-to-plan pipeline: proposal step (Stage 6.2)

**Process-fidelity note (state honestly, per M41/M42/M43/M44's own precedent):** no genuinely
isolated Task-agent dispatch tool is reachable from this nested background-subagent session
(`mcp__plugin_manda_manda__Agent` errors with "cap request requires to=" — no addressed broker
configured; `ToolSearch` surfaces no `baime:iteration-executor`-equivalent dispatch tool usable
here). This is the SAME finding M41/M42/M43/M44 each independently hit, and is explicitly expected
per THIS milestone's own dispatch instructions (DIR-032: a nested subagent cannot spawn further
subagents). The two "independent" proposals below were drafted sequentially by the SAME
orchestrator context, with proposal 2 deliberately NOT re-reading proposal 1's Approach/Key-design-
decisions sections before drafting its own (a weaker substitute for true blank-slate independence —
same-context anchoring risk is real and not eliminated). Recorded honestly, not hidden. Adjudication
below treats this limitation explicitly, per the established M42/M43 precedent.

## Proposal 1 — persona: "minimal-surface-area approach, reuse E1/E3 verbatim"

**Approach:** Add exactly ONE new doc-management object kind, `document`, as a sibling store to
`adr-store.js` — `packages/quay-native/src/document-store.js` — same shape: YAML-frontmatter `.md`
files under a new `docs-managed/` (or reuse `adr/` with a `kind:` discriminator field — REJECTED,
see below) directory, `{list, get, write}` API, lockfile-guarded writes. Frontmatter carries
`id`, `title`, `kind` (e.g. `skill`/`outer-loop`/`methodology-doc`), `status`, and the NEW field
`contracts` — a list of self-verifying assertion objects, each `{ target: "self", type: "grep"|
"not-grep", pattern: <string>, description: <string> }` (the `grep`/`not-grep` + `target:self` shape
the task's own AC1 names verbatim). A new `contract-validator.js` module (single-source, pure
function `validateContracts(doc)` → `{ ok, results: [{pattern, type, ok, description}] }`) reads a
document's own `contracts:` block and runs each assertion against the document's OWN body (grep for
`type:"grep"`, must-NOT-match for `type:"not-grep"`) — reusing Node's built-in `RegExp`/string
`.includes` test, no new dependency. Wrap it as a new `doc-<id>` gate-factory in
`packages/quay/src/gate/registry.js`, mirroring `makeAdrGate`'s exact shape (E3 precedent: read at
gate-run time, fail closed on missing doc / missing `contracts:` field). A CLI/MCP consult surface
(`quay-native doc validate <id>`) prints the per-assertion pass/fail table. The real end-to-end
target doc: retrofit ONE existing skill (`.claude/skills/quay-directive/SKILL.md` — small, stable,
already has clear load-bearing prose rules to assert against) with a `contracts:` frontmatter block
(NOT the OUTER-LOOP.md file itself — riskier, larger, actively-edited-by-the-loop file; retrofitting
a skill file is lower-risk and still satisfies AC2's "a real method doc" requirement).

**Key design decisions:**
- New `document-store.js`, NOT reusing `adr-store.js` with a kind discriminator — because ADRs have
  a decision-lifecycle (`proposed→accepted→superseded/deprecated`) that is semantically DIFFERENT
  from a document's lifecycle (methodology docs don't get "superseded" the same way, and forcing a
  shared store would either leak ADR-only fields onto documents or require a lifecycle union type —
  E1's own header comment explicitly says "deliberately independent of store.js... keeping the two
  stores separate is the whole point of the ADR/task split" — the SAME argument applies to ADR vs.
  document).
- `contracts:` uses `grep`/`not-grep` string-pattern matching only (no full regex-DSL, no
  cross-file `target` beyond `self` in v1) — the task's own AC1 explicitly scopes to
  "grep/not-grep, target:self"; anything broader is out of scope and risks the same over-build
  DIR-026 warns against.
- The gate-factory pattern is a direct lift of `makeAdrGate` (E3 precedent) — no new wrap-a-script
  convention invented.
- Retrofit `quay-directive` SKILL.md (not OUTER-LOOP.md) as the real target — smaller blast radius,
  still satisfies "a real method doc... managed + validated through quay end-to-end."

## Proposal 2 — persona: "most consistent with existing patterns, favor Provider ABI extension"

**Approach:** Rather than a brand-new sibling store, extend the EXISTING Provider ABI view-model
with a new `kind` field on ADR-store-like objects generally, so "document" is a `kind: "doc"`
variant sharing `adr-store.js`'s existing `{list,get,write}` implementation (rename the module
conceptually to a generic "decision/document record store" but keep the file `adr-store.js` for
git-blame continuity, exporting a second factory `createDocumentStore(docDir)` that is a thin
re-export/alias of `createAdrStore` pointed at a different directory and a relaxed `VALID_STATUSES`
list appropriate to docs (`draft/active/retired` instead of ADR's decision-lifecycle statuses). The
contract-validator is a SEPARATE new module (`contract-validator.js`) exactly as proposal 1 — no
disagreement there — but registered as a gate via a NEW generic `makeContractGate(id, docDir)`
factory (parallel to, not literally reusing, `makeAdrGate`, since the contract check is validated
against the document's OWN `contracts:` block content, not a fixed external command string like
`enforcement`). The real end-to-end target doc: retrofit **OUTER-LOOP.md itself** (max real-stakes
demonstration — the actual "operational loop" driver document — since the task's AC2 says "e.g. a
skill OR OUTER-LOOP", and proving the mechanism against the highest-stakes, most-actively-referenced
doc in this experiment is the strongest possible real-landing evidence), retrofitting one paragraph
(e.g. invariant 3's gate-hash transclusion rule) with a `contracts:` block asserting the literal
gate-hash-check script name appears (`not-grep` for a stale mention of a retired mechanism, `grep`
for the current one).

**Key design decisions:**
- Reuse `adr-store.js`'s existing `{list,get,write}` machinery via a second factory function in the
  SAME file, rather than a wholly separate store module — argues this is less code and the two
  stores really do share 90% of their shape (frontmatter parse/serialize/lock/list-filter), so a
  literal second file duplicates that 90%.
- Target OUTER-LOOP.md itself for the real-landing proof, for maximum stakes/credibility.
- `contracts:` gate wired via a new but structurally-parallel factory (not literally
  `makeAdrGate` reused, since ADR's `enforcement` is an external command string while a document's
  `contracts:` is validated in-process against the doc's own body — different execution shape).
