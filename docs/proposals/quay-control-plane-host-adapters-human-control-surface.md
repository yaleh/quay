# Quay as a control plane: Host Adapters and a human control surface

- **Status:** proposal / architecture discussion only. This document does not
  implement a broker, daemon, Host Adapter, remote executor, multi-machine
  transport, UI, task federation, or unattended loop. Adoption must enter the
  normal directive and milestone process.
- **Date:** 2026-07-26
- **Context:** the current repository already contains a task/gate substrate,
  Claude-specific workflows, a proposed Codex port, Manda action delivery,
  tmux-based cross-workspace driving, workspace authorization, concurrent
  milestone scheduling, and a growing human-steered exception queue. Recent
  Git and meta-cc history shows that these mechanisms are converging on a
  distributed control system, but their ownership boundaries remain implicit.
- **Related:**
  [`quay-proposal.md`](./quay-proposal.md) defines the Provider ABI and the
  host-owned action edge. ·
  [`exp5-codex-continuous-development-port.md`](./exp5-codex-continuous-development-port.md)
  applies this proposal's Host Adapter boundary to Codex. ·
  [`quay-codex-self-observation-tool-supply-chain.md`](./quay-codex-self-observation-tool-supply-chain.md)
  defines the evidence-adapter and tool-governance layer without moving
  transcript or telemetry authority into the control plane. ·
  [`local-multi-project-coevolution-pilot.md`](./local-multi-project-coevolution-pilot.md)
  applies delegated autonomy to the near-term single-machine collaboration
  among Quay, meta-cc, and archguard. ·
  [`baime-lite-driving-external-projects.md`](./baime-lite-driving-external-projects.md)
  discusses continuous development of external projects. ·
  [`quay-workflow-agent-distribution.md`](./quay-workflow-agent-distribution.md)
  records the current target-workspace distribution gap. ·
  [`ADR-016`](../../adr/ADR-016-cross-workspace-autonomous-operation-via-tmux-remote-drive.md)
  is the proven single-machine bootstrap mechanism. ·
  [`DIR-062`](../../tasks/DIR-062.md) defines the current drivable-workspace
  authorization boundary.

## 1. Decision summary

Quay should evolve as three explicitly separated systems:

1. **Quay control plane** — tasks, dependencies, workspace identity,
   permissions, leases, runs, GateEvents, recovery, budgets, and cross-project
   state.
2. **Host Adapters** — Claude Code, Codex, CLI, CI, tmux compatibility,
   and future local or remote executors.
3. **Human control surface** — goals, policy, authorization, exceptions, risk,
   cost, mission redirection, and cross-project portfolio decisions.

Claude Code and Codex sessions become replaceable execution processes. Their
transcripts remain valuable diagnostic evidence, including through meta-cc,
but a session must not be the authoritative store for orchestration state,
task ownership, delivery status, or project-to-project communication.

This is a boundary decision, not a decision to centralize every project under
one global autonomous loop. Each project retains ownership of its backlog,
gates, integration branch, release cadence, and domain oracle.

## 2. Why the boundary is now necessary

### 2.1 The current system already crosses the boundary informally

The repository has several partial implementations:

- the Provider-neutral task and gate surface;
- `quay action run`, which composes host-owned triggers and dispatches through
  Manda or degrades to printing a command;
- Claude workflows and Skills that perform selection, implementation, audit,
  and landing;
- the proposed Codex supervisor and worker/reviewer roles;
- tmux remote-drive, which injects input into a foreign Claude session and
  verifies results through Git, files, task state, and meta-cc;
- `drivable-workspaces.yml`, which turns human authorization into durable,
  machine-readable policy;
- concurrent milestone scheduling with worktree, merge-owner,
  audit-independence, and anti-drift rules.

Each mechanism answers part of "who may run what, where, and what happened?"
None owns the whole answer.

### 2.2 Session-shaped control creates recurring failure classes

When orchestration state lives primarily in a conversation, recovery requires
reconstructing intent from transcript context. This fails under:

- compaction or session loss;
- process death, machine sleep, or network interruption;
- a tool schema or host behavior changing mid-session;
- two humans or drivers acting on the same workspace;
- a message being typed but not delivered;
- a worker completing without waking its parent;
- a task reaching a different state than the conversation assumes.

