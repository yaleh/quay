# Packaging the exp5 perpetual-stream driver as a deliverable — forms, dependency handling, install, universality

- **Status:** proposal / design discussion, drafted only. No code change, no
  scaffold refactor, no directive follows from this document. It records a
  deliverability analysis so the packaging can later be decided and built
  deliberately, not improvised. Per the standing "a proposal is a written
  record, not an authorization" convention this stream uses, **no
  `/quay-directive` was created** — adopting any part of this must enter through
  the normal directive channel at a milestone boundary.
- **Date:** 2026-07-18
- **Context:** captured from a live conversation between the human (Yale) and an
  observer Claude Code session, with exp5 (`experiments/quay-perpetual-stream/`)
  RUNNING at `milestone_counter: 8`, m9 = M-GH-WRITE in flight. The human asked
  how exp5's *driving mechanism* — the thing that has autonomously driven quay
  development across 9 milestones while improving its own methodology — can be
  packaged into a deliverable form: whether it needs Claude Code extension forms
  (skill / subagent / plugin), how to handle its dependency on the `baime`
  plugin's skills/subagents, how a user would install it, whether there is a
  startup/bootstrap process, and how universal the method is. This document is
  the written analysis, grounded in a direct read of the real artifacts (not a
  recollection).
- **Related:**
  [`baime-lite-driving-external-projects.md`](./baime-lite-driving-external-projects.md)
  — the earlier *conceptual* generalization (2026-07-15: "pair quay + a
  BAIME-derived iteration mechanism, V_meta removed, to drive other projects").
  **This proposal is the packaging/deliverability concretization of that note**,
  now grounded in exp5's actual perpetual two-layer implementation rather than
  the single-layer quay-native-bootstrap loop it generalized from. ·
  [`quay-perpetual-stream-experiment-v5.md`](./quay-perpetual-stream-experiment-v5.md)
  (the protocol) ·
  [`exp5-concurrent-background-agents-for-milestone-iteration.md`](./exp5-concurrent-background-agents-for-milestone-iteration.md)
  (the no-nesting / Level-0-orchestrator constraint, which bears on how the
  `iteration-executor` dependency is dispatched) ·
  `experiments/quay-perpetual-stream/OUTER-LOOP.md` (the driver) ·
  `experiments/quay-perpetual-stream/inherited-core.md` (Tier-B methodology).

## 1. What "the exp5 driver" actually is — a three-layer decomposition

`experiments/quay-perpetual-stream/` is **not** a skill or a subagent. It is a
*harness*: a driver prompt + mutable state files + mechanized check scripts + a
single subagent dependency. Delivering it cleanly requires first separating
three layers that are currently physically intermixed in one directory. Which
layer a construct belongs to dictates its correct deliverable form — and whether
it should be delivered at all.

| Layer | Constructs | Nature | Deliverable? |
|---|---|---|---|
| **A. Generic engine** | `OUTER-LOOP.md` (driver prompt); `scripts/` (the mechanized checks — **4 it0 systematic-explore checks**: ceiling arithmetic, gate-hash, dogfood evidence-gate, and domain-misfit audit-channel [procedure, not a standalone script]; plus a **non-it0** drain-time DIR-projection reconcile script run at cycle step 0. The actual script files are `it0-ceiling-check.sh`, `it0-gate-hash-check.sh` [which also carries the `--by-reference` charter-authoring variant], `it0-dogfood-evidence-gate.sh`, and `it0-dir-projection-check.{sh,mjs}` — four script names, of which only the first three implement it0 checks; the domain-misfit check is a *procedure* in `inherited-core.md`, not a script; do not conflate this set with the 4 it0 checks §7/§8 count); the charter three-tier contract; binary Done-when discipline; the inner-termination five conditions; the value-typed SELECT ledger (5 types + governance/infra hard floor); the V_meta consolidation-lag gate; φ consolidation; the human async control surface (`/quay-directive` / `.halt` / non-blocking checkpoints) | **domain-independent** | **Yes** — this is the reusable engine; universality lives here |
| **B. quay instance config** | Value-Trajectory surface decomposition — the **chart-0 origin** is the 5-surface set `{CLI 25 / MCP 20 / Web UI 20 / Packaging 20 / Docs 15}` scored at bootstrap (`OUTER-LOOP.md` first-run step 2); `Provider-ABI` is a **later chart-transition surface** added at m3/M-ABI-EVAL, not part of the origin decomposition — plus weights; the seed `backlog.md`; the 3 `quay-*` methodology skills cited by `inherited-core.md`; the pinned HARD-GATES source (`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`); the quay-MCP dogfooding reconcile path | **quay-specific** | **Yes, but** ships with the quay repo; a new domain re-authors all of it |
| **C. Runtime state** | The *filled-in* `dashboard.md`, `milestones/`, `checkpoints/`, `directives/archive/`, `v-meta-ledger.md` values | **this run's ledger** | **No** — a new instance starts from `UNINITIALIZED`; shipping it would seed a foreign history |

**The first deliverability finding: the A/B/C split is not currently
formalized.** Everything sits in one directory. Extracting the templated engine
(A) and a stripped instance config skeleton (B, blanked to `UNINITIALIZED`) from
the live run state (C) is prerequisite step zero for any packaging.

## 2. Dependency surface — the single-agent finding

Verified against `~/.claude/plugins/installed_plugins.json` (baime installed as
`baime@baime` v1.4.0, `scope: user`, pinned `gitCommitSha:
971befddd36ad5dc4b0bdc31f42f873d610240fe`) and the `baime` plugin manifest
(`plugin/.claude-plugin/plugin.json`, marketplace = directory source
`/home/yale/work/baime`). The manifest declares **4 agents** and **28
skill/command entries** in its `commands[]` array (note: the manifest's own
`description` field self-reports "22 validated skills" — an internal
manifest-vs-`commands[]` discrepancy in baime, not this loop's concern; the
28-entry `commands[]` list is what actually loads). The perpetual loop's
**runtime** dependency on baime is exactly **one agent**:

- **`baime:iteration-executor`** — `OUTER-LOOP.md` step 5 ("DISPATCH INNER")
  dispatches it once per inner iteration, fed the milestone charter (Tier-A)
  only. **This is the sole runtime baime dependency of the loop.**
- The other 3 agents (`iteration-prompt-designer`, `knowledge-extractor`,
  `workflow-coach`) and all 28 skills (`methodology-bootstrapping`,
  `rapid-convergence`, …) were **bootstrapping-time tools** used across exp1–4
  to *distil* the 3 `quay-*` skills. They are **not on the perpetual loop's
  execution path.**

Other dependencies: the 4 project-scoped skills under `.claude/skills/` (3
`quay-*` + `quay-directive`, auto-loaded because project-scoped, no separate
install); quay's own MCP server (`.mcp.json` wires `quay mcp`, used for
`task_list --label directive` reconciliation at drain); Node. `manda` is a
*negatively*-referenced mechanism (the loop's rule is to avoid nested real
dispatch via manda — cf. the concurrency proposal), not a forward dependency.

