# A Codex tool supply chain for Quay self-observation

- **Status:** proposal / architecture discussion only. This document does not
  install a plugin, register an MCP server, enable telemetry or hooks, create a
  tool marketplace, or authorize unattended discovery or installation.
  Adoption must enter the normal directive and milestone process.
- **Date:** 2026-07-26
- **Context:** Quay is deliberately meta and increasingly self-hosting. Its
  development process needs to observe Quay itself, related repositories, and
  the Claude Code/Codex processes doing the work. meta-cc is the first concrete
  example, but treating each new tool as an ad hoc host configuration would
  make provenance, permissions, evaluation, and maintenance unauditable.
- **Related:**
  [`exp5-codex-continuous-development-port.md`](./exp5-codex-continuous-development-port.md)
  defines the staged Codex operator and execution port. ·
  [`quay-control-plane-host-adapters-human-control-surface.md`](./quay-control-plane-host-adapters-human-control-surface.md)
  separates authoritative state, Host Adapters, and human control. ·
  [`exp5-quay-task-proposal-plan-skill.md`](./exp5-quay-task-proposal-plan-skill.md)
  defines the expected Proposal/Plan authoring and review discipline. ·
  [`quay-proposal.md`](./quay-proposal.md) defines Quay Core and the Provider
  ABI; this proposal does not widen that ABI into a general tool bus.

## 1. Decision summary

Quay should deliberately develop a **Codex tool supply chain** for observing
itself and related projects, but that supply chain should remain outside Quay
Core and outside the authoritative task lifecycle.

The supply chain is:

```text
observed friction or blind spot
  -> capability gap in a Quay task
  -> search existing local / curated / official tools
  -> classify authority and data access
  -> isolated fixture and real-scenario evaluation
  -> adopt | adapt | develop | reject
  -> package the approved workflow for Codex
  -> emit provenance-qualified findings
  -> human or control-plane policy decides task mutation
  -> observe whether the tool actually improved the process
```

The first bootstrap should use the already-developed meta-cc Codex integration,
not build another transcript parser. It should then add a small repo-scoped
tool-radar/evaluation workflow. Broader GitHub, CI, error-monitoring, browser,
and cross-workspace tools should be added only when a recorded Quay capability
gap justifies them.

No discovery workflow may automatically install, authenticate, enable, or
upgrade a tool. Candidate discovery is read-only; consequential adoption
remains a reviewed milestone or explicit human action.

## 2. Why this is part of Quay's self-hosting problem

### 2.1 Development state is spread across several evidence systems

Quay's authoritative task and gate state lives in repository artifacts, but
useful evidence also lives in:

- Claude Code and Codex session histories;
- Git commits, indexes, worktrees, branches, and merge results;
- tests, CI jobs, package and release pipelines;
- related repositories such as meta-cc and baime;
- browser-visible behavior and screenshots;
- runtime errors, retry patterns, cost, latency, and permission failures;
- human decisions made during interactive development.

Ignoring those systems makes the self-hosting loop blind. Importing all of them
into Quay Core would instead make Core an integration platform and couple its
correctness to unstable host and vendor schemas.

### 2.2 Tool choice changes the process being observed

An observer can create its own failure modes:

- transcript collection can expose secrets;
- a quality score can become a target rather than a diagnostic;
- a tool update can silently reinterpret old sessions;
- an observer with write authority can alter the state it is measuring;
- the same agent can use its own summary as proof of correctness;
- a large tool catalog can crowd out the instructions and tools that matter.

The tool supply chain therefore needs the same provenance, bounded authority,
independent review, negative testing, and reversible adoption expected of other
Quay development changes.

## 3. Four-layer boundary

| Layer | Responsibility | Examples | Authority |
|---|---|---|---|
| **Authoritative state** | task, Proposal, Plan, GateEvent, lease, run and milestone lifecycle | Quay task store and control plane | canonical |
| **Evidence adapters** | query and normalize external observations | meta-cc, Git/CI/browser MCP, Codex event/OTel collector | read-only by default |
| **Workflows** | decide when and how Codex gathers, minimizes, compares, and reports evidence | repo Skills and checked helper scripts | procedural |
| **Distribution/configuration** | install and wire approved Skills, MCP servers, hooks, and assets | Codex plugin, marketplace entry, `.codex/config.toml` | host configuration |

