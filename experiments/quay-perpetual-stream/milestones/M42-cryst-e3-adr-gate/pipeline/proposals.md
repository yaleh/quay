# exp5-M-CRYST-E3 — quay-task-to-plan pipeline: proposal step (Stage 6.2)

**Process-fidelity note (state honestly, per m41's own precedent):** no `baime:iteration-executor`
or other genuinely-isolated Task-agent dispatch tool was reachable in this orchestrator session (same
finding as M41-cryst-g1-observability). The two "independent" proposals below were drafted
sequentially by the SAME orchestrator context, with proposal 2 deliberately NOT re-reading proposal
1 before drafting its own approach section (a weaker substitute for true blank-slate independence —
same-context anchoring risk is real and not eliminated). This is recorded here as a known
limitation of this pass's execution, not hidden. The adjudication step below treats this limitation
explicitly.

## Proposal 1 — persona: "minimal-surface-area approach"

**Approach:** Add exactly ONE new generic gate-factory function to `packages/quay/src/gate/
registry.js`, `makeAdrGate(adrId, { adrDir })`, mirroring `makeIt0Gate`'s shape: given a fixed ADR id,
at gate-run time it (a) reads the ADR via `createAdrStore(adrDir).get(adrId)`, (b) reads its
`enforcement` field (a shell command string, reusing the SAME convention as `task.extra.acceptance`
— NOT a new args-array convention), (c) fails closed if the ADR is missing/not-`accepted`/has no
`enforcement`, (d) otherwise shells out via the existing `runAcceptance` runner exactly like
`acceptance` does. Register exactly one entry, `"adr-001": makeAdrGate("ADR-001", {...})`, in
`gateRegistry` — a static, explicit key (gate names are static object keys already, per
`engine.js`'s `gateRegistry[gate]` lookup; there is no dynamic-lookup mechanism today and this
proposal does not add one). `adr-store.js`'s view-model gains `appliesTo`/`enforcement` fields
(reading the already-reserved frontmatter keys) — pure additive change, no behavior change to
existing consumers. The consult surface is a new `quay-native adr list --applies-to <path>` CLI flag
(and MCP passthrough) doing a minimatch-style glob test against each `accepted` ADR's `applies-to`
array, reusing `adr-store.js`'s existing `list()` filter shape (adding one more filter predicate,
same pattern as `filter.status`/`filter.tag`).

**Key design decisions:**
- Reuse `task.extra.acceptance`'s "command string" convention for `enforcement`, NOT the
  `impl-row`/`line-budget` "args array" convention — because an ADR's enforcement is a fixed,
  self-contained command (e.g. `bash .../loadbearing-test-gate.sh --scripts ... --tests ...`), not a
  wrapper around one shared script with per-task varying args. This keeps the ADR frontmatter
  self-describing (the full runnable command is right there) without inventing a 3rd convention.
- Register `adr-001` as a fixed, hardcoded key — because `gateRegistry` has no dynamic-lookup path
  today; adding one is a larger, riskier change than this task's scope needs (the AC only requires
  ADR-001 wired, not a self-registering system for every future ADR).
- The consult surface lives on `adr-store.js`'s existing `list()` (extend, don't fork).

**Alternatives considered and rejected:**
- A generic dynamic gate resolver (`gateRegistry` proxy that resolves any `adr-<NNN>` key on first
  access by consulting the ADR store) — rejected as over-engineering for THIS task's AC (only
  ADR-001 needs to be concretely wired); would also require `engine.js` changes (currently a plain
  object lookup) that risk regressing the 4 existing gates. Note for a future task if more ADRs
  need wiring.
- Storing `enforcement` as an args-array like `impl-row`/`line-budget` — rejected because an ADR's
  enforcement command is genuinely ADR-specific (not one shared script), so the args-array
  convention (built for "one fixed script, varying args") doesn't fit; the acceptance-style full
  command string fits better.

## Proposal 2 — persona: "approach most consistent with existing patterns in this codebase"

**Approach:** Nearly identical mechanism to Proposal 1 (this is expected — the registry's
wrap-a-script pattern is unambiguous from reading `registry.js`'s own comments), with two
differences: (1) treat `enforcement` as a STRUCTURED field (an object `{ check: "loadbearing-test",
args: [...] }` referencing a small internal map of named checks — e.g. `loadbearing-test` →
`loadbearing-test-gate.sh` — rather than a raw shell command string), reasoning that a raw shell
command in ADR frontmatter is a portability/security smell (arbitrary shell in a markdown file,
unlike `task.extra.acceptance` which is scoped to one task the human/loop authored directly) — an
ADR is a broader-audience, longer-lived artifact than a task. (2) generalize the gate registration
via a SMALL declarative table (`ADR_GATES = { "ADR-001": { checkName: "loadbearing-test", args:
[...] } }`) at the top of `registry.js`, built once at module load by iterating the table and calling
`makeAdrGate` per entry — so adding ADR-002's gate later is a one-line table addition, not a second
copy-pasted `makeAdrGate(...)` call site.

**Alternatives considered and rejected:**
- A raw shell-command `enforcement` string (Proposal 1's choice) — considered, but a structured
  `{check, args}` shape avoids putting an arbitrary shell command in a doc humans/agents edit
  directly, and is easier to validate/lint later (a mistyped shell command silently fails at gate-run
  time either way, but a structured field can be schema-validated ahead of that).
- A fully dynamic per-ADR-id gate resolver (same as Proposal 1's rejected alternative) — same
  rejection reasoning (out of this task's AC scope).

## Convergence / divergence assessment (for the adjudication step)

**Converge on:** the core mechanism (a `makeAdrGate`-shaped factory, wrapping `runAcceptance`, wired
as a static `"adr-001"` `gateRegistry` entry; `adr-store.js` view-model extended to surface
`applies-to`/`enforcement`; consult surface extends `list()`'s existing filter shape). Both
proposals independently reach the SAME conclusion on the "no dynamic resolver, no `impl-row`-style
args-array" points — this is a real convergence signal (both proposals reasoned from the SAME
registry.js precedent and reached the same "don't over-engineer beyond the AC" judgment), not an
artifact of one proposal copying the other verbatim.

**Diverge on:** how `enforcement` is SHAPED in the ADR frontmatter — Proposal 1's raw command string
(byte-compatible with `acceptance`'s existing convention) vs Proposal 2's structured
`{check, args}` object (a small new schema, requires a lookup table). This is a real, material
divergence (changes the ADR frontmatter shape + the reader's mental model), not framing-only.
