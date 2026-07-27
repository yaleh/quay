# M180 iteration-0 — adversarial acceptance audit

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Task:** gap-absorb-entry-clause-disposition-sequencing · **Charter:**
`experiments/quay-perpetual-stream/charters/M180-gap-absorb-disposition-sequencing.md` ·
**MILESTONE_ROOT:** `milestones/M180` (resolved via
`gate_resolve_milestone_root 180` from `gate-script-lib.sh`, per the single-sourced ADR-004 rule)

Fresh context — this audit had not seen the build before this pass. Refute-first stance throughout.

## 1. AC satisfaction (refute-first)

### AC1 — Audit/Gate phases append real disposition text for clause1/clause2/clause7

**CONFIRMED (with a disclosed phase-placement deviation).**

`git show c201b4c -- .claude/workflows/execute-milestone.js` shows a new Audit-phase step 2a
(positioned between step 2 "DoD satisfaction" and step 3 "MECHANICAL GATE") instructing the agent
to append, before invoking `it0-dod-check.sh`:
- `adversarial-audit disposition: <VERDICT>` (clause1)
- `V_meta consolidation-lag: <verbatim vmeta-lag-check.sh output>` (clause2)

Both phrasings were checked directly against `it0-dod-check.ts`'s own regexes (not guessed):
- clause1 (lines 236-237): `/adversarial-audit[\s\S]{0,200}?\b(REFUTED|CONCERNS|NO REFUTATION FOUND)\b/i`
  (or reversed order) — `adversarial-audit disposition: <VERDICT>` matches.
