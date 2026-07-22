# M104 Plan — startServer outDegree 6→7 probe (ARCH-M103-002)

**Charter:** `experiments/quay-perpetual-stream/charters/M104-startserver-outdegree-probe.md`  
**Adjudication date:** 2026-07-22  
**Type:** WONTFIX documentation close

## Adjudication

Both proposals independently conclude **WONTFIX**:

- **Root cause**: M100's stated outDegree=6 was a measurement artefact. The `handleAllRoutes` import from `serve-handlers.ts` is the genuine new edge introduced by M100's extraction — inherent and load-bearing. outDegree=7 is the correct post-M100 baseline.

- **Proposal A**: Confirmed via `serve.ts` imports: {`config.ts`, `provider-client.ts`, `provider-env.ts`, `serve-handlers.ts`} = 4 module edges + StartServerOptions. No redundant edge removable without re-inlining handlers.

- **Proposal B**: Also confirmed, notes `serve.ts` has both a direct import AND a re-export block from `serve-handlers.ts` (archguard deduplicates to 1 edge). Confirmed 7 is the floor.

**No code change needed.** This is a documentation-only close.

## Steps

1. Update `tasks/ARCH-M103-002.md`:
   - Check AC items: "scope artefact confirmed (measurement artefact in M100, not scope difference)" → WONTFIX
   - Document root cause in DoD section
   - Update status → done

2. Run DoD meta-enforcer: `node experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs`

3. Write adversarial audit artifact to `milestones/M104/audits/iteration-0-acceptance-audit.md` (audit of the WONTFIX rationale: confirm no fix exists without reverting M100)

4. Commit: `git add tasks/ARCH-M103-002.md milestones/M104/ && git commit -m "docs(ARCH-M103-002): WONTFIX — startServer outDegree=7 is correct post-M100 baseline (M104)"`

5. Write ABSORB entry to `/tmp/m104-absorb-entry.md`

## Acceptance Criteria Check

- [x] Root cause: M100 measurement artefact (not scope difference; genuine new edge from handleAllRoutes import)
- [x] WONTFIX with documented rationale: "handleAllRoutes edge inherent to companion-file extraction; 7 is the new structural floor; no fix possible without reverting M100"
- [ ] ARCH-M103-002 task updated with resolution
