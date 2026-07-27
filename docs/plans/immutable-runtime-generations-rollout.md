# Plan: immutable runtime generations and atomic activation rollout

- **Status:** program plan; no implementation or task creation is authorized by
  this document.
- **Date:** 2026-07-27
- **Source proposal:**
  [`quay-immutable-runtime-generations-and-atomic-activation.md`](../proposals/quay-immutable-runtime-generations-and-atomic-activation.md)
- **Related architecture:**
  [`quay-control-plane-host-adapters-human-control-surface.md`](../proposals/quay-control-plane-host-adapters-human-control-surface.md),
  [`exp5-driver-deliverability-packaging.md`](../proposals/exp5-driver-deliverability-packaging.md),
  [`exp5-codex-continuous-development-port.md`](../proposals/exp5-codex-continuous-development-port.md),
  and
  [`local-multi-project-coevolution-pilot.md`](../proposals/local-multi-project-coevolution-pilot.md).
- **Identifier discipline:** this plan intentionally assigns no task/directive
  numbers. Stable workstream names `GEN-A` through `GEN-I` are used below.
  When tasks are later created, their actual identifiers are allocated from the
  then-current workspace state and recorded in a separate mapping. Renumbering
  tasks must not require editing this plan.
- **Planning level:** this is a multi-milestone dependency and delivery plan.
  Each implementing milestone still requires its own checked task Proposal,
  checked executable milestone Plan, grounded touch set, line budget, and
  independent audit before Build.

## 1. Outcome

Deliver one project-neutral, immutable Quay engine release mechanism that is
used in the same way for:

1. Quay developing and evolving itself; and
2. Quay continuously driving another project such as meta-cc.

Project differences must be expressed through the existing provider, gate,
loop, routine, and budget configuration surfaces wherever possible. A custom
extension is permitted only for a capability that cannot be represented by
those surfaces. Extensions use a versioned ABI and are snapshotted into the
same immutable generation model; an active run never reads editable extension
source.

At the end of the required rollout:

- a run is pinned to one attested generation from start to finish;
- source edits cannot alter that in-flight run;
- build, install, and activation are separate operations;
- activation is boundary-only, compare-and-swap, fenced, health-checked, and
  rollback-capable;
- the same engine generation continuously drives Quay and at least one foreign
  workspace;
- the old trusted generation may autonomously construct, test, and audit a
  candidate successor;
- mission, authority, state migration, activation-root, and root-of-trust
  changes remain human-controlled.

## 2. Delivery principles

### 2.1 One mechanism, multiple instances

The implementation has four layers:

| Layer | Shared mechanism | Per-project data |
|---|---|---|
| Engine generation | workflows, skills, runner, generation tooling, Host Adapter contract | none |
| Instance configuration | one schema and parser | provider, gates, loop policy, routines, budgets, adapter choice |
| Extension generation | one ABI, builder, verifier, and loader | only necessary domain policy/oracle implementations |
| Runtime state | one run/event/lease/activation schema | workspace-local state and active pointer |

Quay's self-hosting instance is not allowed a private fork of the engine. Its
value-typed selection policy, research probes, and project-specific methodology
are instance configuration or a normal project extension.

### 2.2 Configuration before extension

Before adding an extension hook, the implementing milestone must show why the
requirement cannot be expressed through:

- Provider selection and task-store configuration;
- named gate commands and arguments;
- loop selection-policy configuration;
- routine/probe scheduling;
- Host Adapter selection;
- budgets, halt conditions, and workspace authorization;
- an external command that returns a versioned result envelope.

If one of those is sufficient, adding executable extension code is rejected.

### 2.3 Installed runtime before editable source

The active engine and active extensions resolve from an immutable installed
release. Editable repository paths are build inputs only. Compatibility copies
under host-specific directories may remain during migration, but after cutover
they are not authoritative runtime inputs.

### 2.4 Every phase leaves a sustainable driver

No phase may require disabling the current driver before its replacement has
passed a real, sustained run:

- before activation exists, the legacy driver remains active;
- before self-hosting cutover, the installed candidate runs as an isolated
  canary;
