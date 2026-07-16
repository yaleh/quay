# DIR-009

- status: applied
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
directive must respect, already codified in `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`'s
"§Core-scope work" section (added by DIR-008): **do not re-discover the
manda-dispatch findings from iterations 13-18 from scratch — cite and
build on `experiments/quay-native-bootstrap/directives/archive/DIR-004-*.md` and
`experiments/quay-native-bootstrap/directives/archive/DIR-005-*.md` directly** — and do not make
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
6. Record the task's provenance in `experiments/quay-native-bootstrap/provenance.md`, and, per
   DIR-008's already-decided attribution rule (constraint 4(b), archived
   in `experiments/quay-native-bootstrap/directives/archive/DIR-008-*.md`), credit this
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

## Resolution

- resolved_by: iteration 31 (QN-042)
- outcome: applied
- evidence:
  - `packages/quay/src/action.js#deliverTrigger()` gained a new,
    additive `mockLogPath` parameter (requested action item 1): when
    supplied, it selects a `mock` delivery mode that appends one
    structured JSON-lines record (`channel`, `payload`, `taskId`,
    `status`, `skill`, `timestamp`) per delivery attempt to the given
    file, creating its parent directory if needed. Returns
    `{ delivered: "mock", channel, mockLogPath, record }` (item 2),
    distinguishable from both `{ delivered: "manda", ... }` and
    `{ delivered: "print" }`.
  - Activation mechanism (this task's own design decision, item 1):
    a new `QUAY_ACTION_MOCK_LOG` environment variable, read by both
    existing callers (`packages/quay/bin/quay.js`'s `action run`
    subcommand and `packages/quay/src/serve.js`'s POST action-button
    handler) and threaded into `deliverTrigger()`'s new parameter.
    Chosen over a config-schema field or new CLI flag because it
    requires zero config-schema changes and mirrors this repo's
    existing convention (`QUAY_NATIVE_TASKS_DIR`) for
    test/verification-mode activation.
  - A new, committed, network-independent regression test,
    `packages/quay/test/action-mock-delivery.test.mjs` (item 3): composes
    a real trigger payload via the existing `composePayload()` code path,
    calls `deliverTrigger()` with the mock mode selected, and asserts on
    the resulting file's structured JSON-lines content (including that a
    second delivery appends rather than overwrites). Confirmed via 5
    consecutive standalone runs (all exit 0, ~~19/19~~ 17/17 assertions
    passing each time — count corrected post-hoc, see `provenance.md`)
    and 3 consecutive full-suite runs (21/21 test-bearing
    files passing each time). Per item 5, this test does not gate its own
    pass/fail on live manda delivery succeeding or failing either way —
    a `try`/`catch` tolerates either pre-existing outcome for the one
    negative-control assertion that touches the manda/print fallback
    path at all. A genuine, unplanned finding surfaced while writing this
    test: `mandaAvailable()`'s own live return value was observed to be
    non-deterministic in this sandbox across repeated runs (sometimes
    `true` via a successful health check, sometimes a thrown
    `spawn manda ENOENT`; and even when `true`, a subsequent `manda send`
    call was separately observed to fail with connection-refused) — a
    second, independent reproduction of the exact per-session/per-moment
    manda unreliability DIR-004/DIR-005/§2.3 already document, this time
    at the detection step rather than the send step. An earlier draft
    assertion that depended on `mandaAvailable()`'s determinism was
    removed rather than shipped as a flaky test, and the finding is
    recorded here and in `packages/quay/DESIGN.md` §3 and the test
    file's own comments, per item 5's instruction not to repeat that
    mistake.
  - Item 4 (additive-only): `git diff --stat` for this task shows zero
    diff to `mandaAvailable()`'s own body, and zero behavior change to
    the existing `manda`-present or stdout-degrade paths — confirmed by
    the same regression test's own negative-control assertions and by
    direct inspection of the diff.
  - Item 6 (V-factor attribution): credited to **`skeleton`** (+0.01,
    0.67→0.68), not `abi_symmetry` (no CLI/MCP schema surface — the
    trigger edge is explicitly outside the Provider ABI per its own
    header comment) and not `gate_correctness` (no `task check`/gate
    logic touched), and explicitly not `effectiveness` and not a new
    fifth factor. Reasoning: this is genuinely new Core-level capability
    code (a new branch, a new helper function, new wiring in two
    callers) at the `action` link of `skeleton`'s own protocol-defined
    v0-loop chain (`config → mcp → serve → action → Skill → done`) — the
    same "genuinely new capability, not merely new proof about existing
    behavior" pattern iteration 26 (QN-036, Core's own MCP server)
    credited to `skeleton` at +0.02. Scored at the smaller end of that
    precedent range (+0.01, matching iteration 22's smaller-scoped
    capability-adjacent case) because this is a new *mode* within an
    already-existing link (`action`), not an entirely new link/binding
    the way `quay mcp` was. See `experiments/quay-native-bootstrap/iterations/iteration-31.md`
    §7 for the full reasoning and precedent citations.
  - Item 7: `packages/quay/DESIGN.md` gained a new "§3. Action-trigger
    delivery: the mock/file-log mode" section documenting all three
    modes, the activation mechanism, the additive-only guarantee, and
    the regression-test discipline.
  - Provenance: `experiments/quay-native-bootstrap/provenance.md`'s new "Records (as of end of
    iteration 31)" section logs QN-042 as `{native, native, native,
    done}`; σ (strict) recomputed to 34/41 = 0.8293 (up from 0.8250).
