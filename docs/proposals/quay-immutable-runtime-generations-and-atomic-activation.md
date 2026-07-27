# Immutable runtime generations and atomic activation for Quay

- **Status:** proposal / architecture discussion only. This document does not
  implement a builder, installer, release store, activation mechanism, runtime
  restart, classifier change, or unattended self-upgrade. Adoption must enter
  the normal directive and milestone process. In particular, this proposal is
  not permission for a running EXP5 instance to replace its own runtime.
- **Date:** 2026-07-27
- **Context:** Quay is a self-hosting control system: its workflows, skills,
  prompts, check scripts, plugin bundle, Host Adapters, and task methodology are
  both development artifacts and inputs to the process developing them. Recent
  halted milestones exposed stale workflow caches, source/runtime disagreement,
  and a self-referential proof gap in which a milestone could not prove itself
  through the pipeline change it had just introduced. The current
  `human-steered` rule avoids some of this risk by excluding driver-file edits
  from autonomous selection, but it reasons primarily from source paths rather
  than from the artifacts actually loaded by a particular run.
- **Related:**
  [`exp5-driver-deliverability-packaging.md`](./exp5-driver-deliverability-packaging.md)
  separates the generic engine, Quay instance configuration, and runtime
  state. ·
  [`quay-control-plane-host-adapters-human-control-surface.md`](./quay-control-plane-host-adapters-human-control-surface.md)
  defines runs, attempts, leases, Host Adapters, evidence, and human authority. ·
  [`exp5-codex-continuous-development-port.md`](./exp5-codex-continuous-development-port.md)
  applies the Host Adapter boundary to Codex. ·
  [`quay-codex-self-observation-tool-supply-chain.md`](./quay-codex-self-observation-tool-supply-chain.md)
  discusses observation-tool provenance and trust. ·
  [`local-multi-project-coevolution-pilot.md`](./local-multi-project-coevolution-pilot.md)
  covers delegated local development across Quay, meta-cc, and archguard. ·
  [`DIR-108`](../../tasks/DIR-108.md) moves the built plugin distribution out
  of the source branch and provides an initial source/build separation. ·
  [`human-steered-classify.ts`](../../experiments/quay-perpetual-stream/scripts/human-steered-classify.ts)
  is the current executable classifier.

## 1. Decision summary

Quay should stop treating the editable repository checkout as the runtime
installation of the control mechanism developing that checkout.

Instead, every control-plane or driver run should be pinned to one immutable,
content-identified **runtime generation**. Development produces a different,
staged **candidate generation**. A candidate is built and tested without
modifying the active generation, verified in a fresh canary process or session,
and promoted only at a run boundary through an atomic, compare-and-swap
activation operation. Activation starts a new process or host session; an
already-running process never hot-reloads the promoted generation.

This changes the relevant safety question from:

> Does this task edit a path conventionally called a driver file?

to:

> Can this task mutate an artifact loaded by its own active run, redirect the
> mission or authority boundary, or modify the mechanism that establishes trust
> in the next generation?

Under this model, most driver implementation work can be performed
autonomously as candidate construction. Mission changes, authority expansion,
root-of-trust changes, and initially all production activation remain
human-steered.

## 2. Problem statement

### 2.1 Source and runtime currently alias one another

Several mechanisms may resolve files directly from the editable workspace or
from host-managed caches whose relationship to that workspace is implicit:

- `OUTER-LOOP.md`, `inherited-core.md`, and EXP5 check scripts;
- project-scoped `.claude/skills/`;
- checked-in `.claude/workflows/` and their plugin mirrors;
- a built Quay MCP/plugin bundle;
- Claude Code plugin and workflow caches;
- Codex skills, instructions, and any installed adapter bundle;
- session-private copies of dynamically dispatched workflows.

A commit can therefore change source while the current host continues running
a cached old copy, or can change a file that the current loop will read later
in the same cycle. Git identity alone does not identify execution semantics.

### 2.2 The bootstrap hazard is temporal, not merely textual

A task that edits a driver-like file is not necessarily unsafe. It is unsafe
when the current run can observe that edit and thereby change the rules under
which its own work, audit, or landing is judged.

Conversely, a task that does not touch one of today's named driver paths can
still be self-affecting. Editing a workflow mirror, installed bundle, loader,
cache, activation pointer, or dependency resolved by the host may alter the
current execution path.

The current path-based rule is therefore both:

- **over-conservative**, because an isolated candidate source tree cannot
  affect an immutable active installation; and
