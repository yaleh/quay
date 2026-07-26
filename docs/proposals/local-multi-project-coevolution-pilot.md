# Local multi-project co-evolution: Quay, meta-cc, and archguard

- **Status:** proposal / near-term operating design only. This document does
  not authorize a global autonomous loop, start or resume a project loop,
  mutate another project's task board, install a daemon, create a Host
  Adapter, or widen the existing `scope: validation` workspace authorization.
  Adoption must enter each owning project's normal task, preparation, gate,
  and review process.
- **Date:** 2026-07-26
- **Context:** Quay's exp5 loop already observes its own execution, files
  evidence-backed tasks, and improves the product and method. Quay, meta-cc,
  and archguard now also use one another during development: meta-cc observes
  Claude Code and Codex sessions, archguard observes repository structure,
  and both projects use Quay to manage and execute work. The useful next step
  is to make that co-evolution explicit without turning one project or one
  session into the owner of all three.
- **Related:**
  [`quay-control-plane-host-adapters-human-control-surface.md`](./quay-control-plane-host-adapters-human-control-surface.md)
  defines the control-plane, Host Adapter, and human-control boundaries. ·
  [`quay-perpetual-stream-experiment-v5.md`](./quay-perpetual-stream-experiment-v5.md)
  defines exp5's project-local two-layer loop. ·
  [`baime-lite-driving-external-projects.md`](./baime-lite-driving-external-projects.md)
  explains why external projects make backlog quality and domain oracles
  load-bearing. ·
  [`quay-codex-self-observation-tool-supply-chain.md`](./quay-codex-self-observation-tool-supply-chain.md)
  defines the evidence/authority boundary for observation tooling. ·
  [`DIR-043`](../../tasks/DIR-043.md) and
  [`DIR-055`](../../tasks/DIR-055.md) define external-dogfooding and
  session-history discovery routines. ·
  [`DIR-117`](../../tasks/DIR-117.md) defines the checked Proposal/Plan
  preparation boundary required before autonomous Build.

## 1. Decision summary

The near-term system should be a **federation of project-owned loops around a
small local coordination projection**, not an expanded exp5 loop with one
global backlog.

1. **Each project remains sovereign.** Quay, meta-cc, and archguard own their
   own tasks, Proposal/Plan checks, gates, integration branch, releases, and
   domain acceptance.
2. **Quay supplies coordination semantics, not portfolio ownership.** The Quay
   product may implement qualified references, event schemas, reconciliation,
   leases, and Host Adapters. The Quay repository is still only one peer in
   the project graph.
3. **meta-cc and archguard are evidence and capability owners.** They may
   produce findings about another project, but evidence does not authorize
   lifecycle writes in that project.
4. **Cross-project work uses delegated autonomy.** A requester states a
   versioned capability need; the owning project accepts and implements it on
   its own board; the requester independently revalidates the delivered
   capability.
5. **Raw discovery is FILE-only.** A finding may create or propose an
   unprepared candidate after routing and deduplication. It must not become an
   executable `ready` task until the owner accepts it and checked Proposal/Plan
   preparation passes.
6. **Start with one machine and one relationship.** Prove
   Quay ↔ meta-cc first, then Quay ↔ archguard. Do not begin with a cyclic
   three-project autonomous coalition.

The immediate objective is not to run more sessions. It is to make current
authorization, presence, preparation, execution, delivery, and acceptance
state reconstructable without reading those sessions.

## 2. Current local snapshot and the distinction it exposes

The following was observed on 2026-07-26 and is diagnostic context, not
canonical state:

| Project | Task/loop state observed | Host/process state observed |
|---|---|---|
| Quay | exp5 had a `.halt`; its board still contained todo, ready fixture, and needs-human work | several Quay Claude/tmux panes existed |
| meta-cc | three checked Codex-related tasks were `ready`; its loop had selected DIR-024 | an active Claude/tmux loop and an isolated DIR-024 worktree existed |
| archguard | two newly filed tasks were `todo`, with no `ready` task | no current archguard tmux session was present |

The existing exp5 drivable-workspace registry still named an `archguard-5`
session that was no longer present. This is not a registry defect by itself:
authorization is durable policy, while session presence is transient. It does
show that the two must never be represented by one field.

The local projection must distinguish at least:

```text
authorization
  != adapter presence
  != task preparedness
  != lease ownership
  != process execution
  != result delivery
  != project acceptance
```

Examples:

- a workspace can be authorized but halted;
- a tmux session can be alive while no task is prepared;
- a task can be ready while no compatible Host Adapter is present;
- a process can exit zero while the owner's gate fails;
- an owner can publish a capability while the requester rejects it in a
  compatibility probe.

## 3. Project roles and authority

The initial project graph is:

```text
quay --requires--> meta-cc/session-evidence
  |
  +--requires--> archguard/architecture-evidence
  |
  +--offers--> task-gate-control-plane

meta-cc --uses--> quay/task-gate-control-plane
archguard --uses--> quay/task-gate-control-plane
```

These are versioned capability relationships, not ownership edges.

### 3.1 Quay

Quay owns:

- Provider-neutral task, gate, event, and qualified-reference contracts;
- local reconciliation and run/lease semantics;
- Host Adapter contracts and human-control projections;
- its own product and exp5 tasks;
- compatibility probes for capabilities Quay consumes.

Quay does not own meta-cc or archguard decomposition, task status, merge,
release, or domain acceptance.

### 3.2 meta-cc

meta-cc owns:

- Claude Code and Codex session discovery and normalization;
- provider-qualified query behavior;
- evidence provenance, degradation, redaction, and query reliability;
- release and installation contracts for its MCP/Skills;
- acceptance of meta-cc defects filed by consumers.

meta-cc findings can identify a likely task owner, but cannot close a Quay or
archguard task, grant a lease, or prove a milestone complete.

### 3.3 archguard

archguard owns:

- repository parsing and project-semantics discovery;
- dependency, cycle, concentration, and architecture-evidence contracts;
- architecture query schema and measurement reproducibility;
- acceptance of archguard defects filed by consumers.

An archguard metric can support a project gate or finding. It cannot by itself
decide that a change is valuable, correct, or accepted by the observed
project.

## 4. Near-term topology

Use three operational layers.

### 4.1 Project-local delivery loops

Each repository keeps its existing Quay board and loop configuration. Its loop
may SELECT, prepare, isolate, build, audit, integrate, and complete only tasks
owned by that repository.

One integration writer per repository remains mandatory. Cross-project
concurrency is allowed because repositories have separate writers; multiple
writers inside one repository still require explicit worktree isolation and a
single merge owner.

### 4.2 Local read-only coordination projection

The first control-plane implementation should be a local read-only reconciler,
not a global scheduler. It reads:

- registered project identity and policy;
- `.halt` and loop configuration;
- provider-qualified task counts and prepared/actionable tasks;
- Git HEAD, dirty state, worktrees, and integration branch;
- Host Adapter/tmux/process presence and capability;
- leases/runs when they exist;
- GateEvents, commits, and immutable result artifacts;
- meta-cc `SessionRef` values as optional diagnostic links.

An embedded SQLite database or append-only JSONL under user-level Quay state
is sufficient. Repository task boards and Git remain authoritative. The local
store holds events and projections, not copied canonical task bodies.

The first useful interface can be a CLI status view:

```text
PROJECT    AUTHORIZED  LOOP      PREPARED  LEASE/RUN       ADAPTER
quay       yes         halted    0         none            claude:present
meta-cc    yes         running   2         DIR-024/running claude:present
archguard  yes         dormant   0         none            unavailable
```

The values above are illustrative. Every field must be derived and retain its
observation timestamp.

### 4.3 Human portfolio control

The human control surface owns:

- which projects may be developed, merely observed, or used for validation;
- portfolio priority and maximum cross-project work in progress;
- mission redirection and changes to autonomy level;
- incompatible contracts and coordinated breaking releases;
- exhausted retry/cost budgets and destructive operations.

The current exp5 `drivable-workspaces.yml` has `scope: validation`. Ongoing
development of meta-cc and archguard requires a new explicit coalition policy;
the implementation must not reinterpret the existing scope.

## 5. Cross-project records

Qualified identifiers are mandatory because `DIR-024`, `TASK-30`, and similar
bare ids are ambiguous outside their repository.

### 5.1 Finding envelope