**Consequence: the runtime baime footprint is small and *probably* vendorable**
(§4). This is what would make self-contained delivery feasible — but "exactly one
agent file" is the *dispatch* surface, not necessarily the *transitive-read*
surface: `iteration-executor.md` reads a surrounding `meta-agents/`/`agents/`
capability tree, and whether that tree is genuinely unused in exp5's charter-only
mode is **unverified** (see the §4 vendoring caveat). Treat "one file" as the
optimistic lower bound, not an established fact.

## 3. Packaging — mapping each layer to a Claude Code extension form

No single extension form holds the whole harness. The correct mapping:

- **Layer A (engine) → a plugin (with a command).** It simultaneously needs: a
  `/loop`-executable **entry command** (run OUTER-LOOP), bundled **script
  assets**, the charter / inherited-core / dashboard / backlog **template
  files**, and a reference to the `iteration-executor` **agent**. Only a plugin
  packages command + agent + file assets together. A lone skill or a lone
  subagent cannot carry the scripts and templates.
- **Layer B (quay config) → in-repo assets + project-scoped skills.** The 3
  `quay-*` skills stay in the repo's `.claude/skills/` (clone ⇒ active, zero
  install); the VT definition / backlog seed / gate source are repo config
  files.
- **`quay-directive` (human steering) → skill.** It already is one (verified
  present at `.claude/skills/quay-directive/`, alongside the 3 `quay-*`
  methodology skills); keep as-is.
