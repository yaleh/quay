# Quay Web UI — Third-Generation Bootstrap Experiment (proposal)

- **Status:** Proposal — not adopted. This document defines a **new,
  separate experiment**; it is not a protocol amendment to
  `quay-bootstrap-experiment.md` or `quay-core-bootstrap-experiment-v2.md`,
  and not a directive. None of §7's preconditions are satisfied yet —
  in particular, precondition 1 (quay-core-bootstrap reaching a stable
  point) is explicitly not expected soon; this document exists so the
  design is ready when that precondition is met, not to authorize
  starting now.
- **Date:** 2026-07-16
- **Owner:** Yale Huang
- **Relates:** [`quay-core-bootstrap-experiment-v2.md`](./quay-core-bootstrap-experiment-v2.md)
  (experiment 2's protocol — this document inherits its layout and
  methodology conventions rather than redefining them),
  [`quay-bootstrap-experiment.md`](./quay-bootstrap-experiment.md)
  (experiment 1's protocol), [`quay-proposal.md`](./quay-proposal.md),
  [`quay-native-design.md`](./quay-native-design.md),
  [`glossary.md`](./glossary.md)
- **Origin:** captured from a live conversation (2026-07-16) that began by
  asking whether `quay-core-bootstrap`'s instance objective should be
  expanded to include making the Web UI "actually usable." The
  conversation concluded that objective 2's own G5 guardrail (confirm
  existing behavior; do not improve appearance/interactivity) correctly
  excludes that work from experiment 2, and that a UI-usability effort —
  scoped to read-only browsing plus per-task action-button triggering,
  explicitly **not** task creation/editing — is better run as its own
  experiment, both because it is a genuinely different domain (frontend/
  visual/UX work, not backend task-graph or Core-API-symmetry work) and
  because it should build on top of experiment 2's own verification work
  as a regression baseline rather than race ahead of it.

> Frozen vocabulary applies (see `glossary.md`). BAIME terms (`V_instance`,
> `V_meta`, OCA, `A_n`, `M_n`, `O`) are used verbatim per the
> `methodology-bootstrapping` skill.

---

## 1. Summary

Experiment 1 (`quay-bootstrap-experiment.md`) bootstrapped **quay-native**
via BAIME's self-hosting identity (`M(Q) = Q`), halted at iteration 88,
not converged, methodology extracted into
`.claude/skills/quay-native-methodology/`. Experiment 2
(`quay-core-bootstrap-experiment-v2.md`) tests whether that methodology
**transfers** to Core-layer development (CLI/MCP/Web-UI symmetry, browser-
driven verification of existing Web UI behavior, action-delivery test
infrastructure) — still fundamentally backend/API-shaped work, even
though one of its four objectives touches the Web UI.

This document proposes **experiment 3**: developing `packages/quay`'s
Web UI itself — read-only task browsing plus per-task action-button
triggering — into something with genuine functional and visual/design
quality, using the same self-hosting methodology. The domain here is
qualitatively different from experiments 1 and 2: frontend/visual/UX
work, where "done" is inherently softer than backend logic correctness,
and where experiment 2's own G5-bounded verification-only approach
(confirm current behavior, never improve it) does not apply — improving
the UI's appearance and read-side functionality **is** this experiment's
point, within a scope that stays strictly read-only plus existing
action-button triggering.

## 2. Relationship to experiments 1 and 2 (the inheritance boundary)

Experiment 3 inherits methodology from both prior experiments the same
way experiment 2 inherited from experiment 1 (extraction artifact,
Skill files, gate mechanics, directive lifecycle, G3 audit discipline) —
not σ, not V_instance, and (per §5 below) V_meta only as a continuing
baseline, not reset to zero.

Distinct from experiment 2's inheritance, experiment 3 also has a
**functional dependency**, not just a methodological one: it builds new
UI capability and visual polish on top of the same three routes
(`GET /`, `GET /task/:id`, `POST /task/:id/action/:actionId`) that
experiment 2's `web_ui_verification` objective is verifying. That
verification work is experiment 3's regression safety net — starting
before it converges would mean adding untested-baseline changes on top
of an unverified surface. This is why §7 precondition 1 gates the start
of experiment 3 on that specific piece of experiment 2's work, not on
experiment 2 halting entirely (experiment 2's other three objectives —
Core CLI/MCP/Web-UI symmetry, action-delivery mode, quay-native backlog
health — may still be in progress when experiment 3 starts).

## 3. Scope boundary: why the Web UI stays read-only

