---
id: gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff
title: "quay driver stop/restart --kind worker cannot confirm while resident
  loop has ready work (measured: 90+ min, anchor-desired.json already excluded
  worker) — error message doesn't name drain or the takeoverPid handoff recipe;
  declaration=stopped-explicitly itself is NOT a bug (two correctly-decoupled
  axes, confirmed)"
status: done
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

## Decision (Plan step 2 — resolved here, with this task's own evidence)
**Keep `takeoverPid` an internal primitive with a documented manual recipe. ⛔ Do NOT add a `quay driver handoff` verb.**

- **Incidence (硬规则 12):** this is the FIRST recorded need for a live anchor swap — one occurrence, in this very session. A new CLI verb is a new mechanism; one occurrence does not justify one (a verb must be maintained, tested, and versioned forever). The recipe itself is three shell steps, run at most a few times per host generation.
- **It would be a SECOND way to start an anchor.** `quay driver start` already owns "bring the anchor up", including the takeover-wait budget (`takeoverBudgetMs`), the reconcile loop, and the `takeover-abandoned*` carriers. A `handoff` verb would have to either duplicate that machinery or bypass it — and bypassing it is exactly how the 2026-09-18 zero-anchor-for-27-minutes incident (driver-anchor.ts's D1/D2/D3 comment) happened.
- **The failure mode is the one the code most works to prevent.** Two anchors on one root = double dispatch. Every existing guard (the `stopping` latch, the post-budget "keep waiting" D3 arm, `anchorOwns`) exists to make that structurally impossible; a new operator-facing entry point widens that surface for a benefit measured at one use.
- **What was actually missing is discoverability, not a verb** — the gap this task closes is that the PER-ATTEMPT error never named either alternative. With `stop-failed`/`restart-aborted` now naming the recipe (AC1), and the recipe documented at `spawnAnchor` + the `--takeover` parse site + both CLI help surfaces (AC2), the operator reaches it without reading raw source.
- **Revisit if the incidence grows:** if a third live-swap need appears, the recipe has then been hand-run ≥3 times and the verb earns itself — file it then, with that count.

## Acceptance Criteria
- [x] AC1: a fixture anchor with a `worker`-kind resident loop that always finds ready work; `stop --kind worker` against it produces an error message naming the real cause and `drain` as the alternative. Negative control: the current message (checked in before the fix) does not name `drain`.
- [x] AC2: the documentation addition (help text or code comment) is pasted, naming the `takeoverPid` handoff recipe this task's own investigation used.
- [x] AC3: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC3 checked with pasted evidence.
- No change to the actual stop/drain/takeover MECHANISMS themselves — this task is message/documentation only.

## Evidence
**AC1 — fixture + live message + negative control** (`node --no-warnings --experimental-strip-types --test plugin/test/driver-runtime-s10.test.mjs`, 5/5 pass):
```
✔ AC1 — kind=worker 的 stop-failed / restart-aborted 必须点名真实成因（常驻循环，重试结构上无效）与 `drain` 替代（负控制：改前消息两个词都没有） (2522.717629ms)
ℹ tests 5 / ℹ pass 5 / ℹ fail 0
```
The emitted worker message (captured off `process.stderr`, which is where `stopKindViaAnchor` writes — ⛔ not the `out` callback):
```
stop-failed: kind=worker — 该 kind 的循环在 800ms 内未收尾（anchor pid=3778051）。⛔ 本条**不报成 not-running**：循环仍在 ⇒ 接着 start 会得到两份 loop（双派发）。⚠️ kind=worker 是**常驻循环**：循环体自己就是那个 loop，只要还有 ready 工作就不会把控制权交回 anchor 的停机检查点 ⇒ 只要还有 ready 活，重跑这条命令**结构上不可能**得到不同结果（⛔ 不是超时太短）。
   可行替代：`quay driver drain --kind worker`（停新派发、在飞跑完，⛔ 不杀在飞）——清空在飞后再 stop。
   ...
```
Negative control (the pre-fix message, `git show develop:plugin/scripts/driver-runtime.ts | sed -n '4051,4058p' | grep -c drain` ⇒ **0**; it also contains no `常驻`). The test pins that pre-fix literal and asserts the two halves — so the assertion is not vacuous (硬规则 4). Non-worker kinds stay byte-identical to before (the shared helper returns `""` for them).

**AC2 — the `takeoverPid` handoff recipe, pasted** (driver-runtime.ts, on `spawnAnchor`; mirrored at the `--takeover` parse site in driver-anchor.ts and in both CLI help surfaces):
```
 *  ── `takeoverPid`：**不停机交换内核**的手工配方（⛔ 无 CLI verb，是内部原语）────
 *  这是唯一一条在 anchor 存活时完成内核交接的路径；`drain` 与 `stop` 都到不了这里。配方三步：
 *    ① 记下旧 anchor 的 pid：`<root>/.quay/anchor.pid`（或 `quay driver status`）；
 *    ② 起接管者，把旧 pid 交给它：`spawnAnchor(root, { takeoverPid: <旧 pid> })`
 *       —— 等价于手写 `node --experimental-strip-types driver-anchor.ts __anchor --root <root> --takeover <旧 pid>`；
 *    ③ 对旧 anchor 直接发 SIGTERM：`kill -TERM <旧 pid>`。
 *  等待语义由**接管者**负责，⛔ 不是「旧进程必须立刻死」：接管者会一直等到 `takeoverPid` 退出才真正
 *  起循环（旧进程还活时**绝不**起第二份 loop），超预算只把这次交接标成异常并**继续等**（D3）。
```
`quay driver --help` now prints the same guidance under `stop` / `restart` (and the shared note names `takeoverPid` on every worker stop-failure).

**AC3 — scoped gate green:**
```
bash scripts/test.sh --for-task gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff --allow-thin
ℹ tests 99 / ℹ pass 99 / ℹ fail 0 / duration_ms 22657   ⇒ EXIT=0
```
Anti-drift pre-merge gate: `ANTI-DRIFT OK: … 5 actual file(s), all within declared Touches (6 glob(s))`, EXIT=0. Also run in this worktree: `tsc --noEmit` ⇒ 0; `enum-surface-parity-check.ts` ⇒ `PASS: all 27 registered surfaces consistent`; `packages/quay/test/cli.test.mjs` ⇒ PASS (the driver-help vocab invariants).

**DoD — mechanisms untouched:** the diff contains only (a) string literals on the two failure paths, (b) comments/help prose, (c) one new test. No change to `stopKind`/`stopKindViaAnchor` control flow, `drainKind`, `spawnAnchor`, or the takeover wait.

## Touches
- tasks/gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff.md
- plugin/scripts/driver-runtime.ts
- plugin/scripts/driver-anchor.ts
- packages/quay/src/cli/driver.ts
- packages/quay/src/cli/help.ts
- plugin/test/driver-runtime-s10.test.mjs
