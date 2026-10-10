# Quay domain architecture — concept model, ownership matrix, and candidates

**Status:** living architecture artifact. Documentation/analysis phase only — **no Goal has been filed
from this document, no production process touched.** Supersedes nothing; complements
`docs/analysis/ownership-first-architecture-review-2026-10-10.md` (the prior, narrower review this
document was built from) — that file remains the fact source for findings not repeated verbatim here.

**Method:** four parallel bounded-context code reviews → one adversarial fact-falsification pass (Opus)
→ a proposed target model → a second, independent adversarial **design** critique (Opus) of that
proposal, which itself re-verified two of its own new claims against the live source before this
document absorbed them. Every claim below is tagged FACT (grep/read-verified by at least one pass),
JUDGMENT (architectural assessment on top of a fact), or ASSUMPTION (not independently verified — flagged
explicitly, none remain uncaveated in the final candidate list).

---

## 1. Concept glossary — identity, vocabulary, relationships, lifecycle (as-is vs proposed)

| Concept | As-is identity | Single code referent? | Relationships | Lifecycle | Proposed |
|---|---|---|---|---|---|
| **Task** | A board item with a declared status lifecycle. | **Yes** — `kernel/task-transition.ts` (`LIFECYCLE_EDGES` + `decideTransition`). | Points to a Goal via `goal_ac` (one AC, one GOAL). Consumed by Pool (dispatch), Fan-in (landing). | todo→ready→done, or →needs-human (terminal, human-unparked). | No change — this is the positive precedent the rest of this doc measures against. |
| **Goal** | A longer-lived objective, optionally `branch:true` (its own isolation branch). | **No** — status-change legality is scattered inline booleans inside `goal-store.ts`'s `write()` (2404-3065), plus a second, separate flip path (`flipGoal`, 2364). `VALID_GOAL_STATUSES` only checks membership, not transition legality. | Owns N AC records (`goal_ac` reverse pointer from Task/AC). `branch:true` goals get a `goal/<id>` branch; Tasks resolve their merge target through this field. | draft→active→achieved\|superseded\|retired. Branch-mode goals add a `pre-merge`/post-merge phase inferred from git state, not a stored field. | **Do not design the table in this document.** File an investigation task first: enumerate every inline status gate currently in `write()` (file:line each), *then* decide whether a `GOAL_EDGES`-style table is the right shape (Goal's triggers — human merge request, AC sufficiency, branch existence — vary per edge in ways Task's don't, so a literal port of `LIFECYCLE_EDGES` may be wrong). Evidence bar is already cleared: 3 documented past incidents (GOAL-013/014/018/022) from exactly this scatter shape. |
| **Gate** | The 3-state (pass/fail/not-evaluated) check-and-record mechanism. | **Yes, cleanly** — `GateFn`/`GateVerdictKind` (gate/types.ts), single entry point `runGate` (gate/engine.ts), single verdict mapper `verdictFromAcceptance`/`verdictFromGateCheck` (gate/acceptance-runner.ts). | Factories (`gate/factories/*.ts`) build `GateFn` instances per gate kind; `gate/registry.ts` resolves by name; `gate/lifecycle.ts` routes every status transition through `runGate` cleanly. | A gate is evaluated per-call, no persistent instance; its event is the durable record (`GateEvent` in `.quay/gate-events.jsonl`). | The mechanism is right. The problem is adoption (see Fan-in row and Finding 1/2 below) — **not** a concept-model gap for Gate itself. |
| **Fan-in** | The mechanism that lands a task's branch onto develop/goal-branch. | **Yes, as a function** — `worker-fan-in.ts`'s `runMechanicalFanIn` (1664-2366) owns the whole sequence. But it is **not modeled as a Gate consumer** despite conceptually being "how a task's gates get resolved before landing": it never calls `runGate`, and writes `GateEvent`s by hand with its own parallel `ScopedGateVerdict` enum. | Consumes Task (what's landing), produces GateEvents (hand-written), triggers develop/goal-branch state change. | One run per task landing attempt: lock → merge → anti-drift → scoped-gate → typecheck → suite (if needed) → flip-done → ff-merge → cleanup → release lock (worker-fan-in.ts:1806-2336, each step cited in §4). | **Real gap confirmed, but not the one first proposed** (see §6 Finding 1 — it's about who owns *writing* GateEvents, not about bridging `ScopedGateVerdict`, which a design critique found never actually reaches a GateEvent at all). |
| **WorkerPool ("Pool")** | The set of ready-and-dispatchable tasks plus in-flight/retry/backoff state the worker driver draws from. | **No** — split across `ready-pool-check.ts` (candidate computation) and several independent in-memory structures in `worker-driver.ts` (`inFlightTasks`, `retryState.{needsHuman,counts}`, `backoffState`), with no shared type. "Pool" is a name the team uses in conversation with no module that IS it. | Feeds from Task (candidates), reports to Fan-in (landing), interacts with Gate indirectly via acceptance checks. | `retryState`/`backoffState` are explicitly **not persisted** (worker-driver.ts, comments "⛔ 不落盘" at the construction sites) — they live only as long as the resident loop process does. | **Real slice warranted**, not documentation-only (see Finding 2 below — history, not just naming, justifies this). |
| **Driver** | A kind-parameterized resident loop (promotion/worker/outer/quality/meta/goal), all hosted in one anchor process. | **Partially** — `DriverKind` is a declared string-literal type, shared infra exists (`KIND_STOP` registry, control-state, resource-gate), but there is no polymorphic interface; each kind's own file re-implements its orchestration loop, and one kind (worker) diverges from the other 5's stop mechanism without that divergence being declared in the shared registry's own doc comment. | Hosts Routine (quality/meta/goal kinds run routines inside themselves) and Pool (worker kind only). | Anchor-managed: `driver-anchor.ts`'s `runAnchor` spawns one in-process async task per kind with independent retry/backoff-respawn; stop/restart/halt go through `driver-shared.ts`'s control-state primitives, re-exported via `driver-runtime.ts`. | **Small declared-fact fix, not a forced interface** — see Finding 7. Do not build a `drivers.yml`-level config field for this (a design critique found that nothing would read it); put the divergence where something could: the `KIND_STOP` registry entry's own shape, or at minimum its doc comment. |
| **Routine** | A scheduled, due-checked unit of recurring work (filing findings, reviewing architecture, etc.) hosted inside specific Driver kinds. | **Yes for the scheduling shape** — `RoutineSpec` + `scheduleIsDue`/`isDue` (routine-scheduler.ts, re-exported by driver-runtime.ts), one definition, reused correctly by every routine. | Lives *inside* whichever Driver kind hosts it (quality-gate-driver.ts hosts 4; outer/meta host others) — `RoutineSpec` itself is declared in `driver-runtime.ts`, the shared Driver infra file, blurring the Driver/Routine module boundary even though the scheduling contract is clean. | Scheduled per-round inside its host kind's resident loop; `lastRun` is in-memory only (resets on kind restart ⇒ first round after any restart is always due). | No code change proposed. Worth noting in the glossary that Routine's declared type lives in Driver's shared file, not its own — a minor boundary note, not a defect with evidence of cost. |
| **Session/identity** | Three unrelated things share the word "identity": network caller allow-listing (`resolveCaller`/`knownCallers`), process-liveness matching (`proc-identity.ts`), inter-session peer auth (`peer-identity-probe.ts`). | **No, and shouldn't be forced to one** — they solve genuinely different problems; the risk is purely a reader mis-searching for "the" identity mechanism. | None load-bearing between the three. | N/A per-mechanism. | Glossary-only: name the three apart explicitly so a future reader doesn't assume one covers the others. |
| **Run** | A unit of "one dispatch/execution episode," expected to correlate records across a worker's lifetime. | **Partially** — `RunIdentity` (`run-identity.ts:63-80`, minted by `mintRunIdentity`) is a real, versioned, well-formed type, but scoped only to the milestone/candidate-dispatch subsystem (DIR-124-B1). Outside that subsystem, `runId` is a bare string correlation key minted ad hoc in at least 3 places (`goal-driver.ts:4903`, `worker-driver.ts:4332`, routine-findings records), with **no `Run` object** constructed around it. | A `RunIdentity` belongs to a candidate/milestone (`candidateId`, `taskIds[]` — can span >1 task). A bare `runId` string is attached to one worker dispatch and joins lock-metrics/outcome/suite-memory evidence, but — per `driver-filters.ts:783`'s own comment — is **round-level, not attempt-level**: one `runId` can span multiple attempts. | `RunIdentity`: born at `mintRunIdentity` (dispatch time), binds a commit once, read through Audit/Gate/Land. Bare `runId`: born at whatever call site mints it, dies with the process. | **Documentation-only, and point to the existing comment rather than restate it** (a second adversarial pass flagged restating `driver-filters.ts:783`'s wording as its own small prose-copy risk). No code unification proposed — forcing `RunIdentity` to cover worker dispatch too would be a large, speculative redesign with no demonstrated bug driving it. |
| **Attempt** | "One try at landing/executing a task." | **No** — three unrelated structures all mean roughly this with no shared type: `ExitedNotLandedAttempt` (durable, keyed by `ts+step`, *not* `runId` — driver-filters.ts:786-798), `RetryState.counts` (volatile, per-task consecutive-failure integer), `WorkerRunResult` (live per-spawn return value, carries `runId` only indirectly via its `outcome`). | Each overlaps in *meaning* with "Run" and with each other but none references the others. | Varies per structure — see above. | Documentation-only: name the three apart in the glossary; same reasoning as Run. |
| **Policy** | "An independent decision function gating admission/dispatch." | **No, and should not be forced to one** — 4 real, structurally different instances: `routineQuotaDecision` (routine-file-gate.ts, `{accept,reason}`), `TaskFilter`/`applyTaskFilters` (driver-filters.ts, predicate closures), `artifactsComplete` (kernel/task-shape-artifacts.ts, `{complete,missing}`), `resource-gate.sh` (shell exit code). A 5th hit, `PolicyDocument` (execution-policy.ts), is a structurally unrelated domain (detector-activation authorization) and should **not** be folded in. | Each gates a different concern (routine quota, dispatch eligibility, promotion readiness, host resource admission) for a different consumer. | Each has its own lifecycle, no shared one. | **Glossary-only, and say so plainly**: "Policy is not a converged domain concept in this codebase — these are four independent decision functions that each play a policy-like role for their own concern." Do not name a pattern or shared interface — per the methodology's own rule, a pattern name marks a shape that has *already* converged, not one that's merely similarly-named; these four have different enough input/output shapes that forcing a common interface would itself be the "强行 class 化" this whole review is trying to avoid. |

---

## 2. State / decision / effect ownership matrix

| Concern | State owner (symbol:path) | Decision owner | Effect owner | Clean? |
|---|---|---|---|---|
| Task status transition | `kernel/task-transition.ts::LIFECYCLE_EDGES` | `kernel/task-transition.ts::decideTransition` | `plugin/scripts/task-ops.ts` (re-export) | Yes |
| Task filing | — | `packages/quay-native/src/store.ts::write()` (validation, CAS) | same function (file write + commit) | Yes, one owner for both |
| todo→ready promotion | n/a | `ready-pool-check.ts::buildCandidate`/`analyzeTasks` | `ready-pool-check.ts::applyPromotions`→`setTaskStatus` (which re-invokes `decideTransition` internally) | Yes, decision/effect split, slightly layered (decided twice before the write) |
| Worker dispatch selection | `worker-driver.ts` locals (`running`, `candidates`) | `driver-runtime.ts::runSelectorWorker` (LLM subprocess) + `driver-filters.ts::applyTaskFilters` | `worker-driver.ts::spawnSelected`→`runOneWorker` | Decision/effect split across 2 files, each clean individually |
| **Worktree creation** | n/a | n/a | **No driver-side function — delegated to the worker's own prompt instructions (`buildWorkerPrompt`, worker-driver.ts:2020-2041), which tell the dispatched Claude worker to run `git worktree add` itself.** | **No — real gap.** The only driver-side worktree code is cleanup/reclaim, never creation. |
| Gate verdict computation | `gate/types.ts::GateVerdictKind` | `gate/acceptance-runner.ts::verdictFromAcceptance`/`verdictFromGateCheck` | `gate/gate-event-store.ts::appendGateEvent` | Yes, mechanism is clean (adoption is the problem, see §6) |
| Fan-in landing sequence | `worker-fan-in.ts` locals | `runMechanicalFanIn` (one function, all steps) | same function, delegating narrow effects (`flipTaskDone`, `ffMergeFn`) | Yes — cleanest hop in the whole review |
| **GateEvent writing** | `.quay/gate-events.jsonl` | **No single decision owner** — `gate/engine.ts::runGate` (real check), `worker-fan-in.ts:1279` (hardcoded `"pass"`), `worker-fan-in.ts:2502` (outcome→pass/fail), `goal-merge.ts:268` (a 4th independent call site) | 4 independent call sites across 3 files, same JSONL shape | **No — real gap, see Finding 1** |
| WorkerPool retry/backoff | `worker-driver.ts::retryState`/`backoffState` (in-memory, explicitly "⛔ 不落盘") | `driver-filters.ts::advanceRetryCap`/`applyNeedsHumanTransition` (GOAL-035) | same | Decision function is clean (post-GOAL-035); the *state's* lifecycle (silently reset on restart) is undeclared, see Finding 6 |
| Driver kind stop | `driver-runtime.ts::KIND_STOP` map | `registerKindStop`/`requestKindStop` | process-level `SIGINT`/`SIGTERM` handlers + per-kind signaler callback | Clean for 5 of 6 kinds; worker's poll-based variant is a real but *documented-at-the-call-site* (not registry-level) divergence |
| Routine scheduling | `routine-scheduler.ts::isDue` (pure) | same | host kind's resident loop (e.g. `quality-gate-driver.ts::runResidentQualityGateLoop`) invokes `r.run(ctx)` | Yes |
| Goal status transition | scattered inline booleans, `goal-store.ts::write()` | same function (no separate decision layer) | same function | **No — real gap, Finding 4** |

---

## 3. ArchGuard static audit — facts, separated from judgment

**Reproducibility:** both runs below target `develop @ 4743da9340f9b0845fcc8ad9d6aa0f084d11594c` (confirmed
== `origin/develop` at analysis time; `author` branch was at the identical commit, so this session's
working tree needed no checkout). Two independent audits agree on every cross-checked number — mine (MCP
tool, live tree) and a peer session's (CLI, `git archive` export, fully reproducible from a cold clone).

**Peer session's reproducible commands** (quoted verbatim, archguard CLI 0.1.39):
```bash
git archive develop | tar -x -C /tmp/yale-quay-dev
node dist/cli/index.js analyze -f json --lang typescript --diagrams package \
  -s /tmp/yale-quay-dev --output-dir /tmp/yale-qaudit/repo
node dist/cli/index.js analyze -f json --lang typescript --diagrams package \
  -s /tmp/yale-quay-dev/packages/quay/src --output-dir /tmp/yale-qaudit/core
```
(`--lang typescript` is required for `plugin/scripts` — without it the CLI reports "Found 0 diagram(s)",
no local `package.json` to auto-detect from.)

**My reproducible commands** (MCP, same commit, scoped the same two ways):
```
archguard_analyze({ sources: ["packages/quay/src", "plugin/scripts"], includeGit: true })
archguard_summary({ outputScope: "package", scope: "<scope-key>" })
archguard_detect_cycles({ outputScope: "package", scope: "<scope-key>" })
```

### FACTS (both audits agree)

- **Package SCC: exactly one cycle, size 4** — `packages/quay/src` (root) ↔ `gate` ↔ `gate/config` ↔
  `gate/factories`. Unchanged since GOAL-033; GOAL-034 narrowed its edges but did not dissolve it
  (expected and declared at the time — see GOAL-034's own body).
- **`plugin/scripts` is a single flat package**: 283 files, 3,807 entities (my count) / confirmed
  490-file-repo-wide, 3,838-function total by the peer's independent parse — **58-75% of the whole
  repo's files/functions live in one unstructured directory.**
- **`packages/quay/src/kernel` has fan-out 0** (peer's cross-package edge count) — confirmed independently
  as the one package with zero outgoing cross-package dependencies; the GOAL-030/032/033/034 convergence
  onto `kernel/` is holding structurally, not just by convention.
- **13 classes vs ~3,838 functions, repo-wide** (peer's count) — an OOD pass in this codebase has almost
  no existing class structure to converge onto; responsibility lives in free functions + interfaces. This
  is the single most load-bearing fact for how any of this section's candidates should be shaped: **new
  classes are not the default move here; most real fixes are a function moved to a different single
  owner, not a class introduced.**
- **Driver is a cross-directory concern**: 19 name-matched `*driver*` files across 4 directories
  (`packages/quay/src`, `packages/quay/src/cli`, `packages/quay/src/gate`, and 15 of 19 inside the flat
  `plugin/scripts`) — confirming §1's glossary entry that Driver has no single package boundary.
- **Concern-coupling** (peer's positional import scan, products only): 5 of 21 concept-pairs show
  bidirectional imports — `Driver↔Routine` (5/4 edges), `Driver↔Goal` (7/7), `Driver↔Pool` (3/2),
  `Task↔Pool` (1/8), `Goal↔Gate` (5/3). **This exact count is definition-sensitive, flagged by the
  peer session after the citation was already verified accurate**: restricting "Gate" to the real
  `gate/` directories gives 5; a looser basename match (any file named `*gate*`) gives **9**, inflated
  by `gate-script-base.ts` — a shared TS-gate-script utility imported by **215 files**, not itself part
  of the Gate concern. The honest range is 5-9, and the strict form (5) slightly *under*-counts by
  excluding genuine plugin-side gate drivers (`quality-gate-driver.ts`, `routine-file-gate.ts`,
  `fan-in-ac-completion-gate.ts`). **The durable claim is the cluster** (Driver/Routine/Goal/Gate/Pool
  mutually reach each other), not the exact count — don't re-cite "5 of 21" as a precise, stable number.
  Concrete edges: `driver-runtime.ts:80`↔`probe-routine.ts:44`;
  `goal-driver.ts:52`↔`driver-runtime.ts:470`; `cli/driver.ts:36`↔`ready-pool-check.ts:220`;
  `gate/factories/goal.ts:20`↔`goal-store.ts:73-78` (this last pair is the SCC's own gate↔root edge,
  cross-confirming §3's cycle finding from a completely different angle — concept-level import scan vs.
  package-level cycle detection).

### JUDGMENT (not mechanical — the peer's own framing, which this document adopts)

1. Driver is a cross-directory *concern*, not a *module* — any ownership slice attempted at package
   granularity cannot express it; slices need symbol-level targeting, not directory moves.
2. `plugin/scripts` is this codebase's least architecturally-constrained surface: largest, top of the
   layering (no upward edges), zero fan-in.
3. The near-total absence of classes means this review's candidates should default to "move a function to
   a clearer single owner," not "introduce a class" — consistent with §1's per-concept proposals, all of
   which deliberately avoid new class/interface machinery except where a second real instance already
   justifies it (GateEvent writing, §6 Finding 1).
4. **Explicitly not claimed by either audit:** SCC count is not a design-quality score. 33 internal
   packages with one 4-member cycle is a low count by itself; neither audit calls this codebase badly
   designed. The findings in this document are about coupling *shape* (who reaches into whom, and whether
   that's declared), not a cycle-counting exercise.

---

## 4. End-to-end sequence 1 — Task: discovery → ready → dispatch → execute → fan-in

Every hop cites the real call chain (traced this session, not from memory):

1. **Filing** (`task_write` ABI) → `packages/quay-native/src/mcp-server.ts:236-299` (protocol adapter) →
   `packages/quay-native/src/store.ts::write()` (`:1546`, lock-protected read-modify-write + YAML
   validation/rollback `:1648-1687` + `commitTaskWrite()` `:1454`, invoked `:1708`). *Clean: one function
   owns decision (validation/CAS) and effect (write+commit).*
2. **todo→ready** → `ready-pool-check.ts::buildCandidate` (`:2250-2429`, the `eligible` conjunction) →
   `analyzeTasks` (`:3165`) builds `promotions` (`:3434`, `:3493`) → `applyPromotions` (`:3804-3852`,
   re-checks a touches guard, then `setTaskStatus` `:3718-3752` → `kernelDecideAndPatch` `:3678`
   → `commitTaskStatus` `:3774`). *Decision/effect split across 2 functions, with the kernel's own
   transition legality check re-invoked inside the effect function — a minor double-layering, not a gap.*
3. **Dispatch** → `worker-driver.ts`'s resident loop (`:5731-5755`): `readyPoolCheck`
   (`driver-runtime.ts:2388-2412`) → shuffle → `applyTaskFilters` (`driver-filters.ts`, invoked
   `:5748`) → backoff filter (`:5751`) → `runSelectorWorker` (`driver-runtime.ts:2451-2460`, a short-lived
   LLM subprocess picks one candidate, fails closed to the first shuffled one on bad output) →
   `spawnSelected` (`:5507-5539`) → `runOneWorker` (`:4803`). *Clean split: selection (driver-runtime.ts)
   vs. spawn (worker-driver.ts).*
4. **Worktree creation — the one real gap in this sequence**: no driver function creates it.
   `buildWorkerPrompt` (`:2020-2041`) only *instructs* the dispatched worker to run `git worktree add`
   itself (`:2032-2033`) plus `dispatch-worktree-setup.sh`. The only driver-side worktree code is
   cleanup/reclaim (`cleanupOrphanWorktree`, `reclaimSupersededWorktrees`), never creation. "Worktree
   exists" is an emergent outcome of prompt-following, not a traceable function call.
5. **Execution** → `workerArgvForTaskAsync` → `launchArgv` (`driver-runtime.ts:2037-2056`, resolves
   `.quay/profiles.yml` into the literal `claude -p <prompt>` invocation) → `spawn()` (`worker-driver.ts
   :4847`). The prompt itself (`:1787-1819`) directs the worker to use `task_check`/`task_write` (ABI) for
   AC bookkeeping and normal file tools scoped to the worktree for code — an explicit but
   natural-language, not mechanically-checked, contract.
6. **Fan-in** (`worker-fan-in.ts::runMechanicalFanIn`, `:1664-2366`) — one function owns every step:
   lock acquire (`:1806`) → merge mergeTarget (`:1910`) → anti-drift (`:1928`) → delta classification
   (`:1932-1961`) → typecheck ∥ doc-check (`:2000-2005`) → scoped gate (`:2016-2055`) → full suite if
   needed (`:2126-2152`) → land-gate (anti-drift re-run + AC-completion gate + `flipTaskDone`,
   `:2246-2253`) → `ffMergeFn` (`:2257-2274`) → cleanup (`:2304-2318`) → release lock (`:2321-2336`).
   *Cleanest hop in the whole trace — no decision/effect split, no ambiguity.*

---

## 5. End-to-end sequence 2 — Driver/Routine/Pool: start → schedule → dispatch → stop/failure

1. **Anchor startup** — `driver-anchor.ts::runAnchor` (`:286`) resolves the kind list
   (`readDesired(root)?.kinds ?? KNOWN_KINDS`, `:420`) and loops `startKindTask` (`:125`, dynamic
   `import()` of that kind's driver module via `resolveKernelSibling`, awaited inside a `for(;;)`
   retry/backoff loop, `:160-185`) — **one anchor process hosting 6 independent in-process loops**, not 6
   OS processes. *Clean, single-owner.*
2. **Kind registration** (`registerKindStop`, `driver-runtime.ts:792`) — call sites diverge: outer/
   promotion/quality each call it directly with their own `stopCtl.requestStop` callback; meta and goal
   never call it directly — both delegate into `quality-gate-driver.ts`'s shared loop, which does.
   **`worker-driver.ts:5348` calls `registerKindStop("worker")` with no callback at all** — worker's stop
   check is pure polling (`kindStopRequested("worker")`), confirmed documented at its own call site
   (`:5345-5347`) but **not** flagged in the shared `KIND_STOP` registry's own doc comment
   (`driver-runtime.ts:767-776`) — a reader of only the shared file would wrongly assume uniformity
   across all 6 kinds.
3. **Routine scheduling** (architecture-review inside `quality-gate-driver.ts`) — `qualityGateRoutines`
   (`:939`) declares the `RoutineSpec` (`:954-963`) → `runResidentQualityGateLoop` (`:1051`) checks
   `scheduleIsDue` (`:1077`, re-exported `isDue`) against in-memory `lastRun` (resets on restart ⇒ always
   due after one) → `runRoutineWithWatchdog` (`:1082`) races the routine's own `run(ctx)` against a
   timeout. *Clean, single-file for this hop.*
4. **Pool dispatch** (`worker-driver.ts::runResidentLoop`, `:5153`) — ordered checks each round: cap +
   stop flags (while-condition) → `stopCondition()` (halt + resource-gate, `:5733`) → `readyPoolCheck`
   (`:5740`) → shuffle + `applyTaskFilters` (`:5753`) → quick-death backoff filter (`:5758`) → empty-check
   → `runSelectorWorker` (`:5769`) → `spawnSelected` (`:5776`). *Clean, single-file sequencing; only the
   individual predicate functions are imported.*
5. **Stop/restart/failure** — `drainKind`/`resumeKind`/`restartKind` (`driver-runtime.ts:4053/4070/4093`,
   re-exporting `driver-shared.ts`'s `applyHalt`/`writeControlState`) handle operator-invoked halts;
   `haltForEnvironmentFatal` (`worker-driver.ts:4204`) handles driver-self-invoked halts on a detected
   environment-wide failure signature — **both funnel through the same underlying control-state
   primitive**, with the divergence (who calls it, the extra `halt_reason` tag) documented inline as
   intentional. *Clean and deliberate — the one genuine drift in this whole sequence is hop 2's
   undocumented-at-the-registry-level stop-mechanism split, not this hop.*

---

## 6. Architecture invariants and current violation status

| # | Invariant | Checkable how | Current status |
|---|---|---|---|
| 1 | A `GateEvent`'s verdict must derive from an actual check result, never a hardcoded literal or an outcome-shaped proxy. | Mechanical: audit every `appendGateEvent` call site for whether its `verdict` argument traces to a `verdictFromAcceptance`/`verdictFromGateCheck` call vs. a literal/ternary. | **VIOLATED** — 3 of 4 call sites (`worker-fan-in.ts:1279,2502`, `goal-merge.ts:268`) don't. See Finding 1. |
| 2 | A 3-state check result (pass/fail/not-evaluated) must never be read as a 2-state boolean. | Mechanical: grep for bare `.ok`/`!res.ok` reads on a gate-check-shaped result without a companion verdict-mapper call nearby. | **VIOLATED** — 6 of 7 shell-running gate factories (Finding 2) + `goal-store.ts::checkAchievedFailing` (Finding 3). |
| 3 | A status/phase transition is decided by one declared table, not reconstructed per call site. | Semantic (needs a human/LLM audit of each status-changing write path). | **HOLDS** for Task. **VIOLATED** for Goal (Finding 4). |
| 4 | In-memory dispatch-control state that resets on process restart must have that consequence declared somewhere an operator would see it. | Semantic: check `quay driver restart`'s own help/output for a stated consequence. | **VIOLATED** (unconfirmed-before-this-review, now confirmed) — `retryState`/`backoffState` reset silently; not mentioned in restart-path documentation found so far. See Finding 6. |
| 5 | A shared cross-kind registry's own doc comment must state every kind's actual behavior, not assume uniformity. | Semantic: read the registry's header against each kind's real call site. | **VIOLATED** — `KIND_STOP`'s doc comment doesn't flag worker's poll-based divergence. See Finding 7. |
| 6 | A concept name used across multiple files either has a shared type, or the glossary explicitly states it doesn't. | This document, going forward. | Previously **unstated** for Pool/Policy/Run/Attempt — this document is the first time that's declared one way or the other (§1). |
| 7 | Every real decision+effect concern should be reachable through one entry point. | Semantic: does a production code path for concern X call X's declared single entry point, or reimplement it? | **VIOLATED** for GateEvent writing (Finding 1) and, as an accepted/documented trade-off, for Fan-in's bypass of `runGate` itself. |
| 8 | ArchGuard-detected package cycles should not silently grow across a goal-branch landing. | Mechanical: `archguard_detect_cycles` before/after, same scope. | **HOLDS** — SCC size 4, same 4 members, confirmed by two independent audits of the same commit. Baseline worth protecting, not currently violated. |

---

## 7. Ranked candidates

Each candidate states impact, evidence strength, risk, and minimal slice. Items explicitly rejected or
downgraded by either adversarial pass are listed separately at the end, with which pass rejected them —
**do not re-propose them without new evidence.**

### 1. [Highest impact, HIGH confidence — new this round] GateEvent writing has no single decision owner

- **Evidence (FACT, independently re-verified against live source):** `appendGateEvent` has 4 real call
  sites across 3 files: the actual check (`gate/engine.ts:131`, via `runGate`), and three hand-written
  ones — `worker-fan-in.ts:1279` (hardcoded `verdict:"pass"`), `worker-fan-in.ts:2502` (landing outcome
  mapped to pass/fail), `goal-merge.ts:268` (a 4th, distinct site). All four produce the same JSONL shape,
  so `quay gate-log`'s reader cannot tell "a check ran green" from "a landing happened" without reading
  each writer's source.
- **Why this replaces the first-drafted Gate↔Fan-in proposal:** the original proposal (bridge
  `ScopedGateVerdict`→`GateVerdictKind`) was found WRONG by the design-critique pass —
  `ScopedGateVerdict` never reaches a `GateEvent` at all (its only consumers write to a step trace, not
  the event log). This finding is the real, evidence-backed version of "Gate↔Fan-in is a parallel
  universe."
- **Minimal slice:** one declared writer helper (or a required `provenance`/`source` field on
  `GateEvent`) so synthetic/landing-outcome events are structurally distinguishable from evaluated ones —
  same shape as GOAL-035's already-landed fix for scattered effect-ownership, applied to a different
  write path.
- **Risk:** low-medium — touches 3 call sites in 3 files, each independently testable (assert the new
  field/shape on each write), no change to the engine's own `runGate` path.

### 2. [High impact, HIGH confidence] 6 of 7 shell-running gate factories drop the 3-state verdict; one produces a false PASS

- Carried forward from the prior review (`docs/analysis/ownership-first-architecture-review-2026-10-10.md`
  Finding 1), confirmed by the Opus falsification pass with a corrected count (6 of 7 shell-running
  factories, not "6 of 8") and a worse sub-case found (`red-green.ts` can return `ok:true` when its probe
  command times out — a false pass, not just a lost signal).
- **Minimal slice:** route each factory's return through `verdictFromAcceptance`/`verdictFromGateCheck`
  the way `goal.ts` already does. 6 independently-testable call sites.
- **Risk:** low per-file; land together or tracked, so a partial fix doesn't recreate the exact
  "fixed-in-some-not-others" gap it's fixing.

### 3. [High impact, HIGH confidence] `goal-store.ts`'s I5 re-verify loop collapses not-evaluated into fail

- Carried forward (prior review Finding 2), confirmed, contrast corrected (the real intra-file contrast
  is lines ≈2316/≈3634, not the activation gate as first stated).
- **Minimal slice:** swap the bare `!res.ok` check for a verdict-aware check with a distinguishable
  not-evaluated bucket. Single function, clear before/after test.
- **Risk:** low.

### 4. [High impact, evidence bar clearly cleared — commit to an investigation task, not a design] Goal has no declared transition table

- Carried forward (prior review Finding 3), **upgraded by the design-critique pass**: the evidence
  (3 documented past incidents: GOAL-013/014/018/022) clears the "second real instance" bar cleanly —
  Task's `LIFECYCLE_EDGES` is the first instance, Goal is the second, and under-committing to "maybe
  someday" on the best-evidenced item in this whole document would itself be a mistake.
- **Minimal slice — but it's an investigation, not a code change yet:** file a task whose AC is "enumerate
  every inline status gate currently inlined in `goal-store.ts::write()`, file:line each, and the branch
  that reaches it" — so the deferral is a tracked artifact, not something that depends on someone
  remembering it. The table DESIGN itself waits for that enumeration (Goal's per-edge side effects vary in
  ways Task's don't; a literal port of the Task pattern may be the wrong shape).
- **Risk:** the investigation itself is zero-risk (read-only); the eventual fix is the largest-blast-radius
  item in this document (every goal status change) and should not be scoped further without that
  enumeration in hand.

### 5. [Medium-high impact, confirmed by history, UPGRADED from docs-only] Pool's dispatch-exclusion state has no single owner, and has caused real incidents

- **Correction from the first proposal:** "no evidence of a behavioral bug" was asserted without checking
  history first (a violation of this project's own hard rule 12b — check history before asserting an
  absence). History contradicts it: `gap-worker-driver-cold-start-inflight-blind` and its `-refresh`
  follow-up are two documented incidents where split in-flight state caused a wrong dispatch decision.
- **Minimal slice:** NOT a new `Pool` class (no second real *implementation* instance justifies one yet)
  — one function that computes the dispatch-exclusion set (currently assembled ad hoc from
  `inFlightTasks`/`retryState.needsHuman`/backoff state at the call site) becomes the single owner other
  code reads from, rather than each caller re-deriving its own view of "what's excluded right now."
- **Risk:** medium — this is read by the hottest loop in the system (every dispatch round); needs careful
  behavior-preserving extraction with a regression test before/after.

### 6. [Medium impact, confirmed, NEW this round] `retryState`/`backoffState` reset silently on driver restart

- **Evidence (FACT, independently verified this round):** both are constructed fresh per resident-loop
  invocation (`worker-driver.ts`, comments explicitly "⛔ 不落盘" at their construction sites) — confirmed
  live. A `quay driver restart --kind worker` therefore silently resets every task's retry/backoff budget,
  with no confirmed operator-facing documentation of this consequence (distinct from the already-known,
  already-documented "restart doesn't respawn the anchor" gap).
- **Minimal slice:** document the behavior explicitly in `quay driver restart`'s own help/output first;
  decide separately (not in this pass) whether it needs to become persistent — that's a bigger design
  question (would change what "restart" means operationally) and shouldn't be bundled into a doc fix.
- **Risk:** the doc fix is zero-risk; flagged here specifically so it isn't lost before someone decides
  whether persistence is warranted.

### 7. [Low-medium impact, confirmed, scope corrected] Driver's shared stop registry doesn't declare worker's divergence

- **Correction from the first proposal:** a `drivers.yml`-level `stopMechanism` config field was found
  OVER-ENGINEERED by the design critique — nothing would read it, so it would be an echo, not a
  declaration, and it puts an implementation fact on the wrong (user-facing config) surface.
- **Minimal slice (corrected):** either a one-line addition to `KIND_STOP`'s own doc comment stating
  worker is the poll-based exception, or — if machine-visibility is wanted — a typed field on the
  registry entry itself (e.g., whether a wakeup callback was supplied), not on the YAML config surface.
- **Risk:** trivial either way.

### 8. [Medium impact, not yet re-falsified this round, carried as-is] `spawnSyncCapture` duplicated verbatim, already diverged

- Carried forward from the prior review (Finding 5) — real duplication (`gate/factories/coverage-floor.ts
  :24-40` vs. `gate/acceptance-runner.ts:396-422`), the latter's own comment admits it mirrors the former
  instead of importing it, and the two shapes have already drifted (one is missing a `signal` field).
  **Confidence note carried forward unchanged: this was not one of the claims re-checked by either Opus
  pass** — treat as FACT (directly readable) but with one fewer round of adversarial stress-testing than
  Findings 1-7 above.
- **Minimal slice:** one shared implementation, both call sites switch to it, test asserting the
  previously-diverged shapes now agree.

### Explicitly rejected or downgraded — do not re-propose without new evidence

| Item | Rejected by | Why |
|---|---|---|
| `goal-driver.ts`'s "duplicate cache quartet" (`sufficiencyCache`/`objectiveCache`) | Round-1 Opus falsification | Disk I/O already shared (`readCacheMap`/`writeCacheMap`); validation callbacks differ in a load-bearing way; one cache has no `persist*` at all. Cosmetic at most. |
| `worker-driver.ts`'s `final_state` "missing transition table" | Round-1 Opus falsification | Misreading — `FINAL_STATES` is already a single declared vocabulary, enforced via `assertFinalState`. The two "independent derivations" answer genuinely different questions (live worker vs. adopted orphan, which can't observe the same inputs). Only real (minor) dup: the exit-code mapping exists twice. |
| `goal-store.ts`/`goal-merge.ts` "bypassing `gate/engine.ts`" via direct `gate-event-store.ts` imports | Round-1 Opus falsification | Not a defect — `gate/engine.ts` has no public event-query surface to bypass; `gate-event-store.ts` is a deliberate shared primitive, already consumed the same way from inside `gate/` itself. |
| Bridging `ScopedGateVerdict`→`GateVerdictKind` as the Gate↔Fan-in fix | Round-2 Opus design critique | Wrong problem — `ScopedGateVerdict` never reaches a `GateEvent`; replaced by Candidate 1 above (GateEvent writer ownership), which is the real, evidence-backed version of this concern. |
| A `drivers.yml`-level `stopMechanism` field | Round-2 Opus design critique | Over-engineered — nothing would read it; an echo, not a declaration. Replaced by Candidate 7's corrected, lighter scope. |

---

## 8. Open questions for whoever scopes the next Goal(s)

- Should Candidates 2 and 3 (both "3-state collapsed to 2-state") land as one Goal (shared theme) or two
  independent branch Goals (different modules, different owners)? Not decided here.
- Candidate 4's investigation task should run *before* anyone attempts to design the Goal transition
  table — the enumeration's output may change what shape the fix should take.
- Candidate 5 (Pool) touches the hottest loop in the system — whoever picks it up should pull the exact
  current call sites fresh before writing AC/negative-control text; this document cites line numbers as
  of commit `4743da93`, which will drift.
