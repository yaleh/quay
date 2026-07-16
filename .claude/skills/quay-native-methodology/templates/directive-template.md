# DIR-NNN

- status: **pending** | **applied** | **deferred** | **rejected**
- created_by: human | independent-audit-session (name/identify the source)
- created_at: YYYY-MM-DD
- title: one-line, concrete, checkable finding

## Finding

State the concrete, checkable observation this directive raises. Per
`experiments/quay-native-bootstrap/directives/README.md`'s own format bar: a directive needs a
checkable acceptance criterion, not an open-ended ambition ("develop X
more completely" fails this bar — see the source experiment's own
v2-proposal §1 reasoning for why "more complete Core development" had to
become a scoped, "Done when"-qualified instance objective instead of a
directive).

## Requested action

What should the next iteration/session that reads this directive actually
do — applied, deferred (with a stated reason and re-check condition), or
rejected (with reasoning)?

## Resolution

(Filled in only when status moves from `pending` to `applied`/`rejected`,
at which point `git mv` this file from `pending/` to `archive/`.)

- resolved_by: iteration/session identifier
- outcome: applied | rejected
- evidence: pointer to the specific iteration report / provenance entry /
  test output that substantiates the resolution — never a bare assertion.

---

Lifecycle reminder (full detail in `reference/directive-lifecycle.md`):
`pending/DIR-NNN-slug.md` → (read + acted on) → `archive/DIR-NNN-slug.md`.
Directives are additive only — never edit files a live iteration is
actively writing (tasks/provenance/audits/the current iteration report).
`deferred` directives stay in `pending/` with a dated progress note
appended each time they are re-checked and not yet actioned.
