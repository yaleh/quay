# Iteration-0 Report — M91 (exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS)

**Date:** 2026-07-22  
**Branch:** exp5-m91-iteration-0  
**Worktree:** milestones/M91/worktrees/iteration-0  
**Milestone class:** methodology/design-class (whole-milestone dual-iteration)

---

## §1 — Work executed

### 1a. OUTER-LOOP.md session-start healthcheck step (Done-when 1)

Added a new `## Session-start healthcheck (QC-T1 native task store liveness probe)` section to
`experiments/quay-perpetual-stream/OUTER-LOOP.md` immediately after the "Pinned references" list
(line 16 → inserted before "Invariants"). The step instructs the operator to:

1. Call `task_get QC-T1` at session start as a native task store liveness probe.
2. If "no such task: QC-T1": call `task_write` to re-create the fixture with the exact canonical
   fields (id, title, status, labels, body), then retry `task_get QC-T1` to confirm.
3. Never silently continue if re-creation also fails — halt and raise `needs-human`.
4. The probe is documented as idempotent: re-running at any session start finds QC-T1 (creating
   it if missing) without side-effects.

The addition is 9 lines (within the 3-8 line guidance; the extra line is the section header).

### 1b. tasks/QC-T1.md fixture task (Done-when 2)

Created `tasks/QC-T1.md` with the exact fields specified in the charter:
- `id: QC-T1`
- `title: healthcheck fixture — native task store liveness probe`
- `status: todo`
- `labels: [fixture, healthcheck]`
- Body: purpose explanation documenting the idempotent re-create pattern

---

## §2 — HARD GATES (literal output)

### Gate 1: directives/pending listing

```
ls: cannot access '/home/yale/work/quay/experiments/quay-continuous-bootstrap/directives/pending/': No such file or directory
```

The `experiments/quay-continuous-bootstrap/directives/pending/` directory does not exist (exp4 is
a closed historical experiment, and the pending/ mechanism was retired when directives became
task-canonical per DIR-028). There are no pending files to disposition.

### Gate 2: manda healthz

```
http://localhost:34303
---
{"root":"/home/yale/work/quay"}
```

manda hub.addr: `http://localhost:34303`; healthz response: `{"root":"/home/yale/work/quay"}` — HEALTHY.

### Gate 3: port-4173 reachability (G7)

**N/A — no Web UI or manda surface change this milestone.** The charter explicitly states: "The
manda healthz gate and port-4173 reachability gate are N/A this milestone (no Web UI or manda
surface change)." 

For completeness, the raw output was: `200` (server is up, but this milestone makes no Web UI
changes and this is not a gate for this milestone).

### Gate 4: worktree creation

```
HEAD is now at a260619 SELECT M91: exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS (QC-T1 healthcheck idempotency)
```

All edits in this iteration target paths under `milestones/M91/worktrees/iteration-0/`.

---

## §3 — Done-when verification

### Done-when 1: OUTER-LOOP.md updated with QC-T1 healthcheck (idempotent re-create)

**Diff:**

```diff
diff --git a/experiments/quay-perpetual-stream/OUTER-LOOP.md b/experiments/quay-perpetual-stream/OUTER-LOOP.md
index 56aa6c2..c4738cf 100644
--- a/experiments/quay-perpetual-stream/OUTER-LOOP.md
+++ b/experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -15,6 +15,15 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
   forward. SELECT (step 1 below) reads the task store directly.
 - **Inherited core (Tier-B methodology):** `experiments/quay-perpetual-stream/inherited-core.md`
 
+## Session-start healthcheck (QC-T1 native task store liveness probe)
+After reading the pinned references, call `task_get QC-T1` to verify the native task store is
+accessible. If the result is "no such task: QC-T1": call `task_write` to re-create the fixture
+with `{id: QC-T1, title: "healthcheck fixture — native task store liveness probe", status: todo,
+labels: [fixture, healthcheck], body: "Permanent liveness probe — never complete. Re-create if
+absent (idempotent)."}`, then retry `task_get QC-T1` to confirm. Never silently continue if the
+re-creation also fails — halt and raise `needs-human`. This probe is idempotent: re-running at any
+session start finds QC-T1 (creating it if missing) without side-effects.
+
 ## Invariants — never violate
```

CONFIRMED: healthcheck step present with idempotent re-create logic and explicit non-silent-failure
instruction.

### Done-when 2: tasks/QC-T1.md exists

```
-rw-rw-r-- 1 yale yale 562 Jul 22 00:38 milestones/M91/worktrees/iteration-0/tasks/QC-T1.md
```

CONFIRMED: fixture file exists.

### Done-when 3: Idempotency documented

CONFIRMED: the OUTER-LOOP.md healthcheck step explicitly states "This probe is idempotent:
re-running at any session start finds QC-T1 (creating it if missing) without side-effects."
The step also requires retry of `task_get QC-T1` after re-creation to confirm existence.
An absent QC-T1 triggers re-creation (via `task_write`), never silent pass.

### Done-when 4: Adversarial audit verdict

PENDING — audit is ABSORB-time per charter.

### Done-when 5: quay gate exit code

PENDING — gate run is ABSORB-time per charter.

---

## §4 — State transition

**s_{n-1}:** OUTER-LOOP.md has no session-start healthcheck step; tasks/QC-T1.md does not exist;
the loop silently swallowed "no such task: QC-T1" 3x in session e0fb1192.

**s_n:** OUTER-LOOP.md has an explicit QC-T1 healthcheck step with idempotent re-create logic and
explicit halt-on-unresolvable instruction; tasks/QC-T1.md exists as a permanent fixture.

**V_instance:** 0.85 (both Done-when items fully landed; Done-when 4/5 are ABSORB-time by charter
design — not a gap in iteration-0's scope)

**V_meta:** 0.85 (methodology/design-class, correct class routing applied; no pipeline skip;
hard gates satisfied; size within ceiling)

---

## §5 — Reflection

**Learned:** The QC-T1 fixture absence was a silent failure mode that was invisible to the loop.
Adding the healthcheck step addresses both the missing documentation AND restores the fixture.
The idempotent re-create pattern is the correct fix: it makes the probe self-healing rather than
requiring a separate repair procedure.

**Challenges:** None significant. This is a small, well-scoped methodology/design-class milestone.

**Next focus:** iteration-1 independently re-derives and re-verifies the OUTER-LOOP.md change and
the fixture file from a fresh worktree.

---

## §6 — Convergence status

- **Thresholds:** V_instance >= 0.80, V_meta >= 0.80 — both met for iteration-0 scope
- **Stability:** System has not changed structurally (this is iteration-0; iteration-1 required)
- **Objectives complete:** Done-when 1/2/3 confirmed; 4/5 are ABSORB-time
- **Status:** CONTINUE to iteration-1 (whole-milestone dual-iteration per methodology/design-class routing)

---

## §7 — Artifacts

- `milestones/M91/worktrees/iteration-0/experiments/quay-perpetual-stream/OUTER-LOOP.md` — healthcheck step added
- `milestones/M91/worktrees/iteration-0/tasks/QC-T1.md` — fixture created
- `milestones/M91/worktrees/iteration-0/milestones/M91/iteration-0.md` — this report
