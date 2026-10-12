---
id: gap-driver-round-carriers-unbounded-growth-retention-design
title: "driver *-round.jsonl carriers grow unbounded (meta 513M, goal 186M,
  verification 172M): consumer census + tested append-safe archival/retention,
  default disabled, no production carrier change"
status: done
labels:
  - gap
  - design
  - carrier-retention
parent: null
children: []
extra: {}
---
## Proposal
**The driver round carriers grow without bound (read 2026-10-13).**

| carrier | size |
|---|---|
| `.quay/meta-driver-round.jsonl` | 513 MiB, 57,830 lines since 2026-09-06, ≥59 MB in the last 24h |
| `.quay/goal-round.jsonl` | 186 MiB |
| `.quay/verification-round.jsonl` | 172 MiB |
| `outer-round.jsonl` | 57 MiB |
| `worker-round.jsonl` | 54 MiB |
| `promotion-round.jsonl` | 45 MiB |

None has a retention or rotation rule. The cost is already real:
- every whole-file consumer has a hidden size cliff: the V8 string limit broke the suite on 2026-10-13, and the done precedent `gap-fast-mode-telemetry-hangs-on-verification-round-growth` is the same family;
- most lines record idle rounds (`"facts":[]`).

Cross-project, the same shape appears: three idle host projects (archguard, cantus, meta-cc) total 578 MB of round logs, more than 97% of them no-op rounds.

Retention is not safe to bolt on blindly. Some readers depend on history:
- due computation from the latest resident round;
- goal criteria that count carrier records after a landing epoch;
- prod-data-audit `recordsAfterLanding`;
- telemetry;
- the task_trace epoch/rebase cursor contract.

A retention rule that drops lines those readers need would silently flip readings, which hard rules 4b and 4c forbid. **So this task designs and tests; it does NOT touch production carriers.**

## Consumer census (AC1)

**Re-measured sizes at implementation time (2026-10-13 02:44 +0800, `stat -c '%n %s'`), since the Proposal figures above were read at filing time and the drivers append continuously:**

| carrier | bytes live (2026-10-13) | lines | avg B/line |
|---|---|---|---|
| `.quay/meta-driver-round.jsonl` | 95,018,713 | ~1,306 + tail | **~65,000** |
| `.quay/goal-round.jsonl` | 194,262,155 | ~15,087 + tail | ~12,900 |
| `.quay/verification-round.jsonl` | 180,293,342 | ~2,555 + tail | **~67,000** |
| `.quay/outer-round.jsonl` | 59,149,528 | ~35,228 + tail | ~1,700 |
| `.quay/worker-round.jsonl` | 56,518,671 | ~44,247 + tail | ~1,300 |
| `.quay/promotion-round.jsonl` | 46,692,596 | ~67,290 + tail | ~700 |

⚠️ The two **~65 KB/line** carriers are not a footnote: they are why a fixed-width backward window finds no newline and why the first implementation attempt refused to archive them (see the alignment test).

### Reader table (POSITION-based, 硬规则 2)

