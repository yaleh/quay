# M179 — Extract reusable methodology skills to plugin/ (DIR-070-F)

**Task:** DIR-070-F · **Counter:** 179 · **Chart:** 2
**Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.6 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (capability-growth, deliverable — closes DIR-070 Gap 3, the last open child of the DIR-070
epic). Pure addition: extract reusable methodology reference material (gate mechanics, directive
lifecycle, patterns, G3 audit discipline, visual-review-mechanism rules) from two experiment-local
skills into `plugin/skills/`, so external plugin consumers get the portable rules without the
experiment-specific case studies/history. Zero risk to the experiment layer — nothing in
`experiments/` or `.claude/skills/` is deleted, only mirrored-and-trimmed into `plugin/`.

## Scope
Per DIR-070-F's own Plan (already fully specified in the task body):
1. `quay-native-methodology` → extract `reference/gate-mechanics.md`, `reference/
   directive-lifecycle.md`, `reference/patterns.md`, `reference/g3-audit-discipline.md` into
   `plugin/skills/quay-native-methodology/SKILL.md`. Leave experiment-specific case studies/
   inventory/V-meta analysis in `.claude/skills/quay-native-methodology/`.
2. `quay-webui-bootstrap-methodology` → extract `reference/visual-review-mechanism.md` +
   effectiveness-timing corpus into `plugin/skills/quay-webui-bootstrap-methodology/SKILL.md`. Leave
   experiment-specific V-meta ceiling analysis / G3 env gap case study in `.claude/skills/`.
3. `quay-core-bootstrap-methodology` — explicitly OUT of scope per the task's own Plan (lowest
   priority, "extract nothing; leave as experiment-local reference").
4. Update `plugin/.claude-plugin/plugin.json` commands[] to register the 2 new skills.
5. Update `plugin/test/plugin-packaging.test.mjs` to cover the new skills (leak check: no
   `experiments/quay-perpetual-stream`/`exp5` strings in the extracted files).

## Touches
- .claude/skills/quay-native-methodology/ (read-only source, not modified)
- .claude/skills/quay-webui-bootstrap-methodology/ (read-only source, not modified)
- plugin/skills/quay-native-methodology/SKILL.md (new)
- plugin/skills/quay-webui-bootstrap-methodology/SKILL.md (new)
- plugin/.claude-plugin/plugin.json
- plugin/test/plugin-packaging.test.mjs

## Done-when
1. Both extracted skills exist under `plugin/skills/`, contain only the reference material named in
   Scope items 1-2, and pass the plugin-packaging leak test (no `experiments/quay-perpetual-stream`
   or `exp5` substring).
2. Original `.claude/skills/quay-native-methodology/` and `.claude/skills/
   quay-webui-bootstrap-methodology/` are unmodified — still contain their experiment-specific
   content (this is an extraction/mirror, not a move).
3. `plugin/.claude-plugin/plugin.json`'s `commands[]` lists both new skills.
4. `plugin/test/plugin-packaging.test.mjs` passes, including new coverage for these 2 skills.
5. No regression to the existing plugin-packaging test suite.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
