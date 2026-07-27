# M180 — adversarial acceptance audit (SECOND pass, post iteration-1 rebuild)

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Task:** gap-absorb-entry-clause-disposition-sequencing · **Charter:**
`experiments/quay-perpetual-stream/charters/M180-gap-absorb-disposition-sequencing.md` ·
**MILESTONE_ROOT:** `milestones/M180` (resolved via `gate_resolve_milestone_root 180` from
`gate-script-lib.sh`, per the single-sourced ADR-004 rule)

Fresh context — this audit had not seen the build before this pass (the pre-existing content of the
task file and the first audit artifact were read as evidence, per this audit's own charge; nothing
was taken on the implementer's or the prior audit's word without independent re-verification).
Refute-first stance throughout. This is a SECOND audit pass: a prior pass (documented at commit
`3b90ef5`, superseded by this file) found REFUTED on AC2/DoD1; the build responded with iteration-1
(`46e92e4`, a regression test, no `.claude/`/`plugin/workflows/` edits), and this pass re-audits from
scratch against the current state of everything.

## 1. AC satisfaction (refute-first)

### AC1 — Audit/Gate phases append real disposition text for clause1/clause2/clause7

**CONFIRMED (with a disclosed phase-placement deviation).** Independently re-verified, not taken on
faith from the prior audit:

- `git show c201b4c -- .claude/workflows/execute-milestone.js` shows a new Audit-phase step 2a
  (between step 2 "DoD satisfaction" and step 3 "MECHANICAL GATE") instructing append, before
  `it0-dod-check.sh` fires, of `adversarial-audit disposition: <VERDICT>` (clause1) and
  `V_meta consolidation-lag: <verbatim vmeta-lag-check.sh output>` (clause2).
- Read `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts` directly (not guessed): clause1's
  regex is at lines 237-238 (`/adversarial-audit[\s\S]{0,200}?\b(REFUTED|CONCERNS|NO REFUTATION
  FOUND)\b/i`, either order) — `adversarial-audit disposition: <VERDICT>` matches. clause2's regex is
  at lines 251-252 (`/V_meta consolidation[- ]lag[\s\S]{0,200}?\b(clear|no rows? (past|over)
  threshold|resolved|consolidated|carry-forward|K=2)\b/i`) — confirmed by actually running
  `vmeta-lag-check.sh --counter 171 experiments/quay-perpetual-stream/v-meta-ledger.md` (real
  command, real output, not assumed): its output literally contains "consolidated" and "PASS: no
  confirmed-unconsolidated row past K without a dated carry-forward", both keyword-matching. (Note:
  the prior audit cited these regexes at lines 236-237/250-251 — off by one from the actual current
  lines 237-238/251-252; immaterial to the substance, noted for citation accuracy.)
- clause7 is handled by a **Build-phase step 1a** (accurate `surface:<label>` token on the
  absorb-entry's `## Backlog row`), not literally in Audit/Gate — a real deviation from AC1's literal
  wording. Independently verified against `it0-dod-check.ts` (the `surfaceLabelMatches`/`triggerFires`
  logic, ~lines 507-548): a recognized non-product `surface:` token
  (`method-infra`/`docs`/`cross-cutting`/`packaging`) auto-resolves clause7 N/A-PASS. The M180 charter
  discloses this as "the cheapest fix." Ticked because the substance (grep-confirmable, regex-correct
  write instructions for all 3 clauses) is present; deviation noted, not blocking.
- Both mirrors carry the identical text: `diff .claude/workflows/execute-milestone.js
  plugin/workflows/execute-milestone.js` → no output; `node --check` clean on both (re-run this pass).

### AC2 — Real (non-fixture) milestone dispatch shows the check passing without manual edits

**STILL REFUTED**, but the picture materially changed this pass. In order:

**iteration-1's contribution (build, `46e92e4`):** added
`plugin/test/execute-milestone-disposition-conformance.test.mjs` — imports the REAL exported
`runDodCheck()`/`checkLedger()` (never reimplements the checker), 16 tests. Re-run independently by
this audit: `node --test plugin/test/execute-milestone-disposition-conformance.test.mjs` → **16/16
pass**. This is real, durable, CI-enforced proof the *wiring* is regex-correct and won't silently
regress. It explicitly does **not** claim to be a live dispatch — iteration-1's own text: "this
Build-phase subagent has no `Workflow` tool available... A literal, live, LLM-agent-driven
`execute-milestone.js` orchestrated dispatch... is therefore not something this iteration can
produce," and confirmed `/tmp/m180-absorb-entry.md` was read but never written (verified: this audit
independently checked its mtime, `2026-07-27 00:22:45`, predating this audit's own edits, and its
content — no disposition lines — before touching it).

