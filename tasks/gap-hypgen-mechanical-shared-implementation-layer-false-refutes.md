---
id: gap-hypgen-mechanical-shared-implementation-layer-false-refutes
title: "arch-hypothesis-generation: the mechanical shared-implementation layer
  issues a REFUTED verdict while named components that do not import the definer
  carry the claimed divergence, and it falsely refuted a confirmed real defect"
status: done
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

## What landed

`docs/analysis/arch-hypothesis-generation.mjs` + `plugin/test/arch-hypothesis-generation.test.mjs` (commit `48e100def`, branch `task/gap-hypgen-mechanical-shared-implementation-layer-false-refutes`):

- `sharedImplementation` returns the FINDING — `definer` / `symbol` / `importers` / the import-edge `evidence` — **plus** `non_importers` (named components the inventory covers that take no edge to the definer) and `unknown_components` (named components the inventory does not cover; their edges were never observed, so "does not import the definer" is **not** a reading this layer may make of them — 硬规则 6). No `verdict` / `verdict_reason` field exists on it any more.
- `mechanicalRefutation` is **deleted**; no cluster is short-circuited. `mechanicalEvidenceLines` renders the finding into the evidence pack, which now **leads** with it (round-robin, so the line cap cannot starve it) and counts it in its `sections:` header.
- Verify rows carry `mechanical_evidence` (present **only** when a finding exists); `mechanical: true` / `verdict_reason: shared-implementation` are gone, so a row carrying a finding is an ordinary model row.
- `MODEL_NOT_APPLICABLE` and the budget-aware reordering are retired with the rows they existed for. The run-level count is named `mechanical_evidence` under `--provenance` and keeps its pre-change name/value (`mechanical_refuted: 0`) without one, via `mechanicalSummaryField`.
- No prompt file was touched (DoD).

## Acceptance Criteria
- [x] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0, with new cases:
  - (a) A cluster whose in-set edges converge on one module, but which has a named non-importer, yields NO mechanical verdict, and its pack lists the non-importer.
  - (b) A cluster where every component imports the definer also yields no verdict, but carries the import lines as evidence.
  - (c) Without `--provenance`, output is byte-identical to before.

  ```
  $ node --test plugin/test/arch-hypothesis-generation.test.mjs
  ✔ AC(a): a star with a named non-importer yields no verdict, and its pack lists the non-importer (1.29587ms)
  ✔ AC(b): a perfect star yields no verdict and still carries its import lines as evidence (0.413031ms)
  ✔ AC(c): a provenance-free run is byte-identical to the pre-change output (0.979977ms)
  ✔ AC(d): the shared-import finding is reported as evidence and decides nothing (1.158894ms)
  ℹ tests 49
  ℹ suites 0
  ℹ pass 49
  ℹ fail 0
  ```

  (a) asserts `called === 1` (the model still runs) and that the pack carries `NOT-importing plugin/scripts/d.ts`; (b) asserts a perfect star still reaches the model with `verdict_reason: null` — the `E-HYPGEN-AB-1` arm A c15 shape; (c) pins the provenance-free pack at sha256 `5bef83a6668a00d6fcdd5c3d63761e4f202fe81c5247a0ce15f39a3bf0aab980`, taken from `git show HEAD:docs/analysis/arch-hypothesis-generation.mjs` **before** the change, and pins the row key set against the same pre-change module (28 keys, no `mechanical_evidence`), plus `mechanicalSummaryField({provenance:null,…}) === {mechanical_refuted: 0}`.

