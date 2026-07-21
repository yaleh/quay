# V_meta Insight Ledger

Tracked, alarmed, gated inner→outer V_meta hand-off (DIR-005 / charter M07-vmeta-gate). Replaces
the prior prose "adaptation candidate / φ pending" mentions scattered across `dashboard.md`'s Log
section with one explicit row per insight. Choice of location: **new sibling file** (not a
`dashboard.md` section) — `dashboard.md` is already the VT curve + health tracks + append-only Log;
a ledger with its own row schema and per-row status transitions (`proposed → confirmed →
consolidated`) is a distinct artifact with a different update cadence (edited whenever a
confirmation count changes, not just at ABSORB) and benefits from being independently diffable
without the surrounding narrative log growing noisier. `dashboard.md`'s health tracks table (below,
item 2) reads this file's rows rather than duplicating them.

## Schema
`insight | origin milestone | confirmation count | status {proposed|confirmed|consolidated}`

Each row's confirmation count and status are a single evolving fact about ONE insight, not a
snapshot frozen at origin — see the "one row per insight, not one row per confirmation event" note
below.

**Structured status field (M70/D4, ADR-004 hard-over-soft):** The `status` cell MUST begin with a
machine-readable tag: `[consolidated]`, `[confirmed]`, or `[proposed]` (optionally **bold**-wrapped
as `**[consolidated]**` etc.). Everything after the tag is narrative/history and is ignored by the
parser. A row whose status cell does NOT start with one of these tags will cause the vmeta-lag gate
to FAIL-closed (never silent PASS). Examples:
- `[consolidated] (m7 ABSORB, 2026-07-18) — folded into inherited-core.md`
- `[confirmed] — m3 ABSORB, 2026-07-18 — 2 cross-domain confirmations`
- `[proposed] — noted, never applied`

## Rows

| insight | origin milestone | confirmation count | status |
|---|---|---|---|
| domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise) | m1 (M01-dist) | 2 — m1 packaging (origin, 1st instance) + m3 (M03-abi-eval, cross-provider conformance suite, 2nd instance, different domain) — **past φ threshold (2 cross-domain confirmations)**, crossed at m3 | **[consolidated]** (m7 ABSORB, 2026-07-18) — folded into `inherited-core.md`'s "Domain-misfit audit-channel" section under a new "CONSOLIDATED — φ-confirmed pattern" subsection, recording the m3 confirming instance and retiring this as an established, twice-confirmed convention. This is the DIR-005 first-proof requirement (charter Done-when clause 4), resolved by consolidation (not a carry-forward deferral) at the very next ABSORB after the gate was built — demonstrating the gate fires on a real pre-existing case. |
| repo-root isolation-leak lesson | m3 (M03-abi-eval) | 1 (m3 only — no second cross-domain confirmation yet) | [proposed] — noted, never applied |

## Note on row count (iteration-1 correction of iteration-0's draft)

DIR-005's Finding section (archived directive, items 1-3) and this charter's in-scope item 1
(sub-items a/b/c) both ENUMERATE what look like three items, but item/sub-item (a) and (b) describe
**the SAME insight at two different points in its confirmation history**, not two distinct insights:
- Re-reading `dashboard.md`'s actual m1 ABSORB log entry (2026-07-18, "ABSORB m1 = M-DIST"): "Two
  adaptation candidates (domain-audit-channel≡CI-job pattern; per-subcommand audit exercise) logged
  but NOT yet consolidated — only 1 milestone's evidence, need a 2nd confirming instance per φ
  threshold (§4.2)." — this is the pattern's ORIGIN, confirmation count 1.
- Re-reading `dashboard.md`'s actual m3 ABSORB log entry: "φ: CI-job≡audit-channel pattern (from
  `inherited-core.md`, validated once at M01-dist) gets its 2nd confirming instance here ... this
  crosses the φ confirmation threshold (§4.2, 'a LATER different-domain milestone reuses an
  adaptation unchanged'); worth folding into `inherited-core.md` as a confirmed, not just proposed,
  pattern" — this is explicitly the SAME pattern ("validated once at M01-dist") gaining its SECOND
  confirmation and changing status, not a new, separate insight.
- `inherited-core.md`'s own φ fold-back definition (line 5) is "a milestone adaptation is reused
  UNCHANGED by a later different-domain milestone" — reuse-unchanged is a property of ONE adaptation
  accruing evidence over time, not grounds for spawning a second ledger entry per reuse event.

iteration-0's initial draft of this ledger modeled DIR-005's items (a)/(b) as two separate rows
(with a note flagging the ambiguity for iteration-1 to resolve — see iteration-0's report §8).
Keeping two rows would have been WRONG for the health track's math (item 2 below): a future ABSORB
walking "every ledger row past threshold" would encounter what looks like two independent alarms for
what is actually one confirmed-and-unresolved debt item, double-counting it. **Corrected here to ONE
row** whose confirmation count and status evolved m1 (count=1, proposed) → m3 (count=2, confirmed).
DIR-005's own numbered Finding items 1/2 read equally well as "the same insight's history, told in
two paragraphs because the directive is itself narrating the confirmation event as it happened" —
consistent with this single-row correction, not requiring two permanent rows.

## Definitions
- **confirmation count**: number of DIFFERENT-domain milestones that have independently reused the
  same adaptation/pattern unchanged (per `inherited-core.md`'s φ fold-back definition, §4.2). This
  count is cumulative per INSIGHT (one row), not per confirmation EVENT (which would imply a new row
  each time) — a row's count increments in place as new confirming milestones complete.
- **φ confirmation threshold**: 2 cross-domain confirmations (existing standing definition, carried
  from `inherited-core.md` / `dashboard.md`'s φ fold-back health track).
- **status lifecycle**: `proposed` (logged once, no second confirmation yet) → `confirmed` (crossed
  the φ threshold, i.e. ≥2 cross-domain confirmations) → `consolidated` (merged into
  `inherited-core.md`, citation retired per §4.2).
- **milestones-since-confirmed** (used by the `dashboard.md` health track below): count of
  milestones that have completed ABSORB since the milestone where a row's status became
  `confirmed` (the milestone that supplied the 2nd/threshold-crossing confirmation itself counts as
  milestone 0 of the count — i.e. "since-confirmed" starts counting from the NEXT milestone's
  ABSORB). Concretely for the row above: confirmed at m3's ABSORB (m3 = 0); m4 ABSORB (=1); m5
  ABSORB (=2); m6 ABSORB (=3) → milestones-since-confirmed = 3 as of m6-complete, already past K=2.
  Mechanically derivable by any future reader from this row's stated confirming milestone number (3)
  and `dashboard.md`'s `milestone_counter` at ABSORB time (see Cross-reference below) — no external
  memory required.

## Cross-reference
See `dashboard.md`'s `V_meta consolidation lag` health track (added this milestone, mirrors this
ledger's `confirmed`-and-past-threshold rows) and `OUTER-LOOP.md`'s ABSORB step (gate referencing
this file, added this milestone).
