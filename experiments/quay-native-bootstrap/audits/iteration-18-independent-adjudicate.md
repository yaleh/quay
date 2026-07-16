# Iteration 18 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Had `gh` CLI/network access, enabling genuine live reproduction.

**Verdict: PASS**

## Findings

1. **DIR-005 resolution confirmed.** `manda-dispatch status --id=iter18-dir005-probe --root .` now returns `cancelled`, matching the report's claim of a clean `DispatchCancel` (not "queued forever"). `manda events pending-cord` independently shows the exact probe payload landed at the claimed cursor. `cord` confirmed as a genuinely detached child (`tty=?`) of the relevant session's process tree, corroborating the documented `tty`-filter pitfall. The Resolution section's technical narrative (stateless renderer, no side effects, no watcher) is internally consistent, and the file is correctly archived with `experiments/quay-native-bootstrap/directives/pending/` now empty. **Caveat, honestly flagged by the auditor**: its own ppid-walk replication turned out to share the same session lineage as iteration 18 itself, so this is a re-confirmation within one lineage, not a fresh independent one — this doesn't undermine the finding (all evidence checked out against live process state) but is noted for completeness.

2. **QN-029 confirmed genuine.** Pre-fix SKILL.md files literally hardcoded `quay-native task get/check/edit <id>` with no provider parameter — confirmed via `git show 1edfb1a^`. The diff correctly defaults to `provider="native"` (preserving prior behavior byte-identically, independently re-verified) and introduces zero backend-specific branching, routing entirely through Core's pre-existing generic CLI.

3. **Live GitHub verification independently reproduced** with real `gh` CLI/network access: `quay task view/check gh-3 --provider github --json` both succeeded against the real, live issue, returning real data (`"acTotal": 4, "acChecked": 0`) — matches the report's claim precisely.

4. **`provider.yml`/DESIGN.md confirmed**: `skill: true` with `status_skill_map`/`action_buttons`; DESIGN.md correctly bumped.

5. **Tests confirmed: all 12 files PASS**, `abi-symmetry.mjs` confirms all four surfaces symmetric.

6. **Arithmetic confirmed exactly.** 21/28=0.75 (28 task files verified via `ls`). V_instance=0.60×0.94×0.75×0.94=0.3976; V_meta=0.74×0.20×0.68×0.64=0.0644. Both match protocol formulas.

7. **Scope confirmed clean** — exactly the 9 claimed files changed, working tree clean.

## Net assessment
No discrepancies found. QN-029 is a genuine, correctly-scoped parameterization achieving skill-capability parity for quay-github without introducing backend-specific branching — independently reproduced against the real live GitHub repo. DIR-005's resolution is honest and precise: it correctly narrows the root cause from "nothing claims the dispatch" to "target discovery works, but no live watcher is attached to the rendered output" — a real, more precise negative finding, not a forced positive result. The one methodological caveat (same-lineage re-confirmation rather than a fresh session) is self-disclosed by the auditor rather than glossed over.
