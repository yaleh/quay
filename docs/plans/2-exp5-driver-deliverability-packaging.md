# Plan: Package the exp5 perpetual-stream driver as a deliverable (A/B/C split → consolidation → engine extraction+vendoring → init wizard)

- **Source proposal:** `docs/proposals/exp5-driver-deliverability-packaging.md`
  (architect-reviewed 2026-07-18, carrying the ⚠ MAJOR ISSUE caveat in §4).
  This plan implements the proposal's §9 recommended phased path and clears the
  §8 delivery-readiness blockers, in the mandatory dependency order the proposal
  specifies.

- **⚠ THIS IS A PLAN, NOT AN AUTHORIZATION TO EXECUTE.** Per the governing
  convention this stream uses (proposal §Status, §10), a proposal — and now this
  plan — is a *written record*, not a green light. exp5
  (`experiments/quay-perpetual-stream/`) is a RUNNING perpetual loop; nothing in
  this document may be executed against it directly. **Adopting any phase below
  must enter through `/quay-directive` at a milestone boundary** (consumed at the
  next boundary per OUTER-LOOP §4.7, never mid-milestone), scoped as one phase at
  a time — never as one big bang (proposal §10). This plan exists so that when a
  directive *is* filed, the work is already decomposed into small, reviewable,
  dependency-ordered stages.

- **Nature of this deliverable — read before applying any "coverage" target.**
  This is overwhelmingly Markdown scaffolding (driver prompts, charter/dashboard/
  backlog templates, methodology core), plugin/skill/command definitions, and a
  small amount of shell + one `.mjs` script. It is **not** a typical code library.
  Therefore the verification strategy (see "Test / verification strategy" below)
  is split: a literal "TDD, ≥80% line coverage" target applies **only** to the
  shell scripts (the `it0-*.sh` checks and the new `/perpetual-init` wizard logic)
  and any new JS; for all Markdown/skill/template/plugin-manifest assets,
  verification is defined as **mechanical checks** (existing
  `experiments/quay-perpetual-stream/scripts/it0-*.sh` gate-hash / dir-projection
  runs, a scaffold-lints-clean check, and the Phase-3 isolation test), not a
  coverage number. This scoping is stated explicitly rather than pretending 80%
  code coverage applies to prose.

