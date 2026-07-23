# M123 iteration-0 — post-M121/M122 architecture audit (mandatory explore)

**Task:** `exp5-M-ARCH-AUDIT-POST-M122-EXPLORE`
**Charter:** `experiments/quay-perpetual-stream/charters/M123-arch-audit-post-m122-explore.md`
**Class:** methodology-class / explore. FILE-ONLY — no product code touched.

## What was done

Ran a fresh archguard sweep against `packages/` (scope=`packages`) to confirm M121
(`gate/registry.ts`'s dual-mode `__dirname` fix) and M122 (`release.yml` CI extension + Windows
dotglob archiving fix) introduced no structural regression.

## Real evidence

```
archguard_analyze(projectRoot=/home/yale/work/quay, sources=["packages"], lang=typescript,
                   format=json, noCache=true)
→ packages/overview/package: 22 entities, 57 relations
→ packages/class/all-classes: 144 entities, 201 relations

archguard_summary(scope=packages, outputScope=class)
→ entityCount=144, relationCount=201
→ totalPackageCount=11
→ topByOutDegree[0] = { name: "startServer", outDegree: 7 }  (unchanged, ARCH-M93-003 WONTFIX)

archguard_detect_cycles(scope=packages, outputScope=package)
→ []  (0 cycles)
```

**Comparison against the M117/M118 full-4-package baseline (entities=144, relations=201, 0 cycles):**
IDENTICAL. **Correction (M123's own adversarial audit, CONCERNS, non-blocking):** this section
originally cited "the M113/M117/M118 baseline" as if all three shared the same 144/201 number —
`dashboard.md`'s own M113 log line (`m113 · exp5-M-ARCH-AUDIT-POST-FULL-TS`) actually records
entities=121/relations=156, a DIFFERENT (smaller-scope) reading from before DIR-058 completed the
full 4-package TS migration. Only M117/M118 (post-DIR-058) share the 144/201 number this milestone's
own sweep reproduces; M113 is cited elsewhere in this repo's history as its own, separate, pre-DIR-058
baseline. No structural regression either way — expected, since M121 touched exactly one function
inside an already-existing file (no new imports/exports/dependencies) and M122 touched only
CI-workflow YAML + a JSON evidence file + test assertions (no `packages/**` source at all).

## New findings

None. The sweep confirms the baseline is unchanged; nothing new to file via `routine-file-gate.ts`.

## FILE-ONLY confirmation

**Correction (M123's own adversarial audit, CONCERNS, non-blocking):** this section originally pasted
an aspirational/template `git status --short` transcript (written before the actual SELECT+impl
commit landed) that incorrectly listed `dashboard.md` as modified. The REAL commit
(`cbfd047`, verified via `git show --stat cbfd047`) does NOT touch `dashboard.md` at all — the
dashboard's ABSORB-time Log-line append happens later, at ABSORB, as its own separate commit, not as
part of this SELECT+impl commit. Real transcript:
```
$ git show --stat cbfd047
 experiments/quay-perpetual-stream/backlog.md                              |  3 +-
 experiments/quay-perpetual-stream/charters/M123-arch-audit-post-m122-...  | 50 +++++
 experiments/quay-perpetual-stream/milestones/M123/iterations/iteration-0.md | 50 +++++
 tasks/DIR-062-A.md                                                         |  7 ++-
 tasks/DIR-063-A.md                                                         |  7 ++-
 tasks/exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH.md                       |  7 ++-
 tasks/exp5-M-ARCH-AUDIT-POST-M122-EXPLORE.md                               | 49 +++++
```
Zero `packages/**` source files touched — FILE-ONLY held (the underlying claim was correct; only the
supporting transcript was inaccurate, now fixed to the real one).
