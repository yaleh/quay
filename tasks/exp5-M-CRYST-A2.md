---
id: exp5-M-CRYST-A2
title: "A2 [subtractive] Retire stale corrupted-title duplicates tasks/DIR-004/005
  (DIR-010 namespace residue); exp5 canonical content stays at exp5-DIR-004/005"
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:first-wave
parent: exp5-M-CRYST
children: []
extra:
  schema: "v1"
---
## Proposal
CORRECTED finding (the original "unify all ids on exp5- prefix / clean foreign experiment-4 tasks" framing was wrong — root-caused during execution): `tasks/DIR-004.md` and `tasks/DIR-005.md` were NOT clean foreign experiment-4 tasks. They were **stale, corrupted-title DUPLICATES** — their bodies hold exp5's OWN directive content (DIR-004 milestone-sizing, DIR-005 V_meta-consolidation-lag; one body even truncated mid-sentence), with an experiment-4 title + `experiment-4` label + dangling `Source:`/`extra.dirFile`/`Status mirror:` scaffolding grafted on, pointing at exp5 archive files that DIR-028 already deleted.

The DIR-010 residue is closed by DELETING these two duplicates (human-approved), because:
1. exp5's canonical DIR-004/005 already live — clean, complete, correctly-titled — at `tasks/exp5-DIR-004.md` ("Milestone sizing — cost band via build+verify unit, value-typed SELECT") and `tasks/exp5-DIR-005.md` ("V_meta consolidation lag — tracked and gated at ABSORB"). No content lost.
2. experiment-4's REAL DIR-004 (Node SEA/Bun release artifacts) is untouched in `experiments/quay-continuous-bootstrap/directives/archive/DIR-004-node-sea-bun-compile-release-artifacts.md`.
3. exp5's own directives stay bare (DIR-001/002/003/006-029) + the two prefixed exp5-DIR-004/005 (human decision: leave prefixed, do NOT renumber — a stable-id rewrite for pure cosmetics is churny, not subtractive). The namespace is mixed but unambiguous.

Second root-cause fix: the original AC used a naive `grep -lE '^Source:|dirFile:'`, which false-positives on legitimate PROSE mentions in DIR-009/010/028 (the same false-positive class already fixed in the B1 validator). The AC below uses the validator's precise `checkNoScaffolding` instead.

## Plan
N/A — a subtractive two-file deletion + task-record correction; no staged docs/plans doc warranted.

## Acceptance Criteria
- [ ] `ls tasks/DIR-004.md tasks/DIR-005.md 2>/dev/null` is EMPTY (the two stale duplicates are gone).
- [ ] exp5 canonical content preserved: `ls tasks/exp5-DIR-004.md tasks/exp5-DIR-005.md` both exist and carry the sizing / V_meta-gate bodies.
- [ ] No REAL projection scaffolding on any DIR task, by the validator's `checkNoScaffolding` (not a naive grep): the sweep over `tasks/{DIR-,exp5-DIR-}*.md` reports 0 real hits (DIR-009/010/028 prose mentions correctly NOT flagged).
- [ ] No remaining `experiment-4`-LABELLED DIR directive task on the exp5 board — a precise labels-block check (NOT a naive body grep, which false-positives on DIR-009/010/028's prose mentions of "experiment-4"): `for f in tasks/DIR-*.md; do sed -n '/^labels:/,/^[^ -]/p' "$f" | grep -q experiment-4 && echo "$f"; done` is empty. (experiment-4's own `QX-*` task board is out of scope and untouched.)

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, subtractive:
- [ ] The two stale duplicates are deleted (net-negative lines); exp5's canonical directives survive unharmed at the prefixed ids.
- [ ] The precise scaffolding check reports the DIR namespace CLEAN (0 real hits) on the live board.
- [ ] Root-cause discipline honored: the mistaken "foreign task" premise and the naive-grep AC were both corrected at the source (this record), not patched over.