- **Current live state (as of this plan's writing, 2026-07-18):** exp5 is RUNNING
  at `milestone_counter: 8`, m9 = M-GH-WRITE in flight (per proposal §Context).
  The harness lives in one physically-intermixed directory
  `experiments/quay-perpetual-stream/` (verified: `OUTER-LOOP.md`,
  `inherited-core.md`, `dashboard.md`, `backlog.md`, `v-meta-ledger.md`,
  `charters/`, `milestones/`, `checkpoints/`, `directives/`, `scripts/`). The
  four script files confirmed present in `scripts/` are `it0-ceiling-check.sh`,
  `it0-gate-hash-check.sh`, `it0-dogfood-evidence-gate.sh`, and
  `it0-dir-projection-check.{sh,mjs}`. Three pending directives (DIR-006/007/008)
  already target the same consolidation debt Phase 2 pays down. **Any physical
  reorganization of this directory races the live run and must be sequenced at a
  milestone boundary, not mid-milestone.**

---

## Phase overview and mandatory ordering

| Phase | Title | Clears | Nature | Depends on |
|---|---|---|---|---|
| 1 | Formalize the A/B/C layer split (in-repo) | §8.2 | pure refactor / file reorg, no new capability | — |
| 2 | Pay down the consolidation debt (Layer B → single core) | §8.1 (also DIR-006/007/008) | doc consolidation | Phase 1 |
| 3 | Vendoring isolation test (HARD GATE) + extract `baime-perpetual` engine | §4 ⚠, §8.3 | test + plugin extraction + vendoring | Phase 2 |
| 4 | `/perpetual-init` bootstrap wizard | §8.4, §6 | new skill + shell wizard logic | Phase 3 |

**The ordering `1 → 2 → 3 → 4` is mandatory**, not a preference (proposal §9,
§10): the layer split (1) is prerequisite step zero for extracting anything;
consolidation (2) must happen so Layer B is a single self-contained core before
it is packaged/referenced by the engine; the isolation test (3) is a hard entry
gate that determines *what set of files* the engine vendors, so the engine
cannot be scoped correctly before it passes; and the init wizard (4) instantiates
the engine that Phase 3 produces. **Do not start a phase before its predecessor's
Phase-level acceptance criteria are met.** Intra-phase parallelism is called out
per phase.

**Size budget:** each Stage ≤ ~200 lines of change; each Phase ≤ ~500 lines.
"Lines" here counts files-touched + approximate added/changed lines across
Markdown, scripts, and manifests, since most of the work is documents/scaffold.

---

## Phase 1 — Formalize the A/B/C layer split inside the quay repo

**Goal (proposal §1, §8.2):** physically separate the three layers that are
currently intermixed in `experiments/quay-perpetual-stream/`:
- **A. Generic engine** — `OUTER-LOOP.md`, `scripts/it0-*`, the charter three-tier
  contract, Done-when discipline, inner-termination conditions, the value-typed
  SELECT ledger, the V_meta consolidation-lag gate, φ consolidation, the human
  async control surface. Domain-independent.
- **B. quay instance config** — the VT 5-surface origin
  `{CLI 25 / MCP 20 / Web UI 20 / Packaging 20 / Docs 15}` + weights, seed
  `backlog.md`, the 3 `quay-*` methodology skills cited by `inherited-core.md`,
  the pinned HARD-GATES source
  (`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`), the quay-MCP
  dogfooding reconcile path. quay-specific.
- **C. Runtime state** — the filled-in `dashboard.md`, `milestones/`,
  `checkpoints/`, `directives/archive/`, `v-meta-ledger.md` values. This run's
  ledger; never shipped.

**This phase is a pure refactor: no engine behavior changes.** It is a
*classification + annotation + extract-by-copy* exercise, not a rewrite.
**Decision (resolves the proposal §8.2 "physically separated" vs. live-loop
tension — proposal §9.1): annotate/extract-by-copy first, defer physical moves of
live state.** Because exp5 is a RUNNING loop (this plan was written at
`counter: 8`), Phase 1 does **not** physically relocate the live A/B/C files. It
expresses the split as (i) an explicit **layer manifest** (`LAYERS.md`) that
labels every existing file A/B/C in place, and (ii) blanked engine templates
extracted **by copy** into `templates/engine/`. The live loop therefore runs
identically afterward — its read paths are untouched. Physical relocation, if ever
wanted, is a later boundary-scheduled move, explicitly **out of Phase 1 scope**.
This phase unblocks everything else (proposal §9.1).

**Dependencies:** none (entry phase). Stages 1.1 → 1.2 → 1.3 are sequential
(each consumes the classification from the prior); Stage 1.4 depends on 1.1–1.3.

### Stage 1.1 — Author the A/B/C layer manifest (classification, no moves yet)
- **Files:** new `experiments/quay-perpetual-stream/LAYERS.md` (~120 lines).
- **Work:** enumerate every file/dir currently in
  `experiments/quay-perpetual-stream/` and assign it exactly one of A / B / C,
  citing proposal §1's table as the authority. Explicitly record the two
  proposal subtleties: (a) `it0-dir-projection-check.{sh,mjs}` is the **non-it0**
  drain-time reconcile, distinct from the 3 real it0 checks
  (`it0-ceiling-check.sh`, `it0-gate-hash-check.sh`,
  `it0-dogfood-evidence-gate.sh`) plus the domain-misfit check which is a
  *procedure in `inherited-core.md`*, not a script; (b) `Provider-ABI` is a
  later chart-transition surface (m3/M-ABI-EVAL), **not** part of the chart-0
  origin decomposition. **Record the settled move-vs-annotate decision** (fixed in
  the Phase 1 preamble, per proposal §9.1): Phase 1 **annotates in place +
  extracts templates by copy; it does not physically move live files** — the live
  run at counter 8 is the deciding constraint. This manifest is the annotation
  layer; no `git mv` of a live A/B/C file happens in this phase.
- **Acceptance:** every top-level entry under `experiments/quay-perpetual-stream/`
  appears exactly once in `LAYERS.md` with an A/B/C label and a one-line
  justification; the two subtleties above are stated verbatim; the settled
  annotate-first / no-physical-move decision is recorded (not re-litigated).
  `grep`-checkable: no file listed twice, no unlabeled file.

### Stage 1.2 — Extract the Layer-A engine template set (blanked)
- **Files:** new `experiments/quay-perpetual-stream/templates/engine/` containing
  `UNINITIALIZED` templates derived from the live A-layer files — at minimum
  `OUTER-LOOP.template.md`, `dashboard.template.md` (state `UNINITIALIZED`,
  counter/chart unset), `charter.template.md` (the three-tier contract skeleton).
  Scripts are referenced by path, not copied yet (copying is Phase 3). (~150 lines.)
- **Work:** strip all quay-specific and runtime content from the A-layer files to
  produce reusable templates; leave placeholders where Layer-B config plugs in.
- **Acceptance:** each template contains **no** quay VT surfaces, no run counters,
  no milestone history (`grep -iE 'CLI 25|MCP 20|counter: [1-9]|M0[0-9]-'` returns
  nothing in `templates/engine/`); `dashboard.template.md` reads `UNINITIALIZED`.

### Stage 1.3 — Isolate the Layer-B quay instance config as a named set
- **Files:** new `experiments/quay-perpetual-stream/instance-quay/README.md`
  (~100 lines) that names, in one place, the Layer-B artifacts: the VT origin +
  weights, the seed `backlog.md`, the 3 `quay-*` skills (by
  `.claude/skills/` path), and the pinned gate source
  (`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`). No content is
  duplicated — this is an index/manifest that points at the canonical files.
- **Acceptance:** every Layer-B item from `LAYERS.md` is referenced by exact path;
  each referenced path exists (`test -e` each). No Layer-A or Layer-C item leaks
  into this set.

### Stage 1.4 — Confirm Layer C stays un-templated + wire the split into README
- **Files:** edit `experiments/quay-perpetual-stream/README.md` (~30 lines added:
  a "Layer split (A/B/C)" section pointing at `LAYERS.md`, `templates/engine/`,
  and `instance-quay/README.md`).
- **Work:** state explicitly that Layer C (`dashboard.md` values, `milestones/`,
  `checkpoints/`, `v-meta-ledger.md`, `directives/archive/`) is **never** part of
  any template or deliverable set; a new instance starts from `UNINITIALIZED`.
- **Acceptance:** README links resolve; the "never ship Layer C" statement is
  present and enumerates the C artifacts from `LAYERS.md`.

**Phase 1 acceptance (all must hold):**
1. `LAYERS.md` classifies every file exactly once (A/B/C), no gaps, no dupes.
2. `templates/engine/` contains blanked (`UNINITIALIZED`) A-layer templates with
   zero quay-specific or runtime content.
3. `instance-quay/README.md` indexes every Layer-B artifact by existing path.
4. Layer C is documented as non-shippable and un-templated.
5. **The live loop still runs identically** — per the annotate-first decision no
   live A/B/C file is physically moved, so `OUTER-LOOP.md`'s read paths are
   untouched and the existing `scripts/it0-*.sh` still execute clean from their
   current location. (Only additive new files — `LAYERS.md`, `templates/engine/`,
   `instance-quay/README.md` — are introduced.)
6. Total change ≤ ~500 lines, spread across the 4 stages above.

---

## Phase 2 — Pay down the consolidation debt (Layer B = one self-contained core)

**Goal (proposal §8.1, §7):** `inherited-core.md` (Tier-B) is today a *delta chain
of citations* to 3 separate `quay-*` skills that "must be read in order; citations
can drift" — the disclosed Known weakness that DIR-006 / DIR-007 / DIR-008 already
target. A deliverable cannot ask a user to install 3 quay-specific skills and read
them in a required order. **Collapse the 3-citation delta chain into a single
consolidated methodology core**, so Layer B is one self-contained skill rather than
an ordered chain.

**Dependencies:** requires Phase 1 complete (needs the Layer-B set named in
`instance-quay/README.md` and the A/B boundary fixed, so consolidation touches
only B and does not smear into A). This phase is **also** the substance of the
three pending directives — it should be filed as the directive that consumes /
supersedes DIR-006/007/008, not in addition to them. Stages 2.1 → 2.2 sequential;
2.3 depends on 2.2.

### Stage 2.1 — Inventory the 3-citation delta chain + citation-drift audit
- **Files:** new `experiments/quay-perpetual-stream/instance-quay/consolidation-audit.md`
  (~120 lines).
- **Work:** enumerate every citation in `inherited-core.md` into the 3 `quay-*`
  skills (`quay-native-methodology`, `quay-core-bootstrap-methodology`,
  `quay-webui-bootstrap-methodology` under `.claude/skills/`), record which are
  additive deltas vs. overrides vs. stale/drifted references, and map each to the
  DIR-006/007/008 concern it corresponds to (webui browser-verification
  regression, G3 adversarial-audit role, σ inherited-floor + citation drift).
- **Acceptance:** every `inherited-core.md` citation into a `quay-*` skill is
  listed with a delta/override/stale classification; each of DIR-006/007/008 is
  mapped to at least one audited citation; drifted citations are flagged.

### Stage 2.2 — Author the single consolidated Tier-B core
- **Files:** new `experiments/quay-perpetual-stream/inherited-core-consolidated.md`
  (target ≤ ~200 lines of *net new* consolidated prose; it may be longer as a
  whole file, but the reviewable delta is the consolidation itself). Inline the
  load-bearing methodology from the 3 skills so it reads standalone — no required
  reading order, no cross-skill citation chain.
- **Work:** fold the audited deltas from Stage 2.1 into one document; resolve the
  drifted citations by inlining the current correct content; preserve the
  domain-misfit **procedure** (proposal §1: it lives in the core, not a script).
  **Also normalize the "4 it0 checks" phrasing here (resolved-ambiguity item 5):**
  the consolidated core states, once and unambiguously, that the four it0 checks
  are ceiling + gate-hash + dogfood-evidence + the domain-misfit *procedure* (3
  scripts + 1 procedure), and that dir-projection is a *separate* non-it0 drain
  script — so the shipped deliverable never inherits the §7-vs-scripts ambiguity.
- **Acceptance:** the consolidated core contains **no** "must read X then Y then Z"
  ordering dependency and **no** unresolved citation into a `quay-*` skill for
  load-bearing content (`grep` for skill-name references returns only
  provenance/attribution notes, not "go read this to understand the method");
  the domain-misfit procedure is present; the "4 it0 checks (3 scripts + 1
  procedure) + 1 non-it0 dir-projection script" framing appears exactly once and
  matches proposal §1/§7.