**This audit's own contribution:** this audit *is* a live Audit-phase dispatch — its own governing
charge contains, verbatim, the exact step-2a instructions landed in `c201b4c` ("2a. DISPOSITION
APPEND... append `adversarial-audit disposition: <VERDICT>`... run
`vmeta-lag-check.sh`... append `V_meta consolidation-lag: <verbatim...>`"). Following that charge for
real (not as a test, not reverted):

1. Determined AC1/AC3/DoD2 confirmed, and reached a REFUTED overall verdict (this section, reasoned
   below) *before* writing anything to the file, per the charge's explicit ordering requirement.
2. Ran `vmeta-lag-check.sh --counter 171 experiments/quay-perpetual-stream/v-meta-ledger.md` for
   real, captured its actual output.
3. Appended, via `cat >> /tmp/m180-absorb-entry.md`, real (not fabricated) `adversarial-audit
   disposition: REFUTED` and `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K
   without a dated carry-forward` (verbatim) lines. **Left them in place — no revert.**
4. Re-ran the task's own `extra.acceptance` command live:

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
    gap-absorb-entry-clause-disposition-sequencing \
    experiments/quay-perpetual-stream/charters/M180-gap-absorb-disposition-sequencing.md \
    /tmp/m180-absorb-entry.md
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
...
PASS: clause7-test-floor: N/A — surface label(s) [method-infra] are exclusively non-product-touching
...
FAIL: clause0-ac-dod-present: checklist-form AC has 1 unchecked item(s) remaining: "A real
(non-fixture) milestone dispatch after this fix shows `it0-dod-check.sh` exiting 0 (or"
FAIL: DoD check failed — 1 clause violation(s) found (see above).
EXIT=1
```

clause1/clause2/clause7 **all PASS**, live, on the real (non-reverted) file — the first time in this
session's history any of these 3 clauses have genuinely passed without being hand-reverted
afterward. Only `clause0` fails now, and it fails on this exact AC2 item's own unticked checkbox.

**Why this audit still declines to tick AC2 / call this REFUTED-resolved:** the proof just produced
is self-referential — this milestone's own fix (step 2a), exercised by this milestone's own Audit
phase (this audit), on this milestone's own absorb-entry file, within the same turn that grades
whether the milestone is done. AC2's text asks for "a real (non-fixture) milestone dispatch... shows
`it0-dod-check.sh` exiting 0... without any manual post-hoc edit" — and the Requested-action section
clarifies the target is "manual **orchestrator** intervention," which this genuinely is not (it's
in-band, agent-driven, step-2a-designed behavior, not an out-of-band patch). That reading favors
crediting it. But accepting same-turn, same-milestone self-certification as sufficient proof would
mean **any** milestone's Audit phase could trivially "prove" its own gating AC merely by running its
own now-mandatory step 2a — collapsing AC2 into an automatic tautology for every future audit, not
just this one, and reproducing (under a different phase label) exactly the self-serving-loop pattern
this repo's methodology (DIR-093 anti-forgery; this task's own rejection of iteration-0's
edit-then-revert self-test) exists to prevent. Given the refute-first charge and the asymmetric cost
of a false-positive closure vs. leaving this open one more cycle, this audit resolves the tension
conservatively: **left unticked**, pending either (a) a genuinely independent milestone's real
Audit-phase dispatch exercising step 2a on its own, different absorb-entry file, or (b) explicit human
sign-off that this pass's self-referential proof is accepted as sufficient (see Human verification
Q1 in the task file, which asks exactly this).

### AC3 — Both workflow mirrors stay byte-identical

**CONFIRMED**, re-verified this pass: `diff .claude/workflows/execute-milestone.js
plugin/workflows/execute-milestone.js` → no output. `node --check` passes on both independently.

## 2. DoD satisfaction

- **"Landed on `master`, verified via a real dispatch, not asserted."** — **STILL REFUTED.** Landed
  on `master` (`c201b4c`, `46e92e4`, both confirmed via `git log`/`git show`, both single-parent
  commits by human `Yale Huang` directly on `master`). "Verified via a real dispatch" is not yet true
  in the un-self-referential sense the literal DoD text implies — see AC2. The mechanism is now
  demonstrably live-correct (clause1/2/7 all PASS this pass); what remains open is the same
  self-referential-proof question as AC2, not a code defect.
- **"...the milestone resolving it must run under human-steered discipline."** — **CONFIRMED**,
  re-verified: task carries `label: human-steered`. `experiments/quay-perpetual-stream/.halt`
  sentinel exists on disk, mtime `2026-07-26 12:42:43`, predating both `c201b4c`
  (`2026-07-27 00:29:37`) and `46e92e4` (`2026-07-27 00:52:17`). Both commits are single-parent, made
  directly on `master` by the human git user (`Yale Huang`), not loop-driven merges — consistent with
  the DIR-027 "pause via `.halt`" steering-hygiene path.

Because AC2 and the first DoD item remain unmet, overall DoD is **not satisfied**.

## 3. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
    gap-absorb-entry-clause-disposition-sequencing \
    experiments/quay-perpetual-stream/charters/M180-gap-absorb-disposition-sequencing.md \
    /tmp/m180-absorb-entry.md
EXIT=1
```

Non-zero exit. **REFUTED by construction**, per this audit's own governing charge — even after this
audit's own real, non-reverted step-2a append flips clause1/clause2/clause7 to PASS, `clause0` still
fails on AC2's own unticked checkbox (a checkbox this audit declined to tick, for the reasons in
AC2 above).

## 4. Deviation-log write-back (DIR-017 Step 3 / M36)

Two NEW rows appended to `dashboard.md`'s "Homeostatic variables" table for this second pass
(the first pass's M180 rows, lines 526-527, are left as-is — historical record of the first
finding, still accurate as of when they were written):

- `REFUTED | machine | M180 | ...` — this audit's own finding this pass: iteration-1 added a durable
  regression test (16/16 pass) but explicitly declined to touch the real absorb-entry file; this
  audit then performed the first-ever real, non-reverted step-2a append and confirmed
  clause1/clause2/clause7 now genuinely PASS live — but declines to self-certify AC2 on that
  self-referential evidence alone, so clause0 (AC2's own unticked box) still fails and the mechanical
  gate still exits 1.
- `CONCERNS | human | M180 | ...` — transcribing iteration-1's own disclosure (`iterations/
  iteration-1.md`, "Remaining gap" section): the Build-phase subagent had no `Workflow` tool
  available, so a real orchestrated dispatch was outside its tool surface, and it explicitly refused
  to fabricate one rather than repeat iteration-0's role-blending mistake.

## 5. Checklist write-back (DIR-020)

Updated in `tasks/gap-absorb-entry-clause-disposition-sequencing.md`, each with a fresh evidence
citation reflecting this pass's findings:

- AC1 → `[x]` (confirmed, unchanged from first pass, independently re-verified)
- AC2 → left `[ ]` (still REFUTED — see above; citation rewritten to reflect this pass's real,
  non-reverted, clause1/2/7-PASS-live evidence and the self-referential-proof reasoning for not
  ticking it)
- AC3 → `[x]` (confirmed, unchanged)
- DoD1 → left `[ ]` (still REFUTED; citation rewritten — gate now fails on clause0 only, not
  clause1/clause2)
- DoD2 → `[x]` (confirmed, unchanged, with `46e92e4` timing added)

## Verdict

**REFUTED.** The mechanical gate exits non-zero (1) against the task's own designated absorb-entry
file. This pass narrows the failure from 3 clauses (clause0/1/2, per the first audit) to 1
(clause0 only) — clause1/clause2/clause7 now genuinely PASS live, for the first time, via a real,
non-reverted disposition append this audit itself performed as its own mandated step 2a. The
remaining gap is not a code or wiring defect (AC1/AC3 are solid, and iteration-1's regression test
plus this audit's live run both independently confirm the mechanism works) — it is a legitimate
open epistemic question about whether same-turn, same-milestone self-referential proof should count
as "a real (non-fixture) milestone dispatch" for THIS gating AC, which this audit declines to resolve
unilaterally in the direction that closes its own gate. Flagged clearly for human judgment (see the
task's own "Human verification" Q1, which asks exactly this question).
