# Charter M41-cryst-g1-observability — G1: light the dark convergence axes
# (L_D code:doc ratio, L_G archguard-backed, L_S mutation/property) per ADR-007, DIR-030 item 1/4

**Milestone id:** M41-cryst-g1-observability · **surface:** method-infra (new
`experiments/quay-perpetual-stream/scripts/*.mjs` + fixtures + `dashboard.md` recording — no
`packages/quay*` product files touched) · **type:** discovery (primary, lights previously-dark
axes) + instrument-correction (secondary, closes ADR-006/007's own gap)
**Source:** `DIR-030` (`tasks/DIR-030.md`, restart-steering directive, item 1 of 4 in its
observe-and-enforce ordering) → `exp5-M-CRYST-G1` (`tasks/exp5-M-CRYST-G1.md`).
**Charter authored:** m40→m41 boundary, 2026-07-20. Base commit: `master` HEAD `ba1edb8`.
**Note on directory naming:** stale, untracked/never-ABSORBed pre-restart draft directories exist
on disk at `milestones/M41-dir025-directive-task-full-projection/` (empty, untracked) and
`milestones/M42-gate-cli-arg-order/` (one tracked but never-ABSORBed iteration-0.md, commit
`3ae3455`, orphaned by the restart renumbering). Neither has a corresponding dashboard ABSORB
entry or `milestone_counter` bump — they are dead pre-restart scratch, not this pass's slot. This
milestone uses a disambiguated directory name, `M41-cryst-g1-observability`, to avoid any
collision/confusion; `milestone_counter` (currently 40) becomes 41 at this milestone's ABSORB,
consistent with the counter, regardless of the stale directory names on disk.

## SELECT reasoning
Pending directives at DRAIN (this pass): DIR-013 (todo, applied — stale reconcile item, not a
milestone-candidate), DIR-015/DIR-016/DIR-018/DIR-022/DIR-023/DIR-024/DIR-026 (todo, various
deferred/pending phases, none freshly actioned this pass), and **DIR-030** (todo, pending →
actioned this pass, disposition below). Milestone-candidate backlog: `exp5-M-CRYST-{D1,D2,D4,E2,E3,
INV,B4,B5,B6,C1,F1,G1}`, `exp5-M-DIR022-REMAINING-GATES`, 3 `M37-discover-post-qeng` gap items, 3
STALE backfill rows.

**Chosen: `exp5-M-CRYST-G1`** — DIR-030 explicitly re-ranks SELECT for the restart window: the
observe-and-enforce cluster {G1, E3, DIR022-REMAINING, INV} must land BEFORE D1 or any other
candidate, in that literal order, because (per DIR-030's Finding) the method layer is crystallized
but (1) convergence is not observable (L_D/L_G/L_S dark) and (2) ADRs are un-enforced — restarting
onto D1 (foundational, but neither observing nor enforcing) would show progress without showing
convergence. G1 is item 1 of 4 in that ordering and is the smallest/most self-contained of the four
(pure new metric scripts + fixtures, no touch to `adr-store.js`/gate registry the way E3 and
DIR022-REMAINING-GATES require) — chosen over E3/DIR022-REMAINING/INV for this pass on that
smaller-unit-first basis, consistent with DIR-030's own text ("makes convergence MEASURABLE" is
listed first). D2/D3/F1 remain excluded from autonomous SELECT (`label:human-steered` fence,
unaffected by DIR-030).

**Value-typed SELECT ledger entry:** value type = **discovery** (primary — measures a previously-
unmeasured axis) + **instrument-correction** (secondary — ADR-006/007 flagged L_D/L_G/L_S dark;
this closes that specific instrument gap). No VT chart-1 cell (method-infra, not a chart-0/1
surface) — Δv̂ is judged on the discovery/instrument-correction axis, not VT, per the ledger's own
"non-VT risk can outrank positive-VT" rule (here: zero-VT but the observe-and-enforce loop cannot
close without it, which DIR-030 treats as higher priority than any pending VT-scored candidate).

**Not-selected notes** written directly onto each considered candidate's own task body this pass
(SELECT step, per OUTER-LOOP.md step 1's per-task inspectability requirement):
`exp5-M-CRYST-E3`, `exp5-M-DIR022-REMAINING-GATES`, `exp5-M-CRYST-INV`, `exp5-M-CRYST-D1` — each
now carries a `## Not selected (M41)` section citing DIR-030's ordering.

**Class routing (5a):** methodology/design-class, per the `surface:method-infra` /
`scripts/*.mjs`-under-exp5 lineage precedent (M25/M32/M36/M38/M39-registry-only-portion/M40 — new
executable scripts living under `experiments/quay-perpetual-stream/scripts/` with fixtures, not
`packages/quay*` product code, have consistently run whole-milestone dual-iteration, NOT the
dev-class N-independent-proposal pipeline; M39 is the one exception because ITS scope directly
touched `packages/quay/src/gate/registry.js`). G1's scope is scripts + fixtures + dashboard.md, no
`packages/quay*` touch — methodology/design-class applies: **whole-milestone independent dual
iteration** (iteration-0 builds, iteration-1 independently re-derives from a fresh worktree).

**Tool-availability finding (recorded here, not swept under the charter):** `archguard_analyze`
was probed against this repo at charter-authoring time (`lang: typescript`, both with explicit
`sources: ["packages/quay/src", ...]` and with `sources` omitted / `noCache: true`) and every
variant returned `"Analysis failed: No query scopes were persisted."` — archguard currently cannot
produce a usable scope for quay's plain-JS/ESM packages (no `tsconfig.json`, no `.ts` files). This
is a **real, load-bearing constraint on the L_G proxy's specific mechanism** (archguard-backed
cycles/god-packages/dup-abstractions), not a milestone-scope problem to route around silently.
In-scope work below designs the L_G proxy to (a) attempt the archguard MCP call and use its output
when available, (b) if archguard genuinely cannot scope this repo, fall back to a documented
lower-fidelity proxy (e.g. a plain-JS import-graph cycle detector, or `madge`-style analysis) SO
THE PROXY STILL RUNS AND REPORTS SOMETHING REAL for L_G this milestone, AND (c) file the archguard
gap explicitly in this milestone's own report/ABSORB entry (per CLAUDE.md's instruction to
report/fix tool bugs rather than work around them silently) — the fallback is not a substitute for
reporting the upstream gap.