### Stage 2.3 — Reconcile the consolidated core with the live loop + retire the chain
- **Files:** edit `experiments/quay-perpetual-stream/OUTER-LOOP.md` (the Tier-B
  reference), edit `inherited-core.md` to point at the consolidated core (or mark
  it superseded), update `instance-quay/README.md`. Update the DIR-006/007/008
  disposition in `directives/`. (~80 lines total.)
- **Work:** switch the loop's Tier-B supply from the citation chain to the single
  consolidated core; record DIR-006/007/008 as resolved-by-consolidation.
- **Acceptance:** `OUTER-LOOP.md`'s inner-dispatch feeds the consolidated core;
  the 3 pending directives have an explicit disposition referencing this stage;
  `scripts/it0-gate-hash-check.sh` still passes (the gate source pin is unchanged
  — consolidation must not silently move the pinned HARD-GATES source).

**Phase 2 acceptance (all must hold):**
1. Layer B's methodology is delivered by **one** consolidated core document that
   reads standalone (no required inter-skill reading order, no load-bearing
   citation into `quay-*` skills).
2. The consolidation-audit maps each folded delta to its source and to
   DIR-006/007/008; drifted citations are resolved.
3. The domain-misfit procedure survives consolidation.
4. The live loop consumes the consolidated core; existing `it0-*.sh` checks
   (esp. `it0-gate-hash-check.sh`) still pass unchanged.
