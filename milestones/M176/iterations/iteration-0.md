# M176 — iteration-0

**Task:** gap-absorb-charter-audit-not-committed
**Charter:** experiments/quay-perpetual-stream/charters/M176-gap-absorb-charter-audit-commit.md

## Summary

Closed all three root causes the task's Finding identified, at the source (not another
manual sweep), plus the optional tree-hygiene WARN:

1. **Charter commit (root cause 1).** `experiments/quay-perpetual-stream/OUTER-LOOP.md`'s
   `charter :: Task → Charter` step now carries an explicit invariant:
   `⊨ commit: git add experiments/quay-perpetual-stream/charters/M<NN>-*.md as part of THIS
   milestone's own commit sequence, immediately after writing it — never left for Land to
   discover as untracked`.

```
$ git diff experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -59,6 +59,10 @@
 charter(t) = write("charters/M<NN>-<slug>.md", {gate, scope, done_when, inner_term, it0_checks, ptr})
+  ⊨ commit: git add experiments/quay-perpetual-stream/charters/M<NN>-*.md as part of THIS milestone's
+     own commit sequence, immediately after writing it — never left for Land to discover as untracked
+     (gap-absorb-charter-audit-not-committed / M176: 16 charters + 19 audit files backlogged M144-M166
+     from this exact gap, swept once by hand in bfc5289 — closed at the source, not re-swept)
   ⊨ gate: transclusion_byte_for_byte ⊕ by_reference(scripts/it0-gate-hash-check.sh --by-reference)
```