- before external-project adoption, that project's existing loop remains its
  recovery path;
- before any automatic promotion, manual activation and rollback remain fully
  usable.

## 3. Target configuration and state boundary

The exact schema is finalized by `GEN-B`, but the intended shape is:

```yaml
runtime:
  engine: quay-loop
  hostAdapter: claude
  releaseStore: user
  activationPolicy: manual
  extensions:
    - id: project-policy
      source: .quay/extensions/project-policy

providers:
  # existing project-owned provider configuration

gates:
  # existing project-owned gate configuration

loop:
  # existing project-owned policy, routines, stop, audit, concurrency, budgets
```

The configuration does not contain a mutable release directory or overwrite
the active generation. The workspace-local active pointer and activation
events live under runtime state, for example:

```text
.quay/runtime/
  active.json
  activation-events.jsonl
  runs/
  leases/
```

Immutable releases are stored by content identity outside editable source, for
example in a user-level Quay data store:

```text
<runtime-store>/
  releases/<generation-id>/
  candidates/<build-id>/
```

Tests and disposable fixtures may override the store path explicitly. No
production command infers a store by searching for the current repository.

## 4. Dependency graph

```text
Checked Proposal/Plan preparation + current SELECT safety
                         │
                         ▼
                 GEN-A ───── GEN-B
                    \         /
                     ▼       ▼
                       GEN-C
                         │
                         ▼
                       GEN-D
                         │
                         ▼
                       GEN-E
                         │
                         ▼
                       GEN-F
                         │
                         ▼
                       GEN-G
                         │
                         ▼
                       GEN-H
                         │
                   evidence threshold
                         │
                         ▼
                       GEN-I
```

`GEN-I` is an evidence-gated follow-on. The system is useful and the required
self-hosting/external-project parity goal is achieved at `GEN-H`; automatic
activation is not a prerequisite for manually governed continuous operation.

## 5. Pre-implementation preparation

Before `GEN-A` enters Build:

1. the autonomous SELECT path must honor explicit human-steering exclusions;
2. the checked Proposal/checked Plan preparation boundary must be operational,
   or the same process must be performed manually under halt;
3. the repository and active sessions must be inspected for concurrent work;
4. bootstrap and root-of-trust work must run under the project halt boundary;
5. the active legacy runtime and manual recovery command must be recorded;
6. each workstream receives a separately checked milestone Plan rather than
   treating this program plan as an executable file-level implementation plan.

This plan does not allow a bootstrap milestone to exempt itself from the
controls it is introducing.

## 6. Phase 1 — installed-runtime MVP

**Workstreams:** `GEN-A`, `GEN-B`, `GEN-C`, `GEN-D`

**Phase product:** an immutable installed generation can continuously drive a
disposable real workspace from a fresh host process without reading editable
Quay engine source. The legacy Quay driver remains active and unchanged until
Phase 2.

### 6.1 GEN-A — effective artifact closure and runtime attestation

#### Objective

Make the current source/runtime/cache ambiguity observable before introducing
new packaging or activation behavior.

#### Expected implementation surfaces

- a versioned loaded-artifact-attestation schema under `schemas/`;
- runtime inspection logic under `packages/quay/src/runtime/`;
- CLI plumbing in `packages/quay/bin/quay.ts`;
- focused tests under `packages/quay/test/`;
- thin Host Adapter probes for current Claude, plain-process, and, where
  discoverable without implementing the full port, Codex surfaces.

Names are finalized by the checked milestone Plan. Inspection logic must remain
separate from provider/task lifecycle code.

#### Stages

1. **Schema and fixture RED cases `[code]`**
   - define requested/effective generation, resolved artifact, role, path,
     digest, source, cache/fallback, host version, and config-snapshot fields;
   - reject unknown schema versions, missing digests, and unqualified fallback.
2. **Read-only inspector `[code]`**
   - enumerate workflow, skill, plugin, MCP, instruction, dependency, config,
     and session-private inputs;
   - distinguish editable source, installed artifact, generated mirror, cache,
     and unresolved host-owned input;
   - never mutate plugin/host configuration during inspection.