Evidence adapters may return a proposed task action, but only Quay's normal
human-control or control-plane path may perform it. An adapter must not:

- close a task or tick AC/DoD;
- declare a Proposal or Plan checked;
- allocate a milestone or acquire its lease;
- determine recovery from transcript context;
- merge, release, or deploy;
- silently install another tool.

## 4. Codex extension surfaces and their intended use

Codex currently provides several extension surfaces. Use the smallest one that
matches the capability:

| Need | Preferred surface | Quay rule |
|---|---|---|
| durable repository conventions | `AGENTS.md` | concise authority and verification rules only |
| repeatable reasoning or operating procedure | Skill | default starting point |
| deterministic local transformation/check | Skill helper script or existing CLI | keep inputs/outputs machine-checkable |
| live external data or action | MCP server | declare read/write tools and data boundary separately |
| passive lifecycle capture or mechanical guardrail | hook | never the only safety or gate boundary |
| installable bundle of Skills/MCP/hooks/assets | plugin | use after the component contracts stabilize |
| operational run events | `codex exec --json` and optional OTel | do not substitute metrics for semantic evidence |

Official Codex documentation describes Skills as the workflow authoring format,
MCP as the external tool/context boundary, hooks as lifecycle extensions, and
plugins as the installable distribution unit:

- <https://learn.chatgpt.com/docs/build-skills>
- <https://learn.chatgpt.com/docs/extend/mcp>
- <https://learn.chatgpt.com/docs/hooks>
- <https://learn.chatgpt.com/docs/build-plugins>

Codex hook input can include a `transcript_path`, but that transcript format is
not a stable interface. Quay must not build correctness on direct parsing of
that path. A versioned adapter such as meta-cc should absorb host-format changes.

## 5. Current local baseline

The checked environment on 2026-07-26 has:

- local `codex-cli 0.145.0`;
- the `openai-curated` Codex plugin marketplace;
- relevant visible candidates including GitHub, CircleCI, Sentry, Datadog,
  CodeRabbit, and `plugin-eval`;
- no Codex MCP servers currently configured;
- an installed meta-cc 3.0.7 bundle under
  `/home/yale/.local/share/meta-cc`, including:
  - a Codex plugin manifest;
  - a Codex MCP declaration;
  - the `meta-cc-mcp` binary;
  - three prompt-library Skills;
- the meta-cc source workspace at `/home/yale/work/meta-cc`, with real Claude
  and Codex provider support and Codex E2E tests;
- no repo `.agents/` or project `.codex/` configuration in Quay yet.

This establishes an integration gap, not a reason to develop a replacement.
The first useful milestone is registration, workflow packaging, and real
evidence validation.

## 6. Demand discovery: find gaps before finding products

Tool discovery begins from repeated, evidenced friction. Candidate signals
include:

- recurring tool errors or retries in meta-cc analysis;
- repeated human questions that existing state cannot answer;
- Proposal/Plan review findings that recur across milestones;
- files or required documents repeatedly missed before implementation;
- CI or gate failures that require manual reconstruction;
- task/Git/worktree disagreement;
- cross-project changes discovered too late;
- a browser or runtime claim without retained evidence;
- excessive manual transformation between an external system and a Quay task.

Each proposed search starts with a Quay task containing:

```yaml
capability_gap: <observable missing capability>
observed_instances:
  - <session/run/commit/task evidence reference>
frequency: one-off | recurring | systemic
affected_boundary: operator | preparation | build | audit | recovery
required_authority: read | propose-write | write
data_classes:
  - public | repository | transcript | credential | production
done_when: <fixture plus real-scenario evidence>
```

A one-off inconvenience normally does not justify a new MCP server or plugin.
It may justify a prompt, an existing CLI command, or a small Skill.

## 7. Candidate discovery order

Search in the following order:

1. **Existing repository commands and checks.** Prefer a proven CLI or script
   over another integration layer.
2. **Sibling projects and locally installed bundles.** meta-cc and baime are
   especially relevant because their contracts can be inspected and changed.
3. **The configured Codex plugin marketplace and curated Skills.** Treat a
   listing as a candidate, not an approval.
4. **Official product MCP/CLI integrations.** Prefer supported, versioned APIs.
5. **Auditable open-source community tools.** Pin source and release identity;
   inspect install scripts and data flow.
