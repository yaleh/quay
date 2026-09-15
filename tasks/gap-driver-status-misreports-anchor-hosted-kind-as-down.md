---
id: gap-driver-status-misreports-anchor-hosted-kind-as-down
title: quay driver status --kind &lt;k&gt; 误报被 driver-anchor 托管的 kind 为
  alive=0/running=0(host=supervisor)，实际该 kind 正在正常运转
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
## Finding

Real-machine evidence, gathered this session on 2026-09-14/15 while migrating quay's own production drivers from the legacy per-kind supervisor form to the single-anchor form, `/home/yale/work/quay`, commit range around `017d4f8f4`..`a4fbd481c` on develop.

After migrating all 6 kinds (promotion/worker/outer/quality/meta/goal) onto a single `driver-anchor.ts __anchor` process (confirmed via `ps`: one process, pid stable, `anchor.json` lists all 6 kinds), `quay driver status --kind worker --json` and `--kind outer --json` reported:

```
{"kind":"worker","host":"supervisor","anchor_pid":4014875,"supervisor_pid":null,"driver_pid":null,"alive":0,"running":0,...}
```

i.e. `alive=0`/`running=0`/`host=supervisor` — reads as "this kind is down" — while the SAME kind's `promotion`/`quality`/`meta`/`goal` siblings, migrated via the exact same mechanism at the exact same time, correctly reported `host="anchor", driver_pid=<anchor pid>, alive=1, running=1`.

Cross-checked against ground truth (bypassing the CLI entirely): `.quay/worker-round.jsonl` and `.quay/outer-round.jsonl`'s last records were timestamped 1-20 seconds before the query — i.e. both kinds were genuinely alive and actively ticking under the anchor at the exact moment `driver status` reported them as down. This was reproduced twice independently (both right after the initial migration, and again ~15 minutes later after the driver-anchor dist-closure fix had fully settled), and also triggered a real false alarm from a standing external Monitor watching this repo's drivers ("ALL 6 driver kinds down simultaneously for 180s — shape matches a real ecosystem-wide outage") when in fact the anchor process and all 6 kinds' round files were fresh.

Likely mechanism (not yet root-caused by the filer — implementer should verify against current code, not assume): `driver status`'s per-kind reporting path in `plugin/scripts/driver-runtime.ts` appears to read a per-kind pid file (`.quay/<kind>-driver.pid` / `.quay/<kind>-driver-supervisor.pid`) that no longer exists/gets updated once a kind is anchor-hosted, and doesn't consistently fall back to querying the anchor's own internal state (`.quay/anchor.json` + the anchor's own liveness) for EVERY kind — `promotion`/`quality`/`meta`/`goal` happened to report correctly (`host=anchor`) while `worker`/`outer` did not, in the exact same anchor/environment, so whatever branch decides `host` is inconsistent across kinds rather than uniformly broken or uniformly working.

Impact: this is a `硬规则 4b`-class defect (a status reading that looks like ground truth but is actually a decayed/wrong proxy) — it will keep generating false "driver is down" alarms (human-facing CLI output, `quay server status --json`, and any external monitor built on top of `driver status`) for any anchor-hosted deployment, indefinitely, unless fixed. Given AC-255 (process consolidation) just landed in production, EVERY kind will be anchor-hosted going forward, so this bug's blast radius is now the entire fleet, not an edge case.

Dedup check performed (this session, via `task_list` search): `gap-driver-status-carrier-path-source-label-mismatch` (status ready) was checked and confirmed to be a DIFFERENT, unrelated provenance bug — which carrier file supplied a timestamp, not whether a kind is reported alive/dead. Searches for "host=supervisor", "driver status misreport", "anchor-hosted", "误报" surfaced no other task naming this specific alive/host misreport mechanism. Not a duplicate of any existing task.

## AC

- [ ] AC1: root cause confirmed — the exact code path in `driver-runtime.ts` (or wherever `quay driver status`/`server status` derives `host`/`alive`/`running` per kind) that produces `host=supervisor, alive=0` for an anchor-hosted kind, and why it differs between kinds that report correctly vs. incorrectly.
- [ ] AC2: fix lands so `quay driver status --kind <k> --json` correctly reports `host="anchor", alive=1, running=1` for EVERY kind currently hosted by a live anchor process, cross-checked against that kind's own round-file freshness (not just internal state self-report).
- [ ] AC3: negative control — a kind NOT declared in `anchor.json` (or with no live anchor at all) must still correctly report `alive=0`/legacy form as appropriate; the fix must not make "down" unreportable.
- [ ] AC4: real-machine verification on `/home/yale/work/quay` (or an isolated fixture reproducing the anchor-hosted shape) — all 6 kinds queried individually report consistently with their actual round-file freshness.
- [ ] AC5: a regression test exists that would have caught this (asserts `host`/`alive` for an anchor-hosted kind against a fixture where the per-kind legacy pid file is deliberately absent/stale).

## DoD

Landed on develop: the per-kind `host`/`alive`/`running` derivation in `quay driver status --kind <k>` (and any consumer of it, e.g. `quay server status --json`) correctly reports every anchor-hosted kind as alive/running when its round-carrier is fresh, for ALL 6 kinds uniformly (not just the 4 that happened to work), verified against real round-file timestamps on a real workspace (not just a green test in isolation). The regression test in AC5 fails on the pre-fix code and passes on the post-fix code (prefix-code-swap negative control). No kind's "down" reporting capability is lost (AC3 still discriminates a genuinely-down/non-anchor kind).

## Touches

- plugin/scripts/driver-runtime.ts
- packages/quay/src/cli/server.ts
- plugin/test/driver-runtime.test.mjs
- tasks/gap-driver-status-misreports-anchor-hosted-kind-as-down.md