3. **Real-session evidence `[verification]`**
   - inspect the active Quay Claude session;
   - inspect one foreign-workspace session using the same schema;
   - record current source/install/cache divergences as evidence, not silently
     normalize them.

#### Acceptance

- a machine-readable inspection identifies every known load-bearing current
  artifact or marks it unresolved;
- a deliberately hidden/unreadable artifact produces a fail-closed,
  actionable result;
- task/run state remains inspectable when transcript access is denied;
- no inspected host, plugin, source tree, or active session is modified;
- output for Quay and a foreign workspace validates against the same schema.

#### Phase-continuity rule

The legacy loop continues running exactly as before. This workstream adds only
observation and evidence.

### 6.2 GEN-B — portable runtime configuration and minimal extension ABI

#### Objective

Define one configuration and extension boundary before engine packaging bakes
project-specific assumptions into the release.

#### Expected implementation surfaces

- runtime section parsing in `packages/quay/src/config.ts` or a narrowly scoped
  runtime config module;
- a versioned runtime/extension schema under `schemas/`;
- validation through CLI and MCP-compatible code paths;
- project-neutral documentation and plugin packaging checks;
- example Quay and meta-cc configurations kept as fixtures or proposals until
  cross-project writes are separately authorized.

#### Stages

1. **Configuration contract `[code/config]`**
   - define engine name, release-store policy, Host Adapter, activation policy,
     extensions, compatibility floors, and budgets;
   - preserve existing provider/gate/loop/routine configuration;
   - fail closed on unknown executable extension capability or incompatible ABI.
2. **Minimal extension contract `[code]`**
   - declare capability, ABI version, config schema, artifact list, and result
     envelope;
   - forbid lifecycle override, activation override, authority expansion, and
     direct active-state mutation;
   - require extension source to be built/snapshotted before use.
3. **Configuration-first proof `[verification]`**
   - express ordinary differences between Quay and meta-cc through existing
     configuration;
   - for every proposed extension, record the configuration mechanisms tried
     and the missing semantic capability.

#### Acceptance

- Quay and a foreign project validate with the same runtime-config checker;
- the engine/plugin package contains no fixed workspace root or project name;
- an extension cannot override core lifecycle/activation contracts;
- a mutable extension source path cannot be used directly as an active input;
- at least one apparent customization is demonstrated to need configuration
  only;
- all unavoidable extensions have bounded versioned capabilities and negative
  fixtures.

#### Phase-continuity rule

Configuration validation is additive. Existing workspaces without the runtime
section retain their legacy path until explicit migration.

### 6.3 GEN-C — immutable generation builder, store, and installer

#### Objective

Produce content-addressed, immutable candidates without changing which runtime
new runs use.

#### Expected implementation surfaces

- generation manifest and canonicalization under
  `packages/quay/src/runtime/`;
- build/store/install/verify/list CLI commands;
- plugin build and vendor-sync integration;
- package/distribution tests and isolated store fixtures;
- generation provenance recording source revision, builder generation,
  toolchain, configuration schema range, and artifact hashes.

#### Stages

1. **Manifest and canonical hash `[code]`**
   - canonicalize artifact ordering and manifest encoding;
   - derive generation ID from manifest content plus artifact digests;
   - reject path traversal, duplicate paths, mutable references, and missing
     artifacts.
2. **Staged build `[code]`**
   - resolve a clean source revision and declared inputs;
   - build into a unique staging directory;
   - package engine, Host Adapter assets, and snapshotted extensions;
   - verify, fsync as required, atomically rename into the release store, then
     make the release read-only.
3. **Install and verify `[code]`**
   - install immutable release content from local build or distribution;
   - resolve mutable branch/tag sources to source commit and artifact hashes;
   - make repeated install of the same generation idempotent;
   - never update active state.
4. **Fresh-clone and corruption proof `[verification]`**
   - install from a fresh clone/archive without resolving runtime assets from
     the Quay checkout;
   - corrupt a copied fixture release and prove verification fails;
   - kill a build in staging and prove the active legacy driver is unaffected.

