# M179 iteration-0 — DIR-070-F: extract reusable methodology skills to plugin/

**Task:** `DIR-070-F` (child of the DIR-070 epic — Gap 3, the last open gap)
**Charter:** `experiments/quay-perpetual-stream/charters/M179-dir070f-methodology-skills.md`
**Class:** development (capability-growth, deliverable=yes).

## What was done

Extracted the reusable (non-experiment-specific) reference material from two experiment-local
`.claude/skills/` methodology skills into `plugin/skills/`, per DIR-070-F's own Plan section:

1. **`plugin/skills/quay-native-methodology/SKILL.md`** (new) — new frontmatter + spec pointing
   at 4 reference files, byte-identical copies of their `.claude/skills/quay-native-methodology/
   reference/` source:
   - `reference/gate-mechanics.md` — the `task check` gate contract (todo→ready, ready→done,
     compound-recursive children-done).
   - `reference/directive-lifecycle.md` — the out-of-band directive steering channel
     (pending → archive, one-time-consumed).
   - `reference/patterns.md` — σ/V-function mechanics and the Layer-1/Layer-2 Skill structure
     precedent.
   - `reference/g3-audit-discipline.md` — the independent out-of-band audit requirement ("the
     gate is both contestant and judge").
   Explicitly NOT mirrored: `reference/case-studies/`, `reference/v-meta-stall-analysis.md`,
   `inventory/`, `examples/`, `templates/`, `experiment-config.json`, `scripts/` — these are the
   experiment-specific case studies / inventory / V-meta analysis the task's own Plan says to
   leave behind.

2. **`plugin/skills/quay-webui-bootstrap-methodology/SKILL.md`** (new) — new frontmatter + spec
   pointing at 2 reference files, byte-identical copies of their
   `.claude/skills/quay-webui-bootstrap-methodology/reference/` source:
   - `reference/visual-review-mechanism.md` — the §0c independent holistic visual review
     mechanism (dual Lighthouse + fresh-context holistic review, four-mode viewport grid,
     Lighthouse-before-holistic sequencing, browser-tool conflict rule).
   - `reference/effectiveness-timing-corpus.md` — the cross-experiment effectiveness-timing
     corpus (QN-006 baseline + 3-experiment data) used to calibrate a new scope's throughput
     expectations.
   Explicitly NOT mirrored: `reference/v-meta-ceiling-two-experiment.md`,
   `reference/g3-visual-review-env-gap.md` — the experiment-specific V-meta ceiling analysis and
   G3 env-gap case study the task's own Plan says to leave behind.

3. **`quay-core-bootstrap-methodology`** — left untouched, out of scope per the task's own Plan
   ("lowest priority — mostly experiment history. Extract nothing"). Confirmed no
   `plugin/skills/quay-core-bootstrap-methodology/` directory exists.

4. **`plugin/.claude-plugin/plugin.json`** — `commands[]` now lists 9 skills (was 7): added
   `./skills/quay-native-methodology/SKILL.md` and
   `./skills/quay-webui-bootstrap-methodology/SKILL.md`. Updated the top-level `description`
   field's skill enumeration accordingly.

5. **`plugin/test/plugin-packaging.test.mjs`** — updated the existing "declares N bundled
   skills" test (7→9, renamed to cite M179/DIR-070-F), added both new SKILL.md + reference/*.md
   files to the leak-check `shippedFiles` list, and added 4 new dedicated tests:
   - extraction fidelity: each of the 4 (native) / 2 (webui) reference files is byte-identical
     to its `.claude/skills/` source
   - originals-unmodified: `.claude/skills/quay-native-methodology/{inventory/,reference/
     v-meta-stall-analysis.md,reference/case-studies/}` and
     `.claude/skills/quay-webui-bootstrap-methodology/reference/{v-meta-ceiling-two-experiment.md,
     g3-visual-review-env-gap.md}` still exist AND are NOT mirrored into `plugin/skills/` (proves
     extraction, not a move)
   - `quay-core-bootstrap-methodology` has no `plugin/skills/` directory (proves out-of-scope
     item was correctly skipped)

## Real evidence

```
$ node --test plugin/test/plugin-packaging.test.mjs
...
✔ plugin.json is valid JSON and declares the 9 bundled skills (M179/DIR-070-F: +quay-native-methodology, +quay-webui-bootstrap-methodology)
✔ no shipped/foreign-workspace-facing file leaks this repo's own experiments/quay-perpetual-stream path or "exp5" label
✔ M179 (DIR-070-F): quay-native-methodology plugin skill exists with its 4 named reference files, byte-identical to their .claude/skills/ source
✔ M179 (DIR-070-F): quay-webui-bootstrap-methodology plugin skill exists with its 2 named reference files, byte-identical to their .claude/skills/ source
✔ M179 (DIR-070-F): original .claude/skills/ sources are unmodified and still contain experiment-specific content (extraction, not a move)
✔ M179 (DIR-070-F): quay-core-bootstrap-methodology is explicitly out of scope — no plugin/skills/ mirror exists
...
ℹ tests 34
ℹ pass 33
ℹ fail 1   <- PRE-EXISTING, unrelated: "shipped schema-check modules are byte-identical to
              their exp5 canonical source" — reproduced identically on master BEFORE this
              milestone's changes (confirmed via `git stash` + re-run); DIR-070-F's Touches list
              does not include plugin/scripts/task-schema*.ts, out of this milestone's scope.

$ grep -rilE "experiments/quay-perpetual-stream|\bexp5\b" plugin/skills/quay-native-methodology/ plugin/skills/quay-webui-bootstrap-methodology/
(no output — zero leaks)
```

Full repo suite (`scripts/test.sh`) run for regression-freedom; see commit for pass/fail counts.

## Touches

- `plugin/skills/quay-native-methodology/SKILL.md` (new)
- `plugin/skills/quay-native-methodology/reference/gate-mechanics.md` (new, byte-identical copy)
- `plugin/skills/quay-native-methodology/reference/directive-lifecycle.md` (new, byte-identical copy)
- `plugin/skills/quay-native-methodology/reference/patterns.md` (new, byte-identical copy)
- `plugin/skills/quay-native-methodology/reference/g3-audit-discipline.md` (new, byte-identical copy)
- `plugin/skills/quay-webui-bootstrap-methodology/SKILL.md` (new)
- `plugin/skills/quay-webui-bootstrap-methodology/reference/visual-review-mechanism.md` (new, byte-identical copy)
- `plugin/skills/quay-webui-bootstrap-methodology/reference/effectiveness-timing-corpus.md` (new, byte-identical copy)
- `plugin/.claude-plugin/plugin.json` (commands[] +2, description updated)
- `plugin/test/plugin-packaging.test.mjs` (+4 new tests, existing test updated 7→9, leak-check list +8 files)
- `.claude/skills/quay-native-methodology/`, `.claude/skills/quay-webui-bootstrap-methodology/` — read-only source, NOT modified (verified by the new originals-unmodified test)