Recent history contains all the weaker forms of these failures: repeated human
questions about what another session selected, whether milestones were
actually concurrent, which tasks were human-steered, and whether a finding
should be filed in another project's board.

### 2.3 Adding another loop would multiply the ambiguity

A Claude loop, a Codex loop, a CI loop, and a remote-project loop must not each
invent their own:

- task-to-run projection;
- lock and retry behavior;
- delivery acknowledgement;
- recovery state machine;
- human approval prompts;
- cross-project routing.

The reusable unit is a bounded run behind a Host Adapter, coordinated by one
control-plane protocol.

## 3. Architectural invariants

1. **Conversation is not state.** A legal transition can cite a session but
   cannot require that session to remain readable.
2. **Projects remain sovereign.** A foreign requester cannot declare another
   project's task done or bypass its gate.
3. **One integration writer per workspace.** Parallel workers may exist only
   behind explicit worktree/branch isolation and a single merge owner.
4. **Every effect is attributable.** Task transitions, messages, lease
   changes, retries, gate decisions, and human decisions produce durable
   events.
5. **Delivery is not completion.** `accepted`, `delivered`, `started`, and
   `completed` are distinct states.
6. **Retry is idempotent.** Replaying an event or request must not duplicate a
   worker, commit, task, merge, or external side effect.
7. **Policy is data, not chat memory.** Workspace scope, network access,
   approval requirements, budgets, and mission boundaries are versioned and
   inspectable.
8. **Human attention is exceptional.** Routine progress must not require a
   human to relay messages between sessions.
9. **Evidence and authority are separate.** A transcript, test result, or
   commit can support a decision; it does not grant authority to make it.
10. **Local and remote execution share semantics.** Transport changes must not
    change task, run, lease, acknowledgement, or recovery meaning.

## 4. System 1 — Quay control plane

### 4.1 Responsibilities

The control plane owns:

- workspace and project identity;
- task and cross-project dependency projections;
- run and attempt records;
- workspace and integration-writer leases;
- Host Adapter capability registry and presence;
- lifecycle events and GateEvents;
- scheduling, retry, timeout, cancellation, and crash recovery;
- policy evaluation and authorization decisions;
- cost, time, concurrency, and network budgets;
- evidence references and artifact identity;
- structured exceptions awaiting human disposition.

It does not own:

- the model's implementation reasoning;
- editor or terminal UI details;
- provider-specific task storage;
- a project's domain oracle;
- the contents of a Claude or Codex transcript.

### 4.2 Minimal entities

| Entity | Purpose |
|---|---|
| `Workspace` | Stable identity, repository roots, integration branch, policy, and owning project |
| `Project` | Backlog/gate authority and cross-project relationship endpoint |
| `TaskRef` | Provider-qualified task identity, never a globally ambiguous bare id |
| `Run` | One bounded requested outcome against one task/workspace/base revision |
| `Attempt` | One execution attempt for a run, tied to an adapter and idempotency key |
| `Lease` | Time-bounded authority to perform a specific writer or coordinator role |
| `SessionRef` | Opaque diagnostic pointer into a host; never authoritative state |
| `ArtifactRef` | Commit, report, log, test result, build, or other immutable evidence |
| `GateEvent` | Mechanical or adjudicated verdict with inputs and evidence |
| `Exception` | A structured decision that policy assigns to a human or project owner |
| `Capability` | Versioned offer or requirement exposed by a project or adapter |

Identifiers should be stable and qualified, for example:

```text
workspace:local/quay
task:native/quay/DIR-123
run:quay/DIR-123/01
attempt:quay/DIR-123/01/codex/02
session:codex/<opaque-host-id>
artifact:git/sha256:<digest>
```

The syntax is illustrative. The invariant is stable qualification, not this
exact spelling.

### 4.3 Run state

A baseline run state machine is:

```text
REQUESTED
ACCEPTED
LEASED
STARTING
RUNNING
AWAITING_RESULT
AWAITING_REVIEW
READY_TO_INTEGRATE
INTEGRATING
COMPLETED

terminal alternatives:
CANCELLED
FAILED
BLOCKED
EXPIRED
SUPERSEDED
```