| carrier | reader — file:line (POSITION) | needed window |
|---|---|---|
| `meta-driver-round.jsonl` | `plugin/scripts/driver-runtime.ts:213` `carriers: ["meta-driver-round.jsonl"]` (existence probe only) | **none** (existence) |
| | `plugin/scripts/meta-driver.ts:83` `ROUND_CARRIER_REL` | writer |
| `goal-round.jsonl` | `packages/quay/src/goal-merge.ts:175` `readGoalSufficiency` → `readFileSync` → **last** `value.sufficiency` match wins | **whole** |
| | `plugin/scripts/driver-runtime.ts:229` existence probe | **none** |
| | `plugin/scripts/meta-driver.ts:506` / `plugin/scripts/goal-driver.ts:96` | writer |
| `verification-round.jsonl` | `plugin/scripts/pool-quality-judge.ts:202` `readCurrentRound` — **line count IS the round number** | **whole** |
| | `plugin/scripts/runner-state-write.ts:74`, `plugin/scripts/pre-verified-round-record.ts:926`, `plugin/scripts/full-suite-runner.ts:3596` — `round = prior lines + 1` | **whole** (the numbering contract) |
| | `plugin/scripts/suite-duration-exceed-check.ts:84` `readRoundRows` + `latestRound` (max `round`) | whole (extremum) |
| | `plugin/scripts/perfile-failure-rate.ts:179` `readCarrierPerFile` — every `perFile` record | **whole** |
| | `plugin/scripts/prod-data-audit.ts:426` `recordEpochsFromFile` → `recordsAfterLanding` | **whole** |
| | `plugin/scripts/verification-marginal-return.ts:279` streaming scan | whole |
| | `plugin/scripts/suite-scheduler.ts:262` → `plugin/scripts/suite-lpt-order.ts:88` `loadDurationAverages` — per-file last `rounds` appearances | **latest-N** |
| | `plugin/scripts/psi-window-join.ts:101`, `plugin/scripts/psi-failure-correlation-check.ts:385` (time-window join) | latest-N |
| | `plugin/scripts/integration-batch-merge.ts:888` — latest `scope=worktree ∧ state=green` | since-an-epoch |
| | `plugin/scripts/full-suite-runner.ts:3596`, `plugin/scripts/worker-fan-in.ts:1835` | writer |
| `outer-round.jsonl` | `plugin/scripts/driver-runtime.ts:185` existence probe | **none** |
| | `plugin/scripts/outer-driver.ts:53` `ROUND_LOG_REL` | writer |
| `worker-round.jsonl` | `packages/quay/src/observation.ts:1195`, `:1240`, `:1978` `readFileSync` → min/max over ALL lines | **whole** (extremum) |
| | `plugin/scripts/server-restart-inflight-verify.ts:519` `lastLine(...)` — needs a NEW `run_id` after a restart | **latest-1** |
| | `plugin/scripts/worker-driver.ts:436` | writer |
| `promotion-round.jsonl` | `packages/quay/src/observation.ts:3465` → `:3409` `parsePromotionRoundRecords` → **latest** record | **latest-1** |
| | `plugin/scripts/driver-runtime.ts:158` existence probe | **none** |
| | `plugin/scripts/promotion-driver.ts:86` | writer |

**Directory-level reader (matters for segment naming):** `plugin/scripts/goal-driver.ts:4325` does `fs.readdirSync('.quay')` and keeps every name matching `/-round\.jsonl$/`, newest by mtime first. A segment left in `.quay/` named `<carrier>.<date>.jsonl` does **not** match that regex (`-round.` ≠ `-round.jsonl`) — and segments are written under `.quay/archive/<carrier>/` anyway, so `.quay/` stays byte-identical in shape.

### Grep commands + first 3 hits (硬规则 2 — the first hits are COMMENTS, which is the point)

```
grep -rn --include='*.ts' --include='*.mjs' --include='*.js' -- "<carrier>" \
     plugin/scripts packages scripts experiments | grep -v node_modules | grep -v '/dist/' \
     | grep -vE '\.test\.(mjs|ts|js):|/test/'
```

- `meta-driver-round` → 1 code hit total: `plugin/scripts/meta-driver.ts:83` (the writer). *No non-test reader at any position.*
- `goal-round` → `plugin/scripts/meta-driver.ts:506` (writer), `packages/quay/src/goal-merge.ts:175` (**the reader**).
- `verification-round` first 3 hits: `plugin/scripts/pool-quality-judge.ts:202`, `plugin/scripts/psi-window-join.ts:101`, `plugin/scripts/psi-failure-correlation-check.ts:385` — all reads.
- `outer-round` first 3 hits: `plugin/scripts/outer-driver.ts:8`, `:20`, `:32` — **all three are COMMENTS**; the only code position is `:53` (`ROUND_LOG_REL`, the writer) and `driver-runtime.ts:185` (existence).
- `worker-round` first 3 hits: `plugin/scripts/fan-in-push-lag-check.ts:56`, `plugin/scripts/worker-fan-in.ts:775`, `plugin/scripts/slot-refill.ts:255` — **all three are COMMENTS** (prose citing a past reading). The code positions are the `observation.ts` / `server-restart-inflight-verify.ts` rows above.
- `promotion-round` first 3 hits: `plugin/scripts/outer-driver.ts:52` (comment), `plugin/scripts/driver-runtime.ts:158` (existence), `driver-runtime.ts:634` (comment). The reader is `observation.ts:3465`.