- [x] Real replay, no model call: run the shipped selection on `/data/home/yale/work/quay-scratch/dt1/verify-Hf/verify.json` clusters with `provenance-entries-H.json`. Paste the result: 0 clusters carry a mechanical verdict, and c15's evidence lists `checker-mechanical-spine-check.ts` as a non-importer.

  ```
  clusters in the recorded selection: 15 (clusters_total=27)
  recorded BEFORE this change: mechanical_refuted=3

  c 1  before=model     no finding
  c 4  before=MECHANICAL  finding: definer=plugin/scripts/fast-mode-telemetry.ts importers=2 non_importers=[cap-counts-subagents-check.ts, cap-from-gate.ts, server-restart-inflight-verify.ts] unknown=[]
  c14  before=MECHANICAL  finding: definer=plugin/scripts/fast-mode-telemetry.ts importers=2 non_importers=[cap-counts-subagents-check.ts, server-restart-inflight-verify.ts] unknown=[]
  c15  before=MECHANICAL  finding: definer=plugin/scripts/checker-io.ts importers=2 non_importers=[checker-mechanical-spine-check.ts, full-suite-runner-types.ts] unknown=[]

  (A) clusters carrying a mechanical VERDICT: 0  (of 15)
      clusters carrying a mechanical FINDING: 3

  c15 components: checker-mechanical-spine-check.ts, checker-io.ts, outer-anchor-check.ts, dead-code-after-return-check.ts, full-suite-runner-types.ts
  c15 non_importers: ["plugin/scripts/checker-mechanical-spine-check.ts","plugin/scripts/full-suite-runner-types.ts"]
  c15 lists checker-mechanical-spine-check.ts as a non-importer: true

  c15 MECH evidence lines:
    - MECH 2/5 named components import plugin/scripts/checker-io.ts | shared names: {DriverResult, driverResultToExit, failed, verified} — NOT a verdict: see the NOT-importing lines
    - MECH   import plugin/scripts/dead-code-after-return-check.ts:43 -> plugin/scripts/checker-io.ts | {driverResultToExit, failed, verified}
    - MECH   import plugin/scripts/dead-code-after-return-check.ts:44 -> plugin/scripts/checker-io.ts | {DriverResult}
    - MECH   import plugin/scripts/outer-anchor-check.ts:56 -> plugin/scripts/checker-io.ts | {driverResultToExit, failed, notEvaluated, verified}
    - MECH   import plugin/scripts/outer-anchor-check.ts:57 -> plugin/scripts/checker-io.ts | {DriverResult}
    - MECH   NOT-importing plugin/scripts/checker-mechanical-spine-check.ts | named by the hypothesis, imports nothing from the definer
    - MECH   NOT-importing plugin/scripts/full-suite-runner-types.ts | named by the hypothesis, imports nothing from the definer

  c15 pack counts: {"definitions":0,"imports":4,"hits":0,"rendered":11,"total":11,"mechanical":7}
  c15 pack carries the non-importer line: true

  (B) THROUGH the shipped verify loop, model call stubbed (no CLI, no API):
      model calls made: 15 / 15 clusters
      mechanical_evidence rows: 3
      verdicts (all from the stub): {"undetermined":15}
      rows with verdict_reason=shared-implementation: 0
      rows with mechanical=true: 0
  ```

  The 3 clusters that were mechanically refuted before (matching the recorded `mechanical_refuted=3` — c4, c14, c15) are exactly the 3 that now reach the model. The replay calls only shipped code; no model call is made.

- [x] Mutation control: restore verdict emission and show case (a) goes red. Paste the output, then revert.

  Mutation (temporary, in `runVerifier`'s `runOne`, before the prompt is built):

  ```js
  if (mech[k]) {
    results[k] = { …, verdict: "refuted", verdict_reason: "shared-implementation", mechanical: true };
    return;
  }
  ```

  ```
  $ node --test --test-name-pattern="AC\(a\): a star with a named non-importer" plugin/test/arch-hypothesis-generation.test.mjs
  ✖ AC(a): a star with a named non-importer yields no verdict, and its pack lists the non-importer (4.017996ms)
  ℹ tests 1    ℹ pass 0    ℹ fail 1

  ✖ failing tests:
    AssertionError [ERR_ASSERTION]: the finding must not decide the cluster
      0 !== 1
        at TestContext.<anonymous> (…/arch-hypothesis-generation.test.mjs:761:10)
      actual: 0, expected: 1, operator: 'strictEqual'
  ```

  `git checkout -- docs/analysis/arch-hypothesis-generation.mjs`, then:

  ```
  $ node --test --test-name-pattern="AC\(a\): a star with a named non-importer" plugin/test/arch-hypothesis-generation.test.mjs
  ℹ tests 1    ℹ pass 1    ℹ fail 0
  ```

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-hypgen-mechanical-shared-implementation-layer-false-refutes` green.
- Frozen prompt files are unchanged.

## Touches
- tasks/gap-hypgen-mechanical-shared-implementation-layer-false-refutes.md
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs
