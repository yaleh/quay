# Porting the exp5 perpetual development loop to Codex

- **Status:** proposal / portability analysis, updated only. No Codex adapter,
  control-plane runtime, supervisor, project configuration, Skill, agent, hook,
  MCP registration, or scheduled task is implemented by this document.
  Adoption must enter the normal exp5 directive and milestone process.
- **Date:** 2026-07-18; architecture update 2026-07-26
- **Context:** captured from a live human-directed review of the recent exp5
  history and a capability check against the locally installed Codex CLI
  (`codex-cli 0.144.6`) and the current Codex manual. The question is whether
  Codex can drive quay continuously in the same two-layer shape as exp5, not
  merely whether Codex can implement one milestone.
- **Related:**
  [`exp5-driver-deliverability-packaging.md`](./exp5-driver-deliverability-packaging.md)
  defines the generic-engine / quay-instance / runtime-state split and identifies
  `baime:iteration-executor` as exp5's sole runtime baime dispatch dependency. ·
  [`quay-perpetual-stream-experiment-v5.md`](./quay-perpetual-stream-experiment-v5.md)
  defines the two-layer experiment. ·
  [`exp5-concurrent-background-agents-for-milestone-iteration.md`](./exp5-concurrent-background-agents-for-milestone-iteration.md)
  records the isolation and concurrency constraints. ·
  `experiments/quay-perpetual-stream/OUTER-LOOP.md` is the live driver. ·
  `experiments/quay-perpetual-stream/inherited-core.md` is the live Tier-B
  method substrate. ·
  [`quay-control-plane-host-adapters-human-control-surface.md`](./quay-control-plane-host-adapters-human-control-surface.md)
  defines the runtime-neutral three-system boundary this Codex adapter must
  implement rather than bypass.

## 1. Decision summary

The exp5 method is portable to Codex, but the current harness is not a drop-in
Codex workload.

- The repository-state machine, bounded-charter discipline, gates, value
  ledger, directives, HALT sentinel, checkpoints, worktree isolation, tests,
  and evidence requirements are runtime-neutral and should be retained.
- Codex provides the required reasoning and execution primitives: long-running
  goals, subagents and custom agents, Skills, MCP, lifecycle hooks, local Git
  worktrees, browser tooling, non-interactive `codex exec`, JSON event output,
  and output-schema validation.
- Codex does not provide one single primitive equivalent to exp5's complete
  `completion notification -> wake OUTER -> poll/re-arm -> continue forever`
  contract. Goal continuation and scheduled in-chat follow-ups cover parts of
  that contract, but process death, machine sleep, permission failures, and
  cross-session recovery still need a deterministic owner.
- Therefore the recommended design is **Codex as one replaceable Host Adapter
  and milestone execution engine, supervised through Quay's runtime-neutral
  control-plane contract**. A small deterministic runtime still owns
  scheduling, leases, child completion, recovery, and state transitions, but
  those responsibilities belong to Quay's control plane rather than to a
  Codex-specific harness.

A single interactive Codex Goal is suitable for proving the port and for
multi-hour supervised runs. It is not the production reliability boundary for
an intentionally perpetual autonomous developer.

## 2. Ground truth: what Codex can supply

The current Codex product and local installation expose the following relevant
surfaces:

| Required exp5 capability | Codex surface | Portability finding |
|---|---|---|
| Durable outer instructions | repo Skill + `AGENTS.md` | Direct mapping |
| Long multi-step foreground run | Goal mode / automatic continuation | Direct mapping for a bounded live run |
| Independent workers and reviewers | subagents + project custom agents | Direct mapping, subject to worktree isolation |
| Separate checkouts | Codex App worktrees or explicit `git worktree` + `codex exec -C` | Direct mapping |
| Machine-checkable iteration result | `codex exec --json --output-schema` | Direct mapping |
| quay task access | Codex MCP server config or existing quay CLI | Direct mapping after registration |
| Reusable iteration workflow | `.agents/skills/<skill>/SKILL.md` | Direct mapping after migration |
| Mechanical policy enforcement | project hooks + existing gate scripts | Direct mapping |
| Web UI evidence | Playwright/browser MCP | Direct mapping in this environment |
| Heartbeat/poll in the same context | scheduled task in an existing chat | Partial mapping; desktop/Web managed, not CLI managed |
| Exact child-completion wake | parent waiting on subagent, or supervisor waiting on process | Direct only while the owning process/session remains alive |
| Restart-safe perpetual loop | repository state + external supervisor | Adapter required |

Codex documentation used for these findings:

- Long-running Goal mode:
  <https://learn.chatgpt.com/docs/long-running-work>
- Subagents and project custom agents:
  <https://learn.chatgpt.com/docs/agent-configuration/subagents>
- Scheduled tasks and same-chat follow-up loops:
  <https://learn.chatgpt.com/docs/automations>
- Skills and repository discovery under `.agents/skills`:
  <https://learn.chatgpt.com/docs/build-skills>
- Git worktree behavior:
  <https://learn.chatgpt.com/docs/environments/git-worktrees>

## 3. Current incompatibilities in this repository

The following are concrete adapter gaps, not limitations of the exp5 method.

### 3.1 Claude-specific Skill discovery

The inherited methodology and directive Skills live under `.claude/skills/`.
Codex repository Skills are discovered under `.agents/skills/`; the current
files will not become Codex Skills merely because their Markdown is readable.
Their instruction bodies are largely reusable, but Claude-specific frontmatter,
tool names, invocation syntax, and paths must be adapted.

In particular, `/quay-directive` becomes an explicitly invoked Codex Skill such
as `$quay-directive`, and references that assert `.claude/skills/...` as the
runtime location must point at a runtime-neutral logical artifact or a Codex
path.

### 3.2 MCP configuration is not shared

The repository's `.mcp.json` registers `quay` for the existing Claude
environment. The checked local Codex configuration does not currently list a
`quay` MCP server. A project-scoped Codex configuration must register the same
stdio command, or the adapter must consistently use the already-documented
quay CLI fallback.

The MCP path is preferred because it exercises the same provider-neutral tool
surface that exp5 is meant to dogfood. The CLI fallback remains required for
bootstrap and MCP failure recovery.

### 3.3 The inner executor is vendor-specific

`OUTER-LOOP.md` dispatches `baime:iteration-executor` with
`run_in_background=true`. Codex has neither that named agent nor the baime
plugin contract. This is the main behavior that must be re-authored rather than
path-renamed.

The Codex replacement should be a paired design:

1. `.agents/skills/exp5-iteration-executor/SKILL.md` defines the charter-only
   workflow, evidence obligations, stop conditions, report shape, and commit
   contract.
2. `.codex/agents/iteration-worker.toml` pins the worker role, model/reasoning
   defaults, sandbox, MCP access, and instructions.

An adversarial reviewer should be a second custom-agent definition, not a mode
flag on the worker, so that the audit prompt can explicitly distrust the claims
under review and receive only the permitted evidence bundle.

### 3.4 Manda rules are not portable implementation rules

`inherited-core.md` contains Manda-specific self-deadlock and broker
responsiveness rules. Their general lesson -- do not let a result-dependent
synchronous call prevent the orchestrator from servicing its own control
channel -- remains valid. The concrete Manda broker/cap-request mechanics do
not.

The Codex port should replace those sections at the adapter boundary with:

- subagent wait/notification while the root turn is alive; or
- OS child-process completion and polling owned by the supervisor.

It must not claim that reproducing Manda's background flags reproduces Codex
reliability.

### 3.5 A perpetual goal is intentionally never "done"

Goal mode expects an outcome and completion criteria. The exp5 outer loop is
homeostatic and deliberately does not complete except on HALT or falsification.
Using one perpetual Goal as the only scheduler creates a semantic mismatch and
makes chat/process lifetime part of the experiment's correctness boundary.

The Codex Goal should instead be bounded to a recoverable unit, preferably:

> Complete exactly one exp5 outer cycle from boundary drain through committed
> ABSORB, or stop earlier on a declared HALT/block condition.

The control-plane runtime repeats this bounded goal through the adapter. This
preserves exp5's infinite outer horizon without requiring any individual model
run to be infinite.

### 3.6 There is no runtime-neutral Host Adapter contract yet

The original version of this proposal placed a Codex-specific supervisor
directly between repository state and `codex exec`. That is sufficient for a
one-host proof, but it would make the next Claude, CI, remote-executor, or
multi-machine integration reimplement scheduling and recovery again.

The missing boundary is a small host-neutral contract. At minimum it must
support:

- capability discovery;
- start, poll, message, cancel, collect, and resume operations for a bounded
  run;
- stable workspace, task, run, attempt, and session-reference identifiers;
- idempotency keys and accepted/delivered/started/completed acknowledgements;
- structured results containing base/result commits, evidence, blockers, and
  termination reason;
- no requirement that a control-plane consumer understand Codex transcript or
  UI internals.

Codex Goals, subagents, scheduled follow-ups, `codex exec`, and App worktrees
are implementation choices behind this boundary. They are not themselves the
Quay runtime protocol.

## 4. Proposed architecture

### 4.1 Three-system boundary

| System | Codex-port responsibility | Authority |
|---|---|---|
| **Quay control plane** | task/dependency state, workspace registry, run records, leases, GateEvents, scheduling, retry/recovery state, budgets, cross-project status | Authoritative for orchestration state |
| **Codex Host Adapter** | translate the neutral run contract into Goal/subagent/`codex exec`/worktree operations; normalize results and session references | Authoritative only for the lifecycle of its host processes |
| **Human control surface** | goals, policy, approvals, exceptions, risk/cost review, mission redirection, cross-project portfolio decisions | Authoritative for explicitly human-owned decisions |

Within the Codex Host Adapter, the **outer Codex agent** still performs DRAIN,
SELECT, value hypothesis, charter authoring, gate interpretation,
merge/adjudication, and ABSORB; **inner Codex agents** still perform isolated
implementation/re-derivation and adversarial audit. These are execution roles,
not additional control-plane layers.

The repository substrate remains the durable project record. The control plane
projects that record into explicit run/lease/event state. The chat transcript
is diagnostic context, not authoritative state. A restarted control-plane
runtime must determine the next legal action from Git, task and GateEvent
state, run records, process metadata, and explicit leases without reconstructing
intent from a conversation.

### 4.2 Control flow

```text
control-plane wake
  -> acquire single-writer workspace lease
  -> inspect Git/index/worktrees and recover interrupted state
  -> check .halt
  -> ask Codex Host Adapter to start bounded outer run: DRAIN/SELECT/AUTHOR/gates
  -> create iteration worktree(s) from the recorded base SHA
  -> ask adapter to start Codex iteration worker(s) with frozen inputs
  -> consume lifecycle acknowledgements; heartbeat only detects hangs
  -> validate normalized result envelope, commit, report, and gate evidence
  -> ask adapter for a fresh-context reviewer/adjudicator when required
  -> merge one canonical result; run post-merge semantic sweep and tests
  -> ask adapter for bounded outer run: ABSORB/checkpoint/commit
  -> append terminal run events and release lease
  -> immediately schedule the next cycle unless HALTed
```

The default should preserve exp5's current whole-milestone independent
re-derivation for methodology/design milestones. Development milestones may use
the M18-approved proposal-diversity / single-implementation / light-tail-check
shape only after its required proposal-adjudication Skill exists.

### 4.3 Inner invocation contract

A Codex Host Adapter may implement a worker invocation with the following
shape:

```sh
codex exec \
  -C "$worktree" \
  --json \
  --output-schema schemas/exp5-iteration-result.schema.json \
  '$exp5-iteration-executor <charter-path>'
```

The adapter must normalize the invocation into a host-neutral run envelope. Its
structured result must include at least:

- workspace, task, run, attempt, and adapter identifiers;
- milestone and iteration ids;
- exact base and result commit SHAs;
- per-Done-when verdict with evidence pointer;
- commands/tests executed and exit status;
- files changed and out-of-scope check;
- discoveries and unresolved blockers;
- termination condition;
- whether iteration-1 or an out-of-band audit is recommended;
- an opaque session reference suitable for diagnostics but unnecessary for
  recovery;
- a final clean-worktree assertion.

The schema validates the report envelope, not the truth of the claims. Existing
gate scripts, tests, diff inspection, and the independent reviewer remain the
truth checks.

## 5. Worktree and concurrency policy

Codex subagents in one local run must not be assumed to receive separate Git
worktrees. Parallel write-heavy agents sharing a checkout recreate exactly the
contention exp5 is designed to avoid.

The adapter must enforce:

1. The outer agent is the only writer to the main experiment state and the only
   merger into the integration branch.
2. Every implementation/re-derivation worker receives a distinct worktree and
   branch or detached starting point, pinned to the same recorded base SHA.
3. Workers may not edit `dashboard.md`, `backlog.md`, directive lifecycle state,
   or another worker's milestone report.
4. A worker commits only its scoped deliverable and its own iteration report.
5. No milestone N+1 starts before milestone N is absorbed. Parallelism is
   allowed only for genuinely independent work inside the frozen milestone.
6. A post-merge sweep checks referenced identifiers and paths even when Git
   reports a conflict-free merge. M18's mismatched line-budget script names are
   the standing proof that conflict-free is not semantically consistent.

## 6. Recovery and idempotency

The control-plane runtime needs an explicit, small state machine rather than
inferring all states from prose or Codex conversation history. Suggested
states are:

```text
BOUNDARY
SELECTED
INNER_RUNNING
INNER_COMPLETE
AUDIT_RUNNING
READY_TO_MERGE
MERGED_UNABSORBED
ABSORBED
HALTED
BLOCKED
```

Every transition records the workspace/task/run/attempt ids, adapter id,
milestone id, base SHA, process id, opaque session reference, worktree paths,
branch/commit ids, timestamps, acknowledgements, and the command that
establishes the next-state predicate. State may be stored in a small generated
file under the experiment directory or derived from a structured append-only
event log.

On restart:

- an exited child with a valid result and commit is complete, not relaunched;
- a live child is polled, not duplicated;
- a missing/dead child without a valid result is marked interrupted and may be
  retried from the same base in a new worktree;
- a merged-but-unabsorbed milestone resumes at post-merge verification/ABSORB,
  never at SELECT;
- a dirty main index not owned by the current transition blocks automation and
  requests human disposition;
- `.halt` wins at the next safe boundary, preserving exp5 semantics.

Retries require stable idempotency keys such as
`<experiment>/<milestone>/<iteration>/<attempt>`. A retry must never silently
reuse or overwrite an earlier attempt's report.

## 7. Permissions and unattended-operation boundary

Unattended development changes the security posture. The port should default to
the narrowest environment that can complete the selected milestone:

- workspace-scoped write access rather than unrestricted filesystem access;
- `approval_policy = "never"` only inside an externally constrained automation
  environment where every necessary command has already been exercised;
- command rules for Git, Node/npm, test runners, quay CLI, and approved browser
  tooling;
- network disabled by default, enabled per charter for GitHub Provider/live API
  evidence;
- secrets provided to the exact child that needs them and excluded from logs;
- hooks that reject writes to the integration branch/state files from worker
  roles and reject destructive Git operations;
- hard caps on concurrent agents, attempts, wall time, token/cost budget, and
  retained worktrees.