5. Total change ≤ ~500 lines.

---

## Phase 3 — Vendoring isolation test (HARD GATE) + extract the `baime-perpetual` engine

**Goal (proposal §4 ⚠, §9.3):** extract Layer A as a `baime-perpetual` engine
plugin with a **vendored** `iteration-executor`. But the proposal's §4 MAJOR ISSUE
is unresolved: the "vendor exactly one file" premise is *unverified and may be
false* — `agents/iteration-executor.md` reads a surrounding `meta-agents/` /
`agents/` capability tree in ≥3 places (proposal §4 cites lines 12, 80, 83), and
in the live run baime **is** installed, so those reads may be silently resolving
against baime's cache (`~/.claude/plugins/cache/baime/baime/1.4.0/…`) rather than
degrading to no-ops. **Whether the vendored set is one file or several is
therefore unknown until the isolation test runs.**

**Stage 3.1 is a HARD ENTRY GATE for the rest of Phase 3.** The extraction stages
(3.2+) MUST NOT begin until 3.1 has produced a definite result, because that result
determines the file set to vendor. Do not begin the extraction on the assumption
that it is one file — begin it on the test result (proposal §9.3 verbatim).

**Dependencies:** requires Phase 2 complete (the engine references the *consolidated*
Layer-B core, not the citation chain — so consolidation must be done first). Within
the phase: 3.1 gates 3.2/3.3/3.4. 3.2 (vendor set) and 3.3 (plugin scaffold) can
proceed in parallel **once 3.1 passes and the set is known**; 3.4 depends on both.

