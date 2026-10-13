---
id: gap-osd-stream-without-result-recurs-past-the-one-counted-retry-needs-correlated-signal
title: "OSD's call_failure=stream-without-result can recur on its own
  one-counted retry (real production: 1 of 2 retries hit the identical class
  again) — raw capture shows the CLI stream cut off mid-thinking with no
  result/error event; test the anchor-handoff-timing correlation before deciding
  whether to add a correlated second retry"
status: ready
labels:
  - gap
  - discovery-method
  - investigation
parent: null
children: []
extra: {}
---
## Proposal
**Split out of `gap-cross-project-dogfood-shares-no-diagnostics-or-retry-with-osd-seven-unattributed-exit1` (hard rule 5b: a narrower, separately-scoped half of the same audit) — a gap in OSD's EXISTING retry mechanism, not an absence of one.**

OSD's one-counted-retry (`RETRYABLE_CALL_FAILURES = ["no-stdout", "stream-without-result", "api-error-event"]`) is implemented and firing correctly. But real production data (ClaudeCodeUI local OSD, round `osd-675243-1791901051486-zw524m`, `invoked_by:"resident-driver"`, 2026-10-13T14:17:32Z) shows the SAME failure class can recur ON the retry itself: of 2 first-attempt verifier calls classified `stream-without-result`, one retry resolved to a different, understood cause (`error_max_turns`), but the OTHER retry hit `call_failure:"stream-without-result"` **again** — the cluster then has no further chance and reads `undetermined`.

**What the raw capture shows (`.quay/open-semantic-discovery-call-captures/osd-675243-…-verifier-dmr-675243-1-ue3ckmf2.txt`, read directly):** the stream is a long run of real `{"type":"system","subtype":"thinking_tokens",...}` events (counting up to 451), then stops — no `result` event, no error event, stderr carries only the two benign startup warnings (claude.ai connectors notice, `unrecognized_model`). This is NOT a JSON parse failure or an API error event; it looks like the underlying CLI process was cut off while still generating (killed or disconnected), not a graceful CLI-level failure.

**Hypothesis, explicitly not yet tested** (hard rule 4 corollary 4 — the claim below needs a counterfactual before being treated as a conclusion): this round's timing (14:17:32Z) is right after the ClaudeCodeUI anchor handoff completed (old anchor exited ~14:17:21Z). A brief window of dual-anchor cgroup/resource overlap during a handoff could plausibly kill a child process mid-stream. This is a correlation observed from a SINGLE occurrence; it has not been compared against a steady-state baseline, and no other cause (host load from an unrelated process, a provider-side transient, an SDK bug) has been ruled out.