6. **Adapt or develop locally.** Do this only after the gap and rejected
   alternatives are recorded.

Search results should be a shortlist of at most three materially different
candidates plus the “use existing primitives” alternative. More candidates add
review surface without necessarily adding design diversity.

## 8. Tool evaluation record

Every evaluated candidate produces one immutable record or checked-in fixture
result with at least:

```yaml
schema: quay-tool-evaluation/v1
capability_gap: <task-id>
tool:
  name: meta-cc
  version: 3.0.7
  source: local-release
  source_ref: <release-url-or-commit>
  artifact_hash: <sha256-or-n/a>
surfaces:
  - skill
  - mcp
authority:
  declared: read
  observed: read
data_access:
  inputs:
    - claude-session-history
    - codex-session-history
  network_egress: none
outputs:
  format: structured-mcp
  provenance_fields:
    - provider
    - session_ref
tests:
  fixture: pass
  negative: pass
  real_scenario: pass
degradation:
  unavailable: evidence-unavailable
maintenance:
  owner: <person-or-project>
  disable_path: <documented-command-or-config>
decision: adopt | adapt | develop | reject
findings: []
```

The record must distinguish declared behavior from observed behavior. Marketing
text or a manifest alone is not evaluation evidence.

### 8.1 Required evaluation dimensions

1. capability fit and output usefulness;
2. source, version, artifact, and license provenance;
3. permissions, filesystem scope, credentials, and network egress;
4. read and write tools evaluated separately;
5. structured output, stable identifiers, and deduplication;
6. headless, worktree, restart, and unavailable-service behavior;
7. latency, resource use, token/context overhead, and cost;
8. secret minimization and retention;
9. maintenance activity, upgrade path, and rollback;
10. Claude/Codex or local/remote portability where relevant;
11. fixture, adversarial negative case, and one real Quay scenario;
12. whether disabling the tool preserves Quay task operation.

### 8.2 Adoption verdicts

- **Adopt:** existing tool meets the contract; only checked configuration and a
  workflow wrapper are required.
- **Adapt:** the core tool is suitable, but Quay needs a narrow normalization,
  redaction, or packaging layer.
- **Develop:** no candidate meets a stable, high-value, testable contract.
- **Reject:** benefit does not justify authority, data access, maintenance, or
  operational cost.

## 9. Evidence envelope

Tools should emit or be normalized into a small common evidence envelope:

```yaml
schema: quay-observation/v1
observer:
  tool: <name>
  version: <version>
  config_hash: <hash>
subject:
  workspace: <stable-id>
  provider: claude | codex | git | ci | browser | runtime | other
  ref: <opaque-stable-reference>
observed_at: <rfc3339>
source_revision: <commit-or-artifact-ref-if-known>
data_class: repository | transcript | operational | production
finding:
  kind: <taxonomy>
  summary: <redaction-safe-text>
  confidence: measured | inferred | estimated
  fingerprint: <deduplication-key>
suggested_task_action: create | edit | append-note | no-action
raw_evidence_ref: <optional-bounded-reference>
```

The envelope is an interoperability format, not an ontology of all observations
and not a new Quay Provider ABI. Tool-specific detail remains behind
`raw_evidence_ref`; task mutations carry only the minimum evidence needed for
review.

## 10. When Quay should develop a tool

Local development is justified only when all of the following hold:

1. the gap is recurring or systemic and affects a declared Quay objective;
2. no existing candidate meets it, or adaptation is materially smaller and
   safer than replacement;
3. inputs, outputs, authority, failure behavior, and a disable path can be
   specified before implementation;
4. fixture and real-scenario tests are possible;
5. maintenance ownership is explicit;
6. the tool does not require Quay Core to depend on a private transcript or
   vendor database schema;
7. the Proposal explains why Skill/script/MCP/hook/plugin is the right surface;
8. the Plan includes packaging, installation, upgrade, and removal testing.

Prefer this implementation progression:

```text
existing CLI
  -> Skill describing the workflow
  -> checked helper for deterministic transforms
  -> MCP only for a live external boundary
  -> local plugin after contracts stabilize
  -> shared marketplace only after multi-workspace evidence
```

Do not start with a plugin merely because plugins are distributable. Distribution
should follow demonstrated behavior.

## 11. Initial tool portfolio

