# Provenance log — quay-native bootstrap experiment

Per protocol §6 G1 and decision §10.1 (σ granularity — per task): one record
per native task, `{author_by, execute_by, gate_by} ∈ {seed, native}`. σ is
computed from this file, never asserted.

At iteration 0, **every** task is `{seed, seed, seed}` by definition (protocol
§9): no `quay:*` Skill exists yet, so nothing can be `native`. This is the
σ = 0 floor.

## Records (as of end of iteration 2)

| task_id | title | author_by | execute_by | gate_by | status (end of iter 2) |
|---|---|---|---|---|---|
| QN-001 | Wire task_write into quay-native CLI/MCP with full frontmatter patch semantics | **native*** | **native**† | **native*** | **done** |
| QN-002 | Build the GitHub Provider (second real backend, proves ABI) | seed | — | — | todo (out of scope, stage 2+) |
| QN-003 | Port quay:author orchestration Skill (retire authoring seed dependency) | **native*** | **native**‡ | **native*** | **done** |
| QN-004 | Port quay:execute orchestration Skill (retire execution seed dependency) | **native*** | **native**‡ | **native*** | **done** |
| QN-005 | Deepen task_check gate correctness beyond presence/checkbox heuristics | **native*** | **native**† | **native*** | **done** |
| QN-006 | Add file locking shared by CLI and MCP writers (design §6) | seed | seed | seed | done |

`†` = QN-001 and QN-005: real, new implementation work (code changes) was
performed this iteration, following `quay:execute`'s documented Method steps
(`implement-phase` → `self-audit-ac` → `gate-check`, per its SKILL.md as
revised in QN-004) — see "Iteration 2 execute_by honesty note" below for the
full reasoning, including the same degraded-mode (no subagent-dispatch
primitive) caveat already applied to `author_by` in iteration 1.

`‡` = QN-003 and QN-004: see "QN-003/QN-004 execute_by nuance" below — this
is a distinct, weaker case than `†` and is not glossed over. Read that
section before citing these as ordinary examples of native execution.

### Iteration 2 execute_by honesty note

For QN-001 and QN-005, `quay:execute`'s method was actually followed this
iteration against real, previously-unimplemented Plan work:

- QN-005: the `\Z`-as-literal-bug in `store.js#extractSection` was fixed,
  `MIN_SECTION_CHARS` and the AC-checkbox-presence requirement were added to
  `check()`, and `test/gate-correctness.test.mjs` (5 cases, 13 assertions)
  was written and passed (exit 0) — all Plan phases 1-3 completed, all AC/DoD
  boxes independently re-verified against actual command output before being
  checked (not "should work" reasoning).
- QN-001: `--body`, `--children`, `--extra` flags were wired into `bin/
  quay-native.js`'s `edit` subcommand, and `test/abi-symmetry.mjs` was
  extended with a genuine value-level (not just key-set) CLI/MCP equivalence
  check — all Plan phases 1-3 completed, all AC/DoD boxes independently
  re-verified.

Both were driven `ready → done` via direct `quay-native task check` +
`task edit --status done` invocations, following the implement/self-audit/
gate-check sequence `quay:execute`'s SKILL.md documents, in the same
same-session **degraded fallback** mode `quay:author` used in iteration 1 (no
subagent-dispatch primitive exists in this environment — reconfirmed, not
re-assumed, this iteration; see `experiment/audits/iteration-2-adjudicate.md`
Step 1). Exactly as iteration 1 reasoned for `author_by`, the degraded-mode/
no-fresh-context caveat is a note on **quality of independence**, not a
reclassification of **who did the work** — the work was genuinely driven by
`quay:execute`'s documented method, not the seed silently doing it and
mislabeling it. `execute_by = native` is therefore the honest label for
QN-001 and QN-005, with the same caveat iteration 1 already established for
`author_by`. `gate_by = native` follows for the same reason `gate_by = native`
was recorded for these tasks' `author→ready` transition in iteration 1: this
iteration, `quay:execute`'s own method (not the seed acting outside the
Skill) is what invoked `task check` and acted on its result for the
`ready→done` transition — see `experiment/timing/iteration-2.log`.

### QN-003/QN-004 execute_by nuance (read before counting these in σ)

QN-003 and QN-004 are unusual: they are tasks **about** `quay:author` and
`quay:execute` themselves, and their described Plan work (rewriting the
respective SKILL.md files' Method sections into named steps with dispatch/
degraded-mode statements) was **already fully completed during iteration 1's
authoring pass** — iteration 1 wrote the actual target content while
authoring these tasks toward `ready` (an intentional shortcut noted at the
time: the Proposal/Plan for "rewrite the SKILL.md" and the act of rewriting
it were done together, since both are the same SKILL.md-content-only change).

