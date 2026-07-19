# Charter M31-cli-gate-enforcement — `task edit --status`: decide + implement whether the
# Core CLI write path enforces the `task check` gate, or is explicitly documented as an
# unguarded setter with an opt-in enforced path (Tier-A)

**Milestone id:** M31-cli-gate-enforcement · **surface:** CLI (`packages/quay`) · **type:** explore
(design decision) + exploit (implementation)
**Source:** `tasks/exp5-M-CLI-GATE-ENFORCEMENT.md` (SELECTed m31) — anchored on G-S3-01, found
independently by BOTH M28-outcome-eval iterations (iteration-0 directly; iteration-1 hit the identical
failure mode live on its own first attempt, self-caught, redid the scenario). Full provenance:
`experiments/quay-perpetual-stream/milestones/M28-outcome-eval/outcome-eval-report.md`, Scenario 3.
**Charter authored:** m30→m31 boundary, 2026-07-19. Base commit: `exp5-outer-driver` HEAD
`a96ff23` (post-m30-publish, confirmed via `git rev-parse exp5-outer-driver`).

## Value hypothesis
- Value type(s): **governance-integrity (primary)** — this is the same "gate is both contestant and
  judge" class already self-documented in the `quay:author`/`quay:execute` Skills' own "Gaps"
  sections, now confirmed to have a CLI-level instance: `quay task edit --status <x>` writes the
  status transition unconditionally, without ever consulting `task check`'s gate logic (confirmed
  live at `packages/quay/bin/quay.js` lines 475-577 — the edit handler's only guard is the
  GAP-002 title-existence check from M29; there is no call to `taskCheck`/gate logic anywhere in the
  edit path). **exploit (secondary)** — fixes a real, dogfooding-confirmed enforcement gap, not a new
  capability. **explore flavor** — the charter's own required first step is a genuine product-design
  decision with backwards-compatibility implications (see Decision below), not a mechanical fix.
- **Δv̂: 0** (governance-integrity/correctness, no new CLI-surface coverage cell; VT chart-1 does not
  score enforcement-strictness). Recorded here per protocol §4.1/§6.2 — explicitly zero, not omitted.
- Metric `Y`: (1) the design decision is made and recorded with explicit reasoning (not left as an
  open question a second time — this candidate was already deferred once at m29 SELECT for exactly
  that reason); (2) the decided behavior is implemented and tested; (3) `--help` text and any
  relevant Skill-level docs (`quay:author`/`quay:execute`) reflect the actual, current behavior — no
  stale claims either way; (4) full test suite green before AND after, new tests under TDD.

## Decision (made at charter-authoring time, per this task's own required first step)
Chosen: **(b) + opt-in (c)-flavored escape hatch** — NOT (a) hard-block-by-default.