### 11.1 Session and semantic development evidence

**Use meta-cc.** Register its existing MCP server for Codex, query real Claude
and Codex sessions with explicit provider selection, and add a
`quay-session-review` Skill that produces the §9 envelope.

meta-cc remains the adapter owner for host-specific session formats. Quay owns
the evidence-minimization, task-deduplication, and human-authorization policy.

### 11.2 Codex operational telemetry

Use `codex exec --json` and, when justified, opt-in OpenTelemetry export for
operational events such as requests, tool approvals/results, errors, latency,
and run identity. Prompt logging remains disabled unless a separately reviewed
need and retention policy exists.

Operational telemetry answers “what happened to the run?” meta-cc answers “what
patterns and semantic findings appear in the session?” Quay answers “what is
the legal task/milestone state?” These are complementary planes.

### 11.3 Repository and worktree truth

Continue to use Git and checked Quay scripts as the primary source for commits,
indexes, worktrees, file fingerprints, and merge results. An MCP wrapper is not
needed merely to run local read-only Git commands.

### 11.4 Related project and hosted-system evidence

Evaluate GitHub, CI, Sentry/Datadog, browser, or documentation tools only when
Quay has a real dependency on that system. Prefer a read-only pilot, narrow
repository/project scope, and explicit promotion before enabling write tools.

### 11.5 Tool-radar workflow

After the meta-cc bootstrap, add a repo-scoped `quay-tool-radar` Skill that:

1. inventories enabled plugins, MCP servers, repo/user Skills, and hooks;
2. reads capability-gap tasks and recent qualified observations;
3. searches approved candidate sources;
4. emits a shortlist and prefilled evaluation records;
5. runs only explicitly authorized fixtures;
6. proposes adopt/adapt/develop/reject;
7. never installs or authenticates a candidate.

The inventory is diagnostic. Codex startup configuration and plugin state remain
owned by the host configuration layer.

## 12. Security, privacy, and independence

- Transcript and prompt content is sensitive by default. Store references and
  redaction-safe summaries; avoid copying full turns into tasks.
- Do not expose API tokens as job-level environment variables to processes that
  execute repository-controlled code.
- Record every filesystem root, remote endpoint, and credential class a tool
  may access.
- Split read-only evidence tools from consequential write tools when the
  external system permits it.
- New or changed hooks require review/trust and must not be treated as a complete
  enforcement boundary.
- A tool author may run fixtures, but an independent reviewer must verify the
  authority and data-flow claims before real adoption.
- Evaluation of an observer must include a controlled false-positive or
  unavailable-input case.
- Tool output never independently satisfies Proposal review, Plan check, AC,
  DoD, or ABSORB.

## 13. Proposed repository deliverables

A future implementation sequence should eventually produce:

```text
AGENTS.md
.agents/skills/quay-session-review/SKILL.md
.agents/skills/quay-tool-radar/SKILL.md
.codex/config.toml
schemas/quay-observation.schema.json
schemas/quay-tool-evaluation.schema.json
docs/tooling/catalog.md
docs/tooling/evaluations/
fixtures/tooling/meta-cc/
```

If the workflows later stabilize for reuse outside Quay, package their canonical
source as an internal Codex plugin with:

```text
quay-observability/
  .codex-plugin/plugin.json
  skills/
  hooks/                 # only if independently justified
  .codex-mcp.json        # approved server declarations only
```

The repository Skills may initially be the authoring source. Do not maintain an
independent plugin copy; packaging must be generated or checked for semantic
drift.

## 14. Staged adoption

### Stage 1 — bootstrap existing observers

1. register Quay and meta-cc MCP for a trusted project;
2. prove provider-qualified reads from one real Claude and one real Codex
   session;
3. implement the minimal observation envelope and session-review Skill;
4. convert one finding into a human-approved, deduplicated task mutation;
5. deny session access and prove Quay task operation still works.

### Stage 2 — make tool adoption auditable

6. add the evaluation schema, catalog, fixtures, and `quay-tool-radar` Skill;
7. evaluate meta-cc retrospectively as the first golden record;
8. evaluate one plausible candidate and one intentional rejection;
9. verify that discovery never installs, authenticates, upgrades, or enables.

### Stage 3 — observe bounded Codex execution

10. correlate Codex JSON/OTel operational events, meta-cc session references,
    Quay run identity, worktree, commits, and gate outcomes;