A scheduled Codex task running with full access is not an acceptable substitute
for these controls. Scheduled same-chat heartbeats are useful as a wake and
human-visible inbox, but the control plane remains responsible for policy
enforcement and recovery. Decisions that cannot be resolved mechanically must
be emitted as structured exceptions to the human control surface rather than
left as unanswered prompts in a Codex session.

## 8. Proposed repository deliverables

A future implementation should produce, at minimum:

```text
AGENTS.md
.agents/skills/exp5-outer-loop/SKILL.md
.agents/skills/exp5-iteration-executor/SKILL.md
.agents/skills/quay-directive/SKILL.md
.codex/config.toml
.codex/agents/iteration-worker.toml
.codex/agents/adversarial-reviewer.toml
.codex/hooks/...
schemas/quay-host-adapter.schema.json
schemas/quay-run-envelope.schema.json
scripts/exp5-codex-supervisor.mjs
schemas/exp5-iteration-result.schema.json
experiments/quay-perpetual-stream/codex-adapter/README.md
```

The adapter should not duplicate the live protocol, control-plane state
machine, or Tier-B substrate into its Skills. It should cite stable repository
paths, resolve the pinned HARD GATES into the actual worker prompt, and fail if
the expected hashes or files drift.

The project Codex MCP configuration should register the equivalent of:

```toml
[mcp_servers.quay]
command = "node"
args = ["packages/quay/bin/quay.js", "mcp"]
```

Exact project-config syntax and trust behavior must be verified against the
Codex version used by the implementing milestone rather than copied blindly
from this proposal.

## 9. Adoption sequence

This is a risk-reduction sequence, not an implementation plan with estimated
line counts.

1. **Freeze the neutral contract:** define the Host Adapter operations, run
   envelope, lifecycle acknowledgements, and lease/idempotency rules without
   Codex-only fields.
2. **Read-only replay:** have a Codex outer Skill reconstruct SELECT and expected
   gates for a completed milestone without writing anything; compare its result
   to the historical record.
3. **One bounded worker:** port the iteration executor and run it on a disposable
   fixture milestone in one explicit worktree with no autonomous continuation.
4. **Dual iteration + adjudication:** prove two same-base worktrees, structured
   results, canonical selection, semantic post-merge sweep, and cleanup.
5. **One complete outer cycle:** let Codex drain through committed ABSORB for a
   deliberately small real milestone under human observation.
6. **Crash recovery drills:** terminate the control-plane runtime and adapter in
   every transition state and verify they resume without duplicate workers,
   duplicate commits, skipped gates, or a second SELECT.
7. **Scheduled continuation:** enable same-chat heartbeat or system service only
   after the bounded cycle and recovery tests pass.
8. **Perpetual pilot:** run with conservative milestone, concurrency, network,
   cost, and checkpoint limits; expand only from recorded evidence.

## 10. Acceptance criteria for a future implementing milestone

1. `[ ]` A runtime-neutral Host Adapter contract exists and contains no Codex
   transcript, Goal, UI, or internal database assumptions.
2. `[ ]` Codex discovers and explicitly invokes the repo-scoped outer,
   iteration, and directive Skills from `.agents/skills/`.
3. `[ ]` Codex can list/get/check/write quay tasks through the registered MCP
   server, with the CLI fallback demonstrated separately.
4. `[ ]` Two workers start from the same commit in different worktrees and
   cannot modify the main experiment state.
5. `[ ]` Worker results validate against the checked-in JSON schema; malformed,
   incomplete, and claim-only results fail closed.
6. `[ ]` All current it0 gates run before dispatch and their evidence is
   retained in the milestone record.
7. `[ ]` The canonical merge runs the full required test set plus a semantic
   cross-reference sweep, including a fixture that Git merges cleanly but that
   is internally inconsistent.
8. `[ ]` Adversarial-audit cadence is reproduced with a fresh-context reviewer
   that has not read the worker's hidden conversation.
9. `[ ]` HALT, pending directives, checkpoint cadence, VT/V_meta ledgers, and
   milestone-boundary-only steering retain their existing semantics.