This iteration, "executing" QN-003/QN-004 meant: re-reading the actual current
`skills/author/SKILL.md` and `skills/execute/SKILL.md` content fresh, matching
it verbatim against each AC item's specific claim (e.g. "names `write-
proposal`, `review-proposal`, `write-plan`, `review-plan` as four distinct
steps, each with a stated dispatch-capable-environment behavior and a stated
degraded-mode fallback" — confirmed present, not assumed), and only then
checking the boxes and flipping status. **No new code or content was written
this iteration for QN-003/QN-004** — Plan Phase 3 for both explicitly states
"no code change... verified by re-reading the file," so there was no new
`implement-phase` work to perform; what `quay:execute`'s method contributed
this iteration was the `self-audit-ac` and `gate-check` steps only.

**Decision:** `execute_by = native` is still recorded, honestly, because the
question `execute_by` answers is "was the `ready→done` transition driven by
`quay:execute`'s method, or by the seed acting outside it?" — and the answer
is genuinely the former (self-audit-ac and gate-check were both actually
performed, following the documented method, this iteration). It is **not**
being claimed that new implementation work happened under `quay:execute`'s
direction for these two tasks — there wasn't any left to do. This is flagged
explicitly, rather than silently folded into the same bucket as QN-001/
QN-005's genuine new-code executions, so that a reader computing σ or judging
"how much real execute-side work happened" is not misled into thinking four
tasks' worth of equally-weighted new implementation occurred. If a stricter
convention is preferred (only count `execute_by = native` when new Plan-
described implementation work occurred), QN-003/QN-004 would be excluded and
σ would drop from 4/6 to 2/6 — both readings are reported below so neither is
silently privileged.

`*` = see "Iteration 1 author_by honesty note" below — `native` here means
"driven by `quay:author`'s documented method, dispatched for real against
this task," NOT "achieved with the fresh-context reviewer independence design
§5 calls for." This nuance is the central honesty question of this
iteration's provenance and is not swept under a plain "native" label without
explanation.

### Iteration 1 author_by honesty note (read before trusting the table above)

`quay:author`'s SKILL.md (as revised this iteration) was actually invoked,
step by step, against QN-001, QN-003, QN-004, and QN-005: `task get` →
write Proposal → write Plan → write AC/DoD → review pass → `task check` →
`task edit --status ready`. This is real dispatch of a real Skill's documented
method against real tasks — not the seed silently doing the work and
mislabeling it. That is why `author_by = native` is recorded, not `seed`.

**However**, this environment has **no subagent-dispatch primitive**
(confirmed via explicit `ToolSearch` checks — see `skills/author/SKILL.md`'s
Gaps section and `experiment/audits/iteration-1-adjudicate.md` Step 0). Design
§5 calls for each Layer-1 step (`write-proposal`, `review-proposal`,
`write-plan`, `review-plan`) to run in its **own fresh-context subagent**, for
genuine review independence. That could not happen — all four steps ran
sequentially in one session, with a same-session checklist substituting for
independent review. `quay:author`'s own SKILL.md calls this the "degraded
fallback" and states explicitly that it is real but not equivalent to true
independence.

**Decision (per G1, do not inflate σ):** `author_by = native` is still the
honest label here, because the question `author_by` answers is "was this
task driven to `ready` by `quay:author`'s method, or by the seed doing the
work directly and calling it done?" — and the answer is genuinely the former
(the Skill's documented steps executed for real, in order, against real
task content). The **degraded-mode/no-fresh-context caveat is a note on
**quality of independence**, not a reclassification of **who did the work**.
Conflating these two questions would either (a) wrongly zero out real,
evidenced Skill dispatch as if it never happened, or (b) wrongly claim full
design-§5 fidelity that was not achieved. Both are avoided by: labeling
`author_by = native`, and recording the fresh-context gap explicitly in the
Skill files, the audit, and this note. `gate_by = native` follows the same
reasoning as QN-006's `gate_by = seed` analysis below inverted: this
iteration, `quay:author`'s own method (not the seed acting outside the
Skill) is what invoked `task check` and acted on its result for each of the
four tasks — see each task's own dispatch trace in
`experiment/timing/iteration-1.log`.

`execute_by` remains `—` (not yet attempted) for QN-001/QN-003/QN-004/QN-005
— none were driven `ready → done` this iteration; execution stays entirely
seed-driven this iteration, per the fixed per-Skill retirement order
(protocol §10.2, decision 2: `quay:author` retires first). QN-004 authored
the *plan* to eventually retire `quay:execute`'s seed dependency — it did not
retire it. `quay:execute` itself was not dispatched even once this iteration.

Notes:

- QN-001..QN-005 were **created** (backlog-seeded) but not authored past
  `todo` in this iteration — they have no proposal/plan/AC/DoD body yet, so
  `author_by`/`execute_by`/`gate_by` are `—` (not yet attempted), not `seed`
  or `native`. Do not read `—` as `seed` — it means "not yet driven this
  iteration," which is the honest state.
- QN-006 is the one task driven through the **full v0 loop**: authored (seed,
  this session, writing Proposal/Plan/AC/DoD directly — no `quay:author`
  exists), gated `todo→ready` by `quay-native task check` (a real
  quay-native feature, but invoked directly rather than via a Skill — the
  *gate mechanism* is native code, the *decision to invoke it and act on it*
  was the seed/human-equivalent operator), executed (seed: this session
  implemented Phase 1-3 of the plan directly — no `quay:execute` exists),
  and gated `ready→done` by `quay-native task check` again, then co-signed by
  a mechanical adjudicate-style audit (`experiment/audits/iteration-0-adjudicate.md`)
  — with an honestly recorded limitation (not a genuinely separate dispatched
  subagent; see that file's "Limitation" section).
- **`gate_by` nuance:** the *gate mechanism itself* (`quay-native task check`)
  is native code (it is quay-native's own feature, part of what this
  iteration built). But per protocol §10.1's per-task provenance intent, the
  `gate_by` field records **who drove the gating decision and acted on its
  result** in the workflow (i.e., who decided "the gate passed, now flip
  status"), not merely "was a native binary invoked somewhere in the
  process." Since the seed (this session) was the sole decision-maker
  invoking `task check` and interpreting/acting on its result — no
  `quay:author`/`quay:execute` Skill orchestrated this — `gate_by = seed`
  for QN-006. This is the conservative, honest reading; a more generous
  reading ("the gate tool is native, so gate_by=native") is explicitly
  rejected here as inflation (G1) — see iteration-0.md §7 Gap Analysis for
  the discussion.

## σ computation

**Iteration 0:**
```
σ = (# tasks with author_by = execute_by = gate_by = native) / (total tasks)
  = 0 / 6
  = 0
```
This was the σ = 0 floor, as expected and required for iteration 0 (protocol
§9).

**Iteration 1:**

σ, per protocol §10.1, requires **all three** of `author_by`, `execute_by`,
`gate_by` to be `native` for a task to count. Applying this strictly:

- QN-001: author_by=native, execute_by=**—** (not attempted) → does not
  qualify (execute_by is not `native`).
- QN-003: author_by=native, execute_by=**—** → does not qualify.
- QN-004: author_by=native, execute_by=**—** → does not qualify.
- QN-005: author_by=native, execute_by=**—** → does not qualify.
- QN-002: untouched this iteration (out of scope) → does not qualify.
- QN-006: seed/seed/seed → does not qualify.

```
σ = (# tasks with author_by = execute_by = gate_by = native) / (total tasks)
  = 0 / 6
  = 0
```

**σ is still 0 by the strict full-lifecycle definition**, because no task has
completed the *entire* `todo→ready→done` loop under native Skills yet (only
the authoring half). This is the honest, non-inflated number. A secondary,
clearly-labeled **partial/authoring-only indicator** is reported alongside it
for transparency, since it is real progress that the strict σ formula (by
design) does not yet reward:

```
σ_author_only = (# tasks with author_by = native) / (total tasks)
              = 4 / 6   (QN-001, QN-003, QN-004, QN-005)
              = 0.667
```

`σ_author_only` is **not** a substitute for σ and must never be reported as
"σ = 0.667" — protocol §10.1's σ is defined over the full three-field tuple,
and reporting a partial number under the same name would be exactly the kind
of metric inflation G1/G2 exist to prevent. It is reported here, separately
and explicitly labeled, purely as diagnostic evidence of forward progress on
one axis (authoring) while the overall fixpoint metric (σ) correctly remains
at its honest value of 0 until execution and gating close the loop on at
least one task under native Skills end-to-end.

**Iteration 2:**

Applying protocol §10.1's strict definition (all three of `author_by`,
`execute_by`, `gate_by` must be `native`) to the table above:

- QN-001: native/native/native → **qualifies**.
- QN-005: native/native/native → **qualifies**.
- QN-003: native/native/native → qualifies under the inclusive reading (see
  nuance note above), but its `execute_by=native` reflects gate-check-only
  work, not new implementation.
- QN-004: native/native/native → qualifies under the inclusive reading, same
  caveat as QN-003.
- QN-002: untouched (out of scope, G2) → does not qualify.
- QN-006: seed/seed/seed → does not qualify.

```
σ (inclusive reading — execute_by counts gate-check-only re-verification of
   already-authored content, as well as new implementation)
  = (# tasks with author_by = execute_by = gate_by = native) / (total tasks)
  = 4 / 6
  = 0.667

σ (strict reading — execute_by counts ONLY when new Plan-described
   implementation work was actually performed this iteration)
  = 2 / 6   (QN-001, QN-005 only; QN-003/QN-004 excluded per the nuance note)
  = 0.333
```

**Both numbers are reported, neither is privileged as "the" σ, per G1.** The
strict reading (0.333) is the more conservative and arguably more faithful
to protocol §10.1's intent ("driven to done by native Skills," which most
naturally reads as implying real work was done, not merely re-confirmed);
the inclusive reading (0.667) is defensible because `quay:execute`'s method
genuinely was the mechanism that performed the `ready→done` transition for
all four tasks, including the self-audit and gate-check steps, and nothing
in protocol §10.1's wording explicitly requires "new code" as a precondition
for `execute_by=native`. This report recommends treating **σ = 0.333 (strict)**
as the headline number for external comparison, since it is the reading least
susceptible to accusations of inflation, and citing 0.667 only as a clearly
labeled upper-bound alternative.

Diagnostic sub-metric, retained from iteration 1 for continuity:

```
σ_author_only = (# tasks with author_by = native) / (total tasks)
              = 4 / 6   (QN-001, QN-003, QN-004, QN-005 — unchanged from
                iteration 1, since no new task was authored this iteration)
              = 0.667
```

This confirms iteration 2's work was concentrated on the execute/gate axis
(moving 4 tasks from `ready` to `done`), not on new authoring — consistent
with this iteration's stated objective (retire `quay:execute`'s seed
dependency), and leaves `σ_author_only` unchanged from iteration 1 as
expected.

See `experiment/timing/iteration-2.log` for this iteration's raw `date -u`
checkpoints: start/preconditions (05:01:45Z) → QN-005 execute→done (05:03:58Z,
~2m13s) → QN-001 execute→done (05:05:45Z, ~1m47s) → QN-003 and QN-004
gate-checked to done (same minute, ~0s additional — no new implementation,
consistent with the nuance note above). Total execute-phase environment
clock for this iteration: **~4m of environment clock to drive four tasks
ready→done**, dominated by QN-005's real code fix (the `\Z` bug) and new
test file.

## Baseline timing / effort data (protocol §5.2, decision §10.5 — the future
effectiveness comparator)

See `experiment/timing/iteration-0.log` for the raw log with `date -u`
timestamps captured at each checkpoint via actual shell commands (not
estimated after the fact). **Honesty note on what this number means:** the
timestamps below are real `date -u` outputs from the sandboxed execution
environment's system clock, captured at sub-step boundaries as the work
happened. They measure **environment wall-clock**, which is the only
objective, reproducible signal available in this setup — not necessarily a
1:1 proxy for total agent "thinking" effort (an LLM agent's reasoning latency
is not fully reflected in shell-command timestamps alone). This caveat is
recorded honestly rather than inflating precision the measurement doesn't
have.

| checkpoint (from `experiment/timing/iteration-0.log`) | environment-clock delta from previous checkpoint |
|---|---|
| start → root package.json/workspace scaffold | ~18s |
| → quay-native core+CLI+MCP done and smoke-tested | ~4m56s |
| → quay Core CLI + serve done and smoke-tested | ~2m6s |
| → QN-006 authored (seed), gated todo→ready | ~51s |
| → trigger delivered via manda (channel task-QN-006) | ~24s |
| → QN-006 executed (seed), gated ready→done, audit written | ~2m59s |
| → quay:author / quay:execute Skill files written | ~2m3s |
| → full v0 loop re-verified via Web UI + `--port` bug fixed | ~1m55s |
| **Total, spec-reads-complete → build+one-task-done** | **~15m32s of environment clock** |

Additionally, reading the 5 spec documents in full (glossary, proposal,
native-design, bootstrap-experiment protocol, README+ITERATION-PROMPTS) and
the G6 precondition check preceded the timing log's start and are not
included in the table above (no `date -u` checkpoints were taken during that
read-only phase — a gap in this iteration's own timing discipline, noted
honestly as a process improvement for iteration 1: start the timing log
*before* the first spec read, not after).

**What iteration N should compare against:** the environment-clock deltas
above are the only rigorously-timestamped comparator this iteration produced.
Iteration N's `effectiveness` component (protocol §5.2) should cite these
per-checkpoint deltas for the *closest analogous sub-step* (e.g. "authoring
one task's Proposal/Plan/AC/DoD took ~51s of environment clock at seed pace in
iteration 0 for a small, well-scoped task like QN-006") rather than a single
undifferentiated "3.5 hours" figure — that number was an earlier draft
overestimate in this file, produced before the raw log was reconciled, and is
corrected here rather than left standing (G1-style honesty: don't let an
inflated or miscalculated number survive once the real evidence is in hand).

**Manual/human interventions during the loop:** 0 required stops for missing
tooling; 1 self-correction during execution (the initial `appendNote`
implementation called `write()` internally, which — after locking was added
to `write()` — was rewritten to avoid a nested/redundant lock acquisition
pattern; caught while writing the concurrency test, not by an external
reviewer); 1 bug found and fixed during the final end-to-end re-verification
(`quay serve` was not forwarding `--port` from argv, defaulting silently to
4173 — found by actually re-running the full loop, not by static review,
which is itself evidence for why "run it, don't just describe it" mattered
in this iteration). This is the only rounds-to-convergence data point
available at this thin an iteration; no `quay:author`/`quay:execute` Skill
iteration-count data exists yet since neither Skill has driven a task
(honest N/A).

**Manual/human interventions during the loop:** 0 required stops for missing
tooling; 1 self-correction during execution (the initial `appendNote`
implementation called `write()` internally, which — after locking was added
to `write()` — was rewritten to avoid a redundant read-then-write pattern
outside the lock; caught by writing the concurrency test itself, not by an
external reviewer). This "1 self-correction" is the only rounds-to-convergence
data point available at this thin an iteration; no `quay:author`/`quay:execute`
Skill iteration-count data exists yet since neither Skill exists (honest N/A).

## Records (as of end of iteration 3)

**Pre-execution context:** this iteration's Priority 1 was triggered directly
by `experiment/audits/iteration-2-independent-adjudicate.md`'s finding: MCP's
`task_write` `inputSchema` never declared `extra`, so the zod-based MCP SDK
silently stripped it before `store.write()` ever saw it (live-verified by the
independent auditor: patching `extra:{"foo":"bar"}` via MCP returned `{}`).
This is the mirror image of QN-001's original CLI-side bug (iteration 2).

| task_id | title | author_by | execute_by | gate_by | status (end of iter 3) |
|---|---|---|---|---|---|
| QN-001 | Wire task_write into quay-native CLI/MCP with full frontmatter patch semantics | native* | native† | native* | done |
| QN-002 | Build the GitHub Provider (second real backend, proves ABI) | **native**§ | **—** | **native**§ | **ready** |
| QN-003 | Port quay:author orchestration Skill (retire authoring seed dependency) | native* | native‡ | native* | done |
| QN-004 | Port quay:execute orchestration Skill (retire execution seed dependency) | native* | native‡ | native* | done |
| QN-005 | Deepen task_check gate correctness beyond presence/checkbox heuristics | native* | native† | native* | done |
| QN-006 | Add file locking shared by CLI and MCP writers (design §6) | seed | seed | seed | done |
| QN-007 | Fix MCP task_write silently dropping the extra field; strengthen ABI symmetry test | **native**¶ | **native**¶ | **native**¶ | **done** |

Rows QN-001/003/004/005/006 are unchanged from the end of iteration 2 (see
above); reproduced here for a single up-to-date table. QN-002 and QN-007 are
this iteration's new/changed records.

`¶` = QN-007: driven through the **entire** `todo→ready→done` loop this
iteration, via `quay:author` then `quay:execute`, in the same same-session
degraded-fallback mode already established for QN-001/003/004/005 (no
subagent-dispatch primitive exists in this environment — reconfirmed via
`ToolSearch` at the start of this iteration, not re-assumed). Concretely:
`task create` (seed-driven CLI convenience, not part of the ABI or a Skill
step per design §1) → `quay:author`'s method (write Proposal/Plan/AC/DoD,
same-session review pass, `task check`, `task edit --status ready`) →
`quay:execute`'s method (`implement-phase`: edited `mcp-server.js`'s
`task_write` inputSchema to add `extra: z.record(z.any()).optional()`, and
extended/added blocks 3b/3c in `test/abi-symmetry.mjs`; `self-audit-ac`: each
AC/DoD box independently re-verified — live MCP repro before/after the fix,
and an adversarial re-break-then-restore of the fix to prove the strengthened
test has teeth (exit 1 with "MISMATCH FOUND" when broken, exit 0 "ALL FOUR
SURFACES SYMMETRIC" when fixed) — before checking any box; `gate-check`:
`task check` → `task edit --status done`). This is the **cleanest
end-to-end native-Skill-driven task yet**: unlike QN-003/QN-004 (execute_by
was gate-check-only re-verification, see nuance note above), QN-007's
execute phase involved genuine new implementation work (a real one-line
schema fix plus new/extended test code), analogous to QN-001/QN-005's
iteration-2 execute_by, but additionally being the **first task whose
entire lifecycle (author AND execute) happened within a single iteration**
under native Skills. One honesty gap: DoD item 2 ("git diff shows only the
inputSchema addition") could not be verified via literal `git diff`, because
`packages/`, `tasks/`, and `experiment/` are all untracked in this repo (no
git baseline exists to diff against — confirmed via `git status --short`
showing `??` for all these paths). This was recorded honestly rather than
fabricating a diff: the claim was instead verified via the Edit tool's own
change record (only the one `extra` field was added to the schema) and a
grep confirming `store.js` was untouched.

`§` = QN-002: authored this iteration (`quay:author`'s method: write
Proposal/Plan/AC/DoD, same-session review, `task check` → `gate: author->ready,
ok:true`, `task edit --status ready`), in the same degraded-fallback mode as
above. **Execution/implementation was deliberately NOT performed**, per this
iteration's explicit scope (G2, G5, and the explicit instruction not to touch
`gh` or make real GitHub API calls this iteration). `execute_by = —` (not
attempted, not `seed` and not `native` — the honest "not yet" label used
throughout this provenance log). `gate_by = native` records that
`quay:author`'s own method (not the seed acting outside the Skill) is what
invoked `task check` and acted on its result for the `todo→ready` transition
— the SAME single gate transition this task has undergone; there has been no
`ready→done` gating decision to record yet. QN-002's own AC/DoD checkboxes
remain **unchecked** (0/4), correctly — DoD item 3 explicitly requires the
task be left at `ready`, not `done`, this iteration, and no `gh` command or
real GitHub API call was run at any point while authoring it (verified against
this iteration's own command log — see `experiment/timing/iteration-3.log`).
QN-002's scope for v1 was deliberately narrowed during authoring to
**read-only minimal** (`data.read` + `manifest` only; `data.write`/`gate`/
`skill` explicitly deferred), per G5 and proposal §14's sequencing — see the
task file itself (`tasks/QN-002.md`) for the full Proposal/Plan (5 phases,
only Phase 2's mapping-rules-as-prose is an authoring-time deliverable; all
others are explicitly deferred to a future execution-phase iteration).

## σ computation — iteration 3

Applying protocol §10.1's strict definition (all three of `author_by`,
`execute_by`, `gate_by` must be `native`) to the updated table above:

- QN-001: native/native/native → qualifies.
- QN-005: native/native/native → qualifies.
- QN-007: native/native/native → **qualifies (new this iteration)**.
- QN-003: native/native/native → qualifies under the inclusive reading only
  (gate-check-only execute_by, per the nuance note above).
- QN-004: native/native/native → qualifies under the inclusive reading only.
- QN-002: native/**—**/native → does **not** qualify (execute_by not native —
  correctly, since it was not executed this iteration, per G2/explicit scope).
- QN-006: seed/seed/seed → does not qualify.

```
σ (strict reading — execute_by counts ONLY when new Plan-described
   implementation work was actually performed)
  = (# tasks with author_by = execute_by = gate_by = native, execute_by
     backed by real new implementation) / (total tasks)
  = 3 / 7   (QN-001, QN-005, QN-007)
  = 0.429

σ (inclusive reading — execute_by also counts gate-check-only
   re-verification of already-authored content)
  = 5 / 7   (adds QN-003, QN-004)
  = 0.714
```

Total task count is now **7** (QN-001..QN-007), up from 6, because QN-002 —
previously "out of scope" and excluded from the denominator's active
consideration — is now a live, in-progress task (authored, at `ready`) and
must be counted in the denominator like any other tracked task, even though
it does not qualify for the numerator yet. This is the honest, non-inflating
way to fold it in: it enters the count as soon as it is a real task under
consideration, but only helps σ once it clears all three fields.

**σ = 0.429 (strict) is the headline number**, up from 0.333 at the end of
iteration 2 (ΔσE = +0.096), driven entirely by QN-007 completing a full
native-Skill-driven lifecycle in a single iteration. 0.714 is reported as the
inclusive upper-bound alternative, per the same non-privileging convention
established in iteration 2.

Diagnostic sub-metric:

```
σ_author_only = (# tasks with author_by = native) / (total tasks)
              = 6 / 7   (QN-001, QN-002, QN-003, QN-004, QN-005, QN-007 —
                QN-002 newly added this iteration)
              = 0.857
```

Up from 0.667 at the end of iteration 2, reflecting QN-002's authoring this
iteration in addition to QN-007's. **This diagnostic explicitly does NOT
mean σ=0.857** — QN-002 is deliberately excluded from full σ until it is
actually executed (G2: do not score reusability/effectiveness on an
authored-but-unexecuted transfer target). Restated for emphasis, per this
iteration's explicit guardrail: reusability transfer to the GitHub Provider
remains **N/A this iteration**, not partially-credited, because authoring is
not running.

See `experiment/timing/iteration-3.log` for this iteration's raw `date -u`
checkpoints.

## Records (as of end of iteration 4)

**Pre-execution context:** this iteration's mandate was to drive QN-002 from
`ready` to `done` per its own authored minimal v1 scope (read-only:
`data.read` + `manifest` only), with explicit human authorization to publish
the repository to GitHub and make real `gh`/API calls this iteration (quoted
in the iteration-4 task spec). Stage-2 preconditions (`gh auth status`,
repo published with real issues) — named in QN-002's own Plan Phase 0 as an
execution-time gate — were confirmed satisfied before any GitHub Provider
code made a live API call: `gh auth status` showed user `yaleh` with
`repo`+`workflow` scopes; the repository was published as
https://github.com/yaleh/quay (private); 4 real issues (#1-#4) were created
with a `status:*`/`lane:*` label convention designed at execution time (a
legitimate refinement per "extract, don't design in the abstract" — GitHub's
lack of a native status field is exactly the LCD problem proposal §2.2/§16
anticipated, and resolving it concretely, not just naming it as a gap, was
in scope for execution).

| task_id | title | author_by | execute_by | gate_by | status (end of iter 4) |
|---|---|---|---|---|---|
| QN-001 | Wire task_write into quay-native CLI/MCP with full frontmatter patch semantics | native* | native† | native* | done |
| QN-002 | Build the GitHub Provider (second real backend, proves ABI) | native§ | **native**# | **native**# | **done** |
| QN-003 | Port quay:author orchestration Skill (retire authoring seed dependency) | native* | native‡ | native* | done |
| QN-004 | Port quay:execute orchestration Skill (retire execution seed dependency) | native* | native‡ | native* | done |
| QN-005 | Deepen task_check gate correctness beyond presence/checkbox heuristics | native* | native† | native* | done |
| QN-006 | Add file locking shared by CLI and MCP writers (design §6) | seed | seed | seed | done |
| QN-007 | Fix MCP task_write silently dropping the extra field; strengthen ABI symmetry test | native¶ | native¶ | native¶ | done |

Rows QN-001/003/004/005/006/007 are unchanged from the end of iteration 3;
reproduced here for a single up-to-date table. QN-002 is this iteration's
only changed record.

`#` = QN-002: driven `ready → done` this iteration via `quay:execute`'s
documented Method (`implement-phase` → `self-audit-ac` → `gate-check`), in
the same same-session **degraded-fallback** mode already established for
QN-001/QN-005/QN-007 (no subagent-dispatch primitive exists in this
environment — reconfirmed via `ToolSearch` at the start of this iteration,
not re-assumed). Concretely: `implement-phase` covered real, new
implementation work exactly matching the task's own authored Plan Phases
1-4 — `packages/quay-github/` was built out with real `github-client.js`
(thin `gh api` subprocess wrapper), `mcp-server.js` (registers
`provider://manifest`, `task_list`, `task_get` — no `task_write`/
`task_check`, matching the v1 read-only scope), `bin/quay-github.js`
(CLI entry), `provider.yml` (capabilities: `data.read: true, manifest:
true, data.write: false, gate: false, skill: false`), and `DESIGN.md`
(documents the Issue→view-model mapping, resolving the `status:*`/`lane:*`
label convention and the `gh-<number>` id scheme this iteration, both
explicitly left as open questions at authoring time). `self-audit-ac`:
each execution-phase AC/DoD box was independently re-verified against live
command output before being checked — `gh api` JSON confirmed real issues
returned with correctly derived status; a standalone MCP smoke test
confirmed `task_list`/`task_get`/`provider://manifest` all respond
correctly; and, critically, `quay` Core's CLI (`packages/quay/bin/
quay.js`) was pointed at the GitHub Provider via a new `--provider <id>`
flag and shown to produce `task list`/`task view --json` output in the
same shape as against native — with zero changes to `provider-client.js`
(the actual MCP client) and no `if provider === 'github'` branch anywhere
in Core. `gate-check`: `task check QN-002 --json` → `{"ok":true,
"acTotal":4,"acChecked":4}` → `task edit QN-002 --status done`.

**What required a genuine (non-inflating) Core extension, and why it does
not compromise the "zero changes" claim:** `config.js`'s `activeProvider()`
and `bin/quay.js`'s `withProvider()` needed to accept an explicit provider
id (previously they only supported "whichever provider is `enabled: true`"
— a v0 single-provider assumption that had never been exercised with a
second Provider before this iteration). This is a generic, provider-
agnostic extension (resolves `--provider <id>` against `.quay/config.yml`;
resolves each provider's declared `env` map against the workspace root) —
not a GitHub-specific branch. The claim being proven ("the consumer layer
needs zero changes to add a Provider," proposal §5) refers to zero
backend-specific logic in Core, which holds: `provider-client.js` itself
(the actual ABI-consuming code — `taskList`/`taskGet`/`manifest`) was not
touched at all. This distinction is recorded honestly rather than silently
claiming literally zero lines changed anywhere in `packages/quay/`.

**Normalization cost (proposal §16), reported honestly per
`packages/quay-github/DESIGN.md` §4:**
- Transferred cleanly, zero rework: the MCP transport pattern (stdio
  server/client), the `provider://manifest` resource shape, the
  `task_list`/`task_get` tool names and JSON schemas, `provider-client.js`
  itself, and Core's task/action command logic.
- Required backend-specific normalization: the status/lane label
  convention (GitHub has no native status field — the LCD problem proposal
  §2.2/§16 named), the `gh-<number>` id scheme (an open question at
  authoring time, resolved at execution time), `extra` field selection
  (`number`, `html_url`, `user`, `state`), and `parent`/`children` — left
  **unmapped** in v1, a named gap (GitHub's sub-issues feature was not
  wired up, since it is not required by the minimal read-only AC and would
  have been gold-plating per G5).

This is exactly the kind of honest, concrete normalization-cost accounting
the proposal anticipated — not a failure of the ABI design, and not
evidence the ABI is wrong, but real, reportable backend-specific work that
a Provider author must do.

## σ computation — iteration 4

Applying protocol §10.1's strict definition (all three of `author_by`,
`execute_by`, `gate_by` must be `native`) to the updated table above:

- QN-001: native/native/native → qualifies.
- QN-002: native/native/native → **qualifies (new this iteration)**.
- QN-005: native/native/native → qualifies.
- QN-007: native/native/native → qualifies.
- QN-003: native/native/native → qualifies under the inclusive reading only.
- QN-004: native/native/native → qualifies under the inclusive reading only.
- QN-006: seed/seed/seed → does not qualify.

```
σ (strict reading — execute_by counts ONLY when new Plan-described
   implementation work was actually performed)
  = (# tasks with author_by = execute_by = gate_by = native, execute_by
     backed by real new implementation) / (total tasks)
  = 4 / 7   (QN-001, QN-002, QN-005, QN-007)
  = 0.571

σ (inclusive reading — execute_by also counts gate-check-only
   re-verification of already-authored content)
  = 6 / 7   (adds QN-003, QN-004)
  = 0.857
```

Total task count remains **7** (QN-001..QN-007) — no new task was created
this iteration; QN-002 simply completed its lifecycle.

**σ = 0.571 (strict) is the headline number**, up from 0.429 at the end of
iteration 3 (Δσ = +0.142), driven by QN-002 completing a full
native-Skill-driven lifecycle (author in iteration 3, execute in iteration
4) — the **first task whose execution genuinely produced a second, live,
heterogeneous Provider**, not just native-side code. 0.857 is reported as
the inclusive upper-bound alternative, per the same non-privileging
convention established in prior iterations.

Diagnostic sub-metric (superseded — no longer meaningfully distinct from
full σ now that QN-002 has executed):

```
σ_author_only = (# tasks with author_by = native) / (total tasks)
              = 6 / 7   (unchanged from iteration 3 — same 6 tasks)
              = 0.857
```

This diagnostic and the inclusive σ reading now coincide at 0.857 — a
useful cross-check, not a coincidence: QN-002 was the only task where
`author_by = native` but the full triple hadn't yet qualified, and it has
now closed that gap.

See `experiment/timing/iteration-4.log` for this iteration's raw `date -u`
checkpoints.
