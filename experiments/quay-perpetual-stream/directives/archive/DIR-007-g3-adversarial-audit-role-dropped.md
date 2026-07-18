# DIR-007

- status: resolved (M10-audit-consolidation, iteration-0)
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: G3 out-of-band adversarial audit role silently weakened into same-template independent re-run — no mechanized Done-when/HARD GATE requires it

## Finding

Following DIR-006 (Web UI browser-verification regression), a systematic audit
of exp1–4 requirements that exp5's two-layer refactor may have carried
forward only as *citation* rather than *enforcement* surfaced a second, live
instance of the same failure class, this time for exp5's own general-purpose
independent-verification discipline.

1. **The original requirement (exp1, "G3").** exp1 (`quay-native-bootstrap`)
   established a concrete out-of-band audit mechanism: every iteration
   produces an `iteration-N-independent-adjudicate.md`, dispatched by the
   orchestrator as a **distinct role from the iteration that did the
   building** — a fresh-context subagent whose job is to actively question
   and re-derive the claimed evidence, not merely redo the work. This
   mechanism directly caught 3 separate V_meta overclaim attempts in exp1
   (iterations 29, 59, 61), and was repeatedly hardened by later DIRs
   (DIR-002/DIR-003 in `quay-webui-bootstrap`, DIR-005, DIR-013).

2. **exp5's citation.** `experiments/quay-perpetual-stream/inherited-core.md:10`
   names "G3 out-of-band audit discipline"; `inherited-core.md:64` says
   "Reuse an existing out-of-band mechanism from a DIFFERENT actor/
   environment." Both are citations of the concept.

3. **No operational follow-through.** Across all 9 exp5 milestone charters,
   8 never mention G3 at all. The one hit, `charters/M01-dist.md:131`, uses
   only the phrase "G3-equivalent out-of-band check" — no Done-when clause
   or HARD GATE anywhere in exp5 requires dispatching a distinct
   adjudicate/auditor-role subagent. No
   `milestones/*/audits/iteration-N-independent-adjudicate.md`-shaped
   artifact exists anywhere in exp5's own tree (only in stale worktree
   copies of earlier experiments' files, pulled in as pre-existing repo
   content, not authored by exp5).

4. **What exp5 built instead is a different mechanism, not a substitute.**
   The G3 concept was absorbed and reshaped into the "domain-misfit
   audit-channel" idea (`OUTER-LOOP.md:93-97`), which asks "does this
   domain have *any* independent verification mechanism reachable (e.g. a
   CI job)?" — a domain-capability question. It does not ask G3's original
   question: "has *this specific iteration's* claimed evidence been
   independently re-verified by an adversarial, fresh-context reviewer
   before the value-function lift is accepted?"

5. **Directly verified (this conversation, live check):** exp5 does have a
   real, working independent-verification step — iteration-1 of every
   milestone is dispatched as a fresh `baime:iteration-executor` subagent
   in a fresh git worktree, explicitly instructed to "independently
   re-derive/re-run every claim from a fresh worktree, rather than trusting
   iteration-0's prose" (`milestones/M05-dir-projection/iterations/
   iteration-1.md:7-11`), and this has genuinely caught real bugs in at
   least 5 of 9 milestones (M02 gate-hash false-FAIL, M04 VT arithmetic
   slip, M05 `--labels`/`--label` CLI typo, M06 self-exemption override +
   value-type mislabel, M07 ledger row double-count). This confirms the
   mechanism is live and effective — but its role is **same-template
   independent re-run** ("do the same kind of work again, fresh, and see if
   you reach the same answer"), not **cross-role adversarial audit**
   ("actively try to find fault in a specific claim, dispatched as a
   distinctly-scoped reviewer, by the orchestrator, out of band from the
   builder role"). The two are not interchangeable: G3's exp1 track record
   was specifically about catching claim-inflation/self-serving scoring,
   which a same-template redo checks only incidentally (it happens to
   re-derive evidence, but its designed question is "is this stable/
   reproducible," not "is this claim actually true and not inflated").

## Requested action

1. Add a genuinely distinct, adversarially-scoped audit role to exp5's
   inherited core / OUTER-LOOP.md, dispatched by the outer loop as its own
   out-of-band step (not folded into iteration-1's build-and-reverify
   template), whose explicit charge is to try to refute/find fault with a
   milestone's Done-when claims and VT delta — separate from, and in
   addition to, the existing iteration-1 stability-confirmation pass.
2. Require this as a mechanized Done-when clause or HARD GATE on at least
   the milestones most exposed to claim-inflation risk (value-typed/VT-
   scoring milestones, and any milestone whose own iteration-0 recommends
   skipping iteration-1 — cf. M06-sizing's self-exemption attempt, which
   the outer loop caught by base-rate judgment, not by a mechanized gate).
3. Do not require this on every milestone if that would be disproportionate
   to exp5's method-ROI framing (DIR-004's sizing discipline) — the
   disposing iteration should judge cadence/scope, but must record an
   explicit, checkable requirement, not another citation-only line in
   `inherited-core.md`.

## Resolution

- **status: resolved** at M10-audit-consolidation, iteration-0 (2026-07-18)

1. **Requested action 1** (genuinely distinct, adversarially-scoped audit
   role) — disposed by `inherited-core.md`'s new section "Adversarial-audit
   role — a NEW out-of-band step, distinct from iteration-1 (M10-audit-
   consolidation Done-when 4/5/6, DIR-007)": specifies dispatcher (outer
   loop only, at ABSORB — never the milestone's own iteration-0/1), mechanism
   (fresh-context `baime:iteration-executor`, `run_in_background=true`,
   given the charter + iteration-0/1 reports + `inherited-core.md`, with a
   distinctly-worded refutation-focused prompt template charged to actively
   try to find fault, not re-derive), output location
   (`milestones/M<NN>/audits/iteration-N-adversarial-audit.md`), and
   REFUTED-blocks-ABSORB behavior. A comparison table makes the iteration-1
   vs. adversarial-audit distinction explicit (dispatcher/scope/question/
   inputs/frequency), directly answering finding 5's point that the two are
   not interchangeable. `OUTER-LOOP.md` step 6 (ABSORB) gained a new HARD
   BLOCK sub-bullet ("Adversarial-audit gate") implementing this as a
   mechanized, checkable gate rather than another citation-only line.
2. **Requested action 2** (mechanized Done-when/HARD GATE on exposed
   milestones) — disposed by the same `OUTER-LOOP.md` HARD BLOCK: it fires
   on (a) VT-scoring/capability-growth milestones and (b) self-exemption-
   attempting milestones (the M06-sizing precedent named in the directive's
   own finding 5 is cited directly as the trigger case for condition (b)).
3. **Requested action 3** (non-blanket cadence, explicit and checkable) —
   disposed by `inherited-core.md`'s companion section "Adversarial-audit
   cadence rule (M10-audit-consolidation Done-when 6, DIR-007 item 3)":
   states plainly that methodology-infra/governance milestones (M02/M05/
   M06/M07/M10-class) do NOT require this by default unless condition (b)
   independently fires, and the `OUTER-LOOP.md` gate requires an explicit
   "neither condition applied" statement as a documented no-op when the
   gate doesn't fire, rather than silent omission — satisfying the
   directive's requirement for "an explicit, checkable requirement, not
   another citation-only line."