```yaml
schema: quay-finding/v1
finding_id: <stable-id>
origin_project: project:local/quay
observed_project: project:local/meta-cc
observed_capability: meta-cc/session-discovery/provider-aware
observer:
  tool: meta-cc
  version: <version>
  config_ref: <hash-or-ref>
evidence_refs:
  - session:codex/<opaque>
  - artifact:git/<commit>
reproduction:
  command_or_call: <redacted-reproduction>
  expected: <contract>
  observed: <result>
fingerprint: <owner+contract+reproduction-hash>
suggested_owner: project:local/meta-cc
authority: propose-only
```

Requirements:

- evidence is minimized and provenance-qualified;
- the fingerprint is stable under replay;
- routing may suggest an owner but the owner must accept;
- missing or denied evidence degrades explicitly;
- a replay cannot create a second owner task;
- the envelope never contains authority to mark work done.

### 5.2 Capability request

```yaml
schema: quay-capability-request/v1
request_id: <stable-id>
requester: project:local/quay
owner: project:local/meta-cc
requires: meta-cc/session-discovery/provider-aware@v1
requester_task_ref: task:native/quay/<id>
owner_task_ref: task:native/meta-cc/DIR-024
contract_ref: <schema-or-document>
requester_probe:
  command: <bounded-compatibility-probe>
acceptance:
  owner_gate_required: true
  requester_probe_required: true
```

The owner task reference may be empty until the owner accepts and deduplicates
the request. It is then linked; the request does not copy or control the owner
task body.

### 5.3 Capability release

```yaml
schema: quay-capability-release/v1
request_id: <stable-id>
owner: project:local/meta-cc
capability: meta-cc/session-discovery/provider-aware@v1
owner_task_ref: task:native/meta-cc/DIR-024
artifact_refs:
  - artifact:git/<commit>
owner_gate_events:
  - gate-event:<id>
compatibility:
  previous: <version-or-null>
  current: v1
```

A release means the owner has accepted its result. It does not mean the
requester has accepted compatibility.

## 6. Delegated-autonomy protocol

The legal flow is:

1. real use in requester A produces a provenance-qualified finding;
2. routing computes a suggested owner and fingerprint;
3. the suggested owner B accepts, rejects, defers, or deduplicates it;
4. on acceptance, B creates or links a B-owned `todo` task;
5. B authors and checks Proposal/Plan, then promotes the task to `ready`;
6. B's loop acquires its own lease, implements, gates, audits, and integrates;
7. B publishes a capability release with immutable evidence;
8. A reruns its own compatibility probe against the released artifact;
9. A and B each transition only their own task/request projection;
10. the relationship closes only when both owner delivery and requester
    compatibility acceptance are recorded.

The protocol must preserve these failure distinctions:

- owner rejected the request;
- owner accepted but has not prepared a task;
- task prepared but no adapter is available;
- run failed or lease expired;
- owner delivered but requester probe failed;
- requester accepted but a local projection is stale.

## 7. Discovery and execution remain separate lanes

External dogfooding, meta-cc history mining, and archguard scans are discovery
routines. They may:

- reproduce real behavior;
- emit a finding envelope;
- propose an owner and value classification;
- create a deduplicated owner candidate after policy permits the write.

They may not:

- promote their own finding to `ready`;
- run the resulting task in the same observation step;
- edit acceptance criteria to match an implementation;
- use an observer score as a Done-when;
- file an unbounded number of reciprocal findings.

Initial controls:

- FILE-only output;
- REFUTE-first objectives;
- one stable fingerprint per finding;
- per project-pair and per routine rate limits;
- a maximum of one active cross-project capability request during the first
  pilot;
- value classification and explicit non-goals;
- owner-side rejection and deduplication as normal outcomes;
- independent project gates and requester compatibility probes.

This prevents a positive-feedback loop in which three observers manufacture
work for one another and then cite the new task count as evidence of value.

## 8. Preparation boundary

An accepted foreign finding enters the owner board as `todo`, not `ready`.

The promotion boundary is:

```text
finding
  -> owner acceptance/deduplication
  -> substantive Proposal
  -> independent Proposal review
  -> executable milestone Plan
  -> grounded Plan check
  -> prepared receipt/gate
  -> ready
```

DIR-117's preparation mechanism is therefore a prerequisite for unattended
promotion of cross-project findings. Before that mechanism lands, the first
pilot may use manually reviewed, already substantive tasks, but automation
must not claim that the general promotion boundary exists.

