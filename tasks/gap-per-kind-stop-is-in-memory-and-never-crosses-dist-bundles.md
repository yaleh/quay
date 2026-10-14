---
id: gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles
title: shipped 内核上 per-kind stop/restart 永不生效：KIND_STOP 是进程内 Map，每个 dist bundle
  各有一份，anchor 的 requestKindStop 恒 false 且被丢弃
status: done
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

## Outcome (what was actually built)

**Step 1 — the on-disk channel.** `driver-shared.ts`'s `residentLoopStop()` gained `{ diskStopProbe, diskPollMs, onNotEvaluated }`. The probe is read at the round boundary (`isStopRequested()`) and, during `sleep()`, in `diskPollMs` slices (default 500 = the anchor's reconcile period) — so the stop is noticed within one reconcile tick, not one interval. `driver-runtime.ts` provides the probe's single implementation, `kindStopProbe(root, kind)`, and the three-state reader behind it:

* `stopped` — `.quay/anchor-kind-stops.json` carries a record for this kind;
* `not-stopped` — the file is absent (the legitimate cold-start state) or has no record for it;
* `not-evaluated` — the file exists but is unreadable.

`not-evaluated` is **fail-open** (the loop keeps running): stopping a loop nobody asked to stop is worse than missing one stop request, and the corruption is already surfaced as `not-evaluated` through `kindDeclaration`. It is logged once, named, per loop.

The probe reads **only the stop record**, never desired-state membership — reading desired would collapse `stopped-explicitly` and `not-declared`, the two states `kindDeclaration` exists to keep apart. That is complete because both production writers of `anchor-desired.json` flip the record in the same call (`updateDesired`), and the anchor's cold start writes the full initial set.

Wired into: `runResidentQualityGateLoop` (which is quality **and** goal **and** meta — one wiring covers all three), `promotion-driver`, `outer-driver`, and `worker-driver` (whose stop predicate and `sleep` now consult the record; its exit still waits for in-flight workers, §6.9 inv.3 unchanged).

**Step 2 — the return value is load-bearing.** `driver-anchor.ts`'s per-kind `stop` closure logs, once per kind, when `requestKindStop` reaches no in-process controller, naming the on-disk channel that actually carries the stop.

**Step 3 — chosen fix: `restart --kind X`'s abort path restores `X` in desired state** (`StopOptions.restoreDesiredOnFailure`, set only by `restartKind`). **Reason for choosing that half:** deferring the desired drop until confirmation would invert the mechanism — the drop is *also* the anchor reconcile's stop signal (`driver-anchor.ts:651`) and the `startKindTask` wrapper's "do not respawn" predicate (`:176`), so deferring it would need a second "stop request" carrier plus edits to both predicates, and would open a window where the loop exits while the anchor still wants it and immediately respawns it. `restart` is where the poison is unambiguous: it states "X is running", so an abort means the old loop **is** still running and desired must say so. `stop --kind X` (intent: X is down) is untouched — its desired drop and stop record are exactly the request the on-disk channel consumes.

**Step 4 — the mechanical guard** lives in `plugin/test/driver-anchor-takeover.test.mjs`: it esbuild-bundles `quality-gate-driver.ts` **standalone** (one module instance, the shipped layout), then asserts (A) an in-process `requestKindStop("quality")` from the `.ts` runtime returns `false` — proving the two module instances really are separate, or the case is not exercising the layout at all; (B) with no record the bundled loop does **not** exit; (C) once the record is written it exits, within one reconcile tick. Falsified by unwiring `diskStopProbe` from the quality loop: (C) times out (RED).