### What the census decides

1. **Two carriers have no history-dependent reader at all** (`meta-driver-round`, `outer-round`): only existence probes. They are the safe first candidates if a future step wants retention enabled.
2. **Four carriers are read WHOLE by at least one reader**, and two of those are *numbering* contracts (`round = prior lines + 1`; "round count = line count"). Archiving them **without** read-through would silently renumber rounds and reset the round counter — the exact silent-flip this task exists to prevent. So the mechanism ships a read-through helper (`materializeAllRecords`) that re-concatenates segments + live into one file a path-taking reader can consume **unchanged**; readers needing only the tail are untouched.
3. Plan step 5 (suppress/compact idle `"facts":[]` lines) is **NOT implemented**: the census shows `meta-driver-round` and `goal-round` are read as *whole-history* by at least one reader each, and neither carrier's readers expose a "no reader needs this line" window that could be established mechanically. Left as a separate, census-gated decision.

## Plan
1. **Consumer census first.** For each of the six carriers, list every non-test reader (position-based, not keyword-based: hard rule 2) and the history window it actually needs: none / since a landing epoch / latest-N / whole. Paste the table into this task. ✅ section above.
2. **Mechanism:** one shared, append-safe archival routine. It segments a carrier into `<name>.<YYYY-MM-DD>.jsonl[.gz]` archive files plus a live tail. It must:
   - preserve every record byte-for-byte (an archive is a move, never a delete);
   - be atomic against a concurrent appender (no lost or duplicated line across the cut);
   - leave a manifest of segments so a whole-history reader can iterate segments transparently;
   - fail closed: on any error, the live carrier is left untouched.
3. **Readers that need history read through one segment-iterating helper.** Readers needing only the tail are unchanged.
4. **Policy is config** (`retention:` per carrier: `live_max_bytes` / `live_max_days`), default **disabled**. A `--dry-run` reports what would be archived for the real production carriers without writing anything.
5. Optional, separate from archival: suppress or compact idle `"facts":[]` round lines where no reader needs them (decided from the census in step 1). → decided NOT to implement; see census §"What the census decides" item 3.

## Acceptance Criteria
- [x] AC1: the consumer census table is pasted (carrier → reader file:line → needed window), with the grep commands and the first 3 hits of each, per hard rule 2. → `## Consumer census` above.
- [x] AC2: unit tests on fixture carriers (`plugin/test/carrier-retention.test.mjs`):
  - (a) archive + live tail preserves the exact multiset of lines (byte equality of the concatenation);
  - (b) a concurrent appender during the cut loses and duplicates nothing (stress test, N appends);
  - (c) a failure mid-archive leaves the live carrier byte-identical;
  - (d) the segment-iterating helper returns the same records as the pre-archive single file.
  Negative control for (a) and (b) (paste). → both are tests in the file; the (b) control is **also mutation-verified against the real code path** (below).
- [x] AC3: for every history-dependent reader in the census, a test shows the same reading before and after archiving a fixture. → 6 real readers driven through their real modules across 4 carriers (`readCurrentRound`, `loadDurationAverages`, `readRoundRows`/`latestRound`, `readCarrierPerFile`, `readGoalSufficiency`, `parsePromotionRoundRecords`), each with the **opposite arm** (the archived live tail alone must DIFFER), so the equality cannot be vacuous.
- [x] AC4: `--dry-run` against the production `.quay` prints the planned segments and bytes per carrier. Production file sizes and mtimes are unchanged afterwards, apart from concurrent appends (paste `stat` before and after and the md5 of the first 1 MB). → evidence below.
- [x] AC5: config default is disabled. With the `retention:` section absent, the driver makes zero archive writes (test). → three tests; the strongest snapshot the whole workspace tree and require it byte-for-byte unchanged.

## Evidence

