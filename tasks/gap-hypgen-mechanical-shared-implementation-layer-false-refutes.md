---
id: gap-hypgen-mechanical-shared-implementation-layer-false-refutes
title: "arch-hypothesis-generation: the mechanical shared-implementation layer
  issues a REFUTED verdict while named components that do not import the definer
  carry the claimed divergence, and it falsely refuted a confirmed real defect"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
Measured in pre-registered experiment `E-DT-1` (run 2026-10-12, tool `feeea5036`, pin `f2432d178`, artifacts in `/data/home/yale/work/quay-scratch/dt1/verify-{Hf,Hp}/verify.json`).

**What fired.** The mechanical layer (`sharedImplementation` / `mechanicalRefutation`) recorded 6 refutations: Hf c4, c14, c15 and Hp c3, c6, c15.

**What all 6 have in common.** In every one, ≥2 named components do NOT import the "definer". The shipped rule only requires all in-set import edges to target one module with ≥2 importers. It ignores non-importing components entirely.

**The confirmed false refutation, Hf c15.** It is the checker exit-code cluster. Its NOT-EVALUATED 2-vs-3 divergence is a confirmed real defect: `checker-io.ts:54` maps not-evaluated to 2, `gate-script-base.ts:578` maps it to 3, and the spine contract says 2=usage, 3=NOT-EVALUATED. The real `run_checker` control behind the done task `gap-ac69-malformed-record-exits-3-and-passes-the-static-gate` confirmed it. The layer refuted Hf c15 because `dead-code-after-return-check.ts:43` and `outer-anchor-check.ts:56` import `driverResultToExit` from `checker-io.ts`. But `checker-mechanical-spine-check.ts`, the component holding the conflicting contract, imports nothing from `checker-io.ts`.

**A stricter variant is not safe either.** I checked "every non-defining component imports the definer AND ≥2 importers" against `E-HYPGEN-AB-1` arm A cluster c15 (the routine quota window, a confirmed real defect where `routine_quota.window_ms` was parsed but inert). It would still refute it: importing constants from `driver-config.ts` does not mean consuming the configured value.

So an import edge is evidence about reuse, not a verdict on the claim.

## Plan
- The mechanical layer no longer emits a verdict. It attaches its shared-import findings, along with the list of named components that do NOT import the definer, as EVIDENCE lines in the verifier's evidence pack.
- The model verifier decides as for any other cluster.
- Records carry `mechanical_evidence` instead of `mechanical: true` / `verdict_reason: shared-implementation`.
- Behaviour without `--provenance` is unchanged.

## Acceptance Criteria
- [ ] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0, with new cases:
  - (a) A cluster whose in-set edges converge on one module, but which has a named non-importer, yields NO mechanical verdict, and its pack lists the non-importer.
  - (b) A cluster where every component imports the definer also yields no verdict, but carries the import lines as evidence.
  - (c) Without `--provenance`, output is byte-identical to before.
- [ ] Real replay, no model call: run the shipped selection on `/data/home/yale/work/quay-scratch/dt1/verify-Hf/verify.json` clusters with `provenance-entries-H.json`. Paste the result: 0 clusters carry a mechanical verdict, and c15's evidence lists `checker-mechanical-spine-check.ts` as a non-importer.
- [ ] Mutation control: restore verdict emission and show case (a) goes red. Paste the output, then revert.

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-hypgen-mechanical-shared-implementation-layer-false-refutes` green.
- Frozen prompt files are unchanged.

## Touches
- tasks/gap-hypgen-mechanical-shared-implementation-layer-false-refutes.md
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs
