---
id: gap-driver-round-carriers-unbounded-growth-retention-design
title: "driver *-round.jsonl carriers grow unbounded (meta 513M, goal 186M,
  verification 172M): consumer census + tested append-safe archival/retention,
  default disabled, no production carrier change"
status: ready
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

## Plan
1. **Consumer census first.** For each of the six carriers, list every non-test reader (position-based, not keyword-based: hard rule 2) and the history window it actually needs: none / since a landing epoch / latest-N / whole. Paste the table into this task.
2. **Mechanism:** one shared, append-safe archival routine. It segments a carrier into `<name>.<YYYY-MM-DD>.jsonl[.gz]` archive files plus a live tail. It must:
   - preserve every record byte-for-byte (an archive is a move, never a delete);
   - be atomic against a concurrent appender (no lost or duplicated line across the cut);
   - leave a manifest of segments so a whole-history reader can iterate segments transparently;
   - fail closed: on any error, the live carrier is left untouched.
3. **Readers that need history read through one segment-iterating helper.** Readers needing only the tail are unchanged.
4. **Policy is config** (`retention:` per carrier: `live_max_bytes` / `live_max_days`), default **disabled**. A `--dry-run` reports what would be archived for the real production carriers without writing anything.
5. Optional, separate from archival: suppress or compact idle `"facts":[]` round lines where no reader needs them (decided from the census in step 1).

## Acceptance Criteria
- [ ] AC1: the consumer census table is pasted (carrier → reader file:line → needed window), with the grep commands and the first 3 hits of each, per hard rule 2.
- [ ] AC2: unit tests on fixture carriers:
  - (a) archive + live tail preserves the exact multiset of lines (byte equality of the concatenation);
  - (b) a concurrent appender during the cut loses and duplicates nothing (stress test, N appends);
  - (c) a failure mid-archive leaves the live carrier byte-identical;
  - (d) the segment-iterating helper returns the same records as the pre-archive single file.
  Negative control for (a) and (b) (paste).
- [ ] AC3: for every history-dependent reader in the census, a test shows the same reading before and after archiving a fixture.
- [ ] AC4: `--dry-run` against the production `.quay` prints the planned segments and bytes per carrier. Production file sizes and mtimes are unchanged afterwards, apart from concurrent appends (paste `stat` before and after and the md5 of the first 1 MB).
- [ ] AC5: config default is disabled. With the `retention:` section absent, the driver makes zero archive writes (test).

## Definition of Done
- `scripts/test.sh --for-task <this task>` green.
- **⛔ No production carrier is rotated, truncated, moved or compacted by this task.** Enabling retention on the production `.quay` is a separate, explicitly human-authorized step and is out of scope.

## Touches
- tasks/gap-driver-round-carriers-unbounded-growth-retention-design.md
- plugin/scripts/carrier-retention.ts
- plugin/test/carrier-retention.test.mjs
- plugin/scripts/capability-catalog-declarations.json
