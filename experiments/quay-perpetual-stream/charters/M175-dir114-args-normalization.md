# M175 — Workflow args-normalization defense (DIR-114)

**Task:** DIR-114 · **Counter:** 175 · **Chart:** 2
**Class:** development · **Value type:** instrumentCorrection
**Deliverable:** no · **Charter tokens:** ~1.0 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (instrument-correction, VT-neutral). The Workflow tool's `args` global sometimes arrives
inside a script body as a JSON-encoded string rather than the parsed object its own contract
promises "verbatim" — confirmed via two live, reproducible crashes in `execute-milestone.js`
(`args.charterFile.match` on `undefined`) during the M173 cycle, and a diagnostic pair of probe
workflows that proved `typeof args === "string"` for identical args content across two calls of
the SAME unmodified `drain-directives.js` (one succeeded, one failed). All 5 checked-in workflow
scripts read `args.*` raw with zero defensive parsing. This milestone lands the normalization
permanently on `master` instead of the session-local, ephemeral patch that fixed only one
in-flight `execute-milestone` invocation and was never checked in.

## Scope
Per DIR-114's Requested action:
1. Add `const $a = (typeof args === 'string') ? JSON.parse(args) : args` at the top of each of the
   5 checked-in workflow scripts under `.claude/workflows/`, and replace every raw `args.xxx`
   reference in each file with `$a.xxx`.
2. Do not change any judgment logic, phase structure, or schema — this is a pure context-plumbing
   fix.
3. Verify with a real `Workflow()` call per DIR-114's AC: at least `execute-milestone.js` and
   `drain-directives.js` each get one real invocation proving the normalization handles whichever
   form `args` arrives in.

**Out of scope:** any change to the underlying Workflow tool/runtime itself (this is a repo-side
defensive workaround, not a platform fix); DIR-113/DIR-115/DIR-070-F (separate milestones).

## Touches
- .claude/workflows/execute-milestone.js
- .claude/workflows/drain-directives.js
- .claude/workflows/diagnose-verify-failure.js
- .claude/workflows/run-routines.js
- .claude/workflows/select-preflight.js

## Done-when
1. All 5 files contain the `$a` normalization line and zero remaining raw `args.` references
   (the normalization line itself excepted)
2. At least `execute-milestone.js` and `drain-directives.js` are each exercised by one real
   `Workflow()` call post-fix, confirmed non-crashing
3. No behavior change to any script's judgment/phase logic — a diff review confirms only
   `args.` → `$a.` substitutions plus the one new normalization line per file

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