10. `[ ]` Forced termination at each control-plane/adapter state resumes
    idempotently, with no duplicate SELECT, duplicate worker, lost commit, or
    skipped ABSORB.
11. `[ ]` Recovery succeeds with the referenced Codex conversation unavailable,
    proving session history is diagnostic rather than authoritative state.
12. `[ ]` A complete real milestone reaches committed ABSORB without manual
    process intervention; any human content decision remains explicitly
    recorded as such.
13. `[ ]` Permission, network, secret-redaction, concurrency, retry, cost, and
    worktree-retention limits are configured and tested.
14. `[ ]` The adapter can be disabled without changing or corrupting the
    existing Claude/exp5 runtime artifacts.

## 11. Risks and open decisions

### 11.1 Product-surface dependence

Codex App/Web scheduled tasks offer convenient same-chat continuation, but the
CLI does not currently manage Scheduled tasks. Decide whether the supported
deployment is desktop-attached, an OS service around `codex exec`, or hosted
automation. The engine must not silently depend on whichever surface happened
to be used during development.

### 11.2 Model and behavioral drift

Codex model versions, agent behavior, and tool schemas will change. Frozen
charters and output schemas reduce this risk but do not eliminate it. Record the
Codex version, model, reasoning effort, config profile, and Skill hashes in each
iteration report so changes are auditable.

### 11.3 Cost and runaway autonomy

Independent re-derivation, adversarial audits, and perpetual continuation are
intentionally expensive. The supervisor needs predeclared per-milestone and
rolling-window limits, with a BLOCKED/HALT-RECOMMENDED transition when exceeded.
Token or time exhaustion must never be interpreted as Done-when completion.

### 11.4 Context is not state

Long-running chats compact and accumulate irrelevant history. The port should
prefer fresh bounded runs with explicit Tier-A/Tier-B inputs over one immortal
conversation. Scheduled continuation in the same chat is a convenience for
steering, not a substitute for control-plane recovery. Session references may
be retained for meta-cc inspection, but no legal state transition may require
the transcript to remain available.

### 11.5 Parallel write hazards

Codex documentation itself cautions that parallel write-heavy subagents create
conflicts. The exp5 dual-derivation policy is valuable only if isolation is real;
otherwise it becomes two agents racing on one index. Worktree ownership is a
hard gate, not a best-effort instruction.

### 11.6 Coexistence with the active stream

The live exp5 stream and a Codex pilot must not both own the outer integration
branch. During migration, use replay/fixture branches first, then an explicit
single-owner cutover or pause sentinel. DIR-013's concurrent human/loop design
collision is the standing example of why two orchestrators may not write the
same canonical artifact concurrently.

## 12. Non-goals

- Replacing quay's Provider ABI, task store, gate semantics, or directive
  projection design.
- Rewriting the exp5 protocol around Codex product terminology.
- Claiming Goal mode alone provides daemon-grade perpetual execution.
- Depending on undocumented Codex internals or database files under
  `$CODEX_HOME` as the experiment state store.
- Running milestones in parallel across the outer-loop ABSORB dependency.
- Automatically pushing, releasing, deploying, or changing external systems
  without a separately authorized charter and permission profile.
- Treating this proposal as authorization to start an unattended Codex loop.

## 13. Recommendation

Proceed with the port as a dedicated, bounded implementation milestone after
the current documentation consistency issue and active exp5 boundary state are
resolved. Freeze the Host Adapter/run-envelope contract first, then build the
repo-scoped Skills and one-cycle Codex adapter. Introduce the deterministic
control-plane runtime only after the worker contract is demonstrated; enable
scheduled or service-driven continuation only after crash-recovery drills pass.

This preserves the part of exp5 that matters -- bounded independent experiments
inside an open-ended value loop -- while assigning reliability to deterministic
software, policy, and explicit human exceptions rather than asking an
individual Codex conversation to be immortal.