`quay-proposal.md`'s stated non-goals for the Web UI still apply
unchanged: "Core stays dumb" (no backend-specific rendering logic, no
`if backend === 'github'`, never hardcoded per-backend components) and
"the valuable, differentiating part of Quay is not board rendering... it
is the agentic layer." Experiment 3 does **not** reverse either of
these. What it does reverse is `serve.js`'s own stated v0 boundary —
"crude but real... no framework, no styling beyond what's needed to
prove the loop" — but only for the presentation layer and read-side
functional affordances (filtering, sorting, navigation), never for the
write surface.

**In scope:** visual/design quality of the three existing routes;
read-side functional capability (filtering, sorting, navigation,
pagination if warranted); consistent styling applied across all pages.

**Out of scope, explicitly:** task creation from the browser, field
editing from the browser, any new write path beyond the existing
action-button trigger. Any backend-specific conditional rendering
remains excluded per the unchanged "Core stays dumb" principle.

---

## 4. Instance objective

Four factors, multiplied (`V_instance = ui_read_capability ×
visual_design_quality × verified_by_construction × backlog_health`),
mirroring the checkable, "Done when"-qualified style of
`quay-core-bootstrap-experiment-v2.md` §4. The product formula itself
structurally enforces **parallel progress** between the functional
(`ui_read_capability`) and visual (`visual_design_quality`) dimensions,
per the human's explicit requirement: neither factor can sit at 0 while
the other races ahead without collapsing V_instance to 0. This is
reinforced by an explicit stall-guard rule (§4.5).

### 4.1 `ui_read_capability`

A fixed, bounded capability list (not open-ended — additions require an
explicit protocol amendment to this document, the same discipline
experiments 1/2 apply to their own instance objectives):

- Task list page: filter by `status` and by `label`; sort by `id` and by
  `status`; pagination if the task count in a test fixture exceeds a
  single-page-reasonable count (threshold to be set by the first
  iteration that measures it, recorded explicitly, not assumed).
- Task detail page: clear rendering of all frontmatter fields (`status`,
  `labels`, `parent`, `children`, derived `role`), rendered markdown body
  (not a raw-text dump), and back-navigation to the list.
- Action buttons: existing trigger behavior (per-`whenStatus` visibility,
  POST-then-redirect) preserved exactly as experiment 2 verifies it;
  this factor does not modify that behavior, only the capability
  surrounding it.
- No new write surface beyond the existing action-button trigger
  (explicit exclusion, checked every iteration).

**Done when:** every bullet above is implemented, and confirmed via
`verified_by_construction` (§4.3) — not merely coded, but covered by a
browser-automation test.

### 4.2 `visual_design_quality`

Deliberately **not** scored by subjective judgment alone. Two
requirements, both mandatory:

1. **Mechanical threshold:** every reachable page scores **Lighthouse
   accessibility ≥ 90 and best-practices ≥ 90** (via the `chrome-devtools`
   MCP `lighthouse_audit` tool), and uses a consistent, applied styling
   system across all pages (no page left as an unstyled raw HTML dump).
2. **Independent holistic visual review (mandatory, every visual-quality
   claim):** a fresh-context agent — not the same session/context that
   made the change — reviews the whole page/flow holistically via a real
   browser session (screenshot-driven), rendering a **PASS / CONCERNS /
   FAIL verdict with reasoning**, the same discipline as experiment 1/2's
   G3 out-of-band audit but scoped to visual coherence rather than
   functional correctness. This explicitly must not degrade into a
   checklist of isolated details (font size here, color there) — the
   reviewing agent's brief is to judge the page/flow **as a whole**,
   the way a human would look at a finished screen and judge whether it
   coheres, before commenting on specifics. A CONCERNS or FAIL verdict
   blocks crediting movement on this factor for that page/flow until
   addressed.

**Done when:** every reachable page/flow passes both the mechanical
threshold and the holistic independent review, for the current state of
that page (a later change that regresses either check re-opens the gap
for that page, the same way experiment 2 treats `native_backlog_health`
regressions).

### 4.3 `verified_by_construction`

Every capability or visual change landed in a given iteration must ship
with a browser-automation test confirming it **in that same iteration**
— extending experiment 2's `web_ui_verification` discipline as a
continuous process requirement rather than a one-time terminal target.

**Done when:** at the end of every iteration, 100% of capabilities/
visual changes delivered so far (not just this iteration's) have a
corresponding committed browser-automation test. A gap here at any
iteration boundary is a factor regression, checked the same way
`backlog_health` regressions are checked.

### 4.4 `backlog_health`

Neither quay-native's 8 V-factors (experiment 1's final snapshot) nor
quay-core-bootstrap's own V-factors (at whatever state they hold when
experiment 3 starts, per §7 precondition 1) may regress while experiment
3's work proceeds.

**Done when:** every iteration report reconfirms no regression against
both inherited snapshots.

### 4.5 Parallel-advancement stall guard