### Stage 3.1 — HARD GATE: no-baime-present isolation test
- **Files:** new `experiments/quay-perpetual-stream/scripts/it0-vendor-isolation-check.sh`
  (~120 lines, **shell — TDD applies here**, see verification strategy) plus a
  short results note `instance-quay/vendor-isolation-result.md`.
- **Concrete isolation mechanism (resolves joint-review flag 2 — the sandbox is
  now specified, not left open):** run the vendored `iteration-executor` in a
  **temporary throwaway `$HOME`** created per run (e.g. `SANDBOX=$(mktemp -d);
  HOME="$SANDBOX"`), so `~/.claude/plugins/cache/baime/…` resolves under the empty
  temp home and is **provably absent**, combined with a working tree that has **no
  project-scoped `meta-agents/`/`agents/` directory**. The script asserts absence
  before running (`test ! -e "$HOME/.claude/plugins/cache/baime"` and `test ! -d
  meta-agents && test ! -d agents`) and records the assertion output. This
  temp-`$HOME` approach is chosen over a full container because it is CI-able and
  reproducible with no image build; a container is the documented fallback **iff**
  a temp `$HOME` proves insufficient to hide the cache (e.g. an absolute cache path
  is hard-coded somewhere). This is the definite mechanism — not "a sandbox,
  somehow."
- **Work:** in that isolated temp-`$HOME` tree (no baime `meta-agents/`/`agents/`
  reachable, neither project-scoped nor under the plugin cache), run the vendored
  `iteration-executor` against a sample charter (Tier-A) with the consolidated
  Tier-B core (from Phase 2) supplied by reference, and observe whether it
  resolves **entirely** from charter + core. Specifically probe the three read
  sites from proposal §4:
  `meta_agent_context` (line 12, incl. its `verify(complete)`),
  `agent_protocol` (line 80), `meta_protocol` (line 83). Classify the outcome as
  **graceful no-op** (globs over an absent dir degrade silently → vendor set = 1
  file) vs. **hard-fail** (`verify(complete)` treats empty read as
  incomplete-context error → vendor set = 1 file + the transitively-read
  meta-agent/agent capability files, a bounded but larger set).
- **Acceptance (this is the gate):**
  - The test runs the executor in the **temp-`$HOME` isolation** specified above,
    with **provably no** baime meta-agents/agents directory reachable — verified by
    the script asserting absence (`test ! -e "$HOME/.claude/plugins/cache/baime"`
    under the temp home, plus `test ! -d meta-agents && test ! -d agents` in the
    tree) and recording the assertion output. A run that cannot demonstrate the
    absence assertion is not a valid test run.
  - The result is recorded as **PASS (single-file vendoring safe)** or **EXPAND
    (must also vendor the transitively-read capability files, enumerated
    explicitly)**.
  - If EXPAND, the exact additional file list is written into
    `vendor-isolation-result.md` before any extraction proceeds.
  - **Phase 3 stages 3.2+ are blocked until this stage records PASS or a
    fully-enumerated EXPAND set.** A "probably fine" result is not acceptable —
    the outcome must be one of the two concrete verdicts.