## Acceptance Criteria
- [x] AC1: the counterfactual above is re-run against the then-current source before the fix and still reproduces (`requestKindStopReturned:false`, loop not returned), so the fix targets a condition that is still true. — **Re-run 2026-10-14 against the pre-fix tree (`HEAD` = e19ecd395), one scratch root, one request, only the module layout differing.** Harness: `node --experimental-strip-types counterfactual.mjs <worktree> dev|dist:<bundleDir>` (imports `quality-gate-driver` from the dev tree or from a standalone esbuild bundle, starts `main()` in-process, waits 4s, calls `requestKindStop("quality")` on the `.ts` `driver-runtime`). Readings: `{"arm":"dev","requestKindStopReturned":true,"returned":true,"code":0,"ms":101}` vs `{"arm":"dist:<pre-fix bundle>","requestKindStopReturned":false,"returned":false,"code":null,"ms":15030}`. Also verified mechanically, not by inference: `grep -c 'KIND_STOP = '` returns 1 in each of `dist/{driver-anchor,driver-runtime,quality-gate-driver,worker-driver,promotion-driver,goal-driver,meta-driver,outer-driver}.js`.
- [x] AC2: after the fix, the same harness on a dist-built kernel shows the quality loop returning after a per-kind stop within one reconcile tick plus one in-flight round. Negative control: the pre-fix dist build in the same harness does not return. Both readings pasted. — Same harness, same root shape, bundle rebuilt from the fixed worktree. **Post-fix:** `{"arm":"dist:<post-fix bundle>","requestKindStopReturned":false,"stopRecordWritten":true,"desiredAfterStop":[],"returned":true,"code":0,"ms":102}` — the in-process request is *still* `false` (the bundle split is structurally real and deliberately unfixed); the on-disk record is what ends the loop, in 102ms ≈ one reconcile tick. **Negative control (pre-fix dist bundle, same harness, same 15s window):** `{"requestKindStopReturned":false,"returned":false,"code":null,"ms":15060}`. The guard test in `plugin/test/driver-anchor-takeover.test.mjs` mechanises exactly this pair (its own negative controls A and B) and runs in 2.2s; it goes RED (timeout waiting for the loop to stop) when `diskStopProbe` is unwired from the quality loop.
- [x] AC3: `quay driver restart --kind quality` against a dist-kernel anchor confirms (`started … confirmed_ms=…`) with no `stop-failed`. Pasted from a scratch host; no live production host needs to be touched for this AC. — Scratch dist kernel (`plugin/` copied, every `*.ts` deleted, `scripts/dist/*.js` kept); the CLI itself was run as that kernel's own bundle so `kernelSelfPath()` resolves there. `anchor.json`'s `loaded_kernel` confirms the layout: `/home/yale/work/quay-scratch/pkdist/plugin/scripts/dist/driver-anchor.js`, with `anchor.log` `kinds=[quality] reconcile=500ms`. Readings:
  ```
  $ node <scratch>/pkdist/plugin/scripts/dist/driver-runtime.js start --kind quality --root <S> --confirm-timeout 30
  started: anchor pid=1823498 kind=quality driver pid=1823498 confirmed_ms=305
  $ node <scratch>/pkdist/plugin/scripts/dist/driver-runtime.js restart --kind quality --root <S> --confirm-timeout 30
  stopped
  started: anchor pid=1825439 kind=quality driver pid=1825439 confirmed_ms=297
  ```
  No `stop-failed` and no `restart-aborted` on the restart path. (Pre-fix the same verb on the shipped kernel waited out the full 60000ms and refused — Proposal, and AC2's negative control.)
- [x] AC4: a failed or aborted per-kind stop no longer leaves the kind missing from `anchor-desired.json` without a record. Shown via a fixture where the stop cannot complete. — Fixture: a scratch dist kernel whose `outer-driver.js` is a resident loop that never returns and ignores **every** stop channel, so the stop genuinely cannot complete. Same harness on both kernels; only the fix differs. **Pre-fix (negative control):** `stop-failed: kind=outer … 60000ms 内未收尾` then `restart-aborted`, and afterwards `anchor-desired.json = {"kinds":[],"opts":{},"updatedBy":"quay-driver-stop",…}` — the kind is left **out** of desired by a restart that never happened. **Post-fix:** the same `stop-failed` / `restart-aborted` lines, but the stderr now also carries `期望态：已把 outer 放回（restart 中止 ⇒ 「该 kind 应该在跑」仍成立）`, and afterwards `anchor-desired.json = {"kinds":["outer"],"opts":{},"updatedBy":"quay-driver-restart-aborted",…}` with `anchor-kind-stops.json = {}` (the record is cleared in the same call — a still-running loop must not carry a "stopped" record the probe would act on). The `restoreDesiredOnFailure` flag is set only by `restartKind`; the plain `stop` path keeps its desired drop + record, which is what the on-disk channel consumes.
- [x] AC5: goal and meta are either per-kind stoppable, or the CLI refuses `stop --kind goal|meta` with a legible reason instead of waiting out 60s. — Per-kind stoppable on the dist kernel, both far under the 60s window, because quality/goal/meta share `runResidentQualityGateLoop` and one wiring covers all three:
  ```
  $ node <scratch>/pkdist/plugin/scripts/dist/driver-runtime.js stop --kind goal --root <S>   → stopped   elapsed_ms=844
  $ node <scratch>/pkdist/plugin/scripts/dist/driver-runtime.js stop --kind meta --root <S>   → stopped   elapsed_ms=1090
  ```
  `anchor.log` for the same run: `kind=goal — requestKindStop() reached no in-process controller (the kind's loop runs from a separate module instance / esbuild bundle, so the KIND_STOP registry is not shared with this anchor). Per-kind stop on this kernel is carried by the on-disk channel .quay/anchor-kind-stops.json (read by the kind's own resident loop); ⛔ this is not a failure of the stop request itself.` followed by `kind=goal loop returned code=0 after 1171ms` / `kind=goal loop stopped` (and the same pair for `meta`) — that line is Plan step 2's legible fact, logged once per kind rather than discarded.
- [x] AC6: `scripts/test.sh --for-task <this task>` green. — `bash scripts/test.sh --for-task gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles --allow-thin` → `ℹ tests 343 / ℹ pass 343 / ℹ fail 0`, exit 0, with every static check PASS (`PASS: no new task-file bypass — 38 hit(s), all within the allowlist`; `PASS` for the worktree-namespace / serve-binding / task-file-bypass literals that the earlier run had flagged, which were an artifact of gitignored `plugin/scripts/dist/*.js` left in the worktree by the AC1-AC5 evidence builds and are absent from a normal worker worktree). Independently, all of `plugin/test/driver-*.test.mjs` pass (264/264).

## Definition of Done
- AC1-AC6 checked with pasted evidence.
- No change to the whole-anchor SIGTERM/takeover path, which already works and is the current workaround. — Untouched: the only `driver-anchor.ts` edits are the per-kind `stop` closure's log line and two comments; `requestAnchorStop`, the D1 `!stopping` gate, `takeoverBudgetMs`, `oldAnchorWorstExitMs` and the takeover path are byte-identical (Touches' `driver-anchor-takeover.test.mjs` suite still green: 8/8).
- The landed worker-message task is not edited. Its message is now inaccurate on shipped kernels, so this task's fix or its note must say which part of that message still holds. — See the note below.

