#!/usr/bin/env bash
# concurrent-batch-scheduler-selfcheck.sh — external acceptance for the batch assembler (DIR-044
# increment 2). Asserts the ASSEMBLED BATCH (parsed from stdout) for fixed fixture sets. The rule is
# defined SOLELY by concurrent-batch-scheduler.mjs (assembleBatch); this only asserts the observable
# batch. Fix belongs in the module, never the fixtures (DIR-019).
#   Exit: 0 = all cases as asserted; 1 = mismatch; 2 = environment error.
set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }
SCHED="./scripts/concurrent-batch-scheduler.ts"
FIX="fixtures/scheduler"
[ -f "$SCHED" ] || { echo "ERROR: $SCHED not found" >&2; exit 2; }

batch_line() { node "$SCHED" "$@" 2>/dev/null | grep '^BATCH'; }

fail=0
# Case 1: disjoint execution pair → both in the batch.
got=$(batch_line "$FIX/exec-a.md" "$FIX/exec-b.md")
echo "$got" | grep -q "2-wide" && echo "$got" | grep -q "exec-a" && echo "$got" | grep -q "exec-b" \
  && echo "PASS: disjoint-pair batches 2-wide" || { echo "FAIL: disjoint-pair — got: $got"; fail=1; }

# Case 2: mixed set → only exec-a + exec-b batch; overlap/learning/shared-state deferred.
got=$(batch_line "$FIX/exec-a.md" "$FIX/exec-b.md" "$FIX/exec-c-overlaps-a.md" "$FIX/learning-d.md" "$FIX/shared-state-e.md")
echo "$got" | grep -q "2-wide" && echo "$got" | grep -q "exec-a" \
  && ! echo "$got" | grep -q "exec-c-overlaps-a" && ! echo "$got" | grep -q "learning-d" && ! echo "$got" | grep -q "shared-state-e" \
  && echo "PASS: mixed set batches only the disjoint execution pair" || { echo "FAIL: mixed set — got: $got"; fail=1; }

# Case 3: a lone shared-state candidate → NOT batched (empty batch).
got=$(batch_line "$FIX/shared-state-e.md")
echo "$got" | grep -q "(none)" && echo "PASS: lone shared-state candidate not batched" || { echo "FAIL: shared-state solo — got: $got"; fail=1; }

echo
if [ "$fail" = 0 ]; then echo "PASS: all concurrent-batch-scheduler cases behaved as asserted."; exit 0
else echo "FAIL: at least one case mismatched (fix belongs in the module, not fixtures — DIR-019)."; exit 1; fi
