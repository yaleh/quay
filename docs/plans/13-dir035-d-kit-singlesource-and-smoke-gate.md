# Plan 13 — DIR-035-D: single-source the methodology kit + wire delivery-standalone-smoke as a named gate

Source directive: `tasks/DIR-035-D.md` (ADR-013 Decision item 3 kit-half + Requested action item 2).
Parent: `tasks/DIR-035.md`. Prerequisite children DIR-035-A/B/C all `status:done` (commits `81fd6066`,
`79e9e00`, `a0cd575`); `bash packages/quay/test/delivery-standalone-smoke.sh` already reports 0 RED
(verified 2026-07-20, re-confirmed at this milestone).

## Scope note (read before implementing — resolves an apparent overlap)

DIR-035-D's own AC item 4 and DoD prose reference "a REAL foreign-repo deployment (archguard or
meta-cc)". A LATER directive, `tasks/DIR-036.md` ("Transfer off-repo", dated 2026-07-20, AFTER
DIR-035-D was authored at M48), explicitly re-splits that exact work into its OWN children
DIR-036-A (Level 2 — deployment) / DIR-036-B (Level 3 — application), each with their own AC/DoD,
and states `blockedBy: DIR-035-D`. DIR-036 is the LATER, MORE SPECIFIC directive that supersedes
DIR-035-D's own foreign-repo AC/DoD language for that specific piece of work — DIR-036 was
authored precisely because DIR-035-D was recognized as "the cleanup/consolidation half" (DIR-035-D's
own `## Finding`) that should close FIRST, unblocking DIR-036 as a clean, separately-scoped
milestone-generating directive.

**Decision (this plan): DIR-035-D's own execution in THIS milestone covers Requested action items
1 (kit single-source) and 2 (named-gate wiring) only.** Requested action item 3 (validation-ladder
items 2/3, i.e. the real foreign-repo work) is explicitly OUT OF SCOPE for this milestone and is
tracked instead by DIR-036-A/B, which DIR-036 already owns end-to-end. This is recorded as a
directive-authoring residual (two directives claiming overlapping AC language) for a human/future
loop pass to reconcile DIR-035-D's own AC-4 text against DIR-036's existence — NOT silently
resolved by deleting AC-4, but explicitly disclosed in the task's `## Resolution` at ABSORB.

## Part 1 — Single-source the methodology kit (audit + consolidation)

**Audit finding:** a repo-wide search for `inherited-core*.md`-shaped files finds exactly ONE live
file: `experiments/quay-perpetual-stream/inherited-core.md` (exp5's own Tier-B pinned methodology).
The four OTHER experiment dirs (`quay-native-bootstrap`, `quay-webui-bootstrap`,
`quay-continuous-bootstrap`, `quay-core-bootstrap`) are all CLOSED/historical and predate the
`inherited-core.md` convention (introduced by exp5) — they each have their own bespoke
`ITERATION-PROMPTS.md` (a different, pre-Tier-B mechanism, not a copy of exp5's kit) and are not
being actively maintained or re-derived from. **No live duplicated kit-shaped doc exists to
consolidate today** — the historical multiplicity ADR-013's Context describes ("a second copy of
the methodology kit per experiment") is a forward-looking prohibition, not a currently-open
violation, because exp5 is the only RUNNING experiment and its own kit was never forked.

**What IS still missing (the real gap):** ADR-013 Consequences requires that "the methodology kit
drops into a new project as one versioned unit" — i.e. a concrete, demonstrated **kit-version-pin
scheme** so that a FUTURE second experiment does not re-derive/copy `inherited-core.md` wholesale,
but instead pins a version of ONE canonical kit and carries only its own instance state. This plan
adds that scheme now, applied to the one existing instance (exp5), so it exists and is followable
before a second experiment is ever started:

1. Add a **kit manifest** — a small `KIT-VERSION` pointer inside `inherited-core.md` itself
   (a `## Kit version` section near the top: kit semantic version + the git SHA it was last
   consolidated at), so any experiment directory can assert "I am pinned to kit vX at SHA Y"
   without copying the file.
2. Document the **single-source convention** explicitly in `inherited-core.md`'s own header: this
   file IS the one canonical kit; a new experiment directory MUST reference this path (by relative
   path from its own dir, e.g. `../quay-perpetual-stream/inherited-core.md`) + record the kit
   version it is pinned to in its OWN (thin) instance-state file, NEVER copy the file's content.
   This mirrors the EXACT discipline `OUTER-LOOP.md` already documents for ITSELF ("a pinned
   pointer (path + git SHA) to `inherited-core.md`, Tier-B, not inlined") — this plan extends that
   same by-reference discipline one level up, to the kit-as-a-whole vs. a second experiment,
   not just charter-vs-kit within one experiment.
3. No file MOVE is needed (there is nothing to de-duplicate today) — this is a doc-only addition
   (a new section + a short cross-reference), landed and enforced by construction (ADR-011): the
   convention is written where the NEXT experiment's author will actually read it, at the top of
   the one file being pinned.

## Part 2 — Wire `delivery-standalone-smoke` as a named delivery conformance gate

Follows the EXACT wiring pattern DIR-035-B / M39 already established (`makeIt0Gate` + `.quay/gates.yml`
`it0:` list), with ONE deliberate difference: `delivery-standalone-smoke.sh` takes **zero**
arguments (unlike `it0-impl-row-check.sh`/`it0-ceiling-line-budget-check.sh`, which require at
least one positional arg) — `makeIt0Gate`'s existing fail-closed branch requires
`args.length > 0`, which would wrongly reject a valid zero-arg invocation.

**Decision: add one small new factory, `makeFixedScriptGate(scriptPath, label)`, in
`packages/quay/src/gate/registry.js`** — a thin sibling of `makeIt0Gate` that runs a FIXED script
with NO required `task.extra` args (reuses the SAME `runAcceptance` runner, no new process-spawn
logic). This is NOT a duplication of `makeIt0Gate`'s logic (which is inherently about
args-required scripts); it is the missing zero-arg case in the same factory family. Register it via
a NEW `fixed:` list in `.quay/gates.yml` (parallel to the existing `it0:`/`adr:` lists), read by
`loadWorkspaceGates`, so the product's registry.js stays workspace-data-driven (ADR-013 Decision
item 2 — no hardcoded experiment path added to the module beyond what the `it0:`/`adr:` lists
already do).

Wire one entry:
```yaml
fixed:
  - name: delivery-standalone-smoke
    script: "./packages/quay/test/delivery-standalone-smoke.sh"
```

This is `.quay/gates.yml` DATA (this repo's own workspace config), not a product-code hardcode — a
fresh non-exp5 workspace sees no `fixed:` gates unless it declares its own.

### Test plan
- Unit: `resolveGate("delivery-standalone-smoke")` runs the real script (fast, ~5s) and returns
  `{ok:true}` given the current 0-RED state; a broken-script/non-existent-path case returns
  `{ok:false}` (mirrors `it0-gates.test.mjs`'s pass/fail-branch shape).
- CLI: `quay gate <task> --gate delivery-standalone-smoke` against a real task in this repo's own
  workspace — PASS, GateEvent appended, `quay gate-log --json` shows it.
- `quay gate --list` includes `delivery-standalone-smoke`.

## Out of scope (explicitly, per the Scope note above)
- DIR-036-A (real foreign-repo `.quay/config.yml` + `quay task list` against archguard/meta-cc).
- DIR-036-B (a real OUTER-LOOP milestone developing archguard).
Both remain DIR-036's own children, unblocked by this milestone landing DIR-035-D's actual scope.