Preparation remains owner-local. The requester may state its capability
contract and probe; it cannot prescribe the owner's internal implementation
Plan.

## 9. Scheduling and reconciliation policy

The local coordinator should initially reconcile and report; project loops
continue to schedule their own work.

A future coordinator may request a bounded run only when all are true:

1. coalition policy authorizes `develop` for the workspace;
2. the workspace is not halted;
3. the owner task is prepared and `ready`;
4. the required Host Adapter is present and reports the needed capability;
5. no valid conflicting integration-writer lease exists;
6. the base revision and prepared fingerprints still match;
7. project and portfolio concurrency/cost budgets permit the run;
8. retry or exception policy does not require a human.

Use event-triggered reconciliation for accepted requests, releases, run
completion, and adapter presence changes. A low-frequency periodic
reconciliation handles missed events and stale projections. Discovery cadence
should be based on completed work/checkpoints rather than aggressive wall-clock
polling.

tmux remote-drive remains a compatibility adapter. It must not become the
broker, lease store, or completion oracle. Its authorization, delivery,
started, and result verification steps should eventually emit the same run
events as a process or Codex adapter.

## 10. First pilot — Quay requests meta-cc provider-aware discovery

Use meta-cc DIR-024 as the first delegated-autonomy proof:

```text
quay requires
  meta-cc/session-discovery/provider-aware@v1

meta-cc owns
  DIR-024 implementation, tests, audit, integration, and release

quay owns
  a real Claude/Codex compatibility probe and acceptance of the capability
```

The requester probe must verify at least:

- `get_session_directory(provider=codex)` returns Codex rollout provenance,
  not a Claude project path;
- `get_session_metadata(provider=codex)` returns provider-appropriate raw
  schema and file metadata;
- the default Claude path remains compatible;
- missing or denied meta-cc/session evidence is explicit and does not disable
  Quay task/gate operation;
- replaying the same finding/request does not create another task or run.

This pilot proves qualified references, owner acceptance, owner-local delivery,
capability release, requester revalidation, evidence degradation, and project
sovereignty without requiring three-way scheduling.

## 11. Second pilot — Quay consumes an archguard evidence contract

After the meta-cc pilot passes, define one bounded architecture-evidence
contract such as:

```text
archguard/architecture-snapshot@v1
```

archguard owns the parser, schema, reproducibility, packaging, and release.
Quay runs the released snapshot capability against Quay and owns any resulting
Quay findings. A defect in archguard is routed back through a finding/request;
an architectural defect in Quay remains a Quay task.

The pilot must not let an archguard threshold directly close or fail a Quay
milestone unless Quay has explicitly adopted that measurement as a
project-owned gate with its own policy and negative tests.

## 12. Staged adoption

### Stage 0 — policy and operational hygiene

1. define stable project/workspace ids;
2. create a coalition policy that separately authorizes `observe`, `validate`,
   and `develop`;
3. retain `.halt` as project-local authority;
4. reconcile stale session names and worktree presence without deleting or
   starting anything;
5. set cross-project work-in-progress to one request.

### Stage 1 — schema and read-only projection

6. define finding, capability request/release, qualified TaskRef, adapter
   presence, and minimal run/event schemas;
7. implement a read-only local status projection over the three repositories;
8. prove that authorization, halt, presence, preparation, lease, and execution
   are reported independently;
9. deny transcript access and prove the projection still reconstructs legal
   run/task state.

### Stage 2 — manually accepted delegated-autonomy pilot

10. link a Quay request/probe to meta-cc DIR-024;
11. let meta-cc own and deliver the task through its existing loop;
12. publish a release envelope and run Quay's compatibility probe;
13. replay the request and events to prove idempotency.

### Stage 3 — prepared finding promotion

14. land or otherwise prove the DIR-117 preparation boundary;
15. adapt DIR-043/DIR-055 discovery to emit the finding envelope;
16. add owner acceptance, deduplication, rate limits, and `todo`-only creation;
17. prove an unprepared or stale finding cannot enter Build.

### Stage 4 — second project and bounded execution adapters

18. run the archguard evidence-contract pilot;
19. implement one bounded process/Codex Host Adapter with normalized run
    results;
20. wrap Claude/tmux as a compatibility adapter using the same events;
21. add structured human exceptions for missing adapters, incompatible
    releases, and exhausted retries.

