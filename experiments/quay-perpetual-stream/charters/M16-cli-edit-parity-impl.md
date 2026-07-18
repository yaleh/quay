# Charter M16-cli-edit-parity-impl — implement Core CLI `task edit` full-field parity (Tier-A)

**Milestone id:** M16-cli-edit-parity-impl · **surface:** CLI (Core, `packages/quay/bin/quay.js`) +
method infra (`inherited-core.md` portable-metadata section) + docs (README/DESIGN) · **type:** exploit
**Source:** `docs/proposals/exp5-cli-edit-parity.md` §6 ("Done-when clauses a future implementing
milestone would need") — M14's own design-doc-only deliverable, explicitly left "not yet charter-ready
for implementation" pending a future SELECT. That future SELECT is this milestone: the design is
complete (§1-§5 of the doc cover the flag surface, provider-capability handling reusing the M09
PR-ABI-001 hard-error floor, the portable-metadata rule wording, non-goals, and a worked two-field
verification plan), so this charter implements §6's checklist directly rather than re-deriving design
decisions.
**Charter authored:** m15→m16 boundary, 2026-07-18. Checkpoint next due at `milestone_counter=20`.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **capability-growth** (primary —
  closes the Core CLI's status-only `task edit` restriction, bringing it to parity with the native
  provider CLI and MCP `task_write` it already fronts) + **risk/option** (secondary — removes the
  edit-surface asymmetry noted in M13's own task-backlog-projection design doc as something a future
  self-hosting milestone would otherwise have to work around).
- Δv̂: capability-growth on the CLI-surface dimension. This is a CLI usability/completeness closure, not
  a new VT-chart surface — consistent with M-GH-WRITE/M-ABI-PARENT-WRITE's own precedent of scoring
  real field-level write-completeness gains. Precise ceiling to be computed at it0 from the CLI-surface
  cov formula already in use (present flag-surface fraction), estimated **small-positive** (this closes
  a usability gap, not a coverage-matrix cell in the Provider-ABI sense) — record the it0 ceiling
  arithmetic explicitly; if the existing VT formula has no CLI-edit-surface cell to move, record Δv̂=0
  and re-type this milestone discovery-only rather than force a fabricated number (per the standing
  "no VT-chart claim without ceiling/floor arithmetic" it0 check).
- Metric `Y`: `docs/proposals/exp5-cli-edit-parity.md` §6's 10-item checklist, each requiring pasted
  evidence (diff, invocation+output, or PASS test output) — no narrative-only completion.

## In-scope work (= design doc §6, verbatim scope, do not expand)
1. Relax `packages/quay/bin/quay.js`'s `task edit` handler per design doc §1.2: accept `--title`,
   `--body`, `--body-file`, `--labels`, `--extra`, `--parent`, `--children`, `--expect-status`;
   `--status` no longer solely required.
2. Implement `--body-file <path>` (including `-` for stdin) per §1.3's `resolveBody` sketch, with
   `--body`+`--body-file` mutual exclusion validated and erroring clearly.
3. Implement `--append-notes` as the read-then-write convenience described in design doc §4 (no new
   ABI tool added).
4. Insert the proposed portable-metadata-rule wording (design doc §3.2) verbatim into
   `inherited-core.md` as a new named section.
5. Add/extend conformance probes: `--title` two-provider (native+GitHub) per §5.1; `--extra`
   two-provider per §5.2 (native round-trip succeeds, GitHub hard-errors with the exact PR-ABI-001
   floor message and leaves the scratch issue unmodified); `--labels`/`--parent`/`--children`
   extended per §5.3 (all three all-provider-supported post-M12).
6. Update `packages/quay/README.md` / `packages/quay/DESIGN.md`'s `task edit` usage text (currently
   documents only `--status`) to the full flag set.
7. **Do not expand scope beyond the design doc's own §6 checklist** — no new ABI tools, no fields
   beyond the 7 listed in item 1, no provider work beyond conformance-probe verification of
   already-existing M09/M12 write paths.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape; = design doc §6 verbatim)
1. `[ ]` `task edit` handler relaxed per §1.2 — pasted diff.
2. `[ ]` `--body-file <path>` (incl. `-` for stdin) implemented, mutual-exclusion with `--body`
   validated — pasted example invocation + output for both file-path and stdin forms.
3. `[ ]` `--append-notes` implemented — pasted before/after `task_get` body showing the note appended.
4. `[ ]` Portable-metadata-rule wording inserted verbatim into `inherited-core.md` — pasted diff.
5. `[ ]` `--title` two-provider conformance probe added and passing on both native and GitHub —
   pasted PASS output.
6. `[ ]` `--extra` two-provider conformance probe added and passing (native round-trip; GitHub
   hard-error with exact floor message, gh-issue unmodified) — pasted PASS output both branches.
7. `[ ]` `--labels`/`--parent`/`--children` conformance probes extended, all passing — pasted PASS
   output.
8. `[ ]` README/DESIGN `task edit` usage text updated to full flag set — pasted diff.
9. `[ ]` Full existing test suite passes post-change — pasted raw output.
10. `[ ]` `git diff --stat` against this milestone's pre-charter base commit shows only expected files
    touched (`packages/quay/bin/quay.js`, `inherited-core.md`, README/DESIGN docs, conformance test
    file — no unrelated product code) — pasted output.

Milestone is DONE when all ten are met and stable ≥1 iteration (§3.2 condition 1). Terminate early per
§3.2 conditions 2-5 if they fire first. Sized larger than M14/M15 (real product-code CLI change +
provider-conformance test additions, not doc-only) — comparable to M09-gh-write/M12-abi-parent-write's
own real-write-path scope; genuine independent-re-derivation material for iteration-1 (the flag-parsing
edge cases, the hard-error-floor exact-message assertion, and whether README/DESIGN drift from the new
flag set are all independently checkable).

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
consecutive · (3) ceiling→redesign-OR-stop · (4) budget≈10 backstop, past→default HALT ·
(5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — compute at it0 whether the CLI-edit-surface closure maps to an
   existing VT-chart cell; if not, record Δv̂=0 explicitly rather than claim an unbacked number
   (see Value hypothesis note above).
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted diff/output/test-PASS
   evidence; no clause may be marked met on narrative alone.
d. **Domain-misfit audit-channel** — this milestone touches real product code
   (`packages/quay/bin/quay.js`) and a live GitHub scratch-issue conformance probe (per §5.2's
   hard-error-floor verification) — the existing CI-job≡audit-channel consolidated pattern
   (`inherited-core.md`) applies directly; use the same live-repo GitHub write path M09/M12 already
   established, not a mocked probe.

## Adversarial-audit gate — expected to trigger (state explicitly at ABSORB)
Per `inherited-core.md`'s Adversarial-audit cadence rule, condition (a) fires when a
capability-growth-typed milestone posts a nonzero realized VT Δv at ABSORB. If it0's ceiling
arithmetic (check a, above) finds a real nonzero Δv̂, this milestone IS capability-growth-typed and
condition (a) is expected to apply — treat the gate as armed by default rather than assuming it will
no-op, unlike M13/M14/M15's zero-VT precedent.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher + `docs/proposals/exp5-cli-edit-parity.md` (the
design doc this charter implements — required reading, not optional). Record each iteration under
`experiments/quay-perpetual-stream/milestones/M16-cli-edit-parity-impl/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M16-cli-edit-parity-impl/worktrees/iteration-N`,
branch `exp5-m16-iteration-N`.

**Live external-system access required**: a real GitHub scratch-issue conformance probe (§5.2) needs
live `gh`-provisioned write access, per M09/M12's established Docker/live-repo audit-channel pattern.