2. **Audit-file commit (root cause 2), mechanical + defense-in-depth.** In both
   `.claude/workflows/execute-milestone.js` and `plugin/workflows/execute-milestone.js`
   (kept byte-identical, verified below):
   - The **Audit phase** prompt now instructs the auditor to `git add` its own output file
     immediately after writing it (belt).
   - The **Land phase** step 2 (CAPTURE), in BOTH the serial and concurrent code paths, was
     changed from the old prose-conditional ("if a non-primary iteration produced evidence
     not on master, cherry-pick JUST that evidence file") to a **mechanical, unconditional**
     instruction: resolve `MILESTONE_ROOT` via the single-sourced rule and `git add`
     *everything* currently untracked under `$MILESTONE_ROOT/audits/` and
     `$MILESTONE_ROOT/iterations/`, regardless of which iteration/phase produced it, plus the
     milestone's own charter file if still untracked (suspenders — backstop for root cause 1
     in case the charter step's own `git add` was skipped).

```
$ node --check .claude/workflows/execute-milestone.js && echo OK
OK
$ node --check plugin/workflows/execute-milestone.js && echo OK
OK
$ diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js && echo IDENTICAL
IDENTICAL
```

3. **Path-prefix single-source (root cause 3).** Added `gate_resolve_milestone_root()` to
   `gate-script-lib.sh` (both `plugin/scripts/` and `experiments/quay-perpetual-stream/scripts/`
   copies, kept identical) — THE one place the `>= 130 → top-level; else legacy` boundary rule
   is allowed to live. `it0-dogfood-evidence-gate.sh`'s own `--milestone` lookup now calls this
   function instead of re-deriving the boundary; the Audit-phase and Land-phase prompts in
   `execute-milestone.js` reference the SAME function by name (never re-derive the numeric
   threshold). A live bug was found and fixed as part of this: the caller
   (`execute-milestone.js`'s `_milestone` extraction) passes a BARE digit string (`"176"`, no
   `M` prefix) — the OLD dual-probe loop matched literally against `milestones/${MILESTONE}`,
   i.e. `milestones/176` (never exists), so the dogfood-evidence gate was **silently
   vacuously-passing on every real invocation** before this fix. `gate_resolve_milestone_root`
   strips an optional leading `M` and trailing `-slug`, so it resolves correctly for both
   `"176"` and `"M176"`.

```
$ bash -c 'source plugin/scripts/gate-script-lib.sh; gate_resolve_milestone_root 176; gate_resolve_milestone_root M176; gate_resolve_milestone_root 45'
milestones/M176
milestones/M176
experiments/quay-perpetual-stream/milestones/M45

$ bash experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh --milestone 175   # BEFORE fix: "Milestone directory not found for 175 — vacuously PASS." (wrong path)
--- milestones/M175/audits/iteration-0-acceptance-audit.md ---
No claimed-met Done-when-style clauses found ... vacuously PASS.
--- milestones/M175/iterations/iteration-0.md ---
No claimed-met Done-when-style clauses found ... vacuously PASS.
exit=0

$ grep -rn "130" experiments/quay-perpetual-stream/OUTER-LOOP.md plugin/workflows/execute-milestone.js .claude/workflows/execute-milestone.js experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh
plugin/workflows/execute-milestone.js:...hand — that function is the only place the ">= 130" rule is allowed to live.
.claude/workflows/execute-milestone.js:...hand — that function is the only place the ">= 130" rule is allowed to live.
experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh:...duplicated ">= 130" boundary logic anywhere else).
experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh:...Legacy milestones (< 130) may be stored...
```

No file outside `gate-script-lib.sh` contains the numeric `130` boundary as executable logic —
only comments referring back to the single function. AC "single authoritative rule ... grep
confirms no duplicated boundary logic" is satisfied.

4. **tree-hygiene WARN (optional item, included).** `tree-hygiene-check.sh` (both
   `experiments/quay-perpetual-stream/scripts/` and `plugin/scripts/` copies) now emits a
   **non-blocking WARN** (exit code unaffected) when an untracked file matches
   `charters/M<NN>-*.md` or `milestones/M<NN>/{audits,iterations}/*.md` anywhere in the tree.
   The `plugin/scripts/` copy uses a workspace-portable regex (no hardcoded
   `experiments/quay-perpetual-stream/` prefix or `exp5` literal) — required by
   `plugin/test/plugin-packaging.test.mjs`'s "no shipped file leaks the internal experiment
   layout" tests, both of which initially FAILED on my first pass (caught + fixed, see below).

```
$ bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh
tree-hygiene: WARN — untracked ABSORB-pipeline evidence file(s) (charter/audit/iteration).
              Stage these as part of their milestone's own commit sequence (OUTER-LOOP.md
              charter step / execute-milestone.js Land-phase CAPTURE) — non-blocking, but
              left unaddressed these accumulate silently:
  experiments/quay-perpetual-stream/charters/M176-gap-absorb-charter-audit-commit.md
tree-hygiene: clean — no un-gitignored scratch left in the main tree.
exit=0

$ bash plugin/scripts/tree-hygiene-check.sh
tree-hygiene: WARN — untracked ABSORB-pipeline evidence file(s) (charter/audit/iteration).
              ...
tree-hygiene: clean — no un-gitignored scratch left in the main tree.
exit=0
```

Exit 0 in both cases confirms the WARN is genuinely non-blocking.

## Regression check

`plugin/test/plugin-packaging.test.mjs` initially caught a workspace-portability regression:
my first draft of `plugin/scripts/tree-hygiene-check.sh`'s WARN pattern hardcoded
`experiments/quay-perpetual-stream/charters/...`, which two existing tests assert must NEVER
appear in shipped/universal-gate plugin files. Fixed by switching to an unanchored,
prefix-agnostic regex (`(^|/)charters/M[0-9]+-[^/]+\.md$|...`) and de-repo-specific-ing the
WARN's own comment text.

```
$ scripts/test.sh plugin/test/plugin-packaging.test.mjs
ℹ tests 30
ℹ pass 30
ℹ fail 0
```

Full `scripts/test.sh` (all packages, no live-GitHub) also run — see the transcript
appended to the ABSORB entry / dispatch record for the full pass/fail counts; no regressions
attributable to this milestone's changes.

## Files touched

- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh`
- `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh`
- `plugin/scripts/tree-hygiene-check.sh`
- `experiments/quay-perpetual-stream/scripts/gate-script-lib.sh` (new function; not in the
  charter's declared `## Touches`, but required to actually single-source the rule the
  Touches list's other 6 files all reference — see charter Scope item 3)
- `plugin/scripts/gate-script-lib.sh` (mirror of the above)

## Outcome

All four Scope items (charter commit, audit-file commit, path-prefix single-source, tree-hygiene
WARN) implemented and locally verified. Item 5 of the charter's Done-when ("this milestone lands
with its own charter + audit committed") is a Land-phase-time claim — verified at Land, not Build;
this Build step stages the charter itself as evidence the fix is being exercised (see commit).