Host process state and task lifecycle state are related but not identical. A
run can complete successfully while the task remains `ready` because review
failed. A host process can exit zero while the run fails its result schema.

### 4.4 Event log and projections

The durable primitive should be an append-only event stream. Task boards,
dashboards, current run state, pending exceptions, and adapter presence are
projections.

Events require at least:

- event id and timestamp;
- workspace/project/task/run/attempt identifiers as applicable;
- actor and authority source;
- idempotency key;
- previous and requested state;
- policy decision;
- evidence/artifact references;
- causal parent/correlation id;
- redaction-safe diagnostic detail.

SQLite or JSONL is sufficient for a single-machine pilot. Multi-machine
operation may use a network service, but it must preserve the same event
semantics.

### 4.5 Leases and ownership

Locks expressed only as process presence are insufficient. Leases must name:

- resource: workspace, integration branch, task, or run role;
- holder: adapter/attempt/human;
- permitted actions;
- acquisition and expiry timestamps;
- renewal rule;
- fencing token.

A stale process with an old fencing token cannot integrate after a new holder
has acquired the lease.

## 5. System 2 — Host Adapters

### 5.1 Purpose

A Host Adapter translates the control-plane run contract into one execution
environment and normalizes the result back. Initial adapters may include:

- Claude Code interactive/session adapter;
- Codex Goal/subagent/`codex exec` adapter;
- CLI/headless process adapter;
- CI job adapter;
- tmux compatibility adapter for an already-running foreign session;
- future authenticated remote executor adapter.

Manda, tmux, process spawning, scheduled chat follow-ups, and CI APIs are
transport or lifecycle mechanisms inside adapters. They are not control-plane
semantics.

### 5.2 Minimal contract

```text
capabilities(adapter) -> CapabilitySet
start(runSpec, idempotencyKey) -> Accepted
poll(attemptId) -> AttemptStatus
send(attemptId, message, idempotencyKey) -> DeliveryStatus
cancel(attemptId, reason, idempotencyKey) -> CancellationStatus
collect(attemptId) -> RunEnvelope
resume(runSpec, checkpoint, idempotencyKey) -> Accepted
```

Adapters may additionally support streaming events, interactive questions,
checkpoint export, worktree provisioning, or native scheduling.

### 5.3 Capability negotiation

Capabilities must be discovered, not assumed:

```yaml
host: codex
execution:
  bounded_headless: true
  interactive_session: true
  resume: true
  structured_output: true
isolation:
  worktree: true
  sandbox: workspace-write
communication:
  messages: true
  delivery_receipts: true
limits:
  max_concurrency: 4
```

If a required capability is absent, the control plane may choose another
adapter, reduce the run shape, or create an exception. It must not silently
pretend that inline execution provides fresh-context audit independence.

### 5.4 Normalized result envelope

At minimum:

```json
{
  "workspace_id": "workspace:local/quay",
  "task_ref": "task:native/quay/DIR-123",
  "run_id": "run:quay/DIR-123/01",
  "attempt_id": "attempt:quay/DIR-123/01/codex/01",
  "adapter": "codex",
  "base_revision": "<sha>",
  "result_revision": "<sha-or-null>",
  "outcome": "completed",
  "termination_reason": "result-produced",
  "artifacts": [],
  "gate_evidence": [],
  "blockers": [],
  "session_ref": "session:codex/<opaque>",
  "clean_worktree": true
}
```

The schema proves that the envelope is well formed, not that its claims are
true. Project gates, diff checks, tests, and independent audit remain the
truth checks.

### 5.5 Session references

A `SessionRef` permits:

- meta-cc inspection;
- human drill-down;
- debugging an adapter;
- correlating tool errors with a run.

It must not be used as:

- the only completion signal;
- the only store of a human decision;
- a task ownership token;
- a cross-project message address without durable delivery state;
- the source from which recovery infers the next legal transition.

## 6. System 3 — Human control surface

### 6.1 Human-owned decisions

The human control surface owns decisions that are inappropriate to infer from
execution activity:

- project goals and priority;
- mission redirection;
- authorization to drive a workspace or external system;
- destructive or irreversible operations;
- risk, cost, and privacy policy;
- conflicts between projects or stakeholders;
- acceptance where the domain oracle is insufficient;
- changes to autonomy level;
- disposition of repeated failures or exhausted retry budgets.

