# Charter M14-cli-edit-parity — Core CLI `task edit` full-field-parity design doc (Tier-A)

**Milestone id:** M14-cli-edit-parity · **surface:** CLI (Core, `packages/quay/bin/quay.js`) + method
infra (portable-metadata convention) · **type:** explore
**Source:** `backlog.md`'s `M-CLI-EDIT-PARITY` row, sourced from DIR-011 (Core CLI edit-surface
asymmetry + portable-metadata-vs-`extra{}` convention), deferred at the m12→m13 boundary pending
M13-task-backlog-projection's body-vs-extra convention landing first. M13 ABSORB (2026-07-18) landed
that convention — `docs/proposals/exp5-task-backlog-primitive-projection.md` now states the
experiment-prefixed-id namespace decision and reuses the same body-first/`extra{}`-mirror shape DIR-011
itself asks to formalize — so M-CLI-EDIT-PARITY's stated dependency is now satisfied. Picked over the
four still-not-charter-ready DIR-001-sourced candidates (M-OUTCOME-EVAL/M-ADVERSARIAL-EVAL/
M-COMPETITIVE-BENCH/M-HUMAN-REVIEW-CADENCE — all still need a concrete scenario list authored at SELECT
time, none has that yet) because it is the only remaining backlog candidate that is both freshly
human-routed and concretely scoped (DIR-011's own 4 numbered items), and because leaving the Core CLI's
status-only restriction unaddressed is a live blocker for any future milestone that would want to
dogfood the M13 design by actually writing tracking data through the Core CLI.
**Charter authored:** m13→m14 boundary, 2026-07-18.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's current
HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **capability-growth** (primary — DIR-011
  itself notes this, unlike DIR-009/DIR-010, "plausibly carries a small positive VT Δv̂ on the CLI
  surface") + **risk/option** (secondary — removes the edit-surface asymmetry a future
  M-TASK-BACKLOG-PROJECTION-implementing milestone would otherwise have to work around).
- Δv̂: **zero direct VT points this milestone** — DIR-011's own Requested action states "design-only at
  this stage, same routing as DIR-009" (i.e. do not implement the Core CLI change itself). The
  capability-growth value type is real but its Δv is deferred to whichever future milestone actually
  implements the parity change; THIS milestone's deliverable is the design (which fields, which
  provider-capability-handling shape, which portability convention) that makes that future
  implementation dispatch-ready. Mirrors M13's own zero-VT, design-only precedent exactly (same human
  routing decision, same "design doc only, do not implement" instruction).
- Metric `Y`: none (no VT chart move this milestone). Success is binary: does the design doc answer all
  4 of DIR-011's numbered items concretely, and is the portable-metadata rule stated precisely enough to
  be adopted as an `inherited-core.md`/ABI-doc convention without further design work.

