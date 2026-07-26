# M176 — ABSORB pipeline never commits charter or Audit-phase evidence files (gap-absorb-charter-audit-not-committed)

**Task:** gap-absorb-charter-audit-not-committed · **Counter:** 176 · **Chart:** 2
**Class:** development · **Value type:** instrumentCorrection
**Deliverable:** no · **Charter tokens:** ~1.1 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (instrument-correction, VT-neutral). Two artifacts the ABSORB pipeline itself creates
(`experiments/quay-perpetual-stream/charters/M<NN>-*.md`, `milestones/M<NN>/audits/
iteration-0-acceptance-audit.md`) are never explicitly committed by any pipeline step — 16 charters
+ 19 audit files were found backlogged (M144-M166) and swept once by hand (commit `bfc5289`); the
exact same untracked-file pattern is STILL recurring live right now (`M173`/`M174` charter files
and `M173`'s own audit directory currently untracked on this session's own `git status`, and
`M175`'s own charter+audit were also untracked until this milestone's own Land step commits them
manually). This closes the gap at the source instead of requiring another manual sweep next time.

## Scope
Per the task's Requested action (root causes 1+2; root cause 3 and the optional tree-hygiene warn
are included as they're small and directly related):
1. `OUTER-LOOP.md`'s charter-authoring step (`author :: Task → Charter`) gains an explicit
   instruction: after writing `charters/M<NN>-*.md`, `git add` it as part of that milestone's own
   commit sequence (not left for Land to discover as untracked).
2. `execute-milestone.js`'s Audit phase, after writing `milestones/M<NN>/audits/
   iteration-0-acceptance-audit.md`, `git add`s that file — OR the Land phase's step 2 (CAPTURE)
   is changed from prose ("if a non-primary iteration produced evidence...") to a mechanical check
   that ALWAYS stages `milestones/M<NN>/audits/*` and `milestones/M<NN>/iterations/*` if present
   and untracked, regardless of which iteration produced them.
3. Pin one authoritative rule for the `milestones/` path prefix (`M<NN> >= 130 → top-level;
   else legacy experiments/quay-perpetual-stream/milestones/`) referenced by both the Audit-phase
   write instruction and `it0-dogfood-evidence-gate.sh`'s own lookup — single-sourced (ADR-004).
4. `tree-hygiene-check.sh` gains a WARN (non-blocking) path for an untracked file matching
   `experiments/quay-perpetual-stream/charters/M*.md` or `milestones/M*/audits/*.md` /
   `milestones/M*/iterations/*.md` at Gate time, so future drift is visible immediately instead of
   silently accumulating for months.

**Out of scope:** re-sweeping the current M173/M174/M175 backlog (that's an operational cleanup,
separate from fixing the pipeline itself — though this milestone's own Land step will incidentally
commit ITS OWN M176 charter/audit correctly, demonstrating the fix).

## Touches
- experiments/quay-perpetual-stream/OUTER-LOOP.md
- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
- experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh
- experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh
- plugin/scripts/tree-hygiene-check.sh

## Done-when
1. OUTER-LOOP.md's charter step explicitly instructs `git add`ing the new charter file
2. execute-milestone.js's Audit phase (or Land phase step 2, mechanically) stages the Audit-phase
   evidence file(s) for the CURRENT milestone, not just prose-conditional "if a non-primary
   iteration produced evidence"
3. A single authoritative `milestones/` path-prefix rule is referenced by both the Audit-phase
   write instruction and it0-dogfood-evidence-gate.sh (grep confirms no duplicated boundary logic)
4. tree-hygiene-check.sh warns (non-blocking) on an untracked charter/audit/iteration file at Gate
   time
5. This very milestone (M176) lands with its OWN charter + audit file already committed as part of
   its ABSORB commit sequence — no manual sweep needed, demonstrated live

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