### 6.2 Structured exception inbox

`needs-human` alone is too weak. An exception should contain:

- the exact decision requested;
- why policy could not decide;
- affected projects, tasks, runs, and artifacts;
- safe options and their consequences;
- the system recommendation, if one exists;
- what work may continue while waiting;
- expiry/default behavior;
- the authority required to resolve it.

Example:

```yaml
type: cross-project-contract-change
question: Keep meta-cc v2 compatibility or coordinate a breaking release?
affected_projects: [quay, meta-cc, archguard]
options:
  - keep-compatible
  - coordinated-breaking-release
recommendation: keep-compatible
while_waiting: unrelated runs may continue
required_authority: project-owner
```

### 6.3 Interaction evolution

The intended progression is:

1. **Conversation-driven operation** — the human asks what another session is
   doing and manually relays commands.
2. **Asynchronous directives** — the human injects durable adjustments without
   interrupting the active run.
3. **Exception management** — the human sees only decisions automation cannot
   safely make.
4. **Policy management** — the human sets workspace, cost, network, approval,
   and mission rules in advance.
5. **Portfolio management** — the human reasons about cross-project capability
   dependencies, trade-offs, and counterfactual plans rather than individual
   sessions.

Conversation remains available for exploration and drill-down. It stops being
the default message bus and operations dashboard.

### 6.4 Required views

A useful control surface should eventually show:

- project/capability dependency graph;
- active runs, leases, adapters, and machines;
- blocked/retrying/recovered runs;
- pending human exceptions grouped by authority and impact;
- evidence and GateEvent provenance;
- cost/time/concurrency budget consumption;
- cross-project changes that will unlock or invalidate downstream work;
- session transcript links only as diagnostic drill-down.

## 7. Communication layers

Cross-project collaboration requires more than sending prompts.

| Layer | Content | Durable authority |
|---|---|---|
| Presence | adapter/machine/project availability and capabilities | capability registry + heartbeat |
| Task | requested outcome, dependencies, acceptance, priority | provider-qualified task records |
| Run | concrete execution, base revision, lease, attempt, result | run/event state |
| Session message | clarification, progress message, interactive response | ordered delivery records |
| Artifact | commit, report, test output, build, audit evidence | immutable artifact references |
| Policy | authorization, budget, autonomy, mission boundary | versioned policy and human decisions |

A higher layer cannot be inferred reliably from a lower one. In particular:

- session presence does not mean a task is leased;
- a delivered message does not mean a run started;
- process exit does not mean a task passed;
- a commit does not mean the receiving project accepted it;
- test success does not authorize release.

## 8. Single-machine and multi-machine operation

### 8.1 Single-machine pilot

A minimal implementation can use:

- local daemon or on-demand coordinator;
- SQLite or append-only JSONL event store;
- Unix socket or loopback HTTP;
- Git worktrees for writer isolation;
- process adapters for CLI/Codex;
- tmux adapter only for compatibility with existing Claude sessions;
- local artifact paths plus commit SHAs.

The existing tmux remote-drive contract remains valuable as a proven bootstrap
path. It should report control-plane acknowledgements around its three-step
`send-keys` operation and verify completion from files/Git/meta-cc, not become
the universal protocol.

### 8.2 Multi-machine extension

Multi-machine operation adds:

- authenticated project/adapter identity;
- encrypted transport;
- explicit machine capability and workspace registration;
- expiring leases with fencing tokens;
- artifact transfer or content-addressed storage;
- reconnect and event replay;
- clock-skew-tolerant ordering;
- secret scoping and log redaction;
- admission control for commands and network access.

Transport may be HTTPS/WebSocket, a message broker, or another mechanism. The
same run states, acknowledgements, idempotency keys, and project authority
rules must apply locally and remotely.

### 8.3 Failure semantics

The system must distinguish:

- adapter unreachable;
- machine unreachable;
- process dead;
- process alive but heartbeat stale;
- message accepted but not delivered;
- delivered but not started;
- completed but result unavailable;
- result available but gate failed;
- integrated but task projection stale.

Collapsing these into `failed` recreates the need for a human to inspect every
session manually.

## 9. Collaboration modes

### 9.1 Hierarchical orchestration