#### Acceptance

- two generations coexist without writable shared engine files;
- identical declared inputs produce the same ID, or every nondeterministic
  input is surfaced and makes identity distinct;
- partial build output is never accepted as a generation;
- `build` and `install` leave active state byte-identical;
- a read-only installed release passes standalone plugin/MCP/workflow
  completeness checks;
- the release records the builder identity rather than claiming to be
  self-authenticating.

#### Phase-continuity rule

The output is a candidate store only. The legacy runtime continues all normal
driving.

### 6.4 GEN-D — generation-pinned launcher and fresh-host canary

#### Objective

Run a sustained, bounded loop from an explicit installed generation before
production activation exists.

#### Expected implementation surfaces

- versioned Host Adapter prepare/start/attest/health/drain/stop contract;
- a plain-process fixture adapter;
- a Claude compatibility adapter;
- generation-pinned launch command;
- an `execute-milestone` vertical-slice package and conformance fixtures;
- structured run/attempt evidence identifying generation and config snapshot.

Codex later implements the same contract; this workstream must not add
Claude-only fields to the core run or activation schema.

#### Stages

1. **Adapter contract and process fixture `[code]`**
   - prepare a generation/config snapshot;
   - start and attest a process;
   - drain/stop it without transcript dependence;
   - prove requested and effective generation equality.
2. **Claude pinned adapter `[code/config]`**
   - start a fresh session/process using the candidate;
   - resolve host caches explicitly;
   - reject fallback to workspace/global artifacts not declared by the
     generation.
3. **Workflow vertical slice `[code]`**
   - package `execute-milestone` and its complete loaded closure;
   - cover object and JSON-string argument forms;
   - cover passing, concerns/refutation, audit-artifact, disposition, and
     ABSORB paths.
4. **Sustained canary `[verification]`**
   - run multiple consecutive real cycles in a disposable workspace;
   - edit candidate source during the run and prove behavior is unchanged;
   - restart the adapter and resume using the same generation;
   - deny transcript history and reconstruct legal run state from durable
     records.

#### Acceptance

- the canary proves which generation and config snapshot it actually loaded;
- undeclared fallback invalidates evidence rather than producing a warning-only
  pass;
- several consecutive cycles complete without reading editable engine source;
- both successful and deliberately refuted work follow the expected lifecycle;
- current source edits do not affect the in-flight run;
- stopping the canary leaves the legacy production driver available.

#### Phase exit gate

Phase 1 completes only when a fresh installed generation, not a source checkout,
has continuously driven the disposable workspace through multiple cycles. Unit
fixtures alone are insufficient.

## 7. Phase 2 — atomic activation and Quay self-hosting cutover

**Workstreams:** `GEN-E`, `GEN-F`

**Phase product:** Quay's real continuous-development loop runs from an
installed generation. A trusted `G` builds and verifies `G+1`; promotion is
manual, atomic, fresh-session, health-checked, and rollback-capable.

### 7.1 GEN-E — fenced manual activation, health checking, and rollback

#### Objective

Add workspace-scoped activation without coupling activation to build/install or
assuming that filesystem pointer replacement reloads an existing process.

#### Expected implementation surfaces

- active-generation pointer and activation-event schemas;
- activation lease and writer-fencing integration;
- compare-and-swap activation and rollback commands;
- Host Adapter restart/health integration;
- state/config compatibility checks;
- crash-recovery and stale-writer tests.

#### Stages

1. **Pointer, lease, and CAS `[code]`**
   - require expected old generation and verified candidate;
   - acquire activation and integration-writer authority;
   - atomically replace a complete pointer manifest on one filesystem;
   - assign a stable activation ID.
2. **Fresh-host transition `[code]`**
   - drain the old run at a clean boundary;
   - start a new process/session pinned to the candidate;
   - attest and health-check it;
   - never tell an existing session to hot-reload.
3. **Rollback and recovery `[code]`**
   - restore the prior verified pointer on start/health failure;
   - reconcile pointer and event-log state after crashes;
   - fence an old writer from integration after ownership changes.