- **`iteration-executor` (inner executor) → subagent**, supplied either by baime
  or vendored (§4). Note the dispatch shape is fixed by the no-nesting constraint
  (concurrency proposal §5.0): the engine plugin's `/perpetual-loop` command runs
  as the **Level-0** orchestrator and dispatches `iteration-executor` as a
  **Level-1 leaf** — the executor cannot itself spawn subagents. Any packaging
  that tried to have the executor fan its own build phase out (into `Workflow`/
  `manda` workers) would be a Level-2 nesting violation. This is also why the
  agent runs in the degenerate charter-only mode that §4's vendoring analysis
  depends on.

So the natural deliverable is **"a generic perpetual-BAIME engine plugin" + "a
thin quay instantiation config"** — not one monolith. The engine is, in fact,
the layer baime is *missing*: baime already ships `iteration-executor` and
`methodology-bootstrapping`; it lacks only the never-terminating outer loop. The
cleanest conceptual home for Layer A is therefore **upstream in baime** (or a
companion plugin `baime-perpetual`), at which point exp5 becomes literally
"baime-perpetual running on quay."

## 4. Handling the baime dependency — vendoring recommended

Claude Code plugins have **no inter-plugin dependency resolution**
(`installed_plugins.json` is a flat list with no `requires` field). So the
dependency can only be handled one of three ways:

1. **Declarative dependency** — the deliverable's docs require installing
   `baime@baime` first. Cheapest, but purely documentation + install-order; a
   user who skips it only discovers the gap when step 5 fails mid-run. Too
   brittle for an unattended "run for dozens of milestones" loop.
2. **Vendoring the single agent** — because the runtime need is exactly one
   file, `agents/iteration-executor.md`, inline a pinned copy into the engine
   plugin ⇒ **self-contained, the user need not install baime at all.** Cost:
   drift from upstream baime (mitigated by pinning a version + git SHA and a
   documented refresh step).
3. **Upstreaming to baime** — contribute Layer A into baime and depend on the
   whole plugin. Conceptually cleanest, but ties the deliverable's release
   cadence to baime's.

**Recommendation: 2 + 3 in combination, with (2) in scope now and (3) as an
explicit follow-on.** Upstream the engine into baime (3) for the clean conceptual
home, *and* have the engine plugin carry a pinned, vendored `iteration-executor`
as a fallback (2), so the deliverable never rests on the fragile precondition
"the user first correctly installed another marketplace." Vendoring is the
load-bearing choice — a self-contained artifact is the only one that survives
unattended operation by a user who has never heard of baime.