Reasoning:
- `task edit` is documented elsewhere in this codebase (M16-cli-edit-parity, M29's own guard
  comments) as a low-level, provider-agnostic primitive — the Core CLI's generic `taskWrite`
  passthrough, explicitly analogous to `git commit --no-verify`: a deliberate low-level write path
  that does not run higher-level process gates by default. Flipping this to hard-block-by-default
  (option a) would be a breaking behavior change to an existing, already-shipped CLI surface with an
  unknown number of external callers (scripts, other agents' Skill-level automation) that may
  currently rely on being able to force a status transition — e.g. a human operator overriding a
  gate they've manually verified is safe to bypass, or recovery/cleanup scripts. There is no
  evidence in this stream that any caller currently WANTS gate enforcement on this path; there IS
  evidence (M28's own two independent near-misses) that undocumented-unguarded is a real trust/UX
  problem for callers who assumed enforcement without checking.
- Therefore: (b) is the primary fix — make the unguarded behavior explicit and discoverable
  (`--help` text, inline code comment already partially present from M29 but not gate-specific,
  Skill-level doc cross-reference) rather than silently assumed. This alone resolves G-S3-01's
  actual failure mode (a caller mistakenly believing the gate is enforced) without any behavior
  change or compatibility risk.
- Additionally: implement a **minimal, additive, opt-in enforcement path** — `task edit --status
  <x> --enforce-gate` — which runs the identical gate-check logic `task check` already uses (do
  NOT duplicate the logic; call the same underlying check the `task check` command calls) BEFORE
  writing, and refuses (exit 1, no write performed) if the gate fails. This gives callers who DO
  want enforcement a real, tested option, without touching the default path's semantics at all. This
  is the (c)-flavored middle ground the task's own notes flagged as a possibility, made concrete as
  an opt-in flag rather than an interactive prompt (a CLI tool used by both humans and agents should
  not block on stdin by default — a flag is unambiguous and scriptable).
- This decision itself, and its reasoning, is a **Done-when deliverable** — a future SELECT pass or
  human review must be able to read this section and understand why (a) was rejected without having
  to re-derive it from scratch, per this candidate's own explicit ask at m29's "not selected" note.

## Current-state notes (re-verified directly against source at charter-authoring time)
- `packages/quay/bin/quay.js` lines 475-577: `task edit` handler. No call to `taskCheck` or any gate
  logic anywhere in this block — confirmed via direct read and `grep -n 'taskCheck\|gate' quay.js`
  (only hits are inside the separate `task check` handler, lines 579-596, and comment prose).
- `packages/quay/bin/quay.js` lines 579-596: `task check` handler — calls `client.taskCheck(id)`,
  which is a generic `withProvider` passthrough to the active Provider's own `task_check` capability
  (provider-manifest gated, same pattern as `taskWrite`/`taskGet`). This is the exact logic the new
  `--enforce-gate` flag must call — no new gate-evaluation logic should be written; reuse
  `client.taskCheck(id)` and inspect `result.ok`/`result.reason`.
- `--help` text for `task edit` (M29's G-02 fix) lists the full flag surface but does not currently
  mention gate enforcement (or its absence) at all — confirms the documentation gap this charter's
  decision (b) targets.

## In scope
1. Implement `task edit <id> --status <x> [--enforce-gate]`: when `--enforce-gate` is present AND
   `--status` is among the patch-producing flags, call `client.taskCheck(id)` BEFORE the
   `client.taskWrite` call; if `result.ok === false`, refuse with a clear error message including
   `result.reason`, exit 1, no write performed. When `--enforce-gate` is absent (default), behavior
   is unchanged from today (unguarded, as documented). `--enforce-gate` with no `--status` flag (or
   with a `--status` value that isn't actually a transition, e.g. re-setting the same status) is a
   no-op guard-check-then-proceed — still worth checking, since any other patch-producing flag could
   plausibly interact with gate state; keep this simple and always check when `--enforce-gate` is
   present and the write includes a `status` field, per the decision above.
2. Update `--help` text for `task edit` to document: (a) status transitions are UNGUARDED by default
   (no gate check), analogous to `git commit --no-verify`; (b) `--enforce-gate` opts into running the
   same check `task check` performs, refusing the write on failure.
3. Add an inline code comment at the `task edit` handler (mirroring M29's own comment-provenance
   style) explaining the unguarded-by-default decision and pointing to this charter for the full
   reasoning, so a future reader does not have to re-derive it.
4. Cross-reference check (read-only, do not edit unless a genuine staleness is found): read
   `quay:author`/`quay:execute` Skill docs' own "Gaps" sections (search for "gate" and "task check")
   and confirm they still accurately describe the CLI-level behavior after this fix — flag any
   staleness found as a Note for ABSORB, do not silently leave it stale.

## Explicitly OUT of scope
- Changing `task edit`'s DEFAULT behavior (no hard-block-by-default) — explicitly rejected per the
  Decision section above; this is not a partial/incremental step toward (a), it is a considered
  rejection of (a).
- Any change to `task check`'s own logic, or to the native/github provider's `task_check`
  implementations — this charter only adds a NEW CALLER of the existing check, never modifies it.
- Any change to `task create`'s behavior (M29's surface) — out of scope, unaffected by this charter.
- MCP-tool-level (`mcp__quay__*`) equivalents of `--enforce-gate` — out of scope; this charter is
  Core-CLI-only, per the source task's own CLI-surface framing. A future candidate may extend the
  same opt-in pattern to the MCP tool surface if judged valuable.
- V_meta consolidation-lag gate: N/A this milestone (no v-meta-ledger.md row applies).
- Design-only-milestone impl-row gate: N/A — this milestone is not design-only (produces real code +
  tests), gate does not apply (no exemption claimed, simply inapplicable per its own trigger
  condition).

## Done-when (binary clauses)
1. `task edit <existing-id> --status <failing-transition> --enforce-gate` refuses (exit 1, no write),
   with `result.reason` surfaced in the error message. Demonstrated live against a real gate-failing
   fixture (missing artifact / unchecked AC box, whichever the active provider's `task_check` gates
   on).
2. `task edit <existing-id> --status <passing-transition> --enforce-gate` succeeds identically to
   today's unguarded write (same exit code, same output shape) when the gate passes.
3. `task edit <existing-id> --status <x>` WITHOUT `--enforce-gate` behaves exactly as today
   (unguarded) — zero regression to existing default behavior. Demonstrated against the same
   gate-failing fixture from clause 1: without the flag, the write succeeds (current behavior
   preserved).
4. `--enforce-gate` combined with a non-`--status` patch (e.g. `--labels` only) either (a) still
   performs the check if any status-affecting change is present, or (b) is a documented no-op if no
   status change is present — pick one, implement it, and state which in the ABSORB entry (this
   charter does not mandate which, only that the chosen behavior is deliberate and documented, not
   accidental).
5. `--help` text for `task edit` documents both the default-unguarded behavior and `--enforce-gate`,
   verified by a test asserting the help string contains both.
6. Inline code comment present at the `task edit` handler per in-scope item 3.
7. Skill-doc cross-reference check (in-scope item 4) performed; any staleness found is either fixed
   or explicitly logged as a Note for ABSORB — not silently ignored.
8. Full test suite green before AND after, TDD RED→GREEN demonstrated (a failing test for
   `--enforce-gate` refusing a gate-failing transition, written BEFORE the implementation).
9. `git diff --stat` scoped to `packages/quay/bin/quay.js` + new/changed test files + this
   milestone's own report — no unrelated files touched. Real repo-root `tasks/` directory confirmed
   untouched by any test run (same discipline as M29).

## HARD GATES (by-reference — see `experiments/quay-perpetual-stream/ITERATION-PROMPTS.md` lines
~100-131 for the full literal text; both dispatched iteration prompts must include it verbatim,
adapted for this CLI-only milestone — the manda hub healthz gate and port-4173 reachability gate are
explicitly N/A here and must be STATED as N/A in each iteration's own report, not silently omitted):
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file,
run immediately before dispatch and re-confirmed unchanged (same discipline as M25-M29).

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-line-budget-check.sh` against this charter: 4 in-scope items — under the small-
  milestone threshold (8). PASS expected, re-confirm before dispatch.
- `it0-impl-row-check.sh exp5-M-CLI-GATE-ENFORCEMENT backlog.md`: not design-only, gate does not
  apply — PASS expected.
- `it0-ceiling-check.sh`: N/A (task-store/benchmark-report sourced, same as M28/M29).

## Adversarial-audit gate disposition (decide at ABSORB, per `inherited-core.md`'s cadence rule)
This milestone is governance-integrity typed with Δv̂=0 — condition (a) (nonzero-Δv capability-growth)
does NOT fire. Condition (b) (iteration-0 recommends self-exempting from iteration-1) also does not
apply — this charter mandates the standard two-iteration convergent dispatch, no self-exemption is
being requested. **Recommend, but do not mandate, a REQUIRED audit anyway** given this touches a
governance/enforcement surface (the same class M26's adversarial-eval and M29's REQUIRED audit both
flagged as high-stakes) — leave the final call to the outer loop at ABSORB time, informed by how
much genuine disagreement/discovery the two iterations actually produce (mirrors M29's own
condition-driven reasoning, applied here as a recommendation rather than a hard trigger since the
formal conditions don't fire).

## Note for ABSORB
1. State explicitly which of clause 4's two options ((a) always-check-if-status-present vs.
   (b) explicit-no-op-without-status) was implemented, and why.
2. State the outcome of the Skill-doc cross-reference check (in-scope item 4) — fixed, found-stale-
   and-logged, or confirmed-already-accurate.
3. Confirm the Decision section's reasoning held up under the two iterations' actual work — did
   either iteration surface evidence that should revise the (b)+opt-in-(c) choice, or evidence
   confirming it was correct? Record whichever is true, do not silently assume the charter's
   pre-dispatch reasoning was right without checking.
4. Realized Δv: expected 0 (governance-integrity, no VT chart cell) — confirm this explicitly at
   ABSORB rather than silently omitting the VT section (consistent with the standing discipline that
   Δv=0 is a stated finding, not an absence).
5. DIR-017 status: unchanged this milestone (still pending human 6-point re-verification, per m30's
   ABSORB entry) — restate at DRAIN, do not silently drop.

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit, same
worktree/branch-per-iteration pattern as M25-M29 (`experiments/quay-perpetual-stream/milestones/
M31-cli-gate-enforcement/worktrees/iteration-{0,1}`, branches `exp5-m31-iteration-{0,1}`). Iteration-1
must NOT read iteration-0's materials (independent-verification discipline). Explicitly instruct
iteration-1 to bring genuine skepticism to the Decision section above, not just re-implement it
verbatim — if it finds a real reason (a) or a pure (c)-without-(b) would have been better, it should
say so in its own report even while implementing the charter's chosen decision (the charter's Decision
is binding for THIS milestone's implementation scope, but disagreement-with-reasoning is exactly the
kind of signal ABSORB's Note-4 above exists to capture).