4. **State compatibility `[code]`**
   - check config/state read and write ranges before pointer replacement;
   - reject irreversible or backward-incompatible migrations from ordinary
     activation.
5. **Failure injection `[verification]`**
   - terminate before pointer replacement, after replacement, before event
     append, during host start, and during health check;
   - replay recovery and prove idempotency.

#### Acceptance

- build/install cannot activate;
- stale expected-generation and missing lease fail before changing the pointer;
- pointer replacement never implies an old process reloaded;
- a stale writer cannot integrate after fencing;
- every injected crash converges to one observable active generation;
- failed health check restores a healthy prior generation;
- rollback changes neither source history nor past runtime events;
- incompatible state/schema change requires a separately governed migration.

#### Phase-continuity rule

Manual legacy start remains documented and tested until the self-hosting
cutover workstream has completed its recovery demonstration.

### 7.2 GEN-F — Quay self-hosting cutover

#### Objective

Move Quay's real EXP5 evolution from editable workflow/plugin artifacts to the
same installed-runtime path intended for every other project.

#### Stages

1. **Instance conversion `[config/extension]`**
   - express providers, gates, halt, routines, concurrency, budgets, and
     ordinary policy through `.quay/config.yml`;
   - package only irreducible value-typed/research behavior as a Quay-owned
     extension;
   - snapshot that extension into each generation.
2. **Runtime-path cutover `[code/config]`**
   - make installed generation the normal startup path;
   - remove authoritative runtime reads from editable `.claude` mirrors,
     experiment workflow source, and development bundle paths;
   - retain source as candidate input and preserve a tested manual recovery
     command.
3. **Real `G` operation `[verification]`**
   - run at least two real Quay milestones from installed `G`;
   - record generation/config attestation for selection, build, audit, and
     landing.
4. **Successor proof `[verification]`**
   - use `G` to modify source and build `G+1`;
   - verify `G+1` in a fresh canary and independent audit;
   - manually activate `G+1`;
   - run a subsequent real milestone under `G+1`.
5. **Rollback drill `[verification]`**
   - roll back without reverting source or overwriting task/events;
   - restore `G+1` through the same activation protocol if healthy.

#### Acceptance

- Quay's production run attests an installed generation and no editable
  engine/extension source in its loaded closure;
- `G` remains behaviorally stable while producing `G+1`;
- `G+1` evidence is prospective; the builder milestone does not claim its
  earlier phases used `G+1`;
- the first post-activation real milestone is governed entirely by `G+1`;
- manual halt, activation, rollback, and recovery remain usable without
  conversational context;
- project-specific behavior is configuration or a declared extension, not a
  fork of core workflow files.

#### Phase exit gate

Phase 2 completes only after real self-hosted successor construction,
activation, subsequent use, and rollback are all demonstrated.

## 8. Phase 3 — external-project parity

**Workstream:** `GEN-G`

**Phase product:** the exact same engine generation used by Quay continuously
drives a real meta-cc development task through meta-cc-owned configuration,
state, acceptance, and optional bounded extensions.

### 8.1 GEN-G — meta-cc parity pilot

#### Objective

Prove that the self-hosting design is the ordinary product mechanism, not a
Quay-only special case later wrapped for others.

#### Preconditions

- explicit authority to prepare and develop the meta-cc workspace;
- a checked owner-local task Proposal and milestone Plan;
- a healthy installed generation already used by Quay;
- independent halt, active-pointer, lease, and recovery state for both
  workspaces.

#### Stages

1. **Owner configuration `[config]`**
   - adopt the same runtime schema;
   - configure meta-cc provider, gates, loop policy, routines, budgets, and Host
     Adapter;
   - add no extension unless configuration-insufficiency evidence passes
     review.
2. **Same-generation install `[verification]`**
   - select the exact engine digest already used by Quay;
   - attest meta-cc's effective artifacts and config snapshot;
   - prove no Quay experiment/source path is resolved.
3. **Real continuous development `[verification]`**
   - complete multiple real meta-cc cycles, including one task with a normal
     success path and one controlled failure/refutation/revision path;
   - let meta-cc own task lifecycle and acceptance;
   - exchange findings/releases through qualified cross-project records.
