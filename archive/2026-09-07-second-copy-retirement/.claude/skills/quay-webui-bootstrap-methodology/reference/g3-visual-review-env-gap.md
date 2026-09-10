# G3 + Visual Review ENV Gap — Shared Root Cause

Source: `experiments/quay-webui-bootstrap/` experiment 3, confirmed across
both G3 audit dispatch and §0c visual review dispatch. Extends
`experiments/quay-core-bootstrap/`'s G3-dispatch finding
(`quay-core-bootstrap-methodology/reference/g3-audit-dispatch-drift-case-study.md`)
to cover a second dispatch type that shares the same root cause.

---

## The ENV gap

Both G3 out-of-band audits and §0c independent holistic visual reviews
require the same thing: a fresh-context agent dispatched by the orchestrator,
independent of the session that made the change being reviewed.

Neither was achievable in experiments 2 or 3. The shared root cause:

**The executor session does not have an unconditional native Agent/Task
dispatch path.** The ENV provides:
- `mcp__plugin_manda_manda__Agent` — conditional (requires daemon +
  non-self broker); denied by the cap-request monitor pattern for G3
  dispatch specifically
- No unconditional native Task/Agent tool that guarantees fresh-context
  subagent dispatch regardless of ENV state

When an executor attempts manda dispatch for G3 or visual review, the
monitor can deny it. The executor then falls back to inline self-audit in
the same session. This produces reviews that are degraded in independence,
not the mechanically-verified fresh-context audits the protocols require.

---

## Two manifestations, one cause

**G3 audit dispatch drift** (documented in experiment 2):
- Protocol says: orchestrator dispatches G3 audit via native Agent/Task tool
- What happened: executor attempted manda dispatch → monitor denied → fell
  back to inline self-audit
- Corrected by DIR-003 (experiment 2) and DIR-005 (experiment 3) — but
  the correction was behavioral, not structural; the ENV gap persists

**§0c visual review dispatch gap** (new in experiment 3):
- Protocol says: orchestrator dispatches visual review via native Agent/Task
  tool, run_in_background=true, fresh context
- What happened: same session that made the visual change also conducted the
  visual review
- No DIR filed for visual review specifically because the root cause is
  identical to G3's — one ENV fix would resolve both

In experiment 3, neither G3 nor visual review ever achieved true
fresh-context dispatch in any iteration (iterations 1-4). All reviews were
conducted as rigorously as possible within the degraded-fallback constraint.
No CONCERNS or FAIL verdicts arose from this gap, but the independence
guarantee is absent.

---

## The cap-request monitor denial pattern

Symptom: an executor subagent attempts manda dispatch for G3 or visual
review → the monitor's cap-request mechanism denies it → the executor falls
back to inline self-audit.

This is a symptom of the ENV gap, not a new finding. The monitor denial
prevents the wrong path (manda) but does not provide the right path
(unconditional native dispatch). The result is the worst-case outcome:
neither the correct mechanism nor a clean failure — instead, a silently
degraded inline review.

Do not mistake "monitor denied the manda G3 dispatch" as evidence that the
orchestrator-level dispatch succeeded. It did not. The executor fell back
to self-audit.

---

## Correct mechanism (if ENV supports it)

```
Orchestrator session (main, not executor):
  dispatch(
    agent: fresh-context reviewer,
    via: native Agent/Task tool,           # NOT manda
    run_in_background: true,
    context: independent (no access to changes being reviewed)
  )
  → writes verdict to audits/iteration-{N}-{adjudicate|visual-review}-*.md
  → orchestrator reads verdict, decides whether to credit V-factor lift
```

The executor subagent CANNOT dispatch its own G3 audit or visual review
correctly, because:
1. manda may be denied by the monitor for G3 specifically
2. even if manda succeeds, the executor dispatching its own audit is not
   "independent orchestrator dispatch" — it is the executor hiring its own
   reviewer
3. inline self-audit (fallback) is the same session as the change maker —
   zero independence

---

## Correct orchestration prompt pattern

For experiment 4 or any future experiment using this methodology, the
iteration prompt MUST explicitly assign both dispatches to the orchestrator,
not the executor. Template:

```
ORCHESTRATOR RESPONSIBILITIES (not delegated to the iteration executor):
1. After iteration executor completes, dispatch G3 audit:
   - Tool: native Agent/Task (not manda)
   - run_in_background: true
   - Fresh context: no knowledge of this iteration's specific changes
   - Output: experiments/quay-webui-bootstrap/audits/iteration-{N}-adjudicate.md

2. After iteration executor completes AND Lighthouse passes, dispatch
   visual review:
   - Tool: native Agent/Task (not manda)
   - run_in_background: true
   - Fresh context: no knowledge of this iteration's specific changes
   - Output: experiments/quay-webui-bootstrap/audits/iteration-{N}-visual-review-{page}-{viewport}.md

EXECUTOR RESPONSIBILITIES:
- Make the change
- Run tests
- Record timing data (effectiveness re-trigger candidates)
- Signal completion to orchestrator
- Do NOT dispatch G3 or visual review — those are orchestrator tasks
```

This structure moves both dispatch responsibilities to the level that
actually has the native Agent/Task tool (the orchestrator session), rather
than trying to route them through the executor.

---

## Degraded-fallback record (experiment 3)

All iterations where G3 or visual review ran in degraded-fallback mode:

| Iteration | G3 mode | Visual review mode |
|-----------|---------|--------------------|
| 1 | degraded-fallback (same session) | degraded-fallback (same session) |
| 2 | degraded-fallback (same session) | degraded-fallback (same session) |
| 3 | degraded-fallback (same session; DIR-005 filed) | degraded-fallback (same session) |
| 4 | degraded-fallback (same session) | degraded-fallback (same session) |

Independent audit files (iterations 3-4) were written by the same session
that conducted the work. The word "independent" in those filenames reflects
the intent of the §0c protocol, not the achieved independence level.

No incorrect verdicts resulted from the degraded-fallback mode in experiment
3 (all G3 verdicts were PASS; all visual review verdicts were PASS). But
this is not evidence the degraded-fallback is equivalent — it means the
experiment happened to be clean enough that the reduced independence did not
produce a false positive.

---

## How to detect the gap in a new experiment

If an experiment claims "G3 audit dispatched by orchestrator via native
Agent/Task tool," verify:
1. There exists a tool call in the orchestrator session's transcript of the
   form `Task(...)` or `Agent(...)` with `run_in_background=true`
2. The dispatched agent's context does NOT include the iteration executor's
   session or the changes made in that session
3. The audit file was written by a session that completed after the executor
   session, not within it

If these cannot be verified, the dispatch was degraded-fallback, not fresh-
context independent dispatch. Record it honestly — do not label
degraded-fallback as "independent."

---

## Cross-references

- `quay-core-bootstrap-methodology/reference/g3-audit-dispatch-drift-case-study.md`
  — the experiment 2 case study for G3 dispatch specifically; read before
  writing any G3 dispatch step into a new iteration prompt
- `experiments/quay-webui-bootstrap/directives/archive/DIR-005.md` —
  experiment 3's specific G3 drift directive (filed iteration 4; corrected
  executor-attempted manda dispatch pattern)
- `experiments/quay-webui-bootstrap/ITERATION-PROMPTS.md` §0b, §0c —
  the protocol text for G3 exclusion and visual review dispatch