### Stage 3.2 — Assemble the vendored executor set (size = Stage 3.1 result)
- **Files:** new `plugins/baime-perpetual/agents/iteration-executor.md` (pinned
  copy) plus, **iff 3.1 returned EXPAND**, the enumerated `meta-agents/*.md` /
  `agents/*.md` capability files it transitively reads. Add a
  `VENDORED.md` recording the pinned baime version (`baime@baime` v1.4.0) and
  git SHA (`971befddd36ad5dc4b0bdc31f42f873d610240fe` per proposal §2) plus a
  documented refresh step. (~size depends on 3.1; if PASS, ~1 file + note; if
  EXPAND, the bounded enumerated set.)
- **Acceptance:** the vendored set matches exactly the Stage-3.1 verdict (no more,
  no fewer files); `VENDORED.md` pins version + SHA + refresh procedure; the
  vendored copy is byte-identical to the pinned source for each file (recorded
  hash).

### Stage 3.3 — Scaffold the `baime-perpetual` plugin (command + assets)
- **Files:** new `plugins/baime-perpetual/.claude-plugin/plugin.json` (manifest
  declaring the `/perpetual-loop` command + the vendored agent),
  `plugins/baime-perpetual/commands/perpetual-loop.md` (runs OUTER-LOOP as the
  **Level-0** orchestrator — proposal §3), and the bundled template assets copied
  from Phase 1's `templates/engine/` + the `it0-*.sh` scripts. (~180 lines of
  manifest + command + asset wiring; templates are moved/copied, not re-authored.)
- **Work:** package command + agent + script assets + templates together (only a
  plugin can carry all four — proposal §3). Encode the no-nesting constraint:
  `/perpetual-loop` is Level-0, dispatches `iteration-executor` as a Level-1 leaf
  that cannot itself spawn subagents (proposal §3, §4).
- **Acceptance:** the plugin manifest is valid JSON and declares exactly the
  `/perpetual-loop` command and the vendored agent; the bundled `it0-*.sh` run
  clean from inside the plugin tree (`it0-gate-hash-check.sh`,
  `it0-ceiling-check.sh`, `it0-dogfood-evidence-gate.sh`,
  `it0-dir-projection-check.{sh,mjs}`); the command doc states the Level-0/Level-1
  dispatch shape.

### Stage 3.4 — End-to-end self-contained dry run + upstream note
- **Files:** new `plugins/baime-perpetual/README.md` (~100 lines) documenting
  install (proposal §5), the vendoring rationale (§4 rec 2+3), and the upstream
  path to baime **explicitly marked as an out-of-scope FOLLOW-ON** (resolved-
  ambiguity item 3 / proposal §9 phase 5) — this deliverable ships self-contained
  and does not require the upstream contribution; plus a dry-run evidence note.
- **Work:** re-run the Stage-3.1 isolation scenario end-to-end against the
  *assembled plugin* (not just the bare agent) with no baime installed, driving
  one milestone from an `UNINITIALIZED` scaffold.
- **Acceptance:** the assembled plugin resolves a sample charter and advances one
  milestone with **no baime `meta-agents/`/`agents/` directory present**, verified
  by running it in a clean tree; the README documents install + refresh + upstream.

**Phase 3 acceptance (all must hold):**
1. **Stage 3.1 recorded a concrete PASS or fully-enumerated EXPAND verdict** and
   the vendored set exactly matches it.
2. `plugins/baime-perpetual/` is a self-contained plugin: command + vendored
   agent(s) + `it0-*.sh` scripts + `UNINITIALIZED` templates.
3. The end-to-end dry run (Stage 3.4) advances one milestone with **no baime
   present** in a clean tree.
4. `VENDORED.md` pins version + SHA + refresh step; vendored files are hash-recorded.
5. The Level-0/Level-1 no-nesting dispatch shape is documented in the command.
6. Total change ≤ ~500 lines (excluding the vendored agent body itself, which is
   a verbatim pinned copy, not authored change).

---