4. **Isolation and recovery `[verification]`**
   - halt/rollback Quay without changing meta-cc;
   - halt/rollback meta-cc without changing Quay;
   - restart each adapter independently from durable state.

#### Acceptance

- Quay and meta-cc attest the same engine digest;
- the configuration difference fully explains ordinary behavioral differences;
- any custom extension has a reviewed, mechanically enforced necessity and a
  bounded ABI;
- neither workspace writes the other's canonical task status;
- both can continue, halt, activate, and roll back independently;
- meta-cc completes real sustained development, not only a fixture;
- the engine release contains no project-specific workspace path or value
  policy.

#### Phase exit gate

Do not add archguard as another execution instance until this two-project pilot
is replay-safe, independently recoverable, and free of copied core workflows.
Archguard must reuse the same onboarding path.

## 9. Phase 4 — artifact-aware candidate automation

**Workstream:** `GEN-H`

**Phase product:** implementation work for a successor generation can be
autonomously selected, built, tested, canaried, and audited when it cannot
affect the active run. Production activation remains human-controlled.

### 9.1 GEN-H — steering classifier and candidate pipeline migration

#### Objective

Replace path-name-based self-modification decisions with generation-aware
artifact and authority reasoning without weakening mission or root-of-trust
controls.

#### Stages

1. **Risk result schema `[code]`**
   - emit one or more of `ordinary-change`, `engine-candidate`,
     `runtime-self-modifying`, `mission-steered`, `authority-steered`,
     `root-of-trust-change`, `state-migration`, and
     `unauthorized-workspace`;
   - cite concrete write-set/artifact intersections and policy sources.
2. **Loaded-closure classifier `[code]`**
   - intersect declared/derived task writes with the run's attested closure;
   - detect changes to resolution, builder, verifier, activation, rollback, and
     state interpretation;
   - retain explicit human labels as an independent override.
3. **Candidate/activation split `[code/workflow]`**
   - let eligible work modify source and produce an isolated candidate;
   - run build, tests, fresh-host canary, and independent audit autonomously;
   - emit an activation request/exception rather than activating.
4. **Negative safety corpus `[code]`**
   - active-release write, active pointer, cache/resolution, mission, halt,
     workspace authority, builder, verifier, migration, and rollback cases all
     fail closed;
   - isolated source-only candidate edits remain eligible.
5. **Real automation proof `[verification]`**
   - select a real task previously excluded only because it edited driver-like
     source;
   - let trusted `G` autonomously produce and verify `G+1`;
   - require a human activation decision;
   - compare classification in Quay and meta-cc under the same engine.

#### Acceptance

- a source pathname alone no longer determines self-affecting status;
- writing any attested active artifact is excluded;
- mission/authority/root-of-trust changes remain excluded even without a
  conventional driver pathname;
- missing write set or unresolved loaded closure fails closed;
- a real engine-candidate task completes autonomous candidate work;
- activation remains a small structured human decision;
- both projects use the same classifier code and differ only through explicit
  authority/configuration inputs.

#### Phase exit gate

Measure the proportion of implementation/build/verification work completed
autonomously, not only task-label counts. Record candidate rejection, unattested
run, manual decision duration, and rollback rates.

## 10. Phase 5 — evidence-gated automatic promotion

**Workstream:** `GEN-I`

**Phase product:** a narrowly allowlisted, low-risk generation change may
activate automatically at an idle boundary with automatic rollback. This phase
is optional and must not delay the manually governed product.

### 10.1 Entry evidence

Before planning implementation, require:

- two workspaces operating through the common installed runtime;
- repeated healthy manual promotions;
- successful forced-crash recovery at every activation boundary;
- at least one health-check-triggered rollback;
- no unresolved unattested production run;
- a human-approved low-risk change class;
- a tested global and workspace-local kill switch.

The implementing milestone records the actual evidence threshold and why it is
sufficient; this program plan does not convert an arbitrary count into policy.

### 10.2 GEN-I — narrow automatic promotion