**Scope decision (upstreaming is out of this deliverable's scope).** Path (3),
upstreaming Layer A into baime, touches a **different repo** (`/home/yale/work/
baime`) and ties this deliverable's release cadence to baime's — it is therefore
**a documented FOLLOW-ON, not part of this packaging effort.** The in-scope work
delivers **vendoring (2) + an in-quay-repo `baime-perpetual` plugin only**; the
upstream contribution is recorded as a note (see §9's phased path) and left to be
filed as its own separate directive against the baime repo. This keeps the whole
deliverable inside a single repo's control.

> **⚠ MAJOR ISSUE (architect review, 2026-07-18) — the "vendor exactly one file"
> premise is unverified and may be false.** The recommendation above ("2 + 3")
> and §2's "the runtime baime footprint is exactly one agent" both rest on the
> unstated assumption that `iteration-executor.md` is a standalone leaf. A direct
> read of the agent file (caveat below) shows it is written as the executor of a
> **full baime meta-agent/agent capability tree** and reads that tree in ≥3
> places. In the live exp5 run baime **is** installed, so those reads may be
> silently resolving against baime's installed cache
> (`~/.claude/plugins/cache/baime/baime/1.4.0/`) rather than degrading to no-ops
> — which would mean the loop already depends on more than one file *today*, and
> the "no baime install needed" claim is not established. This must be resolved
> by the no-baime-present isolation test (§9 phase 3 gate) **before** vendoring
> is committed to. Recommendation 2+3 is retained as the likely-correct
> direction, but it is now *conditional* on that test, not settled.

**Vendoring completeness caveat (verified against the agent file, and it is
worse than a one-file copy — read this before choosing vendoring).** The one
file is **not** unconditionally self-contained. `agents/iteration-executor.md`'s
own body references a surrounding meta-agent/agent capability directory in **at
least three** places, not two — a direct read of the file confirms:
`meta_agent_context(M) = read(meta-agents/*.md) ∧ … ∧ verify(complete)` (line
12), `agent_protocol(agent) = ∀invocation: read(agents/{agent}.md)` (line 80),
and `meta_protocol(M) = ∀capability: read(meta-agents/{capability}.md)` (line
83). It also reads `iteration_{n-1}.md` (line 9, the prior iteration report) and,
in its `output`/`system_evolution` clauses, can *write* evolved `agents/*.md` and
`meta-agents/*.md` (lines 100-105, 29-36). So the agent is written as the
executor of a **full baime meta-agent/agent tree**, not a standalone leaf.

**Why single-file dispatch nonetheless works in exp5 — and the load-bearing
assumption it rests on.** In exp5's *actual* usage the executor is run in a
**degenerate, non-orchestrating mode**: it is dispatched as a Level-1 leaf (per
the no-nesting constraint of the concurrency proposal, §5.0 — a Level-1 subagent
**cannot** spawn Level-2 workers, so `coordinate_agents` / `create_specialized_agent`
have no one to dispatch anyway), and it is "fed the milestone **charter (Tier-A)**
only," with `inherited-core.md` (Tier-B) supplying methodology by reference. In
that mode the `read(meta-agents/*.md)` / `read(agents/{agent}.md)` globs resolve
against an **absent** directory and (apparently) degrade to no-ops — the charter +
inherited-core carry the actual guidance. The single-file dispatch works
*because* exp5 never exercises the multi-agent orchestration the agent body was
written for.

**This is an unverified degradation, and it is the load-bearing risk of the
vendoring recommendation.** Whether those globs degrade *gracefully* (silent
no-op) versus *hard-fail* (a `verify(complete)` on line 12 that treats an empty
`meta-agents/*.md` read as an incomplete-context error) has **not been verified
in isolation** — in the live run baime *is* installed, so the paths may resolve
against baime's own cached `meta-agents/` tree at
`~/.claude/plugins/cache/baime/baime/1.4.0/…` rather than degrading to nothing.
That would mean the "single agent, self-contained" premise is **false**: the
loop may be silently leaning on baime's installed capability tree today, and a
vendored copy on a machine with no baime install could behave differently.
**Before committing to vendoring (or to the "install baime is unnecessary"
claim), run the vendored agent against a charter on a machine/sandbox with no
baime `meta-agents/`/`agents/` directory reachable and confirm it resolves
entirely from charter + inherited-core.** If it does not, vendoring must also
carry the meta-agent/agent capability files it actually reads — still a bounded,
self-contained set, but materially larger than "one file," and §2's "the runtime
baime footprint is exactly one agent file" claim would need to be softened to
"one agent plus the meta-agent capability files it transitively reads."

## 5. Install flow (real sequence, for a user on their own project)

1. **Install the engine plugin** (`/plugin marketplace add …` + `/plugin
   install baime-perpetual`), or skip if using the vendored build.
2. **Ensure `iteration-executor` is available** (install baime, or rely on the
   vendored copy).
3. **Place the instance scaffold in the target repo**: OUTER-LOOP config + an
   `UNINITIALIZED` `dashboard.md` + a seed `backlog.md` + at least one
   inner-methodology skill + a pinned gate source. Project-scoped skills go in
   the repo's `.claude/skills/` — clone ⇒ active, no separate install.
4. **Runtime/MCP**: Node + built artifacts; if reusing quay's dogfooding
   reconcile, an MCP provider exposing `task_list --label directive` (or drop
   that and drain directives from files only, removing the dependency).
5. **Config `.quay/config.yml`** (only if using quay as the task store —
   droppable for a non-quay project).

## 6. Bootstrap / startup — it exists, and it is the universality bottleneck

There is an explicit one-time bootstrap. `OUTER-LOOP.md`'s "First-run bootstrap"
runs **only when `dashboard.md` is `UNINITIALIZED`**: score the VT origin, set
`state: RUNNING` / `counter: 0` / `chart: 0`, commit; then run the outer cycle
one milestone at a time under `/loop`.

For quay this is light (VT surfaces already defined). For a **new project** it is
heavy, and it is where universality actually gets paid for. To instantiate, a
user must:

- define the VT surface decomposition + weights (what "product value" means,
  and how to score each surface's `cov_s ∈ [0,1]`) — the single biggest,
  inherently project-specific cost;
- seed a backlog;
- pick a pinned HARD-GATES source;
- confirm an **independent audit channel** exists (else the domain-misfit it0
  check hard-blocks — by design);
- provide or stub at least one inner-methodology skill (cold-start possible, but
  early ρ is weak).

Today this instantiation is **expert-only tacit knowledge** with no guided path.
**The missing piece for genuine deliverability is a `/perpetual-init` bootstrap
skill** that turns those five steps into an interactive Q&A that emits an
`UNINITIALIZED` scaffold. Without it, the deliverable serves only people who
already understand BAIME.

## 7. Universality assessment (honest tiers)

- **Transfers cleanly (domain-independent):** the two-layer architecture, the
  charter contract, Done-when discipline, the 4 it0 checks (**as defined in §1**:
  ceiling, gate-hash, dogfood-evidence, and the domain-misfit *procedure* — 3
  scripts + 1 procedure; the 4th *script*, dir-projection, is the non-it0 drain
  reconcile and is **not** one of these four), the value-typed SELECT ledger, the
  V_meta gate, φ consolidation, and the async human control surface. This is a
  genuine general-purpose "perpetual self-improving dev loop."
- **Requires per-domain instantiation (real work):** VT surface decomposition +
  scoring; seed backlog; pinned gate source; a per-domain independent audit
  channel.
- **Structural preconditions (unmet ⇒ not applicable):** the domain must have
  (a) a **mechanizable value function** (you can score `cov` numerically), (b)
  **at least one independent verification channel** (else domain-misfit
  hard-blocks — this excludes domains with no mechanizable verification, e.g.
  pure research/creative work with no binary Done-when), and (c) enough
  decomposable surface area to keep generating milestones. **Software projects
  with CI are the sweet spot.**
- **Claude-Code-bound:** the loop relies on `/loop`, background `Agent`
  dispatch, the harness completion-notification wake, and the subagent
  no-nesting constraint (see the concurrency proposal). It is **not portable to
  other agent runtimes** without rework.

## 8. Delivery-readiness blockers (must clear first)

1. **The consolidation debt is a delivery prerequisite, not methodological
   nicety.** `inherited-core.md` is still a *delta chain of citations* to 3
   separate `quay-*` skills that "must be read in order; citations can drift"
   (the kickoff commit's own disclosed "Known weakness", the very thing
   DIR-006 / DIR-007 / DIR-008 target). A deliverable **cannot** ask the user to
   also install 3 quay-specific skills and read them in a required order.
   Collapsing the delta chain into a single consolidated core (what DIR-008 et
   al. request) is therefore **a precondition for clean packaging**, not just
   internal hygiene.
2. **The A/B/C layer split (§1) is not formalized** — the templated engine, the
   instance config skeleton, and the live run state must be physically
   separated before anything can be extracted.
3. **No automated plugin-dependency mechanism (§4)** — handled by vendoring +
   docs, not by the platform.
4. **No `/perpetual-init` wizard (§6)** — new-domain instantiation is currently
   expert-only.

## 9. Recommended deliverable shape

Three artifacts, plus a phased path:

- **(a) `baime-perpetual` engine** — Layer A as a plugin: OUTER-LOOP as a
  `/perpetual-loop` command, the it0 scripts, the charter / inherited-core /
  dashboard / backlog **templates** (`UNINITIALIZED`), reusing (and vendoring a
  pinned fallback of) `iteration-executor`. Universality lives here. **Build
  location: `plugins/baime-perpetual/` inside the quay repo** (the quay repo has
  no `plugins/` dir today, so this convention is established by this work; the
  alternative — a standalone marketplace repo — is deferred to the upstreaming
  follow-on below). Natural *eventual* upstream home: baime itself, but that is a
  follow-on (see the phased path), not this deliverable.
- **(b) quay instantiation (in-repo)** — Layer B: VT definition + weights, seed
  backlog, the (consolidated — see §8.1) methodology skill, the pinned gate
  source. Ships with the quay repo.
- **(c) `/perpetual-init` bootstrap wizard** — the interactive instantiation
  path that makes (a) usable on a non-quay project.

**Phased path (each phase independently useful):**
1. Formalize the A/B/C split inside the quay repo (§8.2) — pure refactor, no new
   capability, unblocks everything else. **Decision: annotate/extract-by-copy
   first, defer physical moves of live state.** Because the loop is live (this
   record was written at `counter: 8`), Phase 1 classifies every file via a
   `LAYERS.md` manifest and extracts blanked engine templates *by copy*; it does
   **not** physically relocate the live A/B/C files out from under the running
   loop. Physical relocation, if ever wanted, is a later boundary-scheduled move,
   not part of the initial split.
2. Pay down the consolidation debt (§8.1) so Layer B is a single self-contained
   skill, not a 3-citation chain.
3. Extract Layer A as `baime-perpetual` with a vendored `iteration-executor`.
   **This phase has a hard entry gate: the §4 vendoring caveat must be
   *empirically resolved* first**, by running the executor against a charter on a
   sandbox with **no baime `meta-agents/`/`agents/` tree reachable** and
   confirming it resolves entirely from charter + inherited-core. Until that test
   passes, the "one agent file, no baime install needed" premise is unverified
   and this phase cannot be scoped correctly (the vendored set may be one file or
   several). Do not begin phase 3 on the assumption; begin it on the test result.
4. Add `/perpetual-init`. Only after this is the loop deliverable to a stranger.
5. **(FOLLOW-ON, out of this deliverable's scope)** Upstream Layer A into baime
   (rec 3) as `baime-perpetual` or a companion plugin in the baime repo. This is a
   *separate* effort against a different repo (`/home/yale/work/baime`), filed as
   its own directive; phases 1–4 above deliver a fully self-contained in-quay-repo
   plugin that does **not** depend on it. Listed here only to record the eventual
   clean home, not to place it in scope.

## 10. Status / next step

- No directive filed, no scaffold change applied.
- The two hard prerequisites (§8.1 consolidation debt, §8.2 layer split) are
  already independently motivated by DIR-006 / DIR-007 / DIR-008 and by basic
  packaging hygiene — i.e. the delivery goal and the outstanding methodology
  debt point at the same next action, which is a reason to sequence the debt
  paydown ahead of any packaging build.
- If adopted, this should enter through `/quay-directive` at a milestone
  boundary, scoped as (1) layer split, then (2) consolidation, then (3) engine
  extraction + vendoring, then (4) the init wizard — never as one big bang.