11. prove restart/unavailable-input behavior without transcript recovery;
12. use observations to identify one real process improvement, then measure its
    post-change effect without letting the metric decide task completion.

### Stage 4 — cross-project pilot

13. select one related repository or hosted system with a recorded dependency;
14. pilot the smallest read-only integration;
15. demonstrate evidence-to-task provenance, access revocation, and rollback;
16. package a plugin only after reuse across at least two workspaces proves the
    distribution need.

## 15. Acceptance criteria for an implementing directive

1. `[ ]` One real Claude and one real Codex session can be queried through the
   registered meta-cc MCP with explicit provider selection.
2. `[ ]` Results normalize to `quay-observation/v1`, minimize transcript
   content, and retain tool/version/config/source provenance.
3. `[ ]` Replaying the same finding produces the same fingerprint and no
   duplicate Quay task.
4. `[ ]` Missing/denied/corrupt session evidence returns an explicit unavailable
   result and does not disable Quay task list/get/check/write.
5. `[ ]` `quay-tool-evaluation/v1` validates a golden meta-cc record, a second
   candidate, and a rejected candidate.
6. `[ ]` Candidate evaluation covers authority, data access, network egress,
   secret retention, structured output, performance, maintenance, rollback,
   fixture, negative test, and real scenario.
7. `[ ]` The tool-radar workflow inventories actual Codex configuration and
   produces a shortlist without changing plugin, MCP, hook, or authentication
   state.
8. `[ ]` A write-capable candidate cannot be promoted from a read-only pilot
   without a new explicit authorization and evaluation.
9. `[ ]` Direct transcript parsing does not enter Quay Core, the Provider ABI,
   task gate logic, or control-plane recovery.
10. `[ ]` Disabling meta-cc and all optional observation tooling leaves
    authoritative Quay state valid and operable.
11. `[ ]` An independent review reports zero unresolved findings about
    authority, data flow, provenance, and rollback.
12. `[ ]` One real process improvement is traced from observation to task,
    checked Proposal/Plan, implementation, and post-change measurement.

## 16. Risks

### 16.1 Goodhart pressure

Error counts, retry rates, tool diversity, token use, or cycle time are
diagnostics. Optimizing them directly may reduce useful exploration or hide
failures. Keep raw definitions and never let one metric satisfy Done-when.

### 16.2 Observer-induced authority creep

A convenient MCP may expose writes alongside reads. Codex can then move from
observing an issue to changing external state without a visible boundary.
Separate capabilities, profiles, and promotion decisions.

### 16.3 Context and catalog overload

Too many Skills and tools reduce discovery quality and consume instruction
budget. Keep the approved portfolio small, use precise Skill descriptions, and
disable candidates after evaluation.

### 16.4 Format and version drift

Session, plugin, tool, and telemetry schemas change. Pin versions where
possible, retain adapter/schema tests, and record tool/config hashes with every
observation used for a consequential decision.

### 16.5 Self-confirmation

The same Codex process may generate a change, inspect its own transcript, and
declare success. Require repository/gate evidence and an independent reviewer;
self-observation can locate claims but cannot validate them alone.

## 17. Non-goals

- Turning Quay Core or the Provider ABI into a generic integration hub.
- Mirroring complete Claude/Codex transcripts into the task store.
- Building another parser for host-private session databases.
- Automatically installing marketplace candidates.
- Enabling every curated plugin that appears relevant.
- Treating OTel, meta-cc scores, or tool analytics as an objective function.
- Granting observation tools merge, release, deployment, or lifecycle authority.
- Publishing a public plugin before local and multi-workspace contracts are
  proven.

## 18. Recommendation

Create one bounded directive for **Codex observation bootstrap and tool
evaluation**:

1. register the existing meta-cc and Quay MCP servers;
2. add `quay-session-review` and the minimal evidence schema;
3. prove real Claude/Codex query, redaction, deduplication, and degradation;
4. add the evaluation record and a non-installing `quay-tool-radar`;
5. record meta-cc as the first adopted tool and one unsuitable candidate as the
   first rejection.

Do not combine this with the Codex milestone worker or perpetual supervisor.
The observation bootstrap should become useful to a human-operated Codex
session first. Its own evidence can then inform, but not authorize, the later
execution port.