- **under-inclusive**, because not every runtime-loaded artifact is one of the
  paths enumerated by the classifier.

### 2.3 A new rule cannot prove its own prior use

Suppose milestone `M` changes the audit or ABSORB pipeline. Even if the new code
is correct, `M` cannot truthfully claim that all of its earlier phases were
governed by that new code. Retrospective self-certification is impossible.

The correct proof is prospective:

1. generation `G` builds candidate `G+1`;
2. an independent canary uses `G+1` on a separate fixture or real bounded run;
3. evidence from that canary supports promotion;
4. only subsequent runs claim to be governed by `G+1`.

## 3. Goals and non-goals

### 3.1 Goals

1. Give every run a stable, inspectable execution identity.
2. Prevent a task from changing its own in-flight execution semantics.
3. Permit autonomous source edits, builds, tests, and candidate verification
   where they do not alter mission, authority, or the root of trust.
4. Make promotion and rollback bounded, atomic, attributable, and recoverable.
5. Use the same generation semantics for Claude Code, Codex, CLI, CI, and
   future Host Adapters.
6. Separate immutable engine artifacts, versioned instance configuration, and
   mutable runtime state.
7. Replace path-name heuristics with a conservative artifact/capability model.

### 3.2 Non-goals

- live-patching an existing Claude or Codex session;
- allowing EXP5 to redefine its own mission or human-control policy;
- treating a successful build as sufficient evidence for promotion;
- making package-manager lifecycle hooks the production activation protocol;
- centralizing all project state inside an engine release;
- requiring a network service for the first local implementation;
- immediately making activation fully autonomous.

## 4. Terms and artifact classes

| Term | Meaning |
|---|---|
| **Source revision** | A Git commit/worktree containing editable source and documentation |
| **Build** | A deterministic transformation from declared inputs to a candidate artifact set |
| **Runtime generation** | An immutable, content-identified artifact tree usable by a Host Adapter |
| **Candidate** | A built generation not yet active for normal runs |
| **Active generation** | The generation selected by the activation manifest for new runs |
| **Run generation** | The generation pinned when a particular run starts; it never changes in that run |
| **Instance configuration** | Versioned project policy/configuration interpreted by the engine |
| **Runtime state** | Mutable tasks, events, leases, checkpoints, logs, and attempt state |
| **Loaded artifact closure** | Every executable, prompt, workflow, skill, schema, dependency, and config snapshot capable of affecting a run |
| **Root of trust** | Builder identity, manifest format, hash/signature verification, activation, rollback, and authority policy |

The earlier engine/config/state split remains, but each class now has an
explicit mutability contract:

```text
release/<generation>/engine       immutable
release/<generation>/host         immutable
release/<generation>/manifest     immutable

workspace source                  editable
instance config revision          versioned and snapshotted per run
runtime state/events              mutable, outside every release
active-generation pointer         atomically replaceable, never edited in place
```

Instance configuration needs special care. Purely descriptive configuration
may be snapshotted per run. Configuration that changes mission, authorization,
halt semantics, budgets, or the meaning of acceptance remains policy and cannot
be smuggled through an ordinary engine build.

## 5. Architectural invariants

1. **A run is generation-pinned.** Its generation ID is recorded before any
   task work and cannot change until the run terminates.
2. **Releases are immutable.** No build, install, repair, or package hook writes
   into an existing release directory.
3. **Builds are staged.** A candidate is assembled under a unique temporary or
   content-addressed path and becomes visible only after verification.
4. **No active-path alias.** Editable source, candidate output, and active
   release resolve to different filesystem trees and identities.
5. **Activation affects only new processes.** Promotion never implies that an
   existing session has reloaded files.
6. **Activation is atomic and fenced.** It requires the expected old generation,
   an activation lease, and one atomic pointer/manifest replacement.
7. **Rollback is symmetric.** The prior verified generation remains available
   and can be reactivated through the same protocol.
8. **Evidence identifies its producer.** Test, audit, and milestone evidence
   records the generation and configuration snapshot that produced it.
9. **State is not packaged into a release.** Mutable project history cannot be
   overwritten by installation or rollback.
10. **Policy cannot be reclassified as code.** Mission, authority, and
    root-of-trust changes retain their stronger approval requirements.
11. **Fail closed on ambiguity.** If the loaded artifact closure or generation
    identity is unknown, self-affecting work is not autonomous-eligible.
12. **Old and new semantics do not mix within one attempt.** A retry under a
    different generation is a new attempt and is recorded as such.

## 6. Proposed local layout