A coordinator owns SELECT, policy, merge, and ABSORB. Workers receive frozen
inputs and constrained leases. This matches exp5 and is appropriate for one
project with a clear integration owner.

### 9.2 Delegated autonomy

Project A requests a capability from project B. B owns decomposition,
scheduling, implementation, and acceptance on its own board. A observes a
versioned capability contract and may run compatibility probes, but cannot
declare B's task done.

### 9.3 Peer collaboration

Two projects create a shared relationship or cross-project epic while each
retains its own child tasks and gates. Completion requires both projects'
declared contract conditions, not one project's parent task overwriting the
other's lifecycle.

### 9.4 Human-supervised coalition

For high-impact changes, several projects may propose alternatives while a
human or designated project owner adjudicates value, compatibility, rollout,
and risk. The control plane supplies evidence and counterfactual impact; it
does not manufacture consensus.

## 10. Multi-project development and co-evolution

The control plane should model a project graph rather than one global backlog:

```text
quay --requires--> meta-cc/session-query-v3
  |
  +--validated-on--> archguard
  |
  +--adapts-to--> claude-code
  |
  +--adapts-to--> codex
```

Useful cross-project relationships include:

- `requires` / `offers`;
- `blocks`;
- `validated-on`;
- `compatible-with`;
- `supersedes`;
- `affected-by`;
- `evidence-for`.

A co-evolution loop is:

1. real use in A produces evidence;
2. routing decides whether the finding belongs to A, B, or a shared contract;
3. the owning project accepts, defers, rejects, or deduplicates the request;
4. the owner implements and publishes a capability/version event;
5. dependent projects rerun compatibility probes;
6. the cross-project dependency closes only after each owner accepts its own
   result.

Automatic routing requires evidence, deduplication, rate limits, and value
classification. Otherwise cooperating projects can create a self-reinforcing
make-work loop.

## 11. Relationship to existing Quay concepts

### 11.1 Provider ABI remains data-oriented

This proposal does not put execution into the Provider ABI. Providers continue
to supply task data, writes, manifests, and optional gates. Host Adapters and
run lifecycle belong to the control plane.

### 11.2 Action remains a host-owned edge

`quay action run` is an early form of Host Adapter dispatch. Its current
Manda/print behavior should eventually project into the run and delivery
acknowledgement model. It should not become a Provider capability.

### 11.3 GateEvent grows in importance

GateEvents become the bridge between execution evidence and lifecycle
authority. Cross-project consumers may observe them, but only the owning
project's policy determines which GateEvents permit its state transitions.

### 11.4 Directives become one human-control input

Directives remain a strong asynchronous steering mechanism. They become one
input type to the human control surface, alongside policy changes, approvals,
exception dispositions, and portfolio priorities.

## 12. Security and trust boundaries

- A Host Adapter receives only the workspace, tools, secrets, and network
  access required by its run.
- Cross-project visibility does not imply write authority.
- Remote machines require explicit registration and revocation.
- Artifact and event inputs from another project are untrusted until verified.
- Human decisions record actor, authority, scope, and policy version.
- Session transcripts may contain secrets and require separate access control
  from task/run metadata.
- Destructive, release, deployment, billing, credential, and external-message
  actions require separately declared policy.
- A lease grants a narrow role, not general workspace ownership.

## 13. Adoption sequence

1. **Schema-only model:** define identifiers, run envelope, event,
   acknowledgement, lease, exception, and Host Adapter schemas.
2. **Single-machine read-only projection:** observe current Claude/exp5 runs
   without changing their behavior; correlate tasks, sessions, commits, and
   GateEvents.
3. **One bounded process adapter:** execute a fixture run and recover it without
   reading its transcript.
4. **Codex adapter pilot:** complete the bounded Codex cycle described in the
   Codex port proposal.
5. **Claude compatibility adapter:** wrap existing workflow/session execution;
   keep tmux as a compatibility transport where necessary.
6. **Two-project delegated-autonomy pilot:** one project requests a capability,
   the second owns delivery, and both independently accept the result.
7. **Human exception inbox:** replace ad hoc session inspection for a narrow
   class such as workspace authorization or exhausted retry budget.
