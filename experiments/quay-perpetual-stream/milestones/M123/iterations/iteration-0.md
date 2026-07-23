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

**Comparison against the M113/M117/M118 baseline (entities=144, relations=201, 0 cycles):**
IDENTICAL. No structural regression — expected, since M121 touched exactly one function inside an
already-existing file (no new imports/exports/dependencies) and M122 touched only CI-workflow YAML
+ a JSON evidence file + test assertions (no `packages/**` source at all).

## New findings

None. The sweep confirms the baseline is unchanged; nothing new to file via `routine-file-gate.ts`.

## FILE-ONLY confirmation

```
$ git status --short
 M experiments/quay-perpetual-stream/backlog.md        (regenerated view)
 M experiments/quay-perpetual-stream/dashboard.md       (ABSORB entry)
?? experiments/quay-perpetual-stream/charters/M123-...  (this charter)
?? experiments/quay-perpetual-stream/milestones/M123/   (this report + audit dir)
 M tasks/DIR-062-A.md, tasks/DIR-063-A.md, ...           (not-selected notes)
 M tasks/exp5-M-ARCH-AUDIT-POST-M122-EXPLORE.md          (AC evidence)
```
Zero `packages/**` source files touched — FILE-ONLY held.