- clause2 (lines 250-251): `/V_meta consolidation[- ]lag[\s\S]{0,200}?\b(clear|no rows? (past|over)
  threshold|resolved|consolidated|carry-forward|K=2)\b/i` — `vmeta-lag-check.ts`'s own reason
  strings ("consolidated — lag gate does not apply" / "no confirmed-unconsolidated row past K
  without a dated carry-forward") both contain a matching keyword, confirmed by reading
  `vmeta-lag-check.ts` lines 140-163/207 directly.

clause7 is instead handled by a **new Build-phase step 1a** (ensure an accurate `surface:<label>`
token on the absorb-entry's `## Backlog row`), not literally in the Audit/Gate phases as this AC's
text specifies. Independently verified correct against `it0-dod-check.ts` lines 513/527/544: a
recognized non-product `surface:` token (`method-infra`/`docs`/`cross-cutting`/`packaging`)
auto-resolves clause7 N/A-PASS with no coverage/WAIVER text needed. This is a real deviation from
the AC's literal wording (clause7 fix lives in Build, not Audit/Gate) but the charter (M180 Scope
item 3) explicitly chose this as "the cheapest fix" and the substance — grep-confirmable write
instructions for all 3 clauses, functionally correct — is present. Ticked, with this deviation
noted rather than treated as blocking.

Both mirrors carry the identical text (`diff` clean, see AC3).

### AC2 — Real (non-fixture) milestone dispatch shows the check passing without manual edits

**REFUTED.**

No real dispatch happened. `milestones/M180/iterations/iteration-0.md` (the build's own
self-report) discloses this directly under "Verification": the implementer could not perform a
real live re-dispatch because this milestone's own build IS the in-flight session that edited
`execute-milestone.js`, and (per CLAUDE.md's own documented workflow-script-staleness
anti-pattern) a live run cannot pick up a script edit made mid-run. In its place, the implementer:
1. hand-appended the 2 disposition lines to `/tmp/m180-absorb-entry.md`,
2. re-ran `it0-dod-check.sh` and observed clause1/clause2/clause7 flip FAIL → PASS,
3. then **explicitly reverted** the file back to its original pre-test content ("Restored
   `/tmp/m180-absorb-entry.md` to its original pre-test content").

That is a manual edit-then-revert self-test — the opposite of "without any manual post-hoc edit to
the absorb-entry file", and it leaves the real file in its pre-fix state.

Independent live re-verification by this audit (2026-07-27), running the task's own
`extra.acceptance` command verbatim:

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
    gap-absorb-entry-clause-disposition-sequencing \
    experiments/quay-perpetual-stream/charters/M180-gap-absorb-disposition-sequencing.md \
    /tmp/m180-absorb-entry.md
...
FAIL: clause1-adversarial-audit: NO disposition statement found in ABSORB-entry text (missing verdict AND missing documented-no-op statement)
FAIL: clause2-vmeta-lag: NO disposition statement found in ABSORB-entry text (missing 'clear'/'no rows past threshold'/resolved/consolidated/carry-forward statement)
FAIL: DoD check failed — 3 clause violation(s) found (see above).
EXIT=1
```

clause1 and clause2 still FAIL right now, on exactly the file the AC/charter name as the real proof
target — confirming the fix has never actually fired end-to-end. REFUTED.

### AC3 — Both workflow mirrors stay byte-identical

**CONFIRMED.** `diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js`
(run 2026-07-27) produces no output — byte-identical. `node --check` passes on both files
independently.

## 2. DoD satisfaction

- **"Landed on `master`, verified via a real dispatch, not asserted."** — **REFUTED.** Landed on
  `master` (commit `c201b4c`, confirmed via `git log`), but "verified via a real dispatch" is
  false — see AC2 above. Only asserted (via the reverted self-test and the commit message's own
  claims), never actually verified end-to-end.
- **"...the milestone resolving it must run under human-steered discipline."** — **CONFIRMED.**
  Task carries `label: human-steered`. `experiments/quay-perpetual-stream/.halt` sentinel exists on
  disk, mtime 2026-07-26 12:42, predating the `c201b4c` commit (2026-07-27 00:29:37). `c201b4c` is
  a single-parent commit made directly on `master` by the human git user (`Yale Huang`), not a
  loop-driven merge — consistent with the DIR-027 "pause via `.halt`" steering-hygiene path.

Because AC2 and the first DoD item are both unmet, overall DoD is **not satisfied**.

## 3. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
    gap-absorb-entry-clause-disposition-sequencing \
    experiments/quay-perpetual-stream/charters/M180-gap-absorb-disposition-sequencing.md \
    /tmp/m180-absorb-entry.md
EXIT=1
```

Non-zero exit. **REFUTED by construction**, per this audit's own governing charge. (Post
write-back the only clause0 sub-failure remaining is the still-unticked AC2 item; clause1/clause2
fail independently of clause0, on their own merits, as shown above.)

## 4. Deviation-log write-back (DIR-017 Step 3 / M36)

Two rows appended to `dashboard.md`'s "Deviation rows" table (Homeostatic variables §):

- `REFUTED | machine | M180 | ...` — this audit's own live re-run finding (AC2/DoD1 unmet; clause1/
  clause2 still FAIL on the real absorb-entry file).
- `CONCERNS | human | M180 | ...` — transcribing `milestones/M180/iterations/iteration-0.md`'s own
  disclosure of the manual append-then-revert self-test workaround (the outer loop's own build
  drafted this disclosure; this audit transcribes it, does not originate it).

## 5. Checklist write-back (DIR-020)

Ticked in `tasks/gap-absorb-entry-clause-disposition-sequencing.md`, each with an evidence
citation:
- AC1 → `[x]` (confirmed, phase-placement deviation noted)
- AC2 → left `[ ]` (REFUTED)
- AC3 → `[x]` (confirmed)
- DoD1 ("landed... verified via a real dispatch") → left `[ ]` (REFUTED)
- DoD2 (human-steered discipline) → `[x]` (confirmed)

## Verdict

**REFUTED.** The mechanical gate exits non-zero (1) against the task's own designated absorb-entry
file, and the central AC (a real, unmodified-by-hand absorb-entry file actually passing
clause1/clause2/clause7) is unmet — the only evidence offered was a manual edit-then-revert
self-test the implementer itself disclosed was not a real dispatch. The code change (AC1, AC3) is
real, correct, and independently verified against the actual checker regexes; what's missing is
proof the mechanism works end-to-end without hand intervention — the exact thing this milestone
exists to eliminate.
