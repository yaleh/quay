# DIR-009

- status: pending
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-15
- title: Add a deterministic mock/log-file action-delivery mode to `packages/quay/src/action.js`, distinct from today's print-only degrade path

## Finding

`docs/proposal/quay-core-scope-expansion-discussion.md` §2.3 (a discussion
document, not itself a directive — read in full there for the underlying
reasoning) records a proposal, discussed directly with the human: verify
action-button triggering against a deterministic mock (e.g. a file-based
delivery log) before depending on live manda message delivery for
automated verification.

A direct read of `packages/quay/src/action.js`'s current `deliverTrigger()`
confirms the gap named in that discussion still exists as of this
directive:

```
export async function deliverTrigger({ root, channel, payloadObj }) {
  const haveManda = await mandaAvailable(root);
  if (haveManda) {
    ...
    return { delivered: "manda", channel };
  }
  console.log(`[quay action run] manda not available — degraded delivery.`);
  console.log(`Run this to drive the task:\n  ${payloadObj.payload}`);
  ...
}
```

The manda-unavailable path only `console.log`s the composed command —
there is no deterministic, file-based record an automated test can assert
against. Any test of action-composition logic that isn't live-manda-gated
today has to scrape stdout or skip verifying delivery entirely.

This discussion also explicitly names a standing constraint this
directive must respect, already codified in `experiment/ITERATION-PROMPTS.md`'s
"§Core-scope work" section (added by DIR-008): **do not re-discover the
manda-dispatch findings from iterations 13-18 from scratch — cite and
build on `experiment/directives/archive/DIR-004-*.md` and
`experiment/directives/archive/DIR-005-*.md` directly** — and do not make
any automated test's pass/fail hinge on live manda delivery succeeding,
since that has been repeatedly shown to be a per-session, per-moment
fact, not a reliably available one. This directive's whole point is to
give action-composition logic a delivery mode that sidesteps that
per-session unreliability entirely, not to re-verify or depend on it.

## Requested action

A future iteration should add a new, explicit mock/file-log delivery mode
to `deliverTrigger()` (or an equivalent clearly-named function), intended
as the **default harness for automated verification** of action-composition
logic — with live-manda delivery remaining a separate, additional,
non-gating check. Concretely:

1. Add a third delivery mode (alongside the existing `manda` path and the
   existing stdout-print degrade path) that, when selected, writes the
   composed payload deterministically to a file (path supplied by the
   caller, e.g. via config or an explicit parameter — the exact
   activation mechanism, env var vs. config flag vs. constructor option,
   is this task's own design decision to make and record) instead of
   only printing it. The record must be structured (e.g. JSON lines: one
   record per delivery attempt, including at minimum `channel`,
   `payload`, and a timestamp field) so an automated test can parse and
   assert on it precisely, not scrape freeform text.
2. `deliverTrigger()`'s return value for this mode should be
   distinguishable from both existing modes (e.g. `{ delivered: "mock",
   ... }`), so callers and tests can tell which path actually ran.
3. Add a committed, network-independent regression test exercising this
   new mode end-to-end (compose a real trigger payload via the existing
   action-composition code path, call `deliverTrigger()` with the mock
   mode selected, assert on the resulting file's structured content) —
   matching the evidentiary standard already used elsewhere in this repo
   (e.g. `packages/quay/test/mcp-server.test.mjs`'s assertion style).
4. Explicitly do **not** change the existing `manda`-present or
   stdout-degrade paths' behavior — this is an additive third mode, not a
   replacement, and does not touch the manda-availability detection logic
   in `mandaAvailable()` at all.
5. Do not attempt, as part of this directive, to re-verify or re-test
   live manda delivery itself, and do not make this task's own gate
   depend on a live manda session being reachable — that would repeat
   exactly the mistake DIR-008/§2.3 flags as already paid for in
   iterations 13-18.
6. Record the task's provenance in `experiment/provenance.md`, and, per
   DIR-008's already-decided attribution rule (constraint 4(b), archived
   in `experiment/directives/archive/DIR-008-*.md`), credit this
   Core-level action-delivery work to whichever of the existing
   `skeleton`/`abi_symmetry`/`gate_correctness` factors it genuinely
   fits — not `effectiveness`, and not a new fifth factor — and state
   which one, with reasoning, in the iteration report.
7. Update `packages/quay/DESIGN.md` (which already documents the Core's
   MCP server and other action-trigger behavior, per DIR-007's
   resolution) to describe the new mock/file-log delivery mode, so the
   design doc stays the authoritative source for Core-level behavior.

This directive intentionally does not request implementing the other two
proposals from the same discussion document (§2.1 browser-automation Web
UI verification, §2.2 Core-level CLI/MCP/Web-UI three-way symmetry) —
per that document's own dependency analysis, this is the lowest-risk of
the three (no new external tool dependency, no naming-collision risk) and
is intended to land first, providing a deterministic delivery-verification
foundation the other two can build on rather than needing to invent their
own.