If either `ui_read_capability` or `visual_design_quality` shows no
movement for 3 or more consecutive iterations while the other factor
advances, that iteration's report must explicitly state why — an
unexplained one-sided run is treated as a violation of the human's
parallel-advancement requirement, not merely noted and passed over
(mirroring how experiment 1 treats an unexplained repeated `V_meta`
stall reason as a finding requiring escalation, not routine).

---

## 5. Meta objective

Experiments 1 and 2 tested self-hosting and its transfer to Core/API-
shaped backend work. Experiment 3 tests a genuinely different question:
**does the same methodology (Skill files, directive lifecycle,
provenance/gate mechanics, G3-style audit discipline) transfer to
frontend/visual/UX-shaped work, where completion criteria are inherently
softer than backend logic correctness — and if the methodology needs
adaptation to handle that softness (e.g., the independent holistic
visual-review mechanism in §4.2, which has no precedent in experiments 1
or 2), what concretely had to change?**

As with experiment 2's own meta objective, `V_meta`'s formula
(`completeness × effectiveness × reusability × validation`) is inherited
in *shape*, and its **baseline is not reset to a naive seed-stage
value** — it starts from whatever value quay-core-bootstrap holds at its
own stopping point (§7 precondition 1), the same "inherit methodology,
not a fresh-zero baseline" reasoning experiment 2 applied to experiment
1's final value.

One hypothesis worth recording (not a guaranteed outcome): experiment
1's four `V_meta` factors have been flat since iteration 66 (22+
consecutive iterations at exactly the same values, per
`quay-core-bootstrap-experiment-v2.md`'s Origin note), with every
documented stall reason pointing to "no organically different scenario
has arisen." A domain as different as frontend/visual/UX work is a
plausible candidate to organically re-trigger one or more of those
stalled factors — but this must be *observed*, not assumed; an iteration
that asserts re-triggering without evidence should be treated as a
scoring error, the same discipline `quay-bootstrap-experiment.md`
already applies to unjustified `V_meta` movement claims.

---

## 6. Provenance and σ

σ resets to a fresh count scoped to experiment 3's own task population,
using a distinct ID prefix — **`QW-*`** (quay-Web) — separate from
experiment 1's `QN-*` and experiment 2's `QC-*`, so all three
populations stay physically distinguishable in `tasks/`.
`experiments/quay-webui-bootstrap/provenance.md` (once the directory
exists — see §7 precondition 4) must carry an explicit inheritance
record pointing to:

- Experiment 1's final provenance state and closing report
  (`experiments/quay-native-bootstrap/provenance.md`,
  `CLOSING-REPORT.md`).
- Experiment 2's provenance state **at the point experiment 3 starts**
  (not necessarily experiment 2's own final/stopped state, since
  experiment 2 may still be running on its other three objectives —
  see §2) and any extraction artifact produced from it, if one is run
  per §7 precondition 2.

---

## 7. Preconditions to start (none satisfied yet)

Unlike `quay-core-bootstrap-experiment-v2.md` (written after its
preconditions were already met), this document is written **before**
any of the following are satisfied, so the design is ready when they
are:

1. **quay-core-bootstrap's `web_ui_verification` objective (its own §4
   item 2) reaches 1.0** (every currently-reachable Web UI page/flow has
   committed browser-automation coverage) **and** quay-core-bootstrap
   shows a diminishing-returns signal (ΔV < 0.02 for 2+ consecutive
   iterations) on its own dual-layer value functions. **Not satisfied.**
   This is the human-specified "relatively stable" bar (option (i) from
   the discussion preceding this document) — experiment 3 must not start
   while experiment 2's own Web UI verification work and overall
   trajectory are still moving significantly.
2. **An extraction pass** against quay-core-bootstrap's state at the
   point precondition 1 is met, analogous to how experiment 2 required
   an extraction from experiment 1 before starting (§2 of
   `quay-core-bootstrap-experiment-v2.md`). **Not satisfied** —
   experiment 2 is still running.
3. **Instance objective converted into a concrete, checkable statement.**
   **Satisfied by this document — see §4.**
4. **Experiment layout decided and physically created**: a new
   `experiments/quay-webui-bootstrap/` directory (`ITERATION-PROMPTS.md`,
   `README.md`, `provenance.md`, `directives/{pending,archive}/`,
   `audits/`, `iterations/`), mirroring `experiments/quay-core-bootstrap/`'s
   structure. **Not satisfied** — deliberately not created yet, the same
   way the `experiments/` migration itself was deferred until experiment
   1's stop was confirmed, to avoid dangling scaffolding for an
   experiment that isn't starting yet.
5. **An explicit, separate human decision to actually begin iteration
   0.** Satisfying preconditions 1-4 authorizes the start; it is not
   itself the start, the same distinction
   `quay-core-bootstrap-experiment-v2.md`'s own status line draws.