### AC4 — `--dry-run` against the production `.quay` (`/data/home/yale/work/quay`), 2026-10-13 02:44–02:45 +0800
```
carrier-retention — DRY RUN (nothing written) — root /data/home/yale/work/quay
  config: source=absent (config.yml carries no `retention:` section) enabled=false
  → meta-driver-round.jsonl: live 95018713 B → segment 85785401 B / 1306 lines, tail 9233312 B
  → goal-round.jsonl:        live 194262155 B → segment 185862656 B / 15087 lines, tail 8399499 B
  → verification-round.jsonl: live 180293342 B → segment 171812987 B / 2555 lines, tail 8480355 B
  → outer-round.jsonl:       live 59149528 B → segment 50760121 B / 35228 lines, tail 8389407 B
  → worker-round.jsonl:      live 56518671 B → segment 48128540 B / 44247 lines, tail 8390131 B
  → promotion-round.jsonl:   live 46692596 B → segment 38303783 B / 67290 lines, tail 8388813 B
```
(projection policy `live_max_bytes=8388608`; exit 0)

`stat -c '%n %s %Y %y'` + `head -c 1048576 | md5sum`, **before → after**:

| carrier | bytes before | bytes after | mtime before → after | md5(first 1 MB) |
|---|---|---|---|---|
| meta-driver-round | 95,018,713 | 95,018,824 (+111) | 02:44:27 → 02:45:28 | `9127b3e2…` **unchanged** |
| goal-round | 194,262,155 | 194,262,155 | 02:43:46 → 02:43:46 | `5f4143ce…` **unchanged** |
| verification-round | 180,293,342 | 180,293,342 | 02:44:36 → 02:44:36 | `412299460…` **unchanged** |
| outer-round | 59,149,528 | 59,151,045 (+1,517) | 02:44:21 → 02:45:24 | `4ae7f79f…` **unchanged** |
| worker-round | 56,518,671 | 56,518,671 | 02:42:21 → 02:42:21 | `2722fe41…` **unchanged** |
| promotion-round | 46,692,596 | 46,693,272 (+676) | 02:44:27 → 02:45:28 | `85a52397…` **unchanged** |

The three size/mtime deltas are **concurrent driver appends** (the resident promotion/worker/meta drivers write these carriers continuously), not writes by this task: the md5 of the first 1 MB is identical for all six, and `ls -d /data/home/yale/work/quay/.quay/archive` → *No such file or directory* afterwards. No archive directory, manifest, temp file or segment was created anywhere in the production workspace.

### AC2 negative controls (pasted)
- **(a)** `AC2a negative control: a DROPPED line makes the concatenation equality fail` — after archiving, one line is deleted from the segment; `Buffer.compare(segments ++ live, original) !== 0`. If it still compared equal, the AC2a assertion would be vacuous.
- **(b)** two arms:
  1. `AC2b negative control: a rotation that does NOT drain the pinned inode loses that write` — an appender holding an fd across the atomic replace writes into the orphaned inode; the raced line is **absent** from the replaced file, so the multiset equality takes FALSE.
  2. **Mutation control against the real routine** — replacing `drainAppends(fd, size0, …)` with an empty buffer in the shipped code makes `AC2b: N concurrent appends during the cut — every line present exactly once` the **only** failing test (19 pass / 1 fail), then the mutation is reverted. This proves the concurrency test is not passing for some other reason.

### Reader drift caught by this work (why AC3 is not decoration)
The first implementation returned offset `0` from its backward line-scan when the scan window held no newline. That is a *wrong line start*, not "the file begins here" — and because `meta-driver-round.jsonl` averages ~65 KB per record, the production `--dry-run` refused **two of the six carriers** with *"cut is not on a line boundary — refusing"*. `lineStartAtOrBefore` now returns **-1** when the window holds no newline (硬规则 3b: "I could not tell" gets its own value), the caller widens the scan (`lastNewlineOffset`), and both the refusing carriers and the -1 semantics are pinned by tests.

## Definition of Done
- `scripts/test.sh --for-task <this task>` green.
- **⛔ No production carrier is rotated, truncated, moved or compacted by this task.** Enabling retention on the production `.quay` is a separate, explicitly human-authorized step and is out of scope. → AC4 evidence above: `--dry-run` only, first-1MB md5 identical for all six, no archive dir created.

## Touches
- tasks/gap-driver-round-carriers-unbounded-growth-retention-design.md
- plugin/scripts/carrier-retention.ts
- plugin/test/carrier-retention.test.mjs
- plugin/scripts/capability-catalog-declarations.json