## Plan
1. **Get a counterfactual before asserting a cause.** Compare `stream-without-result` incidence in rounds that occurred within N minutes of a recorded anchor start/takeover/restart event (`anchor.log` has these timestamps) against rounds in steady state. If the host carries a cheap load signal (`/proc/loadavg`, or the sibling-scope count OSD's own envelope logging already reads), log it alongside the call record — this makes future recurrence self-diagnosing instead of requiring a fresh manual capture-file read each time.
2. **Decide, from the counterfactual, whether to do anything to the retry policy itself** — e.g. a SECOND bounded retry gated specifically on "the correlated signal says this was likely transient" (never gated on nothing, which would just spend money hoping), or leaving the policy as one retry and instead only improving the diagnosis. Do not assume escalation is warranted before the counterfactual is in.
3. **No change to the hard budget ceilings** (`max_model_calls_per_24h`, `max_usd_per_24h`) regardless of which option is chosen — any added retry capacity must be counted and capped on the SAME ledger, never a parallel allowance.
4. `undetermined` stays `undetermined` when every available attempt (first + any retries this task adds) still fails — this task must not lower the confirmation bar to compensate for a flaky transport.

## Acceptance Criteria
- [x] AC1: the correlation hypothesis is tested against real carrier data (OSD findings across quay + claudecodeui, cross-referenced with `anchor.log` restart timestamps) and the result — supported, refuted, or insufficient-samples — is pasted plainly, with the counts on both sides of the comparison.
- [x] AC2: whatever the decision in Plan step 2, it is implemented with a negative control (a fixture round with the correlated signal absent must NOT trigger the new behavior if one was added) and the hard budget ceilings are shown unchanged in `.quay/config.yml` before/after.
- [x] AC3: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC3 checked with pasted evidence. If AC1 comes back "insufficient samples," this task documents that honestly and proposes what signal to log going forward (Plan step 1) rather than guessing at a fix for an uncharacterized cause (hard rule 4: a structurally-unfalsifiable guess is not a measurement).

## Evidence

### AC1 — the anchor-handoff correlation, tested against the real carriers
**Verdict: SUPPORTED at the call level; the ROUND-level sample is too thin to stand alone (2 rounds).**

Inputs, all read directly and none reconstructed: the two OSD carriers
`/home/yale/work/quay/.quay/open-semantic-discovery-findings.jsonl` (19 scan-rounds) and
`/home/yale/work/claudecodeui/.quay/open-semantic-discovery-findings.jsonl` (5 scan-rounds); per-CALL
timestamps resolved from each project's own `.quay/open-semantic-discovery-model-budget.jsonl`
(`kind:"reserve"` → `id`/`ts`, joined to the call record's `reservation_id`); anchor (re)start instants
from each project's `.quay/anchor.log` (`anchor: takeover <pid> exited — taking over` / `anchor: host pid=`).

**Population, stated honestly.** 126 call records exist across the two carriers, but only **59** (6
rounds) carry the `call_failure` field — the instrument this class is read from. The other 65 calls are
structurally incapable of reporting the class, so they are NOT counterfactual evidence and are excluded
below. All counts are over the 59.

| round (UTC) | project | calls | `stream-without-result` | transport-loss¹ | age of the round's start vs the anchor's start |
|---|---|---|---|---|---|
| 2026-10-13T00:25:46 | quay | 12 | 0 | 0 | 17 274 s |
| 2026-10-13T00:33:09 | quay | 8 | 0 | 0 | 17 717 s |
| 2026-10-13T00:39:04 | quay | 7 | 0 | 0 | 18 072 s |
| 2026-10-13T01:10:43 | quay | 14 | 0 | 0 | 19 970 s |
| **2026-10-13T07:07:39** | quay | 12 | **5** | **5** | **56 s** |
| **2026-10-13T14:17:32** | claudecodeui | 6 | **3** | **3** | **23 s** |

¹ transport-loss = `call_failure != null` OR `not_evaluated ∈ {uninstrumented-exit-1, no-result-event}` —
the whole «the process died mid-stream» family, not just the one class this task names.

- **Adjacent** (round started ≤15 min after an anchor start): **2 rounds, 18 calls, 8 losses (44.4 %)**.
- **Steady** (nearest preceding anchor start ≥4.8 h): **4 rounds, 41 calls, 0 losses (0.0 %)**.
- Two-sided Fisher exact, call-level `[[8,10],[0,41]]`: **p = 1.97e-5**.
- Two-sided Fisher exact, round-level `[[2,0],[0,4]]`: **p = 0.067** — same direction, but the effective
  sample is **2 rounds**, which is why the verdict is «supported, thin» and not «established».
- The stratification holds for the whole family, not one class: in the 4 steady rounds the ONLY non-null
  token is `error_max_turns` (14 calls — the turn cap, a budget fact); `uninstrumented-exit-1` (6) and
  `no-result-event` (2) appear **only** in the 2 adjacent rounds.
- The Proposal's "old anchor exited ~14:17:21Z" is refined: `anchor.log` reads
  `2026-10-13T14:17:09Z anchor: takeover 2943131 exited — taking over`, and `.quay/anchor.json` reads
  `startedAt: 2026-10-13T14:17:09.198Z` — i.e. the round began **23 s** after the switch, not 11 s.

**What the counterfactual does NOT settle (stated, not hidden):**
1. **The alternative causes are untested, not excluded.** No host-load reading was recorded before this
   change. 2010 `suite-load-*.jsonl` sampler files exist, but the nearest sampler window ends **5.0 min
   BEFORE** the 07:07 incident and **52.3 min BEFORE** the 14:17 one — neither incident window is covered,
   so «the host was merely busy» cannot be ruled out retrospectively. That gap is exactly what Plan item
   1's logging closes (the reading is now on every call record).
2. **«Anchor handoff» and «the first OSD round after the whole anchor (quality loop included) restarted»
   are the same event in this data and are NOT separated.** Both adjacent rounds are the first round of a
   freshly started quality driver; cold caches and a concurrent kind-loop start storm are equally
   consistent with the counts.
3. **The losses are 2.6–10.9 min AFTER the anchor start**, while the round begins within ~1 min of it. At
   +5 min the outgoing anchor has already exited, so «dual-anchor overlap» is not a precise mechanism.
   This is precisely why the record now carries the age at the CALL, not only at the round — see the
   window comment in `open-semantic-discovery-routine.ts`, which states that the flag separates ROUNDS,
   not calls (inside an adjacent round the losses at 157–653 s and the clean calls at 23/200/240 s overlap).

### AC1 (second half) — the recurrence the task is named for, recounted
The title says "1 of 2 retries hit the identical class again". Over BOTH carriers the class triggered
**5 first attempts → 5 retries**:
- **3** retries came back `stream-without-result` **again**;
- **2** retries resolved to `error_max_turns` (a different, understood cause);
- **0 of the 5** produced a usable answer.

All 5 first attempts and all 5 retries belong to the 2 adjacent rounds. These are the numbers the retry
decision below turns on.

### AC2 — the Plan-step-2 decision, and its implementation
**Decision: do NOT add a correlated second retry. Improve the DIAGNOSIS instead.**
The counterfactual says the correlated signal is real, but it also says the one counted retry already has
a **measured 0/5 immediate-success rate on exactly this class, in exactly this window** — so a second
retry gated on the signal would spend a reservation on the same 0/5 gamble and delay the round.
(Hard rule 12: escalation needs an incidence reading, and the reading that exists points the other way.)
Plan item 4 is therefore untouched: `undetermined` stays `undetermined`.

**Implemented (Plan item 1 — the self-diagnosing record):**

| change | file |
|---|---|
| `readAnchorStart(root)` — the anchor's own published start, three-state (`missing` / `unreadable` / `malformed` / `no-started-at`) | `plugin/scripts/driver-runtime.ts` |
| `HANDOFF_ADJACENCY_WINDOW_MS`, `handoffBlock()`, `readHostLoad()`, `HandoffBlock`, `HostLoadBlock` | `plugin/scripts/open-semantic-discovery-routine.ts` |
| every call record now carries `handoff` (`age_ms` raw **and** `adjacent`) and `host_load`; the scan-round line carries `handoff` at the round's own start | `plugin/scripts/open-semantic-discovery-routine.ts` |

**`## Touches` was WIDENED (through the ABI) to add `plugin/scripts/driver-runtime.ts`.**
It already owns `.quay/anchor.json` (`ANCHOR_STATE_REL`, `readAnchorStateDetailed`) and is ALREADY in this
routine's bundle closure, so the reader costs the shipped artifact **0 bytes**; `plugin/scripts/driver-anchor.ts`
would inline ~34 KB of the anchor kernel into the routine bundle (measured: 2 637 423 → 2 671 169 B).
**`driver-anchor.ts` is therefore declared but UNCHANGED** — it is in Touches because it owns the handoff
grammar (`startedAt`, the `takeover … exited` log line) that AC1's cross-reference reads.

**Negative controls (all in `plugin/test/open-semantic-discovery-routine.test.mjs`, 6 new tests, all green):**
- **signal absent** — the IDENTICAL round with an anchor start 6 h old reads `adjacent:false` on the round
  and on every call, while the 1-minute-old twin reads `true`: the flag takes BOTH values (a constant
  would read `true` twice), and the two rounds did the same amount of work;
- **signal unreadable** — no `anchor.json` ⇒ `{evaluated:false, reason:"missing"}` and
  `"adjacent" in round.handoff === false`: «could not read» is never shaped like «read, and no handoff
  nearby» (硬规则 3b); a torn file ⇒ `{evaluated:false, reason:"malformed"}`; a surface with no parseable
  `startedAt` ⇒ `"no-started-at"` (never the epoch);
- **no policy was widened** — a handoff-ADJACENT round whose first call is retryable still makes EXACTLY
  ONE retry, and `RETRYABLE_CALL_FAILURES` is asserted unchanged in the same test;
- a **FUTURE-dated** `startedAt` (clock skew) is NOT adjacent — `age_ms` is signed and carried raw.

**Budget ceilings, before/after — UNCHANGED.** `.quay/config.yml` md5 `f09b4272a88377906cb366f2f6b77db0`
both before and after (gitignored; never written by this task; the worktree's provisioned copy is
byte-identical). Its OSD section still reads `max_model_calls_per_24h: 120` and `max_usd_per_24h: 30`
(re-read at AC-tick time). The delta against develop is 3 files, 371 insertions, and **no budget carrier**:
`git diff develop...HEAD | grep -E '^[+-].*(PER_CALL_USD_CEILING|maxModelCallsPer24h|maxUsdPer24h|max_model_calls_per_24h|max_usd_per_24h)'` returns **0 lines**.

### Proposed forward signal (Plan item 1 / DoD)
`.quay/anchor.json` publishes `startedAt` but nothing that says **whether that start was a takeover or a
cold start** — `takeover` is a *record*, and it is `null` after a clean handoff (both observed starts read
`"takeover": null` while `anchor.log` plainly shows `takeover … exited — taking over`). Adding
`startedBy: "fresh" | "takeover"` to that published surface would let the next occurrence separate «a
handoff happened» from «the anchor merely started», which is the one distinction the counters above cannot
make. **Deliberately NOT implemented here**: it is an unrequested field on a surface manager / outer /
`server status` all read, its marginal value on the observed population is zero (both starts were
takeovers), and no AC of this task needs it.

### AC3 — scoped gate: GREEN
```
bash scripts/test.sh --for-task gap-osd-stream-without-result-recurs-past-the-one-counted-retry-needs-correlated-signal --allow-thin
EXIT=0   tests 125   pass 125   fail 0   STATIC_CHECK_FAILED count = 0
```
(First run was red on `task-file-bypass-check` / `worktree-namespace-literal-check` /
`serve-binding-literal-check` — those were **my own** `plugin/scripts/dist/` build artifacts sitting in the
worktree, produced while measuring the driver-anchor inlining cost above. Removed; re-run green. Neither
the main checkout nor any other worktree carries a `dist/`, so this was a local, self-inflicted red and
not a property of the change.)

## Touches
- tasks/gap-osd-stream-without-result-recurs-past-the-one-counted-retry-needs-correlated-signal.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/driver-anchor.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
