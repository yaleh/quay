# Extending the quay-bootstrap experiment's verification scope to Core — discussion notes

- **Status:** discussion notes, not a resolved decision (see "Open questions" below)
- **Date:** 2026-07-15
- **Context:** captured from a live conversation between the human (Yale) and a
  Claude Code session reviewing the `quay-bootstrap` BAIME experiment
  (`experiment/`), after DIR-006 (quay-github compound/epic support) and
  DIR-007 (Core MCP server) were drafted and committed. This document records
  that discussion so it can inform a future protocol decision or an
  `ITERATION-PROMPTS.md` revision — it is **not itself** a directive, a
  protocol amendment, or an authorization to implement.

## 1. Motivation

`experiment/README.md` §1 currently scopes the experiment's instance
objective narrowly: "Implement **quay-native**." In practice, `packages/quay`
(the Core — CLI + web server + action-trigger edge) already exists as part of
the v0 walking skeleton and is exercised by several completed tasks (QN-027,
QN-031, QN-033). The question raised in this conversation: as work
increasingly touches Core (most recently DIR-007, requesting a Core MCP
server), what additional prompts/constraints does the experiment need so that
verification of Core-level behavior (CLI, MCP, Web UI, action delivery) is
done rigorously, consistently with the experiment's existing guardrails
(G1-G6, `docs/proposal/quay-bootstrap-experiment.md` §6), and without
repeating mistakes already paid for earlier in the experiment (the manda
dispatch investigation, iterations 13-18 / DIR-004 / DIR-005).

The human raised three concrete proposals; each is recorded below along with
the analysis discussed in response.

## 2. The three proposals and discussion

### 2.1 Use browser-automation MCP tooling to test/verify the Web UI

**Proposal:** verify `quay serve`'s HTML output by driving a real browser via
MCP tooling (e.g. `chrome-devtools`/`playwright` MCP servers), rather than
only asserting on raw HTTP response bodies.

**Discussion:**

- **Naming collision risk.** This project's glossary
  (`docs/proposal/glossary.md`) freezes the term "MCP" to mean specifically
  the **Provider ABI transport** (`quay-native mcp`, `quay-github mcp`, and
  the not-yet-built `quay mcp` requested by DIR-007). "Browser-automation MCP
  tooling" (chrome-devtools / playwright MCP servers available to a Claude
  Code session) is an unrelated mechanism that happens to also use the MCP
  protocol name. Any iteration prompt or task body must use language that
  keeps these unambiguous — e.g. "browser-automation tooling (chrome-devtools
  / playwright MCP)" — never bare "MCP testing," especially now that a real
  Core-level `quay mcp` will exist alongside it.
- **G5 (walking-skeleton discipline) applies directly.** `packages/quay/src/
  serve.js`'s own header comment states the Web UI is deliberately "crude but
  real... no framework, no styling beyond what's needed to prove the loop."
  Browser-driven verification must stay scoped to confirming existing
  behavior (list renders, detail renders, action-button POST fires) — it must
  not become a pretext for improving the UI's appearance or interactivity
  before the skeleton's functional loop is otherwise complete. This should be
  stated as an explicit constraint, not left implicit, given G5's own warning
  that "the bootstrap ambition amplifies" the gold-plating temptation.

### 2.2 Core CLI and Core MCP should be consistent, and both should cover Web UI functionality

**Proposal:** establish CLI/MCP symmetry at the Core level (not just the
Provider level), and ensure CLI/MCP capability is a superset of what the Web
UI exposes.

**Discussion:**

- This directly extends a principle the design doc already states at the
  Provider level: P3, "CLI/MCP symmetry" (`docs/proposal/
  quay-native-design.md` §6) — "every task-handling capability exists
  identically in CLI and MCP... the CLI is the golden test harness." Today
  this is tested only at the Provider layer (`abi-symmetry.mjs`). Lifting it
  to the Core layer is a natural generalization, not a new invention — but it
  does not yet exist as a stated contract, and there is no Core-level
  equivalent of `abi-symmetry.mjs`.
- **Current asymmetry, checked directly against the code in this
  conversation:** `packages/quay/bin/quay.js` already exposes `task list/get/
  edit/check` via CLI. The Web UI (`packages/quay/src/serve.js`) exposes only
  three routes — task list, task detail, and an action-button POST — with
  **no web-side equivalent of editing task status directly**; the action
  button is the Web UI's only write-triggering surface. So the CLI is
  already a superset of the Web UI's capability in one direction; what does
  not yet exist is a **three-way** symmetry (CLI ⟷ Core MCP, once DIR-007
  ships ⟷ Web UI), only today's two-way (Provider CLI ⟷ Provider MCP).
