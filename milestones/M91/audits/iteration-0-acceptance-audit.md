# Iteration-0 Acceptance Audit — M91 (exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS)

**Audit session id:** m91-audit-2026-07-22  
**Task:** `tasks/exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS.md`  
**Charter:** `experiments/quay-perpetual-stream/charters/M91-qc-t1-fixture-probe.md`  
**Audited branch:** `exp5-m91-iteration-0`  
**Date:** 2026-07-22

---

## AC 1 — `OUTER-LOOP.md` session-start section documents QC-T1 healthcheck with idempotent re-create

**Refutation attempt:** YES — **NO REFUTATION FOUND**

OUTER-LOOP.md lines 18-25 (`## Session-start healthcheck (QC-T1 native task store liveness probe)`):

```
After reading the pinned references, call `task_get QC-T1` to verify the native task store is
accessible. If the result is "no such task: QC-T1": call `task_write` to re-create the fixture
with `{id: QC-T1, title: "healthcheck fixture — native task store liveness probe", status: todo,
labels: [fixture, healthcheck], body: "Permanent liveness probe — never complete. Re-create if
absent (idempotent)."}`, then retry `task_get QC-T1` to confirm. Never silently continue if the
re-creation also fails — halt and raise `needs-human`. This probe is idempotent: re-running at any
session start finds QC-T1 (creating it if missing) without side-effects.
```

All four required elements present: (1) explicit `task_get QC-T1` call; (2) "no such task" triggers `task_write` re-create; (3) retry to confirm; (4) "Never silently continue" halt on unresolvable failure. No exit path for silent swallow.

**→ `- [x]`**

---

## AC 2 — `tasks/QC-T1.md` fixture task exists with correct fields

**Refutation attempt:** YES — **NO REFUTATION FOUND**

`git show exp5-m91-iteration-0:tasks/QC-T1.md`:
- `id: QC-T1` ✓
- `title: healthcheck fixture — native task store liveness probe` ✓
- `status: todo` ✓
- `labels: [fixture, healthcheck]` ✓
- Body: meaningful purpose section explaining liveness probe role and permanence ✓

**→ `- [x]`**

---

## AC 3 — Procedure is idempotent: absence triggers re-creation, never silent pass

**Refutation attempt:** YES — **NO REFUTATION FOUND**

Four idempotence scenarios verified against the OUTER-LOOP.md text:
- **QC-T1 absent (first run):** task_get → "no such task" → task_write → retry confirms → continues ✓
- **QC-T1 present:** task_get → success → no re-create → continues ✓  
- **QC-T1 deleted between sessions:** new session → task_get → "no such task" → re-creates → continues ✓
- **Re-creation fails:** "Never silently continue... halt and raise `needs-human`" ✓

No exit path allows silent continuation with QC-T1 absent.

**→ `- [x]`**

---

## Additional checks

- **`it0-dod-check.mjs` unchanged:** `git diff exp5-m91-iteration-0 a260619 -- experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` → empty ✓
- **manda healthz:** N/A — no manda surface change ✓
- **port-4173:** N/A — no Web UI surface change ✓

---

## Verdict

**NO REFUTATION FOUND**

All three acceptance criteria confirmed met. The QC-T1 healthcheck fix is complete, idempotent, and leaves no silent-swallow exit path. Fixture task exists with correct structure.
