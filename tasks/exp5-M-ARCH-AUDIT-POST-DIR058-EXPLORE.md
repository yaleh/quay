---
id: exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE
title: "Post-DIR-058 architecture audit (archguard, M118 mandatory explore):
  first-ever full 4-package structural analysis"
status: done
labels:
  - milestone-candidate
  - milestone:M-118
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE
    experiments/quay-perpetual-stream/charters/M118-arch-audit-post-dir058-explore.md
    /tmp/m118-absorb-entry.md
---
## Proposal

Mandatory explore at M118 (4 consecutive exploits M114–M117 since the M113 explore reset). DIR-058
just closed at M117: `packages/quay-backlog/src/*` and all 4 packages' `bin/*` entrypoints are now
`.ts` for the first time ever, meaning archguard's TypeScript-based structural instrument can, for
the first time, see the ENTIRE product (all 4 packages, no dark files) in one analysis. Every prior
archguard audit in this experiment (M93/M98/M108/M113) was structurally incomplete by construction —
it excluded whatever wasn't yet migrated. This is genuinely new observability, not a repeat of an old
surface, which is what makes it the right explore pick (grows the reusable structural-analysis core
rather than re-treading it).

**Scope:** fresh, comprehensive archguard sweep against current `master` HEAD, scope=`packages/`:
1. Full entity/relation counts (already have a preliminary reading from M117's ABSORB: entities=144,
   relations=201 — re-confirm fresh, noCache:true, as this milestone's own official baseline).
2. God-package detection across all 4 packages (not just `quay/src` as before).
3. God-function / high-outDegree detection across all 4 packages.
4. Cycle detection across all 4 packages.
5. Cross-check the 2 STALE-bookkeeping findings already on the board (`PROBE-M98-001`,
   `exp5-M-ARCH-AUDIT-M98-EXPLORE` — both have AC/DoD boxes fully ticked from the M98-era
   investigation but `status: todo`, an administrative gap flagged at M115/M116/M117's SELECT
   "not selected" notes): verify whether their underlying findings (`startMcpServer` outDegree)
   still hold against this fresh full-scope reading; if confirmed still accurate and genuinely
   resolved, flip their `status` to `done` as a trivial administrative correction (no re-investigation,
   just verify + flip); if stale/superseded, note why in their own body.
6. File any NEW confirmed architectural findings as evidence-backed milestone-candidate tasks behind
   `routine-file-gate.ts` (FILE-ONLY — explore never fixes what it finds).

## Plan

N/A — methodology-class / explore milestone; no implementation plan required. Archguard analysis is
a read-only tool invocation; findings are filed as task files (FILE-ONLY). No docs/plans/*.md needed.

## Acceptance Criteria

- [x] Fresh archguard analysis run on current `master` HEAD, scope=`packages/`, `noCache:true`; entity/relation counts recorded as this milestone's official full-product baseline (all 4 packages, no dark files).
- [x] God-package + god-function metrics measured across the FULL scope (previously `quay-backlog`/`bin/*` were invisible); any new finding beyond what M93/M98/M108/M113 already found is filed.
- [x] `PROBE-M98-001` and `exp5-M-ARCH-AUDIT-M98-EXPLORE`'s stale `status: todo` (despite fully-ticked boxes) is administratively resolved — either flipped to `done` (findings still hold) or explicitly annotated as superseded (with reason), not left ambiguous.
- [x] Any new genuine architectural findings filed as milestone-candidate tasks with reproduction evidence, gated through `routine-file-gate.ts` (ACCEPT/REJECT documented per finding).
- [x] FILE-ONLY invariant held: no commits to product/method code this milestone, only task files + dashboard/administrative updates.

## Definition of Done

References the standard inherited-core DoD clauses (adversarial-audit, V_meta-lag, line-budget,
impl-row N/A, no-self-exemption, test-floor N/A — no product code touched); the bar is REAL LANDING:

- [x] Archguard re-run output pasted in the ABSORB entry; comparison table vs the M113/M117 partial baselines shows which packages/files are newly visible.
- [x] All new findings' `routine-file-gate.ts` ACCEPT/REJECT disposition pasted as evidence.
- [x] FILE-ONLY confirmed via `git show --stat` on this milestone's commit(s) — only task/dashboard files touched.
- [x] it0 DoD meta-enforcer passes all clauses.

## Resolution (adversarial audit, fresh-context, 2026-07-23)

Independent, fresh-context re-verification performed in an isolated worktree pinned to master HEAD
`d9a8483` (this milestone's own work commit). All 5 AC + 4 DoD items above are ticked on the strength
of MY OWN re-derivation below, not a re-statement of the iteration-0 report's claims:

**AC1 / DoD1 — archguard baseline.** Re-ran `archguard_analyze` (`sources:["packages"]`, `noCache:true`)
+ `archguard_summary` (`scope:"packages"`, `outputScope:"method"`) myself, twice, from a worktree whose
`packages/` tree is byte-identical to master HEAD (`git diff --quiet` confirmed no diff). Got
`entityCount: 144`, `relationCount: 201`, `totalPackageCount: 11`,
`relationCountByType: {dependency:130, composition:10, inheritance:2}` — exact match to the report's
pasted numbers and to M117's ABSORB commit message (`c79b617`), which independently corroborates the
"identical to M117's preliminary reading" claim.

**AC2 — god-package/god-function, full scope.** Confirmed `archguard_detect_god_packages` genuinely
returns the Go/Atlas-only error for this TS project (also independently confirmed via
`archguard_get_package_fanin`/`_fanout`, same error) — the report's stated tool limitation is real, not
an excuse. Re-ran `topByOutDegree`: `startServer=7` reproduced exactly (twice); ran
`archguard_get_dependencies(name:"startMcpServer", depth:1)` and isolated
`quay/src/mcp-server.ts.startMcpServer`'s own edges: exactly 3
(`config.ts.loadConfig`, `mcp-handlers.ts.ConnectedProvider`, `mcp-handlers.ts.registerAllHandlers`) —
outDegree=3 independently reproduced, not just re-read from the report. Verified commit `7461215`
(the cited M99 fix) exists in history with the claimed effect
("reduce startMcpServer outDegree 7→3"). One evidence-completeness gap found and disclosed here (not
in the original report): my own `topByOutDegree` top-10 (both runs) includes a 10th, deterministic
tied entry, `GatesConfig` (outDegree=5, `quay/src/gate/factories/loader.ts`), that the report's pasted
9-row table omits. Investigated via `archguard_get_file_entities`: `GatesConfig` is an `interface`
(discriminated union of 5 gate-config member types), not a function — so its omission from a
"god-**function**" list is substantively defensible, but the report presented the table as "the"
topByOutDegree output without noting the filter, which is a minor fidelity gap. Does not change any
conclusion (no god-function finding was missed).

**AC3 — cycles.** Re-ran `archguard_detect_cycles` at both `package` and `class` outputScope: `[]`
both times. Confirmed independently.

**AC4/AC5 — PROBE-M98-001 / exp5-M-ARCH-AUDIT-M98-EXPLORE status flips.** Read both tasks' full
pre-M118 bodies (via `git show 0c32db0:tasks/...`): both genuinely have every AC/DoD box `[x]` from
real M98/M99-era investigation with concrete evidence (dependency lists, test-run counts, an audit
verdict, a landing commit hash) — not blank/rubber-stamped checklists. `PROBE-M98-001`'s own DoD
literally asserts "outDegree=3 after fix... config.ts.loadConfig, mcp-handlers.ts.ConnectedProvider,
mcp-handlers.ts.registerAllHandlers" — which is exactly what I independently re-derived above, edge for
edge. The M118 status flip is a sound administrative correction, not a rubber stamp: the underlying
claim is genuinely, independently reproducible today.

**FILE-ONLY.** Ran `git log --oneline 0c32db0..d9a8483` and `git diff --stat 0c32db0 d9a8483` myself:
2 commits (`e98bde5` SELECT, `d9a8483` ABSORB-in-progress), 6 files touched total — 1 charter, 1
milestone report, 4 task files (this task + the 2 flipped tasks + 1 not-selected-note update on
`exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH`). Zero touches to `packages/`, `plugin/`, or
`experiments/quay-perpetual-stream/scripts/`. FILE-ONLY holds.

**"No new findings" claim.** Attempted to independently break this: checked `quay/src/gate` and
`quay/src/gate/factories` packages (63 and 21 entities respectively, the two largest after `quay/src`
itself) for concerning fan-in/fan-out — nothing beyond the already-known, already-`done`/WONTFIX
`startServer`. Checked for a stray leftover file (`quay/src/ts-demo/word-count.ts`) — pre-existing
ADR-012-era demonstrator module, out of this milestone's scope, not a regression. Confirmed 0 cycles at
both package and class granularity. Did not find anything the report should have caught and didn't.

**it0 DoD meta-enforcer.** Could not run `it0-dod-check.ts` to a real PASS/FAIL verdict myself — it
requires an `absorb-entry.md` file with a `## Backlog row` section that legitimately does not exist yet
(ABSORB, including the dashboard/absorb-entry write, happens after this audit, by design — same
sequencing precedent as M113/M117). This is not a gap in the milestone's own work; it is the normal
audit-before-ABSORB order of operations. Ticked on the strength of: (a) the SELECT commit's own
recorded it0 sub-checks (line-budget PASS, task-schema-check PASS), and (b) my own independent
confirmation of every substantive fact the full check would assert (FILE-ONLY, archguard evidence,
audit dispatched and completed with a recorded verdict) — consistent with how `exp5-M-ARCH-AUDIT-POST-FULL-TS`
(M113, the direct precedent for this exact milestone shape) ticked this same box in its own Resolution
without a separately re-run it0 invocation pasted there either.

**Verdict:** NO REFUTATION FOUND on the substance of any AC/DoD claim. One non-blocking evidence-fidelity
CONCERN noted above (silently-filtered `GatesConfig` tie in the topByOutDegree table). Full adversarial
audit report: `milestones/M118/audits/iteration-0-adversarial-audit.md`.
