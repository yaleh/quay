---
id: gap-driver-restart-unreliable-legacy-to-anchor-migration
title: quay driver restart --kind &lt;k&gt; 迁移 legacy→anchor 时优雅关闭旧进程不可靠，常需人工兜底确认/强杀
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

Real-machine evidence, 2026-09-15, `/home/yale/work/quay`, migrating all 6 production driver kinds from the legacy per-kind supervisor+driver form to the single `driver-anchor.ts` form after the `driver-anchor.js` dist-closure fix landed.

`quay driver restart --kind <k>` is documented as "stop then start". Running it sequentially for `worker`, `outer`, `quality`, `meta`, `goal` (immediately after `promotion` had already migrated cleanly and successfully spun up the anchor process) produced this pattern for MULTIPLE kinds:

1. The CLI's own stop step apparently timed out or returned without the old legacy `driver-runtime.ts __supervise --kind <k>` supervisor and its `<kind>-driver.ts` child actually exiting — `ps` immediately after showed both OLD pids still alive alongside the NEW anchor process. The CLI itself printed messages like `kind=worker loop did not stop within 60s (anchor pid=...)` and `start-pending: ... 确认窗口 30s 用尽 ... driver pid=none alive=0`, i.e. the tool's own output surfaced the ambiguity but did not resolve it or fail loudly enough to be unmissable in a background/non-interactive dispatch.
2. Manually re-checking with plain `kill -0 <pid>` confirmed FOUR kinds (`goal`, `outer`, `quality`, `meta`) had their old legacy supervisor+driver pairs still alive 60+ seconds after the restart command returned, running concurrently with the new anchor-hosted loop for the same kind — a genuine double-loop / potential double-dispatch risk (confirmed concretely for `goal`: the OLD standalone `goal-driver.ts` process was still alive, writing to the same `.quay/goal-round.jsonl`, 8+ minutes after being told to restart).
3. Sending a plain `kill -TERM` to the old pids eventually worked, but took 20-45+ seconds per kind to actually exit (well past the CLI's own supervisor-stop timeout window) — for `worker` specifically, the old driver took over 2 minutes and required an eventual `kill -KILL` (the in-flight worker CHILD process it owned was correctly left untouched/orphaned during this, per the documented invariant — that part worked correctly).
4. Net effect: a human (or an automated migration script) that trusts `quay driver restart --kind <k>`'s own success/failure reporting, or that just checks `driver status` shortly after (which per the SIBLING finding `gap-driver-status-misreports-anchor-hosted-kind-as-down` is itself unreliable for anchor-hosted kinds), cannot currently tell whether a restart-driven legacy→anchor migration actually completed cleanly without independently cross-checking real OS-level pids by hand.

This is NOT about whether the anchor mechanism itself works (it does, once actually converged) — it's about the RESTART VERB's own stop-confirmation reliability specifically in the legacy→anchor transition shape, which is a one-time-per-deployment but high-stakes operation (get it wrong and you have two loops fighting over the same tasks/locks).

**Dedup check performed (this session)**: `gap-ac255-driver-internalization-pid-le2-six-kinds-fresh` (status done) built the anchor mechanism itself and explicitly left the production migration as "待外部" (pending real execution) — not a duplicate, this finding is about the RESTART VERB's own reliability during that migration, discovered while actually performing it. `gap-driver-status-misreports-anchor-hosted-kind-as-down` (status ready, filed moments earlier this session) is a DIFFERENT, related-but-distinct bug — that one is about `driver status`'s per-kind reporting misclassifying an already-anchor-hosted, correctly-running kind as down (a read-side/reporting defect); this finding is about the restart verb's own stop-confirmation during an active legacy→anchor transition (a write-side/execution-reliability defect). Searches for "restart legacy anchor", "double-dispatch", "graceful shutdown old supervisor", "stop-pending" surfaced no other task naming this specific restart-reliability mechanism. Not a duplicate of any existing task.

## AC

- [ ] AC1: root cause confirmed — why does the CLI's stop-confirmation for the legacy supervisor+driver pair time out / return before the old process tree has actually exited, for some kinds but not others (`promotion` migrated cleanly on the first try; `worker`/`outer`/`quality`/`meta`/`goal` did not).
- [ ] AC2: fix makes `quay driver restart --kind <k>` either (a) reliably wait for the OLD process tree's actual exit before reporting success/reaching the start phase, with a bounded, honest timeout and a distinguishable "still draining after N seconds, here is what to check" message (not a silent race), or (b) reliably escalate (SIGKILL the old pair, never the in-flight worker children) after a documented grace period so the command's own exit code/output is trustworthy without a human doing `kill -0` by hand.
- [ ] AC3: negative control — verify a kind with genuinely no old process (already anchor-hosted, or never started) restarts cleanly with no spurious "did not stop" warnings.
- [ ] AC4: real-machine verification of a legacy→anchor restart on a kind with the same shape as this session's `goal` reproduction (an old standalone driver+supervisor pair actually torn down, confirmed via OS-level pid checks, not just the CLI's own self-report).
- [ ] AC5: worker's in-flight-child-preservation invariant (children survive, orphan, and finish) must remain intact under whatever fix lands — add/keep a test asserting this specifically for the migration path, not just the steady-state restart path already covered by existing AC-256 tests.

## DoD

Landed on develop: `quay driver restart --kind <k>` gives a trustworthy, self-consistent success/failure signal for the legacy→anchor migration shape specifically — either it does not return/report success until the old process tree is verifiably gone (OS-level, not self-reported), or it deterministically escalates within a documented grace period and says so. A human running the six-kind migration sequence should never again need to manually `kill -0`/`kill -TERM` old pids to find out whether a restart actually completed. AC1-AC5 satisfied; regression tests pass; worker's orphan-child-preservation invariant is verified intact for the migration path specifically.

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/test/driver-runtime.test.mjs
- tasks/gap-driver-restart-unreliable-legacy-to-anchor-migration.md

<!-- dedup-ref -->
Depends_on: none (independent finding; related-but-not-duplicate of `gap-driver-status-misreports-anchor-hosted-kind-as-down`, filed moments earlier this same session — that one is a read-side status-reporting defect, this one is a write-side restart-execution-reliability defect; do not merge the two).