## Acceptance Criteria
Mirrors the task's own 3 Acceptance Criteria (`tasks/exp5-M-CRYST-G1.md`) exactly:
- [ ] `code:doc` (L_D) computes from real git deltas and FLAGs a synthetic prose-heavy milestone;
  recorded on dashboard at a real ABSORB (this one).
- [ ] L_G proxy surfaces a real dependency cycle / god-package / duplicated abstraction on the LIVE
  repo (not just a fixture) — via archguard if it can be made to scope this repo, else the
  documented fallback per the tool-availability finding above; either way the proxy must find and
  report something REAL on `packages/`, not merely execute against a fixture.
- [ ] L_S proxy reports behavior variance for a touched module; fixtures pin each metric.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware — task already checklist-form], 1 per-milestone acceptance audit [unconditional],
2 V_meta consolidation-lag, 3 line-budget, 4 impl-row — N/A [this milestone's own output IS the
mechanism, not a design doc awaiting a future `-IMPL`], 5 no-self-exemption, 6 escrow-Δv — N/A [not
design-only; ships real, tested scripts], 7 test-floor — N/A [`surface:method-infra`, no
`packages/quay*` product files touched; `dod-fixture-selfcheck.sh` + this milestone's own new
fixtures are the test evidence, mirroring M38/M40's own precedent for this surface], 8 task
canonical-lifecycle-record [task already carries `## Proposal`/`## Plan`, DIR-014 Clause 8], 9
split-or-commit [this candidate was NOT split — it is fully completable within one milestone, per
the sizing check below]). No task-specific exemption from any clause.

