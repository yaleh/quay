# task-ac-carryover-baseline.md — shrink-only ratchet list for task-ac-carryover-check.ts
# (tasks/gap-nothing-checks-whether-a-done-task-left-its-acs-behind, AC7). A line here means a
# `status: done` task still has an unchecked AC with no carrying successor — a LEGACY case
# baselined so the gate does not block the whole store at once.
#
# RATCHET: the list can ONLY get SHORTER. task-ac-carryover-check.ts exits 1 if a NEW unowned
# AC appears that is not already listed. Remove an entry only after the AC gains a carrying
# successor (then run --write-ratchet to persist the shrunken list). `--write-ratchet
# --reset-baseline` is the deliberate one-shot re-baseline after a criterion change.
#
# Format: one `<task-id>: <AC-id>` per line (sorted; one line per unowned AC).
# baseline-count: 10

DIR-124-A1a: AC1
DIR-124-A1a: AC2
DIR-124-A1a: AC3
DIR-124-A1a: AC4
DIR-124-A1a: AC5
DIR-124-A1a: AC6
DIR-124-A1a: AC7
DIR-124-A1a: AC8
DIR-124-A1a: AC9
gap-reverse-drift-check-buries-true-positives-in-noise: AC2
