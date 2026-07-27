# M179 (DIR-070-F) — Build iteration 1

**Task:** DIR-070-F — Gap 3: extract reusable methodology skills to `plugin/skills/`
**Charter:** `experiments/quay-perpetual-stream/charters/M179-dir070f-methodology-skills.md`
**Absorb entry:** `/tmp/m179-absorb-entry.md`

## Starting state

The iteration-0 build (commit `6983aa6`, filed under the legacy
`experiments/quay-perpetual-stream/milestones/M179/iterations/iteration-0.md` path) already shipped
the full implementation and was independently re-confirmed defect-free by the iteration-0 acceptance
audit (`milestones/M179/audits/iteration-0-acceptance-audit.md`): all 4 AC + 5 DoD items CONFIRMED
against artifacts/diffs/test output, zero substance gap. That audit nonetheless returned overall
verdict REFUTED — driven entirely by the mechanical gate (`it0-dod-check.sh`), which failed on 3
process-documentation clauses (clause1 adversarial-audit disposition, clause2 V_meta-lag disposition,
clause7 test-floor disposition), plus a stalled lifecycle promotion (`status: todo` on master despite
the merge, no `gate-events.jsonl` entry). Root cause for clause1/2/7 is now understood and fixed at
the mechanism level by `gap-absorb-entry-clause-disposition-sequencing` (M180/M181): clause1/clause2
are the Audit phase's responsibility (append disposition text as the verdict/vmeta-lag value becomes
known, in the same turn that computes it — not retroactively fabricatable by the Build phase), while
clause7 is a Build-phase responsibility (tag the ABSORB-entry's `## Backlog row` with an accurate
`surface:<label>` token before the gate ever runs).

## Work performed this iteration

1. **Pre-flight (step 1):** confirmed `extra.acceptance` on `tasks/DIR-070-F.md` is already the
   canonical `it0-dod-check.sh DIR-070-F <charter> /tmp/m179-absorb-entry.md` command (set by a
   prior session; no change needed).
2. **Backlog-row surface tag (step 1a):** `/tmp/m179-absorb-entry.md`'s `## Backlog row` line carried
   no `surface:` token at all. Per this milestone's own `## Touches` list (exclusively
   `plugin/skills/*`, `plugin/.claude-plugin/plugin.json`, `plugin/test/plugin-packaging.test.mjs`,
   and two read-only `.claude/skills/*` sources — zero `packages/quay*` product-code touches), added
   `surface:packaging` (an exact member of `it0-dod-check.ts`'s `NON_PRODUCT_SURFACES` list) to the
   row's label column. Chosen over `method-infra`/`docs`/`cross-cutting` because the milestone's own
   substance IS packaging methodology reference material for distribution via the plugin.
3. **Implementation verification (step 2/3):** the code-level Done-when items were already landed at
   `6983aa6` (confirmed ancestor of current `HEAD`). Re-verified directly rather than trusting the
   prior report:
   - `plugin/skills/quay-native-methodology/{SKILL.md,reference/{gate-mechanics,directive-lifecycle,patterns,g3-audit-discipline}.md}` and
     `plugin/skills/quay-webui-bootstrap-methodology/{SKILL.md,reference/{visual-review-mechanism,effectiveness-timing-corpus}.md}` exist.
   - `grep -rl "experiments/quay-perpetual-stream\|exp5" plugin/skills/quay-native-methodology/ plugin/skills/quay-webui-bootstrap-methodology/` → zero matches (leak-free).
   - `plugin/.claude-plugin/plugin.json`'s `commands[]` lists both new SKILL.md paths (9 total commands).
   - `.claude/skills/quay-native-methodology/` and `.claude/skills/quay-webui-bootstrap-methodology/` are untouched (`git status --porcelain` on both is empty; experiment-specific `examples/`, `inventory/`, `scripts/`, `templates/`, `experiment-config.json` still present).
   - `node --test plugin/test/plugin-packaging.test.mjs`: **33/34 pass.** The 1 failure
     (`shipped schema-check modules are byte-identical to their exp5 canonical source...`,
     `task-schema.ts`) is the same pre-existing, independently-reproduced-on-parent-commit drift the
     iteration-0 audit already documented — unrelated to any file this task touches.
4. **Mechanical gate re-run:**
   `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070-F experiments/quay-perpetual-stream/charters/M179-dir070f-methodology-skills.md /tmp/m179-absorb-entry.md`
   — before the surface-tag fix: exit 1, 3 clause failures (clause1, clause2, clause7). After: exit 1,
   **2** clause failures (clause1, clause2 only) — `clause7-test-floor` now reads
   `N/A — surface label(s) [packaging] are exclusively non-product-touching`. clause1/clause2 remain
   FAIL by design at this Build step: their disposition text is written by the Audit phase (step 2a,
   `.claude/workflows/execute-milestone.js`), not fabricable here without a real audit having actually
   run in this session.

## Outcome

The Build-phase-scoped Done-when item (accurate `surface:` tag on the ABSORB-entry backlog row) is
complete. All product-code Done-when items (extracted skills, leak-free, manifest updated, test suite
green modulo the pre-existing unrelated failure) were already satisfied by the prior iteration and are
re-confirmed here, not re-implemented. Task lifecycle promotion (`status: todo` → `done`,
`gate-events.jsonl` entry) and the remaining clause1/clause2 disposition text are downstream
Audit/Absorb-phase responsibilities, out of this Build iteration's scope.
