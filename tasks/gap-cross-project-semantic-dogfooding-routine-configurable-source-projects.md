---
id: gap-cross-project-semantic-dogfooding-routine-configurable-source-projects
title: new periodic, report-only, autonomous routine that semantically dogfoods
  OTHER Quay-host projects' real usage artifacts
  (tasks/worker-outcome/fan-in/needs-human) over a configurable source-project
  list (claudecodeui + quay's own usage first) — distinguishes host-local bugs
  from Quay-generic defects, reuses OSD's verifier/refuter/budget/Portfolio
  machinery, not gated on task_trace or source diff, no pre-written mechanical
  detectors
status: todo
labels:
  - gap
  - discovery-method
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
**Origin: coordinator's 2026-10-13 audit, confirming the open-semantic-discovery (OSD) routine has NEVER read any project other than quay's own source** (`materializeStrippedPin({root,...})` always pins `root` = the repo the routine itself runs in; every Portfolio finding's `components` is a path inside `plugin/scripts`/`packages`/`.quay` of THIS repo — verified by reading every entry). All "cross-project Quay findings" landed so far in this conversation (`gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks`, `gap-worker-prompt-omits-anti-drift-pre-exit-check-costs-a-session-per-touches-miss`) came from the coordinator manually dispatching Explore-style agents to read other projects' `.quay/*.jsonl`/`tasks/*.md` — a one-off, human-initiated investigation, not a recurring, autonomous mechanism. There is no periodic routine in this repo that reads another project's real usage artifacts.

**What this task builds: a periodic, report-only routine (same Layer-1b shape as OSD/discovery-method) whose SUBJECT is a configurable set of OTHER Quay-host projects' real usage artifacts** (tasks, worker-outcome, fan-in logs, needs-human reasons, operator corrections) — distinguishing a host project's own business defect from a genuinely Quay-generic capability/method defect, and feeding confirmed Quay-generic findings into the SAME Portfolio the local OSD routine already writes to.

**Explicit constraints carried over from the user's ruling (do not relax any of these):**
- Configurable source-project list, seeded with `claudecodeui` + this repo itself (quay dogfooding its own usage, which the local OSD routine does NOT do — OSD reads quay's SOURCE, this routine would read quay's own USAGE ARTIFACTS as one more entry in the same list), extensible later (e.g. `quay-fleet`).
- Runs on its OWN schedule, **not gated on any source-code delta** — the existing due/cadence primitive (`routine-scheduler.ts` `isDue`/`interval:<N>m`) already has this property (OSD/discovery-method are both time-gated, not diff-gated); this routine must use the SAME primitive, not invent a diff-gate.
- **Does NOT depend on `task_trace`/task-status-events as a gate.** Those tasks (`gap-quay-task-log-trace-read-surface`, `gap-task-status-events-contract-v1-all-driver-writers`) are done and MAY be read as optional context if present, but their absence must never block a round (mirrors `gap-open-discovery-consumes-task-status-events-optional-context`'s own already-landed rule for the local routine).
- **Does NOT pre-write mechanical pattern-matching detectors.** The governing principle (CLAUDE.md, user ruling 2026-10-12, already binding on OSD) is semantic-first: the model reads the real artifacts and forms/tests hypotheses; this routine's own code is scheduling, provenance, dedup-assistance, safety isolation, budget and tool wrapping — never a hand-written rule that itself decides "X is a bug."
- Every record carries `source_project`, `task`/`run` id, and `evidence` (file:line or carrier record) so a finding traces back to the real artifact that produced it.
- Resource/isolation/permission/cost boundaries, explicitly stated and tested with a negative control (below).
- Strict `invoked_by` separation (`resident-driver` vs `manual`), same as OSD, so autonomy claims are never inflated by a coordinator-triggered run.

## Plan
1. **Isolation and permission boundary (write first, before any model call).** The routine process only ever opens the OTHER project's root in READ mode: `fs.readFileSync`/`readdirSync` on its `.quay/*.jsonl` and `tasks/*.md`, never a write, never a spawned subprocess rooted there, never a git mutation in that tree. State this as a static, testable invariant (same shape as `gap-architecture-discovery-shadow-space-and-time-not-in-repo`'s isolation discipline if that precedent exists — check and reuse, don't reinvent). The per-project config entry is `{name, root, enabled}`; an absent or unreadable root is `not-evaluated:root-unreadable` for THAT project only, never fatal to the round.
2. **Cost/resource boundary.** One hard reservation ledger, shared or sibling to OSD's (`open-semantic-discovery-model-budget.jsonl` pattern) — its own 24h cap and USD cap, config-declared, `enabled:false` ⇒ zero spawns (kill switch). Per-round: bounded number of projects scanned, bounded artifact bytes read per project (these are cheap — the artifact read itself is NOT a model call; only forming/testing a hypothesis from it is).
3. **The semantic step.** Per due round: for each enabled source project, read a BOUNDED, RECENT slice of its real artifacts (e.g. last N worker-outcome/fan-in records, needs-human reasons, any operator-correction text) — no raw dump into the prompt; summarize deterministically (counts, grep of real text) the way the coordinator's earlier manual investigations did, then hand the investigator model the SAME kind of evidence pack OSD's investigator gets, with an explicit instruction: distinguish "this project's own bug" from "a defect in Quay's own mechanism that this project's usage exposed" — only the latter is in scope for a Portfolio finding here. Reuse OSD's verifier/refuter/budget machinery (same undetermined-is-never-confirmed bar) rather than building a second one.
4. **Dedup and Portfolio linkage.** A confirmed finding here must run the SAME dedup check OSD's existing `findDuplicate`/Portfolio correction path uses before writing a NEW `portfolio_finding` — reuse `docs/analysis/discovery-portfolio.mjs`'s `ingestFinding`/`findDuplicate`, do not fork a second finding store.
5. **Auto-file vs approval-gated candidate — decide from evidence, not assumption.** A `confirmed` cross-project finding (survived refutation, same bar as OSD) is filed as a `todo` Quay task via the SAME ABI path the coordinator used manually this session (`quay task create`), with `source_project`/evidence in its Proposal — this is "report-only" in the sense that NO task/Goal/Portfolio write happens from an `undetermined`/`refuted` verdict, matching OSD's existing report-only discipline for its own domain. State explicitly: this is NOT a departure from report-only — OSD's own landed design already files nothing until `confirmed`, and this task does not loosen that bar further.
6. **Negative control.** A deliberately host-specific, non-generalizable artifact (e.g. a host project's own UI copy bug, or a test failure naming only that project's own file, with no Quay-mechanism component) must be CORRECTLY read as "project-local, not Quay-generic" and produce no Portfolio finding — pasted as a real run, not asserted.

## Acceptance Criteria
- [ ] AC1: isolation invariant — a static check (or a real run against a read-only-bind-mounted / permission-restricted copy of a source project) proves no write ever reaches the source project's tree. Negative control: a deliberately-introduced write in a test double is caught.
- [ ] AC2: cost/resource boundary — the hard reservation ledger, 24h/USD caps, and `enabled:false` kill switch are pasted working (reservation lines, a refused round under a tiny cap).
- [ ] AC3: the config schema accepts ≥2 source projects (`claudecodeui` + this repo's own usage artifacts) and correctly marks a THIRD, deliberately-unreadable root as `not-evaluated:root-unreadable` without failing the round.
- [ ] AC4: dedup — a finding whose claim/components match an EXISTING Portfolio entry (from local OSD or a prior cross-project round) is recognized as a duplicate and does not produce a second `portfolio_finding`; pasted.
- [ ] AC5 (negative control): a real round against real claudecodeui artifacts correctly identifies at least one project-local-only item (pasted) and files NOTHING for it.
- [ ] AC6 (**the load-bearing final acceptance, per the user's explicit bar — do not substitute a fixture count**): **at least one Quay-generic finding travels the full real chain with no human naming the specific defect**: an **autonomous** round (`invoked_by:"resident-driver"`, not a coordinator `--force`/manual override) over **real** source-project artifacts produces a hypothesis → an **independent** verifier/refuter confirms it (survives refutation, same bar as OSD) → a Quay task is filed from it via the ABI → that task **lands** (merged to develop). Paste, in order: the round `ts` and `source_project`, the claim with its evidence (file:line or real carrier record), the verifier+refuter verdicts, the filed task id, and the merge commit. If this has not happened by the time the task is otherwise ready to land, the task stays NOT done and reports the gap honestly — it must not be marked done on the strength of a fixture/manual round standing in for this chain.

## Definition of Done
- AC1-AC5 checked with pasted evidence; AC6 is this task's actual purpose and is load-bearing — see its own clause above for what happens if it cannot yet be satisfied.
- Report-only in exactly the sense OSD already is: no mechanical rule decides a finding; the hard budget and kill switch are enforced; `invoked_by` is never conflated between autonomous and coordinator-triggered.

## Touches
- tasks/gap-cross-project-semantic-dogfooding-routine-configurable-source-projects.md
- plugin/scripts/cross-project-dogfood-routine.ts
- plugin/test/cross-project-dogfood-routine.test.mjs
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/capability-catalog-declarations.json
- docs/analysis/discovery-portfolio.mjs
- .quay/config.yml
