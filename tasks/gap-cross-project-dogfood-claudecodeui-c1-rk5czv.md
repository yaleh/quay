---
id: gap-cross-project-dogfood-claudecodeui-c1-rk5czv
title: "[cross-project dogfood] Quay's selector treats a null subprocess exit
  (spawn/timeout) as 'no valid pick' and still dispatches candidates[0],…"
status: ready
labels:
  - gap
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
Cross-project Quay dogfooding round `cpd-771863-1793687392142-rk5czv` read the real usage artifacts of source project `claudecodeui` and formed this hypothesis; an independent verifier and an independent refuter both returned `supported`.

**Claim**: Quay's selector treats a null subprocess exit (spawn/timeout) as 'no valid pick' and still dispatches candidates[0], degrading selector-infra failure to arbitrary dispatch.

**Quay-side components**: `plugin/scripts/driver-runtime.ts`

**Why this is Quay-generic, not host-local**: the claim names Quay's own mechanism, not the source project's product; the source project is only where the failure became visible.

## Evidence
- `.quay/worker-outcome.jsonl:?` — "selector_reason":"selector worker returned no valid pick (exit null); fallback to first shuffled candidate"
- `/data/home/yale/work/quay/plugin/scripts/driver-runtime.ts:2952` — reason: `selector worker returned no valid pick (exit ${exitCode ?? "null"}${got}${errFrag}); fallback to first shuffled candidate`
- `/data/home/yale/work/quay/plugin/scripts/driver-runtime.ts:2964` — const r = await runAsync(argv, { timeoutMs: 120_000, collectStderr: true }); return parseSelectorOutput(r.stdout, candidates, r.error ? null : r.status, r.stderr.trim() || null);

- round: `cpd-771863-1793687392142-rk5czv` (record `cross-project-dogfood@cpd-771863-1793687392142-rk5czv::c1`)
- source project: `claudecodeui`
- verifier verdict: `supported`; refuter verdict: `supported`

## Plan
1. Reproduce the claim from the cited positions above (the artifact that exposed it), then read the named Quay-side surface.
2. Either fix the mechanism, or record why the claim does not hold for Quay's own code — the round's refuter was satisfied, so "it is only that host" needs its own evidence.
3. Correct `## Touches` to the files the fix actually changes before editing them.

## Reproduction (claim CONFIRMED on Quay's own tree)
In a worktree off `develop`, importing `plugin/scripts/driver-runtime.ts`:
- `parseSelectorOutput("", ["gap-a", "gap-b"], null, "spawn ENOENT")` ⇒ `{ task: "gap-a", reason: "selector worker returned no valid pick (exit null, stderr=\"spawn ENOENT\"); fallback to first shuffled candidate" }`
- `runSelectorWorker(["gap-a","gap-b"], ["/nonexistent/selector-binary"], "/r")` ⇒ `{ task: "gap-a", reason: "selector worker returned no valid pick (exit null); fallback to first shuffled candidate" }`

Both dispatch `candidates[0]` (`gap-a`) on a null exit — selector infra failure is degraded to arbitrary dispatch, exactly as claimed.

## Fix (verified on Quay's own tree)
- `plugin/scripts/driver-runtime.ts` `parseSelectorOutput`: added `if (exitCode === null) return null;` — a null exit (spawn failure / timeout) is selector infrastructure failure, not "no valid pick"; it now fails closed (no dispatch) instead of falling back to `candidates[0]`. `runSelectorWorker` inherits this because it passes `r.error ? null : r.status`.
- `plugin/scripts/worker-driver.ts`: the `!sel` branch's waitReason now reads `selector-infra-failure (selector worker spawn/timeout) — no dispatch this round` instead of the misleading `pool-empty` label (hard rule 3b: infra failure must not be shaped like an empty pool).
- New test `plugin/test/worker-driver-resident-s01.test.mjs` ("cross-project dogfood cpd-771863 c1"): pins null-exit → null (no dispatch) for both the pure parser and a real spawn failure, plus negative controls that a non-null non-zero exit still falls back.

## Acceptance Criteria
- [x] the Quay-side mechanism named in the claim behaves as the claim says (reproduce it from the cited positions)
- [x] the fix is verified on Quay's own tree, not only on the source project that exposed it

## Definition of Done
- the defect is fixed or shown not to exist, and the round's claim is answered in the task body.

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/worker-driver.ts`
- `plugin/test/worker-driver-resident-s01.test.mjs`
- `tasks/gap-cross-project-dogfood-claudecodeui-c1-rk5czv.md`

该轴仍暗,理由: 本修复只加一条 fail-closed guard 与注释/标签，不新增 import 或模块依赖、不引入依赖环；L_D/L_G 轴无本任务引入的增量可采。