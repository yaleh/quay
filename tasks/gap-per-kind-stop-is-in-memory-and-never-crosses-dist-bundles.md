---
id: gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles
title: shipped 内核上 per-kind stop/restart 永不生效：KIND_STOP 是进程内 Map，每个 dist bundle
  各有一份，anchor 的 requestKindStop 恒 false 且被丢弃
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 on ClaudeCodeUI's live anchor (shipped dist kernel `official-dist-020-dev-r4-ccui-fix`, built from develop `4a322afab`).** `quay driver stop --kind quality` and `restart --kind quality` were attempted 5 times over ~03:00-03:34Z. Every attempt waited the full `ANCHOR_LOOP_STOP_TIMEOUT_MS` (60000ms) and refused with `stop-failed` / `restart-aborted`. `anchor-desired.json` dropped `quality` each time, and `anchor.json` showed `quality: "stopped-explicitly"`, yet `quality-round.jsonl` kept advancing (rounds 277 and 279 were written after the 03:03:21Z drop). By contrast, the same verb on quay's own repo, whose anchor runs the `.ts` dev tree, confirmed in 3510ms earlier in the same session.

**Root cause, verified against a counterfactual rather than inferred.** The per-kind stop channel is an in-memory registry: `KIND_STOP = new Map()` (`plugin/scripts/driver-runtime.ts:790`). Each kind driver fills it via `registerKindStop(kind, …)` (quality `quality-gate-driver.ts:1560`, worker `worker-driver.ts:5468`, promotion `promotion-driver.ts:878`, outer `outer-driver.ts:414`). The anchor's reconcile drains it via `requestKindStop(kind)` (`driver-anchor.ts:140`). That only works if both sides share one module instance. In the shipped artifact they never do: `driver-anchor.js` and each `<kind>-driver.js` are separate esbuild bundles, each inlining its own private copy of `driver-runtime` (`grep -c "KIND_STOP = .*new Map"` returns 1 in each of `driver-anchor.js`, `driver-runtime.js`, `quality-gate-driver.js`, `worker-driver.js`, `promotion-driver.js`). On top of that, the anchor loads every kind through `import(<dist>/<kind>-driver.js)` (`invokeKindDefault`, `driver-runtime.ts:102`). As a result, `requestKindStop` looks up an empty map, returns `false`, and the anchor discards that return value (`driver-anchor.ts:140`, `const stop = () => { stopRequested = true; requestKindStop(kind); }`).

The counterfactual used one scratch root and one request. Only the module layout differed: `quality-gate-driver` `main()` was started in-process, given 4s, then `requestKindStop("quality")` was sent.

```
dev tree (.ts, one shared driver-runtime module): {"requestKindStopReturned":true, "returned":true, "code":0, "ms":4014}
shipped dist (quality-gate-driver.js + driver-runtime.js copy): {"requestKindStopReturned":false, "returned":false, "waitedMs":15000}
```

**Why only the full anchor swap worked.** Each bundle's `registerKindStop` also attaches `process.on("SIGTERM"/"SIGINT")`. Whole-process SIGTERM therefore reaches every bundle's copy, while the per-kind in-process signal reaches none.

**Collateral damage observed (same mechanism).**
1. **Poisoned desired state.** A failed `stop --kind X` still writes `X` out of `anchor-desired.json` before it times out. The next anchor takeover cold-starts from that file and silently omits `X`. Measured: after a takeover, the new anchor came up with `kinds:[promotion,outer,goal,worker]` and no quality until it was manually re-added.
2. **Misattribution in a landed task.** The landed task `gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff` attributed the identical ClaudeCodeUI `stop --kind worker` failure to "the worker loop never returns while ready work exists" and fixed only the message text. That explanation is at best partial: on the shipped kernel, the stop request never reaches the worker loop at all. `worker-driver.ts:5878/5937` polls `kindStopRequested("worker")` against its own bundle's empty-of-requests map.

**Siblings checked (hard rule 5b).** `driver-runtime.ts` holds three module-level mutable states: `KIND_STOP` (`:790`), `_kernelSourceScriptsDirCache` (`:2691`), and `_clkTck` (`:2785`). The latter two are pure caches, so duplicating them across bundles is harmless. `KIND_STOP` is the only one used as a cross-module channel. Separately, `goal-driver.ts` and `meta-driver.ts` never call `registerKindStop` at all, so those two kinds cannot be stopped per-kind even on the dev tree. That is recorded here and is in scope for Plan step 1.

## Plan
1. Replace the in-memory channel with one that survives bundling. The anchor already has an on-disk per-kind stop carrier (`ANCHOR_KIND_STOPS_REL = ".quay/anchor-kind-stops.json"`, `driver-runtime.ts:845`), and desired state is already on disk. Have each kind's resident loop check that disk state, or `anchor-desired.json` membership, at its existing sleep and round boundaries. Use the existing wakeable `residentLoopStop` sleep so the delay is at most one reconcile tick, not a full interval. Do not rely on module identity across bundles. Cover goal and meta too.
2. Make `requestKindStop`'s result load-bearing. If the anchor's in-process request reaches no registered controller, log it as a named, legible fact. Do not silently discard it (hard rule 3b).
3. Stop `stop --kind X` from poisoning desired state on failure. Either write the desired drop only after the stop is confirmed, or have `restart --kind X`'s abort path restore `X` in desired state. Pick one and give the reason.
4. Add a mechanical guard so this class cannot regress silently. Example: a dist-artifact test that starts a kind's dist bundle in-process under a dist-built anchor and asserts that a per-kind stop actually ends the loop.

## Acceptance Criteria
- [ ] AC1: the counterfactual above is re-run against the then-current source before the fix and still reproduces (`requestKindStopReturned:false`, loop not returned), so the fix targets a condition that is still true.
- [ ] AC2: after the fix, the same harness on a dist-built kernel shows the quality loop returning after a per-kind stop within one reconcile tick plus one in-flight round. Negative control: the pre-fix dist build in the same harness does not return. Both readings pasted.
- [ ] AC3: `quay driver restart --kind quality` against a dist-kernel anchor confirms (`started … confirmed_ms=…`) with no `stop-failed`. Pasted from a scratch host; no live production host needs to be touched for this AC.
- [ ] AC4: a failed or aborted per-kind stop no longer leaves the kind missing from `anchor-desired.json` without a record. Shown via a fixture where the stop cannot complete.
- [ ] AC5: goal and meta are either per-kind stoppable, or the CLI refuses `stop --kind goal|meta` with a legible reason instead of waiting out 60s.
- [ ] AC6: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC6 checked with pasted evidence.
- No change to the whole-anchor SIGTERM/takeover path, which already works and is the current workaround.
- The landed worker-message task is not edited. Its message is now inaccurate on shipped kernels, so this task's fix or its note must say which part of that message still holds.

## Touches
- tasks/gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles.md
- plugin/scripts/driver-runtime.ts
- plugin/scripts/driver-anchor.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/promotion-driver.ts
- plugin/scripts/outer-driver.ts
- plugin/scripts/goal-driver.ts
- plugin/scripts/meta-driver.ts
- plugin/test/driver-anchor-takeover.test.mjs