## Note — how much of `gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff` still holds

Not edited; its file and message are untouched. The claim that is now **superseded** is the stronger of its two premises: "the stop request never reaches the worker loop at all". With the on-disk channel the request does reach the worker loop on shipped kernels — `worker-driver.ts`'s dispatch-loop guard and its `sleep` now read `.quay/anchor-kind-stops.json` — so the ~90-minute "loop keeps dispatching after the stop" shape is closed, and its `workerStopUnreachableNote` text asserting that retrying is "结构上不可能" is no longer accurate as written.

What **still holds**, and is why the note was not simply deleted: `stop --kind worker` remains a request to stop *dispatching*, not to stop *immediately*. The loop only leaves on `running.length === 0` (§6.9 inv.3 — in-flight worker children are independent OS processes and are deliberately not killed), so the command can still time out when a worker is in flight, and both remedies the note names remain the correct ones: `quay driver drain --kind worker` to refuse new dispatch while in-flight finishes, and the `spawnAnchor(root, { takeoverPid })` + SIGTERM recipe to swap the kernel without stopping. A future edit to that task should narrow the claim to the drain-boundary semantics rather than delete the note.

## Touches
- tasks/gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles.md
- plugin/scripts/driver-runtime.ts
- plugin/scripts/driver-shared.ts
- plugin/scripts/driver-anchor.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/promotion-driver.ts
- plugin/scripts/outer-driver.ts
- plugin/scripts/goal-driver.ts
- plugin/scripts/meta-driver.ts
- plugin/test/driver-anchor-takeover.test.mjs
- plugin/test/driver-shared.test.mjs
- plugin/test/driver-runtime-s10.test.mjs