8. **Multi-machine transport:** add identity, encrypted event delivery, fencing,
   replay, and artifact exchange only after local recovery semantics are
   proven.
9. **Portfolio view:** add dependency impact and policy management after the
   underlying events are trustworthy.

The near-term Quay/meta-cc/archguard pilot is specified separately in
[`local-multi-project-coevolution-pilot.md`](./local-multi-project-coevolution-pilot.md).
It refines steps 2 and 6 above into an incremental local sequence:

1. distinguish durable authorization from transient adapter/session presence,
   task preparedness, leases, runs, delivery, and project acceptance;
2. add a read-only projection before adding cross-project scheduling;
3. prove one Quay → meta-cc capability request whose owner delivery and
   requester compatibility verdict remain separate;
4. require owner-local checked Proposal/Plan preparation before findings may
   become executable;
5. add archguard only as the second bounded evidence contract, after the first
   relationship is replay-safe and idempotent.

The existing exp5 drivable-workspace registry has `scope: validation`. It must
not be reinterpreted as portfolio-wide development authorization; that wider
scope requires a new explicit human policy record.

## 14. Acceptance criteria for a future implementation

1. `[ ]` Claude, Codex, and a plain process fixture implement or simulate the
   same versioned Host Adapter contract.
2. `[ ]` A run can be reconstructed and legally resumed with its original
   session transcript unavailable.
3. `[ ]` Accepted, delivered, started, and completed are independently
   observable and tested.
4. `[ ]` Replaying every command/event does not duplicate a worker, task,
   commit, merge, GateEvent, or external side effect.
5. `[ ]` Lease expiry and fencing prevent a stale writer from integrating after
   ownership transfers.
6. `[ ]` Two projects exchange a capability request/result without either
   project writing the other's canonical lifecycle state.
7. `[ ]` A local and a remote adapter produce equivalent run/event semantics.
8. `[ ]` A structured human exception contains decision, reason, impact,
   options, authority, and safe waiting behavior.
9. `[ ]` The human can halt/restrict future work through durable policy without
   typing into each active session.
10. `[ ]` meta-cc can follow `SessionRef` for diagnostics, while deleting or
    denying that transcript does not break control-plane recovery.
11. `[ ]` Provider ABI conformance remains unchanged; execution does not leak
    into Provider-specific branches.
12. `[ ]` A cross-project finding is evidence-gated, deduplicated, rate-limited,
    accepted by the owning project, and revalidated by the requester.

## 15. Open decisions

- Is the first event store embedded per workspace, one local hub, or both with
  replication later?
- Which relationships belong in the canonical task view-model versus a
  separate cross-project projection?
- How are project and human identities represented before multi-user auth
  exists?
- Which actions require exactly-once effects, and which can use at-least-once
  delivery plus idempotency?
- How should an adapter checkpoint enough state to resume an interactive
  session without making transcript history authoritative?
- What is the minimal domain-oracle contract for delegated autonomy?
- How are costs attributed across requester, executor, and shared validation
  projects?
- What is the default behavior when a human exception expires?
- Does a future hosted hub synchronize full task bodies or only qualified
  references and capability state?

## 16. Non-goals

- Building one global autonomous agent that owns every project.
- Replacing Git, task Providers, project-specific gates, or domain review.
- Treating tmux, Manda, Claude Code, Codex, or meta-cc as the universal broker.
- Requiring every project to expose its full backlog or transcripts.
- Optimistically mutating task state when a message is sent.
- Inferring human authorization from prior conversation.
- Starting unattended multi-machine development merely because this proposal
  exists.

## 17. Recommendation

Implement the boundary before adding another perpetual loop or another
session-specific dispatch path. Start with schemas and a read-only projection
over the existing system, then prove one bounded run whose recovery does not
depend on its conversation.

The first cross-project proof should use delegated autonomy: Quay requests a
small, versioned capability from a second project; that project owns its task
and gate; Quay reruns a compatibility probe after delivery. This exercises the
control plane, Host Adapter boundary, project sovereignty, evidence routing,
and human exception path without prematurely centralizing both projects.

The desired end state is not a human controlling more sessions more
efficiently. It is a system in which sessions are disposable, projects remain
accountable, routine coordination is durable, and human attention is reserved
for goals, policy, risk, and decisions that software cannot honestly make.
