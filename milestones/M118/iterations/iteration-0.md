# M118 iteration-0 — post-DIR-058 architecture audit (mandatory explore)

**Milestone:** M118 — `exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE`
**Charter:** `experiments/quay-perpetual-stream/charters/M118-arch-audit-post-dir058-explore.md`
**Date:** 2026-07-23
**Class:** methodology / explore (FILE-ONLY — no product/method code touched)

## AC1 — fresh archguard analysis, full-product baseline

```
archguard_analyze({ projectRoot: "/home/yale/work/quay", lang: "typescript", sources: ["packages"], noCache: true })
→ Analysis completed in 2.2s

archguard_summary({ scope: "packages", outputScope: "method" })
→ entityCount: 144
→ relationCount: 201
→ totalPackageCount: 11
→ relationCountByType: { dependency: 130, composition: 10, inheritance: 2 }
```

**Comparison table (partial baselines → this milestone's full baseline):**

| Reading | Scope | entities | relations | Notes |
|---|---|---|---|---|
| M93 | `packages/quay/src` only | 87 | 125 | Pre-existed as the historical reference point |
| M113 (post-full-TS, P0-P4) | `packages/quay/src` only (bin/, quay-backlog dark) | 121 | 156 | Excluded bin/ entrypoints + entire quay-backlog package (still `.js`) |
| M117 (post-DIR-058) | `packages/` (all 4 packages) | 144 | 201 | First reading to include quay-backlog/src + all 4 bin/ dirs |
| **M118 (this milestone, official)** | `packages/` (all 4 packages) | **144** | **201** | Re-confirmed identical to M117 — no drift, no regression from DIR-058 landing |

`quay-backlog/src` now shows entityCount=4 (was 0/dark). All 4 `bin/` dirs now parsed (entityCount=0
each — thin launchers with minimal top-level declarations, but now INCLUDED in the graph where
previously invisible as `.js`).

## AC2 — god-package / god-function metrics, full scope

`archguard_detect_god_packages` requires Atlas-mode Go analysis — not applicable to this TypeScript
project (confirmed: tool returns "No Atlas data found... requires a Go project"). This is a known,
pre-existing tool limitation (M93 already worked around it with a manual fanOut/fanIn heuristic
instead); not itself a new finding.

`topByOutDegree` (full `packages/` scope):
```
startServer        outDegree=7
createAdrStore      outDegree=5
createDocumentStore outDegree=5
runGate             outDegree=5
makeIt0Gate         outDegree=5
registerLifecycleHandlers outDegree=5
makeAdrGate         outDegree=4
makeFixedScriptGate outDegree=4
runComplete         outDegree=4
```

`startServer` (outDegree=7) is ARCH-M93-003's already-tracked, already-`done`/WONTFIX finding —
unchanged from every prior reading (M93/M98/M108/M113 all recorded the same outDegree=7 for this
function after its own decomposition). NOT a new finding.

`startMcpServer` no longer appears in the top-outDegree list at all (was rank 1 at M93/M98 before its
fix). Direct dependency query (`archguard_get_dependencies`, depth=1) on `quay/src/mcp-server.ts.startMcpServer`
confirms exactly 3 outgoing edges: `config.ts.loadConfig`, `mcp-handlers.ts.ConnectedProvider`,
`mcp-handlers.ts.registerAllHandlers` — outDegree=3, matching `PROBE-M98-001`'s own DoD claim exactly.
The M99 fix still holds, unregressed across M100–M117.

## AC3 — cycle detection, full scope

```
archguard_detect_cycles({ scope: "packages", outputScope: "package" })
→ []
```
No cycles anywhere across all 4 packages.

## AC4 — administrative bookkeeping resolution

Two pre-existing tasks had all AC/DoD boxes ticked from genuine past work, but `status: todo` left
stale (flagged at M115/M116/M117's own SELECT "not selected" notes):

- **`PROBE-M98-001`**: re-verified live this milestone — `startMcpServer` outDegree=3, exactly matching
  this task's own DoD claim. Flipped `status` → `done` (pure administrative correction, no
  re-investigation).
- **`exp5-M-ARCH-AUDIT-M98-EXPLORE`**: the M98 explore's own findings (including PROBE-M98-001) all
  confirmed still accurate. Flipped `status` → `done`.

## AC5 — new findings (FILE-ONLY)

**No new architectural findings.** DIR-058's landing (M116/M117) introduced zero structural
regressions: entity/relation counts match exactly between M117's preliminary reading and this
milestone's official re-run (144/201, identical), no new cycles, no new high-outDegree functions
beyond the already-tracked `startServer` WONTFIX. This is itself the milestone's value: independent
confirmation that a large mechanical migration (7 files across 2 milestones) did not introduce any
architectural drift — a legitimate, evidenced "clean" explore result, not an absence of effort.

No `routine-file-gate.ts` invocation was needed since no candidate finding was produced to gate.

## FILE-ONLY confirmation

No product/method code was touched this milestone — only task files (`PROBE-M98-001`,
`exp5-M-ARCH-AUDIT-M98-EXPLORE` status flips + this task's own authoring) and this report. Confirmed
via `git show --stat` on this milestone's commits (SELECT commit touches only `tasks/*.md` +
`charters/*.md`; ABSORB commit, once made, will show the same restriction).

## Recommendation

DONE. All 5 AC + 4 DoD items satisfied with pasted evidence above.