## Value hypothesis
- Value type(s): **discovery** (primary) + **instrument-correction** (secondary), per the
  value-typed SELECT ledger (see SELECT reasoning above).
- **Δv̂:** no VT chart cell expected (method-infra surface, mirrors the DoD-program lineage's own
  no-VT-cell precedent — M25/M32/M36/M38/M39/M40); value is instead measured directly by the
  metric `Y` below — re-confirm the realized reading at ABSORB rather than assume.
- Metric `Y`: the task's 3 Acceptance Criteria, verbatim (see task file) — specifically, whether
  each of L_D/L_G/L_S produces a REAL (non-fixture) reading against the live repo/milestone and is
  recorded on `dashboard.md`.

## Current-state notes (re-verified directly against source at charter-authoring time)
- `dashboard.md` currently has NO L_D/L_G/L_S row or section — grepped directly, zero hits for
  those tokens in a convergence-metric sense (confirmed at charter-authoring time).
- `archguard_summary`/`archguard_analyze` were probed live against this repo (see tool-availability
  finding above) — `archguard_analyze` currently fails to persist query scopes for quay's JS/ESM
  packages under every combination tried; this is a real constraint, not an assumption.
- `experiments/quay-perpetual-stream/scripts/` already has an established RED/GREEN fixture-pinned
  pattern (`fixtures/dod/`, `dod-fixture-selfcheck.sh`; also `vmeta-lag-check.mjs` +
  `vmeta-lag-selfcheck.sh`) — reuse that pattern's shape for the 3 new metric proxies' fixtures
  rather than inventing a new fixture convention.
- No existing script in `experiments/quay-perpetual-stream/scripts/` computes a code:doc ratio,
  mutation/property variance, or wraps archguard — this is genuinely new work, not a
  rename/refactor of something existing.

## In scope
1. **L_D proxy** — a `scripts/l-d-code-doc-ratio.mjs` (name indicative) that computes a
   code:doc line-delta ratio from a real `git diff <base>..<head> --stat`-style computation
   over a milestone's commit range, and FLAGs when the delta is overwhelmingly new prose (doc
   lines ≫ code lines) — with a fixture pair (RED: synthetic prose-heavy delta; GREEN: normal
   code-heavy delta).
2. **L_G proxy** — a script that attempts an archguard-backed cycle/god-package/dup-abstraction
   scan of `packages/`; if archguard cannot scope this repo (per the tool-availability finding),
   falls back to a documented lower-fidelity JS import-cycle proxy, but EITHER WAY runs against
   the LIVE repo and reports a real (not fixture-only) finding — plus a fixture pair pinning the
   proxy's own pass/flag logic.
3. **L_S proxy** — a script that runs a lightweight mutation/property-style variance probe against
   one real touched module (e.g. from this milestone's own diff, or a nominated representative
   module) and reports a variance/stability reading — with a fixture pair.
4. Record all three readings on `dashboard.md` at THIS ABSORB (a real per-milestone convergence
   row), demonstrating the "measurable, not asserted" bar.
5. File the archguard tool-availability gap explicitly in this milestone's report/ABSORB entry
   (not silently worked around) per CLAUDE.md's report/fix-fast guidance for owner-maintained tools.

