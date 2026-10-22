---
name: extension-point-refactor
description: Run a refactor slice with the extension-point criteria four-piece set — generate the AC/DoD skeleton (正臂 / 负臂 / 注入泄漏 / 红线基线) from the centre file and the extension point, fill the four arms with real counted assertions, judge them with the checker, then land the AC through the Provider ABI. Use when a task is a design slice/refactor (R1/R2) whose acceptance must say WHERE the next feature lands, not merely that the existing code was split.
allowed-tools: Bash, Read, mcp__plugin_quay_quay__task_get, mcp__plugin_quay_quay__task_write, mcp__plugin_quay_quay__task_check
---

# quay:extension-point-refactor

## Spec

A refactor slice "split the file" is not the same as "built the extension point" (methodology §13 / DIR-133 裁定 2).
This skill turns the four-arm criterion set into one repeatable call instead of hand-copying it per slice:

    scaffold(central, outside, taskId) → four-arm AC skeleton
    fill(skeleton)                     → real counted assertions for THIS slice
    check(taskId)                      → satisfied / missing-arms / not-applicable / NOT-EVALUATED
    land(taskId)                       → task_write the AC section (ABI, never a hand edit)

Definition of done for the slice: the checker returns `satisfied` **before** the boxes are ticked, and the
positive arm's assertion was RED before the change (that is the falsifiability, not the file size).

## The four arms (canonical wording: `docs/references/ownership-first-refactoring-methodology.md` §13.5)

| Arm | Assertion | Red when | Liveness? |
|---|---|---|---|
| 正臂 positive | a handler registered OUTSIDE the centre is triggered — the count `triggered=1`, never "the handler exists" | the registration/wiring is removed ⇒ `triggered=0` | **yes** (this IS the liveness check) |
| 负臂 negative | unregistered ⇒ `triggered=0` (recommended companion: `handlerRegistered=false`) | the dispatcher leaks / always fires | no — it is vacuous green on its own |
| 注入泄漏 injection leak | replace the dispatcher with a leaking implementation; the SAME assertions must go red | still green ⇒ the arm never tested the dispatcher | no — it proves the NEGATIVE arm is not vacuous |
| 红线基线 red-line baseline | `wc -l <centre>` is RED before the change | running it before the baseline is green | no — and it is a **single-shot AC, NOT a standing ratchet** (never re-evaluated after the task is done) |

**⛔ Only a negative arm is not a criterion.** "Unregistered ⇒ not triggered" is green for the wrong reason when
the wiring is broken (`triggered=0` at both ends too). The checker therefore reports `missing-arms` and names 正臂.

## Pipeline

### Phase 1 — Scaffold (dry-run; nothing is written)

```bash
node --experimental-strip-types plugin/scripts/extension-point-criteria.ts \
  --scaffold --task-id <task-id> --central <centre file> --outside <extension-point module>
```

It prints the AC block, the `triggered=1` count form, and the "single-shot AC, not a standing ratchet" note.
It never touches the task store — the task body is written only through the ABI in Phase 4.

### Phase 2 — Fill the four arms for THIS slice

Replace each placeholder with a real, runnable assertion. Non-negotiables:

1. **正臂 is a COUNT** (`triggered=1`, or `triggeredN == 1`, …), not an existence check.
2. **负臂 is paired with the counted 正臂** — never ship the negative arm alone. Assert the companion
   reading `handlerRegistered=false` as well: it separates "unregister really gated it" from "unregister
   did nothing but the positive arm happened to catch it".
3. **注入泄漏** names the leaky dispatcher implementation and the assertion that must redden.
4. **红线基线** records the pre-change `wc -l <centre>` value and asserts the post-change value is below it.
   Say explicitly that it is a single acceptance check, not a standing ratchet.

### Phase 3 — Judge (positional, AC checklist items only)

```bash
node --experimental-strip-types plugin/scripts/extension-point-criteria-check.ts --task-id <task-id> --json
```

- `satisfied` — all four arms present; proceed.
- `missing-arms` — `missingLabels` / `missingArms` name every absent arm; `weak[]` flags an arm written in the
  wrong form (e.g. 正臂 written as "handler 存在"). Fix the AC text, do not weaken the checker.
- `not-applicable` — not a design slice (no `refactor-slice` label and no 拆分/切片/重构 semantics in title/labels).
- `NOT-EVALUATED` — the task file or its `## Acceptance Criteria` section could not be read. This is **not**
  `missing-arms` and must never be treated as a pass.

Reading a whole board (the production reading, not a fixture):

```bash
node --experimental-strip-types plugin/scripts/extension-point-criteria-check.ts --scan --json
```

### Phase 4 — Land the AC through the Provider ABI

Read the task with `task_get`, rewrite its `## Acceptance Criteria` with `task_write` (satisfied items as `- [x]`,
with the evidence appended after `——`), and confirm with `task_check`. **Never hand-edit the `- [ ]` / `- [x]`
characters** — the ABI commit is what reaches fan-in's ac-precheck.

## Not in scope

- This skill does not judge architecture quality, ownership convergence, or whether the slice is worth doing
  (methodology §§1–11).
- The red-line baseline is **not** a standing ratchet; ongoing growth readings belong to
  `plugin/scripts/design-evolution-readings.ts`.