The exact paths are not normative, but a local implementation needs equivalent
separation:

```text
.quay/
  runtime/
    releases/
      sha256-<generation>/
        manifest.json
        engine/
        host-adapters/
        provenance/
    candidates/
      <build-id>/
    active.json
    activation-events.jsonl
  state/
    runs/
    leases/
    events/
```

For a user-wide installation, releases may instead live under a user data/cache
directory. The workspace must still record an opaque generation ID and
provenance; it must not rely on an unqualified path such as "whatever plugin
version this host currently finds."

`active.json` is a small pointer, not a mutable installation:

```json
{
  "schema": 1,
  "generation": "sha256:…",
  "previousGeneration": "sha256:…",
  "activatedAt": "2026-07-27T00:00:00Z",
  "activationEvent": "activation:…"
}
```

The generation manifest should minimally contain:

```json
{
  "schema": 1,
  "generation": "sha256:…",
  "source": {
    "repository": "quay",
    "commit": "…",
    "dirty": false
  },
  "builder": {
    "generation": "sha256:…",
    "commandContract": "quay-runtime-build/v1"
  },
  "artifacts": [
    {"path": "engine/…", "sha256": "…", "role": "workflow"}
  ],
  "hostCompatibility": {
    "claudeCode": "…",
    "codex": "…",
    "node": ">=20"
  },
  "configSchema": {"min": 1, "max": 1},
  "stateSchema": {"readMin": 1, "write": 1}
}
```

The generation ID must be derived from canonical manifest content and artifact
hashes, not from a mutable directory name, branch name, timestamp, or package
tag.

## 7. Build, verify, install, and activate

### 7.1 Build

The active generation `G` may run an autonomous task that edits source and
requests candidate construction:

1. resolve a clean source revision and all declared inputs;
2. build into a unique staging directory;
3. enumerate the complete artifact manifest;
4. hash artifacts and derive the generation ID;
5. run static integrity and compatibility checks;
6. atomically rename the completed tree into `releases/<generation>`;
7. make the resulting release read-only;
8. emit a `CandidateBuilt` event.

A cache hit for the same content ID is idempotent. A partial staging directory
is not a generation and is safe to discard after its owning build is known to
be inactive.

The initial builder need not be perfectly reproducible across machines, but it
must record its own identity and inputs. Reproducible builds and signatures are
desirable later; provenance is mandatory from the first implementation.

### 7.2 Verify

Verification has distinct layers:

1. **Artifact integrity:** every manifest hash matches.
2. **Contract checks:** command schemas, workflow argument forms, plugin
   mirrors, Node/host floors, and required assets are complete.
3. **Golden replay:** known positive and negative fixtures preserve intended
   behavior and reveal policy drift.
4. **Canary run:** a fresh process or host session starts explicitly pinned to
   the candidate and executes a bounded real or representative milestone.
5. **Independent audit:** the auditor is not the candidate builder attempt and
   records the generation it evaluated.

Verification must not silently fall back to the globally active version. A
canary that cannot prove it loaded the candidate is invalid evidence.

### 7.3 Install

Installation means making an immutable, verified generation available. It does
not mean activating it. Package installation and activation are deliberately
separate operations.

Package-manager `postinstall` may build a local candidate for development, but
it must not replace `active.json`, overwrite an existing release, restart a
driver, or assert successful production activation.

DIR-108's `dist-plugin` branch is useful distribution input, but a branch is a
mutable reference. Installation must resolve it to immutable content and record
the source commit plus final artifact hashes.

### 7.4 Activate

Activation occurs only at a clean run boundary:

1. confirm no affected run is in flight, or explicitly drain it;
2. acquire the activation lease and integration-writer fence;
3. verify candidate evidence and policy requirements;
4. compare the current pointer with `expectedGeneration`;
5. write and fsync a complete new activation manifest;
6. atomically rename it over `active.json` on the same filesystem;
7. append and fsync the activation event;
8. start a fresh Host Adapter process/session pinned to the new generation;
9. perform a bounded health check;
10. mark activation healthy or atomically roll back.

Conceptually:

```text
activate(expected=G, candidate=G1):
  require active == G
  require lease("runtime-activation")
  require verified(G1)
  atomicReplace(active, G1)
  startFresh(G1)
  healthcheck(G1) ? commitActivation : rollback(G)
```

The exact crash-consistency protocol needs implementation design. In
particular, the event log and pointer update cannot be assumed to form one
filesystem transaction. Recovery must reconcile them idempotently using an
activation ID and the observed pointer state.