## Explicitly OUT of scope
- Wiring these proxies as a `quay gate` (that is a FUTURE step per the task's own text — "single-
  source scripts wrappable by a future `quay gate`"); this milestone builds the metrics + dashboard
  recording only, not gate registration (that is `exp5-M-CRYST-E3`/`DIR022-REMAINING`'s territory).
- Fixing archguard's JS/ESM scoping gap itself (that is the owner's tool, reported not patched
  here) — this milestone works around it with a documented fallback if needed, not by modifying
  archguard.
- `exp5-M-CRYST-{E3,INV,D1}` and `exp5-M-DIR022-REMAINING-GATES` — deferred per DIR-030's ordering,
  not touched by this milestone.

## Done-when (binary clauses)
Mirrors the task's 3 Acceptance Criteria exactly (see task file) plus:
1. Three new proxy scripts exist under `experiments/quay-perpetual-stream/scripts/`, each with a
   RED/GREEN fixture pair, wired into a selfcheck script (or an extension of an existing one).
2. `dashboard.md` records a real L_D/L_G/L_S reading for THIS milestone, computed by the proxies
   (not hand-typed numbers).
3. The L_G proxy's archguard-vs-fallback decision + the tool-availability finding are stated
   explicitly in the iteration report (not silently a no-op if archguard fails).

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`
lines 100-131 for the full literal text; both dispatched iteration prompts must include it
verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged. The manda healthz gate and port-4173
reachability gate are N/A this milestone (no Web UI surface touched) — state N/A explicitly in
each iteration's report, do not silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-check.sh`: N/A — this milestone cites no `gap-list.md` gap/directive ID as
  in-scope (its source is a live task, `exp5-M-CRYST-G1`, and a live directive, `DIR-030`, both
  read directly, not a gap-list row).
- `it0-ceiling-line-budget-check.sh` against this charter: 5 in-scope items, method-infra scripts —
  small; well under the small-milestone norm, no phase/stage plan needed. Run before dispatch
  (below).
- `it0-impl-row-check.sh`: N/A — this milestone's own output is the real-landing proof itself
  (three runnable proxies + a real dashboard reading), not a design doc awaiting a future `-IMPL`.
- Domain-misfit audit-channel: an independent mechanism IS reachable — the adversarial audit can
  independently re-run each proxy script against the live repo/git history and check the dashboard
  reading matches the script's own stdout, exactly as prior method-infra milestones' audits have
  done (M38/M39/M40 precedent).

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Dispatch a fresh-context, out-of-band adversarial-audit subagent at ABSORB, refute-first stance
against this task's 3 AC clauses + DoD, mirroring M38/M39/M40's own audit discipline. The audit
should specifically probe: (a) do the 3 proxy scripts genuinely compute their reading from real
git/repo state (not hardcoded/faked numbers), (b) does the L_G proxy's archguard-or-fallback
decision actually run against `packages/` and find something real (re-run it independently), (c)
is the dashboard's recorded L_D/L_G/L_S reading the ACTUAL output of running these scripts right
now (re-run and diff), (d) do the fixture pairs genuinely distinguish RED from GREEN (re-run the
selfcheck independently). Per DIR-020/M34's standing write-back mechanism, the audit ticks `- [x]`
on each AC/DoD checklist item it confirms, with an inline evidence citation per item.

## Note for ABSORB
1. Remember the Clause 2 exact-phrase requirement: dashboard text must contain the literal
   substring "V_meta consolidation-lag" (or "V_meta consolidation lag").
2. Remember the `it0-dod-check.sh` invocation convention: task id (not milestone id) as the first
   argument — `exp5-M-CRYST-G1`.
3. Per M38/M39/M40's own precedent, this milestone's ABSORB should invoke
   `quay gate exp5-M-CRYST-G1` as its own DoD meta-enforcer check.
4. Confirm DIR-030's `## Resolution` note (already appended at SELECT) still accurately describes
   the outcome once ABSORB completes (re-read, do not silently leave stale if the outcome diverges
   from what SELECT predicted).
5. **Checkpoint cadence:** last checkpoint written was cp-40 at m40 (per the every-5-milestone
   cadence, next DUE at m45) — NOT due at this ABSORB (`milestone_counter` becomes 41).

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit
(`experiments/quay-perpetual-stream/milestones/M41-cryst-g1-observability/worktrees/iteration-{0,1}`,
branches `exp5-m41-iteration-{0,1}`). Iteration-1 must NOT read iteration-0's materials
(independent-verification discipline). Both iterations should independently attempt the 3 ACs
end-to-end (build all three proxy scripts + fixtures, run them against the live repo, and record a
real dashboard reading) — a report that only designs the proxies without running them and
observing real output has not met the AC.