Only after these stages should Quay consider automatic cross-project run
requests or a portfolio UI.

## 13. Acceptance criteria for an implementing directive

1. `[ ]` Quay, meta-cc, and archguard have stable project/workspace ids and a
   human-authored policy that distinguishes observe, validate, and develop.
2. `[ ]` A local read-only status command reports authorization, halt,
   presence, preparedness, lease/run, Git revision, and projection freshness
   independently for all three projects.
3. `[ ]` Removing a tmux session changes presence but not authorization, task
   state, or recovery legality.
4. `[ ]` A stable finding fingerprint deduplicates replay and preserves
   observer/tool/version/evidence provenance.
5. `[ ]` The suggested owner explicitly accepts, rejects, defers, or
   deduplicates a finding; routing alone cannot create an executable task.
6. `[ ]` An accepted foreign finding remains `todo` until the owner-local
   checked Proposal/Plan preparation gate passes.
7. `[ ]` The meta-cc DIR-024 pilot produces one owner release and one
   requester compatibility verdict without either project writing the other's
   canonical lifecycle state.
8. `[ ]` Missing or denied transcript evidence does not prevent task, gate,
   lease, or run recovery from authoritative state.
9. `[ ]` Replaying requests/events does not duplicate a task, run, worker,
   commit, GateEvent, or compatibility verdict.
10. `[ ]` One archguard evidence contract is consumed by Quay while
    archguard-owned defects and Quay-owned findings route to the correct
    boards.
11. `[ ]` Per-pair rate limits and a portfolio WIP limit prevent reciprocal
    discovery routines from creating an unbounded work loop.
12. `[ ]` A human can halt one project, revoke development authority, or
    disposition an incompatibility without typing into every active session.

## 14. Risks

### 14.1 Global-backlog centralization

Copying every task into Quay would make projections authoritative by accident
and permit one project to overwrite another's acceptance. Keep qualified
references and relationship state, not mirrored task ownership.

### 14.2 Reciprocal make-work

Three projects can continuously find minor defects in one another. Require
real reproduction, stable fingerprints, value classification, owner
acceptance, rate limits, WIP limits, and requester revalidation.

### 14.3 Observer authority creep

meta-cc and archguard are useful precisely because they inspect otherwise dark
axes. Their output must remain evidence. Enabling write tools or lifecycle
authority requires a separate explicit decision.

### 14.4 Presence mistaken for ownership

A live Claude, Codex, or tmux process is not a lease. A stale session name is
not proof of failure. Presence is a timestamped capability observation only.

### 14.5 Preparation bottleneck

Independent Proposal/Plan preparation adds cost. Cross-project ambiguity makes
that cost justified, but small tasks still need a short executable path.
Measure preparation latency and revision yield; do not bypass the boundary by
returning to `Plan: N/A`.

### 14.6 Contract-version cascades

A change in meta-cc or archguard may invalidate several consumers. Keep
contracts versioned, compatibility probes bounded, and breaking releases
human-visible until coordinated rollout semantics are proven.

## 15. Non-goals

- One global exp5 loop selecting from every repository.
- A central backlog that owns all project task bodies or statuses.
- Automatic installation, authentication, release, or deployment.
- Treating tmux, Claude Code, Codex, meta-cc, or archguard as the broker.
- Promoting raw findings directly to `ready`.
- Allowing observers to certify their own implementation.
- Using task count, error count, architecture scores, or session metrics as a
  scalar objective.
- Multi-machine operation before single-machine reconciliation, idempotency,
  leases, and recovery are proven.
- Replacing project-specific domain review with generic Quay gates.

## 16. Recommendation

Implement one narrow local coalition pilot:

1. record development/observation policy for Quay, meta-cc, and archguard;
2. add the schema-only records and a read-only status projection;
3. link Quay's provider-aware session need to meta-cc DIR-024;
4. let meta-cc deliver it through its own loop and gates;
5. let Quay independently run and record the compatibility probe;
6. replay the complete history and prove no duplicate effects.

Treat DIR-117 as the prerequisite for unattended promotion of later findings.
Then adapt the existing external-dogfooding and history-mining routines to the
finding envelope and add archguard as the second bounded evidence contract.

This sequence grows exp5 from self-improvement into project co-evolution while
preserving the property that makes the result trustworthy: every project
remains accountable for its own work, and evidence never silently becomes
authority.