## 8. Host Adapter contract

Claude Code and Codex may package and cache capabilities differently, so each
Host Adapter must expose the same semantic operations:

```text
prepare(generation, configSnapshot) -> PreparedHost
start(preparedHost, runId)           -> SessionRef
attest(session)                      -> LoadedArtifactAttestation
health(session)                      -> HealthResult
drain(session)                       -> DrainResult
stop(session)                        -> StopResult
```

`LoadedArtifactAttestation` should include:

- requested and effective generation IDs;
- resolved workflow, skill, plugin, MCP, and instruction paths;
- hashes or package identities for every load-bearing artifact;
- host and adapter versions;
- configuration snapshot ID;
- any untracked fallback or cache resolution.

An adapter that cannot attest its effective artifacts may still be used for
interactive work, but it cannot supply proof for autonomous generation
promotion.

For Claude Code, a fresh session is required after promotion because workflow
and plugin caches may outlive source edits. For Codex, the adapter must likewise
distinguish workspace files from installed skills/plugins and record which
instructions were loaded at session start.

## 9. Runtime state and schema evolution

Keeping state outside releases prevents ordinary rollback from erasing project
history, but schema changes introduce another self-hosting boundary.

Every generation declares:

- the oldest state/config schema it can read;
- the schema it writes;
- whether writes are backward-compatible with the previous generation;
- any required migration and rollback constraints.

Preferred evolution is expand-and-contract:

1. `G` and `G+1` both understand an additive schema;
2. `G+1` is activated and writes backward-compatible state;
3. after an observation window, a later generation may retire the old form.

An irreversible migration, a generation that the previous release cannot read,
or a change to event interpretation is not an ordinary candidate activation.
It requires an explicit migration milestone, backup/recovery evidence, and
human approval until a separately governed migration protocol exists.

## 10. Revised steering model

The current Boolean should evolve into reasoned risk classes:

| Class | Autonomous candidate work | Activation |
|---|---:|---:|
| `ordinary-change` | yes | normal |
| `engine-candidate` | yes, under pinned old generation | gated promotion |
| `runtime-self-modifying` | no | not applicable; isolate first |
| `mission-steered` | no | human |
| `authority-steered` | no | human |
| `root-of-trust-change` | no initially | human |
| `state-migration` | only under an approved migration plan | human initially |
| `unauthorized-workspace` | no | human authorization required |

The core predicate becomes:

```text
selfAffecting(run G, task T) =
  intersects(T.writeSet, loadedArtifactClosure(G))
  or changesRuntimeResolution(T)
  or changesActivationOrBuilder(T)

autonomousCandidateEligible(run G, task T) =
  not selfAffecting(G, T)
  and not missionRedirection(T)
  and authorizedWorkspaces(T)
  and candidateOutputIsolated(T)
```

Source paths remain useful conservative hints, especially before the loaded
artifact closure is fully available, but they are not the final authority.

The `label:human-steered` escape hatch remains. The classifier should emit all
reasons and the relevant artifact intersections rather than only a Boolean.

### 10.1 What becomes more autonomous

Under a real generation boundary, the active `G` can ordinarily:

- edit workflow, skill, prompt, adapter, and driver source for `G+1`;
- build and hash `G+1`;
- run unit, integration, golden-replay, and isolated canary checks;
- commission an independent audit of `G+1`;
- file findings and prepare an activation request.

### 10.2 What remains human-steered

Generation separation does not delegate:

- mission, VT, value source, or standing hypothesis redirection;
- workspace authorization or external irreversible authority;
- halt and human-control semantics;
- builder/verifier/activation/rollback trust-root changes;
- the first bootstrap of this generation mechanism;
- irreversible state migrations;
- accepting evidence whose producer cannot attest its generation.

Initially, production activation itself should remain a small human-controlled
step even when all candidate work is autonomous. After sufficient evidence,
policy may allow automatic activation for narrowly classified changes, but that
is a separate decision.

## 11. Failure and recovery semantics

| Failure | Required behavior |
|---|---|
| Build dies in staging | active generation unchanged; mark/discard incomplete staging |
| Candidate verification fails | retain evidence; candidate never activated |
| Activation compare-and-swap fails | another actor won; do not retry blindly |
| Crash after pointer replacement | recovery reconciles activation ID, event log, and health state |
| New host fails to start | restore previous pointer and restart previous generation |
| Health check fails | rollback and file a generation-scoped finding |
| Old run remains alive | fence it from integration/state writes before new writer starts |
| Artifact hash mismatch | quarantine generation; never execute or activate |
| Attestation shows fallback/cache drift | invalidate canary evidence and fail closed |
| State incompatibility found | stop activation; restore prior generation before incompatible writes |