- **Recommended framing for a future prompt:** state this as "extend the
  existing P3 CLI/MCP-symmetry principle one layer up (Provider → Core), and
  define what 'the Web UI's functionality' concretely means (task list
  rendering, task detail rendering, action-button triggering) so that
  Core-level symmetry has the same kind of golden-test-harness discipline
  Provider-level symmetry already has" — rather than treating it as a new,
  unrelated requirement.

### 2.3 Verify action buttons via a mock/log-file delivery mode first, then verify real manda delivery separately

**Proposal:** build and verify action-button triggering against a
deterministic mock (e.g., logging the composed payload to a file) before
depending on live manda message delivery for verification.

**Discussion:**

- **Partial support already exists but isn't test-friendly.**
  `packages/quay/src/action.js`'s `deliverTrigger()` already has a
  manda-unavailable degrade path — but it only `console.log`s the composed
  command; there is no deterministic, file-based recording an automated test
  can assert against. The proposal is to add an explicit mock/file-log
  delivery mode distinct from today's print-degrade path, intended as the
  **default harness for automated verification** of action-composition logic
  — with live-manda delivery treated as a separate, additional check.
- **This directly avoids re-litigating a large, already-paid-for
  investigation.** Iterations 13-18 (see `experiment/directives/README.md`'s
  own running log, and DIR-004/DIR-005) spent substantial effort discovering
  that: the async `Dispatch` queue primitive works but nothing reliably
  claims tasks submitted to it; a genuine synchronous `Agent` fresh-context
  spawn times out (reproduced 5/5 as of iteration 15); and even dispatching
  to a session's own correctly-discovered monitor channel produces no
  execution unless a live process is actually watching that monitor's
  output (DIR-005's finding, iteration 18). **Any future prompt built from
  this proposal must explicitly instruct: do not re-discover these findings
  from scratch — cite and build on DIR-004/DIR-005 directly** — and must not
  make an automated test's pass/fail hinge on live manda delivery succeeding,
  since that has been repeatedly shown to be a per-session, per-moment fact,
  not a reliably available one.

## 3. Additional constraints identified during discussion (not raised by the original three proposals)

1. **Scope-declaration mechanism.** `experiment/README.md` §1 currently
   scopes the instance objective to "quay-native" only. Whether validating
   Core (Web UI / Core CLI / Core MCP / action delivery) requires an explicit
   update to that scope statement, or is already implicitly covered (since
   `packages/quay` is already part of the v0 walking skeleton the instance
   objective depends on), was raised as an open question — see §4.
2. **V_instance/V_meta attribution must be decided before work starts.**
   Which value-function factor (existing `skeleton`, or a new factor) credits
   Core-level three-way symmetry work and action-delivery mock verification
   needs to be settled in advance, to avoid a repeat of the extended
   `effectiveness`-attribution debate seen in iterations 21-24
   (`experiment/iterations/iteration-{21,22,23,24}.md`).
3. **G3 (out-of-band audit) must extend to Core.** If a future Core MCP
   server (DIR-007) is used as evidence toward quay-native's own
   self-certification claims, the independent audit mechanism (G3) must
   explicitly cover Core-level code too — quay-native's own gate must not be
   the sole judge of Core's correctness, the same "no self-certification"
   principle the protocol already applies at the Provider level.
4. **Directive vs. protocol-document distinction.** DIR-006 and DIR-007 are
   narrow, single-finding/single-action directives — the right mechanism for
   discrete implementation requests. The broader question this document
   records ("what general prompts/constraints should govern all future
   Core-scope work") is a different kind of change: it likely belongs in
   `experiment/ITERATION-PROMPTS.md` (the artifact the `baime:
   iteration-prompt-designer` agent maintains) rather than in another
   single-purpose directive file.

## 4. Open questions (not resolved by this document)

- Does extending verification to Core require a formal protocol decision
  (via `docs/proposal/quay-bootstrap-experiment.md` §10's resolved-decisions
  process), or is it already within the existing instance objective's scope
  since `packages/quay` is already part of the v0 skeleton?
- Which V_instance/V_meta factor(s) should credit this work?
- Should `experiment/ITERATION-PROMPTS.md` be revised to encode the
  constraints in §2-§3 above, and if so, in what form?

This document intentionally stops at recording the discussion and the
analysis behind it — no protocol amendment, `ITERATION-PROMPTS.md` edit, or
new directive has been made as part of writing it.