#### Allowed initial class

Only workflow-mechanics changes with:

- no mission, authority, halt, state-schema, builder, verifier, activation,
  rollback, dependency-policy, or external-side-effect change;
- complete artifact attestation;
- fresh-host canary and independent audit pass;
- workspace idle and within budget;
- no halt sentinel or pending human exception.

#### Stages

1. **Policy and allowlist `[code/config]`**
   - explicit deny-overrides-allow evaluation;
   - human-authored versioned policy;
   - no task may classify itself into the allowed class.
2. **Promotion controller `[code]`**
   - reuse the same activation command, lease, CAS, restart, health, and rollback
     path as manual promotion;
   - add no second activation implementation.
3. **Kill-switch and failure proof `[code/verification]`**
   - global and per-workspace disable;
   - halt arriving before CAS prevents activation;
   - health failure rolls back and opens a structured exception.
4. **Bounded live pilot `[verification]`**
   - one allowlisted real change;
   - one deliberately denied near-miss;
   - one forced post-activation health failure and rollback.

#### Acceptance

- automatic and manual promotion share one state machine;
- deny conditions are mechanically tested and take precedence;
- a task cannot modify the policy that authorizes its own activation;
- the pilot can be disabled without changing installed generations or source;
- failure restores the prior healthy generation and leaves complete evidence;
- widening the allowlist remains human-steered.

## 11. Workstream-to-task handoff

When task creation is authorized, create one compound parent and one child per
workstream. Allocate actual task identifiers at that time.

| Workstream | Task title stem | Depends on | Initial steering |
|---|---|---|---|
| GEN-A | Observe and attest effective loaded-artifact closure | preparation prerequisites | bootstrap/human |
| GEN-B | Define portable runtime configuration and minimal extension ABI | preparation prerequisites; coordinate with GEN-A | human |
| GEN-C | Build, verify, and install immutable content-addressed generations | GEN-A, GEN-B | root-of-trust |
| GEN-D | Launch generation-pinned Host Adapters and run a sustained canary | GEN-C | bootstrap/human |
| GEN-E | Add fenced atomic activation, health checking, and rollback | GEN-D | root-of-trust |
| GEN-F | Cut Quay self-hosting over to installed generations | GEN-E | human |
| GEN-G | Prove same-generation external-project parity in meta-cc | GEN-F | human-authorized cross-project |
| GEN-H | Migrate steering to artifact-aware candidate automation | GEN-F, GEN-G | policy/human |
| GEN-I | Pilot narrowly automatic promotion with rollback | GEN-H plus entry evidence | deferred policy/human |

Each task body should contain:

- its workstream name and link to this plan;
- a substantive, independently checked Proposal;
- explicit dependencies by actual task reference;
- runnable acceptance criteria, including negative cases;
- real-object Definition of Done;
- human verification questions;
- initial touch declaration;
- classification reason;
- a note that its milestone Plan, not this program plan, owns exact files,
  symbols, commands, line budgets, and base revision.

## 12. Verification matrix

| Property | Fixture proof | Real proof |
|---|---|---|
| Loaded artifact identity | missing/fallback artifact rejected | live Quay and foreign session attestation |
| Immutable release | corruption and writable-alias fixtures | fresh-clone installed generation |
| Build/install isolation | active pointer byte comparison | legacy driver continues during failed build |
| Pinned run | source mutation during fixture | sustained fresh-host canary |
| Atomic activation | crash injection around every boundary | real manual activation |
| Fencing | stale-writer fixture | old session denied integration after cutover |
| Rollback | failed health fixture | real rollback without source revert |
| State compatibility | incompatible schema fixtures | upgrade and backward-compatible write evidence |
| Self-hosting | mock `G/G+1` | real successor built and later used |
| External parity | two fixture configs | same digest drives Quay and meta-cc |
| Steering | full negative risk corpus | formerly path-excluded real candidate |
| Automatic promotion | allow/deny/kill-switch fixtures | bounded live promotion and forced rollback |

No workstream is complete with fixture evidence alone where the table requires a
real proof.

## 13. Testing and quality strategy