## Phase 4 — `/perpetual-init` bootstrap wizard

**Goal (proposal §6, §8.4, §9.4):** the engine from Phase 3 is only usable by
someone who already understands BAIME. New-domain instantiation is expert-only
tacit knowledge. Add an interactive `/perpetual-init` that turns the five
instantiation steps (proposal §6) into guided Q&A emitting an `UNINITIALIZED`
scaffold: (1) VT surface decomposition + weights, (2) seed backlog, (3) pinned
HARD-GATES source, (4) confirm an independent audit channel exists (else the
domain-misfit it0 check hard-blocks — by design), (5) provide/stub ≥1
inner-methodology skill.

**Dependencies:** requires Phase 3 complete (the wizard emits a scaffold *for the
`baime-perpetual` engine* — the engine must exist and its template set be fixed
first). Stages 4.1 → 4.2 → 4.3 sequential.

### Stage 4.1 — Wizard skill definition + Q&A script (the five steps)
- **Files:** new `plugins/baime-perpetual/skills/perpetual-init/SKILL.md` (~120
  lines) and a `perpetual-init.sh` helper (**shell — TDD applies**) that drives
  the Q&A and writes the scaffold. (~150 lines total.)
- **Work:** encode the five proposal-§6 steps as ordered prompts; step 4 (audit
  channel) is a **hard precondition** — if the user cannot name an independent
  verification channel, the wizard refuses to emit a RUNNING-capable scaffold and
  says so (mirrors the domain-misfit it0 hard-block by design).
- **Acceptance:** the skill enumerates all five steps in order; the audit-channel
  step is enforced as a hard gate in `perpetual-init.sh` (unit-tested: absent
  audit channel ⇒ non-zero exit / refusal); the wizard writes an `UNINITIALIZED`
  dashboard (not RUNNING).

### Stage 4.2 — Scaffold emission + `it0` compatibility
- **Files:** wizard output wiring so the emitted scaffold is exactly what the
  `baime-perpetual` engine expects (the Phase-1 `templates/engine/` shape). (~80
  lines.)
- **Acceptance:** a scaffold emitted by `perpetual-init.sh` on a sample non-quay
  project passes the engine's `it0-*.sh` checks
  (`it0-ceiling-check.sh`, `it0-gate-hash-check.sh`,
  `it0-dogfood-evidence-gate.sh`, `it0-dir-projection-check.{sh,mjs}`) from the
  UNINITIALIZED state; `dashboard.md` reads `UNINITIALIZED`, `counter: 0`,
  `chart: 0` unset until first run.

### Stage 4.3 — Stranger-usable end-to-end + docs
- **Files:** edit `plugins/baime-perpetual/README.md` (add the `/perpetual-init`
  quickstart), new `perpetual-init` example transcript. (~90 lines.)
