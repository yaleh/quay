---
id: gap-driver-anchor-self-refresh-leaves-no-anchor-alive
title: driver anchor 源码自刷新（AC-184）：stop 期间 reconcile 把 loop 重新拉起 + 接管等待预算短于旧
  anchor 最坏退出时间 + 接管放弃后无人兜底 ⇒ 六个 kind 一起停摆（实测 09-13/09-18 共 4 次，最近一次 27 分钟）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Finding

(all measured 2026-09-18 from .quay/anchor.log and plugin/scripts/driver-anchor.ts; NOT inferred, except where marked 假说)

Incident: anchor pid 426878 (started 09:17:42Z) — a fan-in landing at 15:32:59Z changed watched source; the anchor self-refreshed (AC-184): spawned a replacement with --takeover and requested its own stop (`stop requested` 15:33:25Z). anchor.log lines ~6670-6703:

- after the stop request, kind loops finished (`loop stopped`) and were then RE-STARTED by the anchor's own reconcile (`loop started` at 15:33:53, 15:34:41, 15:36:07) so `active` never drained;
- old anchor hit shutdownGraceMs=120000 (`shutdown grace 120000ms exceeded … exiting anyway`, logged 15:36:07Z), then still waits up to min(60s, grace) post-loop, then cleanup; actual exit `anchor: exited` 15:37:18Z = 233s after the stop request;
- the takeover replacement waits shutdownGraceMs+60s = 180s (driver-anchor.ts:201) → at 15:36:20Z `takeover 426878 STILL ALIVE after 180000ms — REFUSING to start … this refresh attempt is abandoned` and exited;
- result: NO anchor alive from 15:37:18Z until a human restarted drivers at 16:04:15Z (27 min; promotion-round.jsonl last round 15:37:18Z; .quay/promotion-driver.pid absent; no supervisor, no OS timer for the driver anchor — os-anchor-watchdog.sh watches Claude sessions, not this).

Three defects:

- D1 driver-anchor.ts:335-337 — the reconcile "start wanted kinds not in active" loop has NO `!stopping` guard, so during a stop finished loops are restarted (the code comment at ~:296-305 itself says stop must be bounded because draining can be unbounded; this makes draining unreachable rather than merely slow).
- D2 the takeover wait budget (`shutdownGraceMs + 60_000`, :201) is not derived from the old anchor's true worst-case exit (grace + post-loop wait min(60s,grace) + cleanup), so a correct-but-slow handoff is declared failed.
- D3 when takeover is abandoned the replacement exits and the old anchor exits anyway ⇒ zero anchors and nothing re-spawns; the abandon path only logs.

Incidence (hard rule 12, from anchor.log, all history in file): 10 `stop requested` episodes; ALL 10 show loops restarted during the stop (3-16 each); 4 of them also exceeded grace + abandoned takeover + forced exit: 2026-09-13T20:28Z, 09-13T23:37Z, 09-18T07:29Z, 09-18T15:33Z (`REFUSING to start` occurs 6 times in total). Gaps between `anchor: exited` and next `host pid=` line: 09-18 07:33→09:17 (1h44m, NOT verified that no other host dispatched then), 09-18 15:37→16:04 (27min, verified: no promotion rounds).

假说 (not verified): adding the `!stopping` guard alone makes drains converge inside the grace window. The causal chain D1→D2→D3 is read from log+code; no controlled re-run was done.

<!-- dedup-ref -->
**查重（已核）**：`task_list` 对 anchor / takeover / self-refresh / shutdownGraceMs / AC-184 / `gap-driver-anchor` 前缀检索，无同机制任务。相关但不同、仅作可追溯性引用（不是本条的任何条件）：`gap-os-anchor-watchdog-lease-model-instead-of-absence-inference`（同族：anchor 存活性；但那条管 Claude 会话活性，本条管 driver anchor 自身的源码自刷新交接）；`gap-a13-a20-stale-carrier-after-worker-driver-takeover`（worker-driver 接管后的陈旧载体，机制不同）。

## Requested action

1. D1: add a `!stopping` guard to the reconcile start branch (driver-anchor.ts ~:336) so no kind is (re)started once a stop is requested.
2. D2: derive the takeover wait deadline from the old anchor's real worst-case exit time instead of `shutdownGraceMs+60_000` (or make the replacement wait on the old pid's exit / anchor.pid removal with a bound that provably exceeds it).
3. D3: an abandoned takeover must not leave zero anchors: the replacement must not exit silently when the old anchor is gone — after the old pid dies it should start (double-dispatch is impossible once the old pid is dead), or an external re-spawn path must exist; the abandon path must leave a machine-readable record (e.g. anchor.json field) distinct from "fresh", never just a log line.

## Acceptance Criteria

Each runnable; use the seams in plugin/test/driver-anchor-stop.test.mjs / driver-anchor.test.mjs — read them first.

- [ ] AC1 (D1, red first) a test in plugin/test/driver-anchor-stop.test.mjs: with an injected `invokeKind` whose loop returns immediately, request stop and run several reconcile passes ⇒ assert no `loop started` for a kind after `stop requested`. RED on current code (paste raw output), GREEN after fix.
- [ ] AC2 (D1 negative control) with NO stop requested, a loop that returns and is still wanted IS restarted (existing behaviour preserved); and a kind added to desired state after boot is still started.
- [ ] AC3 (D2) test: old anchor whose loops drain only at the grace boundary (grace shortened via QUAY_ANCHOR_SHUTDOWN_GRACE_MS) ⇒ the takeover replacement takes over (no `REFUSING to start`); and a control where the old pid never exits ⇒ replacement still REFUSES (double-dispatch guard preserved).
- [ ] AC4 (D3) test: when takeover is abandoned and the old pid subsequently dies, an anchor ends up alive (or a machine-readable `takeover-abandoned` state is written to .quay/anchor.json distinguishable from fresh); assert on the direct quantity (pid liveness / json field), not a log line.
- [ ] AC5 (production reading, hard rule 推论三) after landing and one real self-refresh in production, anchor.log shows `stop requested` followed by NO `loop started` and a successful takeover; count only episodes whose timestamp is later than the landing commit time. Until such an episode exists mark this AC unchecked with a note, do not tick from fixtures.
- [ ] AC6 `node --test plugin/test/driver-anchor*.test.mjs` exit 0; paste # tests/# pass/# fail.

## Definition of Done

REAL LANDING: the anchor's source self-refresh hands over to a live replacement without leaving zero anchors, observed on the production anchor (AC5), not only in fixtures. Do not restart or kill production drivers as part of this task. Rollback = revert the guard + budget change in driver-anchor.ts.

## Touches

- plugin/scripts/driver-anchor.ts
- plugin/test/driver-anchor-stop.test.mjs
- plugin/test/driver-anchor-takeover.test.mjs
- plugin/test/driver-anchor.test.mjs
- tasks/gap-driver-anchor-self-refresh-leaves-no-anchor-alive.md