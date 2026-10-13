---
id: gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff
title: "quay driver stop/restart --kind worker cannot confirm while resident
  loop has ready work (measured: 90+ min, anchor-desired.json already excluded
  worker) — error message doesn't name drain or the takeoverPid handoff recipe;
  declaration=stopped-explicitly itself is NOT a bug (two correctly-decoupled
  axes, confirmed)"
status: todo
labels:
  - gap
  - docs
  - operator-ux
parent: null
children: []
extra: {}
---
## Proposal
**Not a bug in `declaration`/`kindDeclaration` itself — investigated and ruled out.** `declaration=stopped-explicitly` while `running=1` is two deliberately DECOUPLED axes (`kindDeclaration`, driver-runtime.ts:1198, doc-commented as "four independent states… 硬规则 3b"): it reports operator INTENT (was a stop ever requested, on disk) separately from measured liveness (`aliveness().running`). `driver status`'s own output line prints BOTH fields adjacent on the same line, so the combination is honestly readable as "a stop was requested but has not taken effect" — not a contradiction, not hidden. Confirmed first-hand: once the anchor process itself was replaced (coordinator's 2026-10-13 ClaudeCodeUI 0.20.0-dev takeover), the new cold-start anchor read `anchor-desired.json` fresh and reported `declaration=declared` correctly with no residual drift. **No task is filed for this part.**

**The real, narrower, reproducible gap: `quay driver stop/restart --kind worker` gives operator guidance that cannot be acted on for a resident kind, with no specific pointer to the one documented mechanism that actually works.**

`startKindTask`'s per-kind wrapper (driver-anchor.ts:150-170) only re-checks `readDesired(root).kinds.includes(kind)` AFTER `invoke(kind,...)` returns from one full cycle. For `promotion`/`outer`/`goal`, `invoke()` completes a short mechanical cycle and returns quickly, so the check fires within ~1s. For `worker`, `invoke()` is itself a long-running resident loop (its own internal round cadence, ~40-45s per round, dispatching tasks as long as any are ready) that does not return control to the wrapper between rounds — so the wrapper's stop-check never gets a turn to run while worker keeps finding ready work.

**Measured first-hand (2026-10-13, this ClaudeCodeUI host):** `quay driver stop --kind worker` (and `restart`, which calls stop first) was attempted twice over 04:23-04:27Z UTC, each waiting the full `ANCHOR_LOOP_STOP_TIMEOUT_MS` (60000ms) before refusing with `stop-failed`. `anchor-desired.json` correctly excluded `worker` from 04:25:42Z onward (confirmed by direct read), yet `worker-round.jsonl` kept ticking uninterrupted (rounds 769→819+) for the following ~90+ minutes while the SAME anchor process stayed alive and kept dispatching/landing new tasks — i.e. the stop request was NEVER going to be honored by this path as long as the anchor process itself lives and ready work exists, no matter how many times it is retried.

The CLI's general `--help` text does say, for the `stop` verb generically: "For worker, in-flight workers are NOT killed (they orphan and finish) — use drain for a graceful stop." But:
1. The PER-ATTEMPT `stop-failed`/`restart-aborted` error text (driver-runtime.ts:4053/4149) only tells the operator to check the anchor log tail and retry the SAME command — it does not repeat or point at the `drain` alternative, and for `worker` specifically retrying is never going to produce a different outcome while ready work exists.
2. There is no message anywhere saying explicitly: "for kind=worker specifically, `stop`/`restart` cannot confirm while the resident loop has ready work; use `drain` (halts new dispatch, in-flight finishes) or, for a full kernel swap, terminate the whole anchor process (SIGTERM) and let a `--takeover`'d replacement adopt it" — the one case this file-set actually needed (a live kernel handoff while workers are in flight) has no documented single command; it required reading `spawnAnchor`'s `takeoverPid` option, which is not exposed by any CLI verb at all.

**Cost:** two real attempts (~4 minutes), each ending in the same uninformative refusal, before the mechanism was understood by reading source. A less careful operator could retry indefinitely.

## Plan
1. `stop-failed`/`restart-aborted` for `kind=worker` specifically names the actual cause (ready work exists; the resident loop will not return control until it has none) and names `drain` as the alternative, rather than only suggesting "retry after confirming the old pid died."
2. Document (in the CLI help and/or a comment at `spawnAnchor`) that a live, in-place kernel handoff while the anchor is alive is NOT reachable via any `--kind` verb; it requires starting a new anchor with the `takeoverPid` option and sending the old anchor process SIGTERM directly. Decide, with evidence from this task's own investigation, whether to also expose this as an explicit CLI verb (e.g. `quay driver handoff`) or keep it as an internal primitive with a documented manual recipe — the decision belongs to this task, not asserted here.

## Acceptance Criteria
- [ ] AC1: a fixture anchor with a `worker`-kind resident loop that always finds ready work; `stop --kind worker` against it produces an error message naming the real cause and `drain` as the alternative. Negative control: the current message (checked in before the fix) does not name `drain`.
- [ ] AC2: the documentation addition (help text or code comment) is pasted, naming the `takeoverPid` handoff recipe this task's own investigation used.
- [ ] AC3: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC3 checked with pasted evidence.
- No change to the actual stop/drain/takeover MECHANISMS themselves — this task is message/documentation only.

## Touches
- tasks/gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff.md
- plugin/scripts/driver-runtime.ts
- plugin/scripts/driver-anchor.ts
- packages/quay/src/cli/driver.ts