For every implementing milestone:

- executable TypeScript/JavaScript uses test-first RED/GREEN and the repository's
  applicable coverage gate;
- shell uses RED/GREEN exit behavior plus isolated filesystem fixtures;
- JSON/YAML schemas and manifests use parser validation, positive fixtures, and
  independently targeted negative fixtures;
- filesystem atomicity tests use one filesystem and inject failures at named
  boundaries;
- concurrency tests include stale lease/writer behavior;
- process/session tests distinguish requested from effective generation;
- full canonical project tests run after focused tests;
- plugin packaging tests reject project-specific paths and missing generated
  artifacts;
- independent audit checks implementation evidence and process claims
  separately;
- a claim about continuous driving requires multiple real cycles, not one
  command invocation.

Exact commands and coverage figures belong in each checked milestone Plan
because the test runner and file set may evolve before that milestone begins.

## 14. Operational continuity and rollback

| Transition | Driver that remains available | Rollback boundary |
|---|---|---|
| Before Phase 1 | current legacy Quay driver | no runtime mutation |
| During Phase 1 | current legacy Quay driver | discard candidate/staging |
| During GEN-E | legacy driver plus verified canary | restore old pointer; restart old host |
| During GEN-F | last healthy installed generation plus documented legacy recovery | atomic generation rollback |
| During GEN-G | independent Quay and meta-cc active generations | workspace-local rollback |
| During GEN-H | installed generation with manual activation | reject candidate; no active change |
| During GEN-I | same manual activation path and kill switch | automatic health rollback |

No stage removes its predecessor's recovery path before independently proving
the replacement.

## 15. Security and authority gates

The following are always separately reviewed and human-authorized during this
program:

- initial trust bootstrap;
- builder/verifier identity or manifest canonicalization changes;
- release-store permissions;
- activation, fencing, health, and rollback logic;
- mission, value source, halt, budget, or workspace authorization;
- extension ABI widening;
- state/event interpretation or irreversible migration;
- cross-project development authority;
- automatic-promotion allowlist changes.

Content addressing detects drift; it does not grant trust. A candidate cannot
serve as its own independent builder, verifier, auditor, and activation
authority merely because its hashes are internally consistent.

## 16. Program completion criteria

The required program (`GEN-A` through `GEN-H`) is complete only when:

1. one immutable engine generation continuously drives both Quay and at least
   one foreign project;
2. both projects use the same engine digest and runtime schemas;
3. ordinary differences are configuration, and every custom extension has a
   demonstrated necessity and bounded ABI;
4. active runs load no editable engine or extension source;
5. build, install, and activation are observably separate;
6. activation is boundary-only, CAS-protected, fenced, fresh-session,
   health-checked, and rollback-capable;
7. Quay has completed a real `G → candidate G+1 → canary/audit → manual
   activation → subsequent G+1 milestone` sequence;
8. Quay and the foreign project can halt, activate, recover, and roll back
   independently;
9. runtime recovery does not depend on transcript availability;
10. artifact-aware steering autonomously completes real candidate work while
    retaining human control of mission, authority, migration, trust root, and
    activation;
11. every workstream has a checked Proposal, checked milestone Plan, real
    landing evidence, and independent adversarial audit;
12. no alternate unchecked startup or copied-workflow path silently bypasses
    generation identity.

`GEN-I` completion is reported separately because automatic promotion is an
optional policy expansion, not a prerequisite for a usable self-hosting and
external-project runtime.

## 17. Explicitly rejected shortcuts

- implementing a Quay-specific self-hosting runtime first and generalizing it
  later;
- copying core workflows into every workspace as the normal runtime;
- loading an editable project extension directly;
- treating a distribution branch/tag or Git commit alone as the generation;
- combining install and activation in a package lifecycle hook;
- hot-reloading an existing Claude or Codex session after pointer replacement;
- changing steering rules before real immutable-run and rollback evidence;
- creating separate activation state machines for Claude, Codex, and external
  projects;
- declaring the builder milestone governed by the candidate it just produced;
- using a fixture-only success to claim sustainable continuous driving.