- **Work:** demonstrate init-then-run on a **non-quay** sample repo with no baime
  installed (composes Phase 3's self-containment with the wizard).
- **Acceptance:** a fresh clone with only the `baime-perpetual` plugin installed
  can run `/perpetual-init`, answer the five questions, and get a scaffold that
  the engine then advances by one milestone — verified end-to-end in a clean tree
  with no baime present.

**Phase 4 acceptance (all must hold):**
1. `/perpetual-init` exists as a skill + shell wizard covering all five §6 steps.
2. The audit-channel step is a hard gate (unit-tested refusal path).
3. An emitted scaffold passes the engine's `it0-*.sh` checks and is `UNINITIALIZED`.
4. End-to-end: init → run one milestone works on a non-quay repo with no baime
   present.
5. Total change ≤ ~500 lines.

---

## Test / verification strategy (scope stated honestly)

This deliverable is mostly Markdown scaffolding + skill/plugin definitions +
shell/one-JS script. The verification target is therefore **split by asset type**,
not a single blanket coverage number:

- **Shell scripts + any new JS (code): TDD, ≥80% line coverage applies.** This
  covers the new `it0-vendor-isolation-check.sh` (Stage 3.1) and the
  `perpetual-init.sh` wizard logic (Stage 4.1/4.2), plus any change to the
  existing `it0-*.sh`. Each gets unit tests (notably: the audit-channel hard-gate
  refusal path, the isolation-assertion path, the scaffold-emission path). The
  existing `it0-dir-projection-check.mjs` is JS and any change to it is covered.

- **Markdown / skill / template / plugin-manifest assets (prose & config):
  verification = mechanical checks, NOT a coverage number.** Specifically:
  - The existing gate-hash / dir-projection scripts still pass:
    `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh`,
    `it0-ceiling-check.sh`, `it0-dogfood-evidence-gate.sh`,
    `it0-dir-projection-check.{sh,mjs}` — run after every phase that touches the
    harness, and from inside the plugin tree in Phase 3.
  - A **scaffold-lints-clean** check: emitted/blanked scaffolds contain no
    quay-specific content and no runtime counters (the `grep -iE` assertions in
    Stages 1.2 and 4.2); plugin manifests are valid JSON.
  - The **Phase-3 isolation test** (Stage 3.1) — the load-bearing empirical check
    that resolves the §4 MAJOR ISSUE and sizes the vendored set. This is a HARD
    GATE, not a coverage metric.
  - **Layer-manifest completeness** (Phase 1): `grep`-checkable that every file is
    classified exactly once.

- **What is NOT automatically testable (stated honestly):** whether a *different*
  Claude Code session actually follows the driver prompts / consolidated core as
  operating instructions is not unit-testable — it is verified the same way exp5
  itself is: by the milestone-boundary review of the next run's output once the
  work is adopted via `/quay-directive`. This plan does not pretend otherwise.

---

## Resolved planning ambiguities (decisions of record — no longer open questions)

The joint proposal↔plan review (2026-07-18) resolved the five points that were
originally flagged here. Each now has a concrete decision recorded in the document
noted; they are retained below as a decision log, **not** as open questions.

1. **Move vs. annotate in Phase 1 — RESOLVED: annotate-first, no physical move of
   live state.** Phase 1 classifies files in place via `LAYERS.md` and extracts
   blanked templates **by copy**; it does not `git mv` any live A/B/C file while
   the loop runs. Recorded in the Phase 1 preamble and Stage 1.1 here, and in
   proposal §9 (phase 1 decision). Physical relocation is explicitly out of Phase 1
   scope.

2. **Isolation-test environment — RESOLVED: temp-`$HOME` sandbox.** Stage 3.1 now
   specifies a per-run throwaway `$HOME` (`mktemp -d` → `HOME=$SANDBOX`) so the
   baime plugin cache resolves under an empty temp home and is provably absent,
   plus a tree with no project-scoped `meta-agents/`/`agents/`, asserted before the
   run. A container is the documented fallback only if temp-`$HOME` proves
   insufficient. This makes the test reproducible/CI-able rather than a one-off.

3. **Upstream-to-baime — RESOLVED: explicit FOLLOW-ON, out of this plan's scope.**
   This plan delivers vendoring (Phase 3) + the in-quay-repo `baime-perpetual`
   plugin only. Upstreaming Layer A into the baime repo (`/home/yale/work/baime`)
   is recorded as a separate follow-on (proposal §4 scope decision, §9 phase 5, and
   the Stage 3.4 README upstream note), filed as its own directive against baime —
   not a phase here.

4. **Plugin location — RESOLVED: `plugins/baime-perpetual/` inside the quay repo.**
   The quay repo has no `plugins/` dir today, so this work establishes the
   convention. The alternative (a standalone marketplace repo) is folded into the
   upstreaming follow-on (item 3), not this deliverable. Recorded in proposal §9(a)
   and used throughout Phases 3–4 here.

5. **"4 it0 checks" counting — RESOLVED: reconciled once, in the consolidated core
   (Stage 2.2), consistent with proposal §1/§7.** There are **four it0 checks** —
   ceiling, gate-hash, dogfood-evidence, and the domain-misfit *procedure* (3
   scripts + 1 procedure) — and a **separate fourth *script***, dir-projection,
   which is the non-it0 drain reconcile and is **not** one of the four it0 checks.
   Proposal §7 now cross-references §1's definition explicitly, so the two sections
   no longer read as contradictory. Stage 2.2's acceptance is the single place this
   phrasing is normalized in shipped prose (the consolidated core), so the
   ambiguity is not carried into the deliverable.