Rollback is not equivalent to reverting source. It changes the active
generation for new runs and restores a compatible writer; source history and
the failed candidate remain available for diagnosis.

## 12. Observability and provenance

The control plane should answer, without transcript reconstruction:

- Which generation selected, built, audited, and landed this milestone?
- Which source commit and builder produced that generation?
- Which workflow/skill/plugin/MCP artifacts did the host actually load?
- Was the run started before or after an activation?
- Did a retry use a different generation?
- Which evidence justified promotion?
- Who or what authorized activation?
- What generation was rolled back, why, and what state writes occurred first?

Suggested events:

```text
CandidateBuildRequested
CandidateBuilt
CandidateVerificationStarted
CandidateVerificationCompleted
ActivationRequested
ActivationAuthorized
ActivationPointerChanged
GenerationHealthConfirmed
GenerationRollbackStarted
GenerationRolledBack
```

meta-cc remains an evidence adapter for session behavior, but generation and
activation state belong in Quay's durable control-plane records.

## 13. Security and supply-chain boundary

Content addressing prevents accidental drift but does not establish that a
generation is trustworthy. The implementation should progressively add:

- a hermetic or at least declared build-input set;
- builder-generation provenance;
- dependency locks and recorded toolchain versions;
- artifact manifest verification before every start;
- restricted write permission on release directories;
- optional signatures/attestations from an authorized builder;
- a policy preventing a candidate from forging its own independent audit;
- separation between candidate builder, verifier, and activation authority.

The initial bootstrap is necessarily special: the current mutable system must
construct and verify the first trusted generation. That milestone should run
under `.halt`, include golden replay and a fresh-host canary, receive an
independent adversarial audit, and preserve an explicit manual recovery path.

## 14. Phased implementation

### Phase 0 — Observe the real loaded-artifact closure

- instrument current Claude and Codex sessions to report resolved workflow,
  skill, plugin, MCP, instruction, cache, and configuration artifacts;
- compare repository source, installed artifacts, and session-private copies;
- fail closed where effective identity cannot be determined;
- use the result to correct false-negative paths in the current classifier.

This phase changes observability, not activation behavior.

### Phase 1 — Build immutable candidates

- define the generation manifest and content-ID algorithm;
- build the existing workflow/skill/plugin surface into a unique release tree;
- preserve mutable state outside the tree;
- verify hashes and make the release read-only;
- do not add an active pointer yet.

### Phase 2 — Fresh-host canary

- add explicit generation selection to one Claude Host Adapter path;
- start a clean session with no fallback to workspace or global cache;
- attest loaded artifacts;
- run golden fixtures and one bounded representative milestone;
- repeat for Codex after the contract is stable.

### Phase 3 — Atomic manual activation and rollback

- add activation lease, compare-and-swap pointer, event records, restart, health
  check, and rollback;
- require human authorization for every activation;
- test process death at each activation boundary;
- demonstrate that an in-flight old-generation run cannot integrate after its
  writer fence is revoked.

### Phase 4 — Classifier migration

- add risk classes and artifact-intersection evidence;
- treat isolated driver source edits as `engine-candidate`, not inherently
  human-steered;
- retain conservative fallback when `## Touches`, build outputs, or loaded
  closure are incomplete;
- split tasks into autonomous candidate work and separately governed
  activation where appropriate.

### Phase 5 — Narrow automatic promotion experiment

Only after repeated manual promotions and rollbacks are evidenced:

- select a low-risk workflow-mechanics class with no policy/schema change;
- require two independent verification channels and a fresh-host canary;
- permit activation only at an idle boundary within a small rollout budget;
- automatically roll back on health failure;
- compare automation gain and incident rate against the manual baseline.

## 15. First vertical slice: `execute-milestone`

The first pilot should package the `execute-milestone` workflow and its
load-bearing dependencies as one generation slice.

It is a good test because recent history exposed all relevant failure modes:

- dynamic workflow arguments arrived in more than one shape;
- a source fix did not prove that a named workflow dispatch used the fixed
  cached copy;
- an audit/ABSORB change could not prove its own earlier use;
- source and plugin mirrors required synchronization;
- a fresh independent audit was required to distinguish implementation
  correctness from process proof.

The slice should:

