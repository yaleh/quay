---
name: workflow-milestone-cadence
description: Prefer background Claude Code workflows at milestone granularity + a scheduled milestone e2e incl. browser tests (keeps L_T on the real axis) — ADR-009/010
metadata:
  node_type: memory
  type: feedback
---

Development on quay is driven through **background Claude Code workflows at milestone granularity** (one workflow episode ≈ one milestone; ADR-009), paired with a **scheduled milestone e2e including browser tests** (Playwright / chrome-devtools) that exercises the real product surface (CLI/serve/web-UI), not a proxy — this keeps `L_T` measured on the REAL axis (ADR-010).

**Why:** the curl-vs-real-subagent lesson (`docs/references/geometry-as-llm-architecture-interface.md` §2) — a cheap proxy e2e (curl impersonating a subagent) passed with `L_T=0` while the design was still wrong, because the sampling instrument flattened the one dimension the design turned on. Milestone-granular workflows give a clean cadence where the scheduled real-surface e2e (and the ADR-007 dark-axis instruments) attach; open-ended granularity-free runs have no such checkpoint.

**How to apply:**
- Run typical dev as a background workflow bounded at a milestone; steer via DIR-027 hygiene (`.halt` sentinel or a private worktree off `master`; never race the loop on `master`).
- At each milestone, run the scheduled e2e incl. at least one browser test against `quay serve`; do not substitute a curl/mock and report `L_T=0` as green.
- Pair with the GIT review checklist ([[reference-git-lens]]): also ask which of `L_T/L_C/L_D/L_G/L_S` is still dark, using archguard ([[reference-archguard-metacc-tools]]) for `L_D/L_G`.
