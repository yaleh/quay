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
| **A. Generic engine** | `OUTER-LOOP.md` (driver prompt); `scripts/` (5 it0 mechanized checks: ceiling arithmetic, gate-hash, dogfood evidence-gate, dir-projection, gate-hash-by-reference); the charter three-tier contract; binary Done-when discipline; the inner-termination five conditions; the value-typed SELECT ledger (5 types + governance/infra hard floor); the V_meta consolidation-lag gate; φ consolidation; the human async control surface (`/quay-directive` / `.halt` / non-blocking checkpoints) | **domain-independent** | **Yes** — this is the reusable engine; universality lives here |
| **B. quay instance config** | Value-Trajectory surface decomposition `{CLI 25 / MCP 20 / WebUI 20 / Packaging 20 / Docs 15 / Provider-ABI 20}` + weights; the seed `backlog.md`; the 3 `quay-*` methodology skills cited by `inherited-core.md`; the pinned HARD-GATES source (`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`); the quay-MCP dogfooding reconcile path | **quay-specific** | **Yes, but** ships with the quay repo; a new domain re-authors all of it |
| **C. Runtime state** | The *filled-in* `dashboard.md`, `milestones/`, `checkpoints/`, `directives/archive/`, `v-meta-ledger.md` values | **this run's ledger** | **No** — a new instance starts from `UNINITIALIZED`; shipping it would seed a foreign history |

**The first deliverability finding: the A/B/C split is not currently
formalized.** Everything sits in one directory. Extracting the templated engine
(A) and a stripped instance config skeleton (B, blanked to `UNINITIALIZED`) from
the live run state (C) is prerequisite step zero for any packaging.

## 2. Dependency surface — the single-agent finding

Verified against `~/.claude/plugins/installed_plugins.json` and the `baime`
plugin manifest (`baime@baime` v1.4.0, marketplace = directory source
`/home/yale/work/baime`, `plugin/.claude-plugin/plugin.json`). baime ships **4
agents + 28 skills**. The perpetual loop's **runtime** dependency on baime is
exactly **one agent**:

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

**Consequence: the runtime baime footprint is tiny and therefore vendorable**
(§4). This is what makes self-contained delivery feasible.

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
- **`quay-directive` (human steering) → skill.** It already is one; keep as-is.
- **`iteration-executor` (inner executor) → subagent**, supplied either by baime
  or vendored (§4).

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

**Recommendation: 2 + 3 in combination.** Upstream the engine into baime (3) for
the clean conceptual home, *and* have the engine plugin carry a pinned, vendored
`iteration-executor` as a fallback (2), so the deliverable never rests on the
fragile precondition "the user first correctly installed another marketplace."
Vendoring is the load-bearing choice — a self-contained artifact is the only one
that survives unattended operation by a user who has never heard of baime.

**Vendoring completeness caveat (must verify, do not assume).** The one file is
not unconditionally self-contained: `agents/iteration-executor.md`'s own body
references `read(meta-agents/*.md)` (line 12) and `read(agents/{agent}.md)`
(line 80) — i.e. it expects a surrounding meta-agent/agent capability directory.
In exp5's *actual* usage the milestone **charter (Tier-A) + `inherited-core.md`
(Tier-B)** supply that methodology context instead of baime's own `meta-agents/`
tree, and iteration-executor is "fed the charter only" — which is *why* the
single-file dispatch appears to work here. But whether the vendored agent
degrades gracefully when those `meta-agents/*.md` paths are absent has **not
been verified in isolation**. Before committing to vendoring, run the vendored
agent against a charter with no baime `meta-agents/` directory present and
confirm it resolves entirely from charter + inherited-core. If it does not,
vendoring must also carry the small set of meta-agent capability files it
actually reads — still a bounded, self-contained set, just larger than one file.

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
  charter contract, Done-when discipline, the 4 it0 checks, the value-typed
  SELECT ledger, the V_meta gate, φ consolidation, and the async human control
  surface. This is a genuine general-purpose "perpetual self-improving dev loop."
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
  pinned fallback of) `iteration-executor`. Universality lives here. Natural
  upstream home: baime itself.
- **(b) quay instantiation (in-repo)** — Layer B: VT definition + weights, seed
  backlog, the (consolidated — see §8.1) methodology skill, the pinned gate
  source. Ships with the quay repo.
- **(c) `/perpetual-init` bootstrap wizard** — the interactive instantiation
  path that makes (a) usable on a non-quay project.

**Phased path (each phase independently useful):**
1. Formalize the A/B/C split inside the quay repo (§8.2) — pure refactor, no new
   capability, unblocks everything else.
2. Pay down the consolidation debt (§8.1) so Layer B is a single self-contained
   skill, not a 3-citation chain.
3. Extract Layer A as `baime-perpetual` with a vendored `iteration-executor`
   (verify the completeness caveat in §4 first).
4. Add `/perpetual-init`. Only after this is the loop deliverable to a stranger.

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