1. inventory every file the workflow and its subprocesses load;
2. build those files and mirrors into one immutable candidate;
3. reject undeclared workspace/global-cache fallback;
4. exercise object and JSON-string argument fixtures;
5. run a fresh-session canary milestone with a deliberately REFUTED audit
   fixture as well as a passing fixture;
6. attest that charter, iteration, audit, disposition, and ABSORB artifacts were
   produced by the candidate generation;
7. manually activate it for subsequent milestones;
8. demonstrate one rollback without editing source or mutable task state.

Success does not mean the pilot milestone itself was governed by the new
workflow. Success means the candidate produced prospective evidence sufficient
for later runs to use it.

## 16. Acceptance conditions for adopting the architecture

Before changing the `human-steered` rule, an implementing directive should
require evidence that:

- two distinct generations can coexist and neither can mutate the other;
- a run records and retains one generation identity from start to finish;
- editing source during a run does not change that run's behavior;
- a fresh canary proves which generation it loaded;
- build/install never updates the active pointer;
- activation is compare-and-swap, boundary-only, and starts a fresh host;
- forced failures before and after pointer replacement recover deterministically;
- rollback restores a healthy prior generation without reverting source or
  deleting runtime events;
- state/config compatibility is checked before activation;
- mission, authority, root-of-trust, and migration changes remain
  human-steered;
- classifier output cites the concrete artifact intersection or policy reason;
- golden replay shows no unintended change in selection, halt, audit, and
  landing semantics.

## 17. Expected effect on automation

The architecture does not eliminate human control. It moves that control to
the small number of operations that actually cross a trust or semantic
boundary.

Recent halted work suggests that workflow mechanics, prompt interpolation,
artifact capture, scheduling preflight, methodology packaging, and regression
tests could mostly be built and verified as autonomous candidates. Governance
definitions, halt/classification policy, the initial distribution trust chain,
and activation-root changes should remain human-controlled.

The useful metric is therefore not merely "number of tasks without a
human-steered label." Track:

- proportion of implementation/build/verification work completed autonomously;
- number and duration of human activation decisions;
- candidate rejection and rollback rates;
- occurrences of source/runtime or cache identity drift;
- runs whose loaded generation cannot be attested;
- policy/root-of-trust changes incorrectly classified as ordinary code.

A task may legitimately retain a human activation gate while most of its work
becomes autonomous.

## 18. Rejected alternatives

### Edit the live checkout and restart when convenient

Rejected because the boundary is implicit, cached hosts may retain old
artifacts, and evidence cannot reliably identify which version executed.

### Build in place, then atomically rename individual files

Rejected because a runtime generation is a dependency closure, not one file.
Per-file replacement permits mixed generations and cannot update already-loaded
process memory.

### Use only Git commits as generations

Rejected because generated bundles, installed plugins, host caches,
dependencies, and configuration resolution are not identified by the source
commit alone.

### Let `postinstall` both build and activate

Rejected because package lifecycle execution is not a fenced run boundary and
does not provide independent verification, health checking, or rollback.

### Remove `human-steered` after immutable builds exist

Rejected because mission, authority, root-of-trust, migration, and external
side-effect decisions are independent of source/runtime aliasing.

### Require human execution of every driver-related task forever

Rejected as unnecessarily broad once the active runtime is immutable and the
candidate cannot affect its builder run. It spends human attention on
implementation mechanics instead of the actual authority boundary.

## 19. Open decisions

1. Should releases be workspace-local, user-local, or user-local with a
   workspace pin?
2. Which component is the first trusted builder, and how is its own generation
   recorded?
3. What is the minimal attestation Claude Code and Codex can provide without
   relying on host internals that are too unstable?
4. Should instance policy be embedded in the generation, independently
   content-addressed, or both?
5. What filesystem and crash-consistency guarantees are required across Linux,
   macOS, and future remote hosts?
6. How are activation authorization and `.halt` composed when a candidate is
   ready but the loop is paused?
7. Which low-risk class, if any, should be the first to gain automatic
   activation?
8. How long must prior generations and their build/verification evidence be
   retained?

## 20. Recommendation

Adopt immutable runtime generations as the target architecture, but implement
it as an explicitly human-steered bootstrap sequence:

1. observe effective runtime artifacts;
2. build immutable candidates;
3. prove fresh-host pinning and attestation;
4. add manual atomic activation and rollback;
5. only then revise autonomous-selection rules.

The central invariant is:

> A running generation may autonomously construct and test its successor, but
> it may not mutate itself, silently become its successor, or redefine who is
> allowed to authorize succession.