## In-scope work
1. **Write the design doc** at `docs/proposals/exp5-cli-edit-parity.md`, covering DIR-011's 4 numbered
   items in full:
   - Item 1: Core CLI `task edit` full-field parity — design relaxing `packages/quay/bin/quay.js task
     edit` from status-only to accept `--title`/`--body`/`--labels`/`--extra`/`--parent`/`--children`/
     `--append-notes` (whichever the active provider supports), passing through to the provider's
     existing write path (native CLI + MCP `task_write` already do this — cite, don't re-derive). Decide
     and state a concrete recommendation on whole-body replacement (`--body-file <path>` / stdin) as a
     first-class mode.
   - Item 2: provider-capability handling — the Core CLI is provider-agnostic; when a field is
     unsupported by the active provider (GitHub: `extra`/`parent`/`children`), design must surface the
     provider's EXISTING hard-error floor (M09 PR-ABI-001 behavior) rather than silently drop, and must
     not assume native. State how the differential-conformance verification (M03-abi-eval/M09 style)
     would be run against both providers for this change.
   - Item 3: formalize the portable-metadata rule as a concrete, citable convention text (body markdown
     section = portable; `extra{}` = native-only mirror) suitable for insertion into `inherited-core.md`
     and/or a provider-ABI doc — write the actual proposed wording, not just describe it, and cross-
     reference `docs/proposals/exp5-task-backlog-primitive-projection.md`'s own reliance on this exact
     rule (M13's DIR-010 sub-section already assumes it).
   - Item 4: non-goals — explicitly state GitHub `extra` storage stays out of scope (hard-error floor is
     correct, not a defect to fix) and MCP/native-provider-CLI surfaces are not touched (already
     sufficient); this is a Core-CLI-passthrough + convention change only.
2. **Do NOT implement.** No `packages/quay/bin/quay.js` edit, no `inherited-core.md` edit, no live
   provider-write code change. The design doc may (and should) specify exactly what a future
   implementing milestone's Done-when clauses would look like, as a section within the doc — but this
   milestone does not execute them.
3. **Cross-reference real precedent, not re-derive from scratch.** Cite `packages/quay-native/bin/
   quay-native.js task edit`'s existing full-field flag set (already implemented — DIR-011's own Finding
   names the exact flags), the MCP `task_write` schema, and M09-gh-write's PR-ABI-001 hard-error-floor
   fix as the three grounded precedents DIR-011 itself names; do not propose a mechanism that ignores
   what the native CLI and M09 already proved out.
4. **State a concrete verification plan** for whichever future milestone implements this: what a
   differential-conformance test addition (native vs. github, in the `provider-abi-conformance.test.mjs`
   style) covering the newly-relaxed Core CLI flags would need to assert, worked through for at least 2
   of the newly-relaxed fields (e.g. `--title` against both providers, `--extra` against native +
   GitHub's hard-error path).

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `docs/proposals/exp5-cli-edit-parity.md` exists and addresses all 4 of DIR-011's numbered items
   — pasted section-by-section mapping showing which section answers which DIR-011 item number.
2. `[ ]` The doc states a concrete recommendation (not an enumerated menu) for whole-body replacement
   mode (item 1's `--body-file`/stdin question).
3. `[ ]` The doc includes the actual proposed portable-metadata-rule wording (item 3) formatted as
   insertable prose, plus an explicit cross-reference to how
   `docs/proposals/exp5-task-backlog-primitive-projection.md` already relies on this rule.
4. `[ ]` The doc includes a concrete verification-plan section (worked through for ≥2 relaxed fields
   against both providers, in the M03-abi-eval/M09 differential-conformance style) — not just "add
   tests," an actual worked example of what each test would assert.
5. `[ ]` The doc includes a "Done-when clauses a future implementing milestone would need" section —
   itself a checklist, not prose — so the design is dispatch-ready when a later SELECT picks it up.
6. `[ ]` No product code, `inherited-core.md`, or provider ABI file is modified by this milestone —
   confirm via `git diff --stat` against the pre-charter base commit, pasted, showing only the new doc
   file (plus this milestone's own `iterations/`/`charters/` bookkeeping files) touched.
7. `[ ]` `backlog.md`'s `M-CLI-EDIT-PARITY` row is updated at ABSORB to point at the finished doc and
   marked DONE (design delivered; still not yet charter-ready for implementation until a future SELECT
   explicitly picks it up per DIR-011's own deliverable note) — pasted diff.

Milestone is DONE when all seven are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2–5 if they fire first. Sized identically to M13 (single doc-authoring pass, no
code, no live external-system access) — real independent-re-derivation material for iteration-1 (a
design doc's completeness against 4 numbered source items plus 2 concrete decision points — whole-body
mode, portable-metadata wording — are genuinely independently checkable).

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch.

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop · (4) budget≈10
backstop, past→default HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — N/A this milestone (zero VT points by design, stated above); confirm
   at it0 that no VT-chart claim is accidentally introduced by the design doc's own examples.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires a pasted diff, section mapping, or
   worked example; no clause may be marked met on narrative alone.
d. **Domain-misfit audit-channel** — this milestone's domain (a design doc, no live external system, no
   product code touched) does not have a directly-applicable CI-job/audit-channel analogue the way
   GitHub-provider-write milestones do. Expected and consistent with M-SIZING/M-VMETA-GATE/M13's own
   prior doc-only precedent — record this explicitly rather than forcing a mismatched audit-channel
   citation.

## Adversarial-audit gate — NOT expected to trigger (state explicitly at ABSORB)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a capability-growth-
typed milestone with nonzero REALIZED VT Δv appended at ABSORB — this milestone is typed
capability-growth+risk/option but with Δv̂=0 BY DESIGN this round (design-doc-only; the capability-growth
value is deferred to a future implementing milestone, not realized here), so condition (a) does not
apply as long as realized Δv stays 0 at ABSORB (verify this explicitly, do not assume). Condition (b)
requires iteration-0 to recommend SKIPPING iteration-1 — this charter does not authorize that
(iteration-1 has real independent-re-derivation material per the sizing note above), so condition (b)
should also not fire absent an iteration-0 self-exemption. If iteration-0's own report nonetheless
recommends skipping iteration-1, the outer loop must NOT accept that at face value (per M-SIZING's own
m6 precedent, reaffirmed at M13) — dispatch iteration-1 regardless and record the override explicitly.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher. Record each iteration under
`experiments/quay-perpetual-stream/milestones/M14-cli-edit-parity/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M14-cli-edit-parity/worktrees/iteration-N`, branch
`exp5-m14-iteration-N`.

**No live external-system access required** — unlike M03/M09/M11/M12, this milestone touches no
GitHub API, no live browser tooling; it is a pure documentation-authoring pass reading this repo's own
history (`packages/quay-native/bin/quay-native.js`, `packages/quay/bin/quay.js`, MCP `task_write`
schema, `docs/proposals/exp5-task-backlog-primitive-projection.md`, DIR-011's archived file).